# slaide grammar (v1)

A formal grammar for the `.slaide` document layer. Notation: EBNF — `=` defines, `|` alternation, `{ }` zero-or-more, `[ ]` optional, `( )` grouping, `"x"` literal, `…` charset prose. The Markdown *inside* slot content is CommonMark and is not re-specified here; this grammar defines slaide' structural envelope, sigils, and the inline/attribute extensions, plus the master value forms.

This file is the **precise structural reference**. For what each construct *does* — usage, examples, the full transition/entrance catalogs, chart/image/media options, and the `validate` diagnostic codes — see [spec.md](spec.md); for master semantics (colours, type scale, layouts, slot styles) see [themes.md](themes.md). The token sets are generated from the engine (`src/vocab.ts`) and kept in sync by `test/docs-sync.test.ts`.

## 1. Document

```ebnf
deck            = [ headmatter ] , slide , { separator , slide } , [ NL ] ;
headmatter      = fence , config-block , fence ;
slide           = [ frontmatter ] , body ;
frontmatter     = config-block , fence ;          (* see §2 detection rule *)
separator       = NL , fence ;                     (* a line that is exactly "---" *)
fence           = "---" , EOL ;
NL              = newline ;
```

A deck is an optional headmatter block, then one or more slides separated by a bare `---` line. `headmatter` is the first fenced config block. Each slide is an optional fenced frontmatter block followed by a body.

## 2. Frontmatter-vs-body detection (the load-bearing rule)

A block immediately after a separator (or the leading fence) is **frontmatter** iff **both**:
1. every non-blank, non-`#comment` line matches `config-line` (a `key:`/`~key:`/list-continuation), **and**
2. it is terminated by a `fence` before the body begins.

Otherwise the block is `body`. Consequences the parser guarantees:
- The **first** config-like fenced block in the file is `headmatter`.
- A body whose first line merely *contains* a colon (e.g. `We offer: Tooling`) is **not** frontmatter (it is not `key:`-only and has no trailing fence).
- A config-shaped block whose keys are **none of** the known slide keys (`layout`, `background`, `transition`, `variant`, `chrome`, `footer`, `logo`, `morph`, …) is still read as frontmatter, **but** the compiler emits an `ambiguous-frontmatter` warning — so a spec-sheet body (`Name: …` / `Founded: …`) eaten as config is no longer silent.
- To force a body that would otherwise look config-like, escape its first line with a leading backslash (`\Name: Acme`) or precede the slide with an empty frontmatter (`---` `---`).
- Malformed YAML in a config block emits a `bad-config` warning (with the parser message) instead of silently rendering with defaults.

```ebnf
config-block    = { config-line | comment | blank } ;
config-line     = [ "~" ] , key , ":" , [ value ] , EOL ;
key             = ident ;
comment         = "#" , … , EOL ;
ident           = letter , { letter | digit | "-" | "_" } ;
```

`value` and nested structures follow YAML. A leading `~` on a key marks a **cascading** default (applies to this slide and all following until overridden); a bare key is **scoped** to its slide.

## 3. Fences vs code

`---` is a separator **only outside** a fenced code region. Inside ```` ``` ```` / `~~~` fences it is literal text.

```ebnf
code-fence      = ("```" | "~~~") , [ info-string ] , EOL , { any-line } , ("```" | "~~~") , EOL ;
```

A code fence whose `info-string` is a renderable type is rendered, not listed as code: `svg` (inline vector), `embed` (its body is a URL → sandboxed `<iframe>`), `widget` (its body is HTML/JS → `sandbox="allow-scripts"` srcdoc iframe, theme tokens injected), `mermaid` (diagram DSL → inline SVG), `echart` (ECharts `option` as JSON/YAML → inline SVG). Other info-strings render as code. CommonMark GFM pipe tables are supported as ordinary body content.

Media uses the image syntax with a media extension: `![alt](clip.mp4)` / `![alt](track.mp3)` → `<video>`/`<audio>` (see §6).

## 4. Body

```ebnf
body            = { region-marker | note | content-line } ;
region-marker   = "::" , WS , slot-name , WS , "::" , EOL ;
slot-name       = ident ;                          (* valid names are per-layout *)
note            = "???" , [ WS ] , inline-text , EOL , { non-blank-line } ;
content-line    = markdown-line ;                  (* CommonMark, with §5–§7 extensions *)
```

- `region-marker` routes following content into the named slot until the next marker or separator. Content before any marker → the layout's main slot.
- A line starting `::` that is **not** a well-formed `region-marker` (e.g. `::name`, no spaces, or trailing content after the closing `::`) emits a `bad-region` warning and is kept as literal content — it is not silently dropped.
- `note` (a `???` line and its continuation until a blank line) is a speaker note: shown in the presenter overlay, omitted from audience view and PDF.

### 4.1 Build sigil

```ebnf
build           = content , WS , ">>>" , EOL ;
```

A list item or block ending with `>>>` becomes an incremental build step. Steps auto-number in document order (a shared per-slide counter); identical effective step → simultaneous. In PDF all builds are settled (shown).

### 4.2 Escaping sigils

A leading backslash turns a slaide sigil into literal content (the backslash is removed):

| Write | Renders as | Instead of |
|---|---|---|
| `\:: word ::` | literal `:: word ::` | a region marker |
| `\??? text` | literal `??? text` body | a speaker note |
| `… \>>>` | literal trailing `>>>` | a build step |
| `\[text]{.cls}` | literal `[text]{.cls}` | a styled span (and skips class validation) |
| `\Name: Acme` (first body line) | body line | frontmatter (see §2) |

## 5. Inline styled spans

```ebnf
span            = "[" , inline-text , "]" , "{" , class , { class } , "}" ;
class           = "." , class-name ;
class-name      = ident ;                           (* resolved against the master *)
```

Classes chain (`[40-80%]{.grad-purple .huge}`). Resolution (see themes.md → *Marks / utility classes*):
- `.grad` → brand gradient text; `.grad-<name>` → named gradient text.
- `.<color>` → text color, where `<color>` is a `palette` key, `roles` name, or a literal CSS colour.
- `.xs .sm .md .lg .xl .xxl .huge` → font-size (type-scale steps `small`…`stat`).
- `.bold`, `.muted`, and image utilities `.round`, `.cover`, `.shadow`.

A class that is **none** of the above (e.g. a typo like `.xxlarge` or `.grad-teel`) emits an `unknown-class` / `unknown-gradient` warning rather than silently degrading to inert/invisible CSS. A `{…}` brace that isn't a valid dot-class list at all (missing the leading dot, empty, or otherwise malformed) emits a `bad-span` warning instead — never on a plain link `[text](url)` or a `[1]`-style reference, which don't have this shape. Run `slaide slots <deck>` to print the legal slot, colour, gradient and size names for a deck's master; `slaide validate <deck> [--strict]` surfaces all diagnostics (`--strict` makes warnings fail).

## 6. Image & attribute brace

```ebnf
image           = "![" , alt , "](" , src , [ WS , quoted ] , ")" , [ attr-brace ] ;
attr-brace      = "{" , WS , { attr , WS } , "}" ;
attr            = id-attr | class | kv-attr | anchor-attr ;
id-attr         = "#" , ident ;
kv-attr         = key , "=" , value-token ;         (* e.g. width=170px — unquoted, units ok *)
anchor-attr     = "anchor" , ":" , WS , '"' , pct , WS , pct , WS , pct , WS , pct , '"' ;
value-token     = { non-space-non-brace } ;
pct             = number , "%" ;
```

One brace may mix `#id`, `.class`, `key=value`, and `anchor:"…"` in any order. `#id` enables shared-element **morph** to a same-id element on the next slide (`transition: morph`).

