// Copyright 2026 AIVory, Inc.
// SPDX-License-Identifier: Apache-2.0
// Small shared helpers used across the pipeline.

/** Escape text for safe interpolation into HTML (text or double-quoted attrs). */
export function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

/** Serialize a CSS property map into a `prop:val;prop:val` string. */
export function serializeStyle(style: Record<string, string>): string {
  return Object.entries(style)
    .map(([k, v]) => `${k}:${v}`)
    .join(';');
}

/** Expand an anchor spec `"x y w h"` into absolute-position CSS properties. */
export function expandAnchor(spec: string): Record<string, string> {
  const [x, y, w, h] = spec.trim().split(/\s+/);
  const out: Record<string, string> = { position: 'absolute' };
  if (x) out.left = x;
  if (y) out.top = y;
  if (w) out.width = w;
  if (h) out.height = h;
  return out;
}
