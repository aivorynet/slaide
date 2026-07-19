// Copyright 2026 AIVory, Inc.
// SPDX-License-Identifier: Apache-2.0
// Single source of truth for named slide transitions and element entrances.
//
// Design goal: adding an effect = adding ONE catalog entry here. The runtime derives
// CSS classes from the name by convention (`sl-anim-<name>-in/out` for slide
// transitions, `sl-ent-<name>` for element entrances), so no runtime JS edit is
// needed per effect. This module BOTH generates the CSS and exposes the name lists
// surfaced to authors / AI (CLI `slots`, MCP spec) and used for `loud` validation.

export interface SlideTransitionDef {
  /** keyframe body for the entering slide, forward, e.g. "from{opacity:0}to{opacity:1}". */
  enter: string;
  /** keyframe body for the leaving slide, forward. */
  exit: string;
  /** entering-slide keyframe when navigating backward (defaults to `enter`). */
  enterRev?: string;
  /** leaving-slide keyframe when navigating backward (defaults to `exit`). */
  exitRev?: string;
  /** default easing; a per-slide `--transition-ease` overrides it. */
  easing?: string;
  /** z-index of the entering / leaving slide during the transition (default 2 / 1). */
  enterZ?: number;
  exitZ?: number;
}

export interface EntranceDef {
  /** CSS declarations for the pre-reveal (hidden) state, e.g. "opacity:0;transform:translateY(8px)". */
  hidden: string;
  /** optional per-effect default easing (an inline `ease=` overrides it). */
  easing?: string;
  /** optional per-effect default duration in ms (an inline `dur=` overrides it). */
  durationMs?: number;
}

const EASE_SLIDE = 'cubic-bezier(.4,0,.2,1)';
const EASE_ZOOM = 'cubic-bezier(.2,.7,.3,1)';

// ---- slide↔slide transitions ----------------------------------------------
// `none` and `morph` are synthetic (handled directly in the runtime, no CSS).
export const SLIDE_TRANSITIONS: Record<string, SlideTransitionDef> = {
  fade: {
    enter: 'from{opacity:0}to{opacity:1}',
    exit: 'from{opacity:1}to{opacity:0}',
    easing: 'ease',
  },
  dissolve: {
    enter: 'from{opacity:0;filter:blur(6px)}to{opacity:1;filter:blur(0)}',
    exit: 'from{opacity:1;filter:blur(0)}to{opacity:0;filter:blur(6px)}',
    easing: 'ease',
  },
  zoom: {
    enter: 'from{opacity:0;transform:scale(.92)}to{opacity:1;transform:scale(1)}',
    exit: 'from{opacity:1;transform:scale(1)}to{opacity:0;transform:scale(1.06)}',
    easing: EASE_ZOOM,
  },
  'zoom-out': {
    enter: 'from{opacity:0;transform:scale(1.08)}to{opacity:1;transform:scale(1)}',
    exit: 'from{opacity:1;transform:scale(1)}to{opacity:0;transform:scale(.94)}',
    easing: EASE_ZOOM,
  },
  'slide-left': {
    enter: 'from{opacity:0;transform:translateX(6%)}to{opacity:1;transform:none}',
    exit: 'from{opacity:1;transform:none}to{opacity:0;transform:translateX(-6%)}',
    enterRev: 'from{opacity:0;transform:translateX(-6%)}to{opacity:1;transform:none}',
    exitRev: 'from{opacity:1;transform:none}to{opacity:0;transform:translateX(6%)}',
    easing: EASE_SLIDE,
  },
  'slide-right': {
    enter: 'from{opacity:0;transform:translateX(-6%)}to{opacity:1;transform:none}',
    exit: 'from{opacity:1;transform:none}to{opacity:0;transform:translateX(6%)}',
    enterRev: 'from{opacity:0;transform:translateX(6%)}to{opacity:1;transform:none}',
    exitRev: 'from{opacity:1;transform:none}to{opacity:0;transform:translateX(-6%)}',
    easing: EASE_SLIDE,
  },
  'slide-up': {
    enter: 'from{opacity:0;transform:translateY(6%)}to{opacity:1;transform:none}',
    exit: 'from{opacity:1;transform:none}to{opacity:0;transform:translateY(-6%)}',
    enterRev: 'from{opacity:0;transform:translateY(-6%)}to{opacity:1;transform:none}',
    exitRev: 'from{opacity:1;transform:none}to{opacity:0;transform:translateY(6%)}',
    easing: EASE_SLIDE,
  },
  'slide-down': {
    enter: 'from{opacity:0;transform:translateY(-6%)}to{opacity:1;transform:none}',
    exit: 'from{opacity:1;transform:none}to{opacity:0;transform:translateY(6%)}',
    enterRev: 'from{opacity:0;transform:translateY(6%)}to{opacity:1;transform:none}',
    exitRev: 'from{opacity:1;transform:none}to{opacity:0;transform:translateY(-6%)}',
    easing: EASE_SLIDE,
  },
  push: {
    enter: 'from{transform:translateX(100%)}to{transform:none}',
    exit: 'from{transform:none}to{transform:translateX(-100%)}',
    enterRev: 'from{transform:translateX(-100%)}to{transform:none}',
    exitRev: 'from{transform:none}to{transform:translateX(100%)}',
    easing: EASE_SLIDE,
  },
  cover: {
    // the new slide slides in on top; the old one sits still beneath
    enter: 'from{transform:translateX(100%)}to{transform:none}',
    exit: 'from{opacity:1}to{opacity:1}',
    enterRev: 'from{transform:translateX(-100%)}to{transform:none}',
    exitRev: 'from{opacity:1}to{opacity:1}',
    easing: EASE_SLIDE,
  },
  reveal: {
    // the old slide slides away on top, revealing the new one sitting beneath
    enter: 'from{opacity:1}to{opacity:1}',
    exit: 'from{transform:none}to{transform:translateX(-100%)}',
    enterRev: 'from{opacity:1}to{opacity:1}',
    exitRev: 'from{transform:none}to{transform:translateX(100%)}',
    easing: EASE_SLIDE,
    enterZ: 1,
    exitZ: 2,
  },
  flip: {
    enter: 'from{opacity:0;transform:perspective(1200px) rotateY(90deg)}to{opacity:1;transform:perspective(1200px) rotateY(0)}',
    exit: 'from{opacity:1;transform:perspective(1200px) rotateY(0)}to{opacity:0;transform:perspective(1200px) rotateY(-90deg)}',
    enterRev: 'from{opacity:0;transform:perspective(1200px) rotateY(-90deg)}to{opacity:1;transform:perspective(1200px) rotateY(0)}',
    exitRev: 'from{opacity:1;transform:perspective(1200px) rotateY(0)}to{opacity:0;transform:perspective(1200px) rotateY(90deg)}',
    easing: EASE_ZOOM,
  },
  'fade-through-black': {
    // both slides pass through the dark stage backdrop at the midpoint
    enter: 'from{opacity:0}50%{opacity:0}to{opacity:1}',
    exit: 'from{opacity:1}50%{opacity:0}to{opacity:0}',
    easing: 'ease',
  },
};
// aliases (share the same definition; emitted as their own class names)
SLIDE_TRANSITIONS['slide'] = SLIDE_TRANSITIONS['slide-left'];
SLIDE_TRANSITIONS['fade-black'] = SLIDE_TRANSITIONS['fade-through-black'];

