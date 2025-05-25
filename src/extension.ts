// The module 'vscode' contains the VS Code extensibility API
// Import the module and reference it with the alias vscode in your code below
import * as vscode from "vscode";

import RubyGemsCodeLensProvider from "./ruby_gems_code_lens_provider";

// This method is called when your extension is activated
export function activate(context: vscode.ExtensionContext) {
  console.log('"gemfile-version-lens" is now active!');

  const codeLensProvider = new RubyGemsCodeLensProvider();
  const selector: vscode.DocumentFilter[] = [{ language: "ruby", pattern: "**/Gemfile" }];

  context.subscriptions.push(vscode.languages.registerCodeLensProvider(selector, codeLensProvider));
}

// This method is called when your extension is deactivated
export function deactivate() {}
