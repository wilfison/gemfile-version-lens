# Gemfile Version Lens

[![Version](https://img.shields.io/visual-studio-marketplace/v/wilfison.gemfile-version-lens.svg)](https://marketplace.visualstudio.com/items?itemName=wilfison.gemfile-version-lens)
[![Installs](https://img.shields.io/visual-studio-marketplace/i/wilfison.gemfile-version-lens.svg)](https://marketplace.visualstudio.com/items?itemName=wilfison.gemfile-version-lens)
[![Rating](https://img.shields.io/visual-studio-marketplace/r/wilfison.gemfile-version-lens.svg)](https://marketplace.visualstudio.com/items?itemName=wilfison.gemfile-version-lens)

**Gemfile Version Lens** displays the latest available version for each gem in your Gemfile directly in the editor, using VS Code's Code Lens. Save time checking if your gems are up to date without leaving your editor!

![Gemfile Version Lens in action](https://github.com/wilfison/gemfile-version-lens/raw/HEAD/images/preview.png)

## Features

- Shows the installed version of each gem directly above its declaration
- Highlights when a newer version is available
- Quick links to the gem's homepage and changelog (when available)
- Version caching for optimized performance
- Automatically detects when the Gemfile is saved and updates information
- Scans your `Gemfile.lock` for known vulnerabilities with [bundler-audit](https://github.com/rubysec/bundler-audit) and reports them in the Problems panel and a rendered report
- Syntax highlighting for `Gemfile.lock` (section headers, gem names, versions, version constraints, `remote:` URLs, and checksums)

## Requirements

- Visual Studio Code 1.100.0 or higher
- Ruby installed on your system (used to run the version check script)
- Bundler installed (`gem install bundler`)
- A `Gemfile` in your workspace
- Optional: the [`bundler-audit`](https://github.com/rubysec/bundler-audit) gem (`gem install bundler-audit`) to enable vulnerability scanning

## Installation

1. Open VS Code
2. Press `Ctrl+P` (or `Cmd+P` on macOS)
3. Type `ext install wilfison.gemfile-version-lens`
4. Press Enter

Alternatively, you can install this extension directly from the [Visual Studio Code Marketplace](https://marketplace.visualstudio.com/items?itemName=wilfison.gemfile-version-lens).

## How it works

This extension activates automatically when you open a Gemfile. It parses the file content to identify gem declarations and then runs a Ruby script that fetches the latest available version information using Bundler.

The extension displays the following information as Code Lens:

- The currently installed version
- The latest available version (if an update is available)
- Links to the gem's homepage and changelog (when available)

## Vulnerability scanning

When you open a workspace that contains a `Gemfile.lock`, the extension runs [bundler-audit](https://github.com/rubysec/bundler-audit) once against the lockfile (and again whenever the lockfile changes, e.g. after `bundle install`). If it finds known vulnerabilities, it:

- shows a single notification with the count by severity and a **View Report** button;
- adds an entry per advisory to the **Problems** panel, anchored on the affected gem (in both the `Gemfile` and the `Gemfile.lock`, including transitive dependencies), with a clickable link to the CVE/GHSA advisory;
- provides a rendered Markdown report, opened from the notification or via the **Gemfile Version Lens: Show Vulnerability Report** command.

Notes:

- This feature is optional and silent when the `bundler-audit` gem is not installed — install it with `gem install bundler-audit`.
- The advisory database ([ruby-advisory-db](https://github.com/rubysec/ruby-advisory-db)) is downloaded on first use and refreshed (via `git`) once per session. This runs entirely on your machine.
- To silence advisories you have reviewed and accepted, use a [`.bundler-audit.yml`](https://github.com/rubysec/bundler-audit#configuration-file) ignore list in your project — it is honored automatically.
- Because the scan runs Ruby on open, it only runs in [trusted workspaces](https://code.visualstudio.com/docs/editor/workspace-trust).

## Extension Settings

| Setting                            | Default | Description                                                                                                                               |
| ---------------------------------- | ------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| `gemfileVersionLens.updateLevel`   | `all`   | Which update levels to surface as the newest version: `all`, `major`, `minor`, or `patch`. Maps to bundler's `outdated --filter-*` flags. |
| `gemfileVersionLens.rubyPath`      | `ruby`  | Path to the Ruby executable used to run the version and audit scripts. Set an absolute path when Ruby (rbenv/rvm/asdf/mise) is not on the editor's PATH. |
| `gemfileVersionLens.timeout`       | `60000` | Maximum time (ms) to wait for a check before giving up. The first audit run may download the advisory database, which can be slow.        |
| `gemfileVersionLens.audit.enabled` | `true`  | Scan `Gemfile.lock` for known vulnerabilities with bundler-audit on open and on change.                                                   |

## Known Issues

- The extension requires Ruby and Bundler to be installed on your system to work properly.
- In large projects with many gems, the initial check may take a little longer.
- Vulnerability scanning requires the `bundler-audit` gem and targets `Gemfile.lock` only (the `gems.rb`/`gems.locked` naming is not scanned).

## Contributing

Contributions are welcome! Feel free to report issues or submit pull requests to the [GitHub repository](https://github.com/wilfison/gemfile-version-lens).

1. Fork the repository
2. Create a branch for your feature (`git checkout -b feature/amazing-feature`)
3. Commit your changes (`git commit -m 'Add amazing feature'`)
4. Push to the branch (`git push origin feature/amazing-feature`)
5. Open a Pull Request

## License

This project is licensed under the MIT License - see the [LICENSE](https://github.com/wilfison/gemfile-version-lens/blob/main/LICENSE) file for details.

## Release Notes

See the [CHANGELOG](https://github.com/wilfison/gemfile-version-lens/blob/main/CHANGELOG.md) for details on the latest releases.

---

**Enjoy!**
