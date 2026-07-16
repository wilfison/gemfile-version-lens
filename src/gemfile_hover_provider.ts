import {
  Hover,
  HoverProvider,
  MarkdownString,
  Position,
  Range,
  TextDocument,
} from "vscode";
import Cache from "./cache";
import { parseGemDeclarations } from "./gemfile_parser";
import { GemSpec } from "./types";

// Rich hover for a gem: installed/newest versions plus homepage/changelog
// links. It complements the (deliberately compact) CodeLens by keeping the full
// detail — including info for up-to-date gems, which no longer render a lens —
// one mouse-hover away instead of permanently on screen. Pure, so it is
// unit-testable without a TextDocument.
export function buildGemHover(name: string, gemInfo: GemSpec): MarkdownString {
  const outdated = Boolean(gemInfo.newest && gemInfo.installed !== gemInfo.newest);

  const md = new MarkdownString();
  md.appendMarkdown(`**${name}**\n\n`);
  md.appendMarkdown(`Installed: \`${gemInfo.installed}\`\n\n`);

  if (outdated) {
    md.appendMarkdown(`Latest: \`${gemInfo.newest}\`\n\n`);
  }

  const links: string[] = [];
  if (gemInfo.homepage) {
    links.push(`[Homepage](${gemInfo.homepage})`);
  }
  if (outdated && gemInfo.changelog) {
    links.push(`[Changelog](${gemInfo.changelog})`);
  }
  if (links.length > 0) {
    md.appendMarkdown(links.join(" · "));
  }

  return md;
}

// Reads the same per-Gemfile cache the CodeLens provider populates and, for the
// gem declaration under the cursor, shows buildGemHover. Returns undefined when
// versions haven't been fetched yet or the cursor isn't over a known gem.
export class GemfileHoverProvider implements HoverProvider {
  constructor(private readonly cache: Cache) {}

  public provideHover(document: TextDocument, position: Position): Hover | undefined {
    const versions = this.cache.get(document.uri.fsPath);
    if (!versions) {
      return undefined;
    }

    const text = document.getText();
    for (const declaration of parseGemDeclarations(text)) {
      const range = new Range(
        document.positionAt(declaration.index),
        document.positionAt(declaration.index + declaration.length),
      );

      if (!range.contains(position)) {
        continue;
      }

      const gemInfo = versions.gems[declaration.name];
      if (!gemInfo) {
        return undefined;
      }

      return new Hover(buildGemHover(declaration.name, gemInfo), range);
    }

    return undefined;
  }
}
