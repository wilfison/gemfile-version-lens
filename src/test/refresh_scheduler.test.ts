import * as assert from "assert";

import { RefreshScheduler, RefreshTarget } from "../refresh_scheduler";

const DEBOUNCE_MS = 15;

// A RefreshTarget that records how it was invalidated.
class RecordingTarget implements RefreshTarget {
  allCount = 0;
  ones: string[] = [];
  refreshes = 0;
  invalidateAll(): void {
    this.allCount += 1;
  }
  invalidateOne(fsPath: string): void {
    this.ones.push(fsPath);
  }
  onRefresh(): void {
    this.refreshes += 1;
  }
}

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

suite("RefreshScheduler", () => {
  test("coalesces a burst of per-file schedules into one refresh", async () => {
    const target = new RecordingTarget();
    const scheduler = new RefreshScheduler(target, DEBOUNCE_MS);

    scheduler.schedule("/a/Gemfile");
    scheduler.schedule("/b/Gemfile");
    scheduler.schedule("/a/Gemfile"); // duplicate is deduped by the Set

    await wait(DEBOUNCE_MS * 3);

    assert.deepStrictEqual(target.ones.sort(), ["/a/Gemfile", "/b/Gemfile"]);
    assert.strictEqual(target.allCount, 0);
    assert.strictEqual(target.refreshes, 1);
  });

  test("a schedule with no path invalidates everything", async () => {
    const target = new RecordingTarget();
    const scheduler = new RefreshScheduler(target, DEBOUNCE_MS);

    scheduler.schedule();

    await wait(DEBOUNCE_MS * 3);

    assert.strictEqual(target.allCount, 1);
    assert.strictEqual(target.ones.length, 0);
    assert.strictEqual(target.refreshes, 1);
  });

  test("invalidate-all wins over queued per-file invalidations", async () => {
    const target = new RecordingTarget();
    const scheduler = new RefreshScheduler(target, DEBOUNCE_MS);

    scheduler.schedule("/a/Gemfile");
    scheduler.schedule(); // config change: everything

    await wait(DEBOUNCE_MS * 3);

    assert.strictEqual(target.allCount, 1);
    assert.strictEqual(target.ones.length, 0);
    assert.strictEqual(target.refreshes, 1);
  });

  test("does not fire again after a burst settles", async () => {
    const target = new RecordingTarget();
    const scheduler = new RefreshScheduler(target, DEBOUNCE_MS);

    scheduler.schedule("/a/Gemfile");
    await wait(DEBOUNCE_MS * 3);
    assert.strictEqual(target.refreshes, 1);

    await wait(DEBOUNCE_MS * 3);
    assert.strictEqual(target.refreshes, 1);
  });

  test("dispose cancels a pending refresh", async () => {
    const target = new RecordingTarget();
    const scheduler = new RefreshScheduler(target, DEBOUNCE_MS);

    scheduler.schedule("/a/Gemfile");
    scheduler.dispose();

    await wait(DEBOUNCE_MS * 3);

    assert.strictEqual(target.refreshes, 0);
    assert.strictEqual(target.ones.length, 0);
  });

  test("flush runs the pending invalidations immediately", () => {
    const target = new RecordingTarget();
    const scheduler = new RefreshScheduler(target, DEBOUNCE_MS);

    scheduler.schedule("/a/Gemfile");
    scheduler.flush();

    assert.deepStrictEqual(target.ones, ["/a/Gemfile"]);
    assert.strictEqual(target.refreshes, 1);
  });
});
