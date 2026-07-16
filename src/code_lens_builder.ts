import { CodeLens, Range } from "vscode";
import { GemSpec } from "./types";

export interface BuildCodeLensOptions {
  // When false (the default), gems already on the newest version render no
  // lens at all, keeping the Gemfile uncluttered. The full detail for those
  // gems stays available on hover (see gemfile_hover_provider).
  showUpToDate?: boolean;
}

// Build the CodeLenses shown above a single gem declaration. Outdated gems get
// a compact `installed → newest` lens (clickable to the changelog when known)
// plus a homepage icon; up-to-date gems are hidden unless `showUpToDate` is set.
// Pure given a Range, so it is unit-testable.
export function buildGemCodeLenses(
  gemInfo: GemSpec,
  range: Range,
  options: BuildCodeLensOptions = {},
): CodeLens[] {
  const outdated = hasNewerVersion(gemInfo);

  // The single biggest source of clutter is a lens on every gem; up-to-date
  // gems carry no actionable info, so hide them unless the user opts in.
  if (!outdated && !options.showUpToDate) {
    return [];
  }

  const codeLenses: CodeLens[] = [buildVersionLens(gemInfo, range, outdated)];

  if (gemInfo.homepage) {
    codeLenses.push(
      new CodeLens(range, {
        title: "$(home)",
        command: "vscode.open",
        arguments: [gemInfo.homepage],
        tooltip: "Open homepage",
      }),
    );
  }

  return codeLenses;
}

// A newer version is available when versions.rb reported a `newest` that
// differs from what's installed.
function hasNewerVersion(gemInfo: GemSpec): boolean {
  return Boolean(gemInfo.newest && gemInfo.installed !== gemInfo.newest);
}

// The version lens: `installed → newest` when outdated (linked to the changelog
// if one is known), or the bare installed version for an up-to-date gem.
function buildVersionLens(gemInfo: GemSpec, range: Range, outdated: boolean): CodeLens {
  if (!outdated) {
    return new CodeLens(range, { title: gemInfo.installed, command: "" });
  }

  const title = `${gemInfo.installed} → ${gemInfo.newest}`;

  if (gemInfo.changelog) {
    return new CodeLens(range, {
      title,
      command: "vscode.open",
      arguments: [gemInfo.changelog],
      tooltip: "Open changelog",
    });
  }

  return new CodeLens(range, { title, command: "" });
}
