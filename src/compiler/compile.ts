// Copyright 2026 AIVory, Inc.
// SPDX-License-Identifier: Apache-2.0
// Compiler: ParsedDeck + Master -> DeckIR (the renderer-agnostic contract).
import type {
  BackgroundDef,
  DeckIR,
  LayoutDef,
  Master,
  ParsedDeck,
  RegionIR,
  SlideIR,
  SlotDef,
  Warning,
} from '../types.js';
import { SCHEMA_VERSION } from '../types.js';
import { resolveColors, resolveFonts, resolveTypeScale, resolveVariant } from './tokens.js';
import { renderRegion, isKnownColorClass, colorValue } from './markdown.js';
import { resolveChrome, placeholderCtx, todayFormatted } from './chrome.js';
import { expandAnchor } from '../util.js';
import {
  ENTRANCE_NAMES,
  SLIDE_TRANSITION_NAMES,
  entranceCss,
  isSlideTransition,
  masterAnimations,
  slideTransitionCss,
} from '../render/anim.js';

function deriveCanvas(master: Master): { width: number; height: number; aspect: string } {
  const c = master.canvas ?? {};
  const aspect = c.aspect ?? '16:9';
  let width = c.width ?? 1280;
  let height = c.height ?? 0;
  if (!height) {
    const m = aspect.match(/^(\d+):(\d+)$/);
    height = m ? Math.round((width * parseInt(m[2], 10)) / parseInt(m[1], 10)) : 720;
  }
  return { width, height, aspect };
}

const VALIGN: Record<string, string> = { top: 'start', center: 'center', bottom: 'end' };
const JUSTIFY: Record<string, string> = { left: 'start', center: 'center', right: 'end' };

