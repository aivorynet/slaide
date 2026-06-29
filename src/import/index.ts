// Copyright 2026 AIVory, Inc.
// SPDX-License-Identifier: Apache-2.0
// @slaide/import — convert .pptx / .key into a slaide deck + generated master.
import { writeFileSync, mkdirSync, existsSync, copyFileSync, rmSync } from 'node:fs';
import { join, extname, basename, dirname } from 'node:path';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { parsePptx } from './pptx.js';
import type { ImpShape } from './pptx.js';
import { emit } from './emit.js';
import { getRasterizer, type RasterItem } from './raster-extension.js';

export type Fidelity = 'reconstruct' | 'hybrid' | 'exact-raster';

export interface ImportOptions {
  fidelity?: Fidelity;
  /** Hybrid auto mode: slides reconstructing below this match (0..1) are kept as images.
   *  Higher = more pixel-faithful but fewer editable slides. Default 0.9. */
  rasterThreshold?: number;
  /** Bundle the result into a single self-contained `.slaidec` (and drop the folder). */
  slaidec?: boolean;
}

export interface ImportResult {
  outDir: string;
  deckPath: string;
  masterPath: string;
  slides: number;
  assets: number;
  fidelity: Fidelity;
  warnings: string[];
  /** Set when `slaidec` was requested: the single bundled output file. */
  slaidecPath?: string;
}

async function importPptxFile(path: string, outDir: string, opts: ImportOptions): Promise<ImportResult> {
  const ir = await parsePptx(path);
  const assetsDir = join(outDir, 'assets');
  mkdirSync(outDir, { recursive: true });
  mkdirSync(assetsDir, { recursive: true });

  // High-fidelity rasterization is a Slaide Pro capability: the OSS build registers no
  // rasterizer, so hybrid/exact-raster degrade to reconstruct (with a clear reason).
  const rz = getRasterizer();
  const ppt = rz?.available() ?? false;
  let fidelity: Fidelity = opts.fidelity ?? (ppt ? 'hybrid' : 'reconstruct');
  if (fidelity === 'hybrid' || fidelity === 'exact-raster') {
    if (!rz) {
      ir.warnings.push(`Fidelity "${fidelity}" (high-fidelity import) requires Slaide Pro; falling back to "reconstruct".`);
      fidelity = 'reconstruct';
    } else if (!ppt) {
      ir.warnings.push(`Fidelity "${fidelity}" needs PowerPoint (Windows); falling back to "reconstruct".`);
      fidelity = 'reconstruct';
    }
  }

  if (fidelity === 'exact-raster') {
    // Each slide becomes a single pixel-perfect PNG exported from PowerPoint.
    const files = rz!.rasterizeSlides(path, assetsDir, ir.canvas.w * 2, ir.canvas.h * 2);
    ir.slides.forEach((slide, i) => {
      const src = files[i];
      if (src) {
        slide.shapes = [{ kind: 'image', x: 0, y: 0, w: ir.canvas.w, h: ir.canvas.h, src }];
        slide.background = undefined;
      }
    });
  } else if (fidelity === 'hybrid') {
    // Rasterize only the shapes slaide can't faithfully reconstruct.
    const items: RasterItem[] = [];
    const targets: ImpShape[] = [];
    ir.slides.forEach((slide, i) => {
      slide.shapes.forEach((shape, k) => {
        if (shape.kind === 'raster' && shape.rasterReq) {
          const file = `raster-${i + 1}-${k}.png`;
          items.push({ slide: i + 1, name: shape.rasterReq.name, id: shape.rasterReq.id, file, w: Math.max(2, shape.w * 2), h: Math.max(2, shape.h * 2) });
          shape.src = file; // tentative; cleared below if export failed
          targets.push(shape);
        }
      });
    });
    if (items.length) {
      const done = await rz!.rasterizeShapes(path, assetsDir, items, { w: ir.canvas.w, h: ir.canvas.h });
      for (const shape of targets) {
        if (shape.src && done.has(shape.src)) {
          shape.kind = 'image';
          // Anchor exactly where PowerPoint draws the shape (its reported bbox),
          // overriding our OOXML estimate — eliminates diagram drift.
          const pos = done.get(shape.src);
          if (pos && pos.w > 0 && pos.h > 0) {
            shape.x = pos.x;
            shape.y = pos.y;
            shape.w = pos.w;
            shape.h = pos.h;
          }
        } else {
          shape.src = undefined;
          ir.warnings.push(`Could not rasterize a ${shape.rasterReq?.reason ?? 'complex'} shape; left as a gap.`);
        }
      }
    }
  }

  const deckPath = join(outDir, 'deck.slaide');
  const masterPath = join(outDir, 'master.slaide.yaml');
  const writeAll = () => {
    const { master, deck } = emit(ir);
    writeFileSync(masterPath, master, 'utf8');
    writeFileSync(deckPath, deck, 'utf8');
  };
  writeAll();
  for (const a of ir.assets) writeFileSync(join(assetsDir, a.name), a.data);

  // Auto per-slide verification (hybrid): render each reconstructed slide, compare to
  // PowerPoint, and replace any slide that reconstructs below the bar with a faithful
  // full-slide image. Editable where it works; pixel-accurate where it doesn't.
  let rasterizedSlides = 0;
  if (fidelity === 'hybrid' && ppt) {
    try {
      const { compareDecks } = await import('../compare/index.js');
      const verifyDir = join(outDir, '_verify');
      const cmp = await compareDecks(path, deckPath, { outDir: verifyDir, threshold: 0 });
      const refDir = join(verifyDir, 'ref');
      const pad = (n: number) => String(n).padStart(2, '0');
      const gate = opts.rasterThreshold ?? AUTO_RASTER_THRESHOLD;
      let changed = false;
      for (const s of cmp.slides) {
        // Gate on the strict measure: only slides that genuinely reconstruct poorly
        // become images. Most slides should pass once reconstruction is correct.
        if (s.matchStrict >= gate) continue;
        const ref = join(refDir, `slide-${pad(s.index)}.png`);
        if (!existsSync(ref)) continue;
        const dest = `slide-${pad(s.index)}.png`;
        copyFileSync(ref, join(assetsDir, dest));
        ir.slides[s.index - 1].shapes = [{ kind: 'image', x: 0, y: 0, w: ir.canvas.w, h: ir.canvas.h, src: dest }];
        ir.slides[s.index - 1].background = undefined;
        ir.warnings.push(`Slide ${s.index} reconstructed at ${Math.round(s.match * 100)}% — kept as a faithful image (not editable).`);
        rasterizedSlides++;
        changed = true;
      }
      if (changed) writeAll();
      rmSync(verifyDir, { recursive: true, force: true });
    } catch (e) {
      ir.warnings.push(`Auto per-slide verification skipped (needs Playwright + PowerPoint): ${(e as Error).message}`);
    }
  }

  writeReport(outDir, ir, fidelity, rasterizedSlides);
  return { outDir, deckPath, masterPath, slides: ir.slides.length, assets: ir.assets.length, fidelity, warnings: ir.warnings };
}

