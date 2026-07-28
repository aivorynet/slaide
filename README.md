# slaide

A new presentation file format, built for AI.

[![npm](https://img.shields.io/npm/v/@aivorynet/slaide?logo=npm&color=cb3837)](https://www.npmjs.com/package/@aivorynet/slaide) [![Download](https://img.shields.io/github/v/release/aivorynet/slaide?label=download&logo=github)](https://github.com/aivorynet/slaide/releases/latest) [![CI](https://github.com/aivorynet/slaide/actions/workflows/ci.yml/badge.svg)](https://github.com/aivorynet/slaide/actions/workflows/ci.yml) [![Apache-2.0](https://img.shields.io/badge/license-Apache--2.0-blue)](LICENSE)

![The free slaide viewer rendering a deck](https://raw.githubusercontent.com/aivorynet/slaide/main/docs/assets/viewer.png)

`.slaide` is a native, plain-text format for presentations: Markdown plus a small YAML theme. PowerPoint's `.pptx` is bulky XML that language models get wrong. A `.slaide` file is a few kilobytes of text an AI writes correctly, every time. One file renders to a navigable web deck, a high-fidelity PDF, and editable PowerPoint. A reusable theme carries the design, so nobody hand-places pixels.

AI writes it because it is just text. AI designs it because the theme does the design. You bring the idea.

Most of slaide is free and open source. The language, the renderer, the native viewer, export, import, the MCP server, and the agent skill all live in this repo under Apache-2.0. You can use it today, for anything.

The in-app visual editor is free too: sign in with a Slaide account and the same binary unlocks it, no license needed. Only the cloud AI agent that drafts and revises decks for you is paid.

## Install

One command — nothing else to set up:

```bash
npm install -g @aivorynet/slaide
```

That gives you the `slaide` command (write, validate, render, export, import) **and** `slaide app`,
which opens decks in the native viewer/editor — the app is fetched automatically the first time you
run it. Want to try it with no install at all? `npx @aivorynet/slaide new talk.slaide`.

```bash
npx playwright install chromium   # only for PDF, PPTX, and image export
```

## Use

```bash
slaide new talk.slaide            # scaffold a deck
slaide validate talk.slaide       # check it before rendering
slaide dev talk.slaide            # live preview at http://localhost:4321
slaide app talk.slaide            # open in the native viewer/editor (fetched on first run)
slaide build talk.slaide --out out  # self-contained out/index.html
slaide export talk.slaide --pdf out/talk.pdf
slaide export talk.slaide --pptx out/talk.pptx   # real text boxes, shapes, images
slaide import deck.pptx            # PowerPoint or Keynote into .slaide
slaide pack talk.slaide            # one shareable .slaidec file
```

## Write

A deck is just text:

```text
---
master: ./theme.slaide.yaml     # omit for the bundled "aurora" theme
title: My Talk
---
layout: cover
---
:: title ::
[Smart Inference]{.grad}
:: subtitle ::
written in slaide
---
layout: title-content
---
## Why a new language
- Plain text in    >>>
- Beautiful out    >>>
??? Speaker note. The audience never sees this.
```

Slides split on `---`. `:: name ::` routes Markdown into a theme slot. `>>>` is a build step. `??? ` is a speaker note. Reference layouts, colors, and fonts by name. The full grammar is in [docs/](docs/).

## The desktop app

```bash
slaide app talk.slaide
```

The native viewer opens folders, single files, and packed `.slaidec` bundles, presents full screen, and exports PDF. The first time you run `slaide app`, the CLI downloads the viewer + engine from the GitHub release, verifies it (SHA-256, and a minisign signature once releases are signed), registers the `.slaide` file type so double-click works, and opens the deck. `slaide upgrade` updates it in place.

**No Node?** Install the standalone app without npm — same signed binaries, fetched, verified, and registered for you:

```bash
# macOS / Linux
curl -fsSL https://github.com/aivorynet/slaide/releases/latest/download/install.sh | sh
# Windows (PowerShell)
irm https://github.com/aivorynet/slaide/releases/latest/download/install.ps1 | iex
```

…or a package manager (`scoop install slaide`, `brew install --cask slaide`, `winget install Slaide`), or download the archive from [Releases](https://github.com/aivorynet/slaide/releases), unzip, and run the bundled installer (it installs the binaries shipped inside, no network) — or just run `slaide-view` directly. (Or build from source with `npm run build:viewer`.)

Editing is free with a Slaide account: run `slaide auth login` (or click **Sign in** in the app) — Slaide fetches the full engine and unlocks editing, no license needed.

## For AI agents

slaide ships an agent skill and an MCP server. Install the skill into Claude Code, Codex, or Gemini with `slaide install`. Point a custom agent at the server with `slaide mcp`. Both run the same engine as the CLI. (`slaide install` sets up the *agent skill* — distinct from `slaide app`, which installs the *desktop viewer*.)

## Free editing, paid AI

Everything above is free, forever — including in-place visual editing and high-fidelity PowerPoint import. Run `slaide auth login` (or click **Sign in**, top-right, in the app): Slaide fetches the full engine and unlocks editing for any signed-in account, no license needed — the same binary serves everyone, sign-in is the only difference. The paid tier is the cloud AI agent that drafts and revises decks for you. Building from a source clone stays read-only by design: the editor engine is proprietary and isn't in this repo, so there's nothing to patch out (a clone can't *build* the editor; the downloaded app *fetches* it on sign-in). See [docs/open-core.md](docs/open-core.md). Plans and prices are at [getslaide.com](https://getslaide.com).

## How it works

`.slaide` plus its theme compiles to one intermediate representation, then renders to the web runtime and to PDF. The IR is the contract, so the web deck and the PDF cannot drift. PowerPoint export and import read the same model.

## License

Apache-2.0. "slaide" and the slaide logo are trademarks of AIVory, Inc. See [TRADEMARK.md](TRADEMARK.md) and [docs/open-core.md](docs/open-core.md).

Built by [AIVory, Inc.](https://getslaide.com) If slaide is useful to you, star the repo.
