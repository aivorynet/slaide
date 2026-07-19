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
  /** Capture only this 0-based slide index instead of every slide in the deck — the
   *  single-slide "look" fast path (engine-server's shootSlide). Page setup / networkidle /
   *  font / chart-settle waits still run once as before; only the per-slide show+screenshot
   *  loop is trimmed to one iteration. Returns a single-element array, so callers that don't
   *  set this (montage, CLI `shoot`) are completely unaffected. */
  only?: number;
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
  if (opts.only != null && (opts.only < 0 || opts.only >= ir.slides.length)) {
    throw new Error(`shoot: slide ${opts.only} out of range (deck has ${ir.slides.length})`);
  }
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
    // Render all charts (lazy in the runtime) and wait until they settle so every captured
    // frame includes them. Chart-free decks never get the boot script at all (html.ts's
    // chartBlock omits it when there's no mermaid/echart markup), so window.__slaideCharts
    // stays undefined and the ready flag never flips — gate on the same signal so those decks
    // skip the wait instead of always burning it for nothing (this was the dominant fixed cost
    // of every shoot/montage call). Also note the 3-arg form: waitForFunction(fn, arg, options) —
    // passing options positionally as `arg` (the old 2-arg call) is silently accepted, so the
    // "8000ms" cap never took effect and every wait ran out Playwright's real default instead.
    const hasCharts = doc.includes('id="sl-mermaid-lib"') || doc.includes('id="sl-echart-lib"');
    if (hasCharts) {
      await page.evaluate(() => (window as any).__slaideCharts?.renderAll());
      await page
        .waitForFunction(() => (window as any).__slaideChartsReady === true, undefined, { timeout: 8000 })
        .catch(() => {});
    }
    await page.waitForTimeout(400);

    const paths: string[] = [];
    const indices = opts.only != null ? [opts.only] : ir.slides.map((_, i) => i);
    for (const i of indices) {
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