/** Below this per-slide visual match, a hybrid import keeps the slide as an image.
 *  Kept deliberately low: editability is the point of a reconstruction import, and the
 *  reported match metric is bounded by Chromium-vs-PowerPoint text antialiasing (a
 *  visually-faithful text slide tops out ~95–97%), so only genuinely-unreconstructable
 *  slides should fall back to a flat image. Raise via `--raster-threshold` for archival
 *  pixel-fidelity, or use `--fidelity exact-raster` for an all-image (~99%) import. */
const AUTO_RASTER_THRESHOLD = 0.85;

function writeReport(outDir: string, ir: Awaited<ReturnType<typeof parsePptx>>, fidelity: Fidelity, rasterizedSlides = 0): void {
  const editable = ir.slides.length - rasterizedSlides;
  const lines: string[] = [
    `# Import report\n`,
    `- Fidelity mode: **${fidelity}**`,
    `- Slides: ${ir.slides.length} (${editable} editable, ${rasterizedSlides} kept as faithful images)`,
    `- Assets: ${ir.assets.length}`,
  ];
  if (ir.theme.nonGoogleFonts.length) lines.push(`- Non-Google fonts (system provider): ${ir.theme.nonGoogleFonts.join(', ')}`);
  let rasterCount = 0;
  ir.slides.forEach((s, i) => {
    const r = s.shapes.filter((sh) => sh.kind === 'raster').length;
    if (r) {
      rasterCount += r;
      lines.push(`- Slide ${i + 1}: ${r} shape(s) left as gaps (raster unavailable)`);
    }
  });
  if (ir.warnings.length) {
    lines.push(`\n## Warnings`);
    for (const w of ir.warnings) lines.push(`- ${w}`);
  }
  writeFileSync(join(outDir, 'import-report.md'), lines.join('\n'));
}

/** Convert a .key to .pptx via LibreOffice (legacy Keynote) or macOS Keynote. */
function keynoteToPptx(path: string): string {
  const out = join(tmpdir(), basename(path).replace(/\.key$/i, '') + '.pptx');
  // Try LibreOffice headless (works for legacy Keynote 5.x).
  const soffice = process.platform === 'darwin' ? '/Applications/LibreOffice.app/Contents/MacOS/soffice' : 'soffice';
  const r = spawnSync(soffice, ['--headless', '--convert-to', 'pptx', '--outdir', tmpdir(), path], { encoding: 'utf8' });
  if (r.status === 0 && existsSync(out)) return out;
  throw new Error(
    'Could not convert Keynote (.key). Modern .key needs macOS Keynote — export to PowerPoint manually ' +
      '(File → Export To → PowerPoint) and import the .pptx. (LibreOffice only opens legacy Keynote.)',
  );
}

export async function importDeck(path: string, outDir?: string, opts: ImportOptions = {}): Promise<ImportResult> {
  const ext = extname(path).toLowerCase();
  const dir = outDir ?? join(dirname(path), basename(path, ext) + '.slaide.d');
  let result: ImportResult;
  if (ext === '.pptx') result = await importPptxFile(path, dir, opts);
  else if (ext === '.key') result = await importPptxFile(keynoteToPptx(path), dir, opts);
  else throw new Error(`Unsupported input "${ext}". Supported: .pptx, .key`);

  if (opts.slaidec) {
    // Bundle the freshly-written folder into one shareable .slaidec, then drop the folder.
    const { packDeck } = await import('../container.js');
    const base = dir.endsWith('.slaide.d') ? dir.slice(0, -'.slaide.d'.length) : dir;
    const slaidecPath = base + '.slaidec';
    await packDeck(dir, slaidecPath, { force: true });
    rmSync(dir, { recursive: true, force: true });
    result.slaidecPath = slaidecPath;
  }
  return result;
}
