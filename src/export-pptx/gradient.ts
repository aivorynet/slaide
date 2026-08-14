// Copyright 2026 AIVory, Inc.
// SPDX-License-Identifier: Apache-2.0
// CSS gradient -> DrawingML <a:gradFill>.
//
// pptxgenjs can only fill a shape with one solid colour, so a slot styled
// `bg: linear-gradient(90deg, var(--color-accent) 0 8px, #16283C 8px)` (a card with an
// accent rail) exported as a flat wash of its FIRST stop — the whole card painted accent
// blue, text unreadable. We parse the COMPUTED gradient (var()s resolved, lengths in px)
// into stops and emit a real <a:gradFill>, spliced into the shape in post-process (see
// inject-anim.ts) so the card stays a native, editable PowerPoint shape.

interface Stop {
  color: string; // RRGGBB
  alpha: number; // 0..1
  pos: number | null; // 0..1 along the gradient line (null = not authored)
}

/** Split on top-level commas (nested rgb()/calc() parens stay intact). */
function splitArgs(s: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let cur = '';
  for (const ch of s) {
    if (ch === '(') depth++;
    else if (ch === ')') depth--;
    if (ch === ',' && depth === 0) {
      out.push(cur.trim());
      cur = '';
    } else cur += ch;
  }
  if (cur.trim()) out.push(cur.trim());
  return out;
}

/** `rgb(r,g,b)` / `rgba(r,g,b,a)` / `#rgb` / `#rrggbb` -> hex + alpha (null if unparsable). */
function parseColor(s: string): { color: string; alpha: number } | null {
  const t = s.trim();
  const hex = t.match(/^#([0-9a-f]{3}|[0-9a-f]{6}|[0-9a-f]{8})$/i);
  if (hex) {
    let h = hex[1];
    if (h.length === 3) h = h[0] + h[0] + h[1] + h[1] + h[2] + h[2];
    const alpha = h.length === 8 ? parseInt(h.slice(6, 8), 16) / 255 : 1;
    return { color: h.slice(0, 6).toUpperCase(), alpha };
  }
  const fn = t.match(/^rgba?\(([^)]+)\)$/i);
  if (!fn) return null;
  const parts = fn[1].split(/[\s,/]+/).filter(Boolean).map((p) => parseFloat(p));
  if (parts.length < 3 || parts.some((n) => !isFinite(n))) return null;
  const [r, g, b] = parts;
  const alpha = parts.length >= 4 ? Math.max(0, Math.min(1, parts[3])) : 1;
  const hx = (n: number) => Math.max(0, Math.min(255, Math.round(n))).toString(16).padStart(2, '0');
  return { color: (hx(r) + hx(g) + hx(b)).toUpperCase(), alpha };
}

/** `to right` / `135deg` / `0.5turn` -> CSS degrees (0 = to top, clockwise). */
function parseAngle(s: string, w: number, h: number): number | null {
  const t = s.trim().toLowerCase();
  const deg = t.match(/^(-?[\d.]+)(deg|grad|rad|turn)$/);
  if (deg) {
    const n = parseFloat(deg[1]);
    if (deg[2] === 'grad') return n * 0.9;
    if (deg[2] === 'rad') return (n * 180) / Math.PI;
    if (deg[2] === 'turn') return n * 360;
    return n;
  }
  if (!t.startsWith('to ')) return null;
  const side = t.slice(3).trim();
  const KEY: Record<string, number> = { top: 0, right: 90, bottom: 180, left: 270 };
  if (KEY[side] !== undefined) return KEY[side];
  // corner: the gradient line is perpendicular to the opposite diagonal
  const a = (Math.atan2(w, h) * 180) / Math.PI;
  const CORNER: Record<string, number> = {
    'top right': a,
    'right top': a,
    'bottom right': 180 - a,
    'right bottom': 180 - a,
    'bottom left': 180 + a,
    'left bottom': 180 + a,
    'top left': 360 - a,
    'left top': 360 - a,
  };
  return CORNER[side.replace(/\s+/g, ' ')] ?? null;
}

/** Length of the CSS gradient line for `angle` across a w x h box. */
function lineLength(angleDeg: number, w: number, h: number): number {
  const r = (angleDeg * Math.PI) / 180;
  return Math.abs(w * Math.sin(r)) + Math.abs(h * Math.cos(r));
}

