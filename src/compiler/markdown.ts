// Copyright 2026 Paul Piper
// SPDX-License-Identifier: Apache-2.0
// Markdown -> HTML for a region, including build steps (`>>>`) and image
// attribute syntax (`{#id anchor:"x y w h"}`).
import MarkdownIt from 'markdown-it';
import yaml from 'js-yaml';
import { expandAnchor } from '../util.js';
import type { Warning } from '../types.js';
import { ENTRANCE_NAMES } from '../render/anim.js';

const BUILTIN_ENTRANCES = new Set(ENTRANCE_NAMES);

// CSS named colours — a `[x]{.tomato}` is a legitimate literal colour, not a typo, so
// these are NOT flagged as unknown classes.
const CSS_COLORS = new Set(
  ('aliceblue antiquewhite aqua aquamarine azure beige bisque black blanchedalmond blue blueviolet brown ' +
    'burlywood cadetblue chartreuse chocolate coral cornflowerblue cornsilk crimson cyan darkblue darkcyan ' +
    'darkgoldenrod darkgray darkgreen darkgrey darkkhaki darkmagenta darkolivegreen darkorange darkorchid ' +
    'darkred darksalmon darkseagreen darkslateblue darkslategray darkslategrey darkturquoise darkviolet ' +
    'deeppink deepskyblue dimgray dimgrey dodgerblue firebrick floralwhite forestgreen fuchsia gainsboro ' +
    'ghostwhite gold goldenrod gray green greenyellow grey honeydew hotpink indianred indigo ivory khaki ' +
    'lavender lavenderblush lawngreen lemonchiffon lightblue lightcoral lightcyan lightgoldenrodyellow ' +
    'lightgray lightgreen lightgrey lightpink lightsalmon lightseagreen lightskyblue lightslategray ' +
    'lightslategrey lightsteelblue lightyellow lime limegreen linen magenta maroon mediumaquamarine ' +
    'mediumblue mediumorchid mediumpurple mediumseagreen mediumslateblue mediumspringgreen mediumturquoise ' +
    'mediumvioletred midnightblue mintcream mistyrose moccasin navajowhite navy oldlace olive olivedrab ' +
    'orange orangered orchid palegoldenrod palegreen paleturquoise palevioletred papayawhip peachpuff peru ' +
    'pink plum powderblue purple rebeccapurple red rosybrown royalblue saddlebrown salmon sandybrown ' +
    'seagreen seashell sienna silver skyblue slateblue slategray slategrey snow springgreen steelblue tan ' +
    'teal thistle tomato transparent turquoise violet wheat white whitesmoke yellow yellowgreen ' +
    'currentcolor inherit').split(' '),
);

/** A `[text]{.X}` colour class is legitimate if X is a master role/palette token or a
 *  CSS colour; otherwise it's almost certainly a typo (e.g. `.xxlarge`, `.gradd`).
 *  Exported so slot-style `color:`/`box:` resolution can warn on the same basis. */
export function isKnownColorClass(c: string, tokens: Record<string, string>): boolean {
  return (
    tokens[`--color-${c}`] !== undefined ||
    tokens[`--palette-${c}`] !== undefined ||
    CSS_COLORS.has(c.toLowerCase()) ||
    /^#[0-9a-f]{3,8}$/i.test(c)
  );
}

/** CSS for a colour value used by slot `color:`/`box:` and inline `.colour` spans. A bare
 *  role/palette name resolves through the master tokens (with a literal fallback so CSS
 *  named colours like `tomato` still work); anything that can't be a custom-property name
 *  — a hex (`#0af`), `rgb()/hsl()`, etc. — is emitted directly. Wrapping a hex as
 *  `var(--color-#0af, …)` is invalid CSS: the whole declaration is dropped and the text
 *  silently reverts to the inherited role (often dark-on-dark). A hex is a supported
 *  escape hatch; prefer palette names so the deck stays on-theme. */
export function colorValue(v: string): string {
  const t = String(v).trim();
  return /^[a-zA-Z][\w-]*$/.test(t) ? `var(--color-${t}, var(--palette-${t}, ${t}))` : t;
}

