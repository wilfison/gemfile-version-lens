import * as assert from "assert";
import { Uri, languages } from "vscode";

import { AuditService, AuditServiceDeps, AuditConfig } from "../audit_service";
import { AuditOutput } from "../audit_types";
import { AuditRunOptions } from "../audit_runner";
import type { AuditRunner } from "../audit_runner";
import type { Reporter } from "../reporter";
import { Notifier } from "../reporter";

class FakeReporter {
  logs: string[] = [];
  log(message: string): void {
    this.logs.push(message);
  }
}

class FakeNotifier implements Notifier {
  warningCalls: Array<{ message: string; actions: string[] }> = [];
  errorCalls: string[] = [];
  constructor(private readonly choice: string | undefined = undefined) {}
  showError(message: string): Thenable<string | undefined> {
    this.errorCalls.push(message);
    return Promise.resolve(this.choice);
  }
  showWarning(message: string, ...actions: string[]): Thenable<string | undefined> {
    this.warningCalls.push({ message, actions });
    return Promise.resolve(this.choice);
  }
}

class FakeRunner {
  calls: Array<{ fsPath: string; options: AuditRunOptions }> = [];
  queue: Array<AuditOutput | null> = [];
  fallback: AuditOutput | null = null;
  cancelled = 0;
  run(fsPath: string, options: AuditRunOptions): Promise<AuditOutput | null> {
    this.calls.push({ fsPath, options });
    return Promise.resolve(this.queue.length > 0 ? this.queue.shift()! : this.fallback);
  }
  cancelAll(): void {
    this.cancelled += 1;
  }
}

const LOCKFILE_TEXT = ["GEM", "  remote: https://rubygems.org/", "  specs:", "    rack (2.1.0)"].join(
  "\n",
);
const GEMFILE_TEXT = ['source "https://rubygems.org"', 'gem "rack"'].join("\n");

function cleanOutput(): AuditOutput {
  return { available: true, advisories: [], insecureSources: [], errors: [] };
}

function vulnerableOutput(): AuditOutput {
  return {
    available: true,
    advisories: [
      {
        gem: "rack",
        version: "2.1.0",
        id: "CVE-2020-8161",
        url: "https://example.com/cve",
        title: "Directory traversal",
        criticality: "high",
        patchedVersions: [">= 2.2.0"],
        unaffectedVersions: [],
      },
    ],
    insecureSources: [],
    errors: [],
  };
}

let counter = 0;
let active: AuditService | undefined;

function makeService(config: Partial<AuditConfig>, runner: FakeRunner, notifier: FakeNotifier) {
  counter += 1;
  const reporter = new FakeReporter();
  const deps: Partial<AuditServiceDeps> = {
    findLockfiles: () =>
      Promise.resolve([Uri.file("/a/Gemfile.lock"), Uri.file("/b/Gemfile.lock")]),
    readText: async (uri) => {
      if (uri.fsPath.endsWith("Gemfile.lock")) {
        return LOCKFILE_TEXT;
      }
      if (uri.fsPath.endsWith("Gemfile")) {
        return GEMFILE_TEXT;
      }
      throw new Error("no such file");
    },
    readConfig: () => ({ enabled: true, rubyPath: "ruby", timeout: 60000, ...config }),
    notifier,
    commandId: `test.gemfileVersionLens.showAuditReport.${counter}`,
    scheme: `test-gemfile-audit-${counter}`,
  };
  const service = new AuditService(
    "/ext",
    reporter as unknown as Reporter,
    runner as unknown as AuditRunner,
    deps,
  );
  active = service;
  return { service, reporter };
}

function flushMicrotasks(): Promise<void> {
  return new Promise((resolve) => setImmediate(resolve));
}

