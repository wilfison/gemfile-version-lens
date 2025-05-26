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

## Requirements

- Visual Studio Code 1.100.0 or higher
- Ruby installed on your system (used to run the version check script)
- Bundler installed (`gem install bundler`)
- A `Gemfile` in your workspace

## Installation

1. Open VS Code
2. Press `Ctrl+P` (or `Cmd+P` on macOS)
3. Type `ext install wilfison.gemfile-version-lens`
4. Press Enter

Alternatively, you can install this extension directly from the [Visual Studio Code Marketplace](https://marketplace.visualstudio.com/items?itemName=wilfison.gemfile-version-lens).

## How it works

This extension activates automatically when you open a Gemfile. It parses the file content to identify gem declarations and then runs a Ruby script that fetches the latest minor version information using Bundler.

The extension displays the following information as Code Lens:

- The currently installed version
- The latest available version (if an update is available)
- Links to the gem's homepage and changelog (when available)

## Known Issues

- The extension requires Ruby and Bundler to be installed on your system to work properly.
- In large projects with many gems, the initial check may take a little longer.

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