// Exported as the canonical slot style-key set (see src/vocab.ts); `anchor` and `box`
// are handled before this map and added to the vocab list there.
export const STYLE_MAP: Record<string, (v: string) => [string, string]> = {
  font: (v) => ['font-family', `var(--font-${v})`],
  bg: (v) => ['background', v],
  size: (v) => ['font-size', v.match(/[\d]/) && /(px|em|rem|%|vw|vh)$/.test(v) ? v : `var(--size-${v})`],
  // Mirror box:/bg: — fall back palette → literal so a palette name (or a raw
  // colour) never resolves to an undefined var() and renders invisible text.
  color: (v) => ['color', colorValue(v)],
  fill: (v) => ['--region-fill', `var(--gradient-${v})`], // gradient text fill (see CSS .sl-region[style*="--region-fill"])
  align: (v) => ['text-align', v],
  valign: (v) => ['align-self', VALIGN[v] ?? v], // vertical alignment within the grid cell
  justify: (v) => ['justify-self', JUSTIFY[v] ?? v],
  weight: (v) => ['font-weight', v],
  leading: (v) => ['line-height', v],
  transform: (v) => ['text-transform', v],
  italic: () => ['font-style', 'italic'],
  maxw: (v) => ['max-width', v],
  pad: (v) => ['padding', v], // text-box insets (importer) / explicit padding
  opacity: (v) => ['opacity', v],
  radius: (v) => ['border-radius', v],
  border: (v) => ['border', v],
  rotate: (v) => ['transform', /[a-z(]/i.test(v) ? v : `rotate(${v})`], // shape rotation/flip
};

// justify-content for vertically anchored (absolutely positioned) slots, where
// `align-self` is inert. See mapSlotStyle.
const VALIGN_FLEX: Record<string, string> = { top: 'flex-start', center: 'center', bottom: 'flex-end' };

interface StyleDiag {
  tokens: Record<string, string>;
  warnings: Warning[];
  line?: number;
  slide: number;
  slot: string;
}

function mapSlotStyle(style: Record<string, string> | undefined, diag?: StyleDiag): Record<string, string> {
  const out: Record<string, string> = {};
  if (!style) return out;
  const anchored = 'anchor' in style;
  // Warn when a colour/gradient reference names nothing real — it silently falls
  // back to a literal (often invisible). Without this, `validate` says "valid"
  // while the slide renders blank text.
  const warnColor = (raw: string) => {
    if (diag && !isKnownColorClass(raw, diag.tokens)) {
      diag.warnings.push({
        code: 'unknown-color',
        message: `Slide ${diag.slide}: slot "${diag.slot}" references colour "${raw}" — not a master colour role/palette name or a CSS colour. It falls back to the literal value, which usually renders invisible or wrong.`,
        line: diag.line,
      });
    }
  };
  for (const [k, v] of Object.entries(style)) {
    if (k === 'anchor') {
      // absolutely position the slot region: "x% y% w% h%" of the canvas
      Object.assign(out, expandAnchor(String(v)));
      continue;
    }
    if (k === 'valign' && anchored) {
      // On an absolutely-positioned slot, align-self does nothing. For center/bottom
      // lay the region out as a flex column; top is already block-flow default.
      const j = VALIGN_FLEX[String(v)] ?? String(v);
      if (j && j !== 'flex-start') {
        out['display'] = 'flex';
        out['flex-direction'] = 'column';
        out['justify-content'] = j;
      }
      continue;
    }
    if (k === 'box') {
      // surface panel: background + padding + radius (e.g. closing card, callouts).
      // Accepts `true` (surface role), a colour role/palette name, a raw hex/CSS colour,
      // a **named master gradient** (e.g. box: brand), or a raw gradient literal — so a
      // padded, rounded, gradient hero/closing panel is possible.
      const raw = typeof v === 'string' && v !== 'true' ? v : '';
      if (raw && diag?.tokens[`--gradient-${raw}`] !== undefined) {
        out['background'] = `var(--gradient-${raw})`; // named master gradient
      } else {
        // Warn only on a bare name (typo guard); a hex/`rgb()`/`gradient()` literal is fine.
        if (raw && !raw.includes('(')) warnColor(raw);
        out['background'] = colorValue(raw || 'surface');
      }
      out['padding'] = '1.4em 2em';
      out['border-radius'] = '16px';
      continue;
    }
    if (k === 'fill' && diag && diag.tokens[`--gradient-${v}`] === undefined) {
      diag.warnings.push({
        code: 'unknown-gradient',
        message: `Slide ${diag.slide}: slot "${diag.slot}" fill: "${v}" is not a master gradient — the text gets no fill (often invisible).`,
        line: diag.line,
      });
    }
    const fn = STYLE_MAP[k];
    if (fn) {
      if (k === 'color') warnColor(String(v));
      const [prop, val] = fn(String(v));
      out[prop] = val;
    }
  }
  return out;
}

// ---- contrast lint --------------------------------------------------------
// Catch dark-on-dark / light-on-light text that `validate` would otherwise pass:
// a layout's background and its slots' text colour are resolved independently, so a
// dark-background layout whose slots use default (light-variant) roles renders
// invisible. We compare each text slot's resolved colour against its background.
const TEXT_ROLE_BY_TYPE: Record<string, string> = {
  title: 'heading',
  subtitle: 'heading',
  quote: 'heading',
  caption: 'muted',
};
const CONTRAST_MIN = 2.5; // below this, text is effectively unreadable (not merely muted)

function firstHex(s: string | undefined): string | null {
  const m = s?.match(/#[0-9a-fA-F]{3,8}/);
  return m ? m[0] : null;
}
function relLum(hex: string): number | null {
  let h = hex.replace(/^#/, '');
  if (h.length === 3) h = h.split('').map((c) => c + c).join('');
  if (h.length < 6) return null;
  const n = parseInt(h.slice(0, 6), 16);
  if (Number.isNaN(n)) return null;
  const lin = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((v) => {
    const s = v / 255;
    return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
  });
  return 0.2126 * lin[0] + 0.7152 * lin[1] + 0.0722 * lin[2];
}
function contrastRatio(a: string, b: string): number | null {
  const la = relLum(a);
  const lb = relLum(b);
  if (la === null || lb === null) return null;
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}
/** Resolve a colour value (hex / role / palette / var(--color-x)) to a hex, or null. */
function colorToHex(raw: string | undefined, tokens: Record<string, string>): string | null {
  if (!raw) return null;
  const v = raw.trim();
  if (/^#[0-9a-fA-F]{3,8}$/.test(v)) return v;
  const name = (v.match(/--(?:color|palette)-([\w-]+)/)?.[1]) ?? (/^[\w-]+$/.test(v) ? v : null);
  if (name) {
    const t = tokens[`--color-${name}`] ?? tokens[`--palette-${name}`];
    if (t) return firstHex(t) ?? (/^#[0-9a-fA-F]{3,8}$/.test(t.trim()) ? t.trim() : null);
  }
  return firstHex(v);
}
/** Candidate background colours for a slide (gradient → every stop). [] if unknowable. */
function bgHexes(bg: BackgroundDef | null, tokens: Record<string, string>): string[] {
  if (!bg) {
    const h = colorToHex(tokens['--color-background'], tokens);
    return h ? [h] : [];
  }
  if (bg.type === 'image') return []; // can't assess a photo background
  if (bg.type === 'solid') {
    const h = colorToHex(bg.color, tokens);
    return h ? [h] : [];
  }
  return bg.stops.map((s) => firstHex(s)).filter((h): h is string => !!h);
}
/** Candidate hexes for a slot surface value (box:/bg:). A named/literal gradient
 *  contributes every stop (worst-case checked); a solid value its single colour. */
function surfaceHexes(surface: string, tokens: Record<string, string>): string[] {
  const grad = tokens[`--gradient-${surface}`] ?? (surface.includes('gradient(') ? surface : undefined);
  if (grad) return [...grad.matchAll(/#[0-9a-fA-F]{3,8}/g)].map((m) => m[0]);
  const h = colorToHex(surface, tokens);
  return h ? [h] : [];
}
/** Worst-case text/background contrast for a text-bearing slot, or null if unknowable. */
function slotContrast(slot: SlotDef, bg: BackgroundDef | null, tokens: Record<string, string>): number | null {
  if (slot.type === 'image' || slot.type === 'media' || slot.type === 'free') return null;
  const txt = colorToHex(slot.style?.color ?? `--color-${TEXT_ROLE_BY_TYPE[slot.type] ?? 'text'}`, tokens);
  // A slot's own surface (box: <role|gradient>/bg: <colour>) overrides the slide background
  // for contrast purposes — a dark panel on a light slide is perfectly readable.
  const surface = slot.style?.box ?? slot.style?.bg;
  if (txt && typeof surface === 'string' && surface !== 'true') {
    const surfCands = surfaceHexes(surface, tokens);
    if (surfCands.length) {
      let w = Infinity;
      for (const c of surfCands) {
        const r = contrastRatio(c, txt);
        if (r !== null) w = Math.min(w, r);
      }
      if (w !== Infinity) return w;
    }
  }
  const cands = bgHexes(bg, tokens);
  if (!txt || !cands.length) return null;
  let worst = Infinity;
  for (const c of cands) {
    const r = contrastRatio(c, txt);
    if (r !== null) worst = Math.min(worst, r);
  }
  return worst === Infinity ? null : worst;
}

function normalizeAreas(areas: string[]): string {
  // Single-quote each row so the value is safe inside a double-quoted HTML
  // style attribute (CSS accepts single-quoted strings).
  return areas.map((row) => `'${String(row).replace(/['"]/g, '').trim()}'`).join(' ');
}

const FALLBACK_LAYOUT: LayoutDef = {
  areas: ['default'],
  slots: { default: { type: 'body' } },
};

function asString(v: unknown): string | undefined {
  return typeof v === 'string' ? v : undefined;
}

export function compile(parsed: ParsedDeck, master: Master): DeckIR {
  const warnings: Warning[] = [...parsed.warnings];
  const canvas = deriveCanvas(master);

  const colorTokens = resolveColors(master.colors, warnings);
  const typeTokens = resolveTypeScale(master.typeScale);
  const { tokens: fontTokens, imports: fontImports } = resolveFonts(master.fonts as any, warnings);
  const gradientTokens: Record<string, string> = {};
  for (const [k, v] of Object.entries(master.gradients ?? {})) gradientTokens[`--gradient-${k}`] = v;
  const tokens: Record<string, string> = {
    '--canvas-w': `${canvas.width}px`,
    '--canvas-h': `${canvas.height}px`,
    '--slide-padding': '6%',
    '--slide-gap': '0.8em',
    ...colorTokens,
    ...typeTokens,
    ...fontTokens,
    ...gradientTokens,
    ...(master.tokens ?? {}), // master overrides (spacing, chrome metrics, …)
  };

  const today = todayFormatted();
  const totalSlides = parsed.slides.length;

  const transitions = {
    default: master.transitions?.default ?? 'fade',
    duration: master.transitions?.duration ?? 400,
  };
  // A master-wide default easing maps to a root --transition-ease token.
  if (master.transitions?.ease) tokens['--transition-ease'] = master.transitions.ease;

  // The on-screen position indicator (progress bar + counter) is on by default; a master
  // can switch it off (`ui: { progress: false }`), and deck headmatter `progress:` wins
  // over the master. Web runtime only — print/PDF never render these elements.
  const hmProgress = parsed.headmatter.progress;
  const ui = {
    progress: typeof hmProgress === 'boolean' ? hmProgress : master.ui?.progress !== false,
  };

  // Merge master-defined custom animations into the catalog vocabulary so they
  // validate as known names; their CSS rides on DeckIR.animCss.
  const custom = masterAnimations(master.animations);
  for (const w of custom.warnings) warnings.push({ code: 'bad-animation', message: w });
  const animCss = slideTransitionCss(custom.slides) + '\n' + entranceCss(custom.entrances);
  const customTransitions = new Set(Object.keys(custom.slides));
  const validEntrances = new Set<string>([...ENTRANCE_NAMES, ...Object.keys(custom.entrances)]);

  const layoutNames = Object.keys(master.layouts ?? {});
  const firstLayout = layoutNames[0] ?? 'blank';

  // Cascade state: keys set with `~` prefix persist to following slides.
  // Seed from deck headmatter `~` keys (deck-wide defaults).
  const cascaded: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(parsed.headmatter)) {
    if (k.startsWith('~')) cascaded[k.slice(1)] = v;
  }
  const slides: SlideIR[] = [];

  parsed.slides.forEach((pslide, i) => {
    const scoped: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(pslide.frontmatter)) {
      if (k.startsWith('~')) cascaded[k.slice(1)] = v;
      else scoped[k] = v;
    }
    const eff = { ...cascaded, ...scoped };

    const layoutName = asString(eff.layout) ?? firstLayout;
    const layoutDef = master.layouts?.[layoutName] ?? FALLBACK_LAYOUT;
    if (!master.layouts?.[layoutName]) {
      warnings.push({
        code: 'unknown-layout',
        message: `Slide ${i + 1}: unknown layout "${layoutName}", using fallback.`,
        line: pslide.sourceLine,
      });
    }

    const transition = asString(eff.transition) ?? transitions.default;
    if (!isSlideTransition(transition) && !customTransitions.has(transition)) {
      warnings.push({
        code: 'unknown-transition',
        message: `Slide ${i + 1}: unknown transition "${transition}". Valid: ${[...SLIDE_TRANSITION_NAMES, ...customTransitions].join(', ')}.`,
        line: pslide.sourceLine,
      });
    }

    // Background (slide override > layout default).
    const bgName = asString(eff.background) ?? layoutDef.background;
    let background: BackgroundDef | null = null;
    if (bgName) {
      background = master.backgrounds?.[bgName] ?? null;
      if (!background) {
        warnings.push({
          code: 'unknown-background',
          message: `Slide ${i + 1}: unknown background "${bgName}".`,
          line: pslide.sourceLine,
        });
      }
    }

    // Variant overrides (scoped to this slide) + per-slide animation timing.
    // A slide's `variant:` wins; otherwise a layout may bind its own variant, so a
    // dark layout's slots resolve light roles automatically (no dark-on-dark trap).
    const variantName = asString(eff.variant) ?? asString(layoutDef.variant);
    const vars: Record<string, string> = variantName ? resolveVariant(master, variantName, warnings) : {};
    const tms = eff['transition-ms'];
    if (tms !== undefined) vars['--transition-ms'] = /^[\d.]+$/.test(String(tms)) ? `${tms}ms` : String(tms);
    const tease = asString(eff['transition-ease']);
    if (tease) vars['--transition-ease'] = tease;

    const morph = asString(eff.morph) ?? null;

    // Grid from layout.
    const rowCount = layoutDef.areas.length;
    const grid = {
      areas: normalizeAreas(layoutDef.areas),
      rows: layoutDef.rows ?? Array(rowCount).fill('auto').join(' '),
      cols: layoutDef.cols ?? '1fr',
      padding: layoutDef.padding ?? 'var(--slide-padding)',
      gap: layoutDef.gap ?? 'var(--slide-gap)',
      align: layoutDef.align ?? 'start',
    };

    // Effective colour tokens for this slide (base + variant) — used by the contrast lint.
    const slideTokens = { ...tokens, ...vars };

    // Route regions into slots.
    const slotNames = Object.keys(layoutDef.slots);
    const primarySlot = layoutDef.slots['body'] ? 'body' : slotNames[0] ?? 'default';
    const counter = { n: 0 };
    const regions: RegionIR[] = [];

    for (const region of pslide.regions) {
      const target = region.name === 'default' ? primarySlot : region.name;
      // `free` is a built-in, layout-independent full-slide layer for absolutely
      // positioned shapes/boxes (placed in the source). Always accepted.
      const slot: SlotDef | undefined = target === 'free' ? { type: 'free' } : layoutDef.slots[target];
      if (!slot) {
        // Always warn on a misrouted region — content silently disappears otherwise,
        // and an empty `:: typo ::` is just as likely a mistake the author should see.
        const has = region.markdown.trim() !== '';
        const slotList = Object.keys(layoutDef.slots).join(', ') || '(none)';
        warnings.push({
          code: 'unknown-slot',
          message: `Slide ${i + 1}: layout "${layoutName}" has no slot "${target}"${has ? ' — its content is dropped' : ''}. Available slots: ${slotList}.`,
          line: pslide.sourceLine,
        });
        continue;
      }
      const { html } = renderRegion(region.markdown, counter, tokens, warnings, pslide.sourceLine, validEntrances);
      if (html.trim() === '') continue;
      regions.push({
        name: target,
        source: region.name, // original parsed region name (source-provenance; the slot name may differ for `default`)
        html,
        slotType: slot.type,
        style: mapSlotStyle(slot.style, { tokens, warnings, line: pslide.sourceLine, slide: i + 1, slot: target }),
      });

      // Contrast lint: text that resolves close to its background renders unreadable
      // but `validate` can't see it — flag it so the agent doesn't ship invisible slides.
      const cr = slotContrast(slot, background, slideTokens);
      if (cr !== null && cr < CONTRAST_MIN) {
        warnings.push({
          code: 'low-contrast',
          message: `Slide ${i + 1}: slot "${target}" text has low contrast against its background (${cr.toFixed(1)}:1) — likely hard to read or invisible. Set the slot's colour, bind a variant on the layout, or change the background.`,
          line: pslide.sourceLine,
        });
      }
    }

    // Resolve chrome (header/footer/logo) with placeholders for this slide.
    const headingMatch = pslide.regions.map((r) => r.markdown).join('\n').match(/^#{1,6}\s+(.+)$/m);
    const slideTitle = headingMatch ? headingMatch[1].replace(/[*_`]/g, '').trim() : null;
    const ctx = placeholderCtx(parsed.headmatter, eff, i + 1, totalSlides, slideTitle, today);
    const chrome = resolveChrome(master, layoutDef, eff, ctx, warnings);

    slides.push({
      index: i,
      layout: layoutName,
      transition,
      background,
      bgName: bgName ?? null,
      variantName: variantName ?? null,
      grid,
      regions,
      notes: pslide.notes,
      buildCount: counter.n,
      morph,
      vars,
      chrome,
    });
  });

  return {
    schema: SCHEMA_VERSION,
    meta: {
      title: asString(parsed.headmatter.title) ?? null,
      author: asString(parsed.headmatter.author) ?? null,
    },
    canvas,
    tokens,
    fontImports,
    transitions,
    animCss,
    ui,
    slides,
    warnings,
  };
}
