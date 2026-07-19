// Copyright 2026 AIVory, Inc.
// SPDX-License-Identifier: Apache-2.0
// slaide — the single source of truth. CLI and MCP are thin wrappers.
import { readFileSync, existsSync, statSync } from 'node:fs';
import { dirname, resolve, extname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseDeck } from './parser/parse.js';
import { compile } from './compiler/compile.js';
import { renderHtml, type RenderOptions } from './render/html.js';
import { isSlaidec } from './container.js';
import { ERROR_SEVERITY_CODES } from './vocab.js';
import { parseMaster } from './master-io.js';
import type { DeckIR, Master, Warning } from './types.js';

/** Path-based APIs read real files; a `.slaidec` must be resolved via openDeck() first. */
function assertNotContainer(deckPath: string): void {
  if (isSlaidec(deckPath)) {
    throw new Error(`${deckPath} is a .slaidec container — resolve it with openDeck() before reading.`);
  }
}

export { parseDeck, compile, renderHtml };
export type { DeckIR, Master, Warning };

export interface CompileResult {
  ir: DeckIR;
  master: Master;
  deckDir: string;
  masterDir: string;
  /** Absolute path of the master file actually used ('' when none was found / fallback). */
  masterPath: string;
}

const DEFAULT_MASTER = resolve(moduleDir(), '../themes/aurora.slaide.yaml');
/** The bundled default theme path — exported so the editor write-back can detect a deck that
 *  rides the shared theme and materialize a deck-local copy instead of mutating the bundle. */
export const DEFAULT_MASTER_PATH = DEFAULT_MASTER;

function moduleDir(): string {
  return dirname(fileURLToPath(import.meta.url));
}

export function loadMaster(path: string): Master {
  const raw = readFileSync(path, 'utf8');
  return parseMaster(raw);
}

/** The bundle themes directory (holds aurora + blank + any shipped themes). */
function bundleThemesDir(): string {
  return dirname(DEFAULT_MASTER);
}

/** Resolve the master used when a deck names none. Honors `SLAIDE_DEFAULT_MASTER` (a bare
 *  bundled theme name, e.g. `blank`) so the hosted/online engine can start decks from a
 *  neutral placeholder without affecting the CLI/desktop default (aurora, unset). */
export function resolveDefaultMasterPath(): string {
  const envRef = process.env.SLAIDE_DEFAULT_MASTER?.trim();
  if (envRef && /^[\w-]+$/.test(envRef)) {
    const bundled = resolve(bundleThemesDir(), `${envRef}.slaide.yaml`);
    if (existsSync(bundled)) return bundled;
  }
  return existsSync(DEFAULT_MASTER) ? DEFAULT_MASTER : '';
}

/** True when a resolved master path is one of the shared, read-only bundle themes
 *  (aurora, blank, …). Such a master must never be mutated in place — a theme edit
 *  materializes a deck-local copy instead of overwriting the shared file. */
export function isBundledMasterPath(masterPath: string): boolean {
  if (!masterPath) return false;
  return dirname(resolve(masterPath)) === bundleThemesDir();
}

/** Resolve the master path referenced in deck headmatter, with a bundled default. */
export function resolveMasterPath(headmatter: Record<string, unknown>, deckDir: string): string {
  const ref = typeof headmatter.master === 'string' ? headmatter.master : null;
  if (!ref) return resolveDefaultMasterPath();
  const abs = resolve(deckDir, ref);
  if (existsSync(abs)) return abs;
  // A bare name (no path or extension) may be a bundled theme, e.g. `master: aurora` — the
  // identifier `slaide themes` / slaide_list_themes advertises. Resolve it against the bundle.
  if (!/[\\/.]/.test(ref)) {
    const bundled = resolve(dirname(DEFAULT_MASTER), `${ref}.slaide.yaml`);
    if (existsSync(bundled)) return bundled;
  }
  return ref;
}

export function compileSource(source: string, deckDir: string): CompileResult {
  const parsed = parseDeck(source);
  const masterPath = resolveMasterPath(parsed.headmatter, deckDir);
  let master: Master;
  let masterDir = deckDir;
  if (masterPath && existsSync(masterPath)) {
    master = loadMaster(masterPath);
    masterDir = dirname(masterPath);
  } else {
    master = { name: 'fallback', layouts: { blank: { areas: ['default'], slots: { default: { type: 'body' } } } } };
    parsed.warnings.push({ code: 'no-master', message: `Master not found (${masterPath || 'none'}); using minimal fallback.` });
  }
  const ir = compile(parsed, master);
  return { ir, master, deckDir, masterDir, masterPath: masterPath && existsSync(masterPath) ? masterPath : '' };
}

export function compileFile(deckPath: string): CompileResult {
  assertNotContainer(deckPath);
  const source = readFileSync(deckPath, 'utf8');
  return compileSource(source, dirname(resolve(deckPath)));
}

// ---- validation -----------------------------------------------------------

export interface Diagnostic extends Warning {
  severity: 'error' | 'warning';
}

export function validateSource(source: string, deckDir: string): { ok: boolean; diagnostics: Diagnostic[] } {
  let warnings: Warning[] = [];
  try {
    const { ir } = compileSource(source, deckDir);
    warnings = ir.warnings;
  } catch (e) {
    return { ok: false, diagnostics: [{ code: 'parse-error', message: String((e as Error).message), severity: 'error' }] };
  }
  const diagnostics: Diagnostic[] = warnings.map((w) => ({
    ...w,
    severity: ERROR_SEVERITY_CODES.has(w.code) ? 'error' : 'warning',
  }));
  return { ok: !diagnostics.some((d) => d.severity === 'error'), diagnostics };
}

