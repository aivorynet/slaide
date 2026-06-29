// Copyright 2026 AIVory, Inc.
// SPDX-License-Identifier: Apache-2.0
// PPTX (OOXML) -> ImportIR. Direct zip+XML parse with EMU->px, theme/scheme-color
// + clrMap + autofit resolution, recursive shape-tree traversal (groups/connectors/
// tables), placeholder inheritance (slide -> layout -> master), per-run font/color/
// gradient/decoration capture, a:br/a:fld, and slide/layout/master backgrounds.
//
// Two parsers are used: a flat parser (attribute access) for theme/master/layout/rels,
// and a preserveOrder parser for slide shape trees so paint order (z-index) and the
// interleaving of runs / line-breaks / fields are preserved exactly.
import JSZip from 'jszip';
import { XMLParser } from 'fast-xml-parser';
import { readFileSync } from 'node:fs';
import { todayFormatted } from '../compiler/chrome.js';

const EMU_PER_PX = 12700; // PowerPoint points map 1:1 to px in this design space
const px = (emu: number) => Math.round(emu / EMU_PER_PX);

const flat = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: '@_', removeNSPrefix: false, trimValues: false });
const ordered = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: '@_', preserveOrder: true, trimValues: false });

function arr<T>(v: T | T[] | undefined): T[] {
  if (v === undefined || v === null) return [];
  return Array.isArray(v) ? v : [v];
}

// ---------------------------------------------------------------------------
// Mini-DOM over preserveOrder nodes. A node is `{ 'tag': [children], ':@': {attrs} }`
// or a text node `{ '#text': '...' }`.
// ---------------------------------------------------------------------------
type ONode = Record<string, any>;
function tagOf(n: ONode): string {
  for (const k of Object.keys(n)) if (k !== ':@') return k;
  return '';
}
function kids(n: ONode | undefined): ONode[] {
  if (!n) return [];
  const t = tagOf(n);
  return Array.isArray(n[t]) ? n[t] : [];
}
function oattr(n: ONode | undefined, a: string): string | undefined {
  const v = n?.[':@']?.['@_' + a];
  return v === undefined ? undefined : String(v);
}
function ochild(n: ONode | undefined, tag: string): ONode | undefined {
  return kids(n).find((c) => tagOf(c) === tag);
}
function ochildren(n: ONode | undefined, tag: string): ONode[] {
  return kids(n).filter((c) => tagOf(c) === tag);
}
/** First descendant (depth-first) with the given tag. */
function odeep(n: ONode | undefined, tag: string): ONode | undefined {
  for (const c of kids(n)) {
    if (tagOf(c) === tag) return c;
    const d = odeep(c, tag);
    if (d) return d;
  }
  return undefined;
}
function otext(n: ONode | undefined): string {
  let s = '';
  for (const c of kids(n)) {
    if ('#text' in c) s += c['#text'];
    else s += otext(c);
  }
  return s;
}

// ---------------------------------------------------------------------------
// IR
// ---------------------------------------------------------------------------
export interface ImpRun {
  text: string;
  bold?: boolean;
  italic?: boolean;
  underline?: boolean;
  strike?: boolean;
  size?: number; // effective px
  color?: string; // #rrggbb
  gradient?: string; // css gradient (text fill)
  font?: string; // family (base, weight-suffix stripped — see normalizeFont)
  weight?: number; // numeric weight peeled from a weight-named family ("Open Sans Extrabold" -> 800)
  spacing?: number; // letter-spacing px
  caps?: 'all' | 'small';
  baseline?: 'sup' | 'sub';
  href?: string;
  br?: boolean; // a hard line break inside the paragraph
}
export interface ImpPara {
  runs: ImpRun[];
  bullet?: boolean;
  bulletChar?: string;
  ordered?: boolean;
  level?: number;
  align?: string;
  lineHeight?: number; // multiplier, e.g. 0.94
  spaceBefore?: number; // px
  spaceAfter?: number; // px
}
export interface ImpTableCell {
  paras: ImpPara[];
  fill?: string;
}
export interface ImpTable {
  rows: ImpTableCell[][];
  widths: number[];
  heights: number[];
}
export interface ImpShape {
  kind: 'text' | 'image' | 'rect' | 'raster' | 'table';
  x: number;
  y: number;
  w: number;
  h: number;
  ph?: string;
  name?: string; // cNvPr name (for COM raster matching)
  id?: string; // cNvPr id
  paras?: ImpPara[];
  src?: string; // asset filename (image / rasterized)
  fill?: string; // rect background (css color or gradient)
  stroke?: { color: string; width: number };
  valign?: 'top' | 'center' | 'bottom';
  insets?: { l: number; t: number; r: number; b: number };
  rotation?: number; // degrees
  flipH?: boolean;
  flipV?: boolean;
  opacity?: number; // 0..1
  radius?: number; // rounded-rect corner px
  ellipse?: boolean; // preset geometry is an ellipse/circle (border-radius 50%)
  table?: ImpTable;
  /** Present on kind:'raster' shapes that still need a PNG exported via PowerPoint COM. */
  rasterReq?: { name?: string; id?: string; reason: string };
}
export type ImpBackground =
  | { kind: 'solid'; color: string }
  | { kind: 'gradient'; gradient: string }
  | { kind: 'image'; src: string };
export interface ImpSlide {
  shapes: ImpShape[];
  notes?: string;
  background?: ImpBackground;
}
export interface ImportIR {
  canvas: { w: number; h: number };
  theme: { palette: Record<string, string>; fontMajor: string; fontMinor: string; nonGoogleFonts: string[] };
  slides: ImpSlide[];
  assets: { name: string; data: Buffer }[];
  warnings: string[];
}

// ---------------------------------------------------------------------------
// Affine transform for nested group child-coordinate spaces.
//   rootX = ax + localX*bx ; rootW = localW*bx  (and likewise Y)
// ---------------------------------------------------------------------------
interface Xform {
  ax: number;
  bx: number;
  ay: number;
  by: number;
  rot: number;
  flipH: boolean;
  flipV: boolean;
}
const IDENTITY: Xform = { ax: 0, bx: 1, ay: 0, by: 1, rot: 0, flipH: false, flipV: false };

// ---------------------------------------------------------------------------
// Color resolution (works on the mini-DOM). `scheme` = theme clrScheme resolved to
// hex; `clrMap` remaps logical names (bg1/tx1/...) to scheme slots per the master.
// ---------------------------------------------------------------------------
function sysToHex(last: string | undefined, name: string | undefined): string {
  if (last) return '#' + last;
  return name === 'window' ? '#FFFFFF' : '#000000';
}

function resolveScheme(clrSchemeNode: ONode | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  for (const c of kids(clrSchemeNode)) {
    const key = tagOf(c).replace(/^a:/, '');
    const srgb = ochild(c, 'a:srgbClr');
    const sys = ochild(c, 'a:sysClr');
    if (srgb) out[key] = '#' + oattr(srgb, 'val');
    else if (sys) out[key] = sysToHex(oattr(sys, 'lastClr'), oattr(sys, 'val'));
  }
  return out;
}

