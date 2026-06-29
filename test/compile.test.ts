import { test, expect } from 'vitest';
import { parseDeck } from '../src/parser/parse.js';
import { compile } from '../src/compiler/compile.js';
import type { Master } from '../src/types.js';

const MASTER: Master = {
  name: 'tm',
  canvas: { aspect: '16:9', width: 1280, height: 720 },
  typeScale: { base: '20px', ratio: 1.25, steps: { h1: 4, body: 0 } },
  colors: { palette: { ink: '#000', brand: '#0af' }, roles: { background: '{palette.ink}', accent: '{palette.brand}' } },
  backgrounds: { cover: { type: 'solid', color: '#111' } },
  variants: { light: { roles: { background: '#fff', text: '#000' } } },
  transitions: { default: 'fade', duration: 300 },
  layouts: {
    cover: { areas: ['title'], rows: '1fr', background: 'cover', slots: { title: { type: 'title', style: { size: 'h1', color: 'accent' } } } },
    body: { areas: ['body'], rows: '1fr', slots: { body: { type: 'body' } } },
  },
};

function ir(src: string) {
  return compile(parseDeck(src), MASTER);
}

test('resolves tokens, type scale, and color aliases', () => {
  const out = ir(`---\ntitle: t\n---\nlayout: cover\n---\nHi`);
  expect(out.tokens['--size-h1']).toBe('48.83px'); // 20 * 1.25^4
  expect(out.tokens['--color-background']).toBe('#000');
  expect(out.tokens['--color-accent']).toBe('#0af'); // {palette.brand} resolved
});

test('routes default region to the layout primary slot and assigns builds', () => {
  const out = ir(`---\ntitle: t\n---\nlayout: body\n---\n- a >>>\n- b >>>\n- c`);
  const s = out.slides[0];
  expect(s.regions[0].name).toBe('body');
  expect(s.buildCount).toBe(2);
  expect(s.regions[0].html).toContain('data-build="1"');
  expect(s.regions[0].html).toContain('data-build="2"');
});

test('cascade vs scoped frontmatter', () => {
  const out = ir(`---\ntitle: t\n~transition: zoom\n---\nlayout: body\n---\nA\n---\nlayout: body\ntransition: fade\n---\nB\n---\nlayout: body\n---\nC`);
  expect(out.slides[0].transition).toBe('zoom'); // cascaded
  expect(out.slides[1].transition).toBe('fade'); // scoped override
  expect(out.slides[2].transition).toBe('zoom'); // cascade persists
});

test('variant produces scoped CSS var overrides', () => {
  const out = ir(`---\ntitle: t\n---\nlayout: body\nvariant: light\n---\nX`);
  expect(out.slides[0].vars['--color-background']).toBe('#fff');
});

test('video and audio render as media elements; autoplay flag', () => {
  const out = ir(`---\ntitle: t\n---\nlayout: body\n---\n![bg](clip.mp4){.autoplay}\n\n![v](demo.webm){ poster=p.jpg }\n\n![a](song.mp3)`);
  const html = out.slides[0].regions[0].html;
  expect(html).toContain('<video');
  expect(html).toContain('autoplay muted loop');
  expect(html).toContain('poster="p.jpg"');
  expect(html).toContain('<audio');
  expect(html).not.toContain('<img'); // media should not become <img>
});

test('safe embeds: external iframe + sandboxed widget with theme tokens', () => {
  const src = '---\ntitle: t\n---\nlayout: body\n---\n```embed\nhttps://example.com/chart\n```\n\n```widget\n<b>hi</b>\n```';
  const html = ir(src).slides[0].regions[0].html;
  expect(html).toContain('<iframe class="sl-embed"');
  expect(html).toContain('src="https://example.com/chart"');
  expect(html).toContain('sandbox="allow-scripts"'); // widget: no same-origin
  expect(html).toContain('srcdoc=');
  expect(html).toContain('--color-accent'); // theme tokens injected into widget
});

test('background resolves from layout default', () => {
  const out = ir(`---\ntitle: t\n---\nlayout: cover\n---\nHi`);
  expect(out.slides[0].background).toEqual({ type: 'solid', color: '#111' });
});

test('slot color: falls back palette → literal (no invisible text) and warns on unknown names', () => {
  const m: Master = {
    name: 'cm',
    colors: { palette: { ink: '#111' }, roles: { accent: '#0af' } },
    layouts: {
      ok: { areas: ['t'], slots: { t: { type: 'title', style: { color: 'ink' } } } },
      bad: { areas: ['t'], slots: { t: { type: 'title', style: { color: 'nope' } } } },
    },
  };
  const good = compile(parseDeck('---\ntitle: t\n---\nlayout: ok\n---\nHi'), m);
  // a palette name resolves through the fallback chain instead of an undefined var()
  expect(good.slides[0].regions[0].style.color).toBe('var(--color-ink, var(--palette-ink, ink))');
  expect(good.warnings.map((w) => w.code)).not.toContain('unknown-color');

  const bad = compile(parseDeck('---\ntitle: t\n---\nlayout: bad\n---\nHi'), m);
  // a name that resolves to nothing now WARNS — validate can no longer say "valid"
  expect(bad.warnings.map((w) => w.code)).toContain('unknown-color');
  expect(bad.slides[0].regions[0].style.color).toBe('var(--color-nope, var(--palette-nope, nope))');
});

