// Golden fidelity regression test. Opt-in (needs PowerPoint + Playwright + a fixture):
//   SLAIDE_GOLDEN=1 npx vitest run test/import.golden.test.ts
// Drop a real .pptx at test/fixtures/sample.pptx, then this imports it and asserts the
// hybrid reconstruction stays above a ratcheting visual-match gate, and that exact-raster
// clears the 98% bar.
import { describe, it, expect } from 'vitest';
import { existsSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { importDeck } from '../src/index.js';
import { compareDecks } from '../src/compare/index.js';

const FIXTURE = 'test/fixtures/sample.pptx';
const enabled = process.env.SLAIDE_GOLDEN === '1' && existsSync(FIXTURE);

describe.skipIf(!enabled)('PPTX import golden fidelity', () => {
  it('hybrid reconstruction stays above the gate', async () => {
    const out = 'out/golden-hybrid';
    rmSync(out, { recursive: true, force: true });
    const r = await importDeck(FIXTURE, out, { fidelity: 'hybrid' });
    expect(r.slides).toBeGreaterThan(0);
    const cmp = await compareDecks(FIXTURE, join(out, 'deck.slaide'), { outDir: 'out/golden-hybrid-cmp', threshold: 0 });
    // Editable reconstruction ceiling is renderer-AA-bound; ratchet up as fidelity improves.
    expect(cmp.aggregate).toBeGreaterThanOrEqual(95);
  }, 180000);

  it('exact-raster clears the 98% bar', async () => {
    const out = 'out/golden-exact';
    rmSync(out, { recursive: true, force: true });
    await importDeck(FIXTURE, out, { fidelity: 'exact-raster' });
    const cmp = await compareDecks(FIXTURE, join(out, 'deck.slaide'), { outDir: 'out/golden-exact-cmp', threshold: 98 });
    expect(cmp.aggregate).toBeGreaterThanOrEqual(98);
    expect(cmp.pass).toBe(true);
  }, 180000);
});
