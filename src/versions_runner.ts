import * as cp from "node:child_process";
import { GemVersionsOutput } from "./types";
import { Reporter } from "./reporter";
import { describeRunError } from "./run_error";

// The single execFile call-form the runner uses. Narrowed (rather than
// `typeof cp.execFile`) so tests can supply a plain fake without satisfying
// every overload.
export type ExecFileFn = (
  file: string,
  args: readonly string[],
  options: { cwd: string; env: NodeJS.ProcessEnv; timeout: number },
  callback: (error: cp.ExecFileException | null, stdout: string, stderr: string) => void,
) => cp.ChildProcess;

export interface RunOptions {
  scriptPath: string;
  rubyPath: string;
  cwd: string;
  env: NodeJS.ProcessEnv;
  timeout: number;
  // Only used for the log line; the level itself is passed to Ruby via env.
  updateLevel: string;
}

// Spawns bin/versions.rb and owns the machinery that keeps redundant runs from
// piling up:
//   - In-flight dedup: concurrent runs for the same Gemfile share one process.
//   - Process lifetime is owned by the Gemfile, not the request: a per-request
//     cancellation must NOT kill the shared child (VS Code's cancel-then-reissue
//     would otherwise double-spawn). Abandoned runs finish and populate the
//     cache; only genuine invalidations kill via cancelInflight.
//   - Deliberate kills are recorded in `abortedChildren` and resolve to null
//     silently, so they read as a non-error (unlike a timeout kill).
export class VersionsRunner {
  private readonly inflight = new Map<
    string,
    { promise: Promise<GemVersionsOutput | null>; child: cp.ChildProcess }
  >();

  private readonly abortedChildren = new WeakSet<cp.ChildProcess>();

  constructor(
    private readonly reporter: Reporter,
    private readonly execFile: ExecFileFn = cp.execFile,
  ) {}

  hasInflight(fsPath: string): boolean {
    return this.inflight.has(fsPath);
  }

  run(fsPath: string, options: RunOptions): Promise<GemVersionsOutput | null> {
    // Reuse an in-flight run for the same Gemfile instead of spawning another.
    const existing = this.inflight.get(fsPath);
    if (existing) {
      return existing.promise;
    }

    let child: cp.ChildProcess;

    const promise = new Promise<GemVersionsOutput | null>((resolve) => {
      this.reporter.log(
        `Running versions.rb for ${fsPath} with update level: ${options.updateLevel}`,
      );

      child = this.execFile(
        options.rubyPath,
        [options.scriptPath],
        { cwd: options.cwd, env: options.env, timeout: options.timeout },
        (error, stdout, stderr) => {
          // Release the slot only if it still belongs to this run.
          if (this.inflight.get(fsPath)?.child === child) {
            this.inflight.delete(fsPath);
          }

          if (error) {
            // A deliberate kill (invalidation via cancelInflight) is not a failure.
            if (this.abortedChildren.has(child)) {
              this.abortedChildren.delete(child);
              resolve(null);
              return;
            }
            if (stderr) {
              this.reporter.log(stderr);
            }
            this.reporter.reportRunError(describeRunError(error, options.rubyPath, options.timeout));
            resolve(null);
            return;
          }

          try {
            const parsedOutput = JSON.parse(stdout) as GemVersionsOutput;
            this.reporter.noteRunSuccess();
            this.reporter.reportErrors(parsedOutput.errors);
            resolve(parsedOutput);
          } catch (e) {
            this.reporter.reportRunError(`Failed to parse output from versions.rb: ${e}`);
            resolve(null);
          }
        },
      );
    });

    this.inflight.set(fsPath, { promise, child: child! });

    return promise;
  }

  // Kill and forget the in-flight run for a file, so the next request restarts.
  cancelInflight(fsPath: string): void {
    const entry = this.inflight.get(fsPath);
    if (entry) {
      this.inflight.delete(fsPath);
      // Flag it so the exec callback treats this kill as intentional, not a failure.
      this.abortedChildren.add(entry.child);
      entry.child.kill();
    }
  }

  cancelAll(): void {
    for (const fsPath of [...this.inflight.keys()]) {
      this.cancelInflight(fsPath);
    }
  }
}
