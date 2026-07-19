// Copyright 2026 AIVory, Inc.
// SPDX-License-Identifier: Apache-2.0
// Master (theme) YAML (de)serialization — the single read/write path for a *.slaide.yaml
// master. `serializeMaster()` is the canonical writer (schema header + stable top-level key
// order) used by BOTH the importer (core/src/import/emit.ts) and the editor's master
// write-back; it is the inverse of `parseMaster()` / `loadMaster()`, so an in-place theme
// edit round-trips losslessly (load → serialize → reload deep-equals the original).
import yaml from 'js-yaml';
import type { Master } from './types.js';

/** Schema header prepended to every emitted master (drives YAML LSP autocompletion). */
export const MASTER_SCHEMA_HEADER = '# yaml-language-server: $schema=https://getslaide.com/schema/v1.json\n';

/** Canonical top-level key order — keeps emitted masters readable + diff-stable. Any key not
 *  listed here is appended afterwards in its existing order, so nothing is ever dropped. */
const KEY_ORDER: readonly string[] = [
  'schema',
  'name',
  'description',
  'brand',
  'canvas',
  'fonts',
  'typeScale',
  'colors',
  'gradients',
  'tokens',
  'backgrounds',
  'layouts',
  'variants',
  'transitions',
  'animations',
  'chrome',
  'ui',
];

/** Reorder a master's top-level keys into the canonical order (deterministic output). */
function orderKeys(master: Master): Record<string, unknown> {
  const src = master as unknown as Record<string, unknown>;
  const out: Record<string, unknown> = {};
  for (const k of KEY_ORDER) if (src[k] !== undefined) out[k] = src[k];
  for (const k of Object.keys(src)) if (!(k in out) && src[k] !== undefined) out[k] = src[k];
  return out;
}

/** Serialize a Master to canonical `*.slaide.yaml` text (schema header + stable key order). */
export function serializeMaster(master: Master): string {
  return MASTER_SCHEMA_HEADER + yaml.dump(orderKeys(master), { lineWidth: 200 });
}

/** Normalize structured gradient stops ({ color, pos } objects) into CSS fragment strings. */
function normalizeBgs(m: Record<string, any>): void {
  const bgs = m.backgrounds;
  if (!bgs || typeof bgs !== 'object') return;
  for (const bg of Object.values(bgs) as any[]) {
    if (bg?.type === 'gradient' && Array.isArray(bg.stops)) {
      bg.stops = bg.stops.map((s: any) =>
        typeof s === 'string' ? s : `${s.color ?? ''}${s.pos ? ' ' + s.pos : ''}`.trim(),
      );
    }
  }
}

/** Parse `*.slaide.yaml` master text into a Master object (inverse of serializeMaster). */
export function parseMaster(text: string): Master {
  const obj = yaml.load(text);
  if (!obj || typeof obj !== 'object' || Array.isArray(obj)) {
    throw new Error('Master YAML is not a valid mapping');
  }
  normalizeBgs(obj as Record<string, any>);
  return obj as Master;
}
