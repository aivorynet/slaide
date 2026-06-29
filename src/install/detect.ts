// Copyright 2026 AIVory, Inc.
// SPDX-License-Identifier: Apache-2.0
// Detect which AI coding CLIs are installed on this machine. Mirrors the proven approach
// from the sibling agent-manager: per CLI a set of candidate binary names; resolve each on
// PATH (where.exe + PowerShell on Windows, `command -v` + common dirs on Unix); validate by
// running `<bin> --version`. No third-party deps, just node:child_process.
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';

export interface CliSpec {
  id: string;
  displayName: string;
  binaries: string[]; // candidate executable names, most-specific first
  versionFlag: string;
  installHint: string;
}

export interface DetectedCli {
  id: string;
  displayName: string;
  bin: string; // resolved path or name used to launch it
  version: string;
}

const isWin = process.platform === 'win32';

/** Resolve an executable name on the Windows PATH (where.exe, then PowerShell Get-Command). */
function findWindows(name: string): string | null {
  const where = spawnSync('where.exe', [name], { encoding: 'utf8', timeout: 5000, windowsHide: true });
  if (where.status === 0 && where.stdout.trim()) {
    const lines = where.stdout
      .split(/\r?\n/)
      .map((l) => l.trim())
      .filter(Boolean);
    return lines.find((l) => /\.(cmd|exe)$/i.test(l)) ?? lines[0];
  }
  const ps = spawnSync(
    'powershell',
    ['-NoProfile', '-NonInteractive', '-Command', `(Get-Command '${name}' -ErrorAction SilentlyContinue).Source`],
    { encoding: 'utf8', timeout: 6000, windowsHide: true },
  );
  const out = (ps.stdout || '').trim();
  return ps.status === 0 && out ? out.split(/\r?\n/)[0].trim() : null;
}

const UNIX_DIRS = ['/opt/homebrew/bin', '/usr/local/bin', '/usr/bin', '/bin'];

/** Resolve an executable name on the Unix PATH (login shell `command -v`, then common dirs). */
function findUnix(name: string): string | null {
  const sh = spawnSync('sh', ['-lc', `command -v ${name}`], { encoding: 'utf8', timeout: 5000 });
  const out = (sh.stdout || '').trim();
  if (sh.status === 0 && out) return out.split(/\r?\n/)[0].trim();
  const home = homedir();
  const dirs = [...UNIX_DIRS, join(home, '.local/bin'), join(home, '.npm-global/bin'), join(home, '.bun/bin')];
  for (const d of dirs) {
    const p = join(d, name);
    if (existsSync(p)) return p;
  }
  return null;
}

function findOnPath(name: string): string | null {
  return isWin ? findWindows(name) : findUnix(name);
}

/** Run `<bin> --version` and return the first non-empty output line, or null if it fails. */
function probeVersion(bin: string, flag: string, timeoutMs: number): string | null {
  // .cmd shims on Windows must be run through cmd; on Unix spawn the binary directly.
  const r = isWin
    ? spawnSync('cmd', ['/c', bin, flag], { encoding: 'utf8', timeout: timeoutMs, windowsHide: true })
    : spawnSync(bin, [flag], { encoding: 'utf8', timeout: timeoutMs });
  const out = `${r.stdout || ''}\n${r.stderr || ''}`;
  const line = out
    .split(/\r?\n/)
    .map((l) => l.trim())
    .find(Boolean);
  if (r.status === 0 || line) return line ?? '';
  return null;
}

/** Detect a single CLI: resolve any of its binaries on PATH and validate with --version. */
export function detectOne(spec: CliSpec, timeoutMs = 10000): DetectedCli | null {
  for (const name of spec.binaries) {
    const bin = findOnPath(name);
    if (!bin) continue;
    const version = probeVersion(bin, spec.versionFlag, timeoutMs);
    if (version != null) return { id: spec.id, displayName: spec.displayName, bin, version };
  }
  return null;
}

/** Detect every CLI in the list; returns only the installed ones, in spec order. */
export function detectClis(specs: CliSpec[], timeoutMs = 10000): DetectedCli[] {
  const found: DetectedCli[] = [];
  for (const spec of specs) {
    const d = detectOne(spec, timeoutMs);
    if (d) found.push(d);
  }
  return found;
}