/** Fill in unauthored stop positions the way CSS does: ends pinned, gaps spread evenly. */
function resolvePositions(stops: Stop[]): void {
  if (stops[0].pos === null) stops[0].pos = 0;
  if (stops[stops.length - 1].pos === null) stops[stops.length - 1].pos = 1;
  let i = 0;
  while (i < stops.length) {
    if (stops[i].pos !== null) {
      i++;
      continue;
    }
    let j = i;
    while (stops[j].pos === null) j++;
    const from = stops[i - 1].pos as number;
    const to = stops[j].pos as number;
    for (let k = i; k < j; k++) stops[k].pos = from + ((to - from) * (k - i + 1)) / (j - i + 1);
    i = j + 1;
  }
  // CSS clamps a stop to the largest preceding one, so positions never run backwards
  for (let k = 1; k < stops.length; k++) {
    stops[k].pos = Math.max(stops[k].pos as number, stops[k - 1].pos as number);
  }
}

function gsXml(s: Stop, pos: number): string {
  const clr =
    s.alpha < 1
      ? `<a:srgbClr val="${s.color}"><a:alpha val="${Math.round(s.alpha * 100000)}"/></a:srgbClr>`
      : `<a:srgbClr val="${s.color}"/>`;
  return `<a:gs pos="${pos}">${clr}</a:gs>`;
}

/**
 * Build an `<a:gradFill>` for a COMPUTED CSS gradient painted on a `w` x `h` px box.
 * Returns null for anything we cannot map faithfully (radial/conic, unparsable colours) —
 * the caller then keeps pptxgenjs's solid first-stop fill.
 */
export function gradFillXml(css: string, w: number, h: number): string | null {
  if (!css || w <= 0 || h <= 0) return null;
  // A computed background-image can list several layers; only the first (topmost) paints
  // on an opaque base, and a shape has exactly one fill — take it.
  const m = css.match(/(repeating-)?linear-gradient\(([\s\S]*)/i);
  if (!m) return null;
  // slice the balanced argument list out of the match
  let depth = 1;
  let body = '';
  for (const ch of m[2]) {
    if (ch === '(') depth++;
    else if (ch === ')') {
      depth--;
      if (!depth) break;
    }
    body += ch;
  }
  const args = splitArgs(body);
  if (args.length < 2) return null;

  let angle = 180; // CSS default: to bottom
  const head = parseAngle(args[0], w, h);
  if (head !== null) args.shift();
  if (head !== null) angle = head;
  const len = lineLength(angle, w, h) || 1;

  const stops: Stop[] = [];
  for (const arg of args) {
    // `<color> [<pos>] [<pos>]` — the two-position form is shorthand for two stops. The colour
    // is one token even though `rgb(85, 174, 234)` contains spaces, so peel it off by shape.
    const split = arg.match(/^\s*([a-z]+\([^)]*\)|#[0-9a-f]{3,8}|[a-z]+)\s*([\s\S]*)$/i);
    const parts = split ? split[2].split(/\s+/).filter(Boolean) : [];
    const col = parseColor(split ? split[1] : '');
    if (!col) {
      // colour functions we don't parse (color-mix, lab(), a named colour) — bail out
      // rather than emit a wrong-looking gradient.
      return null;
    }
    const toFrac = (p: string): number | null => {
      if (/%$/.test(p)) return parseFloat(p) / 100;
      if (/px$/.test(p)) return parseFloat(p) / len;
      const n = parseFloat(p);
      return isFinite(n) && n === 0 ? 0 : null;
    };
    const positions = parts.map(toFrac).filter((p): p is number => p !== null);
    if (!positions.length) stops.push({ ...col, pos: null });
    else for (const p of positions) stops.push({ ...col, pos: p });
  }
  if (stops.length < 2) return null;
  resolvePositions(stops);
  // CSS extends the end colours past the last stop; DrawingML interpolates only between the
  // stops it is given, so pin both ends (`accent 0 6px, panel 6px` needs the panel colour
  // repeated at 100% or PowerPoint fades it away across the card).
  if ((stops[0].pos as number) > 0) stops.unshift({ ...stops[0], pos: 0 });
  const tail = stops[stops.length - 1];
  if ((tail.pos as number) < 1) stops.push({ ...tail, pos: 1 });

  // DrawingML wants strictly increasing positions in 1/1000 %; a CSS hard stop (two stops
  // at the same offset) becomes a 0.001% ramp, which reads as a hard edge.
  let last = -1;
  const gs = stops
    .map((s) => {
      let pos = Math.round(Math.max(0, Math.min(1, s.pos as number)) * 100000);
      if (pos <= last) pos = last + 1;
      last = pos;
      return gsXml(s, Math.min(pos, 100000));
    })
    .join('');
  // CSS 0deg points up and turns clockwise; DrawingML 0 points right and turns clockwise.
  const ang = Math.round((((angle - 90) % 360) + 360) % 360) * 60000;
  return `<a:gradFill flip="none" rotWithShape="1"><a:gsLst>${gs}</a:gsLst><a:lin ang="${ang}" scaled="0"/></a:gradFill>`;
}
