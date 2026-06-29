// Copyright 2026 AIVory, Inc.
// SPDX-License-Identifier: Apache-2.0
// Generate the skill's bundled reference docs from the canonical docs/ source,
// so there is exactly one definition of the slaide language (no drift).
import { copyFileSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { getSpec, getThemeSchema } from '../../src/assets.js';

const SKILL = 'skills/slaide';
mkdirSync(`${SKILL}/examples`, { recursive: true });

writeFileSync(`${SKILL}/reference.md`, getSpec(), 'utf8');
writeFileSync(`${SKILL}/themes.md`, getThemeSchema(), 'utf8');
// Note: the formal EBNF grammar (docs/grammar.md) is for implementers, not deck authors —
// its load-bearing rules live in reference.md, so it is intentionally NOT bundled in the skill.
rmSync(`${SKILL}/grammar.md`, { force: true });
copyFileSync('examples/q3-roadmap.slaide', `${SKILL}/examples/sample.slaide`);
// A worked example exercising the visual features (spans, chrome, gradients, tables).
copyFileSync('examples/pitch/pitch.slaide', `${SKILL}/examples/branded-deck.slaide`);
copyFileSync('examples/pitch/vela.slaide.yaml', `${SKILL}/examples/branded-theme.slaide.yaml`);

console.log('Synced skill docs: reference.md, themes.md, examples/ (grammar.md not bundled)');
