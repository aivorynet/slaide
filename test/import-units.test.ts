import { test, expect } from 'vitest';
import { normalizeFont, mergeRuns } from '../src/import/pptx.js';

// --- Font-family normalization (weight-named families -> base + numeric weight) ---
test('normalizeFont peels weight/style words to a real web family', () => {
  expect(normalizeFont('Open Sans Extrabold')).toEqual({ family: 'Open Sans', weight: 800, italic: undefined });
  expect(normalizeFont('Open Sans Light')).toEqual({ family: 'Open Sans', weight: 300, italic: undefined });
  expect(normalizeFont('Lato Black')).toEqual({ family: 'Lato', weight: 900, italic: undefined });
  expect(normalizeFont('Montserrat SemiBold Italic')).toEqual({ family: 'Montserrat', weight: 600, italic: true });
  // plain families are untouched
  expect(normalizeFont('Open Sans')).toEqual({ family: 'Open Sans', weight: undefined, italic: undefined });
  expect(normalizeFont('Arial')).toEqual({ family: 'Arial', weight: undefined, italic: undefined });
  // never strip to nothing
  expect(normalizeFont('Bold').family).toBe('Bold');
});

// --- Adjacent run merging (kerning/width fidelity) ---
test('mergeRuns coalesces consecutive same-style runs', () => {
  const runs = [
    { text: '27' }, { text: '/' }, { text: '5' },
    { text: ' x ', bold: true }, { text: 'y', bold: true },
    { text: 'z', br: true },
  ];
  mergeRuns(runs as any);
  expect(runs.map((r: any) => r.text)).toEqual(['27/5', ' x y', 'z']);
});
