# Change Log

## [1.1.0]

- Added vulnerability scanning: on opening a workspace with a `Gemfile.lock` (and on every lockfile change), the extension runs [bundler-audit](https://github.com/rubysec/bundler-audit) and reports known vulnerabilities via a notification, the Problems panel (with clickable CVE/GHSA links), and a rendered Markdown report (`Gemfile Version Lens: Show Vulnerability Report`).
- The feature is optional and silent when the `bundler-audit` gem is not installed. New setting `gemfileVersionLens.audit.enabled` (default `true`).

## [1.0.0]

- First release of the Gemfile Version Lens extension.
