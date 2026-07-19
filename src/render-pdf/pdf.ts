// Copyright 2026 AIVory, Inc.
// SPDX-License-Identifier: Apache-2.0
// @slaide/render-pdf — Playwright headless-Chromium print of the web runtime
// in print/collapse mode. Reuses the same settled-state markup as the runtime,
// so web and PDF cannot structurally diverge.
import { renderDeckHtml } from '../index.js';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

export interface PdfOptions {
  /** Output PDF path. */
  out: string;
}

async function loadPlaywright(): Promise<typeof import('playwright')> {
  try {
    return await import('playwright');
  } catch {
    throw new Error(
      'PDF export needs Playwright. Install it:\n' +
        '  npm install playwright\n' +
        '  npx playwright install chromium',
    );
  }
}

export async function renderPdfFromHtml(
  html: string,
  out: string,
  canvas?: { width: number; height: number },
  injected?: import('playwright').Browser,
): Promise<string> {
  const { chromium } = await loadPlaywright();
  // Use a pooled browser when one is injected (engine-service) — and never close it then;
  // otherwise launch a throwaway one for this single export (CLI path), unchanged.
  const browser = injected ?? (await chromium.launch());
  try {
    // Match the viewport to the canvas so layout-measured content (e.g. charts sizing to
    // their slot) is measured at the real design size, not the default 1280×720.
    const page = await browser.newPage(
      canvas ? { viewport: { width: canvas.width, height: canvas.height } } : {},
    );
    await page.setContent(html, { waitUntil: 'networkidle' });
    // Ensure web fonts are ready before printing.
    await page.evaluate(() => (document as any).fonts?.ready);
    // Ensure every image has finished loading (or failed) before printing — print mode marks
    // them eager (see renderSlidePrint), but 'networkidle' can fire while decodes/late fetches
    // are still in flight. Capped at 15s so one dead URL cannot hang the export.
    await page
      .evaluate(() => {
        const pending = Array.from(document.images)
          .filter((im) => !im.complete)
          .map(
            (im) =>
              new Promise<void>((res) => {
                im.addEventListener('load', () => res(), { once: true });
                im.addEventListener('error', () => res(), { once: true });
              }),
          );
        if (!pending.length) return;
        return Promise.race([Promise.all(pending).then(() => undefined), new Promise<void>((res) => setTimeout(res, 15000))]);
      })
      .catch(() => {});
    // Render charts (lazy) and wait until they settle so they appear in the PDF. Gated on the
    // chart-lib signal + 3-arg waitForFunction form — see render-png/shoot.ts's shootHtml.
    if (html.includes('id="sl-mermaid-lib"') || html.includes('id="sl-echart-lib"')) {
      await page.evaluate(() => (window as any).__slaideCharts?.renderAll());
      await page
        .waitForFunction(() => (window as any).__slaideChartsReady === true, undefined, { timeout: 8000 })
        .catch(() => {});
    }
    await page.pdf({
      path: out,
      preferCSSPageSize: true,
      printBackground: true,
    });
    return out;
  } finally {
    if (!injected) await browser.close();
  }
}

export async function renderPdf(deckPath: string, opts: PdfOptions): Promise<string> {
  const source = readFileSync(deckPath, 'utf8');
  const { html, ir } = renderDeckHtml(source, dirname(resolve(deckPath)), { mode: 'print', inline: true });
  return renderPdfFromHtml(html, opts.out, ir.canvas);
}
