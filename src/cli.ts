#!/usr/bin/env node
// Copyright 2026 AIVory, Inc.
// SPDX-License-Identifier: Apache-2.0
// CLI — thin wrapper over @aivorynet/slaide.
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { dirname, resolve, join, basename } from 'node:path';
import { tmpdir } from 'node:os';
import { createServer } from 'node:http';
import {
  compileFile,
  renderFileHtml,
  renderDeckHtml,
  validateSource,
  renderPdf,
  listThemes,
  openDeck,
  packDeck,
  unpackDeck,
} from './index.js';
import { scaffoldDeck } from './scaffold.js';
import { ENTRANCE_NAMES, SLIDE_TRANSITION_NAMES, masterAnimations } from './render/anim.js';

const args = process.argv.slice(2);
const cmd = args[0];

function flag(name: string): string | undefined {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
}
function has(name: string): boolean {
  return args.includes(name);
}
function positional(n: number): string | undefined {
  return args.filter((a) => !a.startsWith('--'))[n];
}

/** Input basename without a `.slaide`/`.slaidec` extension (for naming derived output). */
function deckStem(p: string): string {
  return basename(p).replace(/\.(slaidec|slaide)$/i, '');
}

const COLORS = { red: '\x1b[31m', yellow: '\x1b[33m', green: '\x1b[32m', dim: '\x1b[2m', reset: '\x1b[0m', bold: '\x1b[1m' };
function printDiagnostics(diags: { severity: string; code: string; message: string; line?: number }[]): void {
  for (const d of diags) {
    const c = d.severity === 'error' ? COLORS.red : COLORS.yellow;
    const loc = d.line ? `${COLORS.dim}:${d.line}${COLORS.reset}` : '';
    console.error(`  ${c}${d.severity}${COLORS.reset} ${COLORS.dim}[${d.code}]${COLORS.reset}${loc} ${d.message}`);
  }
}

function help(): void {
  console.log(`${COLORS.bold}slaide${COLORS.reset} — an AI-authorable slide language

Usage:
  slaide build <deck.slaide> [--out <dir>] [--quality <1-100>] [--max-width <px>] [--no-bake]
                                                 Self-contained HTML; charts baked to SVG (no engine dep); optional image shrink
  slaide render <deck.slaide> [--print --meta]  Print self-contained HTML to stdout (for the viewer)
  slaide view <deck.slaide>                    Open the deck in your default browser
  slaide export <deck.slaide> [--pdf <file>]   Export to PDF (needs Playwright)
  slaide export <deck.slaide> --pptx [<file>]  Export to editable PowerPoint (needs Playwright)
                                               (--no-embed-fonts: skip font embedding; --no-builds: skip animations)
  slaide export <deck.slaide> --key [<file>]   Export to Keynote (.key; macOS with Keynote only)
  slaide shoot <deck.slaide> [--out <dir>] [--width <px>] [--scale <n>] [--jpeg] [--hide]
                                                 Render every slide to an image (builds settled), see your deck (needs Playwright)
  slaide shoot <deck.slaide> --montage <file.jpg> [--cols <n>] [--tile <px>] [--quality <1-100>]
                                                 Tile all slides into ONE small JPEG contact sheet, the token-cheap see-it loop
  slaide dev <deck.slaide> [--port <n>]        Live-preview server (re-render on refresh)
  slaide validate <deck.slaide> [--strict]     Validate; structured diagnostics (--strict: warnings fail)
  slaide slots <deck.slaide>                    List the master's slot/colour/gradient/size vocabulary
  slaide compile <deck.slaide> [--inspect]     Print the compiled IR (JSON)
  slaide import <file.pptx|.key> [--out <dir>] [--fidelity hybrid|reconstruct|exact-raster] [--slaidec]
                                                 Convert PowerPoint/Keynote → slaide (--slaidec: one bundled file)
  slaide compare <orig.pptx|refDir> <deck>      Measure fidelity vs the original (SSIM + overlays)
  slaide new <file.slaide> [--title <t>]       Scaffold a starter deck
  slaide pack <deck.slaide|folder> [-o <out>] [--quality <1-100>] [--max-width <px>]
                                                 Bundle into one shareable .slaidec; optional image shrink (keeps format)
  slaide unpack <file.slaidec> [-o <dir>]      Extract a .slaidec back to an editable folder
  slaide themes                                 List bundled themes & layouts
  slaide mcp                                    Run the MCP server (stdio)
  slaide install [--cli <id,…>] [--scope project|global|<dir>] [--skills] [--no-mcp] [--yes] [--list]
                                                 Detect installed AI coding CLIs and install the slaide skill (+ MCP server)
  slaide --help`);
}