const md: MarkdownIt = new MarkdownIt({
  html: true,
  linkify: true,
  typographer: true,
  breaks: false,
});

export interface BuildCounter {
  n: number;
}

const IMG_RE = /!\[([^\]]*)\]\(([^)\s]+)(?:\s+"([^"]*)")?\)(?:\{([^}]*)\})?/g;

interface Attrs {
  id?: string;
  classes: string[];
  style: string[];
}

function parseAttrs(spec: string | undefined): Attrs {
  const a: Attrs = { classes: [], style: [] };
  if (!spec) return a;
  // split respecting quoted values
  const tokens = spec.match(/(?:[^\s"]+"[^"]*")|[^\s]+/g) ?? [];
  for (const tok of tokens) {
    if (tok.startsWith('#')) a.id = tok.slice(1);
    else if (tok.startsWith('.')) a.classes.push(tok.slice(1));
    else if (tok.startsWith('anchor:')) {
      const val = tok.slice('anchor:'.length).replace(/^"|"$/g, '');
      for (const [k, v] of Object.entries(expandAnchor(val))) a.style.push(`${k}:${v}`);
    } else if (tok.includes('=')) {
      const [k, v] = tok.split('=');
      a.style.push(`${k}:${v.replace(/^"|"$/g, '')}`);
    }
  }
  return a;
}

const VIDEO_EXT = /\.(mp4|webm|mov|m4v|ogv)$/i;
const AUDIO_EXT = /\.(mp3|wav|ogg|m4a|aac)$/i;

// Video/audio via the image syntax: ![alt](clip.mp4){ poster=… .autoplay width=… }
function mediaTag(alt: string, url: string, attrSpec: string | undefined): string {
  const spec = attrSpec ?? '';
  const wM = spec.match(/width=("?)([^"\s]+)\1/);
  const hM = spec.match(/height=("?)([^"\s]+)\1/);
  const style = [wM ? `width:${wM[2]}` : '', hM ? `height:${hM[2]}` : ''].filter(Boolean).join(';');
  const styleAttr = style ? ` style="${style}"` : '';
  if (AUDIO_EXT.test(url)) return `<audio class="sl-audio" controls src="${url}"${styleAttr}></audio>`;
  const posterM = spec.match(/poster=("?)([^"\s]+)\1/);
  const poster = posterM ? ` poster="${posterM[2]}"` : '';
  // `.autoplay` → muted+loop autoplay (no controls); otherwise show controls. Both
  // degrade to the poster frame in PDF/print (which can't play media).
  const auto = /(^|\s|\.)autoplay\b/.test(spec);
  const flags = auto ? ' autoplay muted loop playsinline' : ' controls preload="metadata"';
  return `<video class="sl-video" src="${url}"${poster}${flags}${styleAttr} aria-label="${alt}"></video>`;
}

function preprocessImages(src: string): string {
  return src.replace(IMG_RE, (_m, alt, url, _title, attrSpec) => {
    if (VIDEO_EXT.test(url) || AUDIO_EXT.test(url)) return mediaTag(alt, url, attrSpec);
    const a = parseAttrs(attrSpec);
    // The id enables runtime morph pairing; view-transition-name is assigned
    // transiently by the runtime to avoid duplicate-name aborts.
    const idAttr = a.id ? ` id="${a.id}" data-morph="${a.id}"` : '';
    const cls = ['sl-img', ...a.classes].join(' ');
    const style = a.style.length ? ` style="${a.style.join(';')}"` : '';
    // lazy/async by default; renderSlideWeb upgrades slide 0's images to eager.
    return `<img class="${cls}"${idAttr} src="${url}" alt="${alt}" loading="lazy" decoding="async"${style}>`;
  });
}

