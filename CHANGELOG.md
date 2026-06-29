# Changelog

All notable changes to slaide are recorded here. The format follows
[Keep a Changelog](https://keepachangelog.com), and slaide uses
[semantic versioning](https://semver.org).

## [Unreleased]

## [1.0.1] - 2026-06-29

### Changed

- README leads with the positioning: slaide is a native presentation file format built for AI.
- The CLI install uses a global install (`npm install -g @aivorynet/slaide`).
- Package, skill, and docs use the scoped name `@aivorynet/slaide` (the `slaide` command is unchanged).

## [1.0.0] - 2026-06-29

First public release.

### Added

- The `.slaide` language: Markdown plus a small YAML theme.
- Render to a navigable web deck and a high-fidelity PDF.
- Export to HTML, PDF, and editable PowerPoint.
- Import from PowerPoint and Keynote in cross-platform `reconstruct` mode.
- The native viewer (`slaide-view`): open, present, and export decks.
- Downloadable viewer builds for Linux, macOS, and Windows on each release.
- The MCP server (`slaide mcp`) and the agent skill (`slaide install`) for Claude Code, Codex, and Gemini.
- `.slaidec` packing and unpacking, and the `compare` fidelity tool.
- The bundled `aurora` theme.

[Unreleased]: https://github.com/aivorynet/slaide/compare/v1.0.1...HEAD
[1.0.1]: https://github.com/aivorynet/slaide/releases/tag/v1.0.1
[1.0.0]: https://github.com/aivorynet/slaide/releases/tag/v1.0.0
