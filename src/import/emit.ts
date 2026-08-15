// Copyright 2026 AIVory, Inc.
// SPDX-License-Identifier: Apache-2.0
// ImportIR -> slaide source (deck + master). Exact fidelity: every shape becomes
// an absolutely-anchored slot; runs keep size/color/weight/font via inline spans.
import { escapeHtml as esc } from '../util.js';
import { serializeMaster } from '../master-io.js';
import { isGoogleFont, normalizeFont } from './pptx.js';
import type { Master } from '../types.js';
import type { ImportIR, ImpShape, ImpPara, ImpRun, ImpBackground } from './pptx.js';

function fontSlug(family: string): string {
  return 'f_' + family.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '');
}

// Metric-aware generic fallback so a missing family degrades to the right shape.
const SERIF_RE = /serif|times|georgia|garamond|playfair|merriweather|lora|baskerville|bitter|crimson|roman|cambria|book antiqua/i;
const MONO_RE = /mono|consol|courier|code|menlo|inconsolata/i;
function fallbackStack(family: string): string {
  if (MONO_RE.test(family)) return 'ui-monospace, monospace';
  if (SERIF_RE.test(family)) return 'Georgia, serif';
  return 'system-ui, sans-serif';
}

function fontFamilyCss(family: string): string {
  const f = family.replace(/'/g, '');
  return `font-family:'${f}', ${fallbackStack(f)}`;
}

function runHtml(run: ImpRun): string {
  if (run.br) return '<br>';
  const st: string[] = [];
  let cls = '';
  if (run.font) st.push(fontFamilyCss(run.font));
  if (run.size) st.push(`font-size:${run.size}px`);
  if (run.gradient) {
    cls = 'sl-grad'; // .sl-grad supplies background-clip:text; inline image overrides the brand default
    st.push(`background-image:${run.gradient}`);
  } else if (run.color) st.push(`color:${run.color}`);
  // Numeric weight peeled from the family name ("…Extrabold" -> 800) takes precedence
  // over the plain bold flag so the right Google weight is selected.
  const weight = run.weight ?? (run.bold ? 700 : undefined);
  if (weight) st.push(`font-weight:${weight}`);
  if (run.italic) st.push('font-style:italic');
  const deco: string[] = [];
  if (run.underline) deco.push('underline');
  if (run.strike) deco.push('line-through');
  if (deco.length) st.push(`text-decoration:${deco.join(' ')}`);
  if (run.spacing) st.push(`letter-spacing:${run.spacing}px`);
  if (run.caps === 'all') st.push('text-transform:uppercase');
  else if (run.caps === 'small') st.push('font-variant:small-caps');
  if (run.baseline === 'sup') st.push('vertical-align:super;font-size:0.7em');
  else if (run.baseline === 'sub') st.push('vertical-align:sub;font-size:0.7em');
  const t = esc(run.text);
  if (!cls && !st.length) return t;
  return `<span${cls ? ` class="${cls}"` : ''}${st.length ? ` style="${st.join(';')}"` : ''}>${t}</span>`;
}

function paraHtml(p: ImpPara): string {
  return p.runs.map(runHtml).join('');
}

function tableMd(shape: ImpShape): string {
  const t = shape.table!;
  const cellText = (cell: { paras: ImpPara[] }) =>
    cell.paras.map((p) => p.runs.map((r) => (r.br ? ' ' : r.text)).join('')).join(' ').replace(/\|/g, '\\|').trim() || ' ';
  const lines: string[] = [];
  t.rows.forEach((row, ri) => {
    lines.push('| ' + row.map(cellText).join(' | ') + ' |');
    if (ri === 0) lines.push('| ' + row.map(() => '---').join(' | ') + ' |');
  });
  return lines.join('\n');
}

/** Reproduce an `a:srcRect` crop exactly, incl. asymmetric insets: the img is scaled up
 *  by 1/(1-l-r) x 1/(1-t-b) and shifted so the cropped sub-rect fills the box, clipped by
 *  the wrapping div. This is a superset of the common one-axis "crop to fill" case (which
 *  reduces to plain `object-fit:cover` positioning) so one formula covers both. */
function croppedImgHtml(shape: ImpShape): string {
  const { l, t, r, b } = shape.crop!;
  const vw = 1 - l - r;
  const vh = 1 - t - b;
  const round = (n: number) => Math.round(n * 1000) / 1000;
  const style = [
    `position:absolute`,
    `left:${round((-l / vw) * 100)}%`,
    `top:${round((-t / vh) * 100)}%`,
    `width:${round(100 / vw)}%`,
    `height:${round(100 / vh)}%`,
    `max-width:none`,
    `max-height:none`,
    `object-fit:fill`,
  ].join(';');
  return (
    `<div style="position:relative;width:100%;height:100%;overflow:hidden">` +
    `<img class="sl-img" src="assets/${shape.src}" alt="" style="${style}" loading="lazy" decoding="async"></div>`
  );
}

function shapeContent(shape: ImpShape): string {
  if (shape.kind === 'image' && shape.crop) return croppedImgHtml(shape);
  if (shape.kind === 'image' || (shape.kind === 'raster' && shape.src)) return `![](assets/${shape.src})`;
  if (shape.kind === 'table' && shape.table) return tableMd(shape);
  if (shape.kind === 'rect' || shape.kind === 'raster') return '<!--bg-->';
  const paras = shape.paras ?? [];
  let out = '';
  paras.forEach((p, i) => {
    const prefix = p.bullet ? (p.ordered ? '1. ' : '- ') : '';
    const indent = '  '.repeat(p.level ?? 0);
    const line = indent + prefix + paraHtml(p);
    if (i === 0) out = line;
    else if (p.bullet && paras[i - 1].bullet) out += '\n' + line; // contiguous list
    else out += '\n\n' + line;
  });
  return out || '<!--empty-->';
}

const ALIGN: Record<string, string> = { l: 'left', ctr: 'center', r: 'right', just: 'justify' };

function lum(hex: string): number {
  const m = hex.replace('#', '');
  if (m.length < 6) return 1;
  const r = parseInt(m.slice(0, 2), 16),
    g = parseInt(m.slice(2, 4), 16),
    b = parseInt(m.slice(4, 6), 16);
  return (0.299 * r + 0.587 * g + 0.114 * b) / 255;
}

function bgDef(bg: ImpBackground): { type: string; [k: string]: unknown } {
  if (bg.kind === 'solid') return { type: 'solid', color: bg.color };
  if (bg.kind === 'gradient') {
    const m = bg.gradient.match(/linear-gradient\(\s*([-\d.]+)deg\s*,\s*(.+)\)\s*$/);
    if (m) return { type: 'gradient', angle: Number(m[1]), stops: m[2].split(',').map((s) => s.trim()) };
    return { type: 'solid', color: '#111111' };
  }
  return { type: 'image', src: `assets/${bg.src}`, fit: 'cover' };
}

export function emit(ir: ImportIR): { master: string; deck: string } {
  const { canvas, theme } = ir;
  // High-precision anchors: 0.1% rounding = ~2px drift at 1920px. Keep 3 decimals.
  const pct = (v: number, total: number) => `${Math.round((v / total) * 100000) / 1000}%`;

  const layouts: Record<string, unknown> = {};
  const backgrounds: Record<string, unknown> = {};
  const deckParts: string[] = [];
  // family -> set of weights actually used (so Google imports exactly what's needed).
  const famWeights = new Map<string, Set<number>>();
  const addFam = (family: string | undefined, weight: number | undefined) => {
    if (!family) return;
    const set = famWeights.get(family) ?? new Set<number>();
    set.add(weight ?? 400);
    famWeights.set(family, set);
  };

  ir.slides.forEach((slide, si) => {
    const layoutName = `slide${si + 1}`;
    const slots: Record<string, unknown> = {};
    const regions: string[] = [];

    slide.shapes.forEach((shape, sj) => {
      const name = `s${sj}`;
      const anchor = `${pct(shape.x, canvas.w)} ${pct(shape.y, canvas.h)} ${pct(shape.w, canvas.w)} ${pct(shape.h, canvas.h)}`;
      const style: Record<string, string> = { anchor, valign: shape.valign ?? 'top' };
      if (shape.insets) style.pad = `${shape.insets.t}px ${shape.insets.r}px ${shape.insets.b}px ${shape.insets.l}px`;
      if (shape.rotation) {
        const parts = [`rotate(${Math.round(shape.rotation)}deg)`];
        if (shape.flipH) parts.push('scaleX(-1)');
        if (shape.flipV) parts.push('scaleY(-1)');
        style.rotate = parts.join(' ');
      }
      if (shape.opacity !== undefined && shape.opacity < 1) style.opacity = String(shape.opacity);
      if (shape.ellipse) style.radius = '50%';
      else if (shape.radius) style.radius = `${shape.radius}px`;
      if (shape.fill) style.bg = shape.fill;
      if (shape.stroke) style.border = `${shape.stroke.width}px solid ${shape.stroke.color}`;

      // collect fonts + the exact weights used by this shape's runs
      for (const p of shape.paras ?? []) for (const r of p.runs) addFam(r.font, r.weight ?? (r.bold ? 700 : undefined));

      let type = 'body';
      if (shape.kind === 'image' || (shape.kind === 'raster' && shape.src)) type = 'image';
      else if (shape.kind === 'text') {
        const a = shape.paras?.[0]?.align;
        if (a && ALIGN[a]) style.align = ALIGN[a];
        // PowerPoint single-spacing (~1.2) is tighter than the slaide CSS default (1.5).
        const lh = shape.paras?.[0]?.lineHeight ?? 1.2;
        style.leading = String(Math.round(lh * 100) / 100);
        type = shape.ph === 'title' || shape.ph === 'ctrTitle' ? 'title' : 'body';
      }
      slots[name] = { type, style };
      regions.push(`:: ${name} ::\n${shapeContent(shape)}`);
    });

    layouts[layoutName] = { areas: ['main'], rows: '1fr', cols: '1fr', slots };

    // background
    let frontmatter = `layout: ${layoutName}`;
    if (slide.background) {
      const bgName = `bg${si + 1}`;
      backgrounds[bgName] = bgDef(slide.background);
      frontmatter += `\nbackground: ${bgName}`;
    }
    deckParts.push(`${frontmatter}\n---\n${regions.join('\n\n')}`);
  });

  // Dark-deck detection from slide backgrounds (and full-slide rects as fallback).
  const bgLums: number[] = [];
  for (const slide of ir.slides) {
    if (slide.background?.kind === 'solid') bgLums.push(lum(slide.background.color));
    for (const s of slide.shapes)
      if (s.kind === 'rect' && s.fill?.startsWith('#') && s.w >= canvas.w * 0.85 && s.h >= canvas.h * 0.85) bgLums.push(lum(s.fill));
  }
  const dark = bgLums.length > 0 && bgLums.reduce((a, b) => a + b, 0) / bgLums.length < 0.45;

  // Fonts: roles + one entry per distinct family so inline font-family resolves/imports.
  // Theme major/minor are weight-named in the source ("Open Sans Extrabold"); peel to the
  // real base family so the role tokens reference a font the web can actually serve.
  const major = normalizeFont(theme.fontMajor);
  const minor = normalizeFont(theme.fontMinor);
  addFam(major.family, major.weight ?? 700);
  addFam(minor.family, minor.weight ?? 400);
  const fonts: Record<string, unknown> = {
    display: fontEntry(major.family, famWeights.get(major.family)),
    sans: fontEntry(minor.family, famWeights.get(minor.family)),
    mono: { family: 'JetBrains Mono', provider: 'google', weights: [400] },
  };
  const seen = new Set([major.family, minor.family]);
  for (const [fam, ws] of famWeights) {
    if (seen.has(fam)) continue;
    seen.add(fam);
    fonts[fontSlug(fam)] = fontEntry(fam, ws);
  }

  const pal = theme.palette;
  const ref = (k: string, fallback: string) => (pal[k] ? `{palette.${k}}` : fallback);
  const master: Record<string, unknown> = {
    schema: 'slaide/1',
    name: 'imported',
    description: 'Imported from PowerPoint/Keynote.',
    canvas: { aspect: aspectOf(canvas.w, canvas.h), width: canvas.w, height: canvas.h },
    fonts,
    typeScale: { base: '24px', ratio: 1.2, steps: { h1: 4, h2: 3, h3: 2, h4: 1, body: 0, caption: -1 } },
    colors: {
      palette: pal,
      roles: {
        background: dark ? ref('dk1', '#0B1220') : ref('lt1', '#FFFFFF'),
        text: dark ? ref('lt1', '#F8FAFC') : ref('dk1', '#111111'),
        heading: dark ? ref('lt1', '#F8FAFC') : ref('dk1', '#111111'),
        accent: ref('accent1', '#3366FF'),
        muted: dark ? ref('lt2', '#AAB2C5') : ref('dk2', '#666666'),
      },
    },
    ...(Object.keys(backgrounds).length ? { backgrounds } : {}),
    layouts,
  };

  // Canonical theme serialization (schema header + stable key order) — shared with the
  // editor's master write-back so imported and hand-edited masters emit identically.
  const masterYaml = serializeMaster(master as unknown as Master);
  const deck = `---\nmaster: ./master.slaide.yaml\ntitle: Imported deck\n---\n` + deckParts.join('\n\n---\n');
  return { master: masterYaml, deck };
}

function fontEntry(family: string, weights?: Set<number>): Record<string, unknown> {
  if (!isGoogleFont(family)) return { family, provider: 'system' };
  const ws = new Set(weights ?? []);
  ws.add(400); // a regular weight is almost always needed (body text, fallbacks)
  return { family, provider: 'google', weights: [...ws].sort((a, b) => a - b) };
}

function aspectOf(w: number, h: number): string {
  const g = gcd(w, h);
  const a = w / g,
    b = h / g;
  // snap common ratios
  if (Math.abs(a / b - 16 / 9) < 0.02) return '16:9';
  if (Math.abs(a / b - 4 / 3) < 0.02) return '4:3';
  return `${a}:${b}`;
}
function gcd(a: number, b: number): number {
  return b ? gcd(b, a % b) : a;
}
