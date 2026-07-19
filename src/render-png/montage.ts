// Copyright 2026 AIVory, Inc.
// SPDX-License-Identifier: Apache-2.0
// @slaide/render-png — tile every slide into ONE small contact sheet. This is the token-cheap
// "see it" loop: an agent reads a single image of all slides to catch overlapping/clipped text
// and broken layout, instead of N full-res shots. Defaults to JPEG (smaller + faster to read);
// pass a .png path for lossless. Both the tiling and the encode happen in the browser, so there
// is no image-codec dependency.
import { renderDeckHtml } from '../index.js';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

export interface MontageOptions {
  out?: string; // output file; .jpg/.jpeg -> JPEG (default), .png -> lossless PNG
  cols?: number; // columns (default 3)
  tileWidth?: number; // px per slide tile (default 360 — compact, token-cheap)
  quality?: number; // JPEG quality 1-100 (default 80)
  /** A pooled Chromium browser to reuse; when omitted a throwaway one is launched + closed. */
  browser?: import('playwright').Browser;
}

async function loadPlaywright(): Promise<typeof import('playwright')> {
  try {
    return await import('playwright');
  } catch {
    throw new Error('montage needs Playwright. Install it:\n  npm install playwright\n  npx playwright install chromium');
  }
}

export async function montageDeck(
  deckPath: string,
  opts: MontageOptions = {},
): Promise<{ out: string; slides: number; width: number; height: number }> {
  const out = opts.out ?? 'out/montage.jpg';
  const cols = Math.max(1, opts.cols ?? 3);
  const tileW = opts.tileWidth ?? 360;
  const gap = 8;
  const jpeg = /\.jpe?g$/i.test(out);
  const quality = Math.max(1, Math.min(100, opts.quality ?? 80));

  const src = readFileSync(deckPath, 'utf8');
  const { html, ir } = renderDeckHtml(src, dirname(resolve(deckPath)), { mode: 'web', inline: true });

  const { chromium } = await loadPlaywright();
  const browser = opts.browser ?? (await chromium.launch());
  try {
    const page = await browser.newPage({ viewport: { width: ir.canvas.width, height: ir.canvas.height }, deviceScaleFactor: 1 });
    const doc = html.replace(
      '</head>',
      '<style>.sl-counter,.sl-progress,.sl-notes,.sl-help,.sl-present-toggle{display:none !important;}</style></head>',
    );
    await page.setContent(doc, { waitUntil: 'networkidle' });
    await page.evaluate(() => (document as any).fonts?.ready);
    // See render-png/shoot.ts's shootHtml: gated on the same chart-lib signal (chart-free decks
    // never define window.__slaideCharts, so the wait would just burn the timeout for nothing),
    // and the 3-arg waitForFunction form (the 2-arg form silently drops the 8000ms cap).
    if (doc.includes('id="sl-mermaid-lib"') || doc.includes('id="sl-echart-lib"')) {
      await page.evaluate(() => (window as any).__slaideCharts?.renderAll());
      await page.waitForFunction(() => (window as any).__slaideChartsReady === true, undefined, { timeout: 8000 }).catch(() => {});
    }
    await page.waitForTimeout(400);

    // Capture each slide (builds settled) as a light JPEG, then tile + encode in one canvas.
    const shots: string[] = [];
    for (let i = 0; i < ir.slides.length; i++) {
      await page.evaluate((n) => (window as any).slaide.show(n), i);
      await page.waitForTimeout(150);
      shots.push((await page.screenshot({ type: 'jpeg', quality: 90 })).toString('base64'));
    }
    if (!shots.length) throw new Error('montage: deck rendered no slides');

    const dataUrl = (await page.evaluate(
      async ({ shots, cols, tileW, gap, jpeg, quality }) => {
        const imgs = await Promise.all(
          shots.map((b64: string) => new Promise<HTMLImageElement>((res) => { const im = new Image(); im.onload = () => res(im); im.src = 'data:image/jpeg;base64,' + b64; })),
        );
        const tileH = Math.round((imgs[0].naturalHeight / imgs[0].naturalWidth) * tileW);
        const rows = Math.ceil(imgs.length / cols);
        const W = cols * tileW + (cols + 1) * gap;
        const H = rows * tileH + (rows + 1) * gap;
        const cv = document.createElement('canvas'); cv.width = W; cv.height = H;
        const ctx = cv.getContext('2d') as CanvasRenderingContext2D;
        ctx.imageSmoothingEnabled = true; (ctx as any).imageSmoothingQuality = 'high';
        ctx.fillStyle = '#f8f9fb'; ctx.fillRect(0, 0, W, H);
        imgs.forEach((im, i) => { const cx = gap + (i % cols) * (tileW + gap), cy = gap + Math.floor(i / cols) * (tileH + gap); ctx.drawImage(im, cx, cy, tileW, tileH); });
        return jpeg ? cv.toDataURL('image/jpeg', quality / 100) : cv.toDataURL('image/png');
      },
      { shots, cols, tileW, gap, jpeg, quality },
    )) as string;

    mkdirSync(dirname(resolve(out)), { recursive: true });
    writeFileSync(out, Buffer.from(dataUrl.split(',')[1], 'base64'));
    const tileH = Math.round((ir.canvas.height / ir.canvas.width) * tileW);
    const rows = Math.ceil(shots.length / cols);
    return { out, slides: shots.length, width: cols * tileW + (cols + 1) * gap, height: rows * tileH + (rows + 1) * gap };
  } finally {
    if (!opts.browser) await browser.close();
  }
}
