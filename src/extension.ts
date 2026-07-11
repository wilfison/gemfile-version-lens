// The module 'vscode' contains the VS Code extensibility API
// Import the module and reference it with the alias vscode in your code below
import * as vscode from "vscode";

import Cache from "./cache";
import RubyGemsCodeLensProvider from "./ruby_gems_code_lens_provider";
import { Reporter } from "./reporter";
import { AuditRunner } from "./audit_runner";
import { AuditService } from "./audit_service";

// This method is called when your extension is activated
export function activate(context: vscode.ExtensionContext) {
  console.log('"gemfile-version-lens" is now active!');

  const cache = new Cache();

  // One shared OutputChannel + Reporter for both pipelines (CodeLens versions
  // and the vulnerability scan), so all extension output lands in one place.
  const output = vscode.window.createOutputChannel("Gemfile Version Lens");
  const reporter = new Reporter(output);

  const codeLensProvider = new RubyGemsCodeLensProvider(cache, context.extensionPath, reporter);
  const selector: vscode.DocumentFilter[] = [{ language: "ruby", pattern: "**/Gemfile" }];

  // The vulnerability-scan pipeline runs independently of the CodeLens one (its
  // own child process, bin/audit.rb) but shares the reporter/output channel.
  const auditService = new AuditService(context.extensionPath, reporter, new AuditRunner(reporter));

  context.subscriptions.push(
    output,
    codeLensProvider,
    vscode.languages.registerCodeLensProvider(selector, codeLensProvider),
    auditService,
  );

  void auditService.scanWorkspace();
}

// This method is called when your extension is deactivated
export function deactivate() {}
