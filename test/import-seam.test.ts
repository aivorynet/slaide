// The high-fidelity import seam: the OSS build registers no rasterizer (so hybrid/
// exact-raster fall back to reconstruct), and a host can register one. Pure — no PowerPoint.
import { describe, it, expect } from 'vitest';
import { getRasterizer, registerRasterizer, rasterScriptPath, type Rasterizer } from '../src/index.js';

describe('import rasterizer seam', () => {
  it('has no rasterizer by default (OSS build is reconstruct-only)', () => {
    expect(getRasterizer()).toBeNull();
  });

  it('registers and returns a rasterizer (the Pro overlay does this)', () => {
    const fake: Rasterizer = {
      available: () => true,
      rasterizeSlides: () => [],
      rasterizeShapes: async () => new Map(),
    };
    registerRasterizer(fake);
    expect(getRasterizer()).toBe(fake);
  });

  it('resolves the bundled COM raster script under core/scripts', () => {
    expect(rasterScriptPath().replace(/\\/g, '/')).toMatch(/\/scripts\/raster\.ps1$/);
  });
});
