# Changelog

All notable changes to slaide are recorded here. The format follows
[Keep a Changelog](https://keepachangelog.com), and slaide uses
[semantic versioning](https://semver.org).

## [Unreleased]

## [1.0.2] - 2026-06-29

### Fixed

- `master: aurora` (any bundled theme name) now resolves to the bundled theme, matching what `slaide themes` and `slaide_list_themes` advertise. Previously only a file path resolved.

### Changed

- The agent skill now guides authoring a master from the bundled `themes.md` (with a copy-paste minimal master), prefers a fresh master over copying an example, and checks the project for brand assets (colours, logo, existing theme) before asking the user.
- `slaide install` notices a missing Playwright Chromium and offers to install it (needed for export and for the `shoot --montage` see-it loop).
- Example decks are no longer bundled in the package; the skill links to them on GitHub.

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

[Unreleased]: https://github.com/aivorynet/slaide/compare/v1.0.2...HEAD
[1.0.2]: https://github.com/aivorynet/slaide/releases/tag/v1.0.2
[1.0.1]: https://github.com/aivorynet/slaide/releases/tag/v1.0.1
[1.0.0]: https://github.com/aivorynet/slaide/releases/tag/v1.0.0
