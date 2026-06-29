// Copyright 2026 AIVory, Inc.
// SPDX-License-Identifier: Apache-2.0
// Render-extension seam. The core renderer emits a presentation-only deck. An
// embedding host may register optional add-ons that contribute extra <head> CSS
// and a trailing <body> script (e.g. analytics, a host integration). With nothing
// registered both return '' — the default output is the lean, present-only deck,
// byte-identical to having no extensions at all.
import type { DeckIR } from '../types.js';

export type RenderExtension = (ir: DeckIR) => string;

let headCss: RenderExtension = () => '';
let bodyScript: RenderExtension = () => '';

/** Register host-provided render extensions. Call once at process start, before
 *  rendering. Re-registering replaces the previous extension. */
export function registerRenderExtensions(ext: { headCss?: RenderExtension; bodyScript?: RenderExtension }): void {
  if (ext.headCss) headCss = ext.headCss;
  if (ext.bodyScript) bodyScript = ext.bodyScript;
}

/** Extra CSS appended to the document <head> (empty unless a host registered it). */
export function extraHeadCss(ir: DeckIR): string {
  return headCss(ir);
}

/** Extra script appended at the end of <body> (empty unless a host registered it). */
export function extraBodyScript(ir: DeckIR): string {
  return bodyScript(ir);
}
