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
1. **Brand first — check, then ask.** Scan the project/context for brand assets: colours, fonts, a logo, an existing `*.slaide.yaml` master, a brand doc. Found a master → use it. Found brand → build the master around it. Found nothing → **ask** the user: brand colours? logo? an existing theme, or author one from scratch? Prefer authoring a **new master** over copying an example.
2. **Read** `reference.md` (language) and `themes.md` (the master format + footguns) before authoring a master; `grammar.md` is the precise formal reference (frontmatter detection, attribute braces, transitions/entrances, master value forms) when you need it. Worked example decks: https://github.com/aivorynet/slaide/tree/main/examples
3. **`slaide slots <deck>`** — prints the master's real layouts, slots, colours, gradients, sizes, transitions. Reference these **by name**. (Run on the deck, not the master.)
4. **Write** the `.slaide` — and the master, if authoring one.
5. **`slaide validate <deck> --strict`** — a **gate**: must be clean. Every `unknown-*` / `low-contrast` / `non-embeddable-font` means something renders wrong even when it "looks valid".
6. **See it.** You can't open a browser, so: **`slaide shoot <deck> --montage out/sheet.jpg`** tiles every slide into one JPEG — **Read that image.** It's the only way to catch the common defects: overlapping / clipped text, hollow cards, weak contrast, overflow. Iterate until it looks genuinely professional — not just until validate passes.

## Format in 30 seconds
```
---
master: ./theme.slaide.yaml      # path, or "aurora" (bundled); omit → aurora
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

## The master (theme)
Use the bundled theme — omit `master:` or set `master: aurora` — or author your own (preferred for branded decks). **Read `themes.md` for the format before writing one**: fonts, a type scale, two-tier colour (palette + roles), gradients, backgrounds, grid layouts, chrome — all data. Reference **roles, not hex**, so a reskin is a palette swap. Past "tidy", give the deck **one signature** (a recurring accent panel, a distinctive layout rhythm, or a colour-block motif) and vary composition slide to slide. Chrome `logo:` is opt-in — only add it when the user supplies a real brand logo; do NOT invent a generic icon. The load-bearing footguns — dark-on-dark text, hollow `box:` cards, chrome-corner collisions — are flagged in `themes.md`; heed them. A deck about slaide itself: use the shipped brand in the sibling `slaide-hugo` repo, don't invent one.

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

**Handing the deck to anyone or any app: `pack <deck> -o out.slaidec` — always the `.slaidec`, never a bare `.slaide`.** A `.slaide` without its master + assets renders unthemed everywhere else; `.slaidec` is the self-contained bundle.

If Playwright is missing: `npx playwright install chromium` once.
