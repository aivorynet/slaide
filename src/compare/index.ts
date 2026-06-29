// Copyright 2026 AIVory, Inc.
// SPDX-License-Identifier: Apache-2.0
// Fidelity / overlay compare harness. Renders the ORIGINAL .pptx via PowerPoint COM
// (the oracle) and the imported .slaide via the slaide renderer, then scores each
// slide (SSIM + pixel mismatch), writes side-by-side/overlay/diff composites, and a
// pass/fail report against a similarity threshold.
import { spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync, mkdirSync, existsSync, readdirSync } from 'node:fs';
import { dirname, resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { renderDeckHtml, openDeck } from '../index.js';
import { ssim } from './ssim.js';

const POWERPNT = 'C:\\Program Files\\Microsoft Office\\root\\Office16\\POWERPNT.EXE';
const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');

export interface CompareOpts {
  outDir?: string;
  threshold?: number; // percent, default 98
  refDir?: string; // pre-rendered oracle PNGs (skip PowerPoint)
}

export interface SlideScore {
  index: number;
  match: number; // headline: perceptual agreement (how it looks at normal viewing size)
  matchStrict: number; // pixel-exact agreement (penalizes sub-pixel font antialiasing)
  ssim: number; // structural similarity (downsampled)
  mismatch: number; // fraction of differing pixels (full-res, drives the diff mask)
  overlay: string;
}
export interface CompareResult {
  slides: SlideScore[];
  aggregate: number; // percent (mean perceptual match, coverage-penalized)
  strictAggregate: number; // percent (mean pixel-exact match)
  ssimAggregate: number; // percent (mean SSIM, coverage-penalized)
  pass: boolean;
  threshold: number;
  refCount: number;
  mineCount: number;
}

function powerPointAvailable(): boolean {
  return process.platform === 'win32' && existsSync(POWERPNT);
}

/** Render the original .pptx to per-slide PNGs via PowerPoint COM. */
function renderOracle(pptx: string, outDir: string, w: number, h: number): string[] {
  mkdirSync(outDir, { recursive: true });
  const ps1 = join(repoRoot, 'scripts', 'raster.ps1');
  const r = spawnSync(
    'powershell',
    ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', ps1, '-In', resolve(pptx), '-Out', resolve(outDir), '-Mode', 'slides', '-W', String(w), '-H', String(h)],
    { encoding: 'utf8', timeout: 120000 },
  );
  if (r.status !== 0) throw new Error(`PowerPoint render failed: ${r.stderr || r.stdout}`);
  return sortedPngs(outDir);
}

function sortedPngs(dir: string): string[] {
  return readdirSync(dir)
    .filter((f) => /\.png$/i.test(f))
    .sort()
    .map((f) => join(dir, f));
}

/** Render every slide of the imported deck to PNGs at exactly w x h (no viewer chrome). */
async function renderMine(deck: string, outDir: string, w: number, h: number): Promise<string[]> {
  const { chromium } = await import('playwright');
  const { deckFile, deckDir } = await openDeck(deck);
  const src = readFileSync(deckFile, 'utf8');
  const { html, ir } = renderDeckHtml(src, deckDir, { mode: 'web', inline: true });
  mkdirSync(outDir, { recursive: true });
  const doc = html.replace('</head>', '<style>.sl-counter,.sl-progress,.sl-notes,.sl-help{display:none !important;}</style></head>');
  const browser = await chromium.launch();
  // Render at 2x and box-average down (supersampling) so text AA is smoother and
  // closer to PowerPoint's rasterizer than Chromium's native 1x hinting.
  const page = await browser.newPage({ viewport: { width: w, height: h }, deviceScaleFactor: 2 });
  await page.setContent(doc, { waitUntil: 'networkidle' });
  await page.evaluate(() => (document as any).fonts?.ready);
  await page.waitForTimeout(400);
  const paths: string[] = [];
  for (let i = 0; i < ir.slides.length; i++) {
    await page.evaluate((n) => (window as any).slaide.show(n), i);
    await page.waitForTimeout(160);
    const p = `${outDir}/mine-${String(i + 1).padStart(2, '0')}.png`;
    await page.screenshot({ path: p });
    paths.push(p);
  }
  await browser.close();
  return paths;
}

type Img = { width: number; height: number; data: Buffer };

function nnResize(img: Img, w: number, h: number): Img {
  if (img.width === w && img.height === h) return img;
  const out = Buffer.alloc(w * h * 4);
  for (let y = 0; y < h; y++) {
    const sy = Math.min(img.height - 1, Math.floor((y * img.height) / h));
    for (let x = 0; x < w; x++) {
      const sx = Math.min(img.width - 1, Math.floor((x * img.width) / w));
      const si = (sy * img.width + sx) * 4;
      const di = (y * w + x) * 4;
      img.data.copy(out, di, si, si + 4);
    }
  }
  return { width: w, height: h, data: out };
}

/** Separable box blur (RGBA). Models human visual acuity at viewing distance: smears
 *  sub-pixel glyph antialiasing (imperceptible) while preserving real differences
 *  (shifted/missing/recoloured regions span many pixels and survive the blur). */
function boxBlur(img: Img, r: number): Img {
  const { width: w, height: h, data } = img;
  const win = 2 * r + 1;
  const tmp = Buffer.alloc(w * h * 4);
  const out = Buffer.alloc(w * h * 4);
  const clamp = (v: number, hi: number) => (v < 0 ? 0 : v > hi ? hi : v);
  for (let y = 0; y < h; y++) {
    for (let c = 0; c < 4; c++) {
      let sum = 0;
      for (let x = -r; x <= r; x++) sum += data[(y * w + clamp(x, w - 1)) * 4 + c];
      for (let x = 0; x < w; x++) {
        tmp[(y * w + x) * 4 + c] = sum / win;
        sum += data[(y * w + clamp(x + r + 1, w - 1)) * 4 + c] - data[(y * w + clamp(x - r, w - 1)) * 4 + c];
      }
    }
  }
  for (let x = 0; x < w; x++) {
    for (let c = 0; c < 4; c++) {
      let sum = 0;
      for (let y = -r; y <= r; y++) sum += tmp[(clamp(y, h - 1) * w + x) * 4 + c];
      for (let y = 0; y < h; y++) {
        out[(y * w + x) * 4 + c] = sum / win;
        sum += tmp[(clamp(y + r + 1, h - 1) * w + x) * 4 + c] - tmp[(clamp(y - r, h - 1) * w + x) * 4 + c];
      }
    }
  }
  return { width: w, height: h, data: out };
}

/** Box-average downsample by an integer factor. Removes sub-pixel font-hinting noise
 *  so the metric reflects layout/colour/position fidelity, not renderer AA differences. */
function downsample(img: Img, f: number): Img {
  if (f <= 1) return img;
  const w = Math.floor(img.width / f);
  const h = Math.floor(img.height / f);
  const out = Buffer.alloc(w * h * 4);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let r = 0, g = 0, b = 0, a = 0;
      for (let j = 0; j < f; j++) {
        for (let i = 0; i < f; i++) {
          const si = ((y * f + j) * img.width + (x * f + i)) * 4;
          r += img.data[si]; g += img.data[si + 1]; b += img.data[si + 2]; a += img.data[si + 3];
        }
      }
      const n = f * f;
      const di = (y * w + x) * 4;
      out[di] = r / n; out[di + 1] = g / n; out[di + 2] = b / n; out[di + 3] = a / n;
    }
  }
  return { width: w, height: h, data: out };
}

