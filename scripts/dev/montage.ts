// Copyright 2026 AIVory, Inc.
// SPDX-License-Identifier: Apache-2.0
// Render every slide of a deck and tile them into one contact-sheet PNG.
// Usage: tsx scripts/dev/montage.ts <deck> [out.png] [cols]
import { shootDeck } from './shoot.js';
import { PNG } from 'pngjs';
import { readFileSync, writeFileSync } from 'node:fs';

const deck = process.argv[2];
const out = process.argv[3] ?? 'out/montage.png';
const cols = parseInt(process.argv[4] ?? '3', 10);
if (!deck) throw new Error('usage: montage <deck> [out.png] [cols]');

const paths = await shootDeck(deck, 'out/_mshots', { hideChrome: true });

const TILE_W = 520;
const GAP = 10;
const BG = [248, 249, 251, 255];

function downscale(src: PNG, tw: number): PNG {
  const th = Math.round((src.height / src.width) * tw);
  const out = new PNG({ width: tw, height: th });
  for (let y = 0; y < th; y++) {
    const sy = Math.min(src.height - 1, Math.floor((y * src.height) / th));
    for (let x = 0; x < tw; x++) {
      const sx = Math.min(src.width - 1, Math.floor((x * src.width) / tw));
      const si = (sy * src.width + sx) * 4;
      const di = (y * tw + x) * 4;
      src.data.copy(out.data, di, si, si + 4);
    }
  }
  return out;
}

const tiles = paths.map((p) => downscale(PNG.sync.read(readFileSync(p)), TILE_W));
const TILE_H = tiles[0].height;
const rows = Math.ceil(tiles.length / cols);
const W = cols * TILE_W + (cols + 1) * GAP;
const H = rows * TILE_H + (rows + 1) * GAP;
const sheet = new PNG({ width: W, height: H });
for (let i = 0; i < W * H; i++) for (let c = 0; c < 4; c++) sheet.data[i * 4 + c] = BG[c];

tiles.forEach((t, i) => {
  const cx = GAP + (i % cols) * (TILE_W + GAP);
  const cy = GAP + Math.floor(i / cols) * (TILE_H + GAP);
  for (let y = 0; y < TILE_H; y++) {
    const srcStart = y * TILE_W * 4;
    const dstStart = ((cy + y) * W + cx) * 4;
    t.data.copy(sheet.data, dstStart, srcStart, srcStart + TILE_W * 4);
  }
});

writeFileSync(out, PNG.sync.write(sheet));
console.log(`${tiles.length} slides -> ${out} (${W}x${H})`);
