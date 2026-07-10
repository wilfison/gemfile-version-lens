#!/usr/bin/env ruby
# frozen_string_literal: true

require 'json'
require 'open3'

require 'bundler'

module Versions
  def self.call
    gem_specs = { errors: [] }
    local_versions(gem_specs)
    remote_versions(gem_specs)

    errors = gem_specs.delete(:errors)
    { gems: gem_specs, errors: errors }
  end

  def self.local_versions(gem_specs = {}) # rubocop:disable Metrics/AbcSize
    Bundler::LockfileParser.new(Bundler.read_file(Bundler.default_lockfile)).specs.each do |spec|
      gem_specs[spec.name] ||= {
        installed: spec.version.to_s,
        newest: nil
      }.merge(gem_uris(spec.name))
    rescue StandardError => e
      gem_specs[:errors] << "Error processing local version for #{spec.name}: #{e.message}"
    end
  rescue StandardError => e
    gem_specs[:errors] << e.message.to_s
  end

  def self.remote_versions(gem_specs = {})
    command = "#{bundle_bin} outdated --parseable --only-explicit#{filter_flag}"
    stdout_str, _stderr_str, _status = Open3.capture3(command)

    stdout_str.each_line do |line|
      parsed = parse_outdated_line(line)
      gem_specs[parsed[:name]] = merge_remote_spec(gem_specs[parsed[:name]], parsed) if parsed
    end
  rescue StandardError => e
    gem_specs[:errors] << "Error fetching remote versions: #{e.message}"
  end

  # Merge a parsed outdated line into any existing local spec for the same gem,
  # adding the newest/installed versions and homepage/changelog links.
  def self.merge_remote_spec(existing, parsed)
    (existing || {}).merge(
      newest: parsed[:newest],
      installed: parsed[:installed]
    ).merge(gem_uris(parsed[:name]))
  end

  # Parse one line of `bundle outdated --parseable` output into its gem name and
  # newest/installed versions. Handles pre-release (7.1.0.rc1) and platform
  # (1.2.3-arm64-darwin) versions. Returns nil for lines that don't match.
  def self.parse_outdated_line(line)
    match = line.match(/^\s*\*?(\S+)\s*\(newest\s*([^\s,)]+),?\sinstalled\s*([^\s,)]+)/)
    return nil unless match

    { name: match[1], newest: match[2], installed: match[3] }
  end

  def self.bundle_bin
    return './bin/bundle' if File.exist?('./bin/bundle')

    'bundle'
  end

  # Maps the configured update level to a `bundle outdated` filter flag.
  # Defaults to no filter (show every newer version).
  def self.filter_flag
    case ENV['GVL_UPDATE_LEVEL']
    when 'major' then ' --filter-major'
    when 'minor' then ' --filter-minor'
    when 'patch' then ' --filter-patch'
    else ''
    end
  end

  def self.gem_uris(name)
    spec = Bundler.rubygems.find_name(name).first
    return {} unless spec

    {
      homepage: spec.homepage,
      changelog: spec.metadata['changelog_uri']
    }
  end
end

# Only run when executed directly (`ruby bin/versions.rb`); stays silent when
# required by tests so unit tests can exercise the pure methods in isolation.
puts JSON.generate(Versions.call) if __FILE__ == $PROGRAM_NAME
