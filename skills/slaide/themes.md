# slaide master / theme authoring

A **master** is a YAML file defining the whole visual system as data, so one theme serves many decks and an agent can both *use* and *author* it. Reference it from a deck with `master: ./your-theme.slaide.yaml`, or use a bundled theme by name (`master: aurora`); omit `master:` and you get `aurora`.

## Top-level shape

```yaml
schema: slaide/1
name: my-theme
brand:     { name, palette, fonts, logo, source, locked }   # optional: locked brand identity
canvas:    { aspect: "16:9", width: 1920, height: 1080 }   # fixed design space, scaled to fit
fonts:     { … }          # named roles, auto-imported from Google
typeScale: { … }          # named size steps
colors:    { palette, roles }
gradients: { … }          # named CSS gradients (for .grad text + slot fill)
tokens:    { … }          # raw CSS custom-property overrides
backgrounds:{ … }         # named background layers
variants:  { … }          # scoped token overrides
transitions:{ default, duration }
chrome:    { header, footer, logo, logoPos }
ui:        { progress }
layouts:   { … }          # grid templates with typed slots
```

Sizes are in canvas px; the runtime scales each slide to fit (letterboxed). Match your source design (e.g. `1920×1080`) so px == design pt.

## Minimal master (copy, then customise)

A complete, compiling starter. Swap the palette + fonts for the brand, add layouts as needed.

```yaml
schema: slaide/1
name: my-theme
canvas: { aspect: "16:9", width: 1280, height: 720 }
fonts:
  sans:    { family: "Inter",    provider: google, weights: [400, 600, 700] }
  display: { family: "Fraunces", provider: google, weights: [600, 900] }
typeScale:
  base: "26px"
  ratio: 1.2
  steps: { h1: 4, h2: 3, h3: 2, body: 0, caption: -1 }
colors:
  palette: { ink: "#0B1220", paper: "#F8FAFC", brand: "#3B82F6" }
  roles:
    background: "{palette.ink}"
    text:       "{palette.paper}"
    heading:    "{palette.paper}"
    accent:     "{palette.brand}"
layouts:
  cover:
    areas: ["title visual", "subtitle visual"]
    rows: "auto auto"
    cols: "1.1fr 0.9fr"
    gap: "0.5em 3em"
    slots:
      title:    { type: title,    style: { font: display, size: h1, weight: "900" } }
      subtitle: { type: subtitle, style: { size: h3, color: accent } }
      visual:   { type: media }   # a photo FILLS its box; use `image` only for logos/diagrams
  title-content:
    areas: ["title", "body"]
    rows: "auto 1fr"
    slots:
      title: { type: title, style: { size: h2 } }
      body:  { type: body }
  section:
    align: center
    areas: ["title"]
    rows: "1fr"
    slots:
      title: { type: title, style: { font: display, size: h1, align: center } }
```

## fonts / typeScale

**Use real Google Fonts only** (`provider: google`) — pick families that actually exist on Google Fonts. A `display` + `sans` is plenty; add `mono` only if the deck shows code. A `provider: system`/`local` font that isn't a common system font (Arial, Calibri, Georgia…) **warns** (`non-embeddable-font`): it won't embed in `.pptx`.

```yaml
fonts:
  sans:    { family: "Open Sans", provider: google, weights: [400, 600, 700] }
  display: { family: "Open Sans", provider: google, weights: [800] }
typeScale:
  base: "26px"
  ratio: 1.2
  steps: { stat: "104px", hero: "82px", h1: "66px", h2: "44px", h3: "34px", h4: "28px", body: "26px", caption: "21px", small: "18px" }
```

A step is an explicit size string (`"72px"`, exact — recommended) **or** an integer exponent on the modular scale (`base × ratio^step`). Canonical names `stat hero h1 h2 h3 h4 body caption small` (add your own); `body`/`caption`/`small`/`h*` also size Markdown text & headings.

## colors / gradients

Two tiers: `palette` = raw named colours; `roles` = semantic aliases referencing palette via `{palette.x}`. Content/layouts reference **roles** so a reskin swaps the palette. Both palette keys and role names work as inline classes (`[x]{.blue}`, `[x]{.accent}`).

```yaml
colors:
  palette: { navy: "#0B1220", white: "#F8FAFC", blue: "#5B8CFF", muted: "#8B93A7" }
  roles:   { background: "{palette.navy}", text: "{palette.white}", heading: "{palette.white}", accent: "{palette.blue}", muted: "{palette.muted}" }
gradients:
  brand:  "linear-gradient(100deg, #5B8CFF 0%, #A855F7 50%, #2DD4BF 100%)"   # .grad → this one
  purple: "linear-gradient(120deg, #A855F7, #EC4899)"                         # .grad-purple
```

