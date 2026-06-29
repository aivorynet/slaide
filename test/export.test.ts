// Export tests: the transition name->OOXML map and zip injection always run; the full
// pptx export + Keynote dispatch run where Playwright is available (gated, like import.golden).
import { describe, it, expect } from 'vitest';
import JSZip from 'jszip';
import { XMLParser } from 'fast-xml-parser';
import { mkdtempSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { transitionXml, transitionChildXml, speedBucket } from '../src/export-pptx/transitions.js';
import { injectTransitions, injectBuilds } from '../src/export-pptx/inject-anim.js';

// ---- transition name -> OOXML map (pure, always on) -------------------------
describe('transition mapping', () => {
  it('maps the catalog to the right PowerPoint element', () => {
    expect(transitionChildXml('fade')).toContain('<p:fade');
    expect(transitionChildXml('fade-through-black')).toContain('thruBlk="1"');
    expect(transitionChildXml('slide-left')).toBe('<p:push dir="l"/>');
    expect(transitionChildXml('slide-right')).toBe('<p:push dir="r"/>');
    expect(transitionChildXml('slide-up')).toBe('<p:push dir="u"/>');
    expect(transitionChildXml('slide-down')).toBe('<p:push dir="d"/>');
    expect(transitionChildXml('cover')).toBe('<p:cover dir="l"/>');
    expect(transitionChildXml('reveal')).toBe('<p:pull dir="l"/>');
    expect(transitionChildXml('zoom')).toBe('<p:zoom dir="in"/>');
    expect(transitionChildXml('zoom-out')).toBe('<p:zoom dir="out"/>');
    expect(transitionChildXml('none')).toBeNull();
    expect(transitionChildXml('totally-unknown')).toContain('<p:fade'); // fallback
  });

  it('safe mode collapses approximated effects to fade', () => {
    expect(transitionChildXml('zoom', true)).toBe('<p:fade/>');
    expect(transitionChildXml('flip', true)).toBe('<p:fade/>');
  });

  it('speedBucket maps duration to the legacy spd attribute', () => {
    expect(speedBucket(250)).toBe('fast');
    expect(speedBucket(500)).toBe('med');
    expect(speedBucket(1000)).toBe('slow');
  });

  it('transitionXml emits a transition with speed, none -> empty, morph -> AlternateContent', () => {
    const fade = transitionXml('fade', { durationMs: 500 });
    expect(fade).toContain('<p:transition spd="med">');
    expect(fade).toContain('<p:fade/>');
    expect(transitionXml('none')).toBe('');
    const morph = transitionXml('morph');
    expect(morph).toContain('mc:AlternateContent');
    expect(morph).toContain('p159:morph');
    expect(morph).toContain('<p:fade/>'); // fallback
  });
});

// ---- zip injection on a synthetic slide (pure, always on) -------------------
// Two slides shaped like the pptxgenjs template; slide1 carries a text box (id 2).
function synthDeck(): Promise<Buffer> {
  const zip = new JSZip();
  zip.file(
    'ppt/presentation.xml',
    `<?xml version="1.0"?><p:presentation xmlns:p="x" xmlns:r="y"><p:sldIdLst><p:sldId id="256" r:id="rId1"/><p:sldId id="257" r:id="rId2"/></p:sldIdLst></p:presentation>`,
  );
  zip.file(
    'ppt/_rels/presentation.xml.rels',
    `<?xml version="1.0"?><Relationships xmlns="z"><Relationship Id="rId1" Target="slides/slide1.xml"/><Relationship Id="rId2" Target="slides/slide2.xml"/></Relationships>`,
  );
  const sld = (sp: string) =>
    `<?xml version="1.0"?><p:sld xmlns:a="a" xmlns:r="r" xmlns:p="p"><p:cSld><p:spTree>${sp}</p:spTree></p:cSld><p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr></p:sld>`;
  zip.file('ppt/slides/slide1.xml', sld('<p:sp><p:nvSpPr><p:cNvPr id="2" name="t"/></p:nvSpPr><p:txBody><a:p><a:r><a:t>hi</a:t></a:r></a:p></p:txBody></p:sp>'));
  zip.file('ppt/slides/slide2.xml', sld(''));
  return zip.generateAsync({ type: 'nodebuffer' });
}

describe('zip injection', () => {
  it('injects a transition after clrMapOvr, in deck order', async () => {
    const out = await injectTransitions(await synthDeck(), [{ name: 'fade' }, { name: 'slide-left' }]);
    const zip = await JSZip.loadAsync(out);
    const s1 = await zip.file('ppt/slides/slide1.xml')!.async('string');
    const s2 = await zip.file('ppt/slides/slide2.xml')!.async('string');
    expect(s1).toContain('<p:fade/>');
    expect(s2).toContain('<p:push dir="l"/>');
    // ordering: transition sits between </p:clrMapOvr> and </p:sld>
    expect(s1.indexOf('<p:transition')).toBeGreaterThan(s1.indexOf('</p:clrMapOvr>'));
    expect(s1.indexOf('<p:transition')).toBeLessThan(s1.indexOf('</p:sld>'));
  });

  it('injects per-paragraph build timing targeting the text box id', async () => {
    const out = await injectBuilds(await synthDeck(), [[{ pBuilds: [true, true] }], []]);
    const zip = await JSZip.loadAsync(out);
    const s1 = await zip.file('ppt/slides/slide1.xml')!.async('string');
    const s2 = await zip.file('ppt/slides/slide2.xml')!.async('string');
    expect(s1).toContain('<p:timing>');
    expect(s1).toContain('<p:bldP spid="2"');
    // build="p" is the legal ST_TLParaBuildType value; "byParagraph" makes PowerPoint
    // refuse the file (COM Presentations.Open fails; the GUI silently "repairs" it).
    expect(s1).toContain('build="p"');
    expect(s1).not.toContain('byParagraph');
    expect(s2).not.toContain('<p:timing>');
    // timing sits before </p:sld>
    expect(s1.indexOf('<p:timing>')).toBeLessThan(s1.indexOf('</p:sld>'));
  });
});

// ---- full export e2e (gated on Playwright; Chromium is installed here) -------
const hasPlaywright = await (async () => {
  try {
    await import('playwright');
    return true;
  } catch {
    return false;
  }
})();

describe.skipIf(!hasPlaywright)('pptx export e2e', () => {
  it('exports the example deck with transitions, builds, and valid XML', async () => {
    const { exportPptx } = await import('../src/export-pptx/pptx.js');
    const { compileFile, importDeck } = await import('../src/index.js');
    const deck = fileURLToPath(new URL('../examples/q3-roadmap.slaide', import.meta.url));
    const work = mkdtempSync(join(tmpdir(), 'slaide-export-test-'));
    try {
      const out = join(work, 'q3.pptx');
      await exportPptx(deck, { out });
      const ir = compileFile(deck).ir;
      const zip = await JSZip.loadAsync(readFileSync(out));

      // ordered slide paths
      const pres = await zip.file('ppt/presentation.xml')!.async('string');
      const rels = await zip.file('ppt/_rels/presentation.xml.rels')!.async('string');
      const relMap: Record<string, string> = {};
      for (const m of rels.matchAll(/Id="([^"]+)"[^>]*Target="([^"]+)"/g)) relMap[m[1]] = m[2];
      const paths: string[] = [];
      for (const m of pres.matchAll(/<p:sldId\b[^>]*r:id="([^"]+)"/g)) paths.push('ppt/' + relMap[m[1]]);
      expect(paths.length).toBe(ir.slides.length);

      const parser = new XMLParser({ ignoreAttributes: false });
      let sawText = false;
      let sawTiming = false;
      for (let i = 0; i < paths.length; i++) {
        const xml = await zip.file(paths[i])!.async('string');
        parser.parse(xml); // throws on malformed XML -> test fails
        const t = ir.slides[i].transition;
        if (t === 'fade') expect(xml).toContain('<p:fade');
        if (t === 'slide-left') expect(xml).toContain('<p:push dir="l"');
        if (t === 'morph') expect(xml).toMatch(/p159:morph|<p:transition/);
        // every transition/timing node sits after </p:clrMapOvr>
        const ci = xml.indexOf('</p:clrMapOvr>');
        if (xml.includes('<p:transition')) expect(xml.indexOf('<p:transition')).toBeGreaterThan(ci);
        if (xml.includes('<p:timing>')) {
          sawTiming = true;
          expect(xml.indexOf('<p:timing>')).toBeGreaterThan(ci);
        }
        if (xml.includes('<a:t>')) sawText = true;
      }
      expect(sawText).toBe(true);
      expect(sawTiming).toBe(true); // the deck has `>>>` builds

      // round-trip: the produced pptx re-imports cleanly (proves it is not corrupt)
      const rt = await importDeck(out, join(work, 'rt'));
      expect(rt.slides).toBe(ir.slides.length);
    } finally {
      rmSync(work, { recursive: true, force: true });
    }
  }, 120000);
});

// ---- Keynote dispatch -------------------------------------------------------
describe('keynote export dispatch', () => {
  it('rejects off macOS with a clear, actionable message', async () => {
    const { exportKeynote, keynoteAvailable } = await import('../src/export-keynote/keynote.js');
    if (keynoteAvailable()) return; // on a real Mac the happy path is covered by an opt-in run
    await expect(exportKeynote('whatever.slaide', { out: 'x.key' })).rejects.toThrow(/macOS|Keynote/);
  });
});
