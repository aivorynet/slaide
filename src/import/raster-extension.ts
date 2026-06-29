// Copyright 2026 AIVory, Inc.
// SPDX-License-Identifier: Apache-2.0
//
// High-fidelity import seam. The open-source importer reconstructs decks cross-platform
// (the `reconstruct` fidelity). The `hybrid` and `exact-raster` fidelities additionally
// drive PowerPoint via COM to rasterize shapes/slides slaide can't faithfully rebuild —
// that is a Slaide Pro capability, so its implementation is NOT in this open-source tree.
// The licensed Pro build registers a Rasterizer here; with none registered, hybrid/
// exact-raster gracefully fall back to reconstruct.
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

export interface RasterItem {
  slide: number; // 1-based
  name?: string;
  id?: string;
  file: string; // output filename (written into assetsDir)
  w: number;
  h: number;
}

/** PowerPoint's own bounding box for an exported shape (points == px in the canvas). */
export interface RasterPlaced {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** The high-fidelity rasterizer the importer uses for hybrid / exact-raster modes. */
export interface Rasterizer {
  /** Whether rasterization is usable here (e.g. Windows + PowerPoint present). */
  available(): boolean;
  /** Export every slide to <assetsDir>/slide-NN.png at w x h; returns filenames. */
  rasterizeSlides(pptx: string, assetsDir: string, w: number, h: number): string[];
  /** Rasterize individual shapes/groups; returns file -> PowerPoint bbox (or null). */
  rasterizeShapes(
    pptx: string,
    assetsDir: string,
    items: RasterItem[],
    canvas: { w: number; h: number },
  ): Promise<Map<string, RasterPlaced | null>>;
}

let active: Rasterizer | null = null;

/** Register the high-fidelity rasterizer (called by the licensed Pro build). */
export function registerRasterizer(r: Rasterizer): void {
  active = r;
}

/** The registered rasterizer, or null when this build has none (OSS / unlicensed). */
export function getRasterizer(): Rasterizer | null {
  return active;
}

/** Absolute path to the bundled PowerPoint-COM raster script. It lives in core (shared with
 *  `compare`); the Pro rasterizer resolves it through here so it works regardless of where
 *  the pro overlay is loaded from. */
export function rasterScriptPath(): string {
  return resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', 'scripts', 'raster.ps1');
}