export async function compareDecks(original: string, deck: string, opts: CompareOpts = {}): Promise<CompareResult> {
  const { PNG } = await import('pngjs');
  const pixelmatch = (await import('pixelmatch')).default;
  const outDir = opts.outDir ?? 'out/compare';
  const threshold = opts.threshold ?? 98;
  mkdirSync(outDir, { recursive: true });

  // canvas size from the deck
  const src = readFileSync(deck, 'utf8');
  const { ir } = renderDeckHtml(src, dirname(resolve(deck)), { mode: 'web', inline: false });
  const W = ir.canvas.width;
  const H = ir.canvas.height;

  // oracle frames
  let refPaths: string[];
  if (opts.refDir) refPaths = sortedPngs(opts.refDir);
  else if (original.toLowerCase().endsWith('.pptx') && powerPointAvailable()) refPaths = renderOracle(original, join(outDir, 'ref'), W, H);
  else if (existsSync(original) && readdirSync(original).some((f) => /\.png$/i.test(f))) refPaths = sortedPngs(original);
  else throw new Error('No oracle: pass a .pptx (needs PowerPoint) or a directory of reference PNGs via --ref.');

  // mine frames
  const minePaths = await renderMine(deck, join(outDir, 'mine'), W, H);

  const n = Math.min(refPaths.length, minePaths.length);
  const slides: SlideScore[] = [];
  const DS = 2; // downsample factor for metrics
  for (let i = 0; i < n; i++) {
    const refImg = PNG.sync.read(readFileSync(refPaths[i])) as unknown as Img;
    let mineImg = PNG.sync.read(readFileSync(minePaths[i])) as unknown as Img;
    // Supersample-down a 2x mine render (smoother AA) before aligning.
    if (mineImg.width >= W * 2) mineImg = downsample(mineImg, Math.round(mineImg.width / W));
    const r = nnResize(refImg, W, H);
    const m = nnResize(mineImg, W, H);

    // Full-res diff mask for the human-readable overlay.
    const diff = new PNG({ width: W, height: H });
    const mismatchPx = pixelmatch(r.data, m.data, diff.data, W, H, { threshold: 0.12, diffColor: [255, 60, 60] });
    const overlay = join(outDir, `cmp-${String(i + 1).padStart(2, '0')}.png`);
    writeFileSync(overlay, PNG.sync.write(composite(PNG, r, m, diff as unknown as Img, W, H)));

    // Two measures: strict (near-pixel, penalizes font AA) and perceptual (how it
    // looks at normal viewing size). Both downsampled-box (no native deps).
    const agree = (f: number) => {
      const a = downsample(r, f);
      const b = downsample(m, f);
      const px = pixelmatch(a.data, b.data, null as any, a.width, a.height, { threshold: 0.1 });
      return 1 - px / (a.width * a.height);
    };
    // The downsampled pixel-agreement is already the most favourable honest measure:
    // blurring or downsampling further only spreads each difference and lowers the
    // score, so a single transparent number is reported.
    const matchStrict = agree(DS);
    const match = matchStrict;
    const rd = downsample(r, DS);
    const sim = ssim(rd.data, downsample(m, DS).data, rd.width, rd.height);
    void boxBlur;
    slides.push({ index: i + 1, match, matchStrict, ssim: sim, mismatch: mismatchPx / (W * H), overlay });
  }

  const coverage = n / Math.max(refPaths.length, minePaths.length, 1);
  const mean = (sel: (s: SlideScore) => number) => slides.reduce((a, s) => a + sel(s), 0) / (slides.length || 1);
  const aggregate = Math.round(mean((s) => s.match) * coverage * 1000) / 10;
  const strictAggregate = Math.round(mean((s) => s.matchStrict) * coverage * 1000) / 10;
  const ssimAggregate = Math.round(mean((s) => s.ssim) * coverage * 1000) / 10;
  const pass = aggregate >= threshold;

  const result: CompareResult = { slides, aggregate, strictAggregate, ssimAggregate, pass, threshold, refCount: refPaths.length, mineCount: minePaths.length };
  writeReport(outDir, original, deck, result);
  return result;
}

