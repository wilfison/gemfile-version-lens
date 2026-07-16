import * as assert from "assert";
import { Range } from "vscode";

import { buildGemCodeLenses } from "../code_lens_builder";

const range = new Range(0, 0, 0, 10);

suite("buildGemCodeLenses", () => {
  test("hides a gem that has no newer version by default", () => {
    const lenses = buildGemCodeLenses({ installed: "1.0.0" }, range);
    assert.deepStrictEqual(lenses, []);
  });

  test("hides a gem already on the newest version by default", () => {
    const lenses = buildGemCodeLenses({ installed: "2.0.0", newest: "2.0.0" }, range);
    assert.deepStrictEqual(lenses, []);
  });

  test("shows a compact `installed → newest` lens when outdated", () => {
    const lenses = buildGemCodeLenses({ installed: "1.0.0", newest: "2.0.0" }, range);
    assert.strictEqual(lenses[0].command?.title, "1.0.0 → 2.0.0");
  });

  test("links the version lens to the changelog when one is available", () => {
    const lenses = buildGemCodeLenses(
      { installed: "1.0.0", newest: "2.0.0", changelog: "https://example.com/CHANGELOG.md" },
      range,
    );
    assert.strictEqual(lenses[0].command?.command, "vscode.open");
    assert.deepStrictEqual(lenses[0].command?.arguments, ["https://example.com/CHANGELOG.md"]);
  });

  test("leaves the version lens non-clickable when there is no changelog", () => {
    const lenses = buildGemCodeLenses({ installed: "1.0.0", newest: "2.0.0" }, range);
    assert.strictEqual(lenses[0].command?.command, "");
  });

  test("adds a homepage icon lens when a homepage is present", () => {
    const lenses = buildGemCodeLenses(
      { installed: "1.0.0", newest: "2.0.0", homepage: "https://example.com" },
      range,
    );
    const home = lenses.find((lens) => lens.command?.title === "$(home)");
    assert.ok(home, "expected a homepage lens");
    assert.strictEqual(home.command?.command, "vscode.open");
    assert.deepStrictEqual(home.command?.arguments, ["https://example.com"]);
  });

  test("shows the bare installed version for up-to-date gems when opted in", () => {
    const lenses = buildGemCodeLenses(
      { installed: "1.0.0", homepage: "https://example.com" },
      range,
      { showUpToDate: true },
    );
    assert.strictEqual(lenses[0].command?.title, "1.0.0");
    assert.strictEqual(lenses[0].command?.command, "");
    assert.ok(lenses.some((lens) => lens.command?.title === "$(home)"));
  });

  test("does not offer a changelog link for an up-to-date gem", () => {
    const lenses = buildGemCodeLenses(
      { installed: "1.0.0", changelog: "https://example.com/CL" },
      range,
      { showUpToDate: true },
    );
    assert.ok(!lenses.some((lens) => lens.command?.arguments?.[0] === "https://example.com/CL"));
  });

  test("orders lenses: version first, then homepage", () => {
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
      ["1.0.0 → 2.0.0", "$(home)"],
    );
  });
});