// Inline styled spans: [text]{.class.class…}
//   .grad / .grad-NAME  → gradient text (theme gradient)
//   .COLOR              → color role / palette / literal
//   size: .xs .sm .md .lg .xl .xxl .huge   .bold  .muted
// Optional leading `\` escapes the whole construct to a literal.
const SPAN_RE = /(\\?)\[([^\]]+)\]\{((?:\s*\.[\w#-]+)+\s*)\}/g;
// Conservative lint for broken span syntax: a `[text]{` fragment that SPAN_RE didn't
// consume (missing leading dot, empty/invalid class list, or an unmatched brace) is
// left as literal text below — this scans for exactly that leftover shape. It never
// fires on plain links `[text](url)` (a paren, not `{`, follows the `]`) or footnote-ish
// `[1]` (no `{` follows at all), since both lack the `]{` adjacency this requires.
const BROKEN_SPAN_RE = /\[[^\]\n]*\]\{[^}\n]*\}?/g;
// Exported as the canonical span size-class map (see src/vocab.ts).
export const SIZE_CLASS: Record<string, string> = {
  xs: 'small', sm: 'caption', md: 'h3', lg: 'h2', xl: 'h1', xxl: 'hero', huge: 'stat',
};
function preprocessSpans(src: string, tokens: Record<string, string> = {}, warnings?: Warning[], line?: number): string {
  const out = src.replace(SPAN_RE, (_m, esc: string, text: string, clsStr: string) => {
    if (esc) return `[${text}]{${clsStr}}`; // \[text]{.cls} → literal
    // tolerate either ".a.b" or ".a .b" between classes
    const classes = clsStr.split('.').map((s) => s.trim()).filter(Boolean);
    const styles: string[] = [];
    let grad = false;
    let gradName = 'brand';
    for (const c of classes) {
      if (c === 'grad') grad = true;
      else if (c.startsWith('grad-')) {
        grad = true;
        gradName = c.slice(5);
        if (warnings && tokens[`--gradient-${gradName}`] === undefined) {
          warnings.push({ code: 'unknown-gradient', message: `Unknown gradient ".grad-${gradName}" — no such gradient in the master; the text renders with no fill (often invisible).`, line });
        }
      } else if (SIZE_CLASS[c]) styles.push(`font-size:var(--size-${SIZE_CLASS[c]})`);
      else if (c === 'bold') styles.push('font-weight:800');
      else if (c === 'muted') styles.push('color:var(--color-muted)');
      else {
        // A bare hex (`.#0af`) is emitted literally; a name resolves through the tokens.
        styles.push(`color:${colorValue(c)}`);
        if (warnings && !isKnownColorClass(c, tokens)) {
          warnings.push({ code: 'unknown-class', message: `Unknown inline class ".${c}" — not a size (xs/sm/md/lg/xl/xxl/huge), .bold/.muted/.grad, a master colour/gradient token, or a CSS colour. It has no visible effect.`, line });
        }
      }
    }
    const cls = grad ? 'sl-span sl-grad' : 'sl-span';
    if (grad) styles.push(`background-image:var(--gradient-${gradName})`);
    return `<span class="${cls}" style="${styles.join(';')}">${text}</span>`;
  });
  if (warnings) {
    // Strip every span SPAN_RE actually matched (real spans AND the `\[text]{.cls}`
    // escaped-literal form — both are intentional, never a lint target) before
    // scanning what's left for a dangling `]{` fragment.
    const stripped = src.replace(SPAN_RE, '');
    for (const m of stripped.matchAll(BROKEN_SPAN_RE)) {
      warnings.push({
        code: 'bad-span',
        message: `malformed styled span: '${m[0]}' — expected '[text]{.class}' with a dot-prefixed class (e.g. '[text]{.accent}')`,
        line,
      });
    }
  }
  return out;
}

// Raw inline SVG via a fenced ```svg block (themeable: can use currentColor / var()).
function preprocessSvg(src: string): string {
  return src.replace(/(?:```|~~~)svg\s*\n([\s\S]*?)(?:```|~~~)/g, (_m, svg: string) => `<div class="sl-svg">${svg}</div>`);
}

// Safe dynamic embeds:
//   ```embed  → sandboxed <iframe src=URL> (external interactive content)
//   ```widget → inline HTML/JS run in a sandbox="allow-scripts" srcdoc iframe with
//               NO same-origin access (can't touch the parent), theme tokens injected.
// Both degrade to a static fallback note in PDF/print.
function preprocessEmbeds(src: string, tokens: Record<string, string>): string {
  src = src.replace(/(?:```|~~~)embed[^\n]*\n([\s\S]*?)(?:```|~~~)/g, (_m, body: string) => {
    const url = body.trim().split(/\s+/)[0] ?? '';
    return (
      `<div class="sl-embed-wrap"><iframe class="sl-embed" src="${url}" ` +
      `sandbox="allow-scripts allow-same-origin allow-popups allow-forms" loading="lazy" ` +
      `referrerpolicy="no-referrer" title="embed"></iframe>` +
      `<div class="sl-embed-fallback">Interactive embed — open the web deck</div></div>`
    );
  });
  src = src.replace(/(?:```|~~~)widget[^\n]*\n([\s\S]*?)(?:```|~~~)/g, (_m, body: string) => {
    const vars = Object.entries(tokens).map(([k, v]) => `${k}:${v}`).join(';');
    const doc =
      `<!doctype html><meta charset="utf8"><style>:root{${vars}}` +
      `html,body{margin:0;height:100%;font-family:var(--font-sans,system-ui);color:var(--color-text,#eee);background:transparent}</style>` +
      body;
    const enc = doc.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/\n/g, '&#10;');
    return (
      `<div class="sl-embed-wrap"><iframe class="sl-widget" sandbox="allow-scripts" srcdoc="${enc}" title="widget"></iframe>` +
      `<div class="sl-embed-fallback">Interactive widget — open the web deck</div></div>`
    );
  });
  return src;
}

// Charts — two renderable fences, each lazily rendered to inline SVG in the browser
// (see render/charts.ts). The body is base64-encoded into a data attribute so it
// survives the later image/span inline passes (Mermaid labels `A[Start]`, ECharts JSON
// `[...]`/`{...}` would otherwise be mangled) and dodges all HTML escaping.
//   ```mermaid → diagrams (flow/sequence/arch/…)
function preprocessMermaid(src: string): string {
  return src.replace(/(?:```|~~~)mermaid\s*\n([\s\S]*?)(?:```|~~~)/g, (_m, body: string) => {
    const b64 = Buffer.from(body.replace(/\s+$/, ''), 'utf8').toString('base64');
    return `<pre class="sl-chart sl-mermaid" data-graph="${b64}"></pre>`;
  });
}
//   ```echart → data viz (Apache ECharts `option`). The body is JSON *or* YAML (YAML is
//   a JSON superset and far more token-friendly); it is validated at compile time, so a
//   malformed option warns and falls back to a plain code block instead of a blank slide.
function preprocessEchart(src: string, warnings?: Warning[], line?: number): string {
  return src.replace(/(?:```|~~~)echart\s*\n([\s\S]*?)(?:```|~~~)/g, (whole, body: string) => {
    let option: unknown;
    try {
      option = yaml.load(body);
    } catch (e) {
      warnings?.push({
        code: 'bad-chart',
        message: `Invalid \`\`\`echart option: ${(e as Error).message}. Rendered as a code block instead.`,
        line,
      });
      return whole; // leave the fence → markdown-it renders it as a code block
    }
    if (option === null || typeof option !== 'object') {
      warnings?.push({
        code: 'bad-chart',
        message: `\`\`\`echart body did not parse to an option object (got ${option === null ? 'empty' : typeof option}). Rendered as a code block instead.`,
        line,
      });
      return whole;
    }
    const b64 = Buffer.from(JSON.stringify(option), 'utf8').toString('base64');
    return `<div class="sl-chart sl-echart" data-option="${b64}"></div>`;
  });
}

function isListBlock(block: string): boolean {
  const lines = block.split('\n').filter((l) => l.trim() !== '');
  return lines.length > 0 && lines.every((l) => /^\s*([-*+]|\d+[.)])\s+/.test(l));
}

