import * as assert from "assert";
import { DiagnosticSeverity, Uri } from "vscode";

import {
  severityFor,
  buildLockfileDiagnostics,
  buildGemfileDiagnostics,
} from "../audit_diagnostics";
import { AuditAdvisory } from "../audit_types";

const LOCKFILE = [
  "GEM",
  "  remote: https://rubygems.org/",
  "  specs:",
  "    rack (2.1.0)",
  "    nokogiri (1.15.0)",
  "",
  "DEPENDENCIES",
  "  rack",
].join("\n");

const GEMFILE = ['source "https://rubygems.org"', "", 'gem "rack"', 'gem "rails", "~> 7.0"'].join(
  "\n",
);

function advisory(overrides: Partial<AuditAdvisory> = {}): AuditAdvisory {
  return {
    gem: "rack",
    version: "2.1.0",
    id: "CVE-2020-8161",
    url: "https://example.com/cve",
    title: "Directory traversal",
    criticality: "high",
    patchedVersions: ["~> 2.1.3", ">= 2.2.0"],
    unaffectedVersions: [],
    ...overrides,
  };
}

suite("severityFor", () => {
  test("maps critical and high to Error", () => {
    assert.strictEqual(severityFor("critical"), DiagnosticSeverity.Error);
    assert.strictEqual(severityFor("high"), DiagnosticSeverity.Error);
  });
  test("maps medium to Warning", () => {
    assert.strictEqual(severityFor("medium"), DiagnosticSeverity.Warning);
  });
  test("maps low/none/unknown to Information", () => {
    assert.strictEqual(severityFor("low"), DiagnosticSeverity.Information);
    assert.strictEqual(severityFor("none"), DiagnosticSeverity.Information);
    assert.strictEqual(severityFor("unknown"), DiagnosticSeverity.Information);
  });
});

suite("buildLockfileDiagnostics", () => {
  test("anchors an advisory on its lockfile spec line", () => {
    const [diag] = buildLockfileDiagnostics([advisory()], [], LOCKFILE);
    assert.strictEqual(diag.range.start.line, 3);
    assert.strictEqual(diag.range.start.character, 4);
    assert.strictEqual(diag.severity, DiagnosticSeverity.Error);
    assert.strictEqual(diag.source, "bundler-audit");
    assert.match(diag.message, /rack 2\.1\.0 — Directory traversal/);
    assert.match(diag.message, /patched: ~> 2\.1\.3, >= 2\.2\.0/);
  });

  test("includes transitive gems (any lockfile spec, not just declared)", () => {
    const [diag] = buildLockfileDiagnostics(
      [advisory({ gem: "nokogiri", version: "1.15.0", id: "CVE-X" })],
      [],
      LOCKFILE,
    );
    assert.strictEqual(diag.range.start.line, 4);
  });

  test("sets code to a linked object when a url is present", () => {
    const [diag] = buildLockfileDiagnostics([advisory()], [], LOCKFILE);
    const code = diag.code as { value: string; target: Uri };
    assert.strictEqual(code.value, "CVE-2020-8161");
    assert.strictEqual(code.target.toString(), Uri.parse("https://example.com/cve").toString());
  });

  test("sets code to a plain string when the url is missing", () => {
    const [diag] = buildLockfileDiagnostics([advisory({ url: undefined })], [], LOCKFILE);
    assert.strictEqual(diag.code, "CVE-2020-8161");
  });

  test("falls back to the top of the file when the gem is not in the lockfile", () => {
    const [diag] = buildLockfileDiagnostics([advisory({ gem: "ghost" })], [], LOCKFILE);
    assert.strictEqual(diag.range.start.line, 0);
    assert.strictEqual(diag.range.end.line, 0);
  });

  test("anchors an insecure source on its remote line", () => {
    const diags = buildLockfileDiagnostics([], ["https://rubygems.org/"], LOCKFILE);
    assert.strictEqual(diags.length, 1);
    assert.strictEqual(diags[0].range.start.line, 1);
    assert.strictEqual(diags[0].severity, DiagnosticSeverity.Warning);
    assert.match(diags[0].message, /Insecure gem source/);
  });

  test("reports no patched version when the list is empty", () => {
    const [diag] = buildLockfileDiagnostics([advisory({ patchedVersions: [] })], [], LOCKFILE);
    assert.match(diag.message, /patched: no patched version yet/);
  });
});

suite("buildGemfileDiagnostics", () => {
  test("anchors only advisories for declared gems", () => {
    const diags = buildGemfileDiagnostics(
      [advisory({ gem: "rack" }), advisory({ gem: "nokogiri", id: "CVE-Y" })],
      GEMFILE,
    );
    // nokogiri is not declared in the Gemfile, so only rack anchors here.
    assert.strictEqual(diags.length, 1);
    assert.strictEqual(diags[0].range.start.line, 2);
  });

  test("produces no diagnostics when no advisory gem is declared", () => {
    const diags = buildGemfileDiagnostics([advisory({ gem: "sinatra" })], GEMFILE);
    assert.strictEqual(diags.length, 0);
  });
});
