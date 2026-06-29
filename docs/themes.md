# slaide master / theme authoring

A **master** is a YAML file defining the whole visual system as data, so one theme serves many decks and an agent can both *use* and *author* it. Reference it from a deck with `master: ./your-theme.slaide.yaml`, or use a bundled theme by name (`master: aurora`); omit `master:` and you get `aurora`.

## Top-level shape

```yaml
schema: slaide/1
name: my-theme
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
    align: center
    areas: ["title", "subtitle"]
    rows: "auto auto"
    slots:
      title:    { type: title,    style: { font: display, size: h1, weight: "900" } }
      subtitle: { type: subtitle, style: { size: h3, color: accent } }
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

**Use real Google Fonts only** (`provider: google`) — pick families that actually exist on Google Fonts and embed (avoid **JetBrains Mono**, which doesn't). A `display` (headings) + a `sans` (body) is plenty; add a `mono` role only if the deck shows code. A `provider: system`/`local` font that isn't a common system font (Arial, Calibri, Georgia…) **warns** (`non-embeddable-font`): it won't embed in the `.pptx`, so PowerPoint substitutes it off your machine.

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

Named layers referenced by layouts (`background: cover`) or slides. Native types: **`solid`**, **`gradient`** (linear only — `stops` + `angle`), **`image`** (`src`, `fit`, `dim`). **There is no `radial` type** — for a dark hero glow, point an `image` background at an SVG with a `radialGradient` (a small file or `data:` URI).

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

Header/footer bands + a corner logo on every slide (toggle per layout/slide). Band cells `left`/`center`/`right` may hold `{{placeholders}}`; `logo` is inline SVG (inherits text colour via `currentColor`); `logoPos` ∈ `top-left|top-right|bottom-left|bottom-right`.

```yaml
chrome:
  header: { right: "{{date}}  |  © {{company}}" }
  footer: { left: "{{footer}}", right: "{{pagePadded}} / {{totalPadded}}" }
  logoPos: top-left
  logo: '<svg viewBox="0 0 96 40" fill="none" stroke="currentColor" stroke-width="2.1"><path d="M2 35 L17 6 L32 35"/></svg>'
```

Per layout: `chrome: header|footer|both|false` and `logo: false`; per-slide frontmatter overrides both. **A header/footer corner cell and the `logo` in the *same* corner overlap silently — put them in different corners.**

## ui

`ui: { progress: true }` — web position bar + counter (default on; never affects PDF). Per-deck override: `progress: false` in headmatter.

## layouts

Grid templates. `areas` = a `grid-template-areas` map (each entry = one row of space-separated slot names); `slots` = the typed regions content routes into. Optional `align: start|center|end` (vertical), `rows`, `cols`, `gap`, `padding`, `background`, `variant`. Keep `areas` rectangular; every slot in `slots` must appear in `areas`.

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

**Slot `type`** defaults: `title`, `subtitle`, `body`, `image`, `media`, `quote`, `caption`.

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
| `maxw` | max-width (title wrap control) | e.g. `"14ch"` |
| `box` | surface panel (bg + padding + radius) | `true`, a colour role/palette name (preferred), a **named master gradient** (`box: brand` → padded, rounded, gradient hero/closing panel), or a raw hex / CSS colour / gradient |
| `bg` | background of the slot region | any CSS colour / gradient (literal) |
| `anchor` | absolutely position the slot | `"x% y% w% h%"` of the canvas |

`color:`/`box:`/`fill:` are validated against the master — an unresolved name warns, so `validate` can't call an invisible-text slide valid. Run `slaide slots` for legal names.

## Marks / utility classes

Inline `[text]{.class}` resolves against this master: **colour** = any `palette`/`roles` name; **gradient** = `.grad` (→ `brand`) and `.grad-<name>`; **size** = only `.xs .sm .md .lg .xl .xxl .huge` (→ `small caption h3 h2 h1 hero stat`; custom steps aren't inline-addressable — use slot `size:`); **utility** `.bold` `.muted`, image `.round` `.cover` `.shadow`.

## Bundled `aurora` layouts

`cover`, `title-content`, `section`, `two-cols`, `image-right`, `image-left`, `content-sidebar`, `quote`, `full-bleed`, `blank`. (Bundled `two-cols` ≠ a custom theme's `two-col` — names are per-theme.)

## Tips for AI authors

- Reference **roles** and **scale steps**, not raw hex/px, so a reskin is a palette swap. Add a layout by adding an `areas` map + `slots` — no code.
- **Cards (`box:`) — kill hollow tops.** A `box:` is bg + padding + radius only (solid colour — **no gradient/shadow/border**). With no `valign` a card **stretches to its grid row** and pins text to the top — hollow in a tall `1fr` row. Two fixes: **`valign: center`** shrinks the card to its content and centres it; or, to keep a row of cards equal height, put them in an **`auto`** row and centre that block with spacer rows (`rows: "auto 1fr auto 1fr"`). On a light ground, tint the card surface off-white vs the page so it reads.
- **Signature, not just tidy:** give the deck one repeated motif (a faint logo-derived shape or a recurring accent panel) and vary composition slide to slide. Make the **cover and closing command** — don't leave half the canvas empty: pair a strong text column with a full-height brand/gradient panel or full-bleed motif.
- **Inline `svg` needs a size:** give the `<svg>` explicit `width`/`height`, or a centered zero-size SVG collapses and vanishes.
- **A deck about slaide itself?** Use the shipped brand in the sibling `slaide-hugo` repo (`themes/slaide/assets/css/slaide.css` `:root`; `static/images/slaide-*.svg`): slate-azure gradient `#243B6B→#3E6FB0→#6FA8DC` on cream `#FBF7F0` / ink `#15120E`; IBM Plex Sans + JetBrains Mono + Fraunces.