async function main(): Promise<void> {
  switch (cmd) {
    case 'build': {
      const deck = positional(1);
      if (!deck) return fail('build needs a deck path');
      const { deckFile } = await openDeck(deck);
      const outDir = flag('--out') ?? 'out';
      mkdirSync(outDir, { recursive: true });
      const { html, ir } = renderFileHtml(deckFile, { mode: 'web', inline: true });
      let out = html;
      // Export-to-HTML bakes charts to static SVG (no engine dependency) unless --no-bake.
      // Optional image shrinking: --quality <1-100> and/or --max-width <px>.
      const bq = flag('--quality');
      const bmw = flag('--max-width');
      const bImage = bq || bmw ? { quality: bq ? Number(bq) : undefined, maxWidth: bmw ? Number(bmw) : undefined } : undefined;
      const bake = !has('--no-bake');
      // Charts are actually present only if an engine lib tag was injected (the .sl-chart
      // CSS class is always in the stylesheet) — gate on that so chart-free builds skip Playwright.
      const hasCharts = out.includes('id="sl-mermaid-lib"') || out.includes('id="sl-echart-lib"');
      if ((bake && hasCharts) || bImage) {
        try {
          const { optimizeExportHtml } = await import('./index.js');
          const before = Buffer.byteLength(out);
          out = await optimizeExportHtml(out, { canvas: ir.canvas, bake, image: bImage });
          const pct = Math.max(0, Math.round((1 - Buffer.byteLength(out) / before) * 100));
          const did = [bake && hasCharts ? 'charts→svg' : '', bImage ? 'images optimized' : ''].filter(Boolean).join(', ');
          console.log(`${COLORS.dim}${did}${pct ? `, ${pct}% smaller` : ''}${COLORS.reset}`);
        } catch (e) {
          console.log(`${COLORS.red}!${COLORS.reset} export optimization skipped: ${(e as Error).message.split('\n')[0]}`);
          out = html;
        }
      }
      const outFile = join(outDir, 'index.html');
      writeFileSync(outFile, out, 'utf8');
      report(ir.warnings);
      console.log(`${COLORS.green}✓${COLORS.reset} Built ${ir.slides.length} slides → ${COLORS.bold}${outFile}${COLORS.reset}`);
      break;
    }
    case 'render': {
      // Emit the self-contained HTML to stdout; optional --meta JSON to stderr.
      // This is the clean machine contract the native viewer consumes.
      const deck = positional(1);
      if (!deck) return fail('render needs a deck path');
      const { deckFile } = await openDeck(deck);
      const mode = has('--print') ? 'print' : 'web';
      const { html, ir } = renderFileHtml(deckFile, { mode, inline: true });
      if (has('--meta')) {
        process.stderr.write(
          JSON.stringify({ title: ir.meta.title, author: ir.meta.author, slides: ir.slides.length, canvas: ir.canvas, warnings: ir.warnings }) + '\n',
        );
      }
      process.stdout.write(html);
      break;
    }
    case 'view': {
      const deck = positional(1);
      if (!deck) return fail('view needs a deck path');
      const { deckFile } = await openDeck(deck);
      const { html } = renderFileHtml(deckFile, { mode: 'web', inline: true });
      const tmp = join(tmpdir(), `slaide-${deckStem(deck)}-${Date.now()}.html`);
      writeFileSync(tmp, html, 'utf8');
      const { spawn } = await import('node:child_process');
      if (process.platform === 'win32') spawn('cmd', ['/c', 'start', '', tmp], { detached: true, stdio: 'ignore' }).unref();
      else spawn(process.platform === 'darwin' ? 'open' : 'xdg-open', [tmp], { detached: true, stdio: 'ignore' }).unref();
      console.log(`${COLORS.green}✓${COLORS.reset} Opened ${basename(deck)} in your browser`);
      break;
    }
    case 'compare': {
      const original = positional(1);
      const deck = positional(2);
      if (!original || !deck) return fail('compare needs <original.pptx|refDir> <deck.slaide>');
      const { compareDecks } = await import('./compare/index.js');
      const threshold = flag('--threshold') ? Number(flag('--threshold')) : 98;
      console.log(`${COLORS.dim}Rendering oracle + deck and diffing…${COLORS.reset}`);
      const r = await compareDecks(original, deck, { outDir: flag('--out') ?? 'out/compare', threshold, refDir: flag('--ref') });
      for (const s of r.slides) {
        console.log(`  slide ${String(s.index).padStart(2)} — visual ${(s.match * 100).toFixed(1)}%  (strict ${(s.matchStrict * 100).toFixed(1)}%)`);
      }
      const tag = r.pass ? `${COLORS.green}PASS` : `${COLORS.red}FAIL`;
      console.log(`${tag}${COLORS.reset} visual match ${COLORS.bold}${r.aggregate}%${COLORS.reset} (strict ${r.strictAggregate}%, threshold ${r.threshold}%) → ${COLORS.bold}${flag('--out') ?? 'out/compare'}/compare-report.md${COLORS.reset}`);
      if (!r.pass) process.exit(1);
      break;
    }
    case 'export': {
      const deck = positional(1);
      if (!deck) return fail('export needs a deck path');
      const { deckFile } = await openDeck(deck);
      // --pptx exports editable PowerPoint; --key native Keynote (macOS only); else (default / --pdf) a PDF.
      if (has('--pptx')) {
        const out = flag('--pptx') ?? deck.replace(/\.(slaidec|slaide)$/i, '') + '.pptx';
        const { exportPptx } = await import('./index.js');
        console.log(`${COLORS.dim}Exporting editable PowerPoint via headless Chromium…${COLORS.reset}`);
        await exportPptx(deckFile, {
          out,
          builds: has('--no-builds') ? false : undefined,
          embedFonts: has('--no-embed-fonts') ? false : undefined,
        });
        console.log(`${COLORS.green}✓${COLORS.reset} Exported → ${COLORS.bold}${out}${COLORS.reset}`);
        break;
      }
      if (has('--key')) {
        const out = flag('--key') ?? deck.replace(/\.(slaidec|slaide)$/i, '') + '.key';
        const { exportKeynote } = await import('./index.js');
        console.log(`${COLORS.dim}Exporting Keynote via Keynote.app…${COLORS.reset}`);
        await exportKeynote(deckFile, { out });
        console.log(`${COLORS.green}✓${COLORS.reset} Exported → ${COLORS.bold}${out}${COLORS.reset}`);
        break;
      }
      const out = flag('--pdf') ?? deck.replace(/\.(slaidec|slaide)$/i, '') + '.pdf';
      console.log(`${COLORS.dim}Rendering PDF via headless Chromium…${COLORS.reset}`);
      await renderPdf(deckFile, { out });
      console.log(`${COLORS.green}✓${COLORS.reset} Exported → ${COLORS.bold}${out}${COLORS.reset}`);
      break;
    }
    case 'shoot': {
      // Per-slide PNGs with builds settled — the fast "see your deck" loop and the
      // way to catch invisible/overlapping/broken text that `validate` can't see.
      // `--montage <file>` tiles every slide into ONE small image (token-cheap review).
      const deck = positional(1);
      if (!deck) return fail('shoot needs a deck path');
      const { deckFile } = await openDeck(deck);
      const montageOut = flag('--montage');
      if (montageOut) {
        const { montageDeck } = await import('./index.js');
        console.log(`${COLORS.dim}Rendering a contact sheet via headless Chromium…${COLORS.reset}`);
        const r = await montageDeck(deckFile, {
          out: montageOut,
          cols: flag('--cols') ? Number(flag('--cols')) : undefined,
          tileWidth: flag('--tile') ? Number(flag('--tile')) : undefined,
          quality: flag('--quality') ? Number(flag('--quality')) : undefined,
        });
        console.log(`${COLORS.green}✓${COLORS.reset} ${COLORS.bold}${r.slides}${COLORS.reset} slides → ${COLORS.bold}${montageOut}${COLORS.reset} ${COLORS.dim}(${r.width}×${r.height})${COLORS.reset}`);
        break;
      }
      const out = flag('--out') ?? 'out/shots';
      const { shootDeck } = await import('./index.js');
      console.log(`${COLORS.dim}Rendering slides to PNG via headless Chromium…${COLORS.reset}`);
      const paths = await shootDeck(deckFile, {
        out,
        width: flag('--width') ? Number(flag('--width')) : undefined,
        height: flag('--height') ? Number(flag('--height')) : undefined,
        scale: flag('--scale') ? Number(flag('--scale')) : undefined,
        hideChrome: has('--hide'),
        format: has('--jpeg') ? 'jpeg' : undefined,
        quality: flag('--quality') ? Number(flag('--quality')) : undefined,
      });
      console.log(`${COLORS.green}✓${COLORS.reset} Shot ${COLORS.bold}${paths.length}${COLORS.reset} slide(s) → ${COLORS.bold}${out}${COLORS.reset}`);
      break;
    }
    case 'dev': {
      const deck = positional(1);
      if (!deck) return fail('dev needs a deck path');
      const port = parseInt(flag('--port') ?? '4321', 10);
      const server = createServer(async (req, res) => {
        try {
          const { deckFile, deckDir } = await openDeck(deck);
          const source = readFileSync(deckFile, 'utf8');
          const { html } = renderDeckHtml(source, deckDir, { mode: 'web', inline: true });
          res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
          res.end(html);
        } catch (e) {
          res.writeHead(500, { 'content-type': 'text/plain' });
          res.end('Error: ' + (e as Error).message);
        }
      });
      server.listen(port, () => {
        console.log(`${COLORS.green}slaide dev${COLORS.reset} → ${COLORS.bold}http://localhost:${port}${COLORS.reset}  ${COLORS.dim}(refresh to reload ${basename(deck)})${COLORS.reset}`);
      });
      break;
    }
    case 'validate': {
      const deck = positional(1);
      if (!deck) return fail('validate needs a deck path');
      const { deckFile, deckDir } = await openDeck(deck);
      const source = readFileSync(deckFile, 'utf8');
      const { ok, diagnostics } = validateSource(source, deckDir);
      if (diagnostics.length) printDiagnostics(diagnostics);
      // --strict: any warning (unknown class/slot, bad config, ambiguous frontmatter…) fails.
      const strict = has('--strict');
      const warnCount = diagnostics.filter((d) => d.severity === 'warning').length;
      const pass = ok && !(strict && warnCount > 0);
      if (pass) console.log(`${COLORS.green}✓${COLORS.reset} ${basename(deck)} is valid${diagnostics.length ? ` (${diagnostics.length} warning(s))` : ''}`);
      else {
        console.error(`${COLORS.red}✗ validation failed${COLORS.reset}${strict && warnCount ? ` (${warnCount} warning(s), --strict)` : ''}`);
        process.exit(1);
      }
      break;
    }
    case 'compile': {
      const deck = positional(1);
      if (!deck) return fail('compile needs a deck path');
      const { deckFile } = await openDeck(deck);
      const { ir } = compileFile(deckFile);
      console.log(JSON.stringify(ir, null, has('--inspect') ? 2 : 0));
      break;
    }
    case 'new': {
      const file = positional(1);
      if (!file) return fail('new needs an output path');
      if (existsSync(file) && !has('--force')) return fail(`${file} exists (use --force)`);
      const title = flag('--title') ?? basename(file).replace(/\.slaide$/, '');
      const content = scaffoldDeck({ title, master: flag('--master') });
      mkdirSync(dirname(resolve(file)), { recursive: true });
      writeFileSync(file, content, 'utf8');
      console.log(`${COLORS.green}✓${COLORS.reset} Scaffolded ${COLORS.bold}${file}${COLORS.reset}`);
      break;
    }
    case 'pack': {
      // Bundle a deck (or a working folder) + its master + assets into one .slaidec.
      const input = positional(1);
      if (!input) return fail('pack needs a deck path or folder');
      const out = flag('-o') ?? flag('--out') ?? join(dirname(resolve(input)), deckStem(input) + '.slaidec');
      // Optional asset shrinking (format-preserving): --quality <1-100> and/or --max-width <px>.
      const pq = flag('--quality');
      const pmw = flag('--max-width');
      const pImage = pq || pmw ? { quality: pq ? Number(pq) : undefined, maxWidth: pmw ? Number(pmw) : undefined } : undefined;
      const r = await packDeck(input, out, { force: has('--force'), image: pImage });
      const kb = (r.bytes / 1024).toFixed(1);
      console.log(`${COLORS.green}✓${COLORS.reset} Packed ${r.files} file(s) → ${COLORS.bold}${out}${COLORS.reset} ${COLORS.dim}(${kb} KB)${COLORS.reset}`);
      break;
    }
    case 'unpack': {
      // Extract a .slaidec back to an editable folder.
      const input = positional(1);
      if (!input) return fail('unpack needs a .slaidec file');
      const out = flag('-o') ?? flag('--out') ?? join(dirname(resolve(input)), deckStem(input));
      const r = await unpackDeck(input, out, { force: has('--force') });
      console.log(`${COLORS.green}✓${COLORS.reset} Unpacked ${r.files} file(s) → ${COLORS.bold}${out}${COLORS.reset} ${COLORS.dim}(deck: ${r.entryDeck})${COLORS.reset}`);
      break;
    }
    case 'import': {
      const file = positional(1);
      if (!file) return fail('import needs a .pptx or .key file');
      const { importDeck } = await import('./index.js');
      const out = flag('--out');
      const fidelity = flag('--fidelity') as 'reconstruct' | 'hybrid' | 'exact-raster' | undefined;
      const rt = flag('--raster-threshold');
      console.log(`${COLORS.dim}Importing ${basename(file)}…${COLORS.reset}`);
      const r = await importDeck(file, out, { fidelity, rasterThreshold: rt ? Number(rt) / 100 : undefined, slaidec: has('--slaidec') });
      report(r.warnings.map((w) => ({ code: 'import', message: w })));
      const target = r.slaidecPath ?? r.deckPath;
      const kind = r.slaidecPath ? ' (self-contained)' : '';
      console.log(`${COLORS.green}✓${COLORS.reset} Imported ${r.slides} slides, ${r.assets} assets (${r.fidelity})${kind} → ${COLORS.bold}${target}${COLORS.reset}`);
      console.log(`  ${COLORS.dim}render: slaide build ${target}${COLORS.reset}`);
      break;
    }
    case 'slots': {
      // List the legal authoring vocabulary for a deck's master — the slot/layout/
      // colour/gradient/size names that `:: name ::` and `[t]{.cls}` may reference.
      const deck = positional(1);
      if (!deck) return fail('slots needs a deck path');
      const { deckFile } = await openDeck(deck);
      const { master } = compileFile(deckFile);
      const b = (s: string) => `${COLORS.bold}${s}${COLORS.reset}`;
      const dim = (s: string) => `${COLORS.dim}${s}${COLORS.reset}`;
      console.log(b('Layouts') + dim('  — route content with `:: slot ::` (and `layout: <name>` in frontmatter)'));
      for (const [name, def] of Object.entries(master.layouts ?? {})) {
        const slots = Object.entries(def.slots ?? {}).map(([s, d]) => `${s}${COLORS.dim}:${(d as any).type}${COLORS.reset}`).join('  ');
        console.log(`  ${COLORS.green}${name}${COLORS.reset}  ${slots || dim('(no slots)')}`);
      }
      const roles = Object.keys(master.colors?.roles ?? {});
      const palette = Object.keys(master.colors?.palette ?? {});
      const grads = Object.keys(master.gradients ?? {});
      console.log('\n' + b('Colours') + dim('  — use as `[text]{.name}`'));
      if (roles.length) console.log('  roles:   ' + roles.join(', '));
      if (palette.length) console.log('  palette: ' + palette.join(', '));
      console.log('\n' + b('Gradients') + dim('  — use as `[text]{.grad-name}` (`.grad` = brand)'));
      console.log('  ' + (grads.length ? grads.join(', ') : dim('(none)')));
      console.log('\n' + b('Sizes') + dim('  — use as `[text]{.xs|.sm|.md|.lg|.xl|.xxl|.huge}`; also .bold .muted .grad'));
      const steps = Object.keys(master.typeScale?.steps ?? {});
      if (steps.length) console.log('  master scale steps: ' + steps.join(', '));
      const customAnim = masterAnimations(master.animations);
      const customT = Object.keys(customAnim.slides);
      const customE = Object.keys(customAnim.entrances);
      console.log('\n' + b('Transitions') + dim('  — slide↔slide, use as `transition: <name>` (frontmatter)'));
      console.log('  ' + [...SLIDE_TRANSITION_NAMES, ...customT.map((n) => `${n}${COLORS.dim}*${COLORS.reset}`)].join(', '));
      console.log('\n' + b('Entrances') + dim('  — element builds, use as `>>> <name>` (e.g. `- point >>> zoom-in delay=150`)'));
      console.log('  ' + [...ENTRANCE_NAMES, ...customE.map((n) => `${n}${COLORS.dim}*${COLORS.reset}`)].join(', '));
      if (customT.length || customE.length) console.log(dim('  * = master-defined custom animation'));
      break;
    }
    case 'mcp': {
      const { runStdio } = await import('./mcp/server.js');
      await runStdio();
      break;
    }
    case 'install': {
      // Detect installed AI coding CLIs, install the slaide skill, and (opt-out) register the MCP server.
      const { runInstall, parseScopeArg } = await import('./install/index.js');
      const cliList = flag('--cli')?.split(',').map((s) => s.trim()).filter(Boolean);
      const { scope, projectDir } = parseScopeArg(flag('--scope'), process.cwd());
      const code = await runInstall({
        cli: cliList,
        scope,
        projectDir,
        skills: has('--no-skills') ? false : has('--skills') ? true : undefined,
        mcp: has('--no-mcp') ? false : has('--mcp') ? true : undefined,
        yes: has('--yes') || has('-y'),
        list: has('--list'),
        dryRun: has('--dry-run'),
        json: has('--json'),
      });
      if (code) process.exit(code);
      break;
    }
    case 'themes': {
      for (const t of listThemes()) {
        console.log(`${COLORS.bold}${t.name}${COLORS.reset} ${COLORS.dim}(${t.layouts.length} layouts)${COLORS.reset}`);
        console.log(`  ${COLORS.dim}${t.layouts.join(', ')}${COLORS.reset}`);
      }
      break;
    }
    case '--help':
    case '-h':
    case undefined:
      help();
      break;
    case '--version':
      console.log('0.1.0');
      break;
    default:
      fail(`unknown command "${cmd}"`);
  }
}

function report(warnings: { code: string; message: string; line?: number }[]): void {
  if (!warnings.length) return;
  console.error(`${COLORS.yellow}${warnings.length} warning(s):${COLORS.reset}`);
  printDiagnostics(warnings.map((w) => ({ ...w, severity: 'warning' })));
}

function fail(msg: string): void {
  console.error(`${COLORS.red}error:${COLORS.reset} ${msg}`);
  console.error(`Run ${COLORS.bold}slaide --help${COLORS.reset} for usage.`);
  process.exit(1);
}

main().catch((e) => {
  console.error(`${COLORS.red}error:${COLORS.reset} ${(e as Error).message}`);
  process.exit(1);
});
