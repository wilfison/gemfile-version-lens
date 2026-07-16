import {
  commands,
  languages,
  workspace,
  Disposable,
  DiagnosticCollection,
  Event,
  EventEmitter,
  FileSystemWatcher,
  TextDocumentContentProvider,
  Uri,
} from "vscode";
import * as path from "node:path";

import { AuditOutput } from "./audit_types";
import { AuditRunner } from "./audit_runner";
import { Reporter } from "./reporter";
import { Notifier, windowNotifier } from "./reporter";
import { buildGemfileDiagnostics, buildLockfileDiagnostics } from "./audit_diagnostics";
import { buildAuditReportMarkdown, buildToastMessage, LockfileResult } from "./audit_report";

export const AUDIT_SCHEME = "gemfile-version-lens-audit";
export const SHOW_REPORT_COMMAND = "gemfileVersionLens.showAuditReport";
const REPORT_PATH = "/Bundler Audit Report.md";
const RESCAN_DEBOUNCE_MS = 1500;

// Directory names whose nested Gemfile.lock files are never audited. ruby-lsp and
// haml-lsp each spin up their own uncommitted bundle in a dot-dir; vendored gems
// and JS deps carry their own lockfiles too. The recursive search still finds
// legitimately nested projects (e.g. a monorepo's frontend/backend subdirs).
const EXCLUDED_LOCKFILE_DIRS = [".ruby-lsp", ".haml-lsp", "node_modules", "vendor"];

