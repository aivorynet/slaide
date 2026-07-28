# slaide language specification (v1)

A **deck** is one UTF-8 `.slaide` file: a deck *headmatter* block + one or more slides. Styling lives in a separate reusable **master** (`*.slaide.yaml`, see [themes.md](themes.md)). Write plain Markdown; reference layouts / colours / fonts / classes **by name** from the master. Reach for explicit positioning (`anchor`, `valign`) only when a layout can't express it.

## 1. File structure

```
---                         ← deck HEADMATTER (deck-wide config)
master: ./theme.slaide.yaml
title: My Talk
company: Acme, Inc.          ← any scalar key → {{placeholder}}
~transition: slide-left      ← `~` cascades this default to later slides
---
layout: cover                ← per-slide FRONTMATTER
footer: Hello world
---
:: title ::                  ← route Markdown into slot "title"
My Talk
---                          ← slide separator
## A content slide           ← no frontmatter; body → main slot
- point one    >>>           ← `>>>` reveals as a build step
??? Speaker note (hidden from the audience).
```

- A line that is exactly `---` separates slides. The **first** config block is headmatter; after a separator, a block is **frontmatter** *iff* it is `key:`-only **and** closed by another `---` before the body — else it's body. (A body first line that merely contains a colon, `We offer: Tooling`, stays body. To force body: an empty frontmatter `---`/`---`, or escape the line `\Name: Acme`.) Malformed config → `bad-config` warning.
- **Code fences are sigil-safe:** inside ``` / `~~~` everything is literal — sigils (`---`, `:: name ::`, `??? …`, `>>>`), spans, and `![img]` show verbatim, so a deck can show its own source. Outside fences, escape one line with a leading `\`.
- **Packaging:** the editable form is a folder (deck + master + `assets/`). `slaide pack` zips it into one `.slaidec`; `unpack` reverses. Same language, read transparently; archive is deterministic.

## 2. Headmatter keys

| Key | Meaning |
|---|---|
| `master` | Path to the master (relative to the deck). Omit → bundled default theme. |
| `title`, `author`, `date`, `company`, … | Metadata. **Any** scalar key here → a `{{placeholder}}` (§7). |
| `~<key>` | Set a **cascading default** from here onward (e.g. `~transition: fade`). |
| `progress` | `true`/`false` — web position bar + counter (default `true`; web only, never PDF). |

## 3. Per-slide frontmatter keys

| Key | Values | Meaning |
|---|---|---|
| `layout` | a master layout name | Which grid to use. |
| `transition` | a transition name (§3.1) | Transition **into** this slide. |
| `transition-ms` | milliseconds | Duration override for this slide's transition. |
| `transition-ease` | a CSS easing | Easing override (`ease`, `cubic-bezier(…)`). |
| `background` | a master background name | Override the layout's background. |
| `bg-image` | image URL / asset ref / `data:` URI | Inline full-bleed photo on the slide's background layer (behind the grid — text flows over it, no slot). Wins over `background:`. |
| `bg-size` | `cover`,`contain`,`stretch`, or a CSS `background-size` | How the `bg-image` fills the slide. `stretch` = `100% 100%`. Default `cover`. |
| `bg-position` | a CSS `background-position` | Focal point of the `bg-image` (e.g. `top`, `right`, `50% 20%`). Default `center`. |
| `bg-repeat` | a CSS `background-repeat` | Tiling for the `bg-image`. Default `no-repeat`. |
| `bg-dim` | `0`–`1` | Black multiply overlay over the `bg-image` so text stays legible (e.g. `0.4`). |
| `variant` | a master variant name | Scoped token overrides (e.g. a light section). |
| `morph` | an id | Participate in a shared-element morph. |
| `footer` | inline Markdown | Per-slide footer; also `{{footer}}`. |
| `chrome` | `both`,`header`,`footer`,`none`,`false` | Header/footer visibility this slide. |
| `logo` | `false` | Hide the corner logo this slide. |
| `notes` | inline Markdown | Speaker note for this slide (frontmatter form of a `???` line). |
| *any other scalar* | — | Available as a `{{placeholder}}`. |

**Cascade vs scope:** a bare key (`transition: zoom`) is this-slide-only; a `~`-prefixed key cascades to this slide and every later one until overridden (also valid in headmatter).

### 3.1 Transition names

`transition:` takes one of these built-ins; per-slide `transition-ms` / `transition-ease` override timing, and the master's `transitions: { default, duration }` sets the deck-wide default.

| Group | Names |
|---|---|
| Fades | `none`, `fade`, `dissolve`, `fade-through-black` (alias `fade-black`) |
| Slides | `slide-left` (alias `slide`), `slide-right`, `slide-up`, `slide-down` |
| Push/cover | `push`, `cover`, `reveal` |
| Scale/3-D | `zoom`, `zoom-out`, `flip` |
| Shared-element | `morph` — pairs a `{#id}` image (or a `morph:` id) with the same id on the next slide |

## 4. Slide body

- **Regions:** `:: name ::` on its own line routes following Markdown into slot `name`. Text before any marker → the main slot (`body`, else the first slot). A near-miss (`::` followed by content that isn't `:: name ::` alone on its line, e.g. `::name` or `:: name :: extra`) warns (`bad-region`) instead of silently rendering as literal text.
- **Markdown:** standard CommonMark — headings, lists, **bold**, *italic*, `code`, fences, > quotes, links, tables, images. (A single newline is a space; blank line = new paragraph.)
- **Builds `>>>`:** end an item/block with `>>>` to reveal it; steps auto-number in order, same step = simultaneous. PDF shows all. Add an entrance and timing after the sigil (§4.7).
- **Notes `??? …`:** a `???` line (until a blank line) is a speaker note — presenter overlay only, hidden from audience and PDF.

### 4.1 Inline styled spans — `[text]{.class …}`

Wrap inline text with one or more chainable dot-classes:

```
[Smart Inference]{.grad}   [40-80%]{.grad-purple .huge}   [300+]{.green .lg}   [caption]{.sm .muted}
```

| Class | Effect |
|---|---|
| `.<color>` | text colour — any `palette` key or `roles` name (`.blue`, `.accent`, `.muted`), or a raw hex/CSS colour as an escape hatch (`.#3366ff`, `.tomato`) — palette names preferred |
| `.grad` / `.grad-<name>` | fill text with the `brand` / a named gradient |
| `.xs .sm .md .lg .xl .xxl .huge` | font size (type-scale steps small→…→stat) |
| `.bold` / `.muted` | weight 800 / muted colour |

An unknown class warns (`unknown-class`/`unknown-gradient`) — it never silently degrades. Resolved against the master (see [themes.md](themes.md#marks--utility-classes)). A `{…}` that isn't a valid dot-class list (missing the leading dot, empty, or otherwise malformed) warns (`bad-span`) rather than showing the raw braces; plain links `[text](url)` and `[1]`-style refs are never affected.

### 4.2 Images — `![alt](src){ … }`

Local paths are inlined (portable single file). The `{…}` brace mixes, any order:

| Token | Meaning |
|---|---|
| `#id` | morph target — same id on the next slide morphs into it (`transition: morph`) |
| `.class` | `.round` (circular), `.cover` (fill+crop), `.shadow` |
| `width=170px` / `height=…` | explicit size (bare `key=value`, units ok, unquoted) |
| `anchor: "x% y% w% h%"` | absolute placement in the slot (quoted) |

Example: `![Paul](paul.jpg){.round width=170px}`

### 4.3 Video, audio, embeds

Image syntax + a media extension: `![alt](clip.mp4){ poster=cover.jpg }` → `<video controls>` (add `.autoplay` for muted looping bg); `![alt](track.mp3)` → `<audio>`. In PDF, video → its `poster` (always supply one), audio omitted. Local media inlined up to ~6 MB. For dynamic content (never run in the doc): ` ```embed ` (one URL → sandboxed iframe) and ` ```widget ` (inline HTML/JS → `sandbox="allow-scripts"` srcdoc, theme tokens injected). Both degrade to a static note in PDF.

### 4.4 Inline SVG — ` ```svg `

A fence tagged `svg` renders as a **vector** (inherits theme colour via `currentColor`). **Give it explicit `width`/`height`** — a zero-intrinsic-size SVG in a centered slot collapses and vanishes silently.

### 4.5 Charts — ` ```mermaid ` / ` ```echart `

Both render to **theme-coloured inline SVG** (web/PDF/PNG/PPTX); `slaide build` bakes them to static SVG with no engine left in the file.
- ` ```mermaid ` — diagrams (flowchart, sequence, state, ER, gantt). Match shape to slot: `flowchart TD` tall, `LR` wide.
- ` ```echart ` — ECharts `option` as JSON/YAML; best for data viz. Validated (bad option → `bad-chart` + code-block fallback). Series colours from the master `--chart-colors`.

**Put a chart in a slot with height (a `1fr` row, not `auto`)** or it collapses to a default aspect.

```echart
{ "xAxis": { "type": "category", "data": ["A","B","C"] },
  "yAxis": { "type": "value" },
  "series": [{ "type": "bar", "data": [5,9,7] }] }
```

### 4.6 Tables

GFM pipe tables, styled by the master; use `[cell]{.class}` spans for emphasis.

### 4.7 Build entrances — `>>> <entrance> [opts]`

A bare `>>>` reveals with the default entrance (`fade-up`). Name an entrance right after the sigil, optionally with `delay=`, `dur=` and `ease=` (bare numbers are milliseconds): `- Big reveal >>> zoom-in delay=200 dur=600`. An unknown name warns (`unknown-entrance`) and falls back to the default. A master `animations:` block can define custom entrances too.

| Group | Names |
|---|---|
| Fades | `fade`, `fade-up`, `fade-down`, `fade-left`, `fade-right`, `blur-in` |
| Slides | `slide-in-left`, `slide-in-right`, `slide-in-up`, `slide-in-down`, `rise` |
| Scale | `zoom-in`, `zoom-out`, `pop` |
| Instant | `none` |

## 5. Layers

Each slide composites **background → content → chrome** by paint order. Backgrounds come from the master (per layout or per slide); content flows through the layout's named slots; chrome sits on top.

## 6. Chrome

Defined in the master `chrome:` block (see [themes.md](themes.md#chrome)): header/footer are three-cell bands (`left`/`center`/`right`) with `{{placeholders}}`; a corner `logo` (inline SVG) sits in a chosen corner. Page numbers = `{{page}}`/`{{total}}` in a band. Per-slide `footer:`/`chrome:`/`logo:` override.

## 7. Placeholders — `{{ … }}`

Resolved at compile time in chrome bands and master text. Built-ins + every scalar headmatter/frontmatter key:

| Placeholder | Value |
|---|---|
| `{{page}}` / `{{total}}` | 1-based index / count |
| `{{pagePadded}}` / `{{totalPadded}}` | zero-padded (`05` / `08`) |
| `{{date}}` | `date:`, else today |
| `{{title}}` / `{{author}}` / `{{slideTitle}}` | from headmatter / the slide's first heading |
| `{{footer}}` / `{{<anyKey>}}` | the slide's `footer:` / any scalar key (`{{company}}`) |

Unknown names → empty (with a warning).

## 8. Reserved sigils (cheat sheet)

| Token | Where | Meaning |
|---|---|---|
| `---` | line | slide separator / config fence (outside code fences) |
| `:: name ::` | line | slot marker |
| `>>>` | line end | build step |
| `???` | line start | speaker note |
| `~key:` | frontmatter | cascading default |
| `[t]{.c}` | inline | styled span |
| `{#id .c k=v anchor:"…"}` | after image | attributes |
| `{{name}}` | chrome/master | placeholder |
| ` ```svg ` / ` ```embed ` / ` ```widget ` | fence | vector / sandboxed iframe |
| ` ```mermaid ` / ` ```echart ` | fence | chart → inline SVG |
| `\` (leading) | before a sigil | escape to literal |

## 9. Minimal example

```
---
master: ./aurora.slaide.yaml
title: Hello
---
layout: cover
---
:: title ::
[Hello, world]{.grad}
:: subtitle ::
written in slaide
---
layout: title-content
footer: A first deck
---
## Why it's nice
- Plain text in    >>>
- Beautiful out    >>>
```

See [themes.md](themes.md) to author a master.

## 10. Diagnostics — what `validate` reports

`slaide validate <deck>` prints line-numbered diagnostics; `--strict` makes every warning fail. **Errors** fail regardless of `--strict`; everything else is a **warning** (a real render defect even when the deck "looks valid"). Every code:

| Code | Severity | Meaning |
|---|---|---|
| `parse-error` | error | The source could not be parsed at all. |
| `empty-deck` | error | No slides were found. |
| `no-master` | error | The deck's `master:` could not be resolved. |
| `unknown-layout` | error | A slide's `layout:` names no layout in the master. |
| `unknown-slot` | error | A `:: name ::` region names a slot the resolved layout (explicit `layout:` or the deck's default) doesn't define — the content is silently dropped. |
| `no-headmatter` | warning | No leading `---` deck headmatter block (e.g. `master:`). |
| `bad-config` | warning | A headmatter/frontmatter block is not valid YAML (rendered with defaults). |
| `ambiguous-frontmatter` | warning | A config-shaped **body** was eaten as frontmatter — escape the first line with `\` or add an explicit `---`. |
| `bad-region` | warning | A line starts `::` but isn't a well-formed `:: name ::` marker (alone on its line) — rendered as literal body text. |
| `unknown-transition` | warning | A `transition:` names no built-in transition (§3.1). |
| `unknown-background` | warning | A `background:` names no master background. |
| `unknown-variant` | warning | A `variant:` names no master variant. |
| `overlapping-slots` | warning | Two+ layout slots share one grid cell, or a slot's key is missing from `grid-template-areas` (default-stacks) — content renders on top of other content. |
| `unknown-class` | warning | An inline `[x]{.cls}` is not a size / `.bold` / `.muted` / `.grad` / master colour / CSS colour. |
| `unknown-gradient` | warning | A `.grad-<name>` or slot `fill:` names no master gradient (text gets no fill — often invisible). |
| `bad-span` | warning | A `[text]{…}` brace isn't a valid dot-class list (missing dot, empty/invalid list, unmatched brace) — shown as literal text. |
| `unknown-color` | warning | A slot `color:`/`box:` names no master role/palette or CSS colour (falls back to a literal, often invisible). |
| `unknown-var` | warning | A raw `var(--X)` (e.g. in inline HTML) names no token the master defines — resolves to nothing, often rendering smaller/invisible. Auto-fixed to `var(--X, <fallback>)`. |
| `unknown-entrance` | warning | A `>>> <name>` build entrance isn't a known effect (§4.7). |
| `stray-build` | warning | A `>>>` on a non-list line (headings, bold labels, paragraphs). |
| `low-contrast` | warning | Resolved text ≈ its background (dark-on-dark / light-on-light) — bind a `variant:` or set an explicit `color:`. |
| `bad-chart` | warning | An ````echart` option didn't parse — rendered as a plain code block instead. |
| `bad-animation` | warning | A master `animations:` entry is missing its required keyframes/`hidden` state. |
| `unknown-token` | warning | A master token reference names nothing. |
| `token-cycle` | warning | A master token references itself in a cycle. |
| `non-embeddable-font` | warning | A font won't embed in `.pptx` — PowerPoint will substitute it. |
| `unknown-placeholder` | warning | A `{{name}}` resolves to nothing (renders empty). |
