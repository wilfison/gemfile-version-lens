import * as assert from "assert";

import { parseGemDeclarations } from "../gemfile_parser";

suite("parseGemDeclarations", () => {
  test("matches a plain double-quoted declaration", () => {
    const result = parseGemDeclarations(`gem "rails"`);
    assert.strictEqual(result.length, 1);
    assert.strictEqual(result[0].name, "rails");
    assert.strictEqual(result[0].constraint, undefined);
  });

  test("matches single-quoted declarations", () => {
    const result = parseGemDeclarations(`gem 'puma'`);
    assert.strictEqual(result.length, 1);
    assert.strictEqual(result[0].name, "puma");
  });

  test("captures the version constraint when present", () => {
    const result = parseGemDeclarations(`gem "rails", "~> 8.0"`);
    assert.strictEqual(result.length, 1);
    assert.strictEqual(result[0].name, "rails");
    assert.strictEqual(result[0].constraint, "~> 8.0");
  });

  test("matches the parenthesized call form", () => {
    const result = parseGemDeclarations(`gem("nokogiri", "~> 1.16")`);
    assert.strictEqual(result.length, 1);
    assert.strictEqual(result[0].name, "nokogiri");
    assert.strictEqual(result[0].constraint, "~> 1.16");
  });

  test("matches parentheses with surrounding whitespace", () => {
    const result = parseGemDeclarations(`gem ( "sidekiq" )`);
    assert.strictEqual(result.length, 1);
    assert.strictEqual(result[0].name, "sidekiq");
  });

  test("ignores trailing non-string options as a constraint", () => {
    const result = parseGemDeclarations(`gem "rspec", require: false`);
    assert.strictEqual(result.length, 1);
    assert.strictEqual(result[0].name, "rspec");
    assert.strictEqual(result[0].constraint, undefined);
  });

  test("reports offsets that cover the indented declaration", () => {
    const text = `group :test do\n  gem "factory_bot"\nend`;
    const result = parseGemDeclarations(text);
    assert.strictEqual(result.length, 1);
    assert.strictEqual(result[0].name, "factory_bot");
    // The match spans from the line's indentation through the declaration.
    const slice = text.slice(result[0].index, result[0].index + result[0].length);
    assert.strictEqual(slice.trimStart(), `gem "factory_bot"`);
  });

  test("does not match commented lines", () => {
    const result = parseGemDeclarations(`# gem "commented"`);
    assert.strictEqual(result.length, 0);
  });

  test("does not match gemspec or gems", () => {
    const result = parseGemDeclarations(`gemspec\ngems "foo"`);
    assert.strictEqual(result.length, 0);
  });

  test("finds every declaration in a multi-line Gemfile", () => {
    const text = [
      `source "https://rubygems.org"`,
      `gem "rails", "~> 8.0"`,
      `gem 'puma'`,
      `gem("nokogiri")`,
    ].join("\n");
    const names = parseGemDeclarations(text).map((d) => d.name);
    assert.deepStrictEqual(names, ["rails", "puma", "nokogiri"]);
  });
});
