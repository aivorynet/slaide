// Apply / check Apache-2.0 license headers on open-source source files.
//   node tools/dev/license-headers.mjs          # insert headers where missing
//   node tools/dev/license-headers.mjs --check  # exit 1 if any file lacks one (CI)
//
// Open-source files get the Apache header. Closed-source files under private/ are
// skipped (they carry their own proprietary notice) and are never published anyway.
import { readFileSync, writeFileSync, readdirSync, statSync } from 'node:fs';
import { join, extname } from 'node:path';

const SPDX = 'SPDX-License-Identifier: Apache-2.0';
const HEADER_LINES = ['Copyright 2026 AIVory, Inc.', SPDX];
const ROOTS = ['src', 'viewer/src', 'bin', 'tools', 'scripts'];
const EXTS = new Set(['.ts', '.js', '.mjs', '.rs']);
const SKIP_DIRS = new Set(['node_modules', 'dist', 'out', 'target', 'vendor', 'private', '.git']);

function walk(dir, acc) {
  let entries;
  try { entries = readdirSync(dir); } catch { return acc; }
  for (const e of entries) {
    const p = join(dir, e);
    if (SKIP_DIRS.has(e)) continue;
    const st = statSync(p);
    if (st.isDirectory()) walk(p, acc);
    else if (EXTS.has(extname(p))) acc.push(p);
  }
  return acc;
}

function commentFor(file, line) {
  // All current source types use // line comments.
  return `// ${line}`;
}

const check = process.argv.includes('--check');
const files = ROOTS.flatMap((r) => walk(r, []));
const missing = [];

for (const f of files) {
  const src = readFileSync(f, 'utf8');
  if (src.includes(SPDX)) continue;
  if (check) { missing.push(f); continue; }

  const lines = src.split('\n');
  let insertAt = 0;
  if (lines[0] && lines[0].startsWith('#!')) insertAt = 1; // keep shebang first
  const header = HEADER_LINES.map((l) => commentFor(f, l)).join('\n');
  const before = lines.slice(0, insertAt).join('\n');
  const after = lines.slice(insertAt).join('\n');
  const out = (before ? before + '\n' : '') + header + '\n' + (insertAt === 0 ? '' : '') + after;
  writeFileSync(f, out, 'utf8');
}

if (check) {
  if (missing.length) {
    console.error(`Missing Apache license header in ${missing.length} file(s):`);
    for (const m of missing) console.error('  ' + m);
    process.exit(1);
  }
  console.log('license-headers: all source files carry the Apache header ✓');
} else {
  console.log(`license-headers: ensured headers on ${files.length} file(s)`);
}
