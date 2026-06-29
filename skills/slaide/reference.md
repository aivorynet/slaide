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
| `transition` | `none`,`fade`,`slide-left/right/up/down`,`zoom`,`morph` | Transition **into** this slide. |
| `background` | a master background name | Override the layout's background. |
| `variant` | a master variant name | Scoped token overrides (e.g. a light section). |
| `morph` | an id | Participate in a shared-element morph. |
| `footer` | inline Markdown | Per-slide footer; also `{{footer}}`. |
| `chrome` | `both`,`header`,`footer`,`none`,`false` | Header/footer visibility this slide. |
| `logo` | `false` | Hide the corner logo this slide. |
| *any other scalar* | — | Available as a `{{placeholder}}`. |

**Cascade vs scope:** a bare key (`transition: zoom`) is this-slide-only; a `~`-prefixed key cascades to this slide and every later one until overridden (also valid in headmatter).

## 4. Slide body

- **Regions:** `:: name ::` on its own line routes following Markdown into slot `name`. Text before any marker → the main slot (`body`, else the first slot).
- **Markdown:** standard CommonMark — headings, lists, **bold**, *italic*, `code`, fences, > quotes, links, tables, images. (A single newline is a space; blank line = new paragraph.)
- **Builds `>>>`:** end an item/block with `>>>` to reveal it; steps auto-number in order, same step = simultaneous. PDF shows all.
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

An unknown class warns (`unknown-class`/`unknown-gradient`) — it never silently degrades. Resolved against the master (see [themes.md](themes.md#marks--utility-classes)).

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
