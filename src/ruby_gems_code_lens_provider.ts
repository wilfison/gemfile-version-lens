import {
  CodeLensProvider,
  EventEmitter,
  Event,
  workspace,
  CodeLens,
  window,
  Range,
  TextDocument,
  CancellationToken,
  Disposable,
} from "vscode";
import * as path from "node:path";
import Cache from "./cache";
import { parseGemDeclarations } from "./gemfile_parser";
import { GemVersionsOutput } from "./types";
import { buildGemCodeLenses } from "./code_lens_builder";
import { Reporter } from "./reporter";
import { VersionsRunner } from "./versions_runner";
import { RefreshScheduler } from "./refresh_scheduler";

// Re-exported for backwards compatibility; the canonical home is ./types.
export type { GemSpec, GemVersionsOutput } from "./types";

// Coalesce bursts of save/config-change refreshes (e.g. auto-save) into one re-run.
const REFRESH_DEBOUNCE_MS = 1500;

// Registers the CodeLens provider and wires together the focused collaborators:
// version fetching (VersionsRunner), user output (Reporter), debounced
// invalidation (RefreshScheduler), and lens construction (code_lens_builder).
class RubyGemsCodeLensProvider implements CodeLensProvider, Disposable {
  private _onDidChangeCodeLenses: EventEmitter<void> = new EventEmitter<void>();
  public readonly onDidChangeCodeLenses: Event<void> = this._onDidChangeCodeLenses.event;

  public readonly cache: Cache;

  // Extension root (from context.extensionPath), used to locate bin/versions.rb
  // independent of the compiled output layout.
  private readonly extensionPath: string;

  private readonly reporter: Reporter;
  private readonly runner: VersionsRunner;
  private readonly refresh: RefreshScheduler;

  // Resources to tear down on dispose (listeners, output channel, emitter).
  private readonly disposables: Disposable[] = [];

  constructor(cache: Cache, extensionPath: string) {
    this.cache = cache;
    this.extensionPath = extensionPath;

    const output = window.createOutputChannel("Gemfile Version Lens");
    this.reporter = new Reporter(output);
    this.runner = new VersionsRunner(this.reporter);
    this.refresh = new RefreshScheduler(
      {
        invalidateAll: () => {
          this.runner.cancelAll();
          this.cache.clear();
        },
        invalidateOne: (fsPath) => {
          this.runner.cancelInflight(fsPath);
          this.cache.delete(fsPath);
        },
        onRefresh: () => this._onDidChangeCodeLenses.fire(),
      },
      REFRESH_DEBOUNCE_MS,
    );

    this.disposables.push(output, this._onDidChangeCodeLenses);

    // Watch for changes to Gemfile (debounced to coalesce bursts of saves).
    this.disposables.push(
      workspace.onDidSaveTextDocument((doc) => {
        if (this.isGemfile(doc)) {
          this.refresh.schedule(doc.uri.fsPath);
        }
      }),
    );

    // Re-run the version check when the extension settings change.
    this.disposables.push(
      workspace.onDidChangeConfiguration((event) => {
        if (event.affectsConfiguration("gemfileVersionLens")) {
          this.refresh.schedule();
        }
      }),
    );
  }

  public dispose(): void {
    this.refresh.dispose();
    this.runner.cancelAll();
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

    const gemVersions = await this.getGemVersions(document);
    if (!gemVersions) {
      return [];
    }

    this.cache.set(document.uri.fsPath, gemVersions);

    const codeLenses: CodeLens[] = [];
    for (const declaration of parseGemDeclarations(document.getText())) {
      const gemInfo = gemVersions.gems[declaration.name];
      if (!gemInfo) {
        continue; // Skip if gem info is not available.
      }

      const range = new Range(
        document.positionAt(declaration.index),
        document.positionAt(declaration.index + declaration.length),
      );

      codeLenses.push(...buildGemCodeLenses(gemInfo, range));
    }

    return codeLenses;
  }

  private getGemVersions(document: TextDocument): Promise<GemVersionsOutput | null> {
    const fsPath = document.uri.fsPath;

    const cachedVersions = this.cache.get(fsPath);
    if (cachedVersions) {
      return Promise.resolve(cachedVersions);
    }

    const config = workspace.getConfiguration("gemfileVersionLens");
    const updateLevel = config.get<string>("updateLevel", "all");
    const rubyPath = config.get<string>("rubyPath", "ruby");
    const timeout = config.get<number>("timeout", 60000);

    // Only show the status message for a genuinely new spawn, not a shared
    // in-flight run or a cache hit, and keep it up for exactly the run's length.
    const alreadyRunning = this.runner.hasInflight(fsPath);

    const promise = this.runner.run(fsPath, {
      scriptPath: path.join(this.extensionPath, "bin", "versions.rb"),
      rubyPath,
      cwd: path.dirname(fsPath),
      env: { ...process.env, GVL_UPDATE_LEVEL: updateLevel },
      timeout,
      updateLevel,
    });

    if (!alreadyRunning) {
      window.setStatusBarMessage("Fetching gem versions...", promise);
    }

    return promise;
  }
}

export default RubyGemsCodeLensProvider;
