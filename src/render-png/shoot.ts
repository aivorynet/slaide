// Copyright 2026 AIVory, Inc.
// SPDX-License-Identifier: Apache-2.0
// @slaide/render-png — Playwright headless-Chromium capture of every slide to a
// PNG, with all builds settled. This is the fast "see your deck" loop: authoring
// a theme without it means flying blind (you can ship invisible text and never
// know). Renders the same web runtime markup, so PNGs match what an audience sees.
import { renderDeckHtml } from '../index.js';
import { readFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve, join } from 'node:path';
import type { DeckIR } from '../types.js';

export interface ShootOptions {
  /** Output directory (default 'out/shots'). One PNG per slide is written there. */
  out?: string;
  /** Capture width/height in CSS px (default: the deck's canvas size). */
  width?: number;
  height?: number;
  /** deviceScaleFactor for crisper output (default 1). */
  scale?: number;
  /** Hide the runtime's page counter / progress bar so they don't pollute output. */
  hideChrome?: boolean;
  /** Filename prefix (default 'slide' → slide-01.png, slide-02.png, …). */
  tag?: string;
  /** Image format (default 'png'). 'jpeg' is smaller + faster — good for the see-it loop. */
  format?: 'png' | 'jpeg';
  /** JPEG quality 1-100 (default 82); ignored for PNG. */
  quality?: number;
  /** A pooled Chromium browser to reuse (engine-service). When set it is NOT closed here;
   *  when omitted, a throwaway browser is launched and closed for this call (CLI path). */
  browser?: import('playwright').Browser;
}

async function loadPlaywright(): Promise<typeof import('playwright')> {
  try {
    return await import('playwright');
  } catch {
    throw new Error(
      'PNG export needs Playwright. Install it:\n' +
        '  npm install playwright\n' +
        '  npx playwright install chromium',
    );
  }
}

/** Render a self-contained web-deck HTML + its IR to per-slide PNGs (builds settled). */
export async function shootHtml(html: string, ir: DeckIR, opts: ShootOptions = {}): Promise<string[]> {
  const outDir = opts.out ?? 'out/shots';
  // Derive the missing dimension from the canvas aspect so `--width 512` yields a 16:9
  // shot (not a portrait frame letterboxed top/bottom). Both unset → full canvas size.
  const cw = ir.canvas.width;
  const ch = ir.canvas.height;
  let width = opts.width;
  let height = opts.height;
  if (width && !height) height = Math.round((width * ch) / cw);
  else if (height && !width) width = Math.round((height * cw) / ch);
  width = width ?? cw;
  height = height ?? ch;
  const scale = opts.scale ?? 1;
  const tag = opts.tag ?? 'slide';
  const fmt = opts.format ?? 'png';
  const quality = Math.max(1, Math.min(100, opts.quality ?? 82));
  mkdirSync(outDir, { recursive: true });

  const { chromium } = await loadPlaywright();
  const browser = opts.browser ?? (await chromium.launch());
  try {
    const page = await browser.newPage({ viewport: { width, height }, deviceScaleFactor: scale });
    let doc = html;
    if (opts.hideChrome) {
      doc = doc.replace(
        '</head>',
        '<style>.sl-counter,.sl-progress,.sl-notes,.sl-help,.sl-present-toggle{display:none !important;}</style></head>',
      );
    }
    await page.setContent(doc, { waitUntil: 'networkidle' });
    await page.evaluate(() => (document as any).fonts?.ready);
    // Render all charts (lazy in the runtime) and wait until they settle so every
    // captured frame includes them. No-op + immediate for chart-free decks.
    await page.evaluate(() => (window as any).__slaideCharts?.renderAll());
    await page
      .waitForFunction(() => (window as any).__slaideChartsReady === true, { timeout: 8000 })
      .catch(() => {});
    await page.waitForTimeout(400);

    const paths: string[] = [];
    for (let i = 0; i < ir.slides.length; i++) {
      // window.slaide.show(n) reveals slide n with every build settled (shown).
      await page.evaluate((n) => (window as any).slaide.show(n), i);
      await page.waitForTimeout(180);
      const p = join(outDir, `${tag}-${String(i + 1).padStart(2, '0')}.${fmt === 'jpeg' ? 'jpg' : 'png'}`);
      await page.screenshot(fmt === 'jpeg' ? { path: p, type: 'jpeg', quality } : { path: p });
      paths.push(p);
    }
    return paths;
  } finally {
    if (!opts.browser) await browser.close();
  }
}

/** Render every slide of a deck file to <out>/<tag>-NN.png. Returns the file paths. */
export async function shootDeck(deckPath: string, opts: ShootOptions = {}): Promise<string[]> {
  const src = readFileSync(deckPath, 'utf8');
  const { html, ir } = renderDeckHtml(src, dirname(resolve(deckPath)), { mode: 'web', inline: true });
  return shootHtml(html, ir, opts);
}
