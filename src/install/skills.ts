// Copyright 2026 AIVory, Inc.
// SPDX-License-Identifier: Apache-2.0
// Locate the bundled slaide authoring skill and copy it into a target CLI's skills folder,
// plus merge a small pointer block into context files (GEMINI.md / AGENTS.md / CONVENTIONS.md)
// without clobbering what is already there.
import { fileURLToPath } from 'node:url';
import { dirname, resolve, join } from 'node:path';
import { existsSync, mkdirSync, readdirSync, copyFileSync, readFileSync, writeFileSync } from 'node:fs';

/** The `core/` package root, from src/install/ (tsx dev) or dist/install/ (published). */
export function coreRoot(): string {
  return resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
}

/** Absolute path to the bundled skill folder; throws a clear error if it is missing. */
export function skillSourceDir(name = 'slaide'): string {
  const dir = join(coreRoot(), 'skills', name);
  if (!existsSync(join(dir, 'SKILL.md'))) {
    throw new Error(
      `slaide skill source not found at ${dir}. In a checkout run the skill sync ` +
        `(npx tsx scripts/dev/sync-skill.ts); in a published install ensure slaide shipped its "skills" folder.`,
    );
  }
  return dir;
}

/** The skill's declared name (SKILL.md frontmatter `name:`), defaulting to the folder default. */
export function readSkillName(srcDir: string): string {
  try {
    const head = readFileSync(join(srcDir, 'SKILL.md'), 'utf8').slice(0, 600);
    const m = head.match(/^name:\s*([A-Za-z0-9_-]+)/m);
    if (m) return m[1];
  } catch {
    /* fall through to default */
  }
  return 'slaide';
}

export interface CopyResult {
  files: number;
  dest: string;
}

/** Recursively copy a directory (overwriting). Counts files; dryRun reports without writing. */
export function copyDir(srcDir: string, destDir: string, dryRun = false): CopyResult {
  let files = 0;
  const walk = (src: string, dest: string): void => {
    if (!dryRun) mkdirSync(dest, { recursive: true });
    for (const ent of readdirSync(src, { withFileTypes: true })) {
      const s = join(src, ent.name);
      const d = join(dest, ent.name);
      if (ent.isDirectory()) walk(s, d);
      else {
        if (!dryRun) copyFileSync(s, d);
        files++;
      }
    }
  };
  walk(srcDir, destDir);
  return { files, dest: destDir };
}

/**
 * Append a block to a context file once, delimited by a sentinel so re-runs are idempotent and
 * existing content is preserved. Returns true if it wrote (or would write, in dryRun).
 */
export function mergePointerFile(file: string, block: string, sentinel: string, dryRun = false): boolean {
  const existing = existsSync(file) ? readFileSync(file, 'utf8') : '';
  if (existing.includes(sentinel)) return false; // already present
  const sep = existing && !existing.endsWith('\n') ? '\n\n' : existing ? '\n' : '';
  const next = existing + sep + sentinel + '\n' + block + '\n';
  if (!dryRun) {
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, next, 'utf8');
  }
  return true;
}
