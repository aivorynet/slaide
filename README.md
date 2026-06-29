# slaide

A new presentation file format, built for AI.

![The free slaide viewer rendering a deck](https://raw.githubusercontent.com/aivorynet/slaide/main/docs/assets/viewer.png)

`.slaide` is a native, plain-text format for presentations: Markdown plus a small YAML theme. PowerPoint's `.pptx` is bulky XML that language models get wrong. A `.slaide` file is a few kilobytes of text an AI writes correctly, every time. One file renders to a navigable web deck, a high-fidelity PDF, and editable PowerPoint. A reusable theme carries the design, so nobody hand-places pixels.

AI writes it because it is just text. AI designs it because the theme does the design. You bring the idea.

Most of slaide is free and open source. The language, the renderer, the native viewer, export, import, the MCP server, and the agent skill all live in this repo under Apache-2.0. You can use it today, for anything.

## Install

Nothing to set up:

```bash
npx @aivorynet/slaide new talk.slaide
```

Or install the command globally:

```bash
npm install -g @aivorynet/slaide
npx playwright install chromium   # only for PDF, PPTX, and image export
```

## Use

```bash
slaide new talk.slaide            # scaffold a deck
slaide validate talk.slaide       # check it before rendering
slaide dev talk.slaide            # live preview at http://localhost:4321
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

## The free viewer

`slaide-view` is a native app that opens any deck in its own window, with no Node on the target. Download it from [Releases](https://github.com/aivorynet/slaide/releases), or build it with `npm run build:viewer`. It opens folders, single files, and packed `.slaidec` bundles, presents full screen, and exports PDF.

## For AI agents

slaide ships an agent skill and an MCP server. Install the skill into Claude Code, Codex, or Gemini with `slaide install`. Point a custom agent at the server with `slaide mcp`. Both run the same engine as the CLI.

## Free and Pro

Everything above is free, forever. Slaide Pro adds in-place visual editing and high-fidelity PowerPoint import. The editor engine is proprietary and is not in this repo, so a clone is read-only by design. See [docs/open-core.md](docs/open-core.md). Plans and prices are at [getslaide.com](https://getslaide.com).

## How it works

`.slaide` plus its theme compiles to one intermediate representation, then renders to the web runtime and to PDF. The IR is the contract, so the web deck and the PDF cannot drift. PowerPoint export and import read the same model.

## License

Apache-2.0. "slaide" and the slaide logo are trademarks of AIVory, Inc. See [TRADEMARK.md](TRADEMARK.md) and [docs/open-core.md](docs/open-core.md).

Built by [AIVory, Inc.](https://getslaide.com) If slaide is useful to you, star the repo.
