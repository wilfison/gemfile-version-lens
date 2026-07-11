import * as assert from "assert";
import * as cp from "node:child_process";

import { AuditRunner, AuditRunOptions } from "../audit_runner";
import { ExecFileFn } from "../versions_runner";
import type { Reporter } from "../reporter";

// Records reporter interactions. The audit runner must only ever `log`; the
// toast-raising methods are here so a test can assert they are never called.
class FakeReporter {
  logs: string[] = [];
  runErrors: string[] = [];
  reportedErrors: string[][] = [];
  successes = 0;
  log(message: string): void {
    this.logs.push(message);
  }
  noteRunSuccess(): void {
    this.successes += 1;
  }
  reportRunError(message: string): void {
    this.runErrors.push(message);
  }
  reportErrors(errors: string[]): void {
    this.reportedErrors.push(errors);
  }
}

class FakeChild {
  killed = false;
  kill(): boolean {
    this.killed = true;
    return true;
  }
}

function makeExec() {
  const calls: Array<{ file: string; args: readonly string[] }> = [];
  const runs: Array<{
    child: FakeChild;
    cb: (error: cp.ExecFileException | null, stdout: string, stderr: string) => void;
  }> = [];

  const execFile: ExecFileFn = (file, args, _options, callback) => {
    const child = new FakeChild();
    calls.push({ file, args });
    runs.push({ child, cb: callback });
    return child as unknown as cp.ChildProcess;
  };

  return { execFile, calls, runs };
}

function makeOptions(overrides: Partial<AuditRunOptions> = {}): AuditRunOptions {
  return {
    scriptPath: "/ext/bin/audit.rb",
    rubyPath: "ruby",
    cwd: "/project",
    env: {} as NodeJS.ProcessEnv,
    timeout: 60000,
    ...overrides,
  };
}

function makeRunner() {
  const reporter = new FakeReporter();
  const exec = makeExec();
  const runner = new AuditRunner(reporter as unknown as Reporter, exec.execFile);
  return { reporter, exec, runner };
}

const LOCKFILE = "/project/Gemfile.lock";
const VALID_OUTPUT = JSON.stringify({
  available: true,
  advisories: [{ gem: "rack", version: "2.1.0", id: "CVE-1", criticality: "high" }],
  insecureSources: [],
  errors: [],
});

suite("AuditRunner", () => {
  test("deduplicates concurrent runs for the same lockfile", () => {
    const { exec, runner } = makeRunner();
    const first = runner.run(LOCKFILE, makeOptions());
    const second = runner.run(LOCKFILE, makeOptions());
    assert.strictEqual(exec.calls.length, 1);
    assert.strictEqual(first, second);
  });

  test("passes the ruby path and script path through to execFile", () => {
    const { exec, runner } = makeRunner();
    runner.run(LOCKFILE, makeOptions({ rubyPath: "/opt/ruby" }));
    assert.strictEqual(exec.calls[0].file, "/opt/ruby");
    assert.deepStrictEqual(exec.calls[0].args, ["/ext/bin/audit.rb"]);
  });

  test("resolves parsed output on a clean run", async () => {
    const { exec, runner } = makeRunner();
    const promise = runner.run(LOCKFILE, makeOptions());
    exec.runs[0].cb(null, VALID_OUTPUT, "");
    const result = await promise;
    assert.strictEqual(result?.available, true);
    assert.strictEqual(result?.advisories[0].gem, "rack");
  });

  test("logs a parse failure without raising a toast", async () => {
    const { reporter, exec, runner } = makeRunner();
    const promise = runner.run(LOCKFILE, makeOptions());
    exec.runs[0].cb(null, "not json", "");
    const result = await promise;
    assert.strictEqual(result, null);
    assert.ok(reporter.logs.some((l) => /Failed to parse output from audit\.rb/.test(l)));
    assert.strictEqual(reporter.runErrors.length, 0, "audit failures must not toast");
  });

  test("logs a missing-ruby error without raising a toast", async () => {
    const { reporter, exec, runner } = makeRunner();
    const promise = runner.run(LOCKFILE, makeOptions());
    exec.runs[0].cb({ code: "ENOENT" } as cp.ExecFileException, "", "");
    await promise;
    assert.ok(reporter.logs.some((l) => /Could not find the Ruby executable/.test(l)));
    assert.strictEqual(reporter.runErrors.length, 0);
  });

  test("logs the advisory-db hint on a timeout", async () => {
    const { reporter, exec, runner } = makeRunner();
    const promise = runner.run(LOCKFILE, makeOptions({ timeout: 30000 }));
    exec.runs[0].cb({ killed: true } as cp.ExecFileException, "", "");
    await promise;
    assert.ok(reporter.logs.some((l) => /audit\.rb timed out after 30s/.test(l)));
    assert.ok(reporter.logs.some((l) => /downloads the advisory database/.test(l)));
    assert.strictEqual(reporter.runErrors.length, 0);
  });

  test("cancelAll kills in-flight runs silently", async () => {
    const { reporter, exec, runner } = makeRunner();
    const promise = runner.run(LOCKFILE, makeOptions());

    runner.cancelAll();
    assert.strictEqual(exec.runs[0].child.killed, true);

    exec.runs[0].cb({ killed: true } as cp.ExecFileException, "", "");
    const result = await promise;
    assert.strictEqual(result, null);
    // No failure message logged for a deliberate dispose kill.
    assert.ok(!reporter.logs.some((l) => /timed out/.test(l)));
  });
});