## brand

Optional. Names/locks the brand identity a deck is themed for — the master's own `colors:`/`fonts:` blocks **are** the brand, no separate copy here. When `locked: true`, a hosted AI edit treats the block as read-only and won't drift it — only the user changes it.

```yaml
brand:
  name: "Acme"
  logo: "<svg>…</svg>"   # inline mark, or an asset reference
  locked: true
```

## tokens

Raw CSS custom-property overrides (spacing, chrome metrics, chart + code styling). Exact names below — a misspelling is silently ignored.

```yaml
tokens:
  "--slide-padding": "96px"      # content inset
  "--chrome-pad": "96px"         # header/footer/logo horizontal inset
  "--chrome-top": "54px"  "--chrome-bottom": "54px"   # band / corner-logo offsets
  "--chrome-size": "22px"  "--chrome-foot-size": "24px"  "--logo-h": "40px"
  "--chart-colors": "#5B8CFF, #A855F7, #2DD4BF"        # ordered series palette for ```echart
  "--code-bg": "#0E0B07"  "--code-fg": "#FBF7F0"  "--code-inline-bg": "#F0E8D9"
  "--code-pad": "1.1em 1.3em"  "--code-radius": "12px"   # note `--code-pad`, not `-padding`
```

The `--code-*` tokens are the only way to style code panels (no per-fence highlighting); set them in `tokens:` to restyle every `pre`/`code` at once.

## backgrounds

Named layers referenced by layouts (`background: cover`) or slides. Native types: **`solid`**, **`gradient`** (linear only — `stops` + `angle`), **`image`** (`src`, `fit` — `cover`/`contain`/`stretch` or any CSS `background-size` —, `position`, `repeat`, `dim`). **There is no `radial` type** — for a dark hero glow, point an `image` background at an SVG with a `radialGradient` (a small file or `data:` URI).

For a full-bleed photo on ONE slide without a master entry, set it inline in the slide's frontmatter: `bg-image:` (+ `bg-size`/`bg-position`/`bg-repeat`/`bg-dim`) — it paints the same background layer, so text flows over it with no slot (see spec.md §3). Prefer this over putting a background photo in an `image`/`media` slot.

```yaml
backgrounds:
  cover: { type: gradient, stops: ["#0B0B12", "#191933"], angle: 130 }
  hero:  { type: image, src: "./assets/hero-glow.svg", fit: cover }   # dark rect + radialGradient
  plain: { type: solid, color: "{palette.navy}" }
```

> **Split (two-tone) backgrounds break the contrast lint.** `low-contrast` resolves one worst-case background per slide, so a hard-edge `split` gradient makes every text slot fail `--strict`. For a two-tone slide, give each side its own slot `box:`/`bg:` surface instead.

## variants

Scoped token overrides invoked by one word from a slide (`variant: light`):

```yaml
variants:
  light: { roles: { background: "#EEEFF1", text: "#0B1220", heading: "#0B1220" } }
```

## chrome

Header/footer bands + a corner logo on every slide (toggle per layout/slide). Band cells `left`/`center`/`right` may hold `{{placeholders}}`; `logo` is inline SVG (inherits text colour via `currentColor`); `logoPos` ∈ `top-left|top-right|bottom-left|bottom-right`. `logo`: may be raw markup (`<img>`/`<svg>`/text) or a bare image URL — a URL is auto-wrapped in `<img>`. `logo` may instead be `{ dark: <mark>, light: <mark> }` — picked per slide by its resolved ground (`dark` = the mark for a dark background, `light` = for a light one), so a light-on-dark wordmark never lands unreadable on a light slide; one key alone is used everywhere.

```yaml
chrome:
  header: { right: "{{date}}  |  © {{company}}" }
  footer: { left: "{{footer}}", right: "{{pagePadded}} / {{totalPadded}}" }
  logoPos: top-left
  logo: '<svg viewBox="0 0 96 40" fill="none" stroke="currentColor" stroke-width="2.1"><path d="M2 35 L17 6 L32 35"/></svg>'
