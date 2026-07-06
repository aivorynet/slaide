// Copyright 2026 AIVory, Inc.
// SPDX-License-Identifier: Apache-2.0
// Single source of truth for where the native desktop binaries live and how the release
// assets are named. The npm CLI bootstrap (bootstrap.ts), the native viewer's self-upgrade
// (core/viewer/src/upgrade.rs), and the installers (pro/installer/install.{sh,ps1}) MUST agree
// on these names — see release/ASSETS.md. Keep this file in lockstep with release/package-dist.ts.
import { homedir } from 'node:os';
import { join } from 'node:path';

export interface Platform {
  /** Release token for the OS — matches release/package-dist.ts PLATS. */
  os: 'linux' | 'macos' | 'windows';
  /** Release token for the CPU — matches release/package-dist.ts ARCHES. */
  arch: 'x64' | 'arm64';
  /** Executable suffix (`.exe` on Windows, else empty). */
  exe: string;
  /** Bundle archive extension (`zip` on Windows, else `tar.gz`). */
  ext: 'zip' | 'tar.gz';
}

/** Map this process's platform/arch onto the release tokens. Throws on an unsupported target. */
export function detectPlatform(): Platform {
  const os =
    process.platform === 'win32'
      ? 'windows'
      : process.platform === 'darwin'
        ? 'macos'
        : process.platform === 'linux'
          ? 'linux'
          : null;
  if (!os) throw new Error(`unsupported OS for the native viewer: ${process.platform}`);
  const arch = process.arch === 'x64' ? 'x64' : process.arch === 'arm64' ? 'arm64' : null;
  if (!arch) throw new Error(`unsupported CPU for the native viewer: ${process.arch}`);
  return { os, arch, exe: os === 'windows' ? '.exe' : '', ext: os === 'windows' ? 'zip' : 'tar.gz' };
}

/**
 * The install root, shared with the installers (must match them exactly): `SLAIDE_HOME` if set,
 * else `%LOCALAPPDATA%\Slaide` on Windows (install.ps1) or `~/.slaide` elsewhere (install.sh).
 */
export function slaideHome(): string {
  if (process.env.SLAIDE_HOME && process.env.SLAIDE_HOME.trim()) return process.env.SLAIDE_HOME;
  if (process.platform === 'win32' && process.env.LOCALAPPDATA) return join(process.env.LOCALAPPDATA, 'Slaide');
  return join(homedir(), '.slaide');
}

/** The bin dir where slaide-view / slaide-engine are installed. */
export function binDir(): string {
  return join(slaideHome(), 'bin');
}

/** Base URL the binaries are fetched from (the GitHub Releases "latest" by default). */
export function distBase(): string {
  const v = process.env.SLAIDE_DIST_BASE_URL;
  return v && v.trim() ? v.replace(/\/+$/, '') : 'https://github.com/aivorynet/slaide/releases/latest/download';
}

/** Full-bundle asset name: `slaide-<os>-<arch>.<ext>` (flat: slaide, slaide-view, slaide-engine[, themes]). */
export function bundleAsset(p: Platform = detectPlatform()): string {
  return `slaide-${p.os}-${p.arch}.${p.ext}`;
}

/** Standalone gzipped engine: `slaide-engine-<os>-<arch>[.exe].gz` (the Sign-in self-upgrade asset). */
export function engineAsset(p: Platform = detectPlatform()): string {
  return `slaide-engine-${p.os}-${p.arch}${p.exe}.gz`;
}

export function viewerExe(p: Platform = detectPlatform()): string {
  return join(binDir(), `slaide-view${p.exe}`);
}
export function engineExe(p: Platform = detectPlatform()): string {
  return join(binDir(), `slaide-engine${p.exe}`);
}
export function cliExe(p: Platform = detectPlatform()): string {
  return join(binDir(), `slaide${p.exe}`);
}
