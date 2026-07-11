import * as assert from "assert";

import { buildAuditReportMarkdown, buildToastMessage, LockfileResult } from "../audit_report";
import { AuditAdvisory, AuditOutput } from "../audit_types";

function advisory(overrides: Partial<AuditAdvisory> = {}): AuditAdvisory {
  return {
    gem: "rack",
    version: "2.1.0",
    id: "CVE-2020-8161",
    url: "https://example.com/cve",
    title: "Directory traversal",
    criticality: "high",
    cvssV3: 8.6,
    description: "A bad bug.\nSecond line.",
    patchedVersions: ["~> 2.1.3", ">= 2.2.0"],
    unaffectedVersions: [],
    ...overrides,
  };
}

function output(overrides: Partial<AuditOutput> = {}): AuditOutput {
  return { available: true, advisories: [], insecureSources: [], errors: [], ...overrides };
}

const AT = new Date("2026-07-10T12:00:00.000Z");

suite("buildToastMessage", () => {
  test("summarizes counts by criticality, most severe first", () => {
    const message = buildToastMessage(
      [
        advisory({ criticality: "critical", id: "a" }),
        advisory({ criticality: "high", id: "b" }),
        advisory({ criticality: "high", id: "c" }),
        advisory({ criticality: "medium", id: "d" }),
      ],
      [],
    );
    assert.strictEqual(
      message,
      "Gemfile Version Lens found 4 known vulnerabilities (1 critical, 2 high, 1 medium).",
    );
  });

  test("uses the singular for a single vulnerability", () => {
    const message = buildToastMessage([advisory()], []);
    assert.match(message, /1 known vulnerability \(1 high\)/);
  });

  test("mentions insecure sources", () => {
    const message = buildToastMessage([], ["http://rubygems.org/"]);
    assert.strictEqual(message, "Gemfile Version Lens found 1 insecure gem source.");
  });

  test("combines vulnerabilities and insecure sources", () => {
    const message = buildToastMessage([advisory()], ["http://a/", "http://b/"]);
    assert.match(message, /1 known vulnerability \(1 high\) and 2 insecure gem sources/);
  });
});

suite("buildAuditReportMarkdown", () => {
  test("renders a per-lockfile, per-gem section with linked ids", () => {
    const results: LockfileResult[] = [
      { lockfilePath: "/app/Gemfile.lock", output: output({ advisories: [advisory()] }) },
    ];
    const md = buildAuditReportMarkdown(results, AT);

    assert.match(md, /# Bundler Audit Report/);
    assert.match(md, /_Generated 2026-07-10T12:00:00\.000Z_/);
    assert.match(md, /## \/app\/Gemfile\.lock/);
    assert.match(md, /### rack \(2\.1\.0\)/);
    assert.match(md, /\[CVE-2020-8161\]\(https:\/\/example\.com\/cve\)/);
    assert.match(md, /Patched: `~> 2\.1\.3`, `>= 2\.2\.0`/);
    assert.match(md, /> A bad bug\./);
  });

  test("orders gems by their most severe advisory", () => {
    const results: LockfileResult[] = [
      {
        lockfilePath: "/app/Gemfile.lock",
        output: output({
          advisories: [
            advisory({ gem: "puma", version: "5.0.0", criticality: "low", id: "low-1" }),
            advisory({ gem: "rails", version: "6.0.0", criticality: "critical", id: "crit-1" }),
          ],
        }),
      },
    ];
    const md = buildAuditReportMarkdown(results, AT);
    assert.ok(md.indexOf("### rails") < md.indexOf("### puma"), "critical gem comes first");
  });

  test("shows a clean line when there are no findings", () => {
    const results: LockfileResult[] = [{ lockfilePath: "/app/Gemfile.lock", output: output() }];
    assert.match(buildAuditReportMarkdown(results, AT), /No known vulnerabilities/);
  });

  test("renders insecure sources and scan warnings", () => {
    const results: LockfileResult[] = [
      {
        lockfilePath: "/app/Gemfile.lock",
        output: output({
          insecureSources: ["http://rubygems.org/"],
          errors: ["Could not update the advisory database: offline"],
        }),
      },
    ];
    const md = buildAuditReportMarkdown(results, AT);
    assert.match(md, /### Insecure sources/);
    assert.match(md, /http:\/\/rubygems\.org\/ — use HTTPS/);
    assert.match(md, /### Scan warnings/);
    assert.match(md, /Could not update the advisory database: offline/);
  });
});
