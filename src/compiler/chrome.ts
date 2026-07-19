// Copyright 2026 AIVory, Inc.
// SPDX-License-Identifier: Apache-2.0
// Header / footer / logo chrome resolution + placeholder substitution.
import { md } from './markdown.js';
import type { ChromeDef, LayoutDef, Master, ResolvedChrome, Warning } from '../types.js';
import { escapeHtml } from '../util.js';

export type PlaceholderCtx = Record<string, string | number | null | undefined>;

const PH = /\{\{\s*([\w.-]+)\s*\}\}/g;

export function substitute(tpl: string, ctx: PlaceholderCtx, warnings: Warning[]): string {
  return tpl.replace(PH, (_m, key: string) => {
    const v = ctx[key];
    if (v === undefined) {
      warnings.push({ code: 'unknown-placeholder', message: `Unknown placeholder {{${key}}}` });
      return '';
    }
    return v == null ? '' : String(v);
  });
}

function renderBand(
  band: { left?: string; center?: string; right?: string } | undefined,
  ctx: PlaceholderCtx,
  warnings: Warning[],
): { left: string; center: string; right: string } | null {
  if (!band) return null;
  const f = (s?: string) => (s ? md.renderInline(substitute(s, ctx, warnings)) : '');
  const left = f(band.left);
  const center = f(band.center);
  const right = f(band.right);
  if (!left && !center && !right) return null;
  return { left, center, right };
}

/** Cover and outro/closing slides carry no bottom page number by default (the footer band holds
 *  it). Matches layout names like `cover`, `outro`, `closing`, `thanks`, `end`, `back-cover` —
 *  an author can always opt back in with an explicit `chrome: footer|both` on the slide/layout. */
export function isNumberlessLayout(name: string | undefined): boolean {
  if (!name) return false;
  return /(^|[-_ ])(cover|outro|closing|thanks?|thank-?you|end|finale)([-_ ]|$)/i.test(name);
}

/** mode: false|'none' → no chrome; 'header'|'footer' → one band; true|'both' → both. */
function resolveMode(
  frontmatter: Record<string, unknown>,
  layout: LayoutDef,
  master: Master,
  layoutName?: string,
): { header: boolean; footer: boolean; logo: boolean } {
  const explicit = (frontmatter.chrome as unknown) ?? layout.chrome;
  const raw = explicit ?? (master.chrome ? 'both' : 'none');
  let header = false;
  let footer = false;
  if (raw === true || raw === 'both') header = footer = true;
  else if (raw === 'header') header = true;
  else if (raw === 'footer') footer = true;
  // false / 'none' → both stay false
  // Safety net: cover/outro slides get no footer page-number unless chrome is set explicitly.
  if (explicit === undefined && isNumberlessLayout(layoutName)) footer = false;
  const logoOff = frontmatter.logo === false || layout.logo === false;
  const logo = (header || footer || raw === 'logo') && !logoOff;
  return { header, footer, logo };
}

// `chrome.logo` is injected verbatim into the header (html.ts renderChrome) so an author
// can hand-write an <img>/<svg> mark or a plain text wordmark. AI-authored masters
// sometimes put a bare asset URL/path there instead — with no wrapping, that string
// renders as literal on-slide text rather than an image. Anything containing markup
// ('<') is assumed intentional and passes through unchanged; a bare URL/path (no
// whitespace/quotes/angle brackets) is auto-wrapped into an <img>. Plain text (a brand
// name) matches neither shape and is also left unchanged.
const BARE_URL_RE = /^(https?:\/\/|\/)[^\s"'<>]+$/;

function wrapLogo(raw: string): string {
  const trimmed = raw.trim();
  if (trimmed.includes('<')) return raw;
  if (BARE_URL_RE.test(trimmed)) return `<img src="${escapeHtml(trimmed)}" alt="">`;
  return raw;
}

/** Pick the mark for a `chrome.logo` that's a `{ dark, light }` pair, keyed by the slide's
 *  resolved ground (`groundDark`, from the compiler's effective-background/variant
 *  resolution — see compile.ts `slideGroundDark`). A lone string is used everywhere; given
 *  only one key, that key is used everywhere too. `groundDark === null` (unknowable, e.g. a
 *  photo background with no flat colour) prefers `light` — the more common default look. */
function pickLogo(logo: ChromeDef['logo'], groundDark: boolean | null): string | undefined {
  if (logo == null) return undefined;
  if (typeof logo === 'string') return logo;
  if (groundDark === true) return logo.dark ?? logo.light;
  if (groundDark === false) return logo.light ?? logo.dark;
  return logo.light ?? logo.dark;
}

export function resolveChrome(
  master: Master,
  layout: LayoutDef,
  frontmatter: Record<string, unknown>,
  ctx: PlaceholderCtx,
  warnings: Warning[],
  layoutName?: string,
  groundDark: boolean | null = null,
): ResolvedChrome | null {
  const chrome: ChromeDef | undefined = master.chrome;
  if (!chrome) return null;
  const mode = resolveMode(frontmatter, layout, master, layoutName);
  if (!mode.header && !mode.footer && !mode.logo) return null;
  const logoRaw = mode.logo ? pickLogo(chrome.logo, groundDark) : undefined;
  return {
    header: mode.header ? renderBand(chrome.header, ctx, warnings) : null,
    footer: mode.footer ? renderBand(chrome.footer, ctx, warnings) : null,
    logo: logoRaw ? wrapLogo(logoRaw) : null,
    logoPos: chrome.logoPos ?? 'top-left',
  };
}

function pad2(n: number): string {
  return String(n).padStart(2, '0');
}

/** Build the placeholder context for a slide. */
export function placeholderCtx(
  headmatter: Record<string, unknown>,
  frontmatter: Record<string, unknown>,
  page: number,
  total: number,
  slideTitle: string | null,
  today: string,
): PlaceholderCtx {
  const ctx: PlaceholderCtx = {};
  // headmatter custom vars (company, date, etc.), then per-slide frontmatter.
  for (const [k, v] of Object.entries(headmatter)) {
    if (k.startsWith('~')) continue;
    if (typeof v === 'string' || typeof v === 'number') ctx[k] = v;
  }
  for (const [k, v] of Object.entries(frontmatter)) {
    if (typeof v === 'string' || typeof v === 'number') ctx[k] = v;
  }
  // built-ins (override custom only where unset)
  ctx.page = page;
  ctx.total = total;
  ctx.pagePadded = pad2(page);
  ctx.totalPadded = pad2(total);
  if (ctx.date === undefined) ctx.date = today;
  if (ctx.title === undefined) ctx.title = (headmatter.title as string) ?? '';
  if (ctx.author === undefined) ctx.author = (headmatter.author as string) ?? '';
  ctx.slideTitle = slideTitle ?? '';
  if (ctx.footer === undefined) ctx.footer = ''; // optional per-slide tagline
  return ctx;
}

export function todayFormatted(): string {
  const d = new Date();
  return `${pad2(d.getDate())}/${pad2(d.getMonth() + 1)}/${d.getFullYear()}`;
}
