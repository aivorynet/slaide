import { test, expect, beforeAll, afterAll } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { packDeck, unpackDeck, openDeck, isSlaidec, SLAIDEC_FORMAT } from '../src/container.js';
import { compileSource } from '../src/index.js';

const MASTER = `schema: slaide/1
name: testtheme
canvas: { aspect: "16:9", width: 1280, height: 720 }
colors:
  palette: { ink: "#000", brand: "#0af" }
  roles: { background: "{palette.ink}", text: "#fff", accent: "{palette.brand}" }
layouts:
  cover:
    areas: ["title"]
    rows: "1fr"
    slots:
      title: { type: title, style: { color: accent } }
`;

const DECK = `---
master: ./master.slaide.yaml
title: Test
---
layout: cover
---
:: title ::
Hello [world]{.accent}

![logo](assets/logo.svg)
`;

const LOGO = '<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"><rect width="10" height="10"/></svg>';

let root: string;
let folder: string;

/** A working folder: deck.slaide + master.slaide.yaml + assets/logo.svg. */
function makeFolder(dir: string): void {
  mkdirSync(join(dir, 'assets'), { recursive: true });
  writeFileSync(join(dir, 'deck.slaide'), DECK, 'utf8');
  writeFileSync(join(dir, 'master.slaide.yaml'), MASTER, 'utf8');
  writeFileSync(join(dir, 'assets', 'logo.svg'), LOGO, 'utf8');
}

beforeAll(() => {
  root = mkdtempSync(join(tmpdir(), 'slaidec-test-'));
  folder = join(root, 'work');
  makeFolder(folder);
});
afterAll(() => rmSync(root, { recursive: true, force: true }));

test('pack a folder → openDeck → compiles identically to the original folder', async () => {
  const out = join(root, 'deck.slaidec');
  await packDeck(folder, out, { force: true });
  expect(existsSync(out)).toBe(true);
  expect(isSlaidec(out)).toBe(true);

  const opened = await openDeck(out);
  expect(opened.container).not.toBeNull();
  expect(opened.deckFile.endsWith('deck.slaide')).toBe(true);

  const fromContainer = compileSource(readFileSync(opened.deckFile, 'utf8'), opened.deckDir);
  const fromFolder = compileSource(DECK, folder);
  expect(fromContainer.ir).toEqual(fromFolder.ir);
});

test('pack is deterministic — same input → byte-identical archive', async () => {
  const a = join(root, 'det-a.slaidec');
  const b = join(root, 'det-b.slaidec');
  await packDeck(folder, a, { force: true });
  await packDeck(folder, b, { force: true });
  expect(readFileSync(a).equals(readFileSync(b))).toBe(true);
});

test('unpack is the inverse of pack — files and bytes survive', async () => {
  const out = join(root, 'rt.slaidec');
  await packDeck(folder, out, { force: true });
  const dest = join(root, 'unpacked');
  const r = await unpackDeck(out, dest, { force: true });
  expect(r.entryDeck).toBe('deck.slaide');
  expect(readFileSync(join(dest, 'deck.slaide'), 'utf8')).toBe(DECK);
  expect(readFileSync(join(dest, 'master.slaide.yaml'), 'utf8')).toBe(MASTER);
  expect(readFileSync(join(dest, 'assets', 'logo.svg'), 'utf8')).toBe(LOGO);
  const manifest = JSON.parse(readFileSync(join(dest, 'slaidec.json'), 'utf8'));
  expect(manifest.format).toBe(SLAIDEC_FORMAT);
  expect(manifest.deck).toBe('deck.slaide');
});

test('pack a deck FILE curates deck + master + sibling assets', async () => {
  const out = join(root, 'file.slaidec');
  await packDeck(join(folder, 'deck.slaide'), out, { force: true });
  const dest = join(root, 'file-unpacked');
  await unpackDeck(out, dest, { force: true });
  expect(existsSync(join(dest, 'deck.slaide'))).toBe(true);
  expect(existsSync(join(dest, 'master.slaide.yaml'))).toBe(true);
  expect(existsSync(join(dest, 'assets', 'logo.svg'))).toBe(true);
});

test('openDeck on a directory resolves the entry deck (no container)', async () => {
  const opened = await openDeck(folder);
  expect(opened.container).toBeNull();
  expect(opened.deckFile.endsWith('deck.slaide')).toBe(true);
  expect(opened.deckDir).toBe(folder);
});

test('back-compat: openDeck on a plain .slaide returns it unchanged', async () => {
  const deckPath = join(folder, 'deck.slaide');
  const opened = await openDeck(deckPath);
  expect(opened.container).toBeNull();
  expect(opened.deckFile).toBe(deckPath);
  expect(isSlaidec(deckPath)).toBe(false);
});

test('loud failure: corrupt .slaidec', async () => {
  const bad = join(root, 'corrupt.slaidec');
  writeFileSync(bad, 'this is not a zip', 'utf8');
  await expect(openDeck(bad)).rejects.toThrow(/not a valid \.slaidec|corrupt|ZIP/i);
});

test('loud failure: pack a deck whose master is missing', async () => {
  const dir = join(root, 'nomaster');
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'deck.slaide'), `---\nmaster: ./gone.slaide.yaml\n---\nlayout: cover\n---\nHi`, 'utf8');
  await expect(packDeck(join(dir, 'deck.slaide'), join(root, 'nm.slaidec'), { force: true })).rejects.toThrow(/master not found/i);
});

test('loud failure: folder with no deck', async () => {
  const dir = join(root, 'empty');
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'readme.txt'), 'nothing here', 'utf8');
  await expect(openDeck(dir)).rejects.toThrow(/No \.slaide deck/i);
});
