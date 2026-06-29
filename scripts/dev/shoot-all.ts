// Copyright 2026 AIVory, Inc.
// SPDX-License-Identifier: Apache-2.0
// Screenshot every slide of a deck (web mode) for visual review.
import { chromium } from 'playwright';
import { readFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve, basename } from 'node:path';
import { renderDeckHtml } from '../../src/index.js';

const deck = process.argv[2];
const outDir = process.argv[3] ?? 'out/shots';
if (!deck) throw new Error('usage: shoot-all <deck> [outDir]');
const src = readFileSync(deck, 'utf8');
const { html, ir } = renderDeckHtml(src, dirname(resolve(deck)), { mode: 'web', inline: true });
mkdirSync(outDir, { recursive: true });
const tag = basename(deck).replace(/\.slaide$/, '');

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1280, height: 720 }, deviceScaleFactor: 1.5 });
await page.setContent(html, { waitUntil: 'networkidle' });
await page.evaluate(() => (document as any).fonts?.ready);
await page.waitForTimeout(500);
for (let i = 0; i < ir.slides.length; i++) {
  await page.evaluate((n) => (window as any).slaide.show(n), i);
  await page.waitForTimeout(250);
  await page.screenshot({ path: `${outDir}/${tag}-${String(i + 1).padStart(2, '0')}.png` });
}
await browser.close();
console.log(`${ir.slides.length} slides -> ${outDir}`);