/** 2x2 composite: [ref | mine] / [50% blend | diff]. */
function composite(PNG: any, ref: Img, mine: Img, diff: Img, w: number, h: number): any {
  const out = new PNG({ width: w * 2, height: h * 2 });
  const place = (img: Img, ox: number, oy: number, blendWith?: Img) => {
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const si = (y * w + x) * 4;
        const di = ((oy + y) * w * 2 + (ox + x)) * 4;
        if (blendWith) {
          for (let c = 0; c < 3; c++) out.data[di + c] = (img.data[si + c] + blendWith.data[si + c]) >> 1;
          out.data[di + 3] = 255;
        } else {
          img.data.copy(out.data, di, si, si + 4);
        }
      }
    }
  };
  place(ref, 0, 0);
  place(mine, w, 0);
  place(ref, 0, h, mine); // blend ref+mine
  place(diff, w, h);
  return out;
}

function writeReport(outDir: string, original: string, deck: string, r: CompareResult) {
  const lines: string[] = [];
  lines.push(`# Fidelity report\n`);
  lines.push(`- Original: \`${original}\``);
  lines.push(`- Deck: \`${deck}\``);
  lines.push(`- Oracle slides: ${r.refCount} · Imported slides: ${r.mineCount}`);
  lines.push(`- **Visual match (perceptual): ${r.aggregate}%** (threshold ${r.threshold}%) — **${r.pass ? 'PASS ✅' : 'FAIL ❌'}**`);
  lines.push(`- Strict pixel match: ${r.strictAggregate}% · SSIM: ${r.ssimAggregate}%\n`);
  lines.push(`| Slide | Visual % | Strict % | Overlay |`);
  lines.push(`|------:|---------:|---------:|---------|`);
  for (const s of [...r.slides].sort((a, b) => a.match - b.match)) {
    lines.push(`| ${s.index} | ${(s.match * 100).toFixed(1)} | ${(s.matchStrict * 100).toFixed(1)} | \`${s.overlay.split(/[\\/]/).pop()}\` |`);
  }
  lines.push(`\nOverlay quadrants: top-left = original, top-right = imported, bottom-left = 50% blend, bottom-right = red diff mask.`);
  writeFileSync(join(outDir, 'compare-report.md'), lines.join('\n'));
  writeFileSync(join(outDir, 'compare.json'), JSON.stringify(r, null, 2));
}
