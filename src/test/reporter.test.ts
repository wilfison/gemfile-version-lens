import * as assert from "assert";
import type { OutputChannel } from "vscode";

import { Reporter, Notifier } from "../reporter";

// Records what was written to the channel and whether it was shown.
class FakeOutput {
  lines: string[] = [];
  shownTimes = 0;
  appendLine(line: string): void {
    this.lines.push(line);
  }
  show(): void {
    this.shownTimes += 1;
  }
}

// Records notification calls and hands back a caller-chosen action.
class FakeNotifier implements Notifier {
  errorCalls: string[] = [];
  warningCalls: string[] = [];
  constructor(private readonly choice: string | undefined = undefined) {}
  showError(message: string): Thenable<string | undefined> {
    this.errorCalls.push(message);
    return Promise.resolve(this.choice);
  }
  showWarning(message: string): Thenable<string | undefined> {
    this.warningCalls.push(message);
    return Promise.resolve(this.choice);
  }
}

function makeReporter(choice?: string) {
  const output = new FakeOutput();
  const notifier = new FakeNotifier(choice);
  const reporter = new Reporter(output as unknown as OutputChannel, notifier);
  return { output, notifier, reporter };
}

// Let queued `.then` callbacks on resolved notifier promises run.
function flushMicrotasks(): Promise<void> {
  return new Promise((resolve) => setImmediate(resolve));
}

suite("Reporter", () => {
  test("log writes a line to the output channel", () => {
    const { output, reporter } = makeReporter();
    reporter.log("hello");
    assert.deepStrictEqual(output.lines, ["hello"]);
  });

  test("reportRunError logs every time but pops a toast only once", () => {
    const { output, notifier, reporter } = makeReporter();

    reporter.reportRunError("first");
    reporter.reportRunError("second");

    assert.deepStrictEqual(output.lines, ["first", "second"]);
    assert.strictEqual(notifier.errorCalls.length, 1);
    assert.match(notifier.errorCalls[0], /Gemfile Version Lens: first/);
  });

  test("noteRunSuccess re-arms the run-error toast", () => {
    const { notifier, reporter } = makeReporter();

    reporter.reportRunError("first");
    reporter.noteRunSuccess();
    reporter.reportRunError("second");

    assert.strictEqual(notifier.errorCalls.length, 2);
  });

  test("choosing Show Details reveals the output channel", async () => {
    const { output, reporter } = makeReporter("Show Details");
    reporter.reportRunError("boom");
    await flushMicrotasks();
    assert.strictEqual(output.shownTimes, 1);
  });

  test("reportErrors does nothing for an empty list", () => {
    const { output, notifier, reporter } = makeReporter();
    reporter.reportErrors([]);
    assert.strictEqual(output.lines.length, 0);
    assert.strictEqual(notifier.warningCalls.length, 0);
  });

  test("reportErrors logs each issue and warns once", () => {
    const { output, notifier, reporter } = makeReporter();
    reporter.reportErrors(["bad gem a", "bad gem b"]);

    assert.deepStrictEqual(output.lines, [
      "2 issue(s) while reading gem versions:",
      "  - bad gem a",
      "  - bad gem b",
    ]);
    assert.strictEqual(notifier.warningCalls.length, 1);
    assert.match(notifier.warningCalls[0], /2 issue\(s\)/);
  });
});
