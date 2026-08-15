# Importing PowerPoint (.pptx) & Apple Keynote (.key) → slaide

Convert existing decks into `.slaide` plus a generated master, as faithfully as possible. Grounded in OOXML/IWA research.

## Recommended stack

- **PPTX:** parse the OOXML directly with **`jszip` + `fast-xml-parser`** (both lightweight, TS-native, fit the monorepo). No JS lib cleanly resolves the theme/placeholder *inheritance chain* + autofit we need, so a custom traversal is required anyway. Keep **`python-pptx`** as an optional accuracy oracle for conformance tests.
- **Keynote:** do **not** parse IWA (reverse-engineered protobuf, Snappy-framed, breaks every Keynote release). Instead **convert `.key` → `.pptx` first**, then reuse the PPTX path:
  - macOS + Keynote → `osascript` export (highest fidelity, Apple's own exporter).
  - Legacy `.key` (Keynote '09–'11 / v5) → LibreOffice `soffice --headless --convert-to pptx` (cannot open modern IWA `.key`).
  - Else → clear error: "export to .pptx from Keynote (File → Export To → PowerPoint)".

## OOXML essentials (the load-bearing details)

- `.pptx` = ZIP (OPC). Key parts: `ppt/presentation.xml` (`p:sldSz` cx/cy in EMU → canvas), `ppt/slides/slideN.xml`, `slideLayouts`/`slideMasters` (inherited geometry/text defaults), `ppt/theme/theme1.xml` (clrScheme + fontScheme), `ppt/media/*`, `ppt/slides/_rels/slideN.xml.rels` (rId → media path — **must resolve**).
- **Units:** 914400 EMU/inch, 12700 EMU/pt, 9525 EMU/px@96dpi. Run size `a:rPr/@sz` = hundredths of a point. Position in `p:spPr/a:xfrm` (`a:off`, `a:ext`), rotation in 60000ths°.
- **Autofit (critical):** `a:bodyPr/a:normAutofit/@fontScale` is in **1/1000 of a percent**. The nominal `sz` is *unshrunk*; effective px = `(sz/100) × (fontScale/100000) × (96/72)`. (e.g. a 110pt title PowerPoint auto-shrinks to ~80px — match the rendered size, not the nominal one.)
- **Color:** resolve `a:schemeClr` → RGB via theme `clrScheme` **and** the master `p:clrMap` (python-pptx does NOT resolve scheme colors — known limitation). Resolve every color to RGB before deduping.

## Mapping OOXML → slaide

| OOXML | slaide | Notes |
|---|---|---|
| `sldSz` EMU | `canvas` px | scale all coords by `canvasPx/sldSzEMU` |
| shape `a:off`/`a:ext` | `anchor: "x% y% w% h%"` | % of canvas — resolution-independent |
| theme `clrScheme` | `colors.palette` + inferred `roles` | accent1..6 + dk/lt → palette |
| theme major/minor font | `fonts` (heading/body roles) | |
| effective run px (× fontScale) | `typeScale` step | cluster sizes, snap to nearest step |
| run `b`/`i`/color/size | markdown `**`/`_` + inline `[t]{.role .step}` spans | only when differing from slot default |
| `p:ph` type (title/body/ftr/sldNum) | layout **slot** / chrome | drives layout inference |
| `p:pic` blip→rels→media | `![](assets/…){width anchor}` | extract + dedupe by hash |
| bullets (`buChar`/`buAutoNum`,`lvl`) | markdown lists, nested by lvl | |
| `a:tbl` | markdown table | merged cells degrade |
| background / `a:gradFill` | `backgrounds` / named `gradients` | |
| notes | `??? notes` | clean win |

## Fidelity modes (`--fidelity`)

- **`hybrid`** (default on Windows with PowerPoint) reconstructs an editable deck; anything slaide cannot faithfully draw (charts, SmartArt, custom-geometry art) is rasterized via PowerPoint and anchored.
- **`reconstruct`** is pure, cross-platform, and fully editable (no PowerPoint needed).
- **`exact-raster`** makes each slide a pixel-perfect PNG from PowerPoint (about 99% match; archival, not editable).

All modes compute autofit-effective sizes and resolve scheme colors to RGB, and honour a
picture's `a:srcRect` crop.

## Templates (`--placeholders`)

A layout can carry an empty `<p:ph type="pic"/>` — PowerPoint's click-to-add box. Import drops
it by default, because PowerPoint paints that box in its editor and nowhere else: a finished
deck would gain text the original never shows. Pass `--placeholders` when the input is a
template you intend to author against, and each unfilled box arrives as an image drop zone.

## Architecture

```
detect → (if .key) convert to .pptx → parse (jszip+fast-xml-parser)
  → resolve (EMU→px, rels→media, schemeClr→RGB+clrMap, placeholder inheritance, autofit)
  → Import-IR (rich, lossy-tolerant; NOT deck.ir.json)
  → derive master.yaml from theme + emit .slaide per --fidelity
  → write deck.slaide + master.slaide.yaml + assets/* + import-report.md
```

**Import-IR ≠ compile IR.** `deck.ir.json` is the compiler's *output* (post-cascade, resolved). Import has the opposite problem (messy positioned input → infer intent), so use a dedicated Import-IR whose emitter writes **authoring-layer** `.slaide` + master text — which then re-parses/compiles as a built-in correctness check.

## Graceful degradation (log each in `import-report.md`)

Animations/transitions → drop, keep settled state (optionally map appear-sequences → `>>>`). SmartArt/charts → rasterize + anchor (or extract text). Embedded video/audio → extract + poster + note. Custom geometry/WordArt/3D → rasterize or drop. Text shadows/glows → drop; text gradients → slaide gradient text. Merged table cells → best-effort.

## Phased plan

1. PPTX → `reconstruct` MVP (title/body/image/list, theme colors+fonts, autofit, anchor fallback); verify output re-compiles.
2. `--fidelity hybrid|reconstruct|exact-raster` + layout inference + type-scale clustering.
3. Tables, gradients, backgrounds, notes; rasterize-and-anchor degradation; `import-report.md`.
4. Keynote via `osascript` (macOS) + legacy LibreOffice + manual-export guidance.
5. Conformance: python-pptx / LibreOffice-rendered PDFs as oracles; golden fixtures + the pixel-diff metric (`scripts/diff.ts`).
