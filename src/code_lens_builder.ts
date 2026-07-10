import { CodeLens, Range } from "vscode";
import { GemSpec } from "./types";

// Build the CodeLenses shown above a single gem declaration: the installed
// version, a warning when a newer version is available, and homepage/changelog
// links when the gem provides them. Pure given a Range, so it is unit-testable.
export function buildGemCodeLenses(gemInfo: GemSpec, range: Range): CodeLens[] {
  const codeLenses: CodeLens[] = [
    new CodeLens(range, { title: `Current: ${gemInfo.installed}`, command: "" }),
  ];

  if (hasNewerVersion(gemInfo)) {
    codeLenses.push(new CodeLens(range, { title: `⚠️ Newest: ${gemInfo.newest}`, command: "" }));
  }

  codeLenses.push(...buildLinkCodeLenses(gemInfo, range));

  return codeLenses;
}

// A newer version is available when versions.rb reported a `newest` that
// differs from what's installed.
function hasNewerVersion(gemInfo: GemSpec): boolean {
  return Boolean(gemInfo.newest && gemInfo.installed !== gemInfo.newest);
}

// One "Open …" lens per link the gem exposes; links without a URL are omitted.
// The changelog is only offered when there's a newer version to read about.
function buildLinkCodeLenses(gemInfo: GemSpec, range: Range): CodeLens[] {
  const links: Array<[string, string | undefined]> = [["Open Homepage", gemInfo.homepage]];

  if (hasNewerVersion(gemInfo)) {
    links.push(["Open Changelog", gemInfo.changelog]);
  }

  return links
    .filter((entry): entry is [string, string] => Boolean(entry[1]))
    .map(
      ([title, url]) => new CodeLens(range, { title, command: "vscode.open", arguments: [url] }),
    );
}
