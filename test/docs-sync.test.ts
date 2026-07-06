// Docs / skill drift lint. Binds the canonical vocabulary (src/vocab.ts) to three
// surfaces so none can silently drift:
//   (A) the human docs (docs/*.md) must DOCUMENT every canonical token — catches the
//       classic "engine gained a transition, docs still list the old five".
//   (B) the bundled skill (skills/slaide/*.md) must MATCH docs/ verbatim — catches
//       "edited a doc, forgot to run sync-skill".
//   (C) src's emitted diagnostic `code:` literals must EQUAL vocab.DIAGNOSTIC_CODES —
//       catches "added a warning code in the compiler, never documented it".
// Add a token to the engine -> this fails until vocab.ts + the docs learn about it.
import { test, expect, describe } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  TRANSITIONS, ENTRANCES, SPAN_SIZE_CLASSES, SPAN_UTIL_CLASSES, IMAGE_UTIL_CLASSES,
  RENDERABLE_FENCES, PLACEHOLDER_BUILTINS, SLOT_STYLE_KEYS, SLOT_TYPES,
  FRONTMATTER_CONFIG_KEYS, DIAGNOSTIC_CODES,
} from '../src/vocab.js';

const CORE = join(dirname(fileURLToPath(import.meta.url)), '..');
const DOC_FILES = ['spec.md', 'grammar.md', 'themes.md'];
const read = (p: string) => readFileSync(p, 'utf8');
const docs = DOC_FILES.map((f) => read(join(CORE, 'docs', f))).join('\n');

/** Tokens the docs must mention somewhere across the doc set (they cross-link, so any
 *  of the three counts). Missing tokens are reported together for a fast fix. */
function expectDocumented(label: string, tokens: readonly string[]): void {
  const missing = tokens.filter((t) => !docs.includes(t));
  expect(missing, `docs/*.md are missing ${label}: ${missing.join(', ')}`).toEqual([]);
}

describe('(A) docs document every canonical token', () => {
  test('transitions', () => expectDocumented('transitions', TRANSITIONS));
  test('entrances', () => expectDocumented('entrances', ENTRANCES));
  test('span size classes', () => expectDocumented('span sizes', SPAN_SIZE_CLASSES));
  test('span util classes', () => expectDocumented('span utils', SPAN_UTIL_CLASSES));
  test('image util classes', () => expectDocumented('image utils', IMAGE_UTIL_CLASSES));
  test('renderable fences', () => expectDocumented('fences', RENDERABLE_FENCES));
  test('placeholder built-ins', () => expectDocumented('placeholders', PLACEHOLDER_BUILTINS));
  test('slot style keys', () => expectDocumented('style keys', SLOT_STYLE_KEYS));
  test('slot types', () => expectDocumented('slot types', SLOT_TYPES));
  test('frontmatter config keys', () => expectDocumented('frontmatter keys', FRONTMATTER_CONFIG_KEYS));
  test('diagnostic codes', () => expectDocumented('diagnostic codes', DIAGNOSTIC_CODES));
});

describe('(B) bundled skill matches docs verbatim (run sync-skill after editing docs)', () => {
  // sync-skill.ts writes docs/spec.md -> skill/reference.md, and copies themes.md + grammar.md.
  for (const [docName, skillName] of [
    ['spec.md', 'reference.md'],
    ['themes.md', 'themes.md'],
    ['grammar.md', 'grammar.md'],
  ] as const) {
    test(`${skillName} == docs/${docName}`, () => {
      const src = read(join(CORE, 'docs', docName));
      const bundled = read(join(CORE, 'skills', 'slaide', skillName));
      expect(bundled, `skills/slaide/${skillName} is stale — run \`npx tsx scripts/dev/sync-skill.ts\``).toBe(src);
    });
  }
});

describe('(C) vocab.DIAGNOSTIC_CODES is exhaustive vs the compiler', () => {
  test('every code: literal in parser/compiler/index is in the registry (and vice-versa)', () => {
    // Scope: the validate/compile diagnostics (author-facing). CLI/import-layer codes are out.
    const roots = [join(CORE, 'src', 'parser'), join(CORE, 'src', 'compiler'), join(CORE, 'src', 'index.ts')];
    const files: string[] = [];
    const walk = (p: string) => {
      if (statSync(p).isDirectory()) for (const e of readdirSync(p)) walk(join(p, e));
      else if (p.endsWith('.ts')) files.push(p);
    };
    roots.forEach(walk);
    const found = new Set<string>();
    for (const f of files) {
      const text = read(f);
      for (const m of text.matchAll(/\bcode:\s*'([a-z][a-z-]+)'/g)) found.add(m[1]);
    }
    const registry = new Set(DIAGNOSTIC_CODES);
    const undocumented = [...found].filter((c) => !registry.has(c));
    const stale = [...registry].filter((c) => !found.has(c));
    expect(undocumented, `codes emitted in src but absent from vocab.DIAGNOSTIC_CODES: ${undocumented.join(', ')}`).toEqual([]);
    expect(stale, `codes in vocab.DIAGNOSTIC_CODES no longer emitted in src: ${stale.join(', ')}`).toEqual([]);
  });
});