suite("AuditService", () => {
  teardown(() => {
    active?.dispose();
    active = undefined;
  });

  test("scans each lockfile once across repeated passes", async () => {
    const runner = new FakeRunner();
    runner.fallback = cleanOutput();
    const { service } = makeService({}, runner, new FakeNotifier());

    await service.scanWorkspace();
    await service.scanWorkspace();

    assert.strictEqual(runner.calls.length, 2, "two lockfiles, scanned once each");
  });

  test("requests a db update only on the first scan of the session", async () => {
    const runner = new FakeRunner();
    runner.fallback = cleanOutput();
    const { service } = makeService({}, runner, new FakeNotifier());

    await service.scanWorkspace();

    assert.strictEqual(runner.calls[0].options.env.GVL_AUDIT_UPDATE, "1");
    assert.strictEqual(runner.calls[1].options.env.GVL_AUDIT_UPDATE, undefined);
  });

  test("does not run when auditing is disabled", async () => {
    const runner = new FakeRunner();
    const { service } = makeService({ enabled: false }, runner, new FakeNotifier());

    await service.scanWorkspace();

    assert.strictEqual(runner.calls.length, 0);
  });

  test("logs the install hint once when bundler-audit is unavailable", async () => {
    const runner = new FakeRunner();
    runner.fallback = { available: false, advisories: [], insecureSources: [], errors: [] };
    const notifier = new FakeNotifier();
    const { service, reporter } = makeService({}, runner, notifier);

    await service.scanWorkspace();

    const hints = reporter.logs.filter((l) => /gem install bundler-audit/.test(l));
    assert.strictEqual(hints.length, 1, "hint logged exactly once for two lockfiles");
    assert.strictEqual(notifier.warningCalls.length, 0, "no toast for a missing gem");
  });

  test("stays silent and logs when there are no vulnerabilities", async () => {
    const runner = new FakeRunner();
    runner.fallback = cleanOutput();
    const notifier = new FakeNotifier();
    const { service, reporter } = makeService({}, runner, notifier);

    await service.scanWorkspace();

    assert.strictEqual(notifier.warningCalls.length, 0);
    assert.ok(reporter.logs.some((l) => /no known vulnerabilities/.test(l)));
  });

  test("shows one toast offering the report when vulnerabilities are found", async () => {
    const runner = new FakeRunner();
    runner.queue = [vulnerableOutput(), cleanOutput()];
    const notifier = new FakeNotifier();
    const { service } = makeService({}, runner, notifier);

    await service.scanWorkspace();

    assert.strictEqual(notifier.warningCalls.length, 1);
    assert.match(notifier.warningCalls[0].message, /1 known vulnerability/);
    assert.ok(notifier.warningCalls[0].actions.includes("View Report"));
  });

  test("does not re-toast the same findings on a later pass", async () => {
    const runner = new FakeRunner();
    runner.queue = [vulnerableOutput(), cleanOutput()];
    const notifier = new FakeNotifier();
    const { service } = makeService({}, runner, notifier);

    await service.scanWorkspace();
    await service.scanWorkspace(); // no new scan, findings unchanged

    assert.strictEqual(notifier.warningCalls.length, 1, "unchanged findings must not re-toast");
  });

  test("publishes diagnostics on the lockfile and the Gemfile", async () => {
    const runner = new FakeRunner();
    runner.queue = [vulnerableOutput(), cleanOutput()];
    const { service } = makeService({}, runner, new FakeNotifier());

    await service.scanWorkspace();
    await flushMicrotasks();

    const lockDiags = languages.getDiagnostics(Uri.file("/a/Gemfile.lock"));
    const gemfileDiags = languages.getDiagnostics(Uri.file("/a/Gemfile"));
    assert.ok(
      lockDiags.some((d) => /Directory traversal/.test(d.message)),
      "lockfile diagnostic present",
    );
    assert.ok(
      gemfileDiags.some((d) => /Directory traversal/.test(d.message)),
      "gemfile diagnostic present",
    );
  });

  test("renders the report markdown from the latest results", async () => {
    const runner = new FakeRunner();
    runner.queue = [vulnerableOutput(), cleanOutput()];
    const { service } = makeService({}, runner, new FakeNotifier());

    await service.scanWorkspace();
    const markdown = service.provideTextDocumentContent();

    assert.match(markdown, /# Bundler Audit Report/);
    assert.match(markdown, /### rack \(2\.1\.0\)/);
  });
});
