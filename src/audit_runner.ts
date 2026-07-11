import * as cp from "node:child_process";

import { AuditOutput } from "./audit_types";
import { Reporter } from "./reporter";
import { ExecFileFn } from "./versions_runner";
import { describeRunError } from "./run_error";

export interface AuditRunOptions {
  scriptPath: string;
  rubyPath: string;
  cwd: string;
  env: NodeJS.ProcessEnv;
  timeout: number;
}

// Spawns bin/audit.rb, mirroring VersionsRunner's in-flight dedup but with a
// deliberately different reporting policy: an audit is a background nicety, so
// failures are logged, never toasted (the CodeLens pipeline already toasts a
// broken Ruby setup; a second toast for the same cause would just be noise).
export class AuditRunner {
  private readonly inflight = new Map<
    string,
    { promise: Promise<AuditOutput | null>; child: cp.ChildProcess }
  >();

  // Children we killed ourselves on dispose; their exit callback resolves null
  // silently instead of being reported as a failure.
  private readonly killedByDispose = new WeakSet<cp.ChildProcess>();

  constructor(
    private readonly reporter: Reporter,
    private readonly execFile: ExecFileFn = cp.execFile,
  ) {}

  run(lockfilePath: string, options: AuditRunOptions): Promise<AuditOutput | null> {
    const existing = this.inflight.get(lockfilePath);
    if (existing) {
      return existing.promise;
    }

    let child: cp.ChildProcess;

    const promise = new Promise<AuditOutput | null>((resolve) => {
      this.reporter.log(`Running audit.rb for ${lockfilePath}`);

      child = this.execFile(
        options.rubyPath,
        [options.scriptPath],
        { cwd: options.cwd, env: options.env, timeout: options.timeout },
        (error, stdout, stderr) => {
          if (this.inflight.get(lockfilePath)?.child === child) {
            this.inflight.delete(lockfilePath);
          }

          if (error) {
            if (this.killedByDispose.has(child)) {
              this.killedByDispose.delete(child);
              resolve(null);
              return;
            }
            this.logFailure(error, stderr, options);
            resolve(null);
            return;
          }

          try {
            resolve(JSON.parse(stdout) as AuditOutput);
          } catch (e) {
            this.reporter.log(`Failed to parse output from audit.rb: ${e}`);
            resolve(null);
          }
        },
      );
    });

    this.inflight.set(lockfilePath, { promise, child: child! });

    return promise;
  }

  // Kill every in-flight run (on dispose). Killed children resolve null silently.
  cancelAll(): void {
    for (const [lockfilePath, entry] of [...this.inflight.entries()]) {
      this.inflight.delete(lockfilePath);
      this.killedByDispose.add(entry.child);
      entry.child.kill();
    }
  }

  private logFailure(error: cp.ExecFileException, stderr: string, options: AuditRunOptions): void {
    if (stderr) {
      this.reporter.log(stderr);
    }
    this.reporter.log(describeRunError(error, options.rubyPath, options.timeout, "audit.rb"));

    // A timeout on the first run is usually the advisory-db download.
    if (error.killed) {
      this.reporter.log(
        'The first audit run downloads the advisory database, which can be slow. Increase "gemfileVersionLens.timeout" or run "bundle-audit update" once.',
      );
    }
  }
}
