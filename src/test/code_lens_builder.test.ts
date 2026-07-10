import * as assert from "assert";
import { Range } from "vscode";

import { buildGemCodeLenses } from "../code_lens_builder";

const range = new Range(0, 0, 0, 10);

suite("buildGemCodeLenses", () => {
  test("renders only the current version when no newer version exists", () => {
    const lenses = buildGemCodeLenses({ installed: "1.0.0" }, range);
    assert.strictEqual(lenses.length, 1);
    assert.strictEqual(lenses[0].command?.title, "Current: 1.0.0");
    assert.strictEqual(lenses[0].command?.command, "");
  });

  test("adds a newest-version warning when a newer version is available", () => {
    const lenses = buildGemCodeLenses({ installed: "1.0.0", newest: "2.0.0" }, range);
    assert.strictEqual(lenses.length, 2);
    assert.strictEqual(lenses[0].command?.title, "Current: 1.0.0");
    assert.strictEqual(lenses[1].command?.title, "⚠️ Newest: 2.0.0");
  });

  test("omits the warning when installed already equals newest", () => {
    const lenses = buildGemCodeLenses({ installed: "2.0.0", newest: "2.0.0" }, range);
    assert.strictEqual(lenses.length, 1);
    assert.strictEqual(lenses[0].command?.title, "Current: 2.0.0");
  });

  test("adds an Open Homepage link when a homepage is present", () => {
    const lenses = buildGemCodeLenses(
      { installed: "1.0.0", homepage: "https://example.com" },
      range,
    );
    const link = lenses.find((lens) => lens.command?.title === "Open Homepage");
    assert.ok(link, "expected an Open Homepage lens");
    assert.strictEqual(link.command?.command, "vscode.open");
    assert.deepStrictEqual(link.command?.arguments, ["https://example.com"]);
  });

  test("adds an Open Changelog link when a newer version has a changelog", () => {
    const lenses = buildGemCodeLenses(
      { installed: "1.0.0", newest: "2.0.0", changelog: "https://example.com/CHANGELOG.md" },
      range,
    );
    const link = lenses.find((lens) => lens.command?.title === "Open Changelog");
    assert.ok(link, "expected an Open Changelog lens");
    assert.deepStrictEqual(link.command?.arguments, ["https://example.com/CHANGELOG.md"]);
  });

  test("omits the Open Changelog link when there is no newer version", () => {
    const lenses = buildGemCodeLenses(
      { installed: "1.0.0", changelog: "https://example.com/CHANGELOG.md" },
      range,
    );
    assert.ok(!lenses.some((lens) => lens.command?.title === "Open Changelog"));
  });

  test("still shows the homepage link even without a newer version", () => {
    const lenses = buildGemCodeLenses(
      { installed: "1.0.0", homepage: "https://example.com", changelog: "https://example.com/CL" },
      range,
    );
    assert.ok(lenses.some((lens) => lens.command?.title === "Open Homepage"));
    assert.ok(!lenses.some((lens) => lens.command?.title === "Open Changelog"));
  });

  test("omits link lenses when the gem exposes no URLs", () => {
    const lenses = buildGemCodeLenses({ installed: "1.0.0", newest: "2.0.0" }, range);
    assert.ok(!lenses.some((lens) => lens.command?.command === "vscode.open"));
  });

  test("orders lenses: current, newest, homepage, changelog", () => {
    const lenses = buildGemCodeLenses(
      {
        installed: "1.0.0",
        newest: "2.0.0",
        homepage: "https://example.com",
        changelog: "https://example.com/CHANGELOG.md",
      },
      range,
    );
    assert.deepStrictEqual(
      lenses.map((lens) => lens.command?.title),
      ["Current: 1.0.0", "⚠️ Newest: 2.0.0", "Open Homepage", "Open Changelog"],
    );
  });
});
