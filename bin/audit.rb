#!/usr/bin/env ruby
# frozen_string_literal: true

require 'json'

# Scans the project's Gemfile.lock for known vulnerabilities using bundler-audit
# and prints one JSON blob to stdout. Mirrors the AuditOutput contract in
# src/audit_types.ts.
#
# Two deliberate choices keep the TypeScript side simple:
#   - bundler-audit is required inside `call`, under `rescue LoadError`, so the
#     script degrades to `{ available: false }` when the gem isn't installed and
#     so unit tests can require this file without the gem present.
#   - It always exits 0 (unlike the bundler-audit CLI, which exits 1 when
#     vulnerable), so the runner can treat a non-zero exit as a real run failure.
module Audit
  UPDATE_ENV = 'GVL_AUDIT_UPDATE'

  def self.call
    require 'bundler/audit/scanner'
    require 'bundler/audit/database'

    result = new_result
    database = ensure_database(result)
    scan(result, database) if database
    result
  rescue LoadError
    unavailable_result
  end

  def self.new_result
    { available: true, advisories: [], insecureSources: [], errors: [] }
  end

  def self.unavailable_result
    { available: false, advisories: [], insecureSources: [], errors: [] }
  end

  # Ensure the ruby-advisory-db is present, downloading it when missing and
  # refreshing it once per session (GVL_AUDIT_UPDATE=1). Both steps are
  # best-effort: a failure is recorded and the scan proceeds with whatever
  # database exists (or is skipped, returning nil, when there is none).
  def self.ensure_database(result)
    path = Bundler::Audit::Database.path

    return download_database(result, path) unless Bundler::Audit::Database.exists?(path)

    database = Bundler::Audit::Database.new(path)
    update_database(result, database) if ENV[UPDATE_ENV] == '1'
    database
  end

  def self.download_database(result, path)
    Bundler::Audit::Database.download(path: path, quiet: true)
  rescue StandardError => e
    result[:errors] << "Could not download the advisory database: #{e.message}"
    nil
  end

  def self.update_database(result, database)
    database.update!(quiet: true)
  rescue StandardError => e
    result[:errors] << "Could not update the advisory database: #{e.message}"
  end

  # Scan the current directory (the TypeScript side sets cwd to the lockfile's
  # directory) and fold each result into the output hash. The Scanner loads the
  # project's .bundler-audit.yml itself, so a user's ignore list is honored.
  def self.scan(result, database)
    scanner = Bundler::Audit::Scanner.new(Dir.pwd, 'Gemfile.lock', database)
    scanner.report.results.each { |item| append_result(result, item) }
  rescue StandardError => e
    result[:errors] << "Error scanning for vulnerabilities: #{e.message}"
  end

  def self.append_result(result, item)
    case item.to_h[:type]
    when :unpatched_gem
      result[:advisories] << advisory_hash(item.gem, item.advisory)
    when :insecure_source
      result[:insecureSources] << item.source.to_s
    end
  end

  # Build the per-advisory hash explicitly (rather than dumping advisory.to_h,
  # which also carries the local YAML path) so the JSON contract stays under our
  # control. `criticality` is derived from CVSS and can be nil.
  def self.advisory_hash(gem_spec, advisory)
    {
      gem: gem_spec.name,
      version: gem_spec.version.to_s,
      id: advisory.id,
      url: advisory.url,
      title: advisory.title,
      criticality: (advisory.criticality || :unknown).to_s,
      cvssV3: advisory.cvss_v3,
      description: advisory.description,
      patchedVersions: Array(advisory.patched_versions).map(&:to_s),
      unaffectedVersions: Array(advisory.unaffected_versions).map(&:to_s)
    }
  end
end

# Only run when executed directly (`ruby bin/audit.rb`); stays silent when
# required by tests so unit tests can exercise the pure methods in isolation.
puts JSON.generate(Audit.call) if __FILE__ == $PROGRAM_NAME
