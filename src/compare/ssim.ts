// Copyright 2026 AIVory, Inc.
// SPDX-License-Identifier: Apache-2.0
// Minimal grayscale SSIM (structural similarity), windowed. No native deps.
// Returns a score in [0,1]; 1 == identical. A perceptual fidelity metric.

function toGray(data: Uint8Array | Uint8ClampedArray, w: number, h: number): Float64Array {
  const g = new Float64Array(w * h);
  for (let i = 0, p = 0; i < w * h; i++, p += 4) {
    g[i] = 0.299 * data[p] + 0.587 * data[p + 1] + 0.114 * data[p + 2];
  }
  return g;
}

/** Mean SSIM over non-overlapping windows. a/b are RGBA buffers of equal w*h. */
export function ssim(a: Uint8Array | Uint8ClampedArray, b: Uint8Array | Uint8ClampedArray, w: number, h: number, win = 8): number {
  const ga = toGray(a, w, h);
  const gb = toGray(b, w, h);
  const C1 = (0.01 * 255) ** 2;
  const C2 = (0.03 * 255) ** 2;
  let total = 0;
  let count = 0;
  for (let y = 0; y + win <= h; y += win) {
    for (let x = 0; x + win <= w; x += win) {
      let sa = 0, sb = 0, saa = 0, sbb = 0, sab = 0;
      const n = win * win;
      for (let j = 0; j < win; j++) {
        for (let i = 0; i < win; i++) {
          const idx = (y + j) * w + (x + i);
          const va = ga[idx], vb = gb[idx];
          sa += va; sb += vb; saa += va * va; sbb += vb * vb; sab += va * vb;
        }
      }
      const ma = sa / n, mb = sb / n;
      const va = saa / n - ma * ma;
      const vb = sbb / n - mb * mb;
      const cov = sab / n - ma * mb;
      const s = ((2 * ma * mb + C1) * (2 * cov + C2)) / ((ma * ma + mb * mb + C1) * (va + vb + C2));
      total += s;
      count++;
    }
  }
  return count ? total / count : 1;
}
