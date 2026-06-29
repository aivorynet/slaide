// Copyright 2026 AIVory, Inc.
// SPDX-License-Identifier: Apache-2.0
// Rasterize the brand icon SVG into the assets the native viewer needs:
//   viewer/assets/slaide.ico   — multi-size Windows icon (embedded in the exe + file assoc)
//   viewer/assets/icon.rgba    — 256x256 raw RGBA (tao window/taskbar icon, no image crate needed)
//
// Uses Playwright (Chromium) for faithful SVG rendering (gradients/rounding/opacity) and
// pngjs to decode the 256px PNG to RGBA. Re-run after changing the icon: `tsx scripts/dev/gen-icons.ts`.
import { chromium } from 'playwright';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PNG } from 'pngjs';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const ASSETS = join(repoRoot, 'viewer', 'assets');
const ICON_SVG = process.argv[2] ?? join(ASSETS, 'slaide-icon.svg');
const SIZES = [16, 24, 32, 48, 64, 128, 256];

/** Render an SVG to a size×size transparent PNG buffer. */
async function renderPng(page: import('playwright').Page, svg: string, size: number): Promise<Buffer> {
  const doc =
    `<!doctype html><meta charset=utf-8>` +
    `<style>html,body{margin:0;padding:0;background:transparent}` +
    `svg{display:block;width:${size}px;height:${size}px}</style>` +
    svg;
  await page.setViewportSize({ width: size, height: size });
  await page.setContent(doc, { waitUntil: 'networkidle' });
  return page.screenshot({ omitBackground: true, clip: { x: 0, y: 0, width: size, height: size } });
}

/** Pack PNG buffers into a Windows .ico (PNG-compressed entries; Vista+). */
function buildIco(images: { size: number; png: Buffer }[]): Buffer {
  const count = images.length;
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0); // reserved
  header.writeUInt16LE(1, 2); // type: icon
  header.writeUInt16LE(count, 4);
  const dir = Buffer.alloc(16 * count);
  let offset = 6 + 16 * count;
  images.forEach((img, i) => {
    const e = i * 16;
    dir.writeUInt8(img.size >= 256 ? 0 : img.size, e + 0); // width (0 = 256)
    dir.writeUInt8(img.size >= 256 ? 0 : img.size, e + 1); // height
    dir.writeUInt8(0, e + 2); // palette
    dir.writeUInt8(0, e + 3); // reserved
    dir.writeUInt16LE(1, e + 4); // color planes
    dir.writeUInt16LE(32, e + 6); // bits per pixel
    dir.writeUInt32LE(img.png.length, e + 8); // bytes in resource
    dir.writeUInt32LE(offset, e + 12); // image offset
    offset += img.png.length;
  });
  return Buffer.concat([header, dir, ...images.map((i) => i.png)]);
}

async function main(): Promise<void> {
  const svg = readFileSync(ICON_SVG, 'utf8');
  mkdirSync(ASSETS, { recursive: true });
  const browser = await chromium.launch();
  const page = await browser.newPage();

  const images: { size: number; png: Buffer }[] = [];
  for (const size of SIZES) images.push({ size, png: await renderPng(page, svg, size) });
  await browser.close();

  const ico = buildIco(images);
  writeFileSync(join(ASSETS, 'slaide.ico'), ico);

  // 256px RGBA for the tao runtime window icon.
  const big = images.find((i) => i.size === 256)!;
  const decoded = PNG.sync.read(big.png);
  writeFileSync(join(ASSETS, 'icon.rgba'), Buffer.from(decoded.data));

  console.log(`✓ wrote viewer/assets/slaide.ico (${SIZES.join(',')} px, ${ico.length} bytes)`);
  console.log(`✓ wrote viewer/assets/icon.rgba (${decoded.width}x${decoded.height} RGBA, ${decoded.data.length} bytes)`);
}

main();
