# frozen_string_literal: true

require 'minitest/autorun'
require_relative '../bin/versions'

class VersionsTest < Minitest::Test
  def test_parses_a_standard_line
    result = Versions.parse_outdated_line('faker (newest 2.19.0, installed 2.18.0, requested ~> 2.18)')

    assert_equal({ name: 'faker', newest: '2.19.0', installed: '2.18.0' }, result)
  end

  def test_parses_a_line_without_a_requested_constraint
    result = Versions.parse_outdated_line('nokogiri (newest 1.16.0, installed 1.15.0)')

    assert_equal('nokogiri', result[:name])
    assert_equal('1.16.0', result[:newest])
    assert_equal('1.15.0', result[:installed])
  end

  def test_parses_pre_release_versions
    result = Versions.parse_outdated_line('rails (newest 7.1.0.rc1, installed 7.0.8)')

    assert_equal('7.1.0.rc1', result[:newest])
    assert_equal('7.0.8', result[:installed])
  end

  def test_parses_platform_specific_versions
    result = Versions.parse_outdated_line('nokogiri (newest 1.16.0-arm64-darwin, installed 1.15.0-arm64-darwin)')

    assert_equal('1.16.0-arm64-darwin', result[:newest])
    assert_equal('1.15.0-arm64-darwin', result[:installed])
  end

  def test_tolerates_leading_whitespace
    result = Versions.parse_outdated_line('  puma (newest 6.4.0, installed 6.3.0)')

    assert_equal('puma', result[:name])
    assert_equal('6.4.0', result[:newest])
  end

  def test_returns_nil_for_non_matching_lines
    assert_nil(Versions.parse_outdated_line('Fetching gem metadata from https://rubygems.org/'))
    assert_nil(Versions.parse_outdated_line(''))
  end
end
