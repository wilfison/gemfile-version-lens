# frozen_string_literal: true

require 'minitest/autorun'
require_relative '../bin/audit'

# Exercises the pure transform methods of `Audit`. Requiring the file is safe
# even without bundler-audit installed, because the `require` for it lives
# inside `Audit.call` and is not touched here.
class AuditTest < Minitest::Test
  # Minimal stand-ins for a lockfile gem spec and an advisory, shaped like the
  # objects bundler-audit hands to `advisory_hash`.
  GemSpec = Struct.new(:name, :version)
  Advisory = Struct.new(
    :id, :url, :title, :criticality, :cvss_v3, :description,
    :patched_versions, :unaffected_versions, keyword_init: true
  )

  def full_advisory
    Advisory.new(
      id: 'CVE-2023-1234', url: 'https://example.com/cve', title: 'Boom',
      criticality: :high, cvss_v3: 8.1, description: 'A bad bug',
      patched_versions: ['>= 6.1.7.3'], unaffected_versions: ['< 6.0']
    )
  end

  def test_advisory_hash_maps_every_field
    hash = Audit.advisory_hash(GemSpec.new('rails', Gem::Version.new('6.1.0')), full_advisory)

    assert_equal(
      {
        gem: 'rails', version: '6.1.0', id: 'CVE-2023-1234',
        url: 'https://example.com/cve', title: 'Boom', criticality: 'high',
        cvssV3: 8.1, description: 'A bad bug',
        patchedVersions: ['>= 6.1.7.3'], unaffectedVersions: ['< 6.0']
      },
      hash
    )
  end

  def test_advisory_hash_falls_back_to_unknown_criticality
    advisory = full_advisory
    advisory.criticality = nil

    hash = Audit.advisory_hash(GemSpec.new('rack', Gem::Version.new('2.0.0')), advisory)

    assert_equal 'unknown', hash[:criticality]
  end

  def test_advisory_hash_stringifies_version_requirements
    advisory = full_advisory
    advisory.patched_versions = [Gem::Requirement.new('>= 6.1.7.3')]

    hash = Audit.advisory_hash(GemSpec.new('rails', Gem::Version.new('6.1.0')), advisory)

    assert_equal ['>= 6.1.7.3'], hash[:patchedVersions]
  end

  # A fake result object, dispatched on by `to_h[:type]`.
  UnpatchedGem = Struct.new(:gem, :advisory) do
    def to_h
      { type: :unpatched_gem }
    end
  end

  InsecureSource = Struct.new(:source) do
    def to_h
      { type: :insecure_source }
    end
  end

  def blank_result
    { available: true, advisories: [], insecureSources: [], errors: [] }
  end

  def test_append_result_routes_unpatched_gem_to_advisories
    result = blank_result
    item = UnpatchedGem.new(GemSpec.new('rails', Gem::Version.new('6.1.0')), full_advisory)

    Audit.append_result(result, item)

    assert_equal 1, result[:advisories].length
    assert_equal 'rails', result[:advisories].first[:gem]
    assert_empty result[:insecureSources]
  end

  def test_append_result_routes_insecure_source
    result = blank_result

    Audit.append_result(result, InsecureSource.new('http://rubygems.org/'))

    assert_equal ['http://rubygems.org/'], result[:insecureSources]
    assert_empty result[:advisories]
  end

  def test_append_result_ignores_unknown_types
    result = blank_result
    unknown = Struct.new(:x) { def to_h = { type: :something_else } }.new(1)

    Audit.append_result(result, unknown)

    assert_empty result[:advisories]
    assert_empty result[:insecureSources]
  end

  def test_unavailable_result_shape
    assert_equal(
      { available: false, advisories: [], insecureSources: [], errors: [] },
      Audit.unavailable_result
    )
  end
end
