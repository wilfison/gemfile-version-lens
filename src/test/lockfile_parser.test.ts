import * as assert from "assert";

import { parseLockfileSpecs, findRemoteLine } from "../lockfile_parser";

const LOCKFILE = [
  "GEM",
  "  remote: https://rubygems.org/",
  "  specs:",
  "    rack (2.1.0)",
  "    parser (3.3.11.1)",
  "      ast (~> 2.4.1)",
  "      racc",
  "    nokogiri (1.16.0-arm64-darwin)",
  "",
  "PLATFORMS",
  "  ruby",
  "  x86_64-linux",
  "",
  "DEPENDENCIES",
  "  rack",
  "  rubocop",
  "",
  "CHECKSUMS",
  "  rack (2.1.0) sha256=abc123",
  "",
  "BUNDLED WITH",
  "   2.4.10",
].join("\n");

suite("parseLockfileSpecs", () => {
  test("returns only the four-space resolved specs", () => {
    const specs = parseLockfileSpecs(LOCKFILE);
    assert.deepStrictEqual(
      specs.map((s) => s.name),
      ["rack", "parser", "nokogiri"],
    );
  });

  test("captures name and version, including platform versions", () => {
    const specs = parseLockfileSpecs(LOCKFILE);
    const nokogiri = specs.find((s) => s.name === "nokogiri");
    assert.strictEqual(nokogiri?.version, "1.16.0-arm64-darwin");
  });

  test("does not treat dependency lines as specs", () => {
    const specs = parseLockfileSpecs(LOCKFILE);
    assert.ok(!specs.some((s) => s.name === "ast"));
    assert.ok(!specs.some((s) => s.name === "racc"));
  });

  test("does not treat DEPENDENCIES or CHECKSUMS entries as specs", () => {
    const specs = parseLockfileSpecs(LOCKFILE);
    // `rack` appears once (the GEM spec), not again from DEPENDENCIES/CHECKSUMS.
    assert.strictEqual(specs.filter((s) => s.name === "rack").length, 1);
    assert.ok(!specs.some((s) => s.name === "rubocop"));
  });

  test("computes the range covering `name (version)`", () => {
    const specs = parseLockfileSpecs(LOCKFILE);
    const rack = specs.find((s) => s.name === "rack")!;
    assert.strictEqual(rack.line, 3);
    assert.strictEqual(rack.startChar, 4);
    // "rack (2.1.0)" -> 4 + len("rack") + len("2.1.0") + 3
    assert.strictEqual(rack.endChar, 4 + 4 + 5 + 3);
    assert.strictEqual(LOCKFILE.split("\n")[3].slice(rack.startChar, rack.endChar), "rack (2.1.0)");
  });

  test("handles multiple source sections", () => {
    const multi = [
      "GIT",
      "  remote: https://github.com/foo/bar.git",
      "  specs:",
      "    bar (1.0.0)",
      "",
      "GEM",
      "  remote: https://rubygems.org/",
      "  specs:",
      "    rack (2.1.0)",
    ].join("\n");
    const specs = parseLockfileSpecs(multi);
    assert.deepStrictEqual(
      specs.map((s) => s.name),
      ["bar", "rack"],
    );
  });

  test("tolerates CRLF line endings", () => {
    const specs = parseLockfileSpecs(LOCKFILE.replace(/\n/g, "\r\n"));
    const rack = specs.find((s) => s.name === "rack")!;
    assert.strictEqual(rack.version, "2.1.0");
    assert.strictEqual(rack.line, 3);
  });
});

suite("findRemoteLine", () => {
  test("finds the remote line for a matching source", () => {
    assert.strictEqual(findRemoteLine(LOCKFILE, "https://rubygems.org/"), 1);
  });

  test("matches regardless of a trailing slash", () => {
    assert.strictEqual(findRemoteLine(LOCKFILE, "https://rubygems.org"), 1);
  });

  test("returns undefined when the source is absent", () => {
    assert.strictEqual(findRemoteLine(LOCKFILE, "http://gems.example.com/"), undefined);
  });
});
