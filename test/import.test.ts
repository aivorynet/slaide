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

// A cropped picture (a:srcRect) must reproduce the exact visible sub-rect: the image is
// scaled by 1/(1-l-r) x 1/(1-t-b) and shifted so that sub-rect fills the box, clipped by
// an overflow:hidden wrapper — not a plain `![]()` markdown image.
test('importer emit → cropped picture becomes a scaled/offset <img>, clipped to the box', () => {
  const ir = {
    canvas: { w: 1280, h: 720 },
    theme: { palette: {}, fontMajor: 'Inter', fontMinor: 'Inter' },
    slides: [
      {
        shapes: [
          // l=0.25, r=0.25 -> vw=0.5 (width 200%, left -50%); t=0, b=0.5 -> vh=0.5 (height 200%, top 0%)
          { kind: 'image' as const, x: 0, y: 0, w: 400, h: 300, src: 'crop.png', crop: { l: 0.25, t: 0, r: 0.25, b: 0.5 } },
          // no crop -> unaffected plain markdown image (byte-identical to today)
          { kind: 'image' as const, x: 400, y: 0, w: 400, h: 300, src: 'plain.png' },
        ],
      },
    ],
    assets: [],
    warnings: [],
  };
  const { master, deck } = emit(ir);
  const m = yaml.load(master) as Master;
  const out = compile(parseDeck(deck), m);
  const html = JSON.stringify(out.slides[0].regions);

  expect(html).toContain('crop.png');
  expect(html).toContain('overflow:hidden');
  expect(html).toContain('width:200%');
  expect(html).toContain('height:200%');
  expect(html).toContain('left:-50%');
  expect(html).toContain('top:0%');
  expect(html).toContain('object-fit:fill');
  // the uncropped picture still takes the plain markdown-image path
  expect(out.slides[0].regions.some((r) => r.html.includes('plain.png') && !r.html.includes('crop.png'))).toBe(true);
});