// The same exclusion expressed as a findFiles exclude glob, so the initial scan
// never even descends into these directories.
const LOCKFILE_EXCLUDE_GLOB = `{${EXCLUDED_LOCKFILE_DIRS.map((dir) => `**/${dir}/**`).join(",")}}`;

// True when a lockfile lives under an excluded directory. The single gate for
// both the initial scan and watcher-driven rescans (the watcher glob can't
// carry an exclude, so it must be filtered here).
export function isExcludedLockfile(fsPath: string): boolean {
  return fsPath.split(/[\\/]/).some((segment) => EXCLUDED_LOCKFILE_DIRS.includes(segment));
}

// The bits of configuration the audit needs, read together so tests can inject
// them without a real workspace configuration.
export interface AuditConfig {
  enabled: boolean;
  rubyPath: string;
  timeout: number;
}

// Seams onto vscode/config so the coordinator's own logic (scan-once, hint-once,
// toast-on-new-findings, db-update-once) is unit-testable. Defaults are the real
// vscode-backed implementations; tests pass fakes.
export interface AuditServiceDeps {
  findLockfiles: () => Promise<Uri[]>;
  readText: (uri: Uri) => Promise<string>;
  readConfig: () => AuditConfig;
  notifier: Notifier;
  commandId: string;
  scheme: string;
}

// Coordinates the vulnerability-scan pipeline: runs bin/audit.rb once per
// Gemfile.lock (re-running on lockfile change), publishes Diagnostics to the
// Problems panel, offers a rendered markdown report, and shows a single toast
// when new vulnerabilities appear.
export class AuditService implements Disposable, TextDocumentContentProvider {
  private readonly deps: AuditServiceDeps;
  private readonly reportUri: Uri;
  private readonly collection: DiagnosticCollection;
  private readonly onDidChangeEmitter = new EventEmitter<Uri>();
  public readonly onDidChange: Event<Uri> = this.onDidChangeEmitter.event;

  // Latest scan output per lockfile fsPath, for the report and toast.
  private readonly results = new Map<string, AuditOutput>();
  // Lockfiles already scanned in the initial/folder-add passes (the once-gate).
  private readonly scanned = new Set<string>();
  // Finding keys already surfaced in a toast, so a re-scan only nags on growth.
  private readonly toastedKeys = new Set<string>();
  // Pending debounced re-scans keyed by lockfile fsPath.
  private readonly pendingRescans = new Map<string, ReturnType<typeof setTimeout>>();

  // The advisory db is refreshed once per session, on the first scan.
  private dbUpdateDone = false;
  // The "install bundler-audit" hint is logged at most once.
  private hintLogged = false;

  private readonly disposables: Disposable[] = [];

  constructor(
    private readonly extensionPath: string,
    private readonly reporter: Reporter,
    private readonly runner: AuditRunner,
    deps: Partial<AuditServiceDeps> = {},
  ) {
    this.deps = {
      findLockfiles: defaultFindLockfiles,
      readText: defaultReadText,
      readConfig: defaultReadConfig,
      notifier: windowNotifier,
      commandId: SHOW_REPORT_COMMAND,
      scheme: AUDIT_SCHEME,
      ...deps,
    };
    this.reportUri = Uri.parse(`${this.deps.scheme}:${REPORT_PATH}`);
    this.collection = languages.createDiagnosticCollection("bundler-audit");

    this.disposables.push(
      this.collection,
      this.onDidChangeEmitter,
      workspace.registerTextDocumentContentProvider(this.deps.scheme, this),
      commands.registerCommand(this.deps.commandId, () => this.showReport()),
    );

    this.registerWatchers();
  }

  // Scan every Gemfile.lock in the workspace that hasn't been scanned yet, then
  // surface a single toast if new findings appeared. Safe to call repeatedly.
  async scanWorkspace(): Promise<void> {
    if (!this.deps.readConfig().enabled) {
      return;
    }

    const lockfiles = await this.deps.findLockfiles();
    for (const uri of lockfiles) {
      if (isExcludedLockfile(uri.fsPath) || this.scanned.has(uri.fsPath)) {
        continue;
      }
      this.scanned.add(uri.fsPath);
      await this.scanLockfile(uri);
    }

    this.maybeShowToast();
  }

  // Open (or refresh) the rendered markdown report.
  async showReport(): Promise<void> {
    this.onDidChangeEmitter.fire(this.reportUri);
    await commands.executeCommand("markdown.showPreview", this.reportUri);
  }

  provideTextDocumentContent(): string {
    const results: LockfileResult[] = [...this.results.entries()].map(([lockfilePath, output]) => ({
      lockfilePath,
      output,
    }));
    return buildAuditReportMarkdown(results, new Date());
  }

  dispose(): void {
    for (const timer of this.pendingRescans.values()) {
      clearTimeout(timer);
    }
    this.pendingRescans.clear();
    this.runner.cancelAll();
    for (const disposable of this.disposables) {
      disposable.dispose();
    }
    this.disposables.length = 0;
  }

  // Run audit.rb for one lockfile and fold the result into diagnostics + report
  // state. Does not toast — the caller decides when to aggregate a toast.
  private async scanLockfile(uri: Uri): Promise<void> {
    const config = this.deps.readConfig();
    if (!config.enabled) {
      return;
    }

    const wantUpdate = !this.dbUpdateDone;
    this.dbUpdateDone = true;

    const env: NodeJS.ProcessEnv = { ...process.env };
    if (wantUpdate) {
      env.GVL_AUDIT_UPDATE = "1";
    }

    const output = await this.runner.run(uri.fsPath, {
      scriptPath: path.join(this.extensionPath, "bin", "audit.rb"),
      rubyPath: config.rubyPath,
      cwd: path.dirname(uri.fsPath),
      env,
      timeout: config.timeout,
    });

    if (!output) {
      return; // run failed; the runner already logged it
    }
    await this.handleOutput(uri, output, config.rubyPath);
  }

  private async handleOutput(uri: Uri, output: AuditOutput, rubyPath: string): Promise<void> {
    this.results.set(uri.fsPath, output);

    if (!output.available) {
      this.logInstallHintOnce(rubyPath);
      return;
    }

    for (const error of output.errors) {
      this.reporter.log(`Audit: ${error}`);
    }

    await this.publishDiagnostics(uri, output);

    if (output.advisories.length === 0 && output.insecureSources.length === 0) {
      this.reporter.log(`Audit: no known vulnerabilities in ${uri.fsPath}.`);
    }
  }

  private async publishDiagnostics(uri: Uri, output: AuditOutput): Promise<void> {
    try {
      const lockfileText = await this.deps.readText(uri);
      this.collection.set(
        uri,
        buildLockfileDiagnostics(output.advisories, output.insecureSources, lockfileText),
      );
    } catch (e) {
      this.reporter.log(`Audit: could not read ${uri.fsPath}: ${e}`);
      return;
    }

    const gemfileUri = Uri.file(path.join(path.dirname(uri.fsPath), "Gemfile"));
    try {
      const gemfileText = await this.deps.readText(gemfileUri);
      this.collection.set(gemfileUri, buildGemfileDiagnostics(output.advisories, gemfileText));
    } catch {
      // No sibling Gemfile (e.g. gems.rb or a lockfile-only project); the
      // lockfile diagnostics already cover every gem.
    }
  }

  // Show one aggregated toast, but only when a finding not seen before appears.
  private maybeShowToast(): void {
    const advisories = [...this.results.values()].flatMap((o) => o.advisories);
    const insecureSources = [...this.results.values()].flatMap((o) => o.insecureSources);
    if (advisories.length === 0 && insecureSources.length === 0) {
      return;
    }

    const keys = this.findingKeys();
    if (keys.every((key) => this.toastedKeys.has(key))) {
      return; // nothing new since the last toast
    }
    keys.forEach((key) => this.toastedKeys.add(key));

    this.deps.notifier
      .showWarning(buildToastMessage(advisories, insecureSources), "View Report")
      .then((choice) => {
        if (choice === "View Report") {
          void this.showReport();
        }
      });
  }

  private findingKeys(): string[] {
    const keys: string[] = [];
    for (const [fsPath, output] of this.results) {
      for (const advisory of output.advisories) {
        keys.push(`${fsPath}::${advisory.gem}::${advisory.id}`);
      }
      for (const source of output.insecureSources) {
        keys.push(`${fsPath}::source::${source}`);
      }
    }
    return keys;
  }

  private logInstallHintOnce(rubyPath: string): void {
    if (this.hintLogged) {
      return;
    }
    this.hintLogged = true;
    this.reporter.log(
      `bundler-audit is not installed for "${rubyPath}". Run "gem install bundler-audit" to enable vulnerability scanning.`,
    );
  }

  private registerWatchers(): void {
    const watcher: FileSystemWatcher = workspace.createFileSystemWatcher("**/Gemfile.lock");
    // Lockfiles are usually rewritten by `bundle install` outside the editor,
    // so watch the filesystem rather than onDidSaveTextDocument.
    watcher.onDidChange((uri) => this.scheduleRescan(uri));
    watcher.onDidCreate((uri) => this.scheduleRescan(uri));

    this.disposables.push(
      watcher,
      workspace.onDidChangeConfiguration((event) => {
        if (event.affectsConfiguration("gemfileVersionLens.audit")) {
          this.onAuditConfigChange();
        }
      }),
      workspace.onDidChangeWorkspaceFolders(() => void this.scanWorkspace()),
    );
  }

  private onAuditConfigChange(): void {
    if (this.deps.readConfig().enabled) {
      void this.scanWorkspace();
    } else {
      this.collection.clear();
    }
  }

  private scheduleRescan(uri: Uri): void {
    if (isExcludedLockfile(uri.fsPath)) {
      return;
    }
    const key = uri.fsPath;
    const existing = this.pendingRescans.get(key);
    if (existing) {
      clearTimeout(existing);
    }
    this.pendingRescans.set(
      key,
      setTimeout(() => {
        this.pendingRescans.delete(key);
        void this.rescanLockfile(uri);
      }, RESCAN_DEBOUNCE_MS),
    );
  }

  private async rescanLockfile(uri: Uri): Promise<void> {
    await this.scanLockfile(uri);
    this.maybeShowToast();
    this.onDidChangeEmitter.fire(this.reportUri);
  }
}

function defaultFindLockfiles(): Promise<Uri[]> {
  return Promise.resolve(workspace.findFiles("**/Gemfile.lock", LOCKFILE_EXCLUDE_GLOB));
}

async function defaultReadText(uri: Uri): Promise<string> {
  const bytes = await workspace.fs.readFile(uri);
  return Buffer.from(bytes).toString("utf8");
}

function defaultReadConfig(): AuditConfig {
  const config = workspace.getConfiguration("gemfileVersionLens");
  return {
    enabled: config.get<boolean>("audit.enabled", true),
    rubyPath: config.get<string>("rubyPath", "ruby"),
    timeout: config.get<number>("timeout", 60000),
  };
}
