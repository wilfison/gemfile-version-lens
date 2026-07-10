import {
  CodeLensProvider,
  EventEmitter,
  Event,
  workspace,
  CodeLens,
  window,
  Range,
  TextDocument,
  OutputChannel,
  CancellationToken,
  Disposable,
} from "vscode";
import * as path from "node:path";
import * as cp from "node:child_process";
import Cache from "./cache";
import { parseGemDeclarations } from "./gemfile_parser";

// Define types for the gem specification data
interface GemSpec {
  installed: string;
  newest?: string;
  homepage?: string;
  changelog?: string;
}

// Type for the result of executing versions.rb
export interface GemVersionsOutput {
  gems: Record<string, GemSpec>;
  errors: string[];
}

class RubyGemsCodeLensProvider implements CodeLensProvider, Disposable {
  private _onDidChangeCodeLenses: EventEmitter<void> = new EventEmitter<void>();
  public readonly onDidChangeCodeLenses: Event<void> = this._onDidChangeCodeLenses.event;

  public readonly cache: Cache;
  private readonly output: OutputChannel;

  // Extension root (from context.extensionPath), used to locate bin/versions.rb
  // independent of the compiled output layout.
  private readonly extensionPath: string;

  // Resources to tear down on dispose (listeners, output channel, emitter).
  private readonly disposables: Disposable[] = [];

  // Children we killed on purpose (invalidation via cancelInflight). Lets the
  // exec callback tell a deliberate kill (silent) from a timeout kill (surfaced).
  private readonly abortedChildren = new WeakSet<cp.ChildProcess>();

  // Show the "run failed" popup at most once until the next successful run,
  // so a broken setup (e.g. ruby not on PATH) doesn't spam a toast per refresh.
  private runErrorNotified = false;

  // In-flight versions.rb runs keyed by Gemfile path, so concurrent
  // provideCodeLenses calls share one process instead of spawning many.
  private readonly inflight = new Map<
    string,
    { promise: Promise<GemVersionsOutput | null>; child: cp.ChildProcess }
  >();

  // Debounce state for save/config-triggered refreshes, to coalesce bursts
  // (e.g. auto-save) into a single re-run.
  private static readonly REFRESH_DEBOUNCE_MS = 1500;
  private refreshTimer: ReturnType<typeof setTimeout> | undefined;
  private readonly pendingInvalidations = new Set<string>();
  private invalidateAllPending = false;

  constructor(cache: Cache, extensionPath: string) {
    this.cache = cache;
    this.extensionPath = extensionPath;
    this.output = window.createOutputChannel("Gemfile Version Lens");
    this.disposables.push(this.output, this._onDidChangeCodeLenses);

    // Watch for changes to Gemfile (debounced to coalesce bursts of saves)
    this.disposables.push(
      workspace.onDidSaveTextDocument((doc) => {
        if (this.isGemfile(doc)) {
          this.scheduleRefresh(doc.uri.fsPath);
        }
      }),
    );

    // Re-run the version check when the extension settings change
    this.disposables.push(
      workspace.onDidChangeConfiguration((event) => {
        if (event.affectsConfiguration("gemfileVersionLens")) {
          this.scheduleRefresh();
        }
      }),
    );
  }

  public dispose(): void {
    if (this.refreshTimer) {
      clearTimeout(this.refreshTimer);
      this.refreshTimer = undefined;
    }
    this.cancelAllInflight();
    for (const disposable of this.disposables) {
      disposable.dispose();
    }
    this.disposables.length = 0;
  }

  private isGemfile(document: TextDocument): boolean {
    return path.basename(document.fileName) === "Gemfile";
  }

  public async provideCodeLenses(
    document: TextDocument,
    _token: CancellationToken,
  ): Promise<CodeLens[]> {
    if (!this.isGemfile(document)) {
      return [];
    }

    let codeLenses: CodeLens[] = [];

    let gemVersions = await this.getGemVersions(document);

    if (!gemVersions) {
      return [];
    }

    this.cache.set(document.uri.fsPath, gemVersions);

    for (const declaration of parseGemDeclarations(document.getText())) {
      const gemInfo = gemVersions.gems[declaration.name];
      if (!gemInfo) {
        continue; // Skip if gem info is not available
      }

      const range = new Range(
        document.positionAt(declaration.index),
        document.positionAt(declaration.index + declaration.length),
      );

      codeLenses = [...codeLenses, ...this.createCodeLens(gemInfo, range)];
    }

    return codeLenses;
  }

  private createCodeLensActions(gemInfo: GemSpec, range: Range): CodeLens[] {
    const codeLenses: CodeLens[] = [];
    const items = [
      ["Open Homepage", gemInfo.homepage],
      ["Open Changelog", gemInfo.changelog],
    ];

    for (const [title, url] of items) {
      if (title && url) {
        codeLenses.push(
          new CodeLens(range, {
            title,
            command: "vscode.open",
            arguments: [url],
          }),
        );
      }
    }

    return codeLenses;
  }

  private createCodeLens(gemInfo: GemSpec, range: Range): CodeLens[] {
    let codeLenses: CodeLens[] = [];

    codeLenses.push(new CodeLens(range, { title: `Current: ${gemInfo.installed}`, command: "" }));

    if (gemInfo.newest && gemInfo.installed !== gemInfo.newest) {
      codeLenses.push(new CodeLens(range, { title: `⚠️ Newest: ${gemInfo.newest}`, command: "" }));
    }

    codeLenses = [...codeLenses, ...this.createCodeLensActions(gemInfo, range)];

    return codeLenses;
  }