// Split a region into blocks on blank lines, but keep fenced code blocks atomic —
// a blank line inside ``` (or ~~~) must NOT shred the fence into separate blocks.
// (svg/embed/widget fences are already collapsed to <div>s before this runs.)
function splitBlocks(src: string): string[] {
  const blocks: string[] = [];
  let buf: string[] = [];
  let inFence = false;
  let marker = '';
  const flush = () => {
    if (buf.length) blocks.push(buf.join('\n'));
    buf = [];
  };
  for (const line of src.split('\n')) {
    const fm = line.match(/^\s*(```|~~~)/);
    if (fm) {
      if (!inFence) {
        inFence = true;
        marker = fm[1];
      } else if (line.trimStart().startsWith(marker)) {
        inFence = false;
      }
      buf.push(line);
      continue;
    }
    if (!inFence && line.trim() === '') {
      flush();
      continue;
    }
    // An ATX heading is its own block (CommonMark). Without this, a heading immediately
    // followed by a list/paragraph (no blank line) fuses into one block — which makes
    // isListBlock() false and silently drops the following list's per-item `>>>` builds.
    if (!inFence && /^\s{0,3}#{1,6}\s/.test(line)) {
      flush();
      blocks.push(line);
      continue;
    }
    buf.push(line);
  }
  flush();
  return blocks;
}

// Replace plain (untagged) code fences with placeholders so the inline preprocessors
// (images, styled spans) don't transform a deck's own source shown verbatim inside a
// ```code``` block. Run AFTER svg/embed/widget fences are consumed; restore after.
function maskFences(src: string): { masked: string; fences: string[] } {
  const out: string[] = [];
  const fences: string[] = [];
  let buf: string[] | null = null;
  let fence = '';
  for (const line of src.split('\n')) {
    const m = line.match(/^\s*(```|~~~)/);
    if (buf === null) {
      if (m) { buf = [line]; fence = m[1]; } else out.push(line);
    } else {
      buf.push(line);
      if (line.trimStart().startsWith(fence)) {
        out.push(` slfence${fences.length} `);
        fences.push(buf.join('\n'));
        buf = null;
      }
    }
  }
  if (buf !== null) out.push(buf.join('\n')); // unterminated fence — leave as-is
  return { masked: out.join('\n'), fences };
}
function unmaskFences(src: string, fences: string[]): string {
  return src.replace(/ slfence(\d+) /g, (_m, i) => fences[Number(i)] ?? '');
}

