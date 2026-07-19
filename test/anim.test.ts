import { test, expect } from 'vitest';
import { parseDeck } from '../src/parser/parse.js';
import { compile } from '../src/compiler/compile.js';
import { BASE_CSS } from '../src/render/css.js';
import {
  ENTRANCE_NAMES,
  SLIDE_TRANSITION_NAMES,
  entranceCss,
  isEntrance,
  isSlideTransition,
  slideTransitionCss,
} from '../src/render/anim.js';
import type { Master } from '../src/types.js';

const MASTER: Master = {
  name: 'tm',
  canvas: { aspect: '16:9', width: 1280, height: 720 },
  layouts: { body: { areas: ['body'], rows: '1fr', slots: { body: { type: 'body' } } } },
  transitions: { default: 'fade', duration: 300 },
};

function ir(src: string, m: Master = MASTER) {
  return compile(parseDeck(src), m);
}

test('bare >>> keeps the default build (no entrance class)', () => {
  const html = ir(`---\nt: t\n---\nlayout: body\n---\n- a >>>\n- b`).slides[0].regions[0].html;
  expect(html).toContain('class="sl-build" data-build="1"');
  expect(html).not.toContain('sl-ent-');
});

test('>>> <effect> emits a named entrance class', () => {
  const html = ir(`---\nt: t\n---\nlayout: body\n---\n- a >>> zoom-in\n- b >>> slide-in-left`).slides[0].regions[0].html;
  expect(html).toContain('sl-build sl-ent-zoom-in');
  expect(html).toContain('sl-build sl-ent-slide-in-left');
});

test('>>> <effect> delay/dur/ease become inline CSS vars', () => {
  const html = ir(`---\nt: t\n---\nlayout: body\n---\n- a >>> zoom-in delay=150 dur=600 ease=ease-out`).slides[0].regions[0].html;
  expect(html).toContain('--slaide--ent-delay:150ms');
  expect(html).toContain('--slaide--ent-dur:600ms');
  expect(html).toContain('--slaide--ent-ease:ease-out');
});

test('unknown entrance warns and falls back to default', () => {
  const out = ir(`---\nt: t\n---\nlayout: body\n---\n- a >>> nope-fx`);
  const w = out.warnings.find((w) => w.code === 'unknown-entrance');
  expect(w).toBeTruthy();
  expect(out.slides[0].regions[0].html).not.toContain('sl-ent-nope-fx');
});

test('unknown slide transition warns', () => {
  const out = ir(`---\nt: t\n---\nlayout: body\ntransition: bogus\n---\nA`);
  expect(out.warnings.some((w) => w.code === 'unknown-transition')).toBe(true);
});

test('per-slide transition-ms / transition-ease become slide vars', () => {
  const out = ir(`---\nt: t\n---\nlayout: body\ntransition: zoom\ntransition-ms: 600\ntransition-ease: ease-out\n---\nA`);
  expect(out.slides[0].vars['--transition-ms']).toBe('600ms');
  expect(out.slides[0].vars['--transition-ease']).toBe('ease-out');
});

test('master-defined custom animations validate and emit CSS', () => {
  const m: Master = {
    ...MASTER,
    animations: {
      swoop: { in: 'from{opacity:0} to{opacity:1}', out: 'from{opacity:1} to{opacity:0}', duration: 500 },
      glow: { hidden: 'opacity:0;filter:blur(6px)', entrance: true },
    },
  };
  const out = ir(`---\nt: t\n---\nlayout: body\ntransition: swoop\n---\n- a >>> glow`, m);
  expect(out.warnings.some((w) => w.code === 'unknown-transition')).toBe(false);
  expect(out.warnings.some((w) => w.code === 'unknown-entrance')).toBe(false);
  expect(out.animCss).toContain('slk-swoop-in');
  expect(out.animCss).toContain('.sl-ent-glow:not(.sl-shown)');
});

test('catalog: predicates + generated CSS expose effects by name', () => {
  expect(isSlideTransition('flip')).toBe(true);
  expect(isSlideTransition('morph')).toBe(true);
  expect(isSlideTransition('nope')).toBe(false);
  expect(isEntrance('zoom-in')).toBe(true);
  expect(SLIDE_TRANSITION_NAMES).toContain('push');
  expect(ENTRANCE_NAMES).toContain('blur-in');
  // directional transitions provide a reverse variant for backward navigation
  expect(slideTransitionCss()).toContain('.sl-anim-slide-left-out.sl-anim-rev');
  expect(entranceCss()).toContain('.sl-ent-pop:not(.sl-shown)');
});

test('BASE_CSS includes the generated transition + build machinery', () => {
  expect(BASE_CSS).toContain('.sl-anim-flip-in{');
  expect(BASE_CSS).toContain('@keyframes slk-fade-in{');
  expect(BASE_CSS).toContain(':not([class*="sl-ent-"])'); // default fade-up guard
  expect(BASE_CSS).toContain('prefers-reduced-motion');
});
