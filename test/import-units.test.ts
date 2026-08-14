import { test, expect } from 'vitest';
import { writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import JSZip from 'jszip';
import { normalizeFont, mergeRuns, parsePptx } from '../src/import/pptx.js';

// --- Font-family normalization (weight-named families -> base + numeric weight) ---
test('normalizeFont peels weight/style words to a real web family', () => {
  expect(normalizeFont('Open Sans Extrabold')).toEqual({ family: 'Open Sans', weight: 800, italic: undefined });
  expect(normalizeFont('Open Sans Light')).toEqual({ family: 'Open Sans', weight: 300, italic: undefined });
  expect(normalizeFont('Lato Black')).toEqual({ family: 'Lato', weight: 900, italic: undefined });
  expect(normalizeFont('Montserrat SemiBold Italic')).toEqual({ family: 'Montserrat', weight: 600, italic: true });
  // plain families are untouched
  expect(normalizeFont('Open Sans')).toEqual({ family: 'Open Sans', weight: undefined, italic: undefined });
  expect(normalizeFont('Arial')).toEqual({ family: 'Arial', weight: undefined, italic: undefined });
  // never strip to nothing
  expect(normalizeFont('Bold').family).toBe('Bold');
});

// --- Adjacent run merging (kerning/width fidelity) ---
test('mergeRuns coalesces consecutive same-style runs', () => {
  const runs = [
    { text: '27' }, { text: '/' }, { text: '5' },
    { text: ' x ', bold: true }, { text: 'y', bold: true },
    { text: 'z', br: true },
  ];
  mergeRuns(runs as any);
  expect(runs.map((r: any) => r.text)).toEqual(['27/5', ' x y', 'z']);
});

// --- Import hardening: every ppt/media/* file becomes an asset (not only usedMedia), tagged
// placed|unplaced with a reason, and a per-file warning fires in reconstruct mode. Builds a
// minimal synthetic .pptx zip (only the parts parsePptx actually reads — no layouts/masters
// needed since the slide has none) rather than depending on a fixture file. ---
const RELS_XML = (rels: Array<[string, string]>) =>
  `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n` +
  `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">\n` +
  rels.map(([id, target]) => `  <Relationship Id="${id}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="${target}"/>`).join('\n') +
  `\n</Relationships>`;

async function buildSyntheticPptx(): Promise<Buffer> {
  const zip = new JSZip();
  zip.file('ppt/presentation.xml',
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n` +
    `<p:presentation xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" ` +
    `xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" ` +
    `xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">` +
    `<p:sldSz cx="12192000" cy="6858000"/></p:presentation>`);
  zip.file('ppt/_rels/presentation.xml.rels', RELS_XML([]));
  zip.file('ppt/theme/theme1.xml',
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
    `<a:minorFont><a:latin typeface="Inter"/></a:minorFont></a:fontScheme></a:themeElements></a:theme>`);

  // Slide 1: one placed picture (image1.png), and a >=10-shape group whose lone picture
  // (image2.png) is never walked individually because the group is emitted as a single raster
  // shape. No slideLayout/slideMaster relationship -> parsePptx uses the default (empty) inherit
  // and never looks for layout/master parts at all.
  const groupShapes = Array.from({ length: 10 }, (_, i) => `<p:sp><p:nvSpPr><p:cNvPr id="${30 + i}" name="Shape ${i}"/><p:cNvSpPr/><p:nvPr/></p:nvSpPr><p:spPr/></p:sp>`).join('');
  zip.file('ppt/slides/slide1.xml',
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n` +
    `<p:sld xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" ` +
    `xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" ` +
    `xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">` +
    `<p:cSld><p:spTree>` +
    `<p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr/>` +
    // placed picture
    `<p:pic><p:nvPicPr><p:cNvPr id="10" name="Pic1"/><p:cNvPicPr/><p:nvPr/></p:nvPicPr>` +
    `<p:blipFill><a:blip r:embed="rId1"/></p:blipFill>` +
    `<p:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="914400" cy="914400"/></a:xfrm></p:spPr></p:pic>` +
    // complex group (>=10 shapes) containing an unplaced picture (image2.png)
    `<p:grpSp><p:nvGrpSpPr><p:cNvPr id="20" name="Group1"/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr>` +
    `<p:grpSpPr><a:xfrm><a:off x="1000000" y="1000000"/><a:ext cx="2000000" cy="2000000"/></a:xfrm></p:grpSpPr>` +
    groupShapes +
    `<p:pic><p:nvPicPr><p:cNvPr id="21" name="Pic2"/><p:cNvPicPr/><p:nvPr/></p:nvPicPr>` +
    `<p:blipFill><a:blip r:embed="rId2"/></p:blipFill>` +
    `<p:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="100" cy="100"/></a:xfrm></p:spPr></p:pic>` +
    `</p:grpSp>` +
    `</p:spTree></p:cSld></p:sld>`);
  // rId1 -> image1.png (placed), rId2 -> image2.png (inside the complex group). image3.png is
  // intentionally NOT related from anywhere -> orphaned.
  zip.file('ppt/slides/_rels/slide1.xml.rels', RELS_XML([
    ['rId1', '../media/image1.png'],
    ['rId2', '../media/image2.png'],
  ]));

  zip.file('ppt/media/image1.png', Buffer.from('placed-image-bytes'));
  zip.file('ppt/media/image2.png', Buffer.from('grouped-image-bytes'));
  zip.file('ppt/media/image3.png', Buffer.from('orphaned-image-bytes'));

  return zip.generateAsync({ type: 'nodebuffer' });
}

test('parsePptx keeps every ppt/media/* file as an asset, tagged placed|unplaced with a reason', async () => {
  const buf = await buildSyntheticPptx();
  const file = join(tmpdir(), `slaide-import-test-${Date.now()}.pptx`);
  writeFileSync(file, buf);
  try {
    const ir = await parsePptx(file);

    expect(ir.assets.map((a) => a.name).sort()).toEqual(['image1.png', 'image2.png', 'image3.png']);

    const byName = Object.fromEntries(ir.assets.map((a) => [a.name, a]));
    expect(byName['image1.png']).toMatchObject({ placed: true });
    expect(byName['image1.png'].reason).toBeUndefined();
    expect(byName['image2.png']).toMatchObject({ placed: false, reason: 'complex-group' });
    expect(byName['image3.png']).toMatchObject({ placed: false, reason: 'orphaned' });

    // original bytes preserved for every file, not just placed ones
    expect(byName['image2.png'].data.toString()).toBe('grouped-image-bytes');
    expect(byName['image3.png'].data.toString()).toBe('orphaned-image-bytes');

    // a per-file warning fires (reconstruct mode is what /v1/import always uses)
    expect(ir.warnings).toContain('imported but not placed: image2.png (inside complex group)');
    expect(ir.warnings).toContain('imported but not placed: image3.png (not referenced by any slide)');

    // the slide itself: the loose picture placed normally, the group collapsed to one raster shape
    expect(ir.slides.length).toBe(1);
    const shapes = ir.slides[0].shapes;
    expect(shapes.some((s) => s.kind === 'image' && s.src === 'image1.png')).toBe(true);
    expect(shapes.some((s) => s.kind === 'raster' && s.rasterReq?.reason === 'complex-group')).toBe(true);
  } finally {
    rmSync(file, { force: true });
  }
});

// --- Unplaced-media size guard: a per-file cap and a running total cap keep an orphaned
// multi-MB media file from being base64-inlined by /v1/import. Placed media is never filtered. ---
async function buildPptxWithOrphans(orphanSizesMb: number[]): Promise<Buffer> {
  const zip = new JSZip();
  zip.file('ppt/presentation.xml',
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n` +
    `<p:presentation xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" ` +
    `xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" ` +
    `xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">` +
    `<p:sldSz cx="12192000" cy="6858000"/></p:presentation>`);
  zip.file('ppt/_rels/presentation.xml.rels', RELS_XML([]));
  zip.file('ppt/theme/theme1.xml',
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
    `<a:minorFont><a:latin typeface="Inter"/></a:minorFont></a:fontScheme></a:themeElements></a:theme>`);
  zip.file('ppt/slides/slide1.xml',
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n` +
    `<p:sld xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" ` +
    `xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" ` +
    `xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">` +
    `<p:cSld><p:spTree>` +
    `<p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr/>` +
    `</p:spTree></p:cSld></p:sld>`);
  zip.file('ppt/slides/_rels/slide1.xml.rels', RELS_XML([]));
  // Every media file here is unreferenced from anywhere -> orphaned + unplaced.
  orphanSizesMb.forEach((mb, i) => {
    zip.file(`ppt/media/orphan${i}.png`, Buffer.alloc(Math.round(mb * 1024 * 1024), 1));
  });
  return zip.generateAsync({ type: 'nodebuffer' });
}

test('unplaced media over the per-file cap is dropped into skippedAssets, not assets', async () => {
  const buf = await buildPptxWithOrphans([2]); // 2 MB orphan
  const file = join(tmpdir(), `slaide-import-test-cap-${Date.now()}.pptx`);
  writeFileSync(file, buf);
  const prevMax = process.env.SLAIDE_IMPORT_UNPLACED_MAX_MB;
  process.env.SLAIDE_IMPORT_UNPLACED_MAX_MB = '1'; // cap below the 2 MB orphan
  try {
    const ir = await parsePptx(file);
    expect(ir.assets.some((a) => a.name === 'orphan0.png')).toBe(false);
    expect(ir.skippedAssets).toEqual([{ name: 'orphan0.png', reason: 'too-large', bytes: 2 * 1024 * 1024 }]);
    expect(ir.warnings.some((w) => w.startsWith('skipped (too large): orphan0.png'))).toBe(true);
  } finally {
    if (prevMax === undefined) delete process.env.SLAIDE_IMPORT_UNPLACED_MAX_MB;
    else process.env.SLAIDE_IMPORT_UNPLACED_MAX_MB = prevMax;
    rmSync(file, { force: true });
  }
});

test('unplaced media within the per-file cap but over the running total is dropped', async () => {
  const buf = await buildPptxWithOrphans([0.6, 0.6]); // each under a 5 MB per-file cap
  const file = join(tmpdir(), `slaide-import-test-total-${Date.now()}.pptx`);
  writeFileSync(file, buf);
  const prevMax = process.env.SLAIDE_IMPORT_UNPLACED_MAX_MB;
  const prevTotal = process.env.SLAIDE_IMPORT_UNPLACED_TOTAL_MB;
  process.env.SLAIDE_IMPORT_UNPLACED_MAX_MB = '5';
  process.env.SLAIDE_IMPORT_UNPLACED_TOTAL_MB = '1'; // 0.6 + 0.6 > 1 MB total budget
  try {
    const ir = await parsePptx(file);
    expect(ir.assets.some((a) => a.name === 'orphan0.png')).toBe(true); // fits under the budget first
    expect(ir.skippedAssets.some((a) => a.name === 'orphan1.png' && a.reason === 'too-large')).toBe(true);
    expect(ir.assets.some((a) => a.name === 'orphan1.png')).toBe(false);
  } finally {
    if (prevMax === undefined) delete process.env.SLAIDE_IMPORT_UNPLACED_MAX_MB;
    else process.env.SLAIDE_IMPORT_UNPLACED_MAX_MB = prevMax;
    if (prevTotal === undefined) delete process.env.SLAIDE_IMPORT_UNPLACED_TOTAL_MB;
    else process.env.SLAIDE_IMPORT_UNPLACED_TOTAL_MB = prevTotal;
    rmSync(file, { force: true });
  }
});

// --- Accurate unplaced-media reasons: a picture with no resolvable geometry IS referenced by
// the slide, so it must not fall back to the "orphaned" ("not referenced by any slide") label. ---
async function buildPptxWithGeometrylessPic(): Promise<Buffer> {
  const zip = new JSZip();
  zip.file('ppt/presentation.xml',
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n` +
    `<p:presentation xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" ` +
    `xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" ` +
    `xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">` +
    `<p:sldSz cx="12192000" cy="6858000"/></p:presentation>`);
  zip.file('ppt/_rels/presentation.xml.rels', RELS_XML([]));
  zip.file('ppt/theme/theme1.xml',
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
    `<a:minorFont><a:latin typeface="Inter"/></a:minorFont></a:fontScheme></a:themeElements></a:theme>`);
  // A picture referencing image1.png, but its p:spPr has no a:xfrm -> no resolvable geometry.
  zip.file('ppt/slides/slide1.xml',
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n` +
    `<p:sld xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" ` +
    `xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" ` +
    `xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">` +
    `<p:cSld><p:spTree>` +
    `<p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr/>` +
    `<p:pic><p:nvPicPr><p:cNvPr id="10" name="Pic1"/><p:cNvPicPr/><p:nvPr/></p:nvPicPr>` +
    `<p:blipFill><a:blip r:embed="rId1"/></p:blipFill>` +
    `<p:spPr/></p:pic>` +
    `</p:spTree></p:cSld></p:sld>`);
  zip.file('ppt/slides/_rels/slide1.xml.rels', RELS_XML([['rId1', '../media/image1.png']]));
  zip.file('ppt/media/image1.png', Buffer.from('geometryless-pic-bytes'));
  return zip.generateAsync({ type: 'nodebuffer' });
}

test('a referenced but geometry-less picture is tagged shape-skipped, not orphaned', async () => {
  const buf = await buildPptxWithGeometrylessPic();
  const file = join(tmpdir(), `slaide-import-test-geomless-${Date.now()}.pptx`);
  writeFileSync(file, buf);
  try {
    const ir = await parsePptx(file);
    const asset = ir.assets.find((a) => a.name === 'image1.png');
    expect(asset).toMatchObject({ placed: false, reason: 'shape-skipped' });
  } finally {
    rmSync(file, { force: true });
  }
});
