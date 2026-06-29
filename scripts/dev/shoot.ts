// Copyright 2026 AIVory, Inc.
// SPDX-License-Identifier: Apache-2.0
// Compat shim — the shoot logic now lives in src/render-png/shoot.ts and ships as
// the `slaide shoot` CLI command. This keeps the old (deck, outDir, opts) signature
// the montage helper uses.
import { shootDeck as core, shootHtml } from '../../src/render-png/shoot.js';
import type { ShootOptions } from '../../src/render-png/shoot.js';

export { shootHtml };
export type ShootOpts = Omit<ShootOptions, 'out'>;

/** Render every slide of a deck to <outDir>/<tag>-NN.png. Returns the file paths. */
export function shootDeck(deckPath: string, outDir: string, opts: ShootOpts = {}): Promise<string[]> {
  return core(deckPath, { out: outDir, ...opts });
}

// CLI: tsx scripts/dev/shoot.ts <deck> [outDir] [--scale N --hide]
if (import.meta.url === `file://${process.argv[1].replace(/\\/g, '/')}`) {
  const deck = process.argv[2];
  const outDir = process.argv[3] ?? 'out/shots';
  if (!deck) throw new Error('usage: shoot <deck> [outDir] [--scale N --hide]');
  const flag = (n: string) => {
    const i = process.argv.indexOf(n);
    return i >= 0 ? process.argv[i + 1] : undefined;
  };
  await shootDeck(deck, outDir, {
    scale: flag('--scale') ? Number(flag('--scale')) : undefined,
    hideChrome: process.argv.includes('--hide'),
  }).then((p) => console.log(`${p.length} slides -> ${outDir}`));
}
