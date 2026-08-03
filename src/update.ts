// Copyright 2026 AIVory, Inc.
// SPDX-License-Identifier: Apache-2.0
// Lightweight npm update notifier. Once a day, checks the registry for a newer published version
// and prints a one-line notice (to stderr, so machine output on stdout is untouched). Opt out with
// SLAIDE_NO_UPDATE=1; set SLAIDE_AUTO_UPDATE=1 to actually run `npm i -g` when an update exists.
// Best-effort and fully swallowed: a failed/slow check never affects the command. No deps.
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { slaideHome } from './desktop/paths.js';

const PKG = '@aivorynet/slaide';
const REGISTRY = `https://registry.npmjs.org/${PKG}/latest`;
const CHECK_INTERVAL_MS = 24 * 60 * 60 * 1000;
const FAIL_RETRY_MS = 60 * 60 * 1000;
const FETCH_TIMEOUT_MS = 1500;

// Machine-contract commands: never emit chatter or spend time on a network check.
const QUIET_COMMANDS = new Set(['mcp', 'render', 'compile']);

function stateFile(): string {
  return join(slaideHome(), 'update-check.json');
}

function shouldSkip(cmd: string | undefined): boolean {
  if (process.env.SLAIDE_NO_UPDATE || process.env.NO_UPDATE_NOTIFIER || process.env.CI) return true;
  if (!process.stderr.isTTY) return true; // piped / non-interactive — stay silent
  return QUIET_COMMANDS.has(cmd ?? '');
}

function parseVer(v: string): number[] {
  return v.replace(/^v/, '').split('-')[0].split('.').map((n) => parseInt(n, 10) || 0);
}
/** True if `a` is a strictly higher release than `b` (ignores prerelease tags). */
function semverGt(a: string, b: string): boolean {
  const pa = parseVer(a);
  const pb = parseVer(b);
  for (let i = 0; i < 3; i++) {
    const x = pa[i] ?? 0;
    const y = pb[i] ?? 0;
    if (x !== y) return x > y;
  }
  return false;
}

interface State {
  lastCheck?: number;
  lastFail?: number;
  latest?: string;
}
function readState(): State {
  try {
    return JSON.parse(readFileSync(stateFile(), 'utf8'));
  } catch {
    return {};
  }
}
function writeState(s: State): void {
  try {
    mkdirSync(slaideHome(), { recursive: true });
    writeFileSync(stateFile(), JSON.stringify(s));
  } catch {
    /* cache is best-effort */
  }
}

async function fetchLatest(): Promise<string | undefined> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(REGISTRY, { signal: ctrl.signal, headers: { accept: 'application/json' } });
    if (!res.ok) return undefined;
    return (await res.json())?.version;
  } catch {
    return undefined;
  } finally {
    clearTimeout(t);
  }
}

/**
 * Notify (or, with SLAIDE_AUTO_UPDATE=1, install) when a newer @aivorynet/slaide is published.
 * Throttled to once per day via a cache in the Slaide home dir. Never throws.
 */
export async function maybeNotifyUpdate(current: string, cmd?: string): Promise<void> {
  if (shouldSkip(cmd)) return;
  try {
    const st = readState();
    const now = Date.now();
    let latest = st.latest;
    const due = !st.lastCheck || now - st.lastCheck > CHECK_INTERVAL_MS;
    const failCooldown = st.lastFail !== undefined && now - st.lastFail < FAIL_RETRY_MS;
    if (due && !failCooldown) {
      const fetched = await fetchLatest();
      if (fetched) {
        latest = fetched;
        writeState({ lastCheck: now, latest });
      } else {
        // A failed check must not consume the daily slot — keep lastCheck so the retry comes
        // after FAIL_RETRY_MS, not tomorrow; the cooldown keeps offline commands stall-free.
        writeState({ ...st, lastFail: now });
      }
    }
    if (!latest || !semverGt(latest, current)) return;

    if (process.env.SLAIDE_AUTO_UPDATE === '1') {
      process.stderr.write(`\n  ▲ Updating slaide ${current} → ${latest}…\n`);
      const { spawnSync } = await import('node:child_process');
      const r = spawnSync('npm', ['i', '-g', `${PKG}@latest`], {
        stdio: 'inherit',
        shell: process.platform === 'win32',
      });
      if (r.status !== 0) process.stderr.write(`  update failed — run: npm i -g ${PKG}@latest\n`);
    } else {
      process.stderr.write(
        `\n  ▲ slaide ${current} → ${latest} available · npm i -g ${PKG}@latest` +
          ` (SLAIDE_AUTO_UPDATE=1 to auto-update)\n`,
      );
    }
  } catch {
    /* never let an update check break the command */
  }
}
