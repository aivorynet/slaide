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
    '__SLAIDE_EDITOR__', 'EDITOR_JS', 'sl-edit-overlay', 'sl-insp',
    'collectEdits', 'contenteditable="true"', 'applyPatches',
  ]) {
    expect(h).not.toContain(tok);
  }
});

test('inline bg-image renders on the bg layer with CSS size/position/dim (stretch → 100% 100%)', () => {
  const h = html(`---\nt: t\n---\nlayout: cover\nbg-image: https://x/y.webp\nbg-size: stretch\nbg-position: top\nbg-dim: 0.4\n---\n# Hi`);
  const bg = h.match(/<div class="sl-layer-bg" style="([^"]*)"/)?.[1] ?? '';
  expect(bg).toContain("background-image:url('https://x/y.webp')");
  expect(bg).toContain('background-size:100% 100%'); // stretch alias
  expect(bg).toContain('background-position:top');
  expect(bg).toContain('background-color:rgba(0,0,0,0.4);background-blend-mode:multiply');
});

test('inline bg-image with no options defaults to cover / center / no-repeat and no dim', () => {
  const h = html(`---\nt: t\n---\nlayout: cover\nbg-image: https://x/y.webp\n---\n# Hi`);
  const bg = h.match(/<div class="sl-layer-bg" style="([^"]*)"/)?.[1] ?? '';
  expect(bg).toContain('background-size:cover');
  expect(bg).toContain('background-position:center');
  expect(bg).toContain('background-repeat:no-repeat');
  expect(bg).not.toContain('background-blend-mode'); // no dim
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

// AI-authored masters sometimes put a bare asset URL in `chrome.logo` (meant as an image
// reference) instead of markup — without wrapping it renders as literal on-slide text.
function htmlWithLogo(logo: string) {
  const master: Master = { ...MASTER, chrome: { logo } };
  return renderHtml(compile(parseDeck(`---\nt: t\n---\nlayout: cover\n---\n# Hi`), master), { mode: 'web' });
}

test('chrome.logo: a bare asset URL is auto-wrapped in <img>, not rendered as literal text', () => {
  const h = htmlWithLogo('/api/slaide/assets/1234-uuid/raw');
  expect(h).toContain('<img src="/api/slaide/assets/1234-uuid/raw" alt="">');
  expect(h).not.toContain('>/api/slaide/assets/1234-uuid/raw<'); // not shown as literal text
});

test('chrome.logo: an absolute https URL is also auto-wrapped', () => {
  const h = htmlWithLogo('https://cdn.example.com/logo.png');
  expect(h).toContain('<img src="https://cdn.example.com/logo.png" alt="">');
});

test('chrome.logo: existing markup (svg/img) passes through unchanged', () => {
  const svg = '<svg viewBox="0 0 10 10"><rect width="10" height="10"/></svg>';
  const h = htmlWithLogo(svg);
  expect(h).toContain(`<div class="sl-logo sl-logo-top-left">${svg}</div>`);
});

test('chrome.logo: plain text (a brand wordmark) passes through unchanged', () => {
  const h = htmlWithLogo('Acme');
  expect(h).toContain('<div class="sl-logo sl-logo-top-left">Acme</div>');
});

// { dark, light } logo: picked per slide by its resolved ground (background + variant),
// not by layout/variant NAME — so it also works for a variant nobody named "dark"/"light".
const GROUND_MASTER: Master = {
  name: 'tm',
  canvas: { aspect: '16:9', width: 1280, height: 720 },
  colors: { roles: { background: '#0B0B12' } }, // dark ground by default
  variants: { paper: { roles: { background: '#FFFFFF' } } }, // arbitrarily named light variant
  layouts: { cover: { areas: ['title'], rows: '1fr', slots: { title: { type: 'title' } } } },
  // NB: class names deliberately avoid "logo-dark"/"logo-light" — those collide with an
  // unrelated built-in CSS selector (`.sl-img.logo-dark` etc., for inline markdown images).
  chrome: { logo: { dark: '<svg class="brandmark-dark"/>', light: '<svg class="brandmark-light"/>' } },
};

function irWithGround(src: string) {
  return compile(parseDeck(src), GROUND_MASTER);
}

test('chrome.logo {dark,light}: dark ground (default master background) picks the dark mark', () => {
  const h = renderHtml(irWithGround(`---\nt: t\n---\nlayout: cover\n---\n# Hi`), { mode: 'web' });
  expect(h).toContain('brandmark-dark');
  expect(h).not.toContain('brandmark-light');
});

test('chrome.logo {dark,light}: a light-ground variant picks the light mark, by resolved colour not variant name', () => {
  const h = renderHtml(irWithGround(`---\nt: t\n---\nlayout: cover\nvariant: paper\n---\n# Hi`), { mode: 'web' });
  expect(h).toContain('brandmark-light');
  expect(h).not.toContain('brandmark-dark');
});

test('chrome.logo {dark,light}: one key given is used regardless of ground', () => {
  const master: Master = { ...GROUND_MASTER, chrome: { logo: { dark: '<svg class="brandmark-dark"/>' } } };
  const h = renderHtml(compile(parseDeck(`---\nt: t\n---\nlayout: cover\nvariant: paper\n---\n# Hi`), master), { mode: 'web' });
  expect(h).toContain('brandmark-dark'); // only key defined, used on the light-ground slide too
});
