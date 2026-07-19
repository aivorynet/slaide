// Copyright 2026 AIVory, Inc.
// SPDX-License-Identifier: Apache-2.0
//
// THE canonical registry of the slaide language's author-facing vocabulary.
//
// Why this file exists: the token sets (transitions, frontmatter keys, span/slot
// classes, placeholders, fence types, diagnostic codes) used to live scattered and
// mostly un-exported across parser/compiler/render modules, and the human docs
// (docs/spec.md, docs/grammar.md, docs/themes.md) were hand-kept in parallel — so they
// drifted (e.g. docs listed ~5 transitions while the engine shipped 13). Everything the
// docs must stay complete about is now imported/derived here from the real code, and
// `test/docs-sync.test.ts` fails CI if a token is missing from the docs or if the code
// grows a token this registry doesn't know about. Add a token to the engine → add it
// here → the lint tells you which doc to update. One source, no drift.
//
// This module is a LEAF: it only pulls the already-exported catalogs it can reuse
// verbatim; anything without a single code-level const is listed here as the canonical
// definition and cross-checked against source text by the lint.

import { SLIDE_TRANSITION_NAMES, ENTRANCE_NAMES, DEFAULT_ENTRANCE } from './render/anim.js';
import { KNOWN_SLIDE_KEYS } from './parser/parse.js';
import { SIZE_CLASS } from './compiler/markdown.js';
import { STYLE_MAP } from './compiler/compile.js';

/** Named slide transitions (frontmatter `transition:`). Canonical: render/anim.ts. */
export const TRANSITIONS: readonly string[] = SLIDE_TRANSITION_NAMES;

/** Element/build entrances (`>>> <entrance>`), default `fade-up`. Canonical: render/anim.ts. */
export const ENTRANCES: readonly string[] = ENTRANCE_NAMES;
export { DEFAULT_ENTRANCE };

/** Per-slide frontmatter keys the parser recognizes (metadata keys included — they also
 *  become `{{placeholders}}`). Canonical: parser/parse.ts `KNOWN_SLIDE_KEYS`. */
export const FRONTMATTER_KEYS: readonly string[] = [...KNOWN_SLIDE_KEYS];

/** The config (non-metadata) subset — the keys that change how a slide renders. Used by
 *  the docs lint to check the frontmatter-key table; metadata keys (title/author/…) are
 *  documented as placeholders/headmatter instead. */
export const FRONTMATTER_CONFIG_KEYS: readonly string[] = [
  'layout', 'transition', 'transition-ms', 'transition-ease',
  'background', 'variant', 'morph', 'chrome', 'logo', 'footer', 'notes',
];

/** Deck headmatter keys with defined meaning (plus any custom scalar → placeholder). */
export const HEADMATTER_KEYS: readonly string[] = ['master', 'title', 'author', 'date', 'company', 'subtitle', 'progress'];

/** Inline span size classes `[x]{.xs}`. Canonical: compiler/markdown.ts `SIZE_CLASS`. */
export const SPAN_SIZE_CLASSES: readonly string[] = Object.keys(SIZE_CLASS);

/** Inline span utility classes (besides `.grad`/`.grad-<name>` and colour names). */
export const SPAN_UTIL_CLASSES: readonly string[] = ['grad', 'bold', 'muted'];

/** Image `{...}` utility classes `![x](y){.round}`. Canonical: render/css.ts `.sl-img.*`. */
export const IMAGE_UTIL_CLASSES: readonly string[] = ['round', 'cover', 'shadow'];

/** Renderable code-fence info-strings (rendered, not shown as code). Canonical: compiler/markdown.ts. */
export const RENDERABLE_FENCES: readonly string[] = ['svg', 'embed', 'widget', 'mermaid', 'echart'];

/** Placeholder built-ins `{{page}}` (plus any scalar headmatter/frontmatter key). Canonical: compiler/chrome.ts `placeholderCtx`. */
export const PLACEHOLDER_BUILTINS: readonly string[] = [
  'page', 'total', 'pagePadded', 'totalPadded', 'date', 'title', 'author', 'slideTitle', 'footer',
];

/** Master layout slot `style:` keys. Canonical: compiler/compile.ts `STYLE_MAP` + the two
 *  keys handled before the map (`anchor`, `box`). */
export const SLOT_STYLE_KEYS: readonly string[] = [...Object.keys(STYLE_MAP), 'anchor', 'box'];

/** Master layout slot `type:`s that get first-class styling. Canonical: render/css.ts `.sl-slot-*`. */
export const SLOT_TYPES: readonly string[] = ['title', 'subtitle', 'body', 'image', 'media', 'quote', 'caption'];

/** Every diagnostic (`validate`) code the engine can emit. Canonical: emitted as `code:`
 *  literals across the parser/compiler; the lint scrapes src to keep this exhaustive. */
export const DIAGNOSTIC_CODES: readonly string[] = [
  // parser/parse.ts
  'bad-config', 'no-headmatter', 'ambiguous-frontmatter', 'empty-deck', 'bad-region',
  // compiler/compile.ts
  'unknown-color', 'unknown-gradient', 'bad-animation', 'unknown-layout',
  'unknown-transition', 'unknown-background', 'unknown-slot', 'low-contrast',
  'overlapping-slots',
  // compiler/unknown-vars.ts
  'unknown-var',
  // compiler/markdown.ts
  'unknown-class', 'unknown-entrance', 'stray-build', 'bad-chart', 'bad-span',
  // compiler/tokens.ts
  'unknown-token', 'token-cycle', 'non-embeddable-font', 'unknown-variant',
  // compiler/chrome.ts
  'unknown-placeholder',
  // index.ts (validation entry)
  'no-master', 'parse-error',
];

/** Diagnostics that are hard errors (`ok:false`); every other code is a warning.
 *  Canonical here so `index.ts` and the docs share one definition. `unknown-slot` is an
 *  error (not a warning): a region routed to a slot its resolved layout doesn't define
 *  silently drops the content, so a `deck_source` write with a bad slot name must be
 *  rejected rather than reporting ok:true on a semantic no-op. */
export const ERROR_SEVERITY_CODES: ReadonlySet<string> = new Set(['empty-deck', 'no-master', 'unknown-layout', 'unknown-slot']);