## 7. Placeholders

```ebnf
placeholder     = "{{" , WS , ph-name , WS , "}}" ;
ph-name         = ident ;
```

Substituted at compile time inside chrome bands and master text. Names: `page`, `total`, `pagePadded`, `totalPadded`, `date`, `title`, `author`, `slideTitle`, `footer`, plus any scalar headmatter/frontmatter key. Unknown names resolve to empty (with a warning).

## 8. Master (`*.slaide.yaml`) value forms

The master is YAML; this section pins the slaide-specific value vocabulary (see themes.md for full semantics).

```ebnf
master          = mapping of:
                  "schema" , "name" , [ "description" ] ,
                  [ "canvas" ] , [ "fonts" ] , [ "typeScale" ] , [ "colors" ] ,
                  [ "gradients" ] , [ "tokens" ] , [ "backgrounds" ] ,
                  [ "variants" ] , [ "transitions" ] , [ "chrome" ] , [ "ui" ] , [ "layouts" ] ;
ui              = { [ "progress": boolean ] } ;     (* web position indicator; default true *)

typeScale       = { "base": dim , "ratio": number , "steps": { step-name : (integer | dim) } } ;
dim             = number , ("px"|"em"|"rem"|"%"|"vw"|"vh") ;
color-ref       = "{palette." , ident , "}" | "{" , ident , "}" | css-color ;
gradient-ref    = "{gradients." , ident , "}" | gradient-name ;

layout          = { "areas": [ area-row , { area-row } ] ,
                    [ "rows" ] , [ "cols" ] , [ "gap" ] , [ "padding" ] ,
                    [ "align": ("start"|"center"|"end") ] ,
                    [ "background": bg-name ] ,
                    [ "chrome": ("both"|"header"|"footer"|"false") ] ,
                    [ "logo": false ] ,
                    "slots": { slot-name : slot } } ;
area-row        = string ;                          (* space-separated slot names; rectangular *)
slot            = { "type": slot-type , [ "style": style-map ] } ;
slot-type       = "title"|"subtitle"|"body"|"image"|"media"|"quote"|"caption"| ident ;
style-map       = { style-key : style-val } ;
style-key       = "font"|"size"|"color"|"fill"|"align"|"valign"|"justify"
                | "weight"|"leading"|"transform"|"italic"|"maxw"|"box" ;

chrome          = { [ "header": band ] , [ "footer": band ] ,
                    [ "logo": svg-string ] , [ "logoPos": corner ] } ;
band            = { [ "left": tmpl ] , [ "center": tmpl ] , [ "right": tmpl ] } ;
tmpl            = string ;                           (* Markdown-inline + placeholders *)
corner          = "top-left"|"top-right"|"bottom-left"|"bottom-right" ;
```

## 9. Reserved tokens (summary)

| Token | Context | Meaning |
|---|---|---|
| `---` | line | slide separator / config fence (outside code fences) |
| `:: name ::` | line | region/slot marker |
| `>>>` | end of line/item | build step |
| `???` | line start | speaker note |
| `~key:` | frontmatter | cascading default |
| `[t]{.c}` | inline | styled span |
| `{#id .c k=v anchor:"…"}` | after image | attributes |
| `{{name}}` | chrome/master text | placeholder |
| `![alt](x.mp4\|.mp3)` | inline | video / audio |
| ```` ```svg ```` | fence | inline vector embed |
| ```` ```embed ```` / ```` ```widget ```` | fence | sandboxed iframe (URL / inline JS) |
| ```` ```mermaid ```` / ```` ```echart ```` | fence | chart → inline SVG (diagram / data viz) |
| `\` (leading) | before a sigil | escape to literal (`\::`, `\???`, `\>>>`, `\[t]{.c}`) |
