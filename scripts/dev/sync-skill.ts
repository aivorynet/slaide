// Copyright 2026 AIVory, Inc.
// SPDX-License-Identifier: Apache-2.0
// Generate the skill's bundled reference docs from the canonical docs/ source,
// so there is exactly one definition of the slaide language (no drift).
import { mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { getSpec, getThemeSchema } from '../../src/assets.js';

const SKILL = 'skills/slaide';
mkdirSync(SKILL, { recursive: true });

writeFileSync(`${SKILL}/reference.md`, getSpec(), 'utf8');
writeFileSync(`${SKILL}/themes.md`, getThemeSchema(), 'utf8');
// Note: the formal EBNF grammar (docs/grammar.md) is for implementers, not deck authors —
// its load-bearing rules live in reference.md, so it is intentionally NOT bundled in the skill.
rmSync(`${SKILL}/grammar.md`, { force: true });
// Worked example decks are NOT bundled (keeps the package lean). The skill points authors to
// github.com/aivorynet/slaide/tree/main/examples and prefers authoring a fresh master.
rmSync(`${SKILL}/examples`, { recursive: true, force: true });

console.log('Synced skill docs: reference.md, themes.md (examples + grammar.md not bundled)');