// A build sigil, optionally naming an entrance effect and options:
//   `>>>`                         default fade-up
//   `>>> zoom-in`                 named entrance (see anim.ts ENTRANCES)
//   `>>> slide-in-left delay=150` entrance + per-element delay/dur/ease overrides
const BUILD_RE = /\s*>>>\s*([\w-]+)?((?:\s+\w+=[^\s]+)*)\s*$/;
const ESC_BUILD_RE = /\\>>>(\s*)$/; // `\>>>` → literal `>>>`, not a build step

interface BuildSpec {
  isBuild: boolean;
  clean: string;
  effect?: string;
  opts?: Record<string, string>;
}

/** Split a build sigil off a line, honoring the `\>>>` escape. */
function buildOf(text: string): BuildSpec {
  if (ESC_BUILD_RE.test(text)) return { isBuild: false, clean: text.replace(ESC_BUILD_RE, '>>>$1') };
  const m = text.match(BUILD_RE);
  if (m) {
    const opts: Record<string, string> = {};
    if (m[2]) {
      for (const pair of m[2].trim().split(/\s+/)) {
        const eq = pair.indexOf('=');
        if (eq > 0) opts[pair.slice(0, eq)] = pair.slice(eq + 1);
      }
    }
    return { isBuild: true, clean: text.replace(BUILD_RE, ''), effect: m[1], opts };
  }
  return { isBuild: false, clean: text };
}

/** A `<duration>` value: a bare number is milliseconds; anything with a unit is verbatim. */
function cssTime(v: string): string {
  return /^[\d.]+$/.test(v) ? `${v}ms` : v;
}

/** Resolve a build's entrance into a class suffix + inline CSS-var overrides.
 *  An unknown effect warns and falls back to the default (bare) fade-up. */
