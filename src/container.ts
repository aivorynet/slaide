// Copyright 2026 AIVory, Inc.
// SPDX-License-Identifier: Apache-2.0
// @slaide/container — the `.slaidec` file variant: a ZIP that bundles a deck +
// its master + all referenced assets into ONE shareable, compressed file.
//
// This is purely an *alternative* distribution form. The normal working form —
// a folder with `deck.slaide` + `master.slaide.yaml` + `assets/` — is untouched
// and stays the editable source of truth. A `.slaidec` is just that folder zipped:
// the deck text inside keeps its ordinary grammar (`master: ./master.slaide.yaml`,
// `assets/...`), so once extracted it renders through the unchanged pipeline with
// no special-casing.
//
//   slaide pack <deck|folder>  →  one .slaidec
//   slaide unpack <.slaidec>   →  the folder back
//   every read command (build/render/view/export/validate/…) opens a .slaidec
//   transparently via openDeck().
import JSZip from 'jszip';
import { createHash } from 'node:crypto';
import {
  readFileSync,
  writeFileSync,
  mkdirSync,
  existsSync,
  statSync,
  readdirSync,
  rmSync,
} from 'node:fs';
import { dirname, resolve, join, basename, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';
import yaml from 'js-yaml';

export const SLAIDEC_FORMAT = 'slaidec/1';

/** Minimal manifest at the archive root; names the entry deck. No timestamp (determinism). */
interface SlaidecManifest {
  format: string;
  deck: string;
}

export interface OpenedDeck {
  /** Absolute path to a real, on-disk `.slaide` file to read. */
  deckFile: string;
  /** Directory the deck's master/assets resolve against. */
  deckDir: string;
  /** Set only when the input was a `.slaidec`; carries info needed to write edits back. */
  container: { path: string; extractDir: string } | null;
}

// Already-compressed payloads: STORE them (deflate would waste CPU and can grow them).
const STORE_EXT = new Set([
  '.png', '.jpg', '.jpeg', '.webp', '.gif', '.avif',
  '.mp4', '.webm', '.mov', '.m4v', '.ogv',
  '.mp3', '.ogg', '.m4a', '.aac', '.wav',
  '.woff', '.woff2', '.zip', '.slaidec',
]);

// A fixed timestamp so re-packing identical content yields byte-identical archives
// (stable in git, idempotent `pack`). ZIP's epoch floor is 1980-01-01.
const FIXED_DATE = new Date(Date.UTC(1980, 0, 1, 0, 0, 0));

function extOf(p: string): string {
  const b = basename(p);
  const i = b.lastIndexOf('.');
  return i < 0 ? '' : b.slice(i).toLowerCase();
}

/** Is this path a `.slaidec` container — by extension, or by ZIP magic (PK\x03\x04)? */
export function isSlaidec(path: string): boolean {
  if (extOf(path) === '.slaidec') return true;
  if (extOf(path) === '.slaide') return false; // the text form is never a container
  try {
    if (!statSync(path).isFile()) return false;
    const fd = readFileSync(path);
    return fd.length >= 4 && fd[0] === 0x50 && fd[1] === 0x4b && fd[2] === 0x03 && fd[3] === 0x04;
  } catch {
    return false;
  }
}

/** All files under `dir`, as archive-relative POSIX paths (sorted), skipping junk. */
function walkFiles(dir: string): string[] {
  const out: string[] = [];
  const skip = new Set(['.git', 'node_modules', '.DS_Store', 'Thumbs.db']);
  const recur = (d: string) => {
    for (const ent of readdirSync(d, { withFileTypes: true })) {
      if (skip.has(ent.name)) continue;
      const abs = join(d, ent.name);
      if (ent.isDirectory()) recur(abs);
      else if (ent.isFile() && extOf(abs) !== '.slaidec') out.push(abs); // never nest a container
    }
  };
  recur(dir);
  return out.map((a) => relative(dir, a).split(sep).join('/')).sort();
}

/** Find the entry deck inside a folder: the manifest's `deck`, else the single root `.slaide`. */
function findEntryDeck(dir: string): string {
  const manifestPath = join(dir, 'slaidec.json');
  if (existsSync(manifestPath)) {
    try {
      const m = JSON.parse(readFileSync(manifestPath, 'utf8')) as SlaidecManifest;
      if (m && typeof m.deck === 'string' && existsSync(join(dir, m.deck))) return m.deck;
    } catch {
      /* fall through to convention */
    }
  }
  const roots = readdirSync(dir).filter((f) => f.endsWith('.slaide') && statSync(join(dir, f)).isFile());
  if (roots.length === 1) return roots[0];
  if (roots.length === 0) throw new Error(`No .slaide deck found in ${dir}`);
  throw new Error(`Multiple .slaide decks in ${dir} (${roots.join(', ')}); add a slaidec.json naming the entry "deck".`);
}

/** Build a deterministic ZIP from an archive-path → bytes map. */
async function zipEntries(entries: Map<string, Buffer>): Promise<Buffer> {
  const zip = new JSZip();
  for (const path of [...entries.keys()].sort()) {
    const data = entries.get(path)!;
    const store = STORE_EXT.has(extOf(path));
    zip.file(path, data, {
      date: FIXED_DATE,
      compression: store ? 'STORE' : 'DEFLATE',
      compressionOptions: store ? undefined : { level: 9 },
    });
  }
  // platform DOS (default) keeps output stable across OSes.
  return zip.generateAsync({ type: 'nodebuffer', platform: 'DOS' });
}

/** Resolve the master a deck references, mirroring core resolveMasterPath (with bundled default). */
function resolveDeckMaster(deckPath: string): { masterPath: string; ref: string | null } {
  const src = readFileSync(deckPath, 'utf8');
  const head = readHeadmatter(src);
  const ref = typeof head.master === 'string' ? head.master : null;
  const deckDir = dirname(resolve(deckPath));
  if (ref) {
    const abs = resolve(deckDir, ref);
    return { masterPath: abs, ref };
  }
  // No master: ref → the bundled default theme (themes/aurora.slaide.yaml at repo root).
  const def = resolve(dirname(fileURLToPath(import.meta.url)), '../themes/aurora.slaide.yaml');
  return { masterPath: def, ref: null };
}

/** Cheap headmatter read (first `---`…`---` block) without importing the full parser. */
function readHeadmatter(src: string): Record<string, unknown> {
  const lines = src.split(/\r?\n/);
  if (lines[0]?.trim() !== '---') return {};
  const end = lines.slice(1).findIndex((l) => l.trim() === '---');
  if (end < 0) return {};
  try {
    const obj = yaml.load(lines.slice(1, end + 1).join('\n'));
    return obj && typeof obj === 'object' && !Array.isArray(obj) ? (obj as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

/** Curate the entries for packing a single deck FILE: deck + resolved master + sibling assets/. */
function stageDeckFile(deckPath: string): { entries: Map<string, Buffer>; entryName: string } {
  const entries = new Map<string, Buffer>();
  const deckDir = dirname(resolve(deckPath));
  const deckName = basename(deckPath);
  let deckText = readFileSync(deckPath, 'utf8');

  const { masterPath, ref } = resolveDeckMaster(deckPath);
  if (!existsSync(masterPath)) {
    throw new Error(`pack: master not found (${ref ?? 'bundled default'}) for ${deckName}`);
  }
  const masterInsideDeckDir = resolve(masterPath).startsWith(resolve(deckDir) + sep);
  let masterArchivePath: string;
  if (ref && masterInsideDeckDir) {
    // Keep the deck's existing relative reference verbatim.
    masterArchivePath = relative(deckDir, resolve(masterPath)).split(sep).join('/');
  } else {
    // Master lives outside the deck folder (or is the bundled default): copy it to the
    // root and point the deck at it. Rewrite only the `master:` headmatter line.
    masterArchivePath = 'master.slaide.yaml';
    deckText = rewriteMasterRef(deckText, './master.slaide.yaml');
  }
  entries.set(masterArchivePath, readFileSync(masterPath));
  entries.set(deckName, Buffer.from(deckText, 'utf8'));

  // Sibling assets/ folder (the standard layout) travels along.
  const assetsDir = join(deckDir, 'assets');
  if (existsSync(assetsDir) && statSync(assetsDir).isDirectory()) {
    for (const rel of walkFiles(assetsDir)) {
      entries.set('assets/' + rel, readFileSync(join(assetsDir, rel)));
    }
  }
  // Sibling charts/ folder = the derived baked-chart SVG cache (charts/<hash>.svg). Purely derived
  // (the deck text stays the authoritative chart source), but travels along so the deck renders its
  // charts offline / anywhere with no engine. Folder-pack already includes it; mirror that here.
  const chartsDir = join(deckDir, 'charts');
  if (existsSync(chartsDir) && statSync(chartsDir).isDirectory()) {
    for (const rel of walkFiles(chartsDir)) {
      entries.set('charts/' + rel, readFileSync(join(chartsDir, rel)));
    }
  }
  return { entries, entryName: deckName };
}

/** Replace the value of the top-level `master:` headmatter key (within the first `---` block). */
function rewriteMasterRef(src: string, newRef: string): string {
  const lines = src.split(/\r?\n/);
  if (lines[0]?.trim() !== '---') return src;
  for (let i = 1; i < lines.length; i++) {
    if (lines[i].trim() === '---') break; // end of headmatter
    if (/^master\s*:/.test(lines[i])) {
      lines[i] = `master: ${newRef}`;
      return lines.join('\n');
    }
  }
  return src;
}

export interface PackResult {
  out: string;
  bytes: number;
  files: number;
  entryDeck: string;
}

/**
 * Build a `.slaidec` from a deck file OR a working folder.
 * - folder input: zip its files as-is (everything is already self-relative).
 * - deck-file input: curate deck + resolved master + sibling assets/.
 */
export async function packDeck(
  input: string,
  outPath: string,
  opts: { force?: boolean; image?: import('./optimize/export-optimize.js').ImageOpts } = {},
): Promise<PackResult> {
  const abs = resolve(input);
  if (!existsSync(abs)) throw new Error(`pack: input not found: ${input}`);
  if (existsSync(outPath) && !opts.force) throw new Error(`pack: ${outPath} exists (use --force)`);

  let entries: Map<string, Buffer>;
  let entryName: string;
  if (statSync(abs).isDirectory()) {
    entries = new Map();
    for (const rel of walkFiles(abs)) {
      if (rel === 'slaidec.json') continue; // regenerated below
      entries.set(rel, readFileSync(join(abs, rel)));
    }
    entryName = findEntryDeck(abs);
  } else {
    ({ entries, entryName } = stageDeckFile(abs));
  }

  const manifest: SlaidecManifest = { format: SLAIDEC_FORMAT, deck: entryName };
  entries.set('slaidec.json', Buffer.from(JSON.stringify(manifest, null, 2) + '\n', 'utf8'));

  // Optional: downscale/recompress raster assets (format-preserving, so refs stay valid).
  if (opts.image) {
    const { optimizeImageBuffers } = await import('./optimize/export-optimize.js');
    const imgs = [...entries].filter(([n]) => /\.(png|jpe?g|webp)$/i.test(n)).map(([name, buf]) => ({ name, buf }));
    if (imgs.length) {
      const optimized = await optimizeImageBuffers(imgs, opts.image);
      for (const [name, buf] of optimized) entries.set(name, buf);
    }
  }

  const buf = await zipEntries(entries);
  mkdirSync(dirname(resolve(outPath)), { recursive: true });
  writeFileSync(outPath, buf);
  return { out: outPath, bytes: buf.length, files: entries.size, entryDeck: entryName };
}

export interface UnpackResult {
  outDir: string;
  files: number;
  entryDeck: string;
}

/** Extract a `.slaidec` to a folder (the editable working form). */
export async function unpackDeck(slaidecPath: string, outDir: string, opts: { force?: boolean } = {}): Promise<UnpackResult> {
  if (!existsSync(slaidecPath)) throw new Error(`unpack: file not found: ${slaidecPath}`);
  if (existsSync(outDir) && readdirSync(outDir).length > 0 && !opts.force) {
    throw new Error(`unpack: ${outDir} is not empty (use --force)`);
  }
  const files = await extractTo(slaidecPath, outDir);
  return { outDir, files: files.length, entryDeck: findEntryDeck(outDir) };
}

/** Re-zip a (possibly edited) extraction back into its `.slaidec` (used after viewer edits). */
export async function repackContainer(extractDir: string, slaidecPath: string): Promise<void> {
  await packDeck(extractDir, slaidecPath, { force: true });
}

/** Low-level: extract every entry of a `.slaidec` into `dir`. Returns written archive paths. */
async function extractTo(slaidecPath: string, dir: string): Promise<string[]> {
  let zip: JSZip;
  try {
    zip = await JSZip.loadAsync(readFileSync(slaidecPath));
  } catch (e) {
    throw new Error(`Not a valid .slaidec (corrupt or not a ZIP): ${slaidecPath} — ${(e as Error).message}`);
  }
  mkdirSync(dir, { recursive: true });
  const written: string[] = [];
  for (const [name, entry] of Object.entries(zip.files)) {
    if (entry.dir) continue;
    const dest = join(dir, name);
    mkdirSync(dirname(dest), { recursive: true });
    writeFileSync(dest, await entry.async('nodebuffer'));
    written.push(name);
  }
  if (!written.length) throw new Error(`Empty .slaidec (no entries): ${slaidecPath}`);
  return written;
}

/**
 * Resolve any deck input — a `.slaide` file, a working folder, or a `.slaidec` —
 * to a real on-disk deck file + its directory. `.slaidec` inputs are extracted to a
 * content-addressed cache under the temp dir (reused until the file changes), so the
 * rest of the pipeline reads ordinary files with zero special-casing.
 */
export async function openDeck(input: string): Promise<OpenedDeck> {
  const abs = resolve(input);
  if (!existsSync(abs)) throw new Error(`Deck not found: ${input}`);

  // Directory: the uncompressed working folder.
  if (statSync(abs).isDirectory()) {
    const entry = findEntryDeck(abs);
    return { deckFile: join(abs, entry), deckDir: abs, container: null };
  }

  // Plain `.slaide` (or any non-container file): use it directly — today's behavior.
  if (!isSlaidec(abs)) {
    return { deckFile: abs, deckDir: dirname(abs), container: null };
  }

  // `.slaidec` container: extract to a single cache dir per file (keyed by path), and
  // re-extract whenever the file changes (mtime+size marker stored alongside the dir).
  // Reusing ONE dir per source keeps temp bounded across repeated in-place edits — each
  // edit repacks and bumps the file's mtime, which simply invalidates this same dir.
  const st = statSync(abs);
  const key = createHash('sha1').update(abs).digest('hex').slice(0, 16);
  const extractDir = join(tmpdir(), 'slaide-slaidec', key);
  const markerPath = extractDir + '.src'; // sibling, so it never lands inside the repacked archive
  const marker = `${st.mtimeMs}:${st.size}`;
  let reuse = false;
  try {
    reuse = existsSync(extractDir) && existsSync(join(extractDir, 'slaidec.json')) && readFileSync(markerPath, 'utf8') === marker;
  } catch {
    reuse = false;
  }
  if (!reuse) {
    rmSync(extractDir, { recursive: true, force: true });
    await extractTo(abs, extractDir);
    writeFileSync(markerPath, marker, 'utf8');
  }
  const entry = findEntryDeck(extractDir);
  return { deckFile: join(extractDir, entry), deckDir: extractDir, container: { path: abs, extractDir } };
}
