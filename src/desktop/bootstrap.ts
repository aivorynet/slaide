// Copyright 2026 AIVory, Inc.
// SPDX-License-Identifier: Apache-2.0
// Lazy bootstrap of the native desktop app from the npm CLI. `slaide app` fetches the signed
// viewer + render-only engine into ~/.slaide/bin on first use, verifies them, registers the
// `.slaide` file type, and launches. This is the JS analogue of the viewer's own self-upgrade
// (core/viewer/src/upgrade.rs) — it bootstraps the FIRST binary, which the viewer can't fetch for
// itself (chicken-and-egg). `slaide auth login` additionally swaps the OSS engine for the Pro
// superset (same public download the viewer does on Sign-in); a license gates editing at runtime.
// Editing/Pro source never ships here — only public, signed binaries are pulled. No new deps.
import { existsSync, mkdirSync, writeFileSync, rmSync, chmodSync, renameSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { spawn, spawnSync } from 'node:child_process';
import { gunzipSync } from 'node:zlib';
import {
  detectPlatform,
  binDir,
  distBase,
  bundleAsset,
  engineAsset,
  viewerExe,
  engineExe,
  cliExe,
  type Platform,
} from './paths.js';
import { verifySha256, verifyMinisign, isPubkeyConfigured } from './verify.js';

export interface EnsureOptions {
  /** Skip the download confirmation prompt. */
  yes?: boolean;
  /** Re-download even if the binaries are already present. */
  force?: boolean;
  /** Suppress progress chatter (errors still surface). */
  quiet?: boolean;
}

const C = { green: '\x1b[32m', dim: '\x1b[2m', red: '\x1b[31m', bold: '\x1b[1m', reset: '\x1b[0m' };
function log(opts: EnsureOptions, msg: string): void {
  if (!opts.quiet) console.error(msg);
}

/** Are the native viewer + engine already installed? */
export function isInstalled(p: Platform = detectPlatform()): boolean {
  return existsSync(viewerExe(p)) && existsSync(engineExe(p));
}

async function fetchBytes(url: string): Promise<Buffer> {
  const res = await fetch(url, { redirect: 'follow' });
  if (!res.ok) throw new Error(`GET ${url} → ${res.status} ${res.statusText}`);
  return Buffer.from(await res.arrayBuffer());
}
async function fetchText(url: string): Promise<string> {
  return (await fetchBytes(url)).toString('utf8');
}

async function confirm(question: string, def: boolean): Promise<boolean> {
  const { createInterface } = await import('node:readline/promises');
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  try {
    const ans = (await rl.question(`${question} ${def ? '[Y/n]' : '[y/N]'} `)).trim();
    return ans ? /^y/i.test(ans) : def;
  } finally {
    rl.close();
  }
}

/**
 * Verify a downloaded asset. SHA-256 is always enforced. When a signing key is configured, a
 * *published* `.minisig` is verified (invalid → abort); a *missing* one falls back to checksum-only
 * (the unsigned→signed rollout — current releases aren't signed yet). With no key configured,
 * signatures are skipped entirely.
 */
async function verifyAsset(base: string, asset: string, data: Buffer, opts: EnsureOptions): Promise<void> {
  verifySha256(data, await fetchText(`${base}/${asset}.sha256`));
  if (!isPubkeyConfigured()) {
    log(opts, `${C.dim}  (signature check disabled — no signing key configured; checksum OK)${C.reset}`);
    return;
  }
  let sig: string | undefined;
  try {
    sig = await fetchText(`${base}/${asset}.minisig`);
  } catch {
    sig = undefined; // not published for this release
  }
  if (sig) verifyMinisign(data, sig);
  else log(opts, `${C.dim}  (no signature published for this release; checksum verified)${C.reset}`);
}

/** Best-effort: write the per-user `.slaide` file association (no-op where unimplemented). */
function register(p: Platform): void {
  spawnSync(viewerExe(p), ['--register'], { stdio: 'ignore' });
}

/** On Windows, make sure the WebView2 Evergreen runtime is present (the viewer needs it). */
function ensureWebView2(opts: EnsureOptions): void {
  if (process.platform !== 'win32') return;
  const key =
    'HKLM\\SOFTWARE\\WOW6432Node\\Microsoft\\EdgeUpdate\\Clients\\{F3017226-FE2A-4295-8BDF-00C3A9A7E4C5}';
  const present = spawnSync('reg', ['query', key], { stdio: 'ignore' }).status === 0;
  if (present) return;
  log(opts, 'Installing the Microsoft WebView2 runtime…');
  const bs = join(tmpdir(), 'MicrosoftEdgeWebview2Setup.exe');
  try {
    const r = spawnSync(
      'powershell',
      [
        '-NoProfile',
        '-Command',
        `Invoke-WebRequest -Uri 'https://go.microsoft.com/fwlink/p/?LinkId=2124703' -OutFile '${bs}' -UseBasicParsing; Start-Process -FilePath '${bs}' -ArgumentList '/silent','/install' -Wait`,
      ],
      { stdio: 'ignore' },
    );
    if (r.status !== 0) throw new Error('bootstrapper failed');
  } catch {
    log(opts, `${C.dim}  Could not auto-install WebView2; install it from microsoft.com if the viewer won't open.${C.reset}`);
  }
}

/**
 * Extract a release archive flat into the bin dir. Windows zips go through PowerShell
 * `Expand-Archive` (matches install.ps1, and sidesteps the GNU-tar `C:`-is-a-remote-host quirk
 * when a user runs from Git Bash); tar.gz uses the system `tar`.
 */
function extractBundle(archive: string, dest: string, p: Platform): void {
  mkdirSync(dest, { recursive: true });
  const r =
    p.os === 'windows'
      ? spawnSync(
          'powershell',
          ['-NoProfile', '-Command', `Expand-Archive -Path '${archive}' -DestinationPath '${dest}' -Force`],
          { stdio: 'ignore' },
        )
      : spawnSync('tar', ['-xzf', archive, '-C', dest], { stdio: 'ignore' });
  if (r.error || r.status !== 0) {
    throw new Error(
      'could not extract the release archive. Install via the one-liner instead: ' +
        'https://github.com/aivorynet/slaide#install',
    );
  }
}

/** Download + verify + extract the full bundle into ~/.slaide/bin, then register + (Windows) WebView2. */
export async function installBinaries(opts: EnsureOptions = {}): Promise<void> {
  const p = detectPlatform();
  const base = distBase();
  const asset = bundleAsset(p);
  const dir = binDir();
  const tmp = join(tmpdir(), `slaide-dl-${process.pid}-${asset}`);

  log(opts, `Downloading the Slaide app (${asset})…`);
  const data = await fetchBytes(`${base}/${asset}`);
  log(opts, 'Verifying…');
  await verifyAsset(base, asset, data, opts);

  writeFileSync(tmp, data);
  try {
    log(opts, `Installing to ${dir}…`);
    extractBundle(tmp, dir, p);
  } finally {
    rmSync(tmp, { force: true });
  }
  if (p.os !== 'windows') {
    for (const exe of [viewerExe(p), engineExe(p), cliExe(p)]) {
      if (existsSync(exe)) chmodSync(exe, 0o755);
    }
  }
  ensureWebView2(opts);
  register(p);
  log(opts, `${C.green}✓${C.reset} Slaide app installed. ${C.dim}Sign in (top-right) to unlock editing.${C.reset}`);
}

/**
 * Ensure the native viewer + engine are installed; download them on first use. Returns the viewer
 * path. Prompts for confirmation when interactive (skip with `yes`); proceeds automatically for an
 * explicit, non-interactive `slaide app` invocation.
 */
export async function ensureInstalled(opts: EnsureOptions = {}): Promise<string> {
  const p = detectPlatform();
  if (isInstalled(p) && !opts.force) return viewerExe(p);

  if (!opts.yes && process.stdin.isTTY && process.stdout.isTTY) {
    log(opts, 'The Slaide desktop app (native viewer + engine, ~50 MB) is not installed yet.');
    if (!(await confirm('Download it now?', true))) {
      throw new Error(
        'declined. Install later with `slaide app --install`, or the Node-free one-liner at ' +
          'https://github.com/aivorynet/slaide#install',
      );
    }
  }
  await installBinaries(opts);
  return viewerExe(p);
}

/** Ask the engine its edition; true only if it explicitly reports `oss`. */
function engineIsOss(p: Platform): boolean {
  const out = spawnSync(engineExe(p), ['edition'], { encoding: 'utf8' });
  return out.status === 0 && out.stdout.trim() === 'oss';
}

function atomicReplace(target: string, bytes: Buffer): void {
  const tmp = `${target}.upgrade-${process.pid}`;
  writeFileSync(tmp, bytes);
  if (process.platform !== 'win32') chmodSync(tmp, 0o755);
  try {
    renameSync(tmp, target);
  } catch (e) {
    rmSync(tmp, { force: true });
    throw e;
  }
}

/**
 * Swap the render-only OSS engine for the Pro superset — the same public, signed download the
 * viewer performs on Sign-in (core/viewer/src/upgrade.rs). Idempotent: a no-op if already Pro.
 * A license still gates editing at runtime; the binary itself is public.
 */
export async function ensureProEngine(opts: EnsureOptions = {}): Promise<void> {
  const p = detectPlatform();
  if (!engineIsOss(p)) return; // already Pro (or not probeable)
  const base = distBase();
  const asset = engineAsset(p);
  log(opts, 'Fetching the Pro engine…');
  const gz = await fetchBytes(`${base}/${asset}`);
  await verifyAsset(base, asset, gz, opts);
  atomicReplace(engineExe(p), gunzipSync(gz));
  log(opts, `${C.green}✓${C.reset} Pro engine installed.`);
}

/** Launch the native viewer (installing it first if needed). Detaches so the CLI returns. */
export async function launchApp(deck: string | undefined, opts: EnsureOptions = {}): Promise<void> {
  const viewer = await ensureInstalled(opts);
  const child = spawn(viewer, deck ? [deck] : [], { detached: true, stdio: 'ignore' });
  child.unref();
}

/** Run the engine's `auth` flow (login/logout/status), upgrading to the Pro engine first. */
export async function runAuth(sub: string, opts: EnsureOptions = {}): Promise<number> {
  await ensureInstalled(opts);
  if (sub === 'login') await ensureProEngine(opts);
  const p = detectPlatform();
  const r = spawnSync(engineExe(p), ['auth', sub], { stdio: 'inherit' });
  return r.status ?? 0;
}

/** Remove the installed binaries (leaves auth/license caches under ~/.slaide untouched). */
export function uninstall(): void {
  const p = detectPlatform();
  spawnSync(viewerExe(p), ['--unregister'], { stdio: 'ignore' });
  for (const exe of [viewerExe(p), engineExe(p), cliExe(p)]) rmSync(exe, { force: true });
}
