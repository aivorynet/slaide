import { test, expect, describe } from 'vitest';
import { parseDeck } from '../src/parser/parse.js';
import { compile } from '../src/compiler/compile.js';
import type { Master } from '../src/types.js';

const MASTER: Master = {
  name: 't',
  colors: { palette: { brand: '#5B8CFF' }, roles: { text: '#fff', accent: '{palette.brand}', muted: '#888' } },
  gradients: { brand: 'linear-gradient(90deg,#000,#fff)' },
  layouts: { main: { areas: ['a'], slots: { body: { type: 'body' }, title: { type: 'title' } } } },
};

const HEAD = '---\nmaster: ./m.yaml\n---\n';
function build(body: string): { codes: string[]; ir: ReturnType<typeof compile> } {
  const ir = compile(parseDeck(HEAD + 'layout: main\n---\n' + body), MASTER);
  return { codes: ir.warnings.map((w) => w.code), ir };
}

describe('grammar diagnostics', () => {
  test('#1 unknown inline class warns; known classes do not', () => {
    expect(build(':: body ::\n[Big]{.xxlarge}').codes).toContain('unknown-class');
    for (const ok of ['.accent', '.brand', '.tomato', '.lg', '.bold', '.muted', '.#ff0000']) {
      expect(build(`:: body ::\n[x]{${ok}}`).codes).not.toContain('unknown-class');
    }
  });

  test('#1 unknown gradient warns; known gradient does not', () => {
    expect(build(':: body ::\n[x]{.grad-nope}').codes).toContain('unknown-gradient');
    expect(build(':: body ::\n[x]{.grad-brand}').codes).not.toContain('unknown-gradient');
    expect(build(':: body ::\n[x]{.grad}').codes).not.toContain('unknown-gradient');
  });

  test('#3 misrouted region warns even when empty', () => {
    expect(build(':: nope ::\nhello').codes).toContain('unknown-slot');
    expect(build(':: nope ::').codes).toContain('unknown-slot');
    expect(build(':: body ::\nhello').codes).not.toContain('unknown-slot');
  });

  test('#2 config-shaped body eaten as frontmatter warns', () => {
    const src = HEAD + 'layout: main\n---\n:: body ::\nFirst\n---\nName: Acme\nFounded: 2021\n---\n:: body ::\nThird';
    const ir = compile(parseDeck(src), MASTER);
    expect(ir.warnings.map((w) => w.code)).toContain('ambiguous-frontmatter');
    // a real frontmatter block (known keys) does NOT warn
    expect(build(':: body ::\nok').codes).not.toContain('ambiguous-frontmatter');
  });

  test('#5 malformed YAML frontmatter warns instead of silently defaulting', () => {
    const src = HEAD + 'foo: bar: baz\n---\n:: body ::\nx';
    expect(parseDeck(src).warnings.map((w) => w.code)).toContain('bad-config');
  });
});

describe('sigil escaping (#4)', () => {
  test('\\>>> is a literal, not a build step', () => {
    const { ir } = build(':: body ::\n- item \\>>>');
    expect(ir.slides[0].buildCount).toBe(0);
    expect(JSON.stringify(ir.slides[0].regions)).toContain('&gt;&gt;&gt;');
  });
  test('\\:: name :: is literal body, not a region marker', () => {
    const { ir } = build(':: body ::\n\\:: title ::\ntext');
    // no 'title' region was created; the line is body content
    expect(ir.slides[0].regions.every((r) => r.name !== 'title')).toBe(true);
    expect(JSON.stringify(ir.slides[0].regions)).toContain(':: title ::');
  });
  test('\\??? is literal body, not a speaker note', () => {
    const ir = compile(parseDeck(HEAD + 'layout: main\n---\n:: body ::\n\\??? not a note'), MASTER);
    expect(ir.slides[0].notes).toBe(null);
    expect(JSON.stringify(ir.slides[0].regions)).toContain('??? not a note');
  });
  test('\\[x]{.y} renders the literal span syntax', () => {
    const { ir, codes } = build(':: body ::\n\\[x]{.xxlarge}');
    expect(JSON.stringify(ir.slides[0].regions)).toContain('[x]{.xxlarge}');
    expect(codes).not.toContain('unknown-class'); // escaped → not validated
  });
});