```

Per layout: `chrome: header|footer|both|false` and `logo: false`; per-slide frontmatter overrides both. **A header/footer corner cell and the `logo` in the *same* corner overlap silently — put them in different corners.**

**Cover and outro/closing slides carry no page number** — layouts named `cover`/`outro`/`closing`/`thanks`/`end` get their footer suppressed automatically unless the slide/layout sets `chrome:` explicitly. So a numbered footer never lands on the title or closing slide.

## ui

`ui: { progress: true }` — web position bar + counter (default on; never affects PDF). Per-deck override: `progress: false` in headmatter.

## layouts

Grid templates. `areas` = a `grid-template-areas` map (each entry = one row of space-separated slot names); `slots` = the typed regions content routes into. Optional `align: start|center|end` (vertical), `rows`, `cols`, `gap`, `padding`, `background`, `variant`. Keep `areas` rectangular; every slot in `slots` must appear in `areas` — a slot key missing from `areas` falls back to the same default cell as any other missing slot, so `validate` warns (`overlapping-slots`) when two or more do.

```yaml
layouts:
  statement:
    background: navy
    align: center
    areas: ["title title title", "s1 s2 s3"]
    rows: "auto 1fr"
    cols: "1fr 1fr 1fr"
    gap: "3em"
    slots:
      title: { type: title, style: { size: h1, weight: "800" } }
      s1: { type: body, style: { align: center, valign: center } }
      s2: { type: body, style: { align: center, valign: center } }
      s3: { type: body, style: { align: center, valign: center } }
