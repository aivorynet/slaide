// Copyright 2026 AIVory, Inc.
// SPDX-License-Identifier: Apache-2.0
//
// Model-authored slide markdown can drop raw HTML with an inline `var(--X)` that
// names no real master token — e.g. `<span style="font-size:var(--size-stat)">20×</span>`
// when the master's typeScale has no `stat` step. An undefined CSS custom property
// resolves to nothing, so the declaration is dropped and the element falls back to
// its INHERITED size/colour — a "big stat" can render SMALLER than body text with no
// visible error anywhere (`validate` said "valid"). See G13.
//
// This module (a) scans every piece of emitted HTML/CSS for a deck and reports each
// distinct undefined `var(--X)` name once (`unknown-var`, a warning, never an error —
// the deck must still render), and (b) rewrites bare (no-fallback) references to
// `var(--X, <fallback>)` so the render degrades to something sane instead of invisible/
// wrong-sized, even before the master or the model fixes the token.
import type { Warning } from '../types.js';

export interface UnknownVarResult {
  /** One `unknown-var` warning per distinct undefined name referenced with no inline
   *  fallback already present, deduped across the whole deck. */
  warnings: Warning[];
  /** Rewrites bare `var(--X)` refs (no existing fallback) whose name was found
   *  undefined into `var(--X, <fallback>)`. A no-op on any string that doesn't
   *  reference such a name (including strings never passed to the scan). */
  fix: (css: string) => string;
}

interface VarRef {
  start: number;
  end: number; // exclusive, one past the closing ')'
  name: string;
  hasFallback: boolean;
}

/** Scan `css` for every `var(--name)` / `var(--name, fallback)` reference, honoring
 *  nested parens in the fallback (e.g. `var(--x, var(--y, 2px))`). */
function scanVarRefs(css: string): VarRef[] {
  const refs: VarRef[] = [];
  const re = /var\(/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(css))) {
    const start = m.index;
    let depth = 1;
    let i = re.lastIndex;
    let commaIdx = -1;
    while (i < css.length && depth > 0) {
      const c = css[i];
      if (c === '(') depth++;
      else if (c === ')') {
        depth--;
        if (depth === 0) break;
      } else if (c === ',' && depth === 1 && commaIdx === -1) commaIdx = i;
      i++;
    }
    if (depth !== 0) break; // unterminated `var(` — nothing more to scan
    const end = i + 1; // include the closing ')'
    const nameSpan = css.slice(re.lastIndex, commaIdx === -1 ? i : commaIdx);
    const nameMatch = nameSpan.match(/^\s*(--[\w-]+)\s*$/);
    re.lastIndex = end;
    if (!nameMatch) continue;
    refs.push({ start, end, name: nameMatch[1], hasFallback: commaIdx !== -1 });
  }
  return refs;
}

function parseLeadingNumber(v: string): number | null {
  const m = v.trim().match(/^(-?[\d.]+)/);
  return m ? parseFloat(m[1]) : null;
}

/** The literal value of the largest defined `--size-*` token — an invented size name
 *  is almost always a display/stat moment, so "render big" is the safer failure mode
 *  than "render at the browser default" (usually smaller than body text). */
function largestDefinedSize(tokens: Record<string, string>): string {
  let best: { raw: string; n: number } | null = null;
  for (const [k, v] of Object.entries(tokens)) {
    if (!k.startsWith('--size-')) continue;
    const n = parseLeadingNumber(v);
    if (n === null) continue;
    if (!best || n > best.n) best = { raw: v, n };
  }
  return best ? best.raw : '3em'; // no sizes defined at all — a generous literal default
}

/** The first defined master gradient, or 'none' if the master defines none. */
function firstDefinedGradient(tokens: Record<string, string>): string {
  for (const [k, v] of Object.entries(tokens)) {
    if (k.startsWith('--gradient-')) return v;
  }
  return 'none';
}

/** Where an author should define this token, used in the warning's hint. */
function definitionHint(name: string): string {
  if (name.startsWith('--size-')) return `typeScale.steps.${name.slice('--size-'.length)}`;
  if (name.startsWith('--color-')) return `colors.roles.${name.slice('--color-'.length)}`;
  if (name.startsWith('--palette-')) return `colors.palette.${name.slice('--palette-'.length)}`;
  if (name.startsWith('--gradient-')) return `gradients.${name.slice('--gradient-'.length)}`;
  if (name.startsWith('--font-')) return `fonts.${name.slice('--font-'.length)}`;
  return `tokens.${name}`;
}

/** A same-prefix literal fallback so an undefined var still renders sensibly:
 *  sizes fall back to the biggest defined size (a stat/display moment, not body text),
 *  colours/palette to `currentColor`, gradients to the first defined gradient (or
 *  `none`), and anything else to `inherit`. */
function computeFallback(name: string, tokens: Record<string, string>): string {
  if (name.startsWith('--size-')) return largestDefinedSize(tokens);
  if (name.startsWith('--color-') || name.startsWith('--palette-')) return 'currentColor';
  if (name.startsWith('--gradient-')) return firstDefinedGradient(tokens);
  return 'inherit';
}

/** Detect + prepare an autofix for undefined `var(--X)` references across a deck.
 *  `cssSources` is every HTML/CSS string worth scanning (region HTML, per-deck
 *  animation CSS, …); `definedVars` is every custom property the deck actually emits
 *  (root token CSS + any per-slide variant overrides); `tokens` is the root token map
 *  (used to compute fallback literals, e.g. the largest `--size-*`). */
export function lintUnknownVars(
  cssSources: readonly string[],
  definedVars: ReadonlySet<string>,
  tokens: Record<string, string>,
): UnknownVarResult {
  const fallbackByName = new Map<string, string>();
  const warnings: Warning[] = [];

  for (const css of cssSources) {
    if (!css) continue;
    for (const ref of scanVarRefs(css)) {
      // An explicit fallback already makes the reference safe — the author (or a
      // prior pass of this same fixer) already handled the "undefined" case.
      if (ref.hasFallback || definedVars.has(ref.name)) continue;
      if (!fallbackByName.has(ref.name)) {
        fallbackByName.set(ref.name, computeFallback(ref.name, tokens));
        warnings.push({
          code: 'unknown-var',
          message: `undefined CSS variable var(${ref.name}) — define it in the master (e.g. ${definitionHint(ref.name)}) or use an existing token`,
        });
      }
    }
  }

  const fix = (css: string): string => {
    if (fallbackByName.size === 0 || !css) return css;
    const refs = scanVarRefs(css).filter((r) => !r.hasFallback && fallbackByName.has(r.name));
    if (refs.length === 0) return css;
    let out = '';
    let last = 0;
    for (const ref of refs) {
      out += css.slice(last, ref.end - 1) + `, ${fallbackByName.get(ref.name)})`;
      last = ref.end;
    }
    out += css.slice(last);
    return out;
  };

  return { warnings, fix };
}