// ---- element / build entrances ---------------------------------------------
export const DEFAULT_ENTRANCE = 'fade-up';
export const ENTRANCES: Record<string, EntranceDef> = {
  fade: { hidden: 'opacity:0' },
  'fade-up': { hidden: 'opacity:0;transform:translateY(8px)' },
  'fade-down': { hidden: 'opacity:0;transform:translateY(-8px)' },
  'fade-left': { hidden: 'opacity:0;transform:translateX(-16px)' },
  'fade-right': { hidden: 'opacity:0;transform:translateX(16px)' },
  'slide-in-left': { hidden: 'opacity:0;transform:translateX(-24px)' },
  'slide-in-right': { hidden: 'opacity:0;transform:translateX(24px)' },
  'slide-in-up': { hidden: 'opacity:0;transform:translateY(24px)' },
  'slide-in-down': { hidden: 'opacity:0;transform:translateY(-24px)' },
  'zoom-in': { hidden: 'opacity:0;transform:scale(.9)' },
  'zoom-out': { hidden: 'opacity:0;transform:scale(1.08)' },
  pop: { hidden: 'opacity:0;transform:scale(.6)', easing: 'cubic-bezier(.2,1.5,.4,1)' },
  'blur-in': { hidden: 'opacity:0;filter:blur(8px)' },
  rise: { hidden: 'opacity:0;transform:translateY(40px)' },
  none: { hidden: 'opacity:0', durationMs: 0 },
};

export const SLIDE_TRANSITION_NAMES: string[] = ['none', 'morph', ...Object.keys(SLIDE_TRANSITIONS)];
export const ENTRANCE_NAMES: string[] = Object.keys(ENTRANCES);

export function isSlideTransition(n: string): boolean {
  return n === 'none' || n === 'morph' || Object.prototype.hasOwnProperty.call(SLIDE_TRANSITIONS, n);
}
export function isEntrance(n: string): boolean {
  return Object.prototype.hasOwnProperty.call(ENTRANCES, n);
}

// ---- CSS generators --------------------------------------------------------