```

**Slot `type`** — `title`, `subtitle`, `body`, `image`, `media`, `quote`, `caption`. When to use which for pictures:

- **`media`** — a photo/screenshot that must **FILL its box edge-to-edge** (cover crop, no margins). This is the type for hero photos, split-layout imagery, full-bleed visuals — i.e. almost every photograph.
- **`image`** — **contained**: the whole picture stays visible inside the box with margins. Logos, diagrams, QR codes, charts-as-images only. A scene photo in an `image` slot floats small in empty space — the #1 boxed-thumbnail failure.
- There is **no `fit:` style key** — the slot *type* decides fill vs contain.

> **Dark sections — read this or you ship invisible text.** A layout's `background` and its slots' text colour resolve **independently**; roles default to the *light* variant, so a dark `background` with default-role slots renders **dark-on-dark**. Fix: bind **`variant: dark`** to the layout (roles flip automatically — cleanest), or set explicit light `color:` on the slots. The compiler emits **`low-contrast`** when resolved text ≈ background (≈ under 2.5:1, including a `box:` panel's own surface), so `--strict` catches it. Bold/links inherit surrounding colour — never hand-colour a dark span onto a dark ground.

> **`align` centers the whole grid (title included).** To pin the title top and centre only the body, leave layout `align` unset and put `valign: center` on the **content** slots (in a tall `1fr` row).

### Slot `style` keys (all optional)

| key | effect | accepts |
|---|---|---|
| `font` | font-family | font role (`display`) |
| `size` | font-size | type-scale step (`h1`) **or** explicit (`"72px"`) |
| `color` | text colour | a role/palette **name** (preferred — stays on-theme). A raw hex / CSS colour (`"#0af"`, `rgb(...)`) also works as an escape hatch but is best avoided; prefer adding the colour to the palette. An unknown **name** (not a hex/CSS colour) **warns** |
| `fill` | gradient **text** fill | gradient name (`brand`); unknown **warns** (`unknown-gradient`) |
| `align` | horizontal **text** align | `left`/`center`/`right` |
| `valign` | **vertical** align in cell | `top`/`center`/`bottom` |
| `justify` | horizontal self-align in cell — use for an **image/box** (`align` only moves text) | `left`/`center`/`right` |
| `weight` / `leading` / `transform` / `italic` | weight / line-height / `uppercase` / `true` | — |
| `maxw` | max-width (wrap control). Body 30–40ch; a LONG hero title 16–22ch; a 2–3 word title gets **no maxw** (it wraps ugly and narrows the box) | e.g. `"36ch"` |
| `box` | surface panel (bg + padding + radius) | `true`, a colour role/palette name (preferred), a **named master gradient** (`box: brand` → padded, rounded, gradient hero/closing panel), or a raw hex / CSS colour / gradient |
| `bg` | background of the slot region | any CSS colour / gradient (literal) |
| `anchor` | absolutely position the slot | `"x% y% w% h%"` of the canvas |
| `pad` / `opacity` / `radius` / `border` / `rotate` | fine control — padding / opacity / border-radius / border / rotation (also emitted by the importer) | CSS values (`rotate` accepts a bare deg or a full `transform`) |

`color:`/`box:`/`fill:` are validated against the master — an unresolved name warns, so `validate` can't call an invisible-text slide valid. Run `slaide slots` for legal names.

## Marks / utility classes

Inline `[text]{.class}` resolves against this master: **colour** = any `palette`/`roles` name; **gradient** = `.grad` (→ `brand`) and `.grad-<name>`; **size** = only `.xs .sm .md .lg .xl .xxl .huge` (→ `small caption h3 h2 h1 hero stat`; custom steps aren't inline-addressable — use slot `size:`); **utility** `.bold` `.muted`, image `.round` `.cover` `.shadow`.

## Bundled `aurora` layouts

`cover`, `title-content`, `section`, `two-cols`, `image-right`, `image-left`, `content-sidebar`, `quote`, `full-bleed`, `blank`. (Bundled `two-cols` ≠ a custom theme's `two-col` — names are per-theme.)

## Tips for AI authors

- Use **roles** and **scale steps**, not raw hex/px — reskin = palette swap.
- **Cards (`box:`):** bg + padding + radius only (no gradient/shadow/border). Without `valign` a card stretches full-height and pins text top (hollow). Fix: `valign: center` to shrink-wrap, or put cards in an `auto` row with `1fr` spacers. Tint card surface off-white vs the page.
- **Cover = dramatic hero.** Visual slot FILLS — bold brand SVG, product mock, or illustrated motif at ≥ half the slide, not a small icon. Think Apple keynote: few bold shapes at large scale. Centred text on a gradient is a section divider, not a cover. Never `.grad` text on a gradient bg (vanishes). **Closing** = bold CTA or contact slide (name/role/email/URL for pitch/agency decks). Both must feel intentional.
- **Brand ground dominates.** Most slides use the brand's background role (warm cream, tinted neutral — not generic white). Dark/gradient = accent moments only (cover, one stat, closing).
- **No text-only slides — no exceptions.** Every content slide needs a visual: ` ```echart ` for data, inline ` ```svg ` for diagrams/mockups (preferred — precise, brand-styled), `box:` cards, or a stat callout. A comparison/pro-con slide is NOT exempt: use cards, a table, or SVG icons. Mix visual types across the deck — all-SVG or all-cards = monotone.
- **Vary composition.** Never repeat the same layout archetype — two text+visual slides need structurally different layouts (not image-left twice). Mix archetypes, alternate dark/light grounds. One slide should break the pattern — oversized `.grad` stat, serif quote owning the canvas, or full-bleed visual.
- **One idea per slide.** Each slide delivers one clear message (4 bullets max). The visual and text reinforce the SAME idea — if the visual still communicates without the text, that's right.
- **Size contrast.** Pair `hero`/`stat` scale with body text. At least one slide MUST feature a single big number or statement using `.huge` (the inline class for the `stat` size) — the audience remembers ONE number from every deck. No decorative accent lines under titles (AI tell).
- **Use every font role** defined in the master (serif, display, mono).
- **Whitespace.** `--slide-padding` ≥ 96px, `gap` ≥ 2em. `auto` rows for content, `1fr` spacers to centre. Cards need `pad`.
- **Avoid `<a>` links in slides.** They aren't clickable during presentations and their `link` role color can override slot `color:`. Write URLs as plain text; style with `[text]{.class}` spans.
- **Muted text must read at projection scale.** Keep well above 2.5:1 contrast. Never use light-ground `muted` inside a dark `box:`/`bg:` card — set explicit light `color:` instead.
- **Inline SVG:** explicit `width`/`height` required (collapses without them). Images fill their container (the layout controls sizing via grid areas + padding).
- **Academic / teaching decks** (symposia, lectures, workshops): clarity over flash. Favour ` ```svg ` / ` ```mermaid ` diagrams for processes and systems, ` ```echart ` for data/results. Use `>>>` heavily for progressive build. Larger body text (≥ h3). Section dividers between topics. End with summary/takeaways/questions, not a sales CTA. High-contrast, clean backgrounds.
- **Financial / board reports**: data credibility first. Heavy ` ```echart ` (bar, line, waterfall, pie). Stats use `.huge` with exact numbers. Comparison tables via `box:` card grids (Plan vs Actual). Conservative palette — dark text on light ground, accent on KPI highlights only. Section dividers per business unit or period. Cover = clean title + period, not a hero. End with outlook/risks.
- **A deck about slaide?** Brand from `slaide-hugo` repo: azure `#243B6B→#3E6FB0→#6FA8DC`, cream `#FBF7F0`, ink `#15120E`; IBM Plex Sans + JetBrains Mono + Fraunces.
