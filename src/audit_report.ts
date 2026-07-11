import { AuditAdvisory, AuditOutput } from "./audit_types";

// Criticality ordering, most severe first, for both the toast breakdown and
// the per-gem ordering in the markdown report.
const CRITICALITY_ORDER = ["critical", "high", "medium", "low", "none", "unknown"];

export interface LockfileResult {
  lockfilePath: string;
  output: AuditOutput;
}

// A one-line warning summarizing what was found, e.g.
// "Gemfile Version Lens found 4 known vulnerabilities (1 critical, 2 high, 1 medium)."
export function buildToastMessage(advisories: AuditAdvisory[], insecureSources: string[]): string {
  const parts: string[] = [];

  if (advisories.length > 0) {
    const noun = advisories.length === 1 ? "vulnerability" : "vulnerabilities";
    const breakdown = criticalityBreakdown(advisories);
    parts.push(`${advisories.length} known ${noun}${breakdown ? ` (${breakdown})` : ""}`);
  }
  if (insecureSources.length > 0) {
    const noun = insecureSources.length === 1 ? "source" : "sources";
    parts.push(`${insecureSources.length} insecure gem ${noun}`);
  }

  return `Gemfile Version Lens found ${parts.join(" and ")}.`;
}

// The full markdown document rendered in the report preview.
export function buildAuditReportMarkdown(results: LockfileResult[], generatedAt: Date): string {
  const lines = ["# Bundler Audit Report", "", `_Generated ${generatedAt.toISOString()}_`, ""];

  for (const result of results) {
    lines.push(`## ${result.lockfilePath}`, "");
    lines.push(...renderLockfileSection(result.output));
  }

  return lines.join("\n");
}

function renderLockfileSection(output: AuditOutput): string[] {
  if (!output.available) {
    return ["_bundler-audit is not installed for the configured Ruby._", ""];
  }

  const lines: string[] = [];
  if (output.advisories.length === 0 && output.insecureSources.length === 0) {
    lines.push("No known vulnerabilities. ✅", "");
  } else {
    lines.push(...renderAdvisories(output.advisories));
    lines.push(...renderInsecureSources(output.insecureSources));
  }
  lines.push(...renderWarnings(output.errors));
  return lines;
}

function renderAdvisories(advisories: AuditAdvisory[]): string[] {
  const lines: string[] = [];
  for (const gem of groupByGem(advisories)) {
    lines.push(`### ${gem.name} (${gem.version})`, "");
    for (const advisory of gem.advisories) {
      lines.push(...renderAdvisory(advisory));
    }
  }
  return lines;
}

function renderAdvisory(advisory: AuditAdvisory): string[] {
  const id = advisory.url ? `[${advisory.id}](${advisory.url})` : advisory.id;
  const cvss = advisory.cvssV3 ? ` (CVSS ${advisory.cvssV3})` : "";
  const patched =
    advisory.patchedVersions.length > 0
      ? advisory.patchedVersions.map((v) => `\`${v}\``).join(", ")
      : "no patched version yet";

  const lines = [
    `- **${id}** — ${advisory.title ?? "Vulnerability"} — **${advisory.criticality}**${cvss}`,
    `  - Patched: ${patched}`,
  ];
  if (advisory.description) {
    lines.push("", ...advisory.description.trimEnd().split("\n").map((l) => `  > ${l}`));
  }
  lines.push("");
  return lines;
}

function renderInsecureSources(sources: string[]): string[] {
  if (sources.length === 0) {
    return [];
  }
  return ["### Insecure sources", "", ...sources.map((s) => `- ${s} — use HTTPS.`), ""];
}

function renderWarnings(errors: string[]): string[] {
  if (errors.length === 0) {
    return [];
  }
  return ["### Scan warnings", "", ...errors.map((e) => `- ${e}`), ""];
}

interface GemGroup {
  name: string;
  version: string;
  advisories: AuditAdvisory[];
}

// Group advisories by gem, ordering gems by their most severe advisory.
function groupByGem(advisories: AuditAdvisory[]): GemGroup[] {
  const groups = new Map<string, GemGroup>();

  for (const advisory of advisories) {
    const group = groups.get(advisory.gem);
    if (group) {
      group.advisories.push(advisory);
    } else {
      groups.set(advisory.gem, {
        name: advisory.gem,
        version: advisory.version,
        advisories: [advisory],
      });
    }
  }

  return [...groups.values()].sort((a, b) => worstRank(a.advisories) - worstRank(b.advisories));
}

function worstRank(advisories: AuditAdvisory[]): number {
  return Math.min(...advisories.map((a) => criticalityRank(a.criticality)));
}

function criticalityRank(criticality: string): number {
  const rank = CRITICALITY_ORDER.indexOf(criticality);
  return rank === -1 ? CRITICALITY_ORDER.length : rank;
}

// "1 critical, 2 high, 1 medium" — non-zero buckets only, most severe first.
function criticalityBreakdown(advisories: AuditAdvisory[]): string {
  return CRITICALITY_ORDER.map((level) => {
    const count = advisories.filter((a) => a.criticality === level).length;
    return count > 0 ? `${count} ${level}` : undefined;
  })
    .filter((part): part is string => part !== undefined)
    .join(", ");
}
