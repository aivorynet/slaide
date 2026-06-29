import { test, expect } from 'vitest';
import yaml from 'js-yaml';
import { emit } from '../src/import/emit.js';
import { parseDeck } from '../src/parser/parse.js';
import { compile } from '../src/compiler/compile.js';
import type { Master } from '../src/types.js';

// emit() output must be valid slaide that parses + compiles cleanly.
test('importer emit → compilable deck + master with anchored slots', () => {
  const ir = {
    canvas: { w: 1280, h: 720 },
    theme: { palette: { dk1: '#0B1220', lt1: '#FFFFFF', accent1: '#5B8CFF' }, fontMajor: 'Inter', fontMinor: 'Inter' },
    slides: [
      {
        shapes: [
          { kind: 'rect' as const, x: 0, y: 0, w: 1280, h: 720, fill: '#0B1220' },
          { kind: 'text' as const, x: 128, y: 100, w: 700, h: 120, ph: 'title', paras: [{ runs: [{ text: 'Hello', size: 54, bold: true }], bullet: false, level: 0 }] },
          { kind: 'image' as const, x: 800, y: 100, w: 300, h: 200, src: 'pic.png' },
        ],
      },
    ],
    assets: [],
    warnings: [],
  };
  const { master, deck } = emit(ir);
  const m = yaml.load(master) as Master;
  const out = compile(parseDeck(deck), m);

  expect(out.slides.length).toBe(1);
  // dark deck → light text role
  expect(out.tokens['--color-text']).toBe('#FFFFFF');
  // title text present
  expect(out.slides[0].regions.some((r) => r.html.includes('Hello'))).toBe(true);
  // shapes are absolutely anchored
  expect(JSON.stringify(out.slides[0].regions)).toContain('absolute');
  // image routed
  expect(out.slides[0].regions.some((r) => r.html.includes('pic.png'))).toBe(true);
});
