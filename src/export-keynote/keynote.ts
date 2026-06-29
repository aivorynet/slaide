// Copyright 2026 AIVory, Inc.
// SPDX-License-Identifier: Apache-2.0
// @slaide/export-keynote: slaide deck to native Apple Keynote (.key).
//
// There is no cross-platform writer for the proprietary Keynote (.iwa) format, so a real
// .key is produced only on macOS by driving Keynote.app: we export an editable .pptx (the
// same high-fidelity pipeline as `--pptx`), then have Keynote open it and save it as native
// Keynote. On every other platform .key is unavailable; the caller should surface that and
// offer --pptx instead (PowerPoint files open in Keynote).
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { exportPptx } from '../export-pptx/pptx.js';

export interface KeynoteOptions {
  out: string;
}

/** True only on macOS with Keynote installed (the one path that can write native .key). */
export function keynoteAvailable(): boolean {
  if (process.platform !== 'darwin') return false;
  const r = spawnSync('osascript', ['-e', 'exists application "Keynote"'], { encoding: 'utf8' });
  return r.status === 0 && /true/i.test(r.stdout || '');
}

// AppleScript: open the .pptx in Keynote, save it to the .key path (native format), close it.
const CONVERT = `on run argv
  set inFile to POSIX file (item 1 of argv)
  set outPath to (item 2 of argv)
  tell application "Keynote"
    set theDoc to open inFile
    save theDoc in (POSIX file outPath)
    close theDoc saving no
  end tell
end run`;

function convertPptxToKeynote(pptxPath: string, keyPath: string): void {
  const r = spawnSync('osascript', ['-e', CONVERT, pptxPath, keyPath], { encoding: 'utf8' });
  if (r.status !== 0) {
    throw new Error('Keynote conversion failed: ' + (r.stderr || r.error?.message || 'unknown error').trim());
  }
}

/**
 * Export a deck to native Keynote (.key). macOS + Keynote only; throws a clear, actionable
 * error elsewhere so callers can fall back to --pptx.
 */
export async function exportKeynote(
  deckPath: string,
  opts: KeynoteOptions,
  injected?: import('playwright').Browser,
): Promise<string> {
  if (!keynoteAvailable()) {
    throw new Error(
      'Keynote (.key) export is available on macOS with Keynote installed. ' +
        'Export to PowerPoint instead (--pptx); the .pptx opens in Keynote.',
    );
  }
  const work = mkdtempSync(join(tmpdir(), 'slaide-keynote-'));
  try {
    const pptx = join(work, 'deck.pptx');
    await exportPptx(deckPath, { out: pptx }, injected);
    convertPptxToKeynote(pptx, opts.out);
    return opts.out;
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
}
