// Copyright 2026 AIVory, Inc.
// SPDX-License-Identifier: Apache-2.0
// Generate the skill's bundled reference docs from the canonical docs/ source,
// so there is exactly one definition of the slaide language (no drift).
import { mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { getSpec, getThemeSchema, getGrammar } from '../../src/assets.js';

const SKILL = 'skills/slaide';
mkdirSync(SKILL, { recursive: true });

writeFileSync(`${SKILL}/reference.md`, getSpec(), 'utf8');
writeFileSync(`${SKILL}/themes.md`, getThemeSchema(), 'utf8');
// The formal EBNF grammar is bundled too, so an author/agent has the precise structural
// rules (frontmatter detection, attribute braces, master value forms) alongside the usage
// spec. All three come from docs/ verbatim — test/docs-sync.test.ts fails if they drift.
writeFileSync(`${SKILL}/grammar.md`, getGrammar(), 'utf8');
// Worked example decks are NOT bundled (keeps the package lean). The skill points authors to
// github.com/aivorynet/slaide/tree/main/examples and prefers authoring a fresh master.
rmSync(`${SKILL}/examples`, { recursive: true, force: true });

console.log('Synced skill docs: reference.md, themes.md, grammar.md (examples not bundled)');
