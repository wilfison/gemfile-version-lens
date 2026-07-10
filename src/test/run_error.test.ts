import * as assert from "assert";
import type { ExecFileException } from "node:child_process";

import { describeRunError } from "../run_error";

// Build a minimal ExecFileException for a given shape.
function execError(shape: Partial<ExecFileException>): ExecFileException {
  return shape as ExecFileException;
}

suite("describeRunError", () => {
  test("hints at rubyPath when the executable is missing (ENOENT)", () => {
    const message = describeRunError(execError({ code: "ENOENT" }), "ruby", 60000);
    assert.match(message, /Could not find the Ruby executable "ruby"/);
    assert.match(message, /gemfileVersionLens\.rubyPath/);
  });

  test("uses the configured rubyPath in the ENOENT message", () => {
    const message = describeRunError(execError({ code: "ENOENT" }), "/usr/bin/ruby3", 60000);
    assert.match(message, /"\/usr\/bin\/ruby3"/);
  });

  test("reports a timeout in seconds when the process was killed", () => {
    const message = describeRunError(execError({ killed: true }), "ruby", 45000);
    assert.match(message, /timed out after 45s/);
    assert.match(message, /gemfileVersionLens\.timeout/);
  });

  test("falls back to the raw message for other failures", () => {
    const message = describeRunError(execError({ message: "boom" }), "ruby", 60000);
    assert.strictEqual(message, "Failed to run versions.rb: boom");
  });

  test("prefers the ENOENT hint over the timeout hint", () => {
    const message = describeRunError(execError({ code: "ENOENT", killed: true }), "ruby", 60000);
    assert.match(message, /Could not find the Ruby executable/);
  });
});
