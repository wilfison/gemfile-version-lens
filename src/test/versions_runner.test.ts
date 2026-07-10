import * as assert from "assert";
import * as cp from "node:child_process";

import { VersionsRunner, ExecFileFn, RunOptions } from "../versions_runner";
import type { Reporter } from "../reporter";

// Records every reporter interaction so tests can assert on them.
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

// A fake execFile that never calls back on its own; the test drives completion
// via `complete`, mirroring the always-async nature of a real child process.
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

function makeOptions(overrides: Partial<RunOptions> = {}): RunOptions {
  return {
    scriptPath: "/ext/bin/versions.rb",
    rubyPath: "ruby",
    cwd: "/project",
    env: { GVL_UPDATE_LEVEL: "all" } as NodeJS.ProcessEnv,
    timeout: 60000,
    updateLevel: "all",
    ...overrides,
  };
}

function makeRunner() {
  const reporter = new FakeReporter();
  const exec = makeExec();
  const runner = new VersionsRunner(reporter as unknown as Reporter, exec.execFile);
  return { reporter, exec, runner };
}

const GEMFILE = "/project/Gemfile";
const VALID_OUTPUT = JSON.stringify({ gems: { rails: { installed: "8.0.0" } }, errors: [] });

suite("VersionsRunner", () => {
  test("deduplicates concurrent runs for the same Gemfile", () => {
    const { exec, runner } = makeRunner();

    const first = runner.run(GEMFILE, makeOptions());
    const second = runner.run(GEMFILE, makeOptions());

    assert.strictEqual(exec.calls.length, 1, "should spawn only one process");
    assert.strictEqual(first, second, "concurrent callers share one promise");
    assert.ok(runner.hasInflight(GEMFILE));
  });

  test("logs the run once for a deduplicated pair", () => {
    const { reporter, runner } = makeRunner();

    runner.run(GEMFILE, makeOptions());
    runner.run(GEMFILE, makeOptions());

    const runningLines = reporter.logs.filter((line) => line.startsWith("Running versions.rb"));
    assert.strictEqual(runningLines.length, 1);
  });

  test("passes the ruby path and script path through to execFile", () => {
    const { exec, runner } = makeRunner();
    runner.run(GEMFILE, makeOptions({ rubyPath: "/opt/ruby", scriptPath: "/ext/bin/versions.rb" }));
    assert.strictEqual(exec.calls[0].file, "/opt/ruby");
    assert.deepStrictEqual(exec.calls[0].args, ["/ext/bin/versions.rb"]);
  });

  test("resolves parsed output and reports success on a clean run", async () => {
    const { reporter, exec, runner } = makeRunner();
    const promise = runner.run(GEMFILE, makeOptions());

    exec.runs[0].cb(null, VALID_OUTPUT, "");
    const result = await promise;

    assert.deepStrictEqual(result?.gems.rails, { installed: "8.0.0" });
    assert.strictEqual(reporter.successes, 1);
    assert.strictEqual(reporter.reportedErrors.length, 1);
    assert.strictEqual(reporter.runErrors.length, 0);
    assert.strictEqual(runner.hasInflight(GEMFILE), false, "slot released after completion");
  });

  test("surfaces a parse failure as a run error and resolves null", async () => {
    const { reporter, exec, runner } = makeRunner();
    const promise = runner.run(GEMFILE, makeOptions());

    exec.runs[0].cb(null, "not json", "");
    const result = await promise;

    assert.strictEqual(result, null);
    assert.strictEqual(reporter.runErrors.length, 1);
    assert.match(reporter.runErrors[0], /Failed to parse output/);
  });

  test("reports a missing-ruby error via describeRunError", async () => {
    const { reporter, exec, runner } = makeRunner();
    const promise = runner.run(GEMFILE, makeOptions());

    exec.runs[0].cb({ code: "ENOENT" } as cp.ExecFileException, "", "");
    const result = await promise;

    assert.strictEqual(result, null);
    assert.match(reporter.runErrors[0], /Could not find the Ruby executable/);
  });

  test("logs stderr before reporting a failure", async () => {
    const { reporter, exec, runner } = makeRunner();
    const promise = runner.run(GEMFILE, makeOptions());

    exec.runs[0].cb({ message: "boom" } as cp.ExecFileException, "", "some stderr");
    await promise;

    assert.ok(reporter.logs.includes("some stderr"));
    assert.match(reporter.runErrors[0], /Failed to run versions\.rb: boom/);
  });

  test("treats a deliberate cancelInflight kill as a silent non-error", async () => {
    const { reporter, exec, runner } = makeRunner();
    const promise = runner.run(GEMFILE, makeOptions());

    runner.cancelInflight(GEMFILE);
    assert.strictEqual(exec.runs[0].child.killed, true);
    assert.strictEqual(runner.hasInflight(GEMFILE), false);

    // The killed process fires its callback afterwards, as a real one would.
    exec.runs[0].cb({ killed: true } as cp.ExecFileException, "", "");
    const result = await promise;

    assert.strictEqual(result, null);
    assert.strictEqual(reporter.runErrors.length, 0, "a deliberate kill must not surface");
  });

  test("cancelAll kills every in-flight run", () => {
    const { exec, runner } = makeRunner();
    runner.run("/a/Gemfile", makeOptions());
    runner.run("/b/Gemfile", makeOptions());

    runner.cancelAll();

    assert.ok(exec.runs[0].child.killed);
    assert.ok(exec.runs[1].child.killed);
    assert.strictEqual(runner.hasInflight("/a/Gemfile"), false);
    assert.strictEqual(runner.hasInflight("/b/Gemfile"), false);
  });
});
