import * as assert from "assert";

import { buildGemHover } from "../gemfile_hover_provider";

suite("buildGemHover", () => {
  test("includes the gem name and installed version", () => {
    const md = buildGemHover("rails", { installed: "7.2.2.1" });
    assert.ok(md.value.includes("**rails**"));
    assert.ok(md.value.includes("7.2.2.1"));
  });

  test("includes the latest version when outdated", () => {
    const md = buildGemHover("rails", { installed: "7.2.2.1", newest: "8.1.3" });
    assert.ok(md.value.includes("Latest"));
    assert.ok(md.value.includes("8.1.3"));
  });

  test("omits the latest line when up to date", () => {
    const md = buildGemHover("rails", { installed: "7.2.2.1", newest: "7.2.2.1" });
    assert.ok(!md.value.includes("Latest"));
  });

  test("renders a homepage link when present", () => {
    const md = buildGemHover("rails", {
      installed: "7.2.2.1",
      homepage: "https://rubyonrails.org",
    });
    assert.ok(md.value.includes("[Homepage](https://rubyonrails.org)"));
  });

  test("renders a changelog link only when outdated", () => {
    const outdated = buildGemHover("rails", {
      installed: "7.2.2.1",
      newest: "8.1.3",
      changelog: "https://example.com/CL",
    });
    assert.ok(outdated.value.includes("[Changelog](https://example.com/CL)"));

    const current = buildGemHover("rails", {
      installed: "7.2.2.1",
      changelog: "https://example.com/CL",
    });
    assert.ok(!current.value.includes("Changelog"));
  });
});
