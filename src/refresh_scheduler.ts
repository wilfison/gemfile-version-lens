// The invalidation work a flushed refresh performs. Injected so the debounce
// and coalescing logic can be unit-tested without a cache or child processes.
export interface RefreshTarget {
  // Drop everything (e.g. a config change affects all Gemfiles).
  invalidateAll(): void;
  // Drop a single Gemfile (e.g. that file was saved).
  invalidateOne(fsPath: string): void;
  // Notify listeners that lenses should be recomputed.
  onRefresh(): void;
}

// Coalesces bursts of save/config-change invalidations into a single refresh,
// so e.g. auto-save firing repeatedly only re-runs the version check once.
export class RefreshScheduler {
  private timer: ReturnType<typeof setTimeout> | undefined;
  private readonly pending = new Set<string>();
  private invalidateAllPending = false;

  constructor(
    private readonly target: RefreshTarget,
    private readonly debounceMs: number,
  ) {}

  // Schedule a refresh. Pass a fsPath to invalidate just that Gemfile, or omit
  // it (a config change) to invalidate every cached Gemfile.
  schedule(fsPath?: string): void {
    if (fsPath) {
      this.pending.add(fsPath);
    } else {
      this.invalidateAllPending = true;
    }

    if (this.timer) {
      clearTimeout(this.timer);
    }

    this.timer = setTimeout(() => this.flush(), this.debounceMs);
  }

  // Run the pending invalidations now. An "invalidate all" wins over any queued
  // per-file invalidations. Exposed for tests; normal use goes through schedule.
  flush(): void {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = undefined;
    }

    if (this.invalidateAllPending) {
      this.target.invalidateAll();
    } else {
      for (const fsPath of this.pending) {
        this.target.invalidateOne(fsPath);
      }
    }

    this.pending.clear();
    this.invalidateAllPending = false;
    this.target.onRefresh();
  }

  // Cancel a queued refresh without running it (e.g. on dispose).
  dispose(): void {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = undefined;
    }
  }
}
