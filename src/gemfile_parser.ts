// A single `gem` declaration found in a Gemfile.
export interface GemDeclaration {
  name: string;
  // The version constraint, when the declaration includes one
  // (e.g. `"~> 8.0"` in `gem "rails", "~> 8.0"`). Undefined otherwise.
  constraint?: string;
  // Offset of the match in the source text and its length, so callers can
  // build an editor Range without re-scanning.
  index: number;
  length: number;
}

// Matches gem declarations, both `gem "rails"` and `gem("rails", "~> 8.0")`.
// `\b` after `gem` keeps `gemspec`/`gems "x"` from matching.
export const GEM_DECLARATION_REGEX = /^[\t ]*gem\b\s*\(?\s*(['"])(.*?)\1(?:\s*,\s*(['"])(.+?)\3)?/gm;

// Scan Gemfile text for every `gem` declaration. Uses a fresh RegExp per call
// so the shared `lastIndex` state of a global regex can't leak between callers.
export function parseGemDeclarations(text: string): GemDeclaration[] {
  const regex = new RegExp(GEM_DECLARATION_REGEX.source, GEM_DECLARATION_REGEX.flags);
  const declarations: GemDeclaration[] = [];
  let match: RegExpExecArray | null;

  while ((match = regex.exec(text)) !== null) {
    declarations.push({
      name: match[2],
      constraint: match[4],
      index: match.index,
      length: match[0].length,
    });
  }

  return declarations;
}
