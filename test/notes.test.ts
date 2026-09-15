// Speaker-notes harness: a PowerPoint note must reach the deck source, survive a compile,
// and never corrupt the deck while doing it. parsePptx already read ppt/notesSlides/* long
// before emit() learned to write the note out — these tests pin both halves together.
import { test, expect } from 'vitest';
import yaml from 'js-yaml';
import { writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import JSZip from 'jszip';
import { parsePptx } from '../src/import/pptx.js';
import { emit } from '../src/import/emit.js';
import { parseDeck } from '../src/parser/parse.js';
import { compile } from '../src/compiler/compile.js';
import type { Master } from '../src/types.js';

const RELS_XML = (rels: Array<[string, string]>) =>
  `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n` +
  `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">\n` +
  rels.map(([id, target]) => `  <Relationship Id="${id}" Target="${target}"/>`).join('\n') +
  `\n</Relationships>`;

const THEME_XML =
  `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n` +
  `<a:theme xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" name="Test">` +
  `<a:themeElements><a:clrScheme name="Test">` +
  `<a:dk1><a:sysClr val="windowText" lastClr="000000"/></a:dk1>` +
  `<a:lt1><a:sysClr val="window" lastClr="FFFFFF"/></a:lt1>` +
  `<a:dk2><a:srgbClr val="1F1F1F"/></a:dk2><a:lt2><a:srgbClr val="EEEEEE"/></a:lt2>` +
  `<a:accent1><a:srgbClr val="4472C4"/></a:accent1><a:accent2><a:srgbClr val="ED7D31"/></a:accent2>` +
  `<a:accent3><a:srgbClr val="A5A5A5"/></a:accent3><a:accent4><a:srgbClr val="FFC000"/></a:accent4>` +
  `<a:accent5><a:srgbClr val="5B9BD5"/></a:accent5><a:accent6><a:srgbClr val="70AD47"/></a:accent6>` +
  `<a:hlink><a:srgbClr val="0563C1"/></a:hlink><a:folHlink><a:srgbClr val="954F72"/></a:folHlink>` +
  `</a:clrScheme><a:fontScheme name="Test"><a:majorFont><a:latin typeface="Inter"/></a:majorFont>` +
  `<a:minorFont><a:latin typeface="Inter"/></a:minorFont></a:fontScheme></a:themeElements></a:theme>`;

/** One paragraph of notes-slide body text. */
const notesPara = (text: string) =>
  `<a:p><a:r><a:rPr lang="en-US"/><a:t>${text}</a:t></a:r></a:p>`;

/** A minimal .pptx: one slide with a title, plus a notesSlide carrying `paras` and the
 *  slide-number placeholder PowerPoint always writes into a notes slide. */
async function pptxWithNotes(paras: string[]): Promise<Buffer> {
  const zip = new JSZip();
  zip.file('ppt/presentation.xml',
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n` +
    `<p:presentation xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" ` +
    `xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" ` +
    `xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">` +
    `<p:sldSz cx="12192000" cy="6858000"/></p:presentation>`);
  zip.file('ppt/_rels/presentation.xml.rels', RELS_XML([]));
  zip.file('ppt/theme/theme1.xml', THEME_XML);
  zip.file('ppt/slides/slide1.xml',
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n` +
    `<p:sld xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" ` +
    `xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" ` +
    `xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">` +
    `<p:cSld><p:spTree>` +
    `<p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr/>` +
    `<p:sp><p:nvSpPr><p:cNvPr id="2" name="Title"/><p:cNvSpPr/><p:nvPr><p:ph type="title"/></p:nvPr></p:nvSpPr>` +
    `<p:spPr><a:xfrm><a:off x="914400" y="914400"/><a:ext cx="6096000" cy="914400"/></a:xfrm></p:spPr>` +
    `<p:txBody><a:bodyPr/><a:p><a:r><a:rPr lang="en-US"/><a:t>Hello</a:t></a:r></a:p></p:txBody></p:sp>` +
    `</p:spTree></p:cSld></p:sld>`);
  zip.file('ppt/slides/_rels/slide1.xml.rels', RELS_XML([['rId1', '../notesSlides/notesSlide1.xml']]));
  zip.file('ppt/notesSlides/notesSlide1.xml',
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n` +
    `<p:notes xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" ` +
    `xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" ` +
    `xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">` +
    `<p:cSld><p:spTree>` +
    `<p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr/>` +
    // the slide-number placeholder: a bare number that must NOT become a note
    `<p:sp><p:nvSpPr><p:cNvPr id="2" name="Slide Number"/><p:cNvSpPr/>` +
    `<p:nvPr><p:ph type="sldNum"/></p:nvPr></p:nvSpPr><p:spPr/>` +
    `<p:txBody><a:bodyPr/><a:p><a:r><a:rPr lang="en-US"/><a:t>7</a:t></a:r></a:p></p:txBody></p:sp>` +
    // the body placeholder: the real speaker note
    `<p:sp><p:nvSpPr><p:cNvPr id="3" name="Notes"/><p:cNvSpPr/>` +
    `<p:nvPr><p:ph type="body" idx="1"/></p:nvPr></p:nvSpPr><p:spPr/>` +
    `<p:txBody><a:bodyPr/>${paras.map(notesPara).join('')}</p:txBody></p:sp>` +
    `</p:spTree></p:cSld></p:notes>`);
  zip.file('ppt/notesSlides/_rels/notesSlide1.xml.rels', RELS_XML([]));
  return zip.generateAsync({ type: 'nodebuffer' });
}

async function withTmpPptx<T>(buf: Buffer, fn: (path: string) => Promise<T>): Promise<T> {
  const file = join(tmpdir(), `slaide-notes-${Date.now()}-${Math.random().toString(36).slice(2)}.pptx`);
  writeFileSync(file, buf);
  try {
    return await fn(file);
  } finally {
    rmSync(file, { force: true });
  }
}

const MASTER_YAML = (m: string) => yaml.load(m) as Master;

// --- 1. parse: the notes slide reaches the IR, the slide number does not -----------------
test('parsePptx lifts the speaker note off the notes slide and drops the page number', async () => {
  const buf = await pptxWithNotes(['Open warm.', 'Then land the contrast.']);
  const ir = await withTmpPptx(buf, (f) => parsePptx(f));

  expect(ir.slides.length).toBe(1);
  expect(ir.slides[0].notes).toBe('Open warm.\nThen land the contrast.');
  expect(ir.slides[0].notes).not.toMatch(/\b7\b/);
});

// --- 2. emit: the note survives into the deck source and compiles ------------------------
test('emit writes the imported note into the deck, and it compiles onto the slide', () => {
  const ir = {
    canvas: { w: 1280, h: 720 },
    theme: { palette: { dk1: '#111111', lt1: '#FFFFFF', accent1: '#4472C4' }, fontMajor: 'Inter', fontMinor: 'Inter' },
    slides: [
      {
        notes: 'Open warm.\nThen land the contrast.',
        shapes: [
          { kind: 'text' as const, x: 128, y: 100, w: 700, h: 120, ph: 'title', paras: [{ runs: [{ text: 'Hello', size: 54 }], bullet: false, level: 0 }] },
        ],
      },
      { shapes: [{ kind: 'text' as const, x: 128, y: 100, w: 700, h: 120, paras: [{ runs: [{ text: 'Second' }], bullet: false, level: 0 }] }] },
    ],
    assets: [],
    warnings: [],
  };
  const { master, deck } = emit(ir);

  expect(deck).toContain('??? Open warm.');
  const out = compile(parseDeck(deck), MASTER_YAML(master));
  expect(out.slides.length).toBe(2);
  expect(out.slides[0].notes).toBe('Open warm.\nThen land the contrast.');
  expect(out.slides[1].notes).toBeNull();
});

// --- 3. the sanitiser: free PowerPoint text must not corrupt the deck --------------------
test('a note holding a bare fence, a region marker or its own ??? never shifts a slide', () => {
  // A bare `---` is the dangerous one: the deck is segmented BEFORE notes are pulled out of
  // the body, so an unescaped fence invents a phantom slide and shifts every later index.
  const nasty = 'Budget split\n---\n:: visual ::\n??? not a nested note\nstill the same note';
  const ir = {
    canvas: { w: 1280, h: 720 },
    theme: { palette: { dk1: '#111111', lt1: '#FFFFFF' }, fontMajor: 'Inter', fontMinor: 'Inter' },
    slides: [
      { notes: nasty, shapes: [{ kind: 'text' as const, x: 0, y: 0, w: 100, h: 100, paras: [{ runs: [{ text: 'One' }], bullet: false, level: 0 }] }] },
      { notes: 'second note', shapes: [{ kind: 'text' as const, x: 0, y: 0, w: 100, h: 100, paras: [{ runs: [{ text: 'Two' }], bullet: false, level: 0 }] }] },
    ],
    assets: [],
    warnings: [],
  };
  const { master, deck } = emit(ir);
  const out = compile(parseDeck(deck), MASTER_YAML(master));

  expect(out.slides.length).toBe(2);           // no phantom slide
  expect(out.slides[0].notes).toBe(nasty);     // and the text came back verbatim
  expect(out.slides[1].notes).toBe('second note');
  // the region marker stayed inside the note instead of opening a region
  expect(Object.keys(out.slides[0].regions)).not.toContain('visual');
});

test('a blank line inside a note becomes a second ??? block and rejoins unchanged', () => {
  const ir = {
    canvas: { w: 1280, h: 720 },
    theme: { palette: { dk1: '#111111', lt1: '#FFFFFF' }, fontMajor: 'Inter', fontMinor: 'Inter' },
    slides: [
      { notes: 'First paragraph.\n\nSecond paragraph.', shapes: [{ kind: 'text' as const, x: 0, y: 0, w: 100, h: 100, paras: [{ runs: [{ text: 'One' }], bullet: false, level: 0 }] }] },
    ],
    assets: [],
    warnings: [],
  };
  const { master, deck } = emit(ir);
  expect(deck.match(/^\?\?\? /gm)?.length).toBe(2);
  const out = compile(parseDeck(deck), MASTER_YAML(master));
  expect(out.slides[0].notes).toBe('First paragraph.\n\nSecond paragraph.');
});

// --- 4. the documented frontmatter key is live ------------------------------------------
test('frontmatter `notes:` compiles onto the slide, and a body ??? still wins', () => {
  const master = MASTER_YAML(`schema: slaide/1
name: t
canvas: { aspect: '16:9', width: 1280, height: 720 }
fonts:
  display: { family: Inter, provider: google, weights: [700] }
  sans: { family: Inter, provider: google, weights: [400] }
  mono: { family: JetBrains Mono, provider: google, weights: [400] }
typeScale: { base: 24px, ratio: 1.2, steps: { h1: 4, h2: 3, h3: 2, h4: 1, body: 0, caption: -1 } }
colors:
  palette: { ink: '#111111', paper: '#FFFFFF' }
  roles: { background: '{palette.paper}', text: '{palette.ink}', heading: '{palette.ink}', accent: '{palette.ink}', muted: '{palette.ink}' }
layouts:
  plain: { areas: [main], rows: 1fr, cols: 1fr, slots: { main: { type: body } } }
`);
  const deck = `---
master: ./m.yaml
---
layout: plain
notes: from frontmatter
---
:: main ::
One

---
layout: plain
notes: ignored
---
:: main ::
Two

??? from the body
`;
  const out = compile(parseDeck(deck), master);
  expect(out.slides[0].notes).toBe('from frontmatter');
  expect(out.slides[1].notes).toBe('from the body');
});
