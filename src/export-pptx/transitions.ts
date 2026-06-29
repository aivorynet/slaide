// Copyright 2026 AIVory, Inc.
// SPDX-License-Identifier: Apache-2.0
// Slaide slide-transition name -> OOXML <p:transition> XML.
//
// pptxgenjs has no transition API, so the .pptx is post-processed (see inject-anim.ts):
// the generated slide XML gets a <p:transition> child injected after <p:clrMapOvr>. This
// module is the pure, browserless mapping that turns a Slaide transition name (the same
// names authors use in `transition:` and that live in render/anim.ts) into the matching
// PowerPoint transition element.
//
// PowerPoint transition speed is the legacy three-bucket `spd` (slow|med|fast); we map the
// deck's transition duration onto it. We deliberately avoid the p14:dur millisecond
// extension to keep every slide schema-clean and free of repair prompts in PowerPoint.

export interface TransitionXmlOpts {
  /** per-slide --transition-ms (else the deck default). Mapped to the spd bucket. */
  durationMs?: number;
  /** collapse approximated effects (zoom/flip/morph) to a plain fade for maximum portability. */
  safe?: boolean;
}

/** Map a duration in ms onto PowerPoint's legacy transition-speed bucket. */
export function speedBucket(ms: number | undefined): 'slow' | 'med' | 'fast' {
  if (!ms || ms <= 0) return 'med';
  if (ms <= 300) return 'fast';
  if (ms <= 600) return 'med';
  return 'slow';
}

// Slaide name -> the single CT_SlideTransition child element. `null` means "no transition"
// (the `none` keyword); unknown names fall back to a plain fade.
const CHILD: Record<string, string> = {
  fade: '<p:fade/>',
  dissolve: '<p:dissolve/>',
  'fade-through-black': '<p:fade thruBlk="1"/>',
  'fade-black': '<p:fade thruBlk="1"/>',
  'slide-left': '<p:push dir="l"/>',
  slide: '<p:push dir="l"/>',
  'slide-right': '<p:push dir="r"/>',
  'slide-up': '<p:push dir="u"/>',
  'slide-down': '<p:push dir="d"/>',
  push: '<p:push dir="l"/>',
  cover: '<p:cover dir="l"/>',
  reveal: '<p:pull dir="l"/>',
  zoom: '<p:zoom dir="in"/>',
  'zoom-out': '<p:zoom dir="out"/>',
  flip: '<p:fade/>', // OOXML has no legacy "flip" transition; fade is the closest portable match
};

// Effects with no faithful legacy equivalent; collapsed to fade when `safe`.
const APPROX = new Set(['zoom', 'zoom-out', 'flip', 'morph']);

/** The inner transition element for a name (e.g. `<p:fade/>`); `null` for `none`. */
export function transitionChildXml(name: string, safe = false): string | null {
  const n = (name || '').trim();
  if (!n || n === 'none') return null;
  if (n === 'morph') return safe ? '<p:fade/>' : null; // morph handled by transitionXml (needs mc:AlternateContent)
  if (safe && APPROX.has(n)) return '<p:fade/>';
  return CHILD[n] ?? '<p:fade/>';
}

const MC_NS = 'http://schemas.openxmlformats.org/markup-compatibility/2006';
const P159_NS = 'http://schemas.microsoft.com/office/powerpoint/2015/09/main';

/** Real "morph" needs the p159 namespace inside mc:AlternateContent, with a fade fallback. */
function morphXml(spd: string): string {
  return (
    `<mc:AlternateContent xmlns:mc="${MC_NS}">` +
    `<mc:Choice xmlns:p159="${P159_NS}" Requires="p159">` +
    `<p:transition spd="${spd}"><p159:morph option="byObject"/></p:transition>` +
    `</mc:Choice>` +
    `<mc:Fallback><p:transition spd="${spd}"><p:fade/></p:transition></mc:Fallback>` +
    `</mc:AlternateContent>`
  );
}

/**
 * Full slide-transition markup to inject after <p:clrMapOvr>. Returns '' for `none`
 * (no transition element), the mc:AlternateContent block for `morph`, otherwise a plain
 * `<p:transition spd="...">{child}</p:transition>`.
 */
export function transitionXml(name: string, opts: TransitionXmlOpts = {}): string {
  const n = (name || '').trim();
  if (!n || n === 'none') return '';
  const spd = speedBucket(opts.durationMs);
  if (n === 'morph' && !opts.safe) return morphXml(spd);
  const child = transitionChildXml(n, opts.safe) ?? '<p:fade/>';
  return `<p:transition spd="${spd}">${child}</p:transition>`;
}
