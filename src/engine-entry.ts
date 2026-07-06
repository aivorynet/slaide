// Copyright 2026 AIVory, Inc.
// SPDX-License-Identifier: Apache-2.0
// Lean engine entry for the native viewer. Only `render` + `export-html` so the
// `bun build --compile` bundle stays small (no Playwright/MCP). PDF export is done
// by the viewer's own webview (WebView2 PrintToPdf); this never needs a browser.
import { writeFileSync } from 'node:fs';
import { renderFileHtml, openDeck, packDeck, isSlaidec } from './index.js';

const args = process.argv.slice(2);
const cmd = args[0];
const has = (n: string) => args.includes(n);
const flag = (n: string) => {
  const i = args.indexOf(n);
  return i >= 0 ? args[i + 1] : undefined;
};
const positional = (n: number) => args.filter((a) => !a.startsWith('--'))[n];

async function main(): Promise<void> {
  if (cmd === 'edition') {
    // Edition probe for the native viewer: the OSS engine can only render. The viewer reads this
    // to decide whether Sign-in should fetch + swap in the Pro engine (see core/viewer upgrade.rs).
    process.stdout.write('oss\n');
    return;
  }
  if (cmd === 'render') {
    const deck = positional(1);
    if (!deck) {
      process.stderr.write('render needs a deck path\n');
      process.exit(1);
    }
    const { deckFile } = await openDeck(deck);
    const mode = has('--print') ? 'print' : 'web';
    const { html, ir } = renderFileHtml(deckFile, { mode, inline: true });
    if (has('--meta')) {
      process.stderr.write(
        JSON.stringify({ title: ir.meta.title, author: ir.meta.author, slides: ir.slides.length, canvas: ir.canvas, warnings: ir.warnings }) + '\n',
      );
    }
    process.stdout.write(html);
    return;
  }
  if (cmd === 'pack') {
    // Bundle the open deck (+ master + assets) into one shareable .slaidec.
    const deck = positional(1);
    const out = flag('--out');
    if (!deck || !out) {
      process.stderr.write('pack needs <deck> --out <file.slaidec>\n');
      process.exit(1);
    }
    if (isSlaidec(deck)) {
      // Re-export an already-packed deck: pack the extracted working copy.
      const { container } = await openDeck(deck);
      await packDeck(container ? container.extractDir : deck, out, { force: true });
    } else {
      await packDeck(deck, out, { force: true });
    }
    process.stdout.write(out);
    return;
  }
  if (cmd === 'export-html') {
    const deck = positional(1);
    const out = flag('--out');
    if (!deck || !out) {
      process.stderr.write('export-html needs <deck> --out <file>\n');
      process.exit(1);
    }
    const { deckFile } = await openDeck(deck);
    const { html } = renderFileHtml(deckFile, { mode: 'web', inline: true });
    writeFileSync(out, html, 'utf8');
    process.stdout.write(out);
    return;
  }
  process.stderr.write('slaide-engine: usage: render <deck> [--print] [--meta] | export-html <deck> --out <file> | pack <deck> --out <file.slaidec>\n');
  process.exit(1);
}

main().catch((e) => {
  process.stderr.write('slaide-engine: ' + (e as Error).message + '\n');
  process.exit(1);
});
