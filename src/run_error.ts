import type { ExecFileException } from "node:child_process";

// Turn an exec failure into a user-facing message, with a hint for the most
// common cause (Ruby not on the editor's PATH) and for timeouts. `scriptName`
// names the Ruby script in the message so both pipelines (versions.rb and
// audit.rb) can share this mapping.
export function describeRunError(
  error: ExecFileException,
  rubyPath: string,
  timeout: number,
  scriptName: string = "versions.rb",
): string {
  if (error.code === "ENOENT") {
    return `Could not find the Ruby executable "${rubyPath}". Set "gemfileVersionLens.rubyPath" to its full path.`;
  }
  if (error.killed) {
    return `${scriptName} timed out after ${Math.round(timeout / 1000)}s. Increase "gemfileVersionLens.timeout" if your project is large.`;
  }
  return `Failed to run ${scriptName}: ${error.message}`;
}