// ---- asset inlining (portable single-file output) --------------------------

const MIME: Record<string, string> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.svg': 'image/svg+xml',
  '.webp': 'image/webp',
  '.mp4': 'video/mp4',
  '.webm': 'video/webm',
  '.mov': 'video/quartz-movie', // browsers map .mov; data-uri playback varies
  '.m4v': 'video/mp4',
  '.ogv': 'video/ogg',
  '.mp3': 'audio/mpeg',
  '.wav': 'audio/wav',
  '.ogg': 'audio/ogg',
  '.m4a': 'audio/mp4',
  '.aac': 'audio/aac',
};

// Don't inline very large media (would bloat the HTML); leave the path so the
// file is loaded alongside the output instead.
const MAX_INLINE_BYTES = 6 * 1024 * 1024;

function inlineOne(p: string, dirs: string[], cache: Map<string, string | null>): string | null {
  if (cache.has(p)) return cache.get(p)!;
  const data = computeInline(p, dirs);
  cache.set(p, data); // each distinct asset is read + base64-encoded at most once per render
  return data;
}

function computeInline(p: string, dirs: string[]): string | null {
  if (/^(https?:|data:|file:)/.test(p)) return null;
  for (const d of dirs) {
    const abs = resolve(d, p);
    if (existsSync(abs)) {
      if (statSync(abs).size > MAX_INLINE_BYTES) return null;
      const ext = extname(abs).toLowerCase();
      const mime = MIME[ext] ?? 'application/octet-stream';
      return `data:${mime};base64,${readFileSync(abs).toString('base64')}`;
    }
  }
  return null;
}

export function inlineAssets(html: string, dirs: string[]): string {
  const cache = new Map<string, string | null>();
  let out = html.replace(/(?:src|poster)="([^"]+)"/g, (m, p) => {
    const d = inlineOne(p, dirs, cache);
    if (!d) return m;
    return m.startsWith('poster') ? `poster="${d}"` : `src="${d}"`;
  });
  out = out.replace(/url\((['"]?)([^'")]+)\1\)/g, (m, _q, p) => {
    const d = inlineOne(p, dirs, cache);
    return d ? `url('${d}')` : m;
  });
  return out;
}

// ---- public render API -----------------------------------------------------

export function renderDeckHtml(source: string, deckDir: string, opts: RenderOptions & { inline?: boolean } = {}): {
  html: string;
  ir: DeckIR;
} {
  const { ir, masterDir } = compileSource(source, deckDir);
  let html = renderHtml(ir, opts);
  if (opts.inline !== false) html = inlineAssets(html, [deckDir, masterDir]);
  return { html, ir };
}

export function renderFileHtml(deckPath: string, opts: RenderOptions & { inline?: boolean } = {}): {
  html: string;
  ir: DeckIR;
} {
  assertNotContainer(deckPath);
  const source = readFileSync(deckPath, 'utf8');
  return renderDeckHtml(source, dirname(resolve(deckPath)), opts);
}

export { renderPdf, renderPdfFromHtml as renderPdfFromHtmlPublic } from './render-pdf/pdf.js';
export { shootDeck, shootHtml } from './render-png/shoot.js';
export type { ShootOptions } from './render-png/shoot.js';
export { montageDeck } from './render-png/montage.js';
export type { MontageOptions } from './render-png/montage.js';
export { exportPptx } from './export-pptx/pptx.js';
export type { PptxOptions } from './export-pptx/pptx.js';
export { embedFonts } from './export-pptx/embed-fonts.js';
export { exportKeynote, keynoteAvailable } from './export-keynote/keynote.js';
export { optimizeExportHtml, optimizeImageBuffers, chartHash, injectBakedCharts } from './optimize/export-optimize.js';
export type { ImageOpts, ChartCache } from './optimize/export-optimize.js';
export { listThemes, getSpec, getThemeSchema } from './assets.js';
export { importDeck } from './import/index.js';
export { openDeck, packDeck, unpackDeck, repackContainer, isSlaidec } from './container.js';
// Master (theme) YAML (de)serialization — the canonical read/write path for *.slaide.yaml,
// shared by the importer and the editor's master write-back.
export { serializeMaster, parseMaster, MASTER_SCHEMA_HEADER } from './master-io.js';

// Open-core extension seam + parser segmentation primitives, re-exported as public
// API so the licensed paid overlay (and third-party tooling) build against the same
// boundaries the engine uses internally. The seam is inert here:
// registerRenderExtensions stays a no-op until a host registers an extension.
export { registerRenderExtensions } from './render/inject.js';
export type { RenderExtension } from './render/inject.js';
export { FENCE, isConfigLike } from './parser/frontmatter.js';
// Animation name catalogs (slide transitions + element entrances) and the master
// animation splitter — surfaced so tooling/overlays build the same name lists the engine does.
export { SLIDE_TRANSITION_NAMES, ENTRANCE_NAMES, masterAnimations } from './render/anim.js';
// High-fidelity import seam: the Pro build registers a PowerPoint-COM rasterizer here so
// hybrid/exact-raster import works; the OSS build registers none and falls back to reconstruct.
export { registerRasterizer, getRasterizer, rasterScriptPath } from './import/raster-extension.js';
export type { Rasterizer, RasterItem, RasterPlaced } from './import/raster-extension.js';
