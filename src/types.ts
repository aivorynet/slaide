// Copyright 2026 AIVory, Inc.
// SPDX-License-Identifier: Apache-2.0
// Shared types for the slaide pipeline: parser AST and the compiled IR.
// The IR (DeckIR) is the durable, renderer-agnostic contract. Bump SCHEMA_VERSION
// only with a migration story (see plan: @slaide/migrate).

export const SCHEMA_VERSION = 'slaide/1' as const;

// ---------------------------------------------------------------------------
// Parser AST — the lightly-structured result of reading a .slaide file.
// ---------------------------------------------------------------------------

export interface Warning {
  code: string;
  message: string;
  line?: number;
}

export interface ParsedRegion {
  name: string;
  /** Raw markdown (region marker stripped). Build/anchor sigils handled in compiler. */
  markdown: string;
}

export interface ParsedSlide {
  /** Per-slide config (scoped) merged with cascaded keys at compile time. */
  frontmatter: Record<string, unknown>;
  regions: ParsedRegion[];
  notes: string | null;
  sourceLine: number;
}

export interface ParsedDeck {
  headmatter: Record<string, unknown>;
  slides: ParsedSlide[];
  warnings: Warning[];
}

// ---------------------------------------------------------------------------
// Master (theme) authoring shape — what a *.slaide.yaml master contains.
// ---------------------------------------------------------------------------

export interface MasterFont {
  family: string;
  provider?: 'google' | 'local' | 'system';
  weights?: number[];
}

export interface TypeScale {
  base: string; // e.g. "22px"
  ratio: number; // e.g. 1.25
  // name -> exponent (number, modular scale) OR explicit size string (e.g. "72px")
  steps: Record<string, number | string>;
}

export interface MasterColors {
  palette: Record<string, string>;
  roles: Record<string, string>; // may reference {palette.x}
}

export type BackgroundDef =
  | { type: 'solid'; color: string }
  | { type: 'gradient'; stops: string[]; angle?: number }
  | {
      type: 'image';
      src: string;
      /** CSS background-size: 'cover' | 'contain' | 'stretch' (→ 100% 100%) | any raw
       *  value (e.g. 'auto', '80%'). Default 'cover'. */
      fit?: string;
      /** CSS background-position, e.g. 'center' | 'top' | 'right' | '50% 20%'. Default 'center'. */
      position?: string;
      /** CSS background-repeat, e.g. 'no-repeat' | 'repeat' | 'repeat-x'. Default 'no-repeat'. */
      repeat?: string;
      /** 0..1 black multiply overlay so text stays legible over the photo. */
      dim?: number;
    };

export interface SlotDef {
  type: string; // title | subtitle | body | image | media | ...
  style?: Record<string, string>; // { font: display, size: h1, color: accent, align: center }
}

export interface LayoutDef {
  /** grid-template-areas rows, each a quoted string of area names. */
  areas: string[];
  rows?: string;
  cols?: string;
  background?: string; // name into master.backgrounds
  variant?: string; // bind a variant to this layout (e.g. a dark layout uses its dark roles)
  slots: Record<string, SlotDef>;
  padding?: string;
  gap?: string;
  align?: string; // vertical alignment: start | center | end
  chrome?: boolean | string; // chrome visibility override for this layout
  logo?: boolean; // hide the corner logo on this layout
}

export interface VariantDef {
  roles?: Record<string, string>;
  tokens?: Record<string, string>;
}

export interface ChromeBand {
  left?: string;
  center?: string;
  right?: string;
}

export interface ChromeDef {
  header?: ChromeBand;
  footer?: ChromeBand;
  /** Raw inline SVG/HTML/URL for a logo mark. A single string is used on every slide
   *  (unchanged); `{ dark, light }` picks per slide by its resolved ground — `dark` = the
   *  mark legible ON a dark background, `light` = ON a light background. Given only one
   *  key, that mark is used on every slide regardless of ground. */
  logo?: string | { dark?: string; light?: string };
  /** Logo corner: top-left | top-right | bottom-left | bottom-right. */
  logoPos?: string;
}

/** Brand identity metadata a deck is branded for. The master's own `colors:`/`fonts:` ARE
 *  the brand (no separate palette/fonts copy here — that duplication was a mistake); this
 *  block just names/locks it. Set/overridden by the user only — the hosted agent treats a
 *  `locked` brand as read-only while it works. */
