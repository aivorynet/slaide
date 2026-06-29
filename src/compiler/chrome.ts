// Copyright 2026 AIVory, Inc.
// SPDX-License-Identifier: Apache-2.0
// Header / footer / logo chrome resolution + placeholder substitution.
import { md } from './markdown.js';
import type { ChromeDef, LayoutDef, Master, ResolvedChrome, Warning } from '../types.js';

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

/** mode: false|'none' → no chrome; 'header'|'footer' → one band; true|'both' → both. */
function resolveMode(
  frontmatter: Record<string, unknown>,
  layout: LayoutDef,
  master: Master,
): { header: boolean; footer: boolean; logo: boolean } {
  const raw = (frontmatter.chrome as unknown) ?? layout.chrome ?? (master.chrome ? 'both' : 'none');
  let header = false;
  let footer = false;
  if (raw === true || raw === 'both') header = footer = true;
  else if (raw === 'header') header = true;
  else if (raw === 'footer') footer = true;
  // false / 'none' → both stay false
  const logoOff = frontmatter.logo === false || layout.logo === false;
  const logo = (header || footer || raw === 'logo') && !logoOff;
  return { header, footer, logo };
}

export function resolveChrome(
  master: Master,
  layout: LayoutDef,
  frontmatter: Record<string, unknown>,
  ctx: PlaceholderCtx,
  warnings: Warning[],
): ResolvedChrome | null {
  const chrome: ChromeDef | undefined = master.chrome;
  if (!chrome) return null;
  const mode = resolveMode(frontmatter, layout, master);
  if (!mode.header && !mode.footer && !mode.logo) return null;
  return {
    header: mode.header ? renderBand(chrome.header, ctx, warnings) : null,
    footer: mode.footer ? renderBand(chrome.footer, ctx, warnings) : null,
    logo: mode.logo && chrome.logo ? chrome.logo : null,
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
