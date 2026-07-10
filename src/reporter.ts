import { OutputChannel, window } from "vscode";

// The slice of vscode's notification API the reporter uses. Injectable so the
// "notify at most once" gating can be unit-tested without real toasts.
export interface Notifier {
  showError(message: string, ...actions: string[]): Thenable<string | undefined>;
  showWarning(message: string, ...actions: string[]): Thenable<string | undefined>;
}

const windowNotifier: Notifier = {
  showError: (message, ...actions) => window.showErrorMessage(message, ...actions),
  showWarning: (message, ...actions) => window.showWarningMessage(message, ...actions),
};

// Owns the "Gemfile Version Lens" OutputChannel and the user-facing toasts.
// Whole-run failures are always logged but shown as a popup only once until the
// next successful run, so a broken setup can't spam a toast on every refresh.
export class Reporter {
  private runErrorNotified = false;

  constructor(
    private readonly output: OutputChannel,
    private readonly notifier: Notifier = windowNotifier,
  ) {}

  log(message: string): void {
    this.output.appendLine(message);
  }

  // Re-arm the run-error popup after a run that produced parseable output.
  noteRunSuccess(): void {
    this.runErrorNotified = false;
  }

  // Always log the failure; only raise a popup the first time, so a broken
  // setup doesn't spam a toast on every lens refresh. Resets on the next success.
  reportRunError(message: string): void {
    this.output.appendLine(message);

    if (this.runErrorNotified) {
      return;
    }
    this.runErrorNotified = true;

    this.notifier.showError(`Gemfile Version Lens: ${message}`, "Show Details").then((choice) => {
      if (choice === "Show Details") {
        this.output.show(true);
      }
    });
  }

  // Surface per-gem errors reported by versions.rb instead of failing silently.
  reportErrors(errors: string[]): void {
    if (!errors || errors.length === 0) {
      return;
    }

    this.output.appendLine(`${errors.length} issue(s) while reading gem versions:`);
    for (const message of errors) {
      this.output.appendLine(`  - ${message}`);
    }

    this.notifier
      .showWarning(
        `Gemfile Version Lens: ${errors.length} issue(s) while reading gem versions.`,
        "Show Details",
      )
      .then((choice) => {
        if (choice === "Show Details") {
          this.output.show(true);
        }
      });
  }
}
