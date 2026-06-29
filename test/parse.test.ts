import { test, expect } from 'vitest';
import { parseDeck } from '../src/parser/parse.js';

const DECK = `---
master: ./t.yaml
title: T
~transition: zoom
---
layout: cover
---
:: title ::
Hello
:: subtitle ::
World

??? a note
---
## Body slide
- one >>>
- two >>>
`;

test('parses headmatter, slides, regions, builds, notes', () => {
  const d = parseDeck(DECK);
  expect(d.headmatter.title).toBe('T');
  expect(d.headmatter['~transition']).toBe('zoom');
  expect(d.slides.length).toBe(2);

  const s0 = d.slides[0];
  expect(s0.frontmatter.layout).toBe('cover');
  expect(s0.regions.map((r) => r.name).sort()).toEqual(['subtitle', 'title']);
  expect(s0.notes).toBe('a note');

  const s1 = d.slides[1];
  expect(s1.frontmatter.layout).toBeUndefined(); // no frontmatter block
  expect(s1.regions[0].markdown).toContain('## Body slide');
  expect(s1.regions[0].markdown).toContain('one >>>');
});

test('does not split on --- inside fenced code', () => {
  const deck = `---
title: X
---
\`\`\`
---
not a separator
---
\`\`\`
`;
  const d = parseDeck(deck);
  expect(d.slides.length).toBe(1);
});
