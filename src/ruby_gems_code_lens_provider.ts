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
} from "vscode";
import * as path from "node:path";
import * as cp from "node:child_process";
import Cache from "./cache";

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

class RubyGemsCodeLensProvider implements CodeLensProvider {
  private _onDidChangeCodeLenses: EventEmitter<void> = new EventEmitter<void>();
  public readonly onDidChangeCodeLenses: Event<void> = this._onDidChangeCodeLenses.event;

  public readonly cache: Cache;
  private readonly output: OutputChannel;

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

  constructor(cache: Cache) {
    this.cache = cache;
    this.output = window.createOutputChannel("Gemfile Version Lens");

    // Watch for changes to Gemfile (debounced to coalesce bursts of saves)
    workspace.onDidSaveTextDocument((doc) => {
      if (this.isGemfile(doc)) {
        this.scheduleRefresh(doc.uri.fsPath);
      }
    });

    // Re-run the version check when the extension settings change
    workspace.onDidChangeConfiguration((event) => {
      if (event.affectsConfiguration("gemfileVersionLens")) {
        this.scheduleRefresh();
      }
    });
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

    window.setStatusBarMessage("Fetching gem versions...", 2000);
    let gemVersions = await this.getGemVersions(document);

    if (!gemVersions) {
      return [];
    }

    this.cache.set(document.uri.fsPath, gemVersions);

    // Regular expression to match gem declarations in Gemfile
    const gemRegex = /^[\t ]*gem\s+(['"])(.*?)\1(?:\s*,\s*(['"])(.+?)\3)?/gm;
    const text = document.getText();
    let match;

    while ((match = gemRegex.exec(text)) !== null) {
      const gemName = match[2];
      const range = new Range(
        document.positionAt(match.index),
        document.positionAt(match.index + match[0].length),
      );

      const gemInfo = gemVersions.gems[gemName];
      if (!gemInfo) {
        continue; // Skip if gem info is not available
      }

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

    const extensionPath = path.dirname(__dirname);
    const scriptPath = path.join(extensionPath, "bin", "versions.rb");
    const updateLevel = workspace
      .getConfiguration("gemfileVersionLens")
      .get<string>("updateLevel", "all");
    const cwd = path.dirname(fsPath);
    const env = { ...process.env, GVL_UPDATE_LEVEL: updateLevel };

    let child: cp.ChildProcess;

    const promise = new Promise<GemVersionsOutput | null>((resolve) => {
      this.output.appendLine(`Running versions.rb for ${fsPath} with update level: ${updateLevel}`);
      child = cp.execFile("ruby", [scriptPath], { cwd, env }, (error, stdout, stderr) => {
        // Release the slot only if it still belongs to this run.
        if (this.inflight.get(fsPath)?.child === child) {
          this.inflight.delete(fsPath);
        }

        if (error) {
          // A deliberate kill (invalidation via cancelInflight) is not a failure.
          if (child.killed) {
            resolve(null);
            return;
          }
          if (stderr) {
            this.output.appendLine(stderr);
          }
          window.showErrorMessage(`Failed to run versions.rb: ${error.message}`);
          resolve(null);
          return;
        }

        try {
          const parsedOutput = JSON.parse(stdout) as GemVersionsOutput;
          this.reportErrors(parsedOutput.errors);
          resolve(parsedOutput);
        } catch (e) {
          window.showErrorMessage(`Failed to parse output from versions.rb: ${e}`);
          resolve(null);
        }
      });
    });

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
      entry.child.kill();
    }
  }

  private cancelAllInflight(): void {
    for (const fsPath of [...this.inflight.keys()]) {
      this.cancelInflight(fsPath);
    }
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
