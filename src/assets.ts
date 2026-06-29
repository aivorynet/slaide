// Copyright 2026 AIVory, Inc.
// SPDX-License-Identifier: Apache-2.0
// Bundled-asset access: themes, language spec, theme schema. These back both
// the CLI and the MCP server / skill (single source of truth, no drift).
import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { dirname, resolve, join, basename } from 'node:path';
import { fileURLToPath } from 'node:url';
import yaml from 'js-yaml';
import type { Master } from './types.js';

function root(): string {
  // moduleDir is src/ (tsx) or dist/ (built); project root is one level up.
  return resolve(dirname(fileURLToPath(import.meta.url)), '..');
}

export function themesDir(): string {
  return join(root(), 'themes');
}

export interface ThemeInfo {
  name: string;
  path: string;
  layouts: string[];
  description: string | null;
}

export function listThemes(): ThemeInfo[] {
  const dir = themesDir();
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((f) => /\.(ya?ml)$/.test(f))
    .map((f) => {
      const path = join(dir, f);
      try {
        const m = yaml.load(readFileSync(path, 'utf8')) as Master;
        return {
          name: m?.name ?? basename(f).replace(/\.slaide\.ya?ml$/, ''),
          path,
          layouts: Object.keys(m?.layouts ?? {}),
          description: m?.description ?? null,
        };
      } catch {
        return { name: basename(f), path, layouts: [], description: null };
      }
    });
}

function readDoc(rel: string, fallback: string): string {
  const p = join(root(), rel);
  return existsSync(p) ? readFileSync(p, 'utf8') : fallback;
}

export function getSpec(): string {
  return readDoc('docs/spec.md', '# slaide spec\n(Spec document not found.)');
}

export function getThemeSchema(): string {
  const p = join(root(), 'docs/themes.md');
  if (existsSync(p)) return readFileSync(p, 'utf8');
  // Fallback: describe bundled themes.
  return listThemes()
    .map((t) => `## ${t.name}\nLayouts: ${t.layouts.join(', ')}`)
    .join('\n\n');
}
