// A single resolved gem spec found in a Gemfile.lock, with the position of its
// `name (version)` text so a caller can anchor a diagnostic on it without a
// TextDocument. Positions are 0-based (line/character), ready for a vscode.Range.
export interface LockfileSpec {
  name: string;
  version: string;
  line: number;
  startChar: number;
  endChar: number;
}

// Section headers in a Gemfile.lock (GEM, GIT, PATH, PLATFORMS, ...). A spec
// line only counts when we're inside the `specs:` list of a source section, so
// nothing outside it (DEPENDENCIES, CHECKSUMS, ...) can be mistaken for a spec.
const SECTION_HEADER = /^\S/;

// A resolved spec: exactly four leading spaces, `name (version)`. Dependency
// lines under a spec are indented six spaces, so they fail the `{4}` anchor;
// platform versions like `1.16.0-arm64-darwin` are covered by `[^)]+`.
const SPEC_LINE = /^ {4}(\S+) \(([^)]+)\)$/;

// Parse every resolved spec out of a Gemfile.lock. Tolerant of CRLF line
// endings (Windows checkouts).
export function parseLockfileSpecs(text: string): LockfileSpec[] {
  const specs: LockfileSpec[] = [];
  let inSpecs = false;

  const lines = text.split("\n");
  for (let line = 0; line < lines.length; line++) {
    const raw = lines[line].replace(/\r$/, "");

    if (SECTION_HEADER.test(raw)) {
      inSpecs = false; // a new top-level section ends any prior specs block
      continue;
    }
    if (raw.trimStart() === "specs:") {
      inSpecs = true;
      continue;
    }
    if (!inSpecs) {
      continue;
    }

    const match = SPEC_LINE.exec(raw);
    if (match) {
      const startChar = raw.indexOf(match[1]);
      specs.push({
        name: match[1],
        version: match[2],
        line,
        startChar,
        endChar: startChar + match[1].length + match[2].length + 3, // " (" + ")"
      });
    }
  }

  return specs;
}

// Locate the `remote: <url>` line for a given source URL, used to anchor an
// insecure-source warning. Returns the 0-based line, or undefined if not found.
export function findRemoteLine(text: string, sourceUrl: string): number | undefined {
  const needle = sourceUrl.replace(/\/$/, "");
  const lines = text.split("\n");

  for (let line = 0; line < lines.length; line++) {
    const raw = lines[line].replace(/\r$/, "").trimStart();
    if (raw.startsWith("remote:") && raw.slice("remote:".length).trim().replace(/\/$/, "") === needle) {
      return line;
    }
  }

  return undefined;
}
