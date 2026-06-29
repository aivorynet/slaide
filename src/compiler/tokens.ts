// Copyright 2026 AIVory, Inc.
// SPDX-License-Identifier: Apache-2.0
// Token resolution: master design tokens -> flat CSS custom properties.
import type { Master, MasterColors, TypeScale, Warning } from '../types.js';

const REF_RE = /\{([\w.-]+)\}/g;

/** Resolve `{palette.x}` / `{role.x}` references with cycle protection. */
function resolveRefs(
  map: Record<string, string>,
  lookups: Record<string, Record<string, string>>,
  warnings: Warning[],
): Record<string, string> {
  const out: Record<string, string> = {};

  const resolveOne = (key: string, value: string, stack: string[]): string => {
    return value.replace(REF_RE, (_m, path: string) => {
      const [ns, name] = path.split('.');
      const table = ns === path ? map : lookups[ns];
      const raw = table ? table[name ?? ns] : undefined;
      if (raw === undefined) {
        warnings.push({ code: 'unknown-token', message: `Unknown token reference {${path}}` });
        return `var(--missing-${path.replace(/\./g, '-')})`;
      }
      const ref = `${ns}.${name}`;
      if (stack.includes(ref)) {
        warnings.push({ code: 'token-cycle', message: `Token reference cycle at {${path}}` });
        return raw.replace(REF_RE, '');
      }
      return resolveOne(ref, raw, [...stack, ref]);
    });
  };

  for (const [k, v] of Object.entries(map)) {
    out[k] = resolveOne(k, v, [k]);
  }
  return out;
}

export function resolveColors(colors: MasterColors | undefined, warnings: Warning[]): Record<string, string> {
  if (!colors) return {};
  const palette = colors.palette ?? {};
  const roles = colors.roles ?? {};
  const resolvedRoles = resolveRefs(roles, { palette }, warnings);
  const tokens: Record<string, string> = {};
  for (const [k, v] of Object.entries(palette)) tokens[`--palette-${k}`] = v;
  for (const [k, v] of Object.entries(resolvedRoles)) tokens[`--color-${k}`] = v;
  return tokens;
}

function parseDim(s: string): { value: number; unit: string } {
  const m = String(s).trim().match(/^([\d.]+)\s*([a-z%]*)$/i);
  if (!m) return { value: 16, unit: 'px' };
  return { value: parseFloat(m[1]), unit: m[2] || 'px' };
}

export function resolveTypeScale(ts: TypeScale | undefined): Record<string, string> {
  if (!ts) return {};
  const { value, unit } = parseDim(ts.base);
  const ratio = ts.ratio || 1.2;
  const tokens: Record<string, string> = {};
  tokens['--type-base'] = `${value}${unit}`;
  for (const [name, exp] of Object.entries(ts.steps ?? {})) {
    if (typeof exp === 'string') {
      // explicit size, e.g. "72px" — used when matching a precise design.
      tokens[`--size-${name}`] = exp;
    } else {
      const size = value * Math.pow(ratio, exp);
      tokens[`--size-${name}`] = `${Math.round(size * 100) / 100}${unit}`;
    }
  }
  return tokens;
}

// Fonts that ship with essentially every PowerPoint install (Windows/macOS + the Office
// bundle), so a `system`/`local` provider is safe — PowerPoint won't substitute and the
// .pptx renders correctly without embedding. Anything else with a non-Google provider
// won't be embedded and risks a wrong-font render off the authoring machine.
const SAFE_SYSTEM_FONTS = new Set(
  [
    'Arial', 'Arial Black', 'Times New Roman', 'Courier New', 'Georgia', 'Verdana', 'Tahoma',
    'Trebuchet MS', 'Comic Sans MS', 'Impact', 'Calibri', 'Cambria', 'Candara', 'Consolas',
    'Constantia', 'Corbel', 'Segoe UI', 'Garamond', 'Palatino Linotype', 'Franklin Gothic',
  ].map((f) => f.toLowerCase()),
);

export function resolveFonts(
  fonts: Record<string, { family: string; provider?: string; weights?: number[] }> | undefined,
  warnings?: Warning[],
): { tokens: Record<string, string>; imports: string[] } {
  const tokens: Record<string, string> = {};
  if (!fonts) return { tokens, imports: [] };
  const fallback: Record<string, string> = {
    display: 'system-ui, sans-serif',
    mono: 'ui-monospace, monospace',
  };
  // Merge requested weights per family so shared families import once.
  const byFamily = new Map<string, Set<number>>();
  for (const [role, def] of Object.entries(fonts)) {
    const stack = `"${def.family}", ${fallback[role] ?? 'system-ui, sans-serif'}`;
    tokens[`--font-${role}`] = stack;
    if (def.provider === 'google' || def.provider === undefined) {
      const set = byFamily.get(def.family) ?? new Set<number>();
      for (const w of def.weights ?? [400, 700]) set.add(w);
      byFamily.set(def.family, set);
    } else if (!SAFE_SYSTEM_FONTS.has(def.family.trim().toLowerCase())) {
      // Non-Google, non-common-system font: not embeddable, so PowerPoint substitutes it
      // on any machine without the font installed (and a PDF/web render needs it present).
      warnings?.push({
        code: 'non-embeddable-font',
        message: `Font role "${role}" uses "${def.family}" (provider: ${def.provider}) — it isn't a Google font (won't be embedded in .pptx) nor a common system font, so PowerPoint will substitute it off this machine. Use a real Google font (provider: google) for portable embedding, or a common system font (Arial, Calibri, Georgia…).`,
      });
    }
  }
  const google = [...byFamily.entries()].map(
    ([family, ws]) => `family=${family.replace(/ /g, '+')}:wght@${[...ws].sort((a, b) => a - b).join(';')}`,
  );
  const imports = google.length
    ? [`https://fonts.googleapis.com/css2?${google.join('&')}&display=swap`]
    : [];
  return { tokens, imports };
}

/** Resolve a variant's role/token overrides into CSS custom properties. */
export function resolveVariant(
  master: Master,
  name: string,
  warnings: Warning[],
): Record<string, string> {
  const v = master.variants?.[name];
  if (!v) {
    warnings.push({ code: 'unknown-variant', message: `Unknown variant "${name}"` });
    return {};
  }
  const palette = master.colors?.palette ?? {};
  const out: Record<string, string> = {};
  if (v.roles) {
    const resolved = resolveRefs(v.roles, { palette }, warnings);
    for (const [k, val] of Object.entries(resolved)) out[`--color-${k}`] = val;
  }
  if (v.tokens) for (const [k, val] of Object.entries(v.tokens)) out[k] = val;
  return out;
}
