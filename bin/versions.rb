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
    gem_specs
  end

  def self.local_versions(gem_specs = {}) # rubocop:disable Metrics/AbcSize
    Bundler::LockfileParser.new(Bundler.read_file(Bundler.default_lockfile)).specs.each do |spec|
      gem_specs[spec.name] ||= {
        installed: spec.version.to_s,
        newest: nil,
        changelog_uri: nil
      }
    rescue StandardError => e
      gem_specs[:errors] << "Error processing local version for #{spec.name}: #{e.message}"
    end
  rescue StandardError => e
    gem_specs[:errors] << e.message.to_s
  end

  def self.remote_versions(gem_specs = {}) # rubocop:disable Metrics/AbcSize
    command = "#{bundle_bin} outdated --parseable --filter-minor --only-explicit"
    stdout_str, _stderr_str, _status = Open3.capture3(command)

    stdout_str.each_line.each do |line|
      match = line.match(/^\s*\*?(\S+)\s*\(newest\s*([\d.]+),?\sinstalled\s*([\d.]+)/)
      next unless match

      gem_name = match[1]
      newest_version = match[2]
      installed_version = match[3]

      gem_specs[gem_name] ||= {}
      gem_specs[gem_name][:newest] = newest_version
      gem_specs[gem_name][:installed] = installed_version
      gem_specs[gem_name] = gem_specs[gem_name].merge(gem_uris(gem_name))
    end
  rescue StandardError => e
    gem_specs[:errors] << "Error fetching remote versions: #{e.message}"
  end

  def self.bundle_bin
    return './bin/bundle' if File.exist?('./bin/bundle')

    'bundle'
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

puts JSON.generate(Versions.call)
