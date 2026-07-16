# Change Log

## [Unreleased]

### Fixed

- Vulnerability scan no longer reports advisories from nested `Gemfile.lock` files under tool-generated or vendored directories (`.ruby-lsp/`, `.haml-lsp/`, `node_modules/`, `vendor/`). Legitimately nested projects (e.g. a monorepo's frontend/backend subdirectories) are still audited.

## [2.0.1]

### Fixed

- Exclude bundler-generated files (`vendor/`, `.bundle/`) from the packaged extension so they no longer bloat the `.vsix`.

## [2.0.0]

### Added

- **Vulnerability scanning** with [bundler-audit](https://github.com/rubysec/bundler-audit): on opening a workspace with a `Gemfile.lock` (and on every lockfile change), the extension scans for known vulnerabilities and reports them via a notification, the Problems panel (with clickable CVE/GHSA links), and a rendered Markdown report (`Gemfile Version Lens: Show Vulnerability Report`). Optional and silent when the `bundler-audit` gem is not installed. New setting `gemfileVersionLens.audit.enabled` (default `true`).
- Configurable update level: new setting `gemfileVersionLens.updateLevel` (`all`/`major`/`minor`/`patch`) controls which newer versions are surfaced (maps to bundler's `outdated --filter-*` flags).
- New setting `gemfileVersionLens.rubyPath` to point at a specific Ruby executable, for rbenv/rvm/asdf/mise setups where the editor process lacks Ruby on its PATH.
- New setting `gemfileVersionLens.timeout` (default `60000` ms) to cap how long a version check or audit may run.

### Changed

- CodeLens now surfaces only the gems actually declared in the Gemfile.
- More reliable gem homepage/changelog links, and per-gem script errors are surfaced instead of silently dropped.
- Correctly parses pre-release and platform-specific gem versions from `bundle outdated`.
- Hardened the external-Ruby integration: clearer error messages, notify-once on a broken setup, and a preference for a project `./bin/bundle` binstub over the global `bundle`.

### Performance

- Deduplicates, debounces, and cancels concurrent `versions.rb` runs to avoid redundant Ruby processes; results are cached per Gemfile and invalidated on save or config change.

### Fixed

- Refresh lenses after saving the Gemfile.
- Prevent duplicate `versions.rb` runs on request cancellation.
- Correct the Gemfile language match and harden script-path resolution.

## [1.0.0]

- First release of the Gemfile Version Lens extension.
