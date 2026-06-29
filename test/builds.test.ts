import { test, expect } from 'vitest';
import { renderRegion, type BuildCounter } from '../src/compiler/markdown.js';
import type { Warning } from '../src/types.js';

function render(md: string) {
  const counter: BuildCounter = { n: 0 };
  const warnings: Warning[] = [];
  const { html, builds } = renderRegion(md, counter, {}, warnings, 1);
  return { html, builds, warnings, codes: warnings.map((w) => w.code) };
}

test('a heading directly followed by a build list still applies per-item builds', () => {
  // No blank line between the heading and the list — previously this fused into one block,
  // so isListBlock() was false and every `>>>` rendered literally.
  const { html, builds, codes } = render('### Pull\n- a >>>\n- b >>>\n- c >>>');
  expect(builds).toBe(3);
  expect((html.match(/data-build="/g) ?? []).length).toBe(3);
  expect(html).not.toContain('>>>');
  expect(html).not.toContain('&gt;&gt;&gt;');
  expect(codes).not.toContain('stray-build'); // it's a clean list, nothing stray
  expect(html).toContain('<h3'); // heading still rendered as a heading
});

test('a heading followed by a list WITH a blank line keeps working (regression)', () => {
  const { builds } = render('### Pull\n\n- a >>>\n- b >>>');
  expect(builds).toBe(2);
});

test('a build at the end of a multi-line paragraph is fine (no warning)', () => {
  const { builds, codes } = render('para line one\npara line two >>>');
  expect(builds).toBe(1);
  expect(codes).not.toContain('stray-build');
});

test('a stray ">>>" on a non-final paragraph line warns (caught by validate --strict)', () => {
  const { codes } = render('intro line >>>\nsecond line');
  expect(codes).toContain('stray-build');
});

test('an escaped "\\>>>" on a non-final line is literal and does not warn', () => {
  const { codes, html } = render('show this \\>>>\nmore text');
  expect(codes).not.toContain('stray-build');
  expect(html).toContain('&gt;&gt;&gt;'); // rendered literally
});