export interface MasterBrand {
  /** Brand / company name this deck is branded for. */
  name?: string;
  /** Brand logo: raw inline SVG/HTML mark or an asset reference. */
  logo?: string;
  /** When true the AI must not alter this block mid-run; the user can still override it. */
  locked?: boolean;
}

export interface Master {
  schema?: string;
  name: string;
  description?: string;
  /** Immutable brand identity (see MasterBrand). Metadata + lock; roles still drive the CSS. */
  brand?: MasterBrand;
  canvas?: { aspect?: string; width?: number; height?: number };
  fonts?: Record<string, MasterFont>;
  typeScale?: TypeScale;
  colors?: MasterColors;
  /** Named gradients -> CSS gradient strings (used by `.grad` spans and slot styles). */
  gradients?: Record<string, string>;
  /** Raw CSS custom-property overrides merged into the deck tokens (e.g. spacing/chrome). */
  tokens?: Record<string, string>;
  backgrounds?: Record<string, BackgroundDef>;
  layouts?: Record<string, LayoutDef>;
  variants?: Record<string, VariantDef>;
  transitions?: { default?: string; duration?: number; ease?: string };
  /** Theme-defined named animations (slide transitions and/or element entrances),
   *  merged into the built-in catalog so authors/AI can reference them by name. */
  animations?: Record<string, MasterAnimationDef>;
  chrome?: ChromeDef;
  /** Interactive-presentation UI toggles (web runtime only; never affects PDF/print). */
  ui?: { progress?: boolean };
}

export interface MasterAnimationDef {
  /** slide transition: keyframe body for the entering slide, e.g. "from{…} to{…}". */
  in?: string;
  /** slide transition: keyframe body for the leaving slide. */
  out?: string;
  /** element entrance: pre-reveal hidden state, e.g. "opacity:0;transform:scale(.8)". */
  hidden?: string;
  /** force interpretation as an entrance (otherwise inferred from `hidden` vs `in`/`out`). */
  entrance?: boolean;
  duration?: number;
  ease?: string;
}

// ---------------------------------------------------------------------------
// Compiled IR — the renderer-agnostic deck contract.
// ---------------------------------------------------------------------------

export interface RegionIR {
  name: string;
  /** Original parsed region name in the source (`default` or a `:: marker ::`),
   *  before routing to a layout slot — source-provenance for round-tripping the
   *  rendered DOM back to its source region (the DOM `name` is the slot, which may
   *  differ from the source name for the default region). */
  source: string;
  /** Rendered HTML, with build elements carrying data-build. */
  html: string;
  /** Style hints resolved from the slot definition. */
  slotType: string;
  style: Record<string, string>;
}

export interface SlideIR {
  index: number;
  layout: string;
  transition: string;
  background: BackgroundDef | null;
  /** master-defined names for this slide (for editor round-tripping; null when unset). */
  bgName?: string | null;
  variantName?: string | null;
  /** grid CSS for this slide's layout. */
  grid: { areas: string; rows: string; cols: string; padding: string; gap: string; align: string };
  regions: RegionIR[];
  notes: string | null;
  /** total number of build steps on this slide. */
  buildCount: number;
  morph: string | null;
  /** per-slide CSS custom property overrides (from variants). */
  vars: Record<string, string>;
  /** resolved chrome (placeholders substituted, inline markdown rendered). */
  chrome: ResolvedChrome | null;
}

export interface ResolvedChrome {
  header: { left: string; center: string; right: string } | null;
  footer: { left: string; center: string; right: string } | null;
  logo: string | null;
  logoPos: string;
}

export interface DeckIR {
  schema: string;
  meta: { title: string | null; author: string | null };
  canvas: { width: number; height: number; aspect: string };
  /** flat CSS custom properties, e.g. "--color-text": "#fff". */
  tokens: Record<string, string>;
  /** font import directives (e.g. google fonts URL or @font-face css). */
  fontImports: string[];
  transitions: { default: string; duration: number };
  /** CSS for master-defined custom animations (appended to the deck stylesheet). */
  animCss: string;
  /** Resolved interactive-UI toggles (web runtime only). */
  ui: { progress: boolean };
  slides: SlideIR[];
  warnings: Warning[];
}