test('layout-bound variant applies; contrast lint catches dark-on-dark text', () => {
  const m: Master = {
    name: 'cm2',
    colors: {
      palette: { ink: '#15120E', cream: '#FBF7F0' },
      roles: { background: '{palette.cream}', text: '{palette.ink}', heading: '{palette.ink}' },
    },
    backgrounds: { night: { type: 'solid', color: '#15120E' } },
    variants: { dark: { roles: { text: '{palette.cream}', heading: '{palette.cream}' } } },
    layouts: {
      // dark background, no bound variant → title uses default (light-variant) ink → invisible
      bad: { areas: ['t'], background: 'night', slots: { t: { type: 'title' } } },
      // same, but binds the dark variant → heading resolves to cream → readable
      good: { areas: ['t'], background: 'night', variant: 'dark', slots: { t: { type: 'title' } } },
    },
  };
  const bad = compile(parseDeck('---\ntitle: t\n---\nlayout: bad\n---\nHi'), m);
  expect(bad.warnings.map((w) => w.code)).toContain('low-contrast');

  const good = compile(parseDeck('---\ntitle: t\n---\nlayout: good\n---\nHi'), m);
  expect(good.warnings.map((w) => w.code)).not.toContain('low-contrast');
  expect(good.slides[0].vars['--color-heading']).toBe('#FBF7F0'); // layout-bound variant applied
});

test('contrast lint is box-aware: dark text on a dark box: panel warns', () => {
  const m: Master = {
    name: 'cm3',
    colors: {
      palette: { ink: '#15120E', cream: '#FBF7F0', night: '#15120E' },
      roles: { background: '{palette.cream}', text: '{palette.ink}', heading: '{palette.ink}' },
    },
    layouts: {
      // a light (cream) slide, but a slot painted as a dark box with default ink text
      card: { areas: ['c'], slots: { c: { type: 'body', style: { box: 'night' } } } },
    },
  };
  const ir = compile(parseDeck('---\ntitle: t\n---\nlayout: card\n---\nHi'), m);
  expect(ir.warnings.map((w) => w.code)).toContain('low-contrast');
});

test('color: accepts a raw hex (emits a literal, not an invalid var(--color-#hex))', () => {
  const m: Master = {
    name: 'hm',
    colors: { palette: { ink: '#000', white: '#fff' }, roles: { background: '{palette.ink}', text: '{palette.white}', heading: '{palette.white}' } },
    layouts: { body: { areas: ['b'], slots: { b: { type: 'body', style: { color: '#ff3366' } } } } },
  };
  const out = compile(parseDeck('---\ntitle: t\n---\nlayout: body\n---\nHi'), m);
  // Previously this became `var(--color-#ff3366, …)` — invalid CSS that dropped the
  // declaration and reverted text to the inherited role. It must now be the literal.
  expect(out.slides[0].regions[0].style['color']).toBe('#ff3366');
});

test('box: accepts a named master gradient (padded, rounded gradient panel)', () => {
  const m: Master = {
    name: 'gm',
    colors: { palette: { navy: '#0B1220', white: '#fff' }, roles: { background: '{palette.navy}', text: '{palette.white}', heading: '{palette.white}' } },
    gradients: { brand: 'linear-gradient(120deg, #1a1a3a 0%, #3b1d5e 100%)' },
    layouts: { closing: { areas: ['card'], slots: { card: { type: 'title', style: { box: 'brand', color: '#ffffff' } } } } },
  };
  const out = compile(parseDeck('---\ntitle: t\n---\nlayout: closing\n---\nHi'), m);
  const st = out.slides[0].regions[0].style;
  expect(st['background']).toBe('var(--gradient-brand)');
  expect(st['padding']).toBe('1.4em 2em');
  expect(st['border-radius']).toBe('16px');
  // dark gradient + white text resolves readable → no contrast warning
  expect(out.warnings.map((w) => w.code)).not.toContain('low-contrast');
});

test('contrast lint is gradient-aware: white text on a light gradient stop warns', () => {
  const m: Master = {
    name: 'gm2',
    colors: { palette: { ink: '#000', white: '#fff' }, roles: { background: '{palette.ink}', text: '{palette.white}', heading: '{palette.white}' } },
    gradients: { sky: 'linear-gradient(120deg, #5B8CFF 0%, #2DD4BF 100%)' }, // teal end is light
    layouts: { closing: { areas: ['card'], slots: { card: { type: 'title', style: { box: 'sky', color: '#ffffff' } } } } },
  };
  const out = compile(parseDeck('---\ntitle: t\n---\nlayout: closing\n---\nHi'), m);
  expect(out.warnings.map((w) => w.code)).toContain('low-contrast');
});

test('non-Google, non-system font warns (won\'t embed → PowerPoint substitutes)', () => {
  const base = {
    name: 'fm',
    colors: { palette: { ink: '#000', white: '#fff' }, roles: { background: '{palette.white}', text: '{palette.ink}', heading: '{palette.ink}' } },
    layouts: { body: { areas: ['b'], slots: { b: { type: 'body' } } } },
  };
  const src = '---\ntitle: t\n---\nlayout: body\n---\nHi';
  const risky = compile(parseDeck(src), { ...base, fonts: { display: { family: 'Brandon Grotesque', provider: 'system' } } } as Master);
  expect(risky.warnings.map((w) => w.code)).toContain('non-embeddable-font');
  // A Google font, and a common system font, are both fine.
  const ok = compile(parseDeck(src), { ...base, fonts: { sans: { family: 'Open Sans', provider: 'google' }, mono: { family: 'Arial', provider: 'system' } } } as Master);
  expect(ok.warnings.map((w) => w.code)).not.toContain('non-embeddable-font');
});
