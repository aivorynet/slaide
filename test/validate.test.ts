// validateSource severity end-to-end (real files, real master resolution — see index.ts
// compileSource/validateSource): unknown-slot must be a hard error (ok:false), not a warning,
// covering both an explicit `layout:` and the deck's default (unset) layout.
import { test, expect, beforeAll, afterAll } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { validateSource } from '../src/index.js';

const MASTER = `schema: slaide/1
name: testtheme
layouts:
  title-content:
    areas: ["title", "body"]
    slots:
      title: { type: title }
      body: { type: body }
`;

let root: string;

beforeAll(() => {
  root = mkdtempSync(join(tmpdir(), 'slaide-validate-test-'));
  mkdirSync(root, { recursive: true });
  writeFileSync(join(root, 'master.slaide.yaml'), MASTER, 'utf8');
});
afterAll(() => rmSync(root, { recursive: true, force: true }));

test('unknown-slot on an EXPLICIT layout: is a hard error (ok:false), not a silent no-op warning', () => {
  const src = `---
master: ./master.slaide.yaml
title: T
---
layout: title-content
---
:: left ::
Hello

:: right ::
World
`;
  const { ok, diagnostics } = validateSource(src, root);
  expect(ok).toBe(false);
  const bad = diagnostics.filter((d) => d.code === 'unknown-slot');
  expect(bad.length).toBe(2); // both :: left :: and :: right :: are unrouted
  expect(bad.every((d) => d.severity === 'error')).toBe(true);
  expect(bad[0].message).toContain('This layout defines: title, body');
});

test('unknown-slot on the DECK\'S DEFAULT layout (no frontmatter layout:) is also a hard error', () => {
  const src = `---
master: ./master.slaide.yaml
title: T
---
:: subtitle ::
No layout: chosen — falls back to the master's first layout (title-content)
`;
  const { ok, diagnostics } = validateSource(src, root);
  expect(ok).toBe(false);
  const bad = diagnostics.find((d) => d.code === 'unknown-slot');
  expect(bad).toBeDefined();
  expect(bad!.severity).toBe('error');
  expect(bad!.message).toContain('layout "title-content"');
});

test('a slide that only uses defined slots never triggers unknown-slot, and validates clean', () => {
  const src = `---
master: ./master.slaide.yaml
title: T
---
layout: title-content
---
:: title ::
Hi

:: body ::
World
`;
  const { ok, diagnostics } = validateSource(src, root);
  expect(ok).toBe(true);
  expect(diagnostics.some((d) => d.code === 'unknown-slot')).toBe(false);
});
