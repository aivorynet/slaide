// Copyright 2026 AIVory, Inc.
// SPDX-License-Identifier: Apache-2.0
// Deck parser: a .slaide file -> ParsedDeck (AST).
//
// Format (deterministic, no configurable separators):
//   ---                         leading fence
//   <deck headmatter (config)>  the one place for deck-wide config
//   ---
//   <slide frontmatter?>        optional, config-like, fenced
//   ---
//   <slide body>                markdown + `:: region ::` + `>>>` + `??? notes`
//   ---                         slide separator
//   ...
//
// A fenced block after a separator is treated as the next slide's *frontmatter*
// iff it is config-like AND another fence follows; otherwise it is the body.

import { FENCE, isConfigLike, parseConfig } from './frontmatter.js';
import type { ParsedDeck, ParsedRegion, ParsedSlide, Warning } from '../types.js';

interface Segment {
  text: string;
  line: number; // 1-based line where the segment's content begins
}

const CODE_FENCE = /^\s*(```|~~~)/;

function splitSegments(content: string): Segment[] {
  const lines = content.split(/\r?\n/);
  const segments: Segment[] = [];
  let buf: string[] = [];
  let start = 1;
  let inCode = false;
  lines.forEach((line, i) => {
    if (CODE_FENCE.test(line)) inCode = !inCode;
    if (!inCode && FENCE.test(line)) {
      segments.push({ text: buf.join('\n'), line: start });
      buf = [];
      start = i + 2; // next line, 1-based
    } else {
      buf.push(line);
    }
  });
  segments.push({ text: buf.join('\n'), line: start });
  return segments;
}

const REGION_RE = /^::\s*([\w-]+)\s*::\s*$/;

// Keys that legitimately appear in slide frontmatter. Used only to detect a
// config-shaped *body* mistakenly eaten as frontmatter (see ambiguous-frontmatter).
// Exported as the canonical frontmatter-key set (see src/vocab.ts).
export const KNOWN_SLIDE_KEYS = new Set([
  'layout', 'background', 'transition', 'transition-ms', 'transition-ease', 'variant', 'chrome', 'footer', 'logo', 'morph', 'notes', 'progress',
  // Inline per-slide image background (full-bleed photo BEHIND the grid; no master entry needed).
  'bg-image', 'bg-size', 'bg-position', 'bg-repeat', 'bg-dim',
  'title', 'author', 'company', 'date', 'subtitle',
]);

// A line that looks like an attempted region marker (starts `::` then non-space)
// but doesn't match REGION_RE — e.g. `::num` (no spaces) or `:: num :: x` (trailing
// content). Used only to lint; REGION_RE itself still decides actual routing.
const NEAR_MISS_REGION_RE = /^::\s*\S/;

/** Split a slide body into regions and extract speaker notes. The `::` region
 *  markers, `??? notes`, and the build/blank-line splitting are all suppressed
 *  inside fenced code blocks (```/~~~) so a deck's own slaide source can be shown
 *  verbatim in a code sample without being parsed as structure. `warnings`/`line`
 *  (if provided) collect a lint for a near-miss region marker that would otherwise
 *  fall through silently as literal body text. */
function parseBody(text: string, warnings?: Warning[], srcLine?: number): { regions: ParsedRegion[]; notes: string | null } {
  const lines = text.split('\n');
  const noteChunks: string[] = [];
  const kept: string[] = [];

  // First pass: pull out `??? ...` note blocks (continue until a blank line) —
  // but never while inside a fenced code block.
  let inCode = false;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (CODE_FENCE.test(line)) {
      inCode = !inCode;
      kept.push(line);
      continue;
    }
    if (inCode) {
      kept.push(line);
      continue;
    }
    // `\??? …` escapes a literal triple-question-mark line into the body.
    if (/^\\\?\?\?/.test(line)) {
      kept.push(line.slice(1));
      continue;
    }
    const m = line.match(/^\?\?\?\s?(.*)$/);
    if (m) {
      const chunk = [m[1]];
      let j = i + 1;
      while (
        j < lines.length &&
        lines[j].trim() !== '' &&
        !REGION_RE.test(lines[j]) &&
        !CODE_FENCE.test(lines[j])
      ) {
        chunk.push(lines[j]);
        j++;
      }
      noteChunks.push(chunk.join('\n').trim());
      i = j - 1;
      continue;
    }
    kept.push(line);
  }

  // Second pass: route remaining lines into regions — again, fence-aware.
  const regions: ParsedRegion[] = [];
  let current: { name: string; lines: string[] } = { name: 'default', lines: [] };
  const flush = () => {
    const md = current.lines.join('\n').trim();
    if (md !== '' || current.name !== 'default') {
      regions.push({ name: current.name, markdown: md });
    }
  };
  inCode = false;
  for (const line of kept) {
    if (CODE_FENCE.test(line)) {
      inCode = !inCode;
      current.lines.push(line);
      continue;
    }
    if (!inCode && /^\\::/.test(line)) {
      // `\:: name ::` escapes a literal region-marker-looking line into the body.
      current.lines.push(line.slice(1));
      continue;
    }
    const m = inCode ? null : line.match(REGION_RE);
    if (m) {
      flush();
      current = { name: m[1], lines: [] };
    } else {
      if (!inCode && warnings && NEAR_MISS_REGION_RE.test(line)) {
        warnings.push({
          code: 'bad-region',
          message: `malformed region marker: '${line.trim()}' — expected ':: name ::' alone on its line`,
          line: srcLine,
        });
      }
      current.lines.push(line);
    }
  }
  flush();

  return {
    regions: regions.length ? regions : [{ name: 'default', markdown: '' }],
    notes: noteChunks.length ? noteChunks.join('\n\n') : null,
  };
}