function clamp(n: number): number {
  return Math.max(0, Math.min(255, Math.round(n)));
}
function hexToRgb(hex: string): [number, number, number] {
  const m = hex.replace('#', '');
  return [parseInt(m.slice(0, 2), 16), parseInt(m.slice(2, 4), 16), parseInt(m.slice(4, 6), 16)];
}
function rgbToHex(r: number, g: number, b: number): string {
  return '#' + [r, g, b].map((v) => clamp(v).toString(16).padStart(2, '0')).join('').toUpperCase();
}

// --- HSL conversions (lumMod/lumOff/satMod/hueMod operate in HSL, like PowerPoint) ---
function rgbToHsl(r: number, g: number, b: number): [number, number, number] {
  r /= 255; g /= 255; b /= 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  let h = 0, s = 0;
  const l = (max + min) / 2;
  const d = max - min;
  if (d !== 0) {
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    if (max === r) h = ((g - b) / d + (g < b ? 6 : 0));
    else if (max === g) h = (b - r) / d + 2;
    else h = (r - g) / d + 4;
    h /= 6;
  }
  return [h, s, l];
}
function hue2rgb(p: number, q: number, t: number): number {
  if (t < 0) t += 1;
  if (t > 1) t -= 1;
  if (t < 1 / 6) return p + (q - p) * 6 * t;
  if (t < 1 / 2) return q;
  if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
  return p;
}
function hslToRgb(h: number, s: number, l: number): [number, number, number] {
  if (s === 0) return [l * 255, l * 255, l * 255];
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
  const p = 2 * l - q;
  return [hue2rgb(p, q, h + 1 / 3) * 255, hue2rgb(p, q, h) * 255, hue2rgb(p, q, h - 1 / 3) * 255];
}

/** Apply OOXML color modifiers (children of a color node) in document order.
 *  shade/tint act in sRGB; lumMod/lumOff/satMod/hueMod act in HSL — matching how
 *  PowerPoint derives the tinted/shaded variants used throughout theme palettes. */
function applyMods(hex: string, colorNode: ONode): string {
  let [r, g, b] = hexToRgb(hex);
  for (const child of kids(colorNode)) {
    const tag = tagOf(child);
    const v = oattr(child, 'val');
    if (v === undefined) continue;
    const f = Number(v) / 100000;
    switch (tag) {
      case 'a:shade':
        r *= f; g *= f; b *= f;
        break;
      case 'a:tint':
        r = r * f + 255 * (1 - f); g = g * f + 255 * (1 - f); b = b * f + 255 * (1 - f);
        break;
      case 'a:lumMod': {
        const [h, s, l] = rgbToHsl(r, g, b);
        [r, g, b] = hslToRgb(h, s, Math.min(1, l * f));
        break;
      }
      case 'a:lumOff': {
        const [h, s, l] = rgbToHsl(r, g, b);
        [r, g, b] = hslToRgb(h, s, Math.min(1, Math.max(0, l + f)));
        break;
      }
      case 'a:satMod': {
        const [h, s, l] = rgbToHsl(r, g, b);
        [r, g, b] = hslToRgb(h, Math.min(1, s * f), l);
        break;
      }
      case 'a:hueMod': {
        const [h, s, l] = rgbToHsl(r, g, b);
        [r, g, b] = hslToRgb((h * f) % 1, s, l);
        break;
      }
    }
  }
  return rgbToHex(r, g, b);
}

interface ColorCtx {
  scheme: Record<string, string>;
  clrMap: Record<string, string>;
}