  private getGemVersions(document: TextDocument): Promise<GemVersionsOutput | null> {
    const fsPath = document.uri.fsPath;

    const cachedVersions = this.cache.get(fsPath);
    if (cachedVersions) {
      return Promise.resolve(cachedVersions);
    }

    // Reuse an in-flight run for the same Gemfile instead of spawning another.
    const existing = this.inflight.get(fsPath);
    if (existing) {
      return existing.promise;
    }

    const scriptPath = path.join(this.extensionPath, "bin", "versions.rb");
    const config = workspace.getConfiguration("gemfileVersionLens");
    const updateLevel = config.get<string>("updateLevel", "all");
    const rubyPath = config.get<string>("rubyPath", "ruby");
    const timeout = config.get<number>("timeout", 60000);
    const cwd = path.dirname(fsPath);
    const env = { ...process.env, GVL_UPDATE_LEVEL: updateLevel };

    let child: cp.ChildProcess;

    const promise = new Promise<GemVersionsOutput | null>((resolve) => {
      this.output.appendLine(`Running versions.rb for ${fsPath} with update level: ${updateLevel}`);
      child = cp.execFile(rubyPath, [scriptPath], { cwd, env, timeout }, (error, stdout, stderr) => {
        // Release the slot only if it still belongs to this run.
        if (this.inflight.get(fsPath)?.child === child) {
          this.inflight.delete(fsPath);
        }

        if (error) {
          // A deliberate kill (invalidation via cancelInflight) is not a failure.
          if (this.abortedChildren.has(child)) {
            this.abortedChildren.delete(child);
            resolve(null);
            return;
          }
          if (stderr) {
            this.output.appendLine(stderr);
          }
          this.reportRunError(this.describeRunError(error, rubyPath, timeout));
          resolve(null);
          return;
        }

        try {
          const parsedOutput = JSON.parse(stdout) as GemVersionsOutput;
          this.output.appendLine(`versions.rb output for ${fsPath}: ${stdout}`);
          this.runErrorNotified = false;
          this.reportErrors(parsedOutput.errors);
          resolve(parsedOutput);
        } catch (e) {
          this.reportRunError(`Failed to parse output from versions.rb: ${e}`);
          resolve(null);
        }
      });
    });

    // Show the status message only while a run is actually in flight, and keep
    // it up for exactly as long as the run takes (not a fixed 2s, not on cache hits).
    window.setStatusBarMessage("Fetching gem versions...", promise);

    this.inflight.set(fsPath, { promise, child: child! });

    return promise;
  }

  // Debounce a refresh so a burst of saves/config changes runs the script once.
  private scheduleRefresh(fsPath?: string): void {
    if (fsPath) {
      this.pendingInvalidations.add(fsPath);
    } else {
      this.invalidateAllPending = true;
    }

    if (this.refreshTimer) {
      clearTimeout(this.refreshTimer);
    }

    this.refreshTimer = setTimeout(
      () => this.flushRefresh(),
      RubyGemsCodeLensProvider.REFRESH_DEBOUNCE_MS,
    );
  }

  private flushRefresh(): void {
    this.refreshTimer = undefined;

    if (this.invalidateAllPending) {
      this.cancelAllInflight();
      this.cache.clear();
    } else {
      for (const fsPath of this.pendingInvalidations) {
        this.cancelInflight(fsPath);
        this.cache.delete(fsPath);
      }
    }

    this.pendingInvalidations.clear();
    this.invalidateAllPending = false;
    this._onDidChangeCodeLenses.fire();
  }

  // Kill and forget the in-flight run for a file, so the next request restarts.
  private cancelInflight(fsPath: string): void {
    const entry = this.inflight.get(fsPath);
    if (entry) {
      this.inflight.delete(fsPath);
      // Flag it so the exec callback treats this kill as intentional, not a failure.
      this.abortedChildren.add(entry.child);
      entry.child.kill();
    }
  }

  private cancelAllInflight(): void {
    for (const fsPath of [...this.inflight.keys()]) {
      this.cancelInflight(fsPath);
    }
  }

  // Turn an exec failure into a user-facing message, with a hint for the most
  // common cause (Ruby not on the editor's PATH) and for timeouts.
  private describeRunError(error: cp.ExecFileException, rubyPath: string, timeout: number): string {
    if (error.code === "ENOENT") {
      return `Could not find the Ruby executable "${rubyPath}". Set "gemfileVersionLens.rubyPath" to its full path.`;
    }
    if (error.killed) {
      return `versions.rb timed out after ${Math.round(timeout / 1000)}s. Increase "gemfileVersionLens.timeout" if your project is large.`;
    }
    return `Failed to run versions.rb: ${error.message}`;
  }

  // Always log the failure; only raise a popup the first time, so a broken
  // setup doesn't spam a toast on every lens refresh. Resets on the next success.
  private reportRunError(message: string): void {
    this.output.appendLine(message);

    if (this.runErrorNotified) {
      return;
    }
    this.runErrorNotified = true;

    window.showErrorMessage(`Gemfile Version Lens: ${message}`, "Show Details").then((choice) => {
      if (choice === "Show Details") {
        this.output.show(true);
      }
    });
  }

  // Surface errors reported by versions.rb instead of failing silently
  private reportErrors(errors: string[]): void {
    if (!errors || errors.length === 0) {
      return;
    }

    this.output.appendLine(`${errors.length} issue(s) while reading gem versions:`);
    for (const message of errors) {
      this.output.appendLine(`  - ${message}`);
    }

    window
      .showWarningMessage(
        `Gemfile Version Lens: ${errors.length} issue(s) while reading gem versions.`,
        "Show Details",
      )
      .then((choice) => {
        if (choice === "Show Details") {
          this.output.show(true);
        }
      });
  }
}

export default RubyGemsCodeLensProvider;
