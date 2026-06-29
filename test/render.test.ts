import { test, expect } from 'vitest';
import { parseDeck } from '../src/parser/parse.js';
import { compile } from '../src/compiler/compile.js';
import { renderHtml } from '../src/render/html.js';
import type { Master } from '../src/types.js';

const MASTER: Master = {
  name: 'tm',
  canvas: { aspect: '16:9', width: 1280, height: 720 },
  layouts: { cover: { areas: ['title'], rows: '1fr', slots: { title: { type: 'title' } } } },
};

function html(src: string) {
  return renderHtml(compile(parseDeck(src), MASTER), { mode: 'web' });
}

// The open-source engine is presentation-only. This guards the paywall boundary:
// no editing code, hook, CSS, or flag may appear in the rendered output.
test('render is presentation-only and leak-free (no editing surface)', () => {
  const h = html(`---\nt: t\n---\nlayout: cover\n---\n# Hi`);
  expect(h).toContain('sl-present-toggle'); // present-mode toggle present
  for (const tok of [
    '__SLAIDE_EDITOR__', 'EDITOR_JS', 'sl-editing', 'sl-edit-overlay', 'sl-insp',
    'collectEdits', 'contenteditable="true"', 'applyPatches',
  ]) {
    expect(h).not.toContain(tok);
  }
});

test('regions carry data-source-region (source-provenance for round-tripping)', () => {
  // bare content → routed to the primary slot `title`, but its SOURCE region is `default`
  const ir = compile(parseDeck(`---\nt: t\n---\nlayout: cover\n---\n# Hi`), MASTER);
  const h = renderHtml(ir, { mode: 'web' });
  expect(h).toContain('data-region="title"');
  expect(h).toContain('data-source-region="default"');
});

test('the built-in `free` region renders as a full-slide shape layer (no warning)', () => {
  const ir = compile(
    parseDeck(`---\nt: t\n---\nlayout: cover\n---\n# Hi\n\n:: free ::\n<div class="sl-shape" data-shape="rect" style="left:10%;top:20%;width:30%;height:18%"></div>`),
    MASTER,
  );
  expect(ir.warnings.some((w) => w.code === 'unknown-slot')).toBe(false);
  const h = renderHtml(ir, { mode: 'web' });
  expect(h).toContain('sl-layer-free" data-region="free"');
  expect(h).toContain('data-shape="rect"');
});

test('first slide images load eagerly; later slides lazily', () => {
  const h = html(`---\nt: t\n---\nlayout: cover\n---\n# A\n![a](a.png)\n---\nlayout: cover\n---\n# B\n![b](b.png)`);
  expect(h).toContain('loading="eager"'); // slide 0
  expect(h).toContain('loading="lazy"'); // slide 1
});
