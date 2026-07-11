// The JSON contract between the TypeScript extension and bin/audit.rb.
// Any field change here must be mirrored in `Audit.advisory_hash` /
// `Audit.new_result` in audit.rb (the audit sibling of types.ts ↔ versions.rb).

// A single known vulnerability affecting one gem in the lockfile.
export interface AuditAdvisory {
  gem: string;
  version: string; // installed version, read from the lockfile
  id: string; // advisory id, e.g. "CVE-2023-27530" or "GHSA-..."
  url?: string;
  title?: string;
  // Lowercase severity: "critical"|"high"|"medium"|"low"|"none"|"unknown".
  criticality: string;
  cvssV3?: number | null;
  description?: string;
  patchedVersions: string[];
  unaffectedVersions: string[];
}

// The full stdout shape of a single audit.rb run.
export interface AuditOutput {
  // false when the bundler-audit gem is not installed for the configured Ruby.
  available: boolean;
  advisories: AuditAdvisory[];
  insecureSources: string[]; // e.g. ["http://rubygems.org/"]
  errors: string[]; // best-effort failures (DB download/update, scan)
}