/** Apply an a:alpha child (1/1000 %) -> rgba() string; otherwise return the hex. */
function applyAlpha(hex: string, colorNode: ONode): string {
  const a = ochild(colorNode, 'a:alpha');
  if (!a) return hex;
  const alpha = Math.round((Number(oattr(a, 'val')) / 100000) * 1000) / 1000;
  if (alpha >= 1) return hex;
  const [r, g, b] = hexToRgb(hex);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

/** Resolve a node that *holds* a color child (a:srgbClr | a:schemeClr). May be rgba(). */
function colorFrom(holder: ONode | undefined, ctx: ColorCtx): string | undefined {
  const srgb = ochild(holder, 'a:srgbClr');
  if (srgb) return applyAlpha(applyMods('#' + oattr(srgb, 'val'), srgb), srgb);
  const sc = ochild(holder, 'a:schemeClr');
  if (sc) {
    const val = oattr(sc, 'val')!;
    const mapped = ctx.clrMap[val] ?? val;
    const base = ctx.scheme[mapped] ?? ctx.scheme[val];
    if (base) return applyAlpha(applyMods(base, sc), sc);
  }
  return undefined;
}

/** Solid fill color of a parent node that may contain a:solidFill. */
function solidFill(parent: ONode | undefined, ctx: ColorCtx): string | undefined {
  return colorFrom(ochild(parent, 'a:solidFill'), ctx);
}

/** Returns {color} for solid fills or {gradient} for gradient fills. */
function fillInfo(parent: ONode | undefined, ctx: ColorCtx): { color?: string; gradient?: string } {
  const solid = solidFill(parent, ctx);
  if (solid) return { color: solid };
  const g = ochild(parent, 'a:gradFill');
  if (g) {
    const stops = ochildren(ochild(g, 'a:gsLst'), 'a:gs');
    const cols = stops.map((s) => colorFrom(s, ctx)).filter(Boolean) as string[];
    const lin = ochild(g, 'a:lin');
    const ang = lin ? Math.round(Number(oattr(lin, 'ang')) / 60000) : 135;
    if (cols.length >= 2) return { gradient: `linear-gradient(${ang}deg, ${cols.join(', ')})` };
    if (cols.length === 1) return { color: cols[0] };
  }
  return {};
}

/** Border/outline of a shape (a:ln) -> {color, width px}, or undefined if none. */
function strokeOf(spPr: ONode | undefined, ctx: ColorCtx): { color: string; width: number } | undefined {
  const ln = ochild(spPr, 'a:ln');
  if (!ln || ochild(ln, 'a:noFill')) return undefined;
  const color = colorFrom(ochild(ln, 'a:solidFill'), ctx);
  if (!color) return undefined;
  const w = oattr(ln, 'w');
  return { color, width: w ? Math.max(1, px(Number(w))) : 1 };
}

// ---------------------------------------------------------------------------
// Inheritance: placeholder + text-style defaults from layout/master.
// We extract resolved *values* (not nodes) so they are representation-agnostic.
// ---------------------------------------------------------------------------
interface RunDefaults {
  size?: number; // px
  font?: string; // base family (weight suffix peeled)
  weight?: number; // numeric weight peeled from the family name
  color?: string;
  gradient?: string;
  bold?: boolean;
  italic?: boolean;
}
interface PhInfo {
  box?: { x: number; y: number; w: number; h: number };
  run?: RunDefaults;
  valign?: 'top' | 'center' | 'bottom';
}
interface Inherit {
  /** placeholder lookup by `${type}#${idx}` and by type. */
  ph: Record<string, PhInfo>;
  /** master txStyles by role -> level -> defaults. */
  txStyles: { title: RunDefaults[]; body: RunDefaults[]; other: RunDefaults[] };
  background?: ImpBackground;
  /** Non-placeholder design shapes from master + layout, painted behind slide content. */
  decorations: ImpShape[];
}

function fontFromLatin(latin: ONode | undefined, major: string, minor: string): string | undefined {
  const tf = oattr(latin, 'typeface');
  if (!tf) return undefined;
  if (tf === '+mj-lt') return major;
  if (tf === '+mn-lt') return minor;
  return tf;
}

function runDefaultsFromRPr(rPr: ONode | undefined, ctx: ColorCtx, major: string, minor: string): RunDefaults {
  if (!rPr) return {};
  const fi = fillInfo(rPr, ctx);
  const szRaw = oattr(rPr, 'sz');
  const rawFont = fontFromLatin(ochild(rPr, 'a:latin'), major, minor);
  const nf = rawFont ? normalizeFont(rawFont) : undefined;
  return {
    size: szRaw ? Number(szRaw) / 100 : undefined,
    font: nf?.family,
    weight: nf?.weight,
    color: fi.color,
    gradient: fi.gradient,
    bold: oattr(rPr, 'b') === '1' || undefined,
    italic: oattr(rPr, 'i') === '1' || nf?.italic || undefined,
  };
}

function anchorToValign(a: string | undefined): 'top' | 'center' | 'bottom' | undefined {
  if (a === 'ctr') return 'center';
  if (a === 'b') return 'bottom';
  if (a === 't') return 'top';
  return undefined;
}

function boxFromXfrm(xf: ONode | undefined): { x: number; y: number; w: number; h: number } | undefined {
  const off = ochild(xf, 'a:off');
  const ext = ochild(xf, 'a:ext');
  if (!off || !ext) return undefined;
  return {
    x: px(Number(oattr(off, 'x'))),
    y: px(Number(oattr(off, 'y'))),
    w: px(Number(oattr(ext, 'cx'))),
    h: px(Number(oattr(ext, 'cy'))),
  };
}

/** Field-wise merge of run defaults: defined fields in `b` (the higher-priority
 *  source, e.g. the layout) win, but `b`'s undefined fields keep `a`'s value. */
function mergeRunDefaults(a: RunDefaults | undefined, b: RunDefaults | undefined): RunDefaults | undefined {
  if (!a) return b;
  if (!b) return a;
  const out: RunDefaults = { ...a };
  for (const k of Object.keys(b) as (keyof RunDefaults)[]) if (b[k] !== undefined) (out as any)[k] = b[k];
  return out;
}

function mergePhInfo(a: PhInfo | undefined, b: PhInfo): PhInfo {
  if (!a) return b;
  return { box: b.box ?? a.box, valign: b.valign ?? a.valign, run: mergeRunDefaults(a.run, b.run) };
}

/** Parse a slideLayout or slideMaster spTree for placeholder geometry + run defaults.
 *  Call master first, then layout — layout placeholders OVERRIDE the master per field
 *  (e.g. a dark layout recolours the title to bg1/white over the master's dark default). */
function indexPlaceholders(spTree: ONode | undefined, ctx: ColorCtx, major: string, minor: string, into: Record<string, PhInfo>) {
  for (const sp of ochildren(spTree, 'p:sp')) {
    const ph = odeep(ochild(sp, 'p:nvSpPr'), 'p:ph');
    if (!ph) continue;
    const type = oattr(ph, 'type') ?? 'body';
    const idx = oattr(ph, 'idx') ?? '';
    const spPr = ochild(sp, 'p:spPr');
    const box = boxFromXfrm(ochild(spPr, 'a:xfrm'));
    const bodyPr = odeep(ochild(sp, 'p:txBody'), 'a:bodyPr');
    const lvl1 = odeep(ochild(sp, 'p:txBody'), 'a:lvl1pPr');
    const defRPr = lvl1 ? ochild(lvl1, 'a:defRPr') : undefined;
    const info: PhInfo = {
      box,
      valign: anchorToValign(oattr(bodyPr, 'anchor')),
      run: defRPr ? runDefaultsFromRPr(defRPr, ctx, major, minor) : undefined,
    };
    const keyFull = `${type}#${idx}`;
    into[keyFull] = mergePhInfo(into[keyFull], info);
    if (idx === '' || !into[type]) into[type] = mergePhInfo(into[type], info); // by-type fallback
  }
}

function txStylesFrom(masterRoot: ONode | undefined, ctx: ColorCtx, major: string, minor: string): Inherit['txStyles'] {
  const ts = odeep(masterRoot, 'p:txStyles');
  const role = (tag: string): RunDefaults[] => {
    const styleNode = ochild(ts, tag);
    const out: RunDefaults[] = [];
    for (let i = 1; i <= 9; i++) {
      const lvl = ochild(styleNode, `a:lvl${i}pPr`);
      const defRPr = lvl ? ochild(lvl, 'a:defRPr') : undefined;
      out[i - 1] = defRPr ? runDefaultsFromRPr(defRPr, ctx, major, minor) : {};
    }
    return out;
  };
  return { title: role('p:titleStyle'), body: role('p:bodyStyle'), other: role('p:otherStyle') };
}

function bgFrom(node: ONode | undefined, ctx: ColorCtx, mediaResolve: (embed: string | undefined) => string | undefined): ImpBackground | undefined {
  const bg = ochild(node, 'p:bg');
  if (!bg) return undefined;
  const bgPr = ochild(bg, 'p:bgPr');
  if (bgPr) {
    const fi = fillInfo(bgPr, ctx);
    if (fi.gradient) return { kind: 'gradient', gradient: fi.gradient };
    if (fi.color) return { kind: 'solid', color: fi.color };
    const blip = odeep(bgPr, 'a:blip');
    const src = mediaResolve(oattr(blip, 'r:embed'));
    if (src) return { kind: 'image', src };
  }
  // bgRef (scheme fill index) — approximate with the mapped scheme color.
  const bgRef = ochild(bg, 'p:bgRef');
  if (bgRef) {
    const col = colorFrom(bgRef, ctx);
    if (col) return { kind: 'solid', color: col };
  }
  return undefined;
}

// Merge consecutive runs whose every style-bearing field is identical. PowerPoint
// frequently splits a single styled phrase into many runs (spell-check spans, edit
// history); rendering each as its own inline box breaks cross-run kerning/ligatures,
// so the text width drifts from the original. Merging restores one flow box.
const RUN_STYLE_KEYS: (keyof ImpRun)[] = [
  'bold', 'italic', 'underline', 'strike', 'size', 'color', 'gradient', 'font', 'weight', 'spacing', 'caps', 'baseline', 'href',
];
function sameStyle(a: ImpRun, b: ImpRun): boolean {
  if (a.br || b.br) return false;
  return RUN_STYLE_KEYS.every((k) => a[k] === b[k]);
}
function mergeRuns(runs: ImpRun[]): void {
  for (let i = runs.length - 1; i > 0; i--) {
    if (sameStyle(runs[i - 1], runs[i])) {
      runs[i - 1].text += runs[i].text;
      runs.splice(i, 1);
    }
  }
}

// ---------------------------------------------------------------------------
// Text body -> paragraphs (ordered: runs, breaks, fields interleaved).
// ---------------------------------------------------------------------------
function parseTxBody(
  txBody: ONode | undefined,
  ctx: ColorCtx,
  major: string,
  minor: string,
  def: RunDefaults | undefined,
  nonGoogle: Set<string>,
  fieldText: (type: string | undefined, cached: string) => string,
): ImpPara[] {
  if (!txBody) return [];
  const bodyPr = ochild(txBody, 'a:bodyPr');
  const na = ochild(bodyPr, 'a:normAutofit');
  const scale = na ? (Number(oattr(na, 'fontScale')) || 100000) / 100000 : 1;
  const paras: ImpPara[] = [];

  for (const p of ochildren(txBody, 'a:p')) {
    const pPr = ochild(p, 'a:pPr');
    const buChar = ochild(pPr, 'a:buChar');
    const buAuto = ochild(pPr, 'a:buAutoNum');
    const buNone = ochild(pPr, 'a:buNone');
    const lnSpcPct = odeep(ochild(pPr, 'a:lnSpc'), 'a:spcPct');
    const spcBef = odeep(ochild(pPr, 'a:spcBef'), 'a:spcPts');
    const spcAft = odeep(ochild(pPr, 'a:spcAft'), 'a:spcPts');
    const runs: ImpRun[] = [];

    for (const node of kids(p)) {
      const t = tagOf(node);
      if (t === 'a:br') {
        runs.push({ text: '', br: true });
        continue;
      }
      if (t !== 'a:r' && t !== 'a:fld') continue;
      const rPr = ochild(node, 'a:rPr');
      let text: string;
      if (t === 'a:fld') {
        text = fieldText(oattr(node, 'type'), otext(ochild(node, 'a:t')));
      } else {
        text = otext(ochild(node, 'a:t'));
      }
      if (text === '') continue;
      const fi = fillInfo(rPr, ctx);
      const szRaw = oattr(rPr, 'sz');
      const latinFont = fontFromLatin(ochild(rPr, 'a:latin'), major, minor);
      const nf = latinFont ? normalizeFont(latinFont) : undefined;
      const font = nf?.family ?? def?.font;
      const weight = nf ? nf.weight : def?.weight;
      if (font && !isGoogleFont(font)) nonGoogle.add(font);
      const spc = oattr(rPr, 'spc');
      const cap = oattr(rPr, 'cap');
      const baseline = Number(oattr(rPr, 'baseline') || 0);
      const href = ochild(rPr, 'a:hlinkClick') ? 'href' : undefined; // presence flag (target resolution omitted)
      const sizePx = szRaw ? Number(szRaw) / 100 : def?.size;
      runs.push({
        text,
        bold: oattr(rPr, 'b') === '1' || (szRaw ? undefined : def?.bold),
        italic: oattr(rPr, 'i') === '1' || nf?.italic || (szRaw ? undefined : def?.italic),
        underline: oattr(rPr, 'u') !== undefined && oattr(rPr, 'u') !== 'none',
        strike: oattr(rPr, 'strike') !== undefined && oattr(rPr, 'strike') !== 'noStrike',
        size: sizePx !== undefined ? Math.round(sizePx * scale * 10) / 10 : undefined,
        color: fi.color ?? def?.color,
        gradient: fi.gradient ?? def?.gradient,
        font,
        weight,
        spacing: spc ? Math.round((Number(spc) / 100) * 10) / 10 : undefined,
        caps: cap === 'all' ? 'all' : cap === 'small' ? 'small' : undefined,
        baseline: baseline > 0 ? 'sup' : baseline < 0 ? 'sub' : undefined,
        href,
      });
    }
    if (!runs.length) continue;
    mergeRuns(runs);
    paras.push({
      runs,
      bullet: !!(buChar || buAuto) && !buNone,
      bulletChar: buChar ? oattr(buChar, 'char') : undefined,
      ordered: !!buAuto,
      level: Number(oattr(pPr, 'lvl')) || 0,
      align: oattr(pPr, 'algn'),
      lineHeight: lnSpcPct ? Number(oattr(lnSpcPct, 'val')) / 100000 : undefined,
      spaceBefore: spcBef ? Math.round(Number(oattr(spcBef, 'val')) / 100) : undefined,
      spaceAfter: spcAft ? Math.round(Number(oattr(spcAft, 'val')) / 100) : undefined,
    });
  }
  return paras;
}

// Heuristic: which families Google Fonts can serve. Anything else -> system provider.
const GOOGLE_FONTS = new Set(
  [
    'Inter', 'Roboto', 'Open Sans', 'Lato', 'Montserrat', 'Poppins', 'Raleway', 'Nunito', 'Nunito Sans',
    'Work Sans', 'Source Sans Pro', 'Source Sans 3', 'Source Serif 4', 'Merriweather', 'Playfair Display',
    'Oswald', 'Rubik', 'Mulish', 'Manrope', 'DM Sans', 'DM Serif Display', 'Space Grotesk', 'Karla',
    'Fira Sans', 'Fira Code', 'JetBrains Mono', 'IBM Plex Sans', 'IBM Plex Mono', 'IBM Plex Serif',
    'Quicksand', 'Josefin Sans', 'Barlow', 'Cabin', 'PT Sans', 'PT Serif', 'Noto Sans', 'Noto Serif',
    'Archivo', 'Libre Franklin', 'Libre Baskerville', 'Bitter', 'Crimson Text', 'EB Garamond', 'Lora',
    'Hind', 'Titillium Web', 'Heebo', 'Assistant', 'Exo 2', 'Teko', 'Anton', 'Bebas Neue',
  ].map((f) => f.toLowerCase()),
);
function isGoogleFont(family: string): boolean {
  return GOOGLE_FONTS.has(family.trim().toLowerCase());
}

// ---------------------------------------------------------------------------
// Font-family normalization. PowerPoint stores weight/style variants as part of
// the family name ("Open Sans Extrabold", "Lato Black", "Open Sans Light"). The
// web has no such families — the browser falls back to system-ui and every glyph
// gets the wrong width, which is the single biggest source of text drift. Peel the
// trailing weight/style words to a real base family + a numeric weight so the
// actual web font loads and renders at the intended weight.
// ---------------------------------------------------------------------------
const WEIGHT_SUFFIX =
  /[\s-]+(thin|hairline|extra[\s-]?light|ultra[\s-]?light|semi[\s-]?light|light|regular|normal|book|medium|semi[\s-]?bold|demi[\s-]?bold|extra[\s-]?bold|ultra[\s-]?bold|bold|extra[\s-]?black|ultra[\s-]?black|black|heavy)$/i;
const WEIGHT_MAP: Record<string, number> = {
  thin: 100, hairline: 100, extralight: 200, ultralight: 200, semilight: 350, light: 300,
  regular: 400, normal: 400, book: 400, medium: 500, semibold: 600, demibold: 600,
  bold: 700, extrabold: 800, ultrabold: 800, black: 900, heavy: 900, extrablack: 950, ultrablack: 950,
};
export interface NormFont {
  family: string;
  weight?: number;
  italic?: boolean;
}
const normCache = new Map<string, NormFont>();
export function normalizeFont(raw: string): NormFont {
  const key = raw.trim();
  const hit = normCache.get(key);
  if (hit) return hit;
  let family = key;
  let weight: number | undefined;
  let italic: boolean | undefined;
  // Don't decompose a name the web already serves verbatim (e.g. "Archivo Black",
  // "DM Serif Display", "Bebas Neue") — those are real, distinct families.
  if (!isGoogleFont(family)) {
    // Peel a trailing italic/oblique word, then any number of weight words.
    const it = family.match(/[\s-]+(italic|oblique)$/i);
    if (it) { italic = true; family = family.slice(0, it.index).trim(); }
    let m: RegExpMatchArray | null;
    while ((m = family.match(WEIGHT_SUFFIX))) {
      const word = m[1].toLowerCase().replace(/[\s-]/g, '');
      weight = WEIGHT_MAP[word] ?? weight;
      family = family.slice(0, m.index).trim();
      if (!family) { family = key; break; } // never strip to nothing
    }
  }
  const out: NormFont = { family: family || key, weight, italic };
  normCache.set(key, out);
  return out;
}

// ---------------------------------------------------------------------------
// Geometry helpers operating under a transform context.
// ---------------------------------------------------------------------------
function composedBox(off: ONode, ext: ONode, T: Xform): { x: number; y: number; w: number; h: number } {
  const ox = Number(oattr(off, 'x'));
  const oy = Number(oattr(off, 'y'));
  const ex = Number(oattr(ext, 'cx'));
  const ey = Number(oattr(ext, 'cy'));
  const f = (emu: number) => Math.round((emu / EMU_PER_PX) * 10) / 10; // 0.1px precision
  return {
    x: f(T.ax + ox * T.bx),
    y: f(T.ay + oy * T.by),
    w: f(ex * T.bx),
    h: f(ey * T.by),
  };
}

/** Composed box from an a:xfrm node, or undefined if it lacks off/ext. */
function composedBoxOf(xf: ONode | undefined, T: Xform): { x: number; y: number; w: number; h: number } | undefined {
  const off = ochild(xf, 'a:off');
  const ext = ochild(xf, 'a:ext');
  if (!off || !ext) return undefined;
  return composedBox(off, ext, T);
}

function composeGroup(T: Xform, grpXfrm: ONode): Xform {
  const off = ochild(grpXfrm, 'a:off')!;
  const ext = ochild(grpXfrm, 'a:ext')!;
  const chOff = ochild(grpXfrm, 'a:chOff') ?? off;
  const chExt = ochild(grpXfrm, 'a:chExt') ?? ext;
  const offX = Number(oattr(off, 'x'));
  const offY = Number(oattr(off, 'y'));
  const sx = Number(oattr(ext, 'cx')) / (Number(oattr(chExt, 'cx')) || 1);
  const sy = Number(oattr(ext, 'cy')) / (Number(oattr(chExt, 'cy')) || 1);
  const aPrimeX = offX - Number(oattr(chOff, 'x')) * sx;
  const aPrimeY = offY - Number(oattr(chOff, 'y')) * sy;
  const rotDeg = Number(oattr(grpXfrm, 'rot') || 0) / 60000;
  return {
    ax: T.ax + aPrimeX * T.bx,
    bx: sx * T.bx,
    ay: T.ay + aPrimeY * T.by,
    by: sy * T.by,
    rot: T.rot + rotDeg,
    flipH: T.flipH !== (oattr(grpXfrm, 'flipH') === '1'),
    flipV: T.flipV !== (oattr(grpXfrm, 'flipV') === '1'),
  };
}

// ---------------------------------------------------------------------------
// Recursive shape-tree traversal — paint order preserved.
// ---------------------------------------------------------------------------
interface WalkCtx {
  color: ColorCtx;
  major: string;
  minor: string;
  inherit: Inherit;
  resolveMedia: (embed: string | undefined) => string | undefined;
  nonGoogle: Set<string>;
  fieldText: (type: string | undefined, cached: string) => string;
  warnings: string[];
  /** When walking a layout/master, skip placeholder shapes (the slide fills those). */
  skipPlaceholders?: boolean;
}

function insetsOf(bodyPr: ONode | undefined): { l: number; t: number; r: number; b: number } | undefined {
  if (!bodyPr) return undefined;
  const has = ['lIns', 'tIns', 'rIns', 'bIns'].some((a) => oattr(bodyPr, a) !== undefined);
  if (!has) return undefined;
  const v = (a: string, d: number) => (oattr(bodyPr, a) !== undefined ? px(Number(oattr(bodyPr, a))) : d);
  return { l: v('lIns', 7), t: v('tIns', 4), r: v('rIns', 7), b: v('bIns', 4) };
}

function rolePh(ph: string | undefined): 'title' | 'body' | 'other' {
  if (ph === 'title' || ph === 'ctrTitle') return 'title';
  if (ph === 'body' || ph === 'subTitle') return 'body';
  return 'other';
}

function walkTree(node: ONode, T: Xform, ctx: WalkCtx, out: ImpShape[]) {
  for (const ch of kids(node)) {
    const t = tagOf(ch);
    if (t === 'p:sp') handleSp(ch, T, ctx, out);
    else if (t === 'p:pic') handlePic(ch, T, ctx, out);
    else if (t === 'p:cxnSp') handleCxn(ch, T, ctx, out);
    else if (t === 'p:graphicFrame') handleGraphicFrame(ch, T, ctx, out);
    else if (t === 'p:grpSp') handleGroup(ch, T, ctx, out);
  }
}

function cNvName(nv: ONode | undefined): { name?: string; id?: string } {
  const cNvPr = odeep(nv, 'p:cNvPr');
  return { name: oattr(cNvPr, 'name'), id: oattr(cNvPr, 'id') };
}

function handleSp(sp: ONode, T: Xform, ctx: WalkCtx, out: ImpShape[]) {
  const nv = ochild(sp, 'p:nvSpPr');
  const ph = odeep(nv, 'p:ph');
  const phType = ph ? oattr(ph, 'type') ?? 'body' : undefined;
  const phIdx = ph ? oattr(ph, 'idx') ?? '' : undefined;
  if (ctx.skipPlaceholders && ph) return; // layout/master placeholders are filled by the slide
  const { name, id } = cNvName(nv);
  const spPr = ochild(sp, 'p:spPr');
  const xf = ochild(spPr, 'a:xfrm');

  // Geometry: explicit, else inherited from placeholder.
  let box = composedBoxOf(xf, T);
  const inh = phType ? ctx.inherit.ph[`${phType}#${phIdx}`] ?? ctx.inherit.ph[phType] : undefined;
  if (!box && inh?.box) box = inh.box;
  if (!box) {
    // Last resort: skip but warn (truly geometry-less, e.g. an off-slide placeholder).
    const probe = parseTxBody(ochild(sp, 'p:txBody'), ctx.color, ctx.major, ctx.minor, undefined, ctx.nonGoogle, ctx.fieldText);
    if (probe.length) ctx.warnings.push(`Skipped a ${phType ?? 'text'} shape with no resolvable geometry.`);
    return;
  }

  const rot = (xf ? Number(oattr(xf, 'rot') || 0) / 60000 : 0) + T.rot;
  const flipH = (oattr(xf, 'flipH') === '1') !== T.flipH;
  const flipV = (oattr(xf, 'flipV') === '1') !== T.flipV;

  // Custom geometry -> rasterize (we can't reproduce arbitrary paths).
  const prst = oattr(ochild(spPr, 'a:prstGeom'), 'prst');
  if (ochild(spPr, 'a:custGeom')) {
    out.push({ kind: 'raster', ...box, rotation: rot || undefined, name, id, rasterReq: { name, id, reason: 'custom-geometry' } });
    return;
  }

  // Run defaults, lowest→highest priority: master txStyles < inherited placeholder
  // (layout over master) < the shape's own lstStyle defRPr. mergeRunDefaults keeps a
  // lower layer's value where the higher layer leaves a field undefined (so e.g. a
  // placeholder that only recolours doesn't wipe the inherited size).
  const role = rolePh(phType);
  let def: RunDefaults = mergeRunDefaults(ctx.inherit.txStyles[role]?.[0], inh?.run) ?? {};
  const lstDefRPr = odeep(ochild(ochild(sp, 'p:txBody'), 'a:lstStyle'), 'a:defRPr');
  if (lstDefRPr) def = mergeRunDefaults(def, runDefaultsFromRPr(lstDefRPr, ctx.color, ctx.major, ctx.minor)) ?? def;
  const paras = parseTxBody(ochild(sp, 'p:txBody'), ctx.color, ctx.major, ctx.minor, def, ctx.nonGoogle, ctx.fieldText);
  const bodyPr = odeep(ochild(sp, 'p:txBody'), 'a:bodyPr');
  const valign = anchorToValign(oattr(bodyPr, 'anchor')) ?? inh?.valign;
  const fi = fillInfo(spPr, ctx.color);
  let fillColor = fi.gradient ?? fi.color;
  let stroke = strokeOf(spPr, ctx.color);

  // Fall back to the shape's theme style references (p:style/fillRef,lnRef) when the
  // shape has no direct fill/line — idx "0" means none. Many template shapes (cards,
  // pills) are coloured this way; without it they reconstruct as empty boxes.
  const styleNode = ochild(sp, 'p:style');
  if (!fillColor && styleNode && !ochild(spPr, 'a:noFill')) {
    const fillRef = ochild(styleNode, 'a:fillRef');
    if (fillRef && oattr(fillRef, 'idx') && oattr(fillRef, 'idx') !== '0') fillColor = colorFrom(fillRef, ctx.color);
  }
  if (!stroke && styleNode && !ochild(ochild(spPr, 'a:ln'), 'a:noFill')) {
    const lnRef = ochild(styleNode, 'a:lnRef');
    if (lnRef && oattr(lnRef, 'idx') && oattr(lnRef, 'idx') !== '0') {
      const lc = colorFrom(lnRef, ctx.color);
      if (lc) stroke = { color: lc, width: 1 };
    }
  }
  const ellipse = prst === 'ellipse';
  const radius = prst === 'roundRect' ? Math.round(Math.min(box.w, box.h) * 0.12) : undefined;

  if (paras.length) {
    out.push({
      kind: 'text',
      ...box,
      ph: phType,
      name,
      id,
      paras,
      valign,
      insets: insetsOf(bodyPr),
      rotation: rot || undefined,
      flipH: flipH || undefined,
      flipV: flipV || undefined,
      // A text box can also carry a fill (e.g. a chip/pill behind the text).
      fill: fillColor,
      stroke,
      radius,
      ellipse: ellipse || undefined,
    });
  } else if (fillColor || stroke) {
    out.push({ kind: 'rect', ...box, name, id, fill: fillColor, stroke, rotation: rot || undefined, radius, ellipse: ellipse || undefined });
  }
  // else: an unfilled, textless shape — nothing to render.
}

function handlePic(pic: ONode, T: Xform, ctx: WalkCtx, out: ImpShape[]) {
  const spPr = ochild(pic, 'p:spPr');
  const xf = ochild(spPr, 'a:xfrm');
  const box = composedBoxOf(xf, T);
  if (!box) return;
  const blip = odeep(ochild(pic, 'p:blipFill'), 'a:blip');
  const src = ctx.resolveMedia(oattr(blip, 'r:embed'));
  if (!src) return;
  const { name, id } = cNvName(ochild(pic, 'p:nvPicPr'));
  const rot = (xf ? Number(oattr(xf, 'rot') || 0) / 60000 : 0) + T.rot;
  out.push({ kind: 'image', ...box, src, name, id, rotation: rot || undefined });
}

function handleCxn(cxn: ONode, T: Xform, ctx: WalkCtx, out: ImpShape[]) {
  // Connector: render a straight one as a thin rotated rect; otherwise rasterize.
  const spPr = ochild(cxn, 'p:spPr');
  const xf = ochild(spPr, 'a:xfrm');
  const box = composedBoxOf(xf, T);
  if (!box) return;
  const { name, id } = cNvName(ochild(cxn, 'p:nvCxnSpPr'));
  const prst = oattr(ochild(spPr, 'a:prstGeom'), 'prst');
  const lnColor = colorFrom(ochild(ochild(spPr, 'a:ln'), 'a:solidFill'), ctx.color);
  if (prst === 'straightConnector1' || prst === 'line') {
    // Thin rect spanning the bounding box diagonal is overkill; for axis-aligned
    // straight connectors the bbox is the line. Good enough for most diagrams.
    out.push({ kind: 'rect', ...box, name, id, fill: lnColor ?? '#888', rotation: T.rot || undefined });
  } else {
    out.push({ kind: 'raster', ...box, name, id, rasterReq: { name, id, reason: 'connector' } });
  }
}

function handleGraphicFrame(gf: ONode, T: Xform, ctx: WalkCtx, out: ImpShape[]) {
  const xfrm = odeep(gf, 'p:xfrm') ?? odeep(gf, 'a:xfrm');
  const box = composedBoxOf(xfrm, T);
  const { name, id } = cNvName(ochild(gf, 'p:nvGraphicFramePr'));
  const tbl = odeep(gf, 'a:tbl');
  if (tbl && box) {
    const table = parseTable(tbl, ctx);
    if (table) {
      out.push({ kind: 'table', ...box, name, id, table });
      return;
    }
  }
  // Charts, SmartArt (dgm), OLE -> rasterize.
  if (box) out.push({ kind: 'raster', ...box, name, id, rasterReq: { name, id, reason: 'graphic-frame' } });
}

function parseTable(tbl: ONode, ctx: WalkCtx): ImpTable | undefined {
  const grid = ochild(tbl, 'a:tblGrid');
  const widths = ochildren(grid, 'a:gridCol').map((c) => px(Number(oattr(c, 'w'))));
  const rows: ImpTableCell[][] = [];
  const heights: number[] = [];
  for (const tr of ochildren(tbl, 'a:tr')) {
    heights.push(px(Number(oattr(tr, 'h'))));
    const cells: ImpTableCell[] = [];
    for (const tc of ochildren(tr, 'a:tc')) {
      const paras = parseTxBody(ochild(tc, 'a:txBody'), ctx.color, ctx.major, ctx.minor, undefined, ctx.nonGoogle, ctx.fieldText);
      const fill = solidFill(ochild(tc, 'a:tcPr'), ctx.color);
      cells.push({ paras, fill });
    }
    rows.push(cells);
  }
  if (!rows.length) return undefined;
  return { rows, widths, heights };
}

/** A group is "complex" when reconstructing its children individually would drift —
 *  connectors (curved diagram links), custom geometry, embedded objects, or many
 *  pieces. Such groups are rasterized as a single image (pixel-perfect, anchored). */
function groupIsComplex(grp: ONode): boolean {
  let connectors = 0,
    custom = 0,
    shapes = 0,
    frames = 0;
  const visit = (n: ONode) => {
    for (const c of kids(n)) {
      const t = tagOf(c);
      if (t === 'p:cxnSp') connectors++;
      else if (t === 'p:graphicFrame') frames++;
      else if (t === 'p:sp') {
        shapes++;
        if (ochild(ochild(c, 'p:spPr'), 'a:custGeom')) custom++;
      } else if (t === 'p:grpSp') visit(c);
    }
  };
  visit(grp);
  return connectors >= 2 || custom >= 1 || frames >= 1 || shapes >= 10;
}

function handleGroup(grp: ONode, T: Xform, ctx: WalkCtx, out: ImpShape[]) {
  const grpSpPr = ochild(grp, 'p:grpSpPr');
  const xf = ochild(grpSpPr, 'a:xfrm');
  if (!xf) {
    walkTree(grp, T, ctx, out);
    return;
  }
  const childT = composeGroup(T, xf);
  const box = composedBoxOf(xf, T);
  const rotDeg = Number(oattr(xf, 'rot') || 0) / 60000;
  // Rotated OR diagram-like groups -> rasterize the whole group as one image
  // (recursing would shatter a curved mind-map into dozens of mismatched pieces).
  if (box && (rotDeg !== 0 || groupIsComplex(grp))) {
    const { name, id } = cNvName(ochild(grp, 'p:nvGrpSpPr'));
    out.push({
      kind: 'raster',
      ...box,
      name,
      id,
      rotation: rotDeg || undefined,
      rasterReq: { name, id, reason: rotDeg ? 'rotated-group' : 'complex-group' },
    });
    return;
  }
  walkTree(grp, childT, ctx, out);
}

// ---------------------------------------------------------------------------
// Orchestration
// ---------------------------------------------------------------------------
export async function parsePptx(path: string): Promise<ImportIR> {
  const warnings: string[] = [];
  const zip = await JSZip.loadAsync(readFileSync(path));
  const readStr = async (p: string): Promise<string | null> => {
    const f = zip.file(p);
    return f ? f.async('string') : null;
  };
  const parseOrdered = async (p: string): Promise<ONode | undefined> => {
    const s = await readStr(p);
    return s ? { 'p:_root': ordered.parse(s) } : undefined;
  };

  // canvas
  const presFlat = flat.parse((await readStr('ppt/presentation.xml')) ?? '');
  const sldSz = presFlat?.['p:presentation']?.['p:sldSz'];
  const canvas = { w: px(Number(sldSz?.['@_cx'])) || 1280, h: px(Number(sldSz?.['@_cy'])) || 720 };

  // theme (first)
  const themeFile = Object.keys(zip.files).find((f) => /ppt\/theme\/theme\d+\.xml$/.test(f));
  const themeRoot = themeFile ? { 'p:_root': ordered.parse((await readStr(themeFile)) ?? '') } : undefined;
  const themeEl = odeep(themeRoot, 'a:themeElements');
  const scheme = resolveScheme(ochild(themeEl, 'a:clrScheme'));
  const fontScheme = ochild(themeEl, 'a:fontScheme');
  const fontMajor = oattr(odeep(ochild(fontScheme, 'a:majorFont'), 'a:latin'), 'typeface') ?? 'Inter';
  const fontMinor = oattr(odeep(ochild(fontScheme, 'a:minorFont'), 'a:latin'), 'typeface') ?? 'Inter';

  // slide order via presentation rels
  const presRels = flat.parse((await readStr('ppt/_rels/presentation.xml.rels')) ?? '');
  const relMap: Record<string, string> = {};
  for (const rel of arr(presRels?.['Relationships']?.['Relationship'])) relMap[rel['@_Id']] = rel['@_Target'];
  const slidePaths: string[] = [];
  for (const sldId of arr(presFlat?.['p:presentation']?.['p:sldIdLst']?.['p:sldId'])) {
    const target = relMap[sldId['@_r:id']];
    if (target) slidePaths.push('ppt/' + target.replace(/^\.\.\//, '').replace(/^\//, ''));
  }
  if (!slidePaths.length) {
    Object.keys(zip.files)
      .filter((f) => /ppt\/slides\/slide\d+\.xml$/.test(f))
      .sort((a, b) => parseInt(a.match(/\d+/)![0]) - parseInt(b.match(/\d+/)![0]))
      .forEach((f) => slidePaths.push(f));
  }

  // media catalog
  const mediaName: Record<string, string> = {};
  for (const f of Object.keys(zip.files)) {
    if (/ppt\/media\//.test(f) && !zip.files[f].dir) mediaName[f] = f.split('/').pop()!;
  }
  const usedMedia = new Set<string>();

  // relationship resolver for a given part's .rels
  const relsFor = async (partPath: string): Promise<Record<string, string>> => {
    const relsPath = partPath.replace(/([^/]+)\.xml$/, '_rels/$1.xml.rels');
    const xml = flat.parse((await readStr(relsPath)) ?? '');
    const map: Record<string, string> = {};
    for (const rel of arr(xml?.['Relationships']?.['Relationship'])) map[rel['@_Id']] = rel['@_Target'];
    return map;
  };

  // cache layout/master inheritance per layout part
  const inheritCache: Record<string, Inherit> = {};
  const colorCtx: ColorCtx = { scheme, clrMap: {} };

  const today = todayFormatted();
  const fieldText = (type: string | undefined, cached: string): string => {
    if (!type) return cached;
    if (/^slidenum/i.test(type)) return cached || ''; // resolved per-slide below
    if (/^datetime/i.test(type)) return cached || today;
    return cached;
  };

  const slides: ImpSlide[] = [];
  const deckNonGoogle = new Set<string>();
  let slideNo = 0;

  for (const sp of slidePaths) {
    slideNo++;
    const slideRels = await relsFor(sp);
    const resolveMedia = (embed: string | undefined): string | undefined => {
      if (!embed) return undefined;
      const target = slideRels[embed];
      if (!target) return undefined;
      const mediaPath = 'ppt/' + target.replace(/^\.\.\//, '');
      const fname = mediaName[mediaPath];
      if (fname) usedMedia.add(mediaPath);
      return fname;
    };

    // resolve layout + master for this slide, and build inheritance once per layout
    const layoutTarget = Object.entries(slideRels).find(([, t]) => /slideLayout\d+\.xml$/.test(t))?.[1];
    const layoutPath = layoutTarget ? 'ppt/slides/' + layoutTarget : undefined;
    const layoutNorm = layoutPath ? layoutPath.replace(/ppt\/slides\/\.\.\//, 'ppt/') : undefined;
    let inherit: Inherit = inheritCache['__none__'] ?? { ph: {}, txStyles: { title: [], body: [], other: [] }, decorations: [] };
    let masterColorMap: Record<string, string> = {};

    if (layoutNorm) {
      if (!inheritCache[layoutNorm]) {
        const layoutRoot = await parseOrdered(layoutNorm);
        const layoutRels = await relsFor(layoutNorm);
        const masterTarget = Object.entries(layoutRels).find(([, t]) => /slideMaster\d+\.xml$/.test(t))?.[1];
        const masterNorm = masterTarget ? 'ppt/slideMasters/' + masterTarget.replace(/^\.\.\/slideMasters\//, '') : undefined;
        const masterRoot = masterNorm ? await parseOrdered(masterNorm) : undefined;
        const masterRels = masterNorm ? await relsFor(masterNorm) : {};

        // clrMap from master
        const cm = odeep(masterRoot, 'p:clrMap');
        if (cm) for (const [k, v] of Object.entries(cm[':@'] ?? {})) masterColorMap[k.replace(/^@_/, '')] = String(v);
        const ictx: ColorCtx = { scheme, clrMap: masterColorMap };

        const ph: Record<string, PhInfo> = {};
        indexPlaceholders(odeep(masterRoot, 'p:spTree'), ictx, fontMajor, fontMinor, ph);
        indexPlaceholders(odeep(layoutRoot, 'p:spTree'), ictx, fontMajor, fontMinor, ph); // layout overrides master
        const txStyles = txStylesFrom(masterRoot, ictx, fontMajor, fontMinor);
        const masterBg = bgFrom(odeep(masterRoot, 'p:cSld'), ictx, () => undefined);
        const layoutBg = bgFrom(odeep(layoutRoot, 'p:cSld'), ictx, () => undefined);

        // Design shapes from master + layout (non-placeholder) painted behind slide content.
        const mkResolve = (rels: Record<string, string>) => (embed: string | undefined) => {
          if (!embed) return undefined;
          const target = rels[embed];
          if (!target) return undefined;
          const mediaPath = 'ppt/' + target.replace(/^\.\.\//, '');
          const fname = mediaName[mediaPath];
          if (fname) usedMedia.add(mediaPath);
          return fname;
        };
        const decoCtx = (rels: Record<string, string>): WalkCtx => ({
          color: ictx, major: fontMajor, minor: fontMinor,
          inherit: { ph, txStyles, decorations: [] },
          resolveMedia: mkResolve(rels), nonGoogle: new Set(), fieldText, warnings, skipPlaceholders: true,
        });
        const decorations: ImpShape[] = [];
        const showMaster = oattr(odeep(layoutRoot, 'p:sldLayout'), 'showMasterSp');
        if (masterRoot && showMaster !== '0') walkTree(odeep(masterRoot, 'p:spTree')!, IDENTITY, decoCtx(masterRels), decorations);
        const lTree = odeep(layoutRoot, 'p:spTree');
        if (lTree) walkTree(lTree, IDENTITY, decoCtx(layoutRels), decorations);

        inheritCache[layoutNorm] = { ph, txStyles, background: layoutBg ?? masterBg, decorations };
        (inheritCache[layoutNorm] as any).__clrMap = masterColorMap;
      }
      inherit = inheritCache[layoutNorm];
      masterColorMap = (inherit as any).__clrMap ?? {};
    }
    colorCtx.clrMap = masterColorMap;

    const slideRoot = await parseOrdered(sp);
    const cSld = odeep(slideRoot, 'p:cSld');
    const spTree = odeep(cSld, 'p:spTree');
    if (!spTree) continue;

    const nonGoogle = new Set<string>();
    const slideFieldText = (type: string | undefined, cached: string): string => {
      if (type && /^slidenum/i.test(type)) return cached || String(slideNo);
      return fieldText(type, cached);
    };
    const walk: WalkCtx = {
      color: colorCtx,
      major: fontMajor,
      minor: fontMinor,
      inherit,
      resolveMedia,
      nonGoogle,
      fieldText: slideFieldText,
      warnings,
    };
    // Layout/master design shapes paint behind the slide's own content.
    const shapes: ImpShape[] = inherit.decorations.map((d) => ({ ...d }));
    walkTree(spTree, IDENTITY, walk, shapes);

    // background: slide > layout > master
    const slideBg = bgFrom(cSld, colorCtx, resolveMedia) ?? inherit.background;

    // notes
    let notes: string | undefined;
    const notesTarget = Object.entries(slideRels).find(([, t]) => /notesSlide\d+\.xml$/.test(t))?.[1];
    if (notesTarget) {
      const notesPath = 'ppt/notesSlides/' + notesTarget.replace(/^\.\.\/notesSlides\//, '');
      const notesRoot = await parseOrdered(notesPath);
      const body = odeep(notesRoot, 'p:notes');
      const ntext = body
        ? ochildren(odeep(body, 'p:spTree'), 'p:sp')
            .map((s) => parseTxBody(ochild(s, 'p:txBody'), colorCtx, fontMajor, fontMinor, undefined, nonGoogle, slideFieldText))
            .flat()
            .map((p) => p.runs.map((r) => (r.br ? '\n' : r.text)).join(''))
            .filter((l) => l.trim() && !/^\d+$/.test(l.trim()))
            .join('\n')
        : '';
      if (ntext.trim()) notes = ntext.trim();
    }

    for (const f of nonGoogle) deckNonGoogle.add(f);
    slides.push({ shapes, notes, background: slideBg });
  }

  // assets (only used media)
  const assets: { name: string; data: Buffer }[] = [];
  for (const [mpath, fname] of Object.entries(mediaName)) {
    if (!usedMedia.has(mpath)) continue;
    assets.push({ name: fname, data: await zip.files[mpath].async('nodebuffer') });
  }

  const palette: Record<string, string> = { ...scheme };

  return {
    canvas,
    theme: { palette, fontMajor, fontMinor, nonGoogleFonts: [...deckNonGoogle] },
    slides,
    assets,
    warnings,
  };
}

export { isGoogleFont, mergeRuns };
