import { test, expect } from 'vitest';
import { parseDeck } from '../src/parser/parse.js';
import { compile } from '../src/compiler/compile.js';
import type { Master } from '../src/types.js';

// Code fences must be sigil-safe: a deck's own slaide source shown in a ```code```
// block must NOT be parsed as structure (regions / notes / block splits).
const MASTER: Master = {
  name: 'f',
  layouts: { main: { areas: ['a'], slots: { body: { type: 'body' }, title: { type: 'title' } } } },
};
const HEAD = '---\nmaster: ./m.yaml\n---\nlayout: main\n---\n';

test(':: markers inside a code fence do not split regions', () => {
  const src = HEAD + ':: body ::\nSample:\n\n```\n:: title ::\nHello\n:: sub ::\nWorld\n```';
  const regs = parseDeck(src).slides[0].regions;
  expect(regs.map((r) => r.name)).toEqual(['body']); // no 'title'/'sub' leaked
  expect(regs[0].markdown).toContain(':: title ::');
  expect(regs[0].markdown).toContain(':: sub ::');
});

test('a blank line inside a code fence does not shred it', () => {
  const src = HEAD + ':: body ::\n```\nline one\n\nline three\n```';
  const html = compile(parseDeck(src), MASTER).slides[0].regions[0].html;
  expect((html.match(/<pre>/g) || []).length).toBe(1); // one fenced block, not two
  expect(html).toContain('line one');
  expect(html).toContain('line three');
});

test('??? inside a code fence is not a speaker note', () => {
  const src = HEAD + ':: body ::\n```\n??? not a note\nstill code\n```';
  const ir = compile(parseDeck(src), MASTER);
  expect(ir.slides[0].notes).toBe(null);
  expect(ir.slides[0].regions[0].html).toContain('??? not a note');
});

test('inline spans and images inside a code fence are shown verbatim, not expanded', () => {
  const src = HEAD + ':: body ::\n```\n:: title ::\n[ai]{.accent} and ![x](y.png)\n```';
  const html = compile(parseDeck(src), MASTER).slides[0].regions[0].html;
  expect(html).toContain('[ai]{.accent}'); // span literal, not a <span>
  expect(html).not.toContain('sl-span'); // span class would mean it was expanded
  expect(html).toContain('![x](y.png)'); // image literal, not an <img>
  expect(html).not.toContain('<img'); // image would mean it was expanded
});

test('spans and images outside fences still expand', () => {
  const html = compile(parseDeck(HEAD + ':: body ::\n[ai]{.accent}\n\n![x](y.png)'), MASTER)
    .slides[0].regions[0].html;
  expect(html).toContain('sl-span');
  expect(html).toContain('<img');
});

test('region markers still work normally outside fences', () => {
  const src = HEAD + ':: title ::\nHi\n:: body ::\nThere';
  const regs = parseDeck(src).slides[0].regions;
  expect(regs.map((r) => r.name).sort()).toEqual(['body', 'title']);
});
