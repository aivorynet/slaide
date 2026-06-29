import { test, expect } from 'vitest';
import { parseDeck } from '../src/parser/parse.js';
import { compile } from '../src/compiler/compile.js';
import { renderHtml } from '../src/render/html.js';
import type { Master } from '../src/types.js';

const MASTER: Master = {
  name: 'tm',
  canvas: { aspect: '16:9', width: 1280, height: 720 },
  layouts: { content: { areas: ['body'], rows: '1fr', slots: { body: { type: 'body' } } } },
};

const lines = (...l: string[]) => l.join('\n');
const deck = (...body: string[]) => lines('---', 't: t', '---', 'layout: content', '---', ...body);

function ir(src: string, master: Master = MASTER) {
  return compile(parseDeck(src), master);
}
function html(src: string, master: Master = MASTER) {
  return renderHtml(ir(src, master), { mode: 'web' });
}
function b64(html: string, attr: 'data-graph' | 'data-option'): string {
  const m = html.match(new RegExp(`${attr}="([^"]+)"`));
  return m ? Buffer.from(m[1], 'base64').toString('utf8') : '';
}

test('```mermaid compiles to pre.sl-mermaid with the diagram base64 in data-graph', () => {
  const h = html(deck('```mermaid', 'flowchart LR', 'A[Start] --> B[End]', '```'));
  expect(h).toContain('class="sl-chart sl-mermaid"');
  expect(h).toContain('data-graph="');
  const decoded = b64(h, 'data-graph');
  expect(decoded).toContain('flowchart LR');
  expect(decoded).toContain('A[Start] --> B[End]'); // labels survive the inline passes
});

test('```echart (JSON) compiles to div.sl-echart with the option base64 in data-option', () => {
  const d = ir(deck('```echart', '{ "series": [ { "type": "bar", "data": [1, 2, 3] } ] }', '```'));
  expect(d.warnings.some((w) => w.code === 'bad-chart')).toBe(false);
  const h = renderHtml(d, { mode: 'web' });
  expect(h).toContain('class="sl-chart sl-echart"');
  const opt = JSON.parse(b64(h, 'data-option'));
  expect(opt.series[0].type).toBe('bar');
});

test('```echart accepts YAML too', () => {
  const d = ir(deck('```echart', 'series:', '  - type: line', '    data: [1, 2]', '```'));
  expect(d.warnings.some((w) => w.code === 'bad-chart')).toBe(false);
  const h = renderHtml(d, { mode: 'web' });
  const opt = JSON.parse(b64(h, 'data-option'));
  expect(opt.series[0].type).toBe('line');
});

test('a malformed ```echart warns (bad-chart) and falls back to a code block, not a chart', () => {
  const d = ir(deck('```echart', '[1, 2', '```')); // unterminated flow sequence → YAML error
  expect(d.warnings.some((w) => w.code === 'bad-chart')).toBe(true);
  // class name lives in the CSS regardless; assert the chart *element* isn't emitted.
  expect(renderHtml(d, { mode: 'web' })).not.toContain('class="sl-chart sl-echart"');
});

test('a non-object ```echart body warns and does not render a chart', () => {
  const d = ir(deck('```echart', '42', '```'));
  expect(d.warnings.some((w) => w.code === 'bad-chart')).toBe(true);
  expect(renderHtml(d, { mode: 'web' })).not.toContain('class="sl-chart sl-echart"');
});

test('chart engines are inlined only when used, and only the engine(s) present', () => {
  const mermaidOnly = html(deck('```mermaid', 'flowchart TD', 'A-->B', '```'));
  expect(mermaidOnly).toContain('id="sl-mermaid-lib"');
  expect(mermaidOnly).toContain('__slaideCharts');
  expect(mermaidOnly).not.toContain('id="sl-echart-lib"');

  const echartOnly = html(deck('```echart', '{ "series": [] }', '```'));
  expect(echartOnly).toContain('id="sl-echart-lib"');
  expect(echartOnly).not.toContain('id="sl-mermaid-lib"');

  const noCharts = html(deck('# Just text'));
  expect(noCharts).not.toContain('sl-mermaid-lib');
  expect(noCharts).not.toContain('sl-echart-lib');
  expect(noCharts).not.toContain('__slaideCharts');
});

test('position indicator: on by default, hidden by master ui.progress=false', () => {
  const on = html(deck('# Hi'));
  expect(on).toContain('<div class="sl-progress">');
  expect(on).toContain('<div class="sl-counter">'); // no footer in this master → counter shows

  const off = html(deck('# Hi'), { ...MASTER, ui: { progress: false } });
  expect(off).not.toContain('<div class="sl-progress">');
  expect(off).not.toContain('<div class="sl-counter">');
});

test('headmatter progress: overrides the master ui.progress default', () => {
  const masterOff: Master = { ...MASTER, ui: { progress: false } };
  const forcedOn = renderHtml(
    compile(parseDeck(lines('---', 't: t', 'progress: true', '---', 'layout: content', '---', '# Hi')), masterOff),
    { mode: 'web' },
  );
  expect(forcedOn).toContain('<div class="sl-progress">');

  const forcedOff = renderHtml(
    compile(parseDeck(lines('---', 't: t', 'progress: false', '---', 'layout: content', '---', '# Hi')), MASTER),
    { mode: 'web' },
  );
  expect(forcedOff).not.toContain('<div class="sl-progress">');
});
