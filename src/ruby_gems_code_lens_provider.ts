import * as vscode from "vscode";
import * as path from "node:path";
import * as cp from "node:child_process";

// Define types for the gem specification data
interface GemSpec {
  installed: string;
  newest?: string;
}

// Type for the result of executing versions.rb
interface GemVersionsOutput {
  errors: string[];
  [gemName: string]: GemSpec | string[];
}

class RubyGemsCodeLensProvider implements vscode.CodeLensProvider {
  private _onDidChangeCodeLenses: vscode.EventEmitter<void> = new vscode.EventEmitter<void>();
  public readonly onDidChangeCodeLenses: vscode.Event<void> = this._onDidChangeCodeLenses.event;

  constructor() {
    // Watch for changes to Gemfile
    vscode.workspace.onDidSaveTextDocument((doc) => {
      if (this.isGemfile(doc)) {
        this._onDidChangeCodeLenses.fire();
      }
    });
  }

  private isGemfile(document: vscode.TextDocument): boolean {
    return path.basename(document.fileName) === "Gemfile";
  }

  public async provideCodeLenses(document: vscode.TextDocument): Promise<vscode.CodeLens[]> {
    if (!this.isGemfile(document)) {
      return [];
    }

    const codeLenses: vscode.CodeLens[] = [];

    vscode.window.setStatusBarMessage("Fetching gem versions...", 2000);
    const gemVersions = await this.getGemVersions(document);

    if (!gemVersions) {
      return [];
    }

    // Regular expression to match gem declarations in Gemfile
    const gemRegex = /^[\t ]*gem\s+(['"])(.*?)\1(?:\s*,\s*(['"])(.+?)\3)?/gm;
    const text = document.getText();
    let match;

    while ((match = gemRegex.exec(text)) !== null) {
      const gemName = match[2];
      const range = new vscode.Range(
        document.positionAt(match.index),
        document.positionAt(match.index + match[0].length)
      );

      const gemInfo = gemVersions[gemName];
      if (gemInfo && typeof gemInfo !== "string" && !Array.isArray(gemInfo)) {
        let title: string;

        if (gemInfo.newest && gemInfo.installed !== gemInfo.newest) {
          title = `Current: ${gemInfo.installed} 🟠 Newest: ${gemInfo.newest}`;
        } else {
          title = `Current: ${gemInfo.installed}`;
        }

        codeLenses.push(
          new vscode.CodeLens(range, {
            title,
            command: "",
          })
        );
      }
    }

    return codeLenses;
  }

  private async getGemVersions(document: vscode.TextDocument): Promise<GemVersionsOutput | null> {
    const extensionPath = path.dirname(__dirname);

    const scriptPath = path.join(extensionPath, "bin", "versions.rb");

    return new Promise<GemVersionsOutput | null>((resolve) => {
      try {
        // Run script in the directory of the Gemfile
        const cwd = path.dirname(document.uri.fsPath);

        cp.exec(`ruby "${scriptPath}"`, { cwd }, (error, stdout, stderr) => {
          if (error) {
            vscode.window.showErrorMessage(`Failed to run versions.rb: ${error.message}`);
            resolve(null);
            return;
          }

          try {
            const parsedOutput = JSON.parse(stdout) as GemVersionsOutput;
            resolve(parsedOutput);
          } catch (e) {
            vscode.window.showErrorMessage(`Failed to parse output from versions.rb: ${e}`);
            resolve(null);
          }
        });
      } catch (e) {
        vscode.window.showErrorMessage(`Error running versions.rb: ${e}`);
        resolve(null);
      }
    });
  }
}

export default RubyGemsCodeLensProvider;