function transitionRules(name: string, d: SlideTransitionDef): string {
  const ez = d.enterZ ?? 2;
  const xz = d.exitZ ?? 1;
  const ease = d.easing ?? 'ease';
  const inA = `slk-${name}-in`;
  const outA = `slk-${name}-out`;
  let css =
    `.sl-anim-${name}-in{z-index:${ez};animation:${inA} var(--transition-ms) var(--transition-ease,${ease}) both;}` +
    `.sl-anim-${name}-out{z-index:${xz};animation:${outA} var(--transition-ms) var(--transition-ease,${ease}) both;}` +
    `@keyframes ${inA}{${d.enter}}` +
    `@keyframes ${outA}{${d.exit}}`;
  if (d.enterRev || d.exitRev) {
    const inR = `slk-${name}-in-rev`;
    const outR = `slk-${name}-out-rev`;
    css +=
      `.sl-anim-${name}-in.sl-anim-rev{animation-name:${inR};}` +
      `.sl-anim-${name}-out.sl-anim-rev{animation-name:${outR};}` +
      `@keyframes ${inR}{${d.enterRev ?? d.enter}}` +
      `@keyframes ${outR}{${d.exitRev ?? d.exit}}`;
  }
  return css;
}

/** CSS for a set of slide transitions (defaults to the built-in catalog). */
export function slideTransitionCss(defs: Record<string, SlideTransitionDef> = SLIDE_TRANSITIONS): string {
  return Object.entries(defs)
    .map(([n, d]) => transitionRules(n, d))
    .join('\n');
}

/** CSS for a set of entrances: per-effect hidden state (+ optional easing/duration vars). */
export function entranceCss(defs: Record<string, EntranceDef> = ENTRANCES): string {
  return Object.entries(defs)
    .map(([n, d]) => {
      let css = `.sl-ent-${n}:not(.sl-shown){${d.hidden};}`;
      const vars: string[] = [];
      if (d.easing) vars.push(`--slaide--ent-ease:${d.easing}`);
      if (d.durationMs !== undefined) vars.push(`--slaide--ent-dur:${d.durationMs}ms`);
      if (vars.length) css += `.sl-ent-${n}{${vars.join(';')};}`;
      return css;
    })
    .join('\n');
}

/** Generic build machinery + reduced-motion / print guards. Emitted once. */
export function buildBaseCss(): string {
  return [
    `.sl-build{transition:opacity var(--slaide--ent-dur,.35s) var(--slaide--ent-ease,ease) var(--slaide--ent-delay,0s),` +
      `transform var(--slaide--ent-dur,.35s) var(--slaide--ent-ease,ease) var(--slaide--ent-delay,0s),` +
      `filter var(--slaide--ent-dur,.35s) var(--slaide--ent-ease,ease) var(--slaide--ent-delay,0s);}`,
    // bare `>>>` (no sl-ent-* class) keeps the classic fade-up
    `.sl-build[data-build]:not(.sl-shown):not([class*="sl-ent-"]){opacity:0;transform:translateY(8px);}`,
    `.sl-build.sl-shown{opacity:1;transform:none;filter:none;}`,
    `@media print{.sl-build{opacity:1!important;transform:none!important;filter:none!important;}}`,
    `@media (prefers-reduced-motion: reduce){.sl-slide,.sl-build{animation:none!important;transition:none!important;}}`,
  ].join('\n');
}

// ---- master-defined custom animations --------------------------------------

export interface MasterAnimationDef {
  in?: string;
  out?: string;
  hidden?: string;
  entrance?: boolean;
  duration?: number;
  ease?: string;
}

/** Split a master `animations` map into slide-transition and entrance catalogs. */
export function masterAnimations(
  animations: Record<string, MasterAnimationDef> | undefined,
): { slides: Record<string, SlideTransitionDef>; entrances: Record<string, EntranceDef>; warnings: string[] } {
  const slides: Record<string, SlideTransitionDef> = {};
  const entrances: Record<string, EntranceDef> = {};
  const warnings: string[] = [];
  for (const [name, def] of Object.entries(animations ?? {})) {
    const isEnt = def.entrance || (def.hidden !== undefined && def.in === undefined);
    if (isEnt) {
      if (def.hidden === undefined) {
        warnings.push(`custom entrance "${name}" has no \`hidden\` state; ignored.`);
        continue;
      }
      entrances[name] = { hidden: def.hidden, easing: def.ease, durationMs: def.duration };
    } else {
      if (def.in === undefined || def.out === undefined) {
        warnings.push(`custom transition "${name}" needs both \`in\` and \`out\` keyframes; ignored.`);
        continue;
      }
      slides[name] = { enter: def.in, exit: def.out, easing: def.ease };
    }
  }
  return { slides, entrances, warnings };
}
