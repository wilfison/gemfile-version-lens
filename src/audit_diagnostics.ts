import { Diagnostic, DiagnosticSeverity, Position, Range, Uri } from "vscode";

import { AuditAdvisory } from "./audit_types";
import { parseGemDeclarations } from "./gemfile_parser";
import { parseLockfileSpecs, findRemoteLine, LockfileSpec } from "./lockfile_parser";

const SOURCE = "bundler-audit";

// Map bundler-audit's CVSS-derived criticality onto an editor severity.
export function severityFor(criticality: string): DiagnosticSeverity {
  switch (criticality) {
    case "critical":
    case "high":
      return DiagnosticSeverity.Error;
    case "medium":
      return DiagnosticSeverity.Warning;
    default: // low, none, unknown, or anything unexpected
      return DiagnosticSeverity.Information;
  }
}

// Diagnostics anchored on the Gemfile.lock: every advisory (including ones for
// transitive dependencies) plus a warning per insecure source. This is the
// complete picture, since the lockfile lists every resolved gem.
export function buildLockfileDiagnostics(
  advisories: AuditAdvisory[],
  insecureSources: string[],
  lockfileText: string,
): Diagnostic[] {
  const specs = parseLockfileSpecs(lockfileText);
  const diagnostics = advisories.map((advisory) =>
    makeAdvisoryDiagnostic(advisory, lockfileRange(advisory, specs)),
  );

  for (const source of insecureSources) {
    diagnostics.push(makeInsecureSourceDiagnostic(source, lockfileText));
  }

  return diagnostics;
}

// Diagnostics anchored on the Gemfile, limited to advisories for directly
// declared gems (transitive ones have no line here — they show on the lockfile).
export function buildGemfileDiagnostics(
  advisories: AuditAdvisory[],
  gemfileText: string,
): Diagnostic[] {
  const declarations = parseGemDeclarations(gemfileText);
  const diagnostics: Diagnostic[] = [];

  for (const advisory of advisories) {
    const declaration = declarations.find((d) => d.name === advisory.gem);
    if (!declaration) {
      continue;
    }
    const range = new Range(
      positionAt(gemfileText, declaration.index),
      positionAt(gemfileText, declaration.index + declaration.length),
    );
    diagnostics.push(makeAdvisoryDiagnostic(advisory, range));
  }

  return diagnostics;
}

// The lockfile range for an advisory: prefer the spec that matches both name
// and version, fall back to name only, then to the top of the file.
function lockfileRange(advisory: AuditAdvisory, specs: LockfileSpec[]): Range {
  const spec =
    specs.find((s) => s.name === advisory.gem && s.version === advisory.version) ??
    specs.find((s) => s.name === advisory.gem);

  if (!spec) {
    return new Range(0, 0, 0, 0);
  }
  return new Range(spec.line, spec.startChar, spec.line, spec.endChar);
}

function makeAdvisoryDiagnostic(advisory: AuditAdvisory, range: Range): Diagnostic {
  const diagnostic = new Diagnostic(range, advisoryMessage(advisory), severityFor(advisory.criticality));
  diagnostic.source = SOURCE;
  diagnostic.code = advisory.url
    ? { value: advisory.id, target: Uri.parse(advisory.url) }
    : advisory.id;
  return diagnostic;
}

function makeInsecureSourceDiagnostic(source: string, lockfileText: string): Diagnostic {
  const line = findRemoteLine(lockfileText, source) ?? 0;
  const diagnostic = new Diagnostic(
    new Range(line, 0, line, Number.MAX_SAFE_INTEGER),
    `Insecure gem source: ${source} — use HTTPS.`,
    DiagnosticSeverity.Warning,
  );
  diagnostic.source = SOURCE;
  return diagnostic;
}

function advisoryMessage(advisory: AuditAdvisory): string {
  const patched =
    advisory.patchedVersions.length > 0
      ? advisory.patchedVersions.join(", ")
      : "no patched version yet";
  const title = advisory.title ?? advisory.id;
  return `${advisory.gem} ${advisory.version} — ${title} (patched: ${patched})`;
}

// Convert a character offset into a 0-based Position, so a Gemfile match index
// can become a Range without a TextDocument.
function positionAt(text: string, offset: number): Position {
  let line = 0;
  let lineStart = 0;
  for (let i = 0; i < offset && i < text.length; i++) {
    if (text[i] === "\n") {
      line++;
      lineStart = i + 1;
    }
  }
  return new Position(line, offset - lineStart);
}