function entranceAttrs(
  spec: BuildSpec,
  valid: Set<string>,
  warnings?: Warning[],
  line?: number,
): { cls: string; style: string } {
  const effect = spec.effect;
  if (!effect) return { cls: '', style: '' };
  if (!valid.has(effect)) {
    if (warnings) {
      warnings.push({
        code: 'unknown-entrance',
        message: `Unknown build entrance "${effect}" after ">>>" — not a known entrance effect. Valid: ${[...valid].join(', ')}. Falling back to the default.`,
        line,
      });
    }
    return { cls: '', style: '' };
  }
  const styles: string[] = [];
  const o = spec.opts ?? {};
  if (o.delay) styles.push(`--slaide--ent-delay:${cssTime(o.delay)}`);
  if (o.dur) styles.push(`--slaide--ent-dur:${cssTime(o.dur)}`);
  if (o.ease) styles.push(`--slaide--ent-ease:${o.ease}`);
  return { cls: ` sl-ent-${effect}`, style: styles.length ? ` style="${styles.join(';')}"` : '' };
}

/** Render one region's markdown to HTML, assigning absolute build indices.
 *  `warnings` (if provided) collects authoring diagnostics (unknown inline classes
 *  etc.) with the slide's `line` for self-correction. */
export function renderRegion(
  markdown: string,
  counter: BuildCounter,
  tokens: Record<string, string> = {},
  warnings?: Warning[],
  line?: number,
  validEntrances?: Set<string>,
): { html: string; builds: number } {
  const valid = validEntrances ?? BUILTIN_ENTRANCES;
  const srcLine = line;
  // Consume tagged fences (charts, then svg/embed/widget) first, then mask plain code
  // fences so the inline transforms (images, spans) never touch a deck's own source
  // shown verbatim. Charts run first: their base64 payload is inert to every later pass.
  const charted = preprocessEchart(preprocessMermaid(markdown.trim()), warnings, line);
  const tagged = preprocessSvg(preprocessEmbeds(charted, tokens));
  const { masked, fences } = maskFences(tagged);
  const src = unmaskFences(preprocessSpans(preprocessImages(masked), tokens, warnings, line), fences);
  if (src === '') return { html: '', builds: 0 };

  const blocks = splitBlocks(src);
  const out: string[] = [];
  const startN = counter.n;

  for (const rawBlock of blocks) {
    const block = rawBlock.replace(/\s+$/, '');
    if (block.trim() === '') continue;

    if (isListBlock(block)) {
      const lines = block.split('\n').filter((l) => l.trim() !== '');
      const ordered = /^\s*\d+[.)]/.test(lines[0]);
      const items = lines.map((line) => {
        const text = line.replace(/^\s*([-*+]|\d+[.)])\s+/, '');
        const spec = buildOf(text);
        const inline = md.renderInline(spec.clean);
        if (spec.isBuild) {
          const n = ++counter.n;
          const e = entranceAttrs(spec, valid, warnings, srcLine);
          return `<li class="sl-build${e.cls}" data-build="${n}"${e.style}>${inline}</li>`;
        }
        return `<li>${inline}</li>`;
      });
      const tag = ordered ? 'ol' : 'ul';
      out.push(`<${tag}>${items.join('')}</${tag}>`);
    } else {
      const spec = buildOf(block);
      // A build sigil only applies at the end of a list item or the end of a block. A `>>>`
      // left on a non-final line of a multi-line paragraph renders literally — warn so
      // `validate --strict` catches it instead of shipping a stray ">>>".
      if (warnings) {
        const blines = block.split('\n');
        let lastIdx = blines.length - 1;
        while (lastIdx >= 0 && blines[lastIdx].trim() === '') lastIdx--;
        for (let i = 0; i < lastIdx; i++) {
          const bl = blines[i];
          if (bl.trim() === '' || ESC_BUILD_RE.test(bl)) continue;
          if (BUILD_RE.test(bl)) {
            warnings.push({
              code: 'stray-build',
              message:
                'A ">>>" build on a non-final line has no effect — put it at the end of a list item or block, or separate items with a blank line (a heading + list with no blank line is the usual cause).',
              line,
            });
            break;
          }
        }
      }
      const rendered = md.render(spec.clean).trim();
      if (spec.isBuild) {
        const n = ++counter.n;
        const e = entranceAttrs(spec, valid, warnings, srcLine);
        out.push(`<div class="sl-block sl-build${e.cls}" data-build="${n}"${e.style}>${rendered}</div>`);
      } else {
        out.push(rendered);
      }
    }
  }

  return { html: out.join('\n'), builds: counter.n - startN };
}

export { md };
