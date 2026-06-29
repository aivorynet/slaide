---
name: slaide
description: Author and render slaide presentations — a Markdown + YAML slide language that exports a web deck, a high-fidelity PDF, editable PPTX, and a JPEG contact sheet you read to SEE the deck. Use when asked to make slides, a deck, a talk, or a presentation, or to edit / render / import a .slaide, .slaide.yaml, or .pptx file.
paths:
  - "**/*.slaide"
  - "**/*.slaide.yaml"
  - "**/*.slaidec"
allowed-tools: Bash(slaide *), Bash(npx @aivorynet/slaide *), Bash(npm run slaide *)
---

# slaide

One `.slaide` file (Markdown + a small YAML header) → web deck + PDF + PPTX. You write content; a reusable **master** (`*.slaide.yaml`) carries the design. Reference layouts / colours / fonts / classes **by name** from the master — never hand-style.

Run as `npx @aivorynet/slaide <cmd>` (or `npm run slaide -- <cmd>` where a script exists; at a monorepo root `npm run slaide -w @aivorynet/slaide -- <cmd>`, which shifts cwd to `core/` — pass **absolute** deck paths).

## Workflow
1. **Read** `reference.md` (language) and `themes.md` (masters/layouts/footguns). `examples/` is a worked deck + theme.
2. **`slaide slots <deck>`** — prints the master's real layouts, slots, colours, gradients, sizes, transitions. Reference these **by name**. (Run on the deck, not the master.)
3. **Write** the `.slaide` — and the master, if authoring one.
4. **`slaide validate <deck> --strict`** — a **gate**: must be clean. Every `unknown-*` / `low-contrast` / `non-embeddable-font` means something renders wrong even when it "looks valid".
5. **See it.** You can't open a browser, so: **`slaide shoot <deck> --montage out/sheet.jpg`** tiles every slide into one JPEG — **Read that image.** It's the only way to catch the common defects: overlapping / clipped text, hollow cards, weak contrast, overflow. Iterate until it looks genuinely professional — not just until validate passes.

## Format in 30 seconds
```
---
master: ./theme.slaide.yaml      # omit → bundled "aurora"
title: My Talk
~transition: slide-left          # `~` cascades to later slides
---
layout: cover
---
:: title ::
My Talk
:: subtitle ::
written in slaide
---
layout: title-content
---
## Why it's nice
- Plain text in   >>>            # `>>>` = reveal step
- Beautiful out   >>>
??? Speaker note (audience never sees this).
```
- `---` separates slides; the first config block is deck headmatter; a `key:`-only block after `---` is a slide's frontmatter.
- `:: name ::` routes Markdown into a layout slot. `[text]{.class}` = styled span (colour `.accent`, gradient `.grad`, size `.lg`). `>>>` = build. `??? text` = note. Inside ``` fences these sigils are literal.
- Charts: ` ```echart ` (data viz, ECharts option as JSON) and ` ```mermaid ` (diagrams) → theme-coloured SVG. Put a chart in a slot with height (a `1fr` row).

## Authoring a master → themes.md
Define fonts, a type scale, two-tier colour (palette + roles), gradients, backgrounds, grid layouts, chrome — all data. Reference **roles, not hex**, so a reskin is a palette swap. Past "tidy", give the deck **one signature** (a faint logo-derived motif or a recurring accent panel) and vary composition slide to slide. The load-bearing footguns — dark-on-dark text, hollow `box:` cards, chrome-corner collisions — are flagged in `themes.md`; heed them. A deck about slaide itself: use the shipped brand in the sibling `slaide-hugo` repo, don't invent one.

## Commands (prefix `npx @aivorynet/slaide`)
| Command | Does |
|---|---|
| `slots <deck>` | List the master's vocabulary (source of truth) |
| `validate <deck> [--strict]` | Line-numbered diagnostics; `--strict` fails on warnings |
| `shoot <deck> --montage out/sheet.jpg` | All slides → one JPEG contact sheet — the see-it loop (Playwright) |
| `shoot <deck> --out shots --jpeg` | One image per slide |
| `build <deck> --out out` | Self-contained HTML; charts baked to SVG |
| `export <deck> --pdf` · `--pptx` | PDF · editable PowerPoint (Playwright) |
| `import <file.pptx\|.key>` | PowerPoint/Keynote → slaide |
| `new <file>` · `themes` · `pack`/`unpack` | scaffold · list themes · bundle `.slaidec` |

If Playwright is missing: `npx playwright install chromium` once.