export function parseDeck(content: string): ParsedDeck {
  const warnings: Warning[] = [];
  const segments = splitSegments(content);

  // Drop a leading empty segment (file begins with `---`).
  let idx = 0;
  if (segments.length && segments[0].text.trim() === '') idx = 1;

  // Headmatter: the first non-empty segment, if it is config-like.
  let headmatter: Record<string, unknown> = {};
  if (idx < segments.length && isConfigLike(segments[idx].text)) {
    const line = segments[idx].line;
    headmatter = parseConfig(segments[idx].text, (msg) =>
      warnings.push({ code: 'bad-config', message: `Deck headmatter is not valid YAML (rendered with defaults): ${msg}`, line }),
    );
    idx++;
  } else {
    warnings.push({
      code: 'no-headmatter',
      message: 'No deck headmatter found; expected a leading `---` config block (e.g. `master: ./theme.yaml`).',
      line: 1,
    });
  }

  // Remaining segments -> slides.
  const slides: ParsedSlide[] = [];
  const rest = segments.slice(idx).filter((s, i, arr) => !(i === arr.length - 1 && s.text.trim() === ''));
  for (let i = 0; i < rest.length; ) {
    const seg = rest[i];
    // An empty segment sitting in frontmatter position (an extra `---` left between the headmatter
    // and the first slide, or between slides) is not a slide — skip it rather than emit a blank
    // slide. A real slide's empty BODY is consumed via `rest[i + 1]` below, so it never lands here.
    if (seg.text.trim() === '') {
      i += 1;
      continue;
    }
    let frontmatter: Record<string, unknown> = {};
    let bodySeg = seg;
    const hasNext = i + 1 < rest.length;
    if (isConfigLike(seg.text) && hasNext) {
      frontmatter = parseConfig(seg.text, (msg) =>
        warnings.push({ code: 'bad-config', message: `Slide frontmatter is not valid YAML (rendered with defaults): ${msg}`, line: seg.line }),
      );
      // A config-shaped *body* (e.g. a "Field: value" spec sheet) followed by a `---`
      // is otherwise silently consumed as frontmatter. If none of its keys are known
      // slide-config keys, warn — the author likely meant body content (escape a line
      // with a leading backslash, or separate with an explicit `---`).
      const keys = Object.keys(frontmatter).map((k) => k.replace(/^~/, ''));
      if (keys.length && !keys.some((k) => KNOWN_SLIDE_KEYS.has(k))) {
        warnings.push({
          code: 'ambiguous-frontmatter',
          message: `Slide ${slides.length + 1}: a config-shaped block (${keys.slice(0, 3).join(', ')}…) was read as frontmatter, not body. If it is slide content, escape the first line with \\ or add an explicit \`---\`.`,
          line: seg.line,
        });
      }
      bodySeg = rest[i + 1];
      i += 2;
    } else {
      i += 1;
    }
    const { regions, notes } = parseBody(bodySeg.text, warnings, bodySeg.line);
    slides.push({ frontmatter, regions, notes, sourceLine: bodySeg.line });
  }

  if (slides.length === 0) {
    warnings.push({ code: 'empty-deck', message: 'No slides found in deck.', line: 1 });
  }

  return { headmatter, slides, warnings };
}
