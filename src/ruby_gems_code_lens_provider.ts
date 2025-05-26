import {
  CodeLensProvider,
  EventEmitter,
  Event,
  workspace,
  CodeLens,
  window,
  Range,
  TextDocument,
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
  [gemName: string]: GemSpec;
}

class RubyGemsCodeLensProvider implements CodeLensProvider {
  private _onDidChangeCodeLenses: EventEmitter<void> = new EventEmitter<void>();
  public readonly onDidChangeCodeLenses: Event<void> = this._onDidChangeCodeLenses.event;

  public readonly cache: Cache;

  constructor(cache: Cache) {
    this.cache = cache;

    // Watch for changes to Gemfile
    workspace.onDidSaveTextDocument((doc) => {
      if (this.isGemfile(doc)) {
        this._onDidChangeCodeLenses.fire();
      }
    });
  }

  private isGemfile(document: TextDocument): boolean {
    return path.basename(document.fileName) === "Gemfile";
  }

  public async provideCodeLenses(document: TextDocument): Promise<CodeLens[]> {
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
        document.positionAt(match.index + match[0].length)
      );

      const gemInfo = gemVersions[gemName];
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
          })
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

  private async getGemVersions(document: TextDocument): Promise<GemVersionsOutput | null> {
    const cachedVersions = this.cache.get(document.uri.fsPath);

    if (cachedVersions) {
      return cachedVersions;
    }

    const extensionPath = path.dirname(__dirname);
    const scriptPath = path.join(extensionPath, "bin", "versions.rb");

    return new Promise<GemVersionsOutput | null>((resolve) => {
      try {
        // Run script in the directory of the Gemfile
        const cwd = path.dirname(document.uri.fsPath);

        cp.exec(`ruby "${scriptPath}"`, { cwd }, (error, stdout, stderr) => {
          if (error) {
            window.showErrorMessage(`Failed to run versions.rb: ${error.message}`);
            resolve(null);
            return;
          }

          try {
            const parsedOutput = JSON.parse(stdout) as GemVersionsOutput;
            resolve(parsedOutput);
          } catch (e) {
            window.showErrorMessage(`Failed to parse output from versions.rb: ${e}`);
            resolve(null);
          }
        });
      } catch (e) {
        window.showErrorMessage(`Error running versions.rb: ${e}`);
        resolve(null);
      }
    });
  }
}

export default RubyGemsCodeLensProvider;
