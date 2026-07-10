// The JSON contract between the TypeScript extension and bin/versions.rb.
// Any field change here must be mirrored in `Versions.call` in versions.rb.

// Per-gem version info produced by versions.rb.
export interface GemSpec {
  installed: string;
  newest?: string;
  homepage?: string;
  changelog?: string;
}

// The full stdout shape of a single versions.rb run.
export interface GemVersionsOutput {
  gems: Record<string, GemSpec>;
  errors: string[];
}
