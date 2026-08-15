# Changelog

All notable changes to slaide are recorded here. The format follows
[Keep a Changelog](https://keepachangelog.com), and slaide uses
[semantic versioning](https://semver.org).

## [Unreleased]

## [1.2.9] - 2026-08-15

### Added

- **The editor can insert a chart, a table and a graphic.** The Insert tab gains a Blocks group.
  A chart arrives ready to edit: pick bar, line, area, pie, donut or scatter, set a title and a
  legend, and type the categories and values into a live grid. A table arrives as a grid you
  click into, with row and column controls. A graphic takes any SVG markup you paste. Each one
  round-trips as its data, so the deck source stays small and the chart redraws at whatever size
  its box ends up.
- **A picture frame can be filled.** Selecting an image or media slot now offers "Choose picture…"
  and "Clear". Until now the panel could only change how a picture fitted its frame, never which
  picture it was — so a template's image drop zones could not be used at all.

### Changed

- An editable render carries the ECharts engine even when the deck has no chart, so a chart
  inserted into a chartless deck has something to draw with. It adds ~1.3MB to an editable render
  only; view and export renders are unchanged, and mermaid (4.3MB) stays demand-driven.

## [1.2.8] - 2026-08-15

### Added

- PowerPoint import honours a picture's crop. `a:srcRect` was ignored, so every cropped photo
  arrived uncropped and mis-framed. The picture is now scaled and offset inside a clipping box,
  which reproduces an asymmetric crop as exactly as a centred one.
- `slaide import --placeholders` keeps a template's empty picture boxes as image drop zones. An
  unfilled `<p:ph type="pic"/>` used to vanish, so a corporate template imported with nowhere to
  put a picture. It stays opt-in: PowerPoint paints that box in its editor and nowhere else, so a
  finished deck must not gain text the original never shows.

### Changed

- Three more renderer defaults become theme tokens, at the values they already had, so nothing
  looks different until a theme says otherwise: `--embed-radius` (embeds and widgets),
  `--code-inline-radius` (inline code), and `--quote-rule` / `--quote-pad` / `--quote-style`
  (the blockquote's accent rule, indent, and italics). Each was a fixed decoration no theme
  could reach — the same complaint that made images square in 1.2.7.

### Fixed

- Media and image slots keep their picture inside the cell. A slot laid its child out on a grid,
  where `height:100%` resolves against a grid area the child itself sizes — a cycle CSS settles as
  `auto`, so the picture fell back to its natural height and ran off the slide with nothing to say
  so. A 900px photo in a 120px strip covered the text below it. Slots are flex columns now, and
  the percentage height resolves for real.
- The viewer shows that Sign in worked. The ribbon's account button reads `window.__SLV_LICENSE__`,
  which nothing ever set, so a successful sign-in still read "Sign in" and the next click restarted
  the whole flow. The engine reports the status and the viewer injects it.
- A missing Pro engine build says so. On an OSS install, Sign in downloads the Pro engine from the
  GitHub release first; when that release carries no build for the running platform, the 404
  reached the user as raw network text in a "Sign-in failed" dialog.
- Charts stay inside the slide. A chart in a content-sized row guessed its height from its width
  (`width × 0.58`) and could end up taller than the space left, which clipped the bars and cut the
  category axis away entirely. The guess is now capped at the room below the chart, and it only
  applies when the chart has no height at all.

## [1.2.7] - 2026-08-15

### Changed

- Images and videos render square. The 8px corner rounding was a renderer default that no theme
  could turn off, and it applied to `.sl-img` and `.sl-video` alike. A theme that wants rounded
  corners still sets its own `border-radius`; `.sl-img.round` is unchanged.

## [1.2.6] - 2026-08-15

### Fixed

- Arrow keys follow PowerPoint again: Down/Right/Space/Enter/PageDown advance, Up/Left/Backspace/
  PageUp go back. A June change had swapped the vertical pair, so Up advanced and Down went back —
  the opposite of what every presenter's hands expect.

## [1.2.5] - 2026-08-14

### Fixed

- PowerPoint export keeps the deck's appearance. Slide backgrounds survive (an image or gradient
  background is rasterised; a flat colour stays native), CSS gradients map to real DrawingML
  gradient fills instead of collapsing to their first colour stop, and the chrome layer — logo,
  footer, page numbers — is exported at all. Inline SVG graphics become pictures captured after
  their CSS filters, so a white-on-dark logo stays white.
- PowerPoint export no longer prints an SVG's stylesheet onto the slide. Text harvesting skipped
  charts only, so the class rules and gradient ids inside an inline `<svg>` were emitted as copy.
- PowerPoint export only embeds typefaces the slides actually use, and only faces whose own name
  table matches the slot they fill. A family declared in the theme but never rendered used to be
  embedded anyway, which PowerPoint reports as an error on open; a weight served under a different
  family name (Google's 600 is "… SemiBold / Regular") used to be filed as bold, which it is not.
- PowerPoint export no longer captures the present-mode toggle into the corner of every slide.
- PowerPoint export measures each text box against the widest line it actually draws, so a
  heading no longer breaks mid-word where PowerPoint sets the same font slightly wider.

## [1.2.4] - 2026-08-01

### Fixed

- The daily update check no longer counts a failed npm-registry request against the 24-hour
  throttle. A timeout or server error used to silence the notifier for a full day; it now
  retries after an hour, while successful checks keep the once-a-day cadence.

## [1.2.3] - 2026-07-28

### Changed

- **Installed skills auto-update.** Any `slaide` command silently re-syncs the authoring skill
  installed in `~/.claude`/`~/.codex`/`~/.gemini` when it is older than the package — `slaide
  install` is now one-time.
- The skill now states the hand-off rule explicitly: give decks to people and apps as
  **`.slaidec`** (self-contained), never a bare `.slaide` — a `.slaide` without its master and
  assets renders unthemed everywhere else.

## [1.2.2] - 2026-07-28

### Changed

- **The visual editor is now free.** Signing in with a free Slaide account unlocks in-place
  editing and high-fidelity PowerPoint import in the desktop app — no license purchase. Only
  the cloud AI (day pass or Slaide Hosted) is paid, and every account's first AI deck
  (up to 10 slides) is free. The viewer, CLI, and language remain open source and need no
  account at all.
- The ribbon's account chip and AI upsell reflect the free tier ("Sign in to edit — free";
  the AI button leads to the upgrade page with the free-deck claim instead of straight to
  checkout).

## [1.2.1] - 2026-07-19

### Changed

- **Theme grammar now teaches when to use `image` vs `media` slots**: `media` fills its box edge-to-edge (the type for almost every photograph); `image` contains the whole picture with margins (logos, diagrams, QR codes). The bundled skill and the minimal-master example follow suit, and the `maxw` guidance now warns against wrapping short titles.

### Fixed

- Entering the Theme Studio no longer jumps the deck up for a frame: the studio now opens before the dock relayout, so the reflow happens under cover.

## [1.2.0] - 2026-07-19

Folds in the unpublished 1.1.0 (2026-07-11).

### Added

- Masters can declare an optional **`brand`** section — a locked brand identity (name, palette, fonts, logo) that the theme's colour roles derive from, so hosted AI edits keep the brand fixed while still letting the user override it.
- **`unknown-slot` is now a hard error** with a fix-it message naming the layout's real slots — a misrouted `:: region ::` no longer drops its content silently.

### Changed

- **Cover and outro/closing slides no longer show a page number.** Layouts named `cover`/`outro`/`closing`/`thanks`/`end` have their footer suppressed automatically unless the slide or layout sets `chrome:` explicitly.
- Present-to-screen reworked (v2): more reliable second-window handoff, autosave flush on present.
- Theme CSS variables moved to a namespaced form to avoid collisions when a render is embedded in a host page.
- Slide/layout `variant:` references are validated instead of silently resolving to nothing.

### Fixed

- **Phantom leading slide:** the parser now skips empty `---` segments instead of rendering them as a blank first slide.
- PDF/PPTX export fidelity — images, backgrounds, and fonts now export consistently.
- The compiler no longer crashes on a malformed gradient `background:` entry; it degrades with a diagnostic.
- The presentation render is editing-surface-free again: an editor identifier had leaked into the runtime script (caught by the render leak test).

## [1.0.5] - 2026-07-08

### Fixed

- Chart font family now resolves from the slide element when the CSS variable is empty, instead of falling back to a blank string.
- Chrome logo in the agent skill is opt-in, no longer injected by default.

### Changed

- Runtime navigation queue and rescan API for smoother slide transitions.
- Themes skill rewritten for leaner, more reliable authoring guidance.
- GitHub Actions release workflow now publishes the OSS viewer binaries.

## [1.0.4] - 2026-07-06

### Changed

- Speaker notes now **dock beneath the slide** instead of floating over it: the slide shrinks to make room and the notes panel no longer overlaps slide content or the bottom strip.
- The deck **language vocabulary is single-sourced** and shared across the parser, compiler and renderer, with a docs-drift lint that keeps the grammar reference in sync.
- Master loading is unified through `parseMaster`, and structured gradient stops (`{ color, pos }`) are normalized to CSS fragments — so gradient backgrounds render whichever way they're authored.

### Added

- The agent skill now bundles the full deck **grammar reference** (plus an expanded skill reference), so authoring assistants have the complete grammar on hand.

## [1.0.3] - 2026-06-30

### Added

- `slaide app [deck]` opens a deck in the native viewer/editor. The app (viewer + engine) is fetched and verified (checksum + signature) on first run, and the `.slaide` file type is registered — so `npm install -g @aivorynet/slaide` is the only install step. `slaide upgrade` updates the app in place.
- `slaide auth login | logout | status` signs in to Slaide Pro from the CLI (unlocks in-place editing).
- The CLI checks npm for a newer release once a day and prints a one-line update notice. Set `SLAIDE_AUTO_UPDATE=1` to update automatically, or `SLAIDE_NO_UPDATE=1` to silence it.

### Fixed

- `slaide --version` now reports the real package version (was hardcoded).

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

[Unreleased]: https://github.com/aivorynet/slaide/compare/v1.2.9...HEAD
[1.2.9]: https://github.com/aivorynet/slaide/compare/v1.2.8...v1.2.9
[1.2.8]: https://github.com/aivorynet/slaide/compare/v1.2.7...v1.2.8
[1.2.7]: https://github.com/aivorynet/slaide/compare/v1.2.6...v1.2.7
[1.2.6]: https://github.com/aivorynet/slaide/compare/v1.2.5...v1.2.6
[1.2.5]: https://github.com/aivorynet/slaide/compare/v1.2.4...v1.2.5
[1.2.4]: https://github.com/aivorynet/slaide/compare/v1.2.3...v1.2.4
[1.2.3]: https://github.com/aivorynet/slaide/compare/v1.2.2...v1.2.3
[1.2.2]: https://github.com/aivorynet/slaide/compare/v1.2.1...v1.2.2
[1.2.1]: https://github.com/aivorynet/slaide/compare/v1.2.0...v1.2.1
[1.2.0]: https://github.com/aivorynet/slaide/compare/v1.0.5...v1.2.0
[1.0.5]: https://github.com/aivorynet/slaide/compare/v1.0.4...v1.0.5
[1.0.4]: https://github.com/aivorynet/slaide/releases/tag/v1.0.4
[1.0.3]: https://github.com/aivorynet/slaide/releases/tag/v1.0.3
[1.0.2]: https://github.com/aivorynet/slaide/releases/tag/v1.0.2
[1.0.1]: https://github.com/aivorynet/slaide/releases/tag/v1.0.1
[1.0.0]: https://github.com/aivorynet/slaide/releases/tag/v1.0.0
