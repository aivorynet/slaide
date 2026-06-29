#!/usr/bin/env node
// Copyright 2026 AIVory, Inc.
// SPDX-License-Identifier: Apache-2.0
// Thin launcher. Prefers the compiled CLI (dist/), falls back to running the
// TypeScript source via tsx for a freshly-cloned checkout.
import { existsSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, resolve } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const compiled = resolve(here, '../dist/cli.js');

if (existsSync(compiled)) {
  // Import via a file:// URL — Node's ESM loader rejects bare Windows paths (c:\…).
  await import(pathToFileURL(compiled).href);
} else {
  // Dev mode: run the TS entry through tsx.
  const { spawn } = await import('node:child_process');
  const entry = resolve(here, '../src/cli.ts');
  const child = spawn('npx', ['tsx', entry, ...process.argv.slice(2)], {
    stdio: 'inherit',
    shell: process.platform === 'win32',
  });
  child.on('exit', (code) => process.exit(code ?? 0));
}
