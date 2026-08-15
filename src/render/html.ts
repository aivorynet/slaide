// Copyright 2026 AIVory, Inc.
// SPDX-License-Identifier: Apache-2.0
// Deck IR -> full HTML document. Two modes: 'web' (interactive runtime) and
// 'print' (paginated, all builds settled — the PDF source).
import type { BackgroundDef, DeckIR, ResolvedChrome, SlideIR } from '../types.js';
import { BASE_CSS, tokenCss } from './css.js';
import { RUNTIME_JS } from './runtime.js';
import { CHARTS_BOOT_JS, MERMAID_LIB_B64, ECHART_LIB_B64 } from './charts.js';
import { extraHeadCss, extraBodyScript } from './inject.js';
import { escapeHtml as esc, serializeStyle } from '../util.js';

function backgroundCss(bg: BackgroundDef | null): string {
  if (!bg) return '';
  if (bg.type === 'solid') return `background:${bg.color};`;
  if (bg.type === 'gradient') {
    // Model-authored masters can ship a gradient without `stops` — degrade, never crash.
    if (!Array.isArray(bg.stops) || bg.stops.length === 0) return '';
    const angle = bg.angle ?? 135;
    return `background:linear-gradient(${angle}deg, ${bg.stops.join(', ')});`;
  }
  if (bg.type === 'image') {
    // `stretch` is a friendly alias for CSS `100% 100%` (distort to fill, ignoring aspect).
    const fitRaw = bg.fit ?? 'cover';
    const size = fitRaw === 'stretch' ? '100% 100%' : fitRaw;
    const pos = bg.position ?? 'center';
    const repeat = bg.repeat ?? 'no-repeat';
    const dim = bg.dim ? `background-color:rgba(0,0,0,${bg.dim});background-blend-mode:multiply;` : '';
    return `background-image:url('${bg.src}');background-size:${size};background-position:${pos};background-repeat:${repeat};${dim}`;
  }
  return '';
}

function styleAttr(style: Record<string, string>): string {
  const s = serializeStyle(style);
  return s ? `;${s}` : '';
}

function renderLayers(slide: SlideIR, shown: boolean): string {
  const bg = `<div class="sl-layer-bg" style="${backgroundCss(slide.background)}"></div>`;
  const align = slide.grid.align;
  const alignItems = align === 'center' ? 'center' : 'stretch';
  const contentStyle =
    `grid-template-areas:${slide.grid.areas};` +
    `grid-template-rows:${slide.grid.rows};` +
    `grid-template-columns:${slide.grid.cols};` +
    `padding:${slide.grid.padding};gap:${slide.grid.gap};align-content:${align};align-items:${alignItems};`;
  // The `free` region is a full-slide absolute layer for placed shapes/boxes; it
  // lives outside the content grid (between content and chrome).
  const freeRegion = slide.regions.find((r) => r.name === 'free');
  const regions = slide.regions
    .filter((r) => r.name !== 'free')
    .map(
      (r) =>
        `<div class="sl-region sl-slot-${r.slotType}" data-region="${esc(r.name)}" data-source-region="${esc(r.source)}" style="grid-area:${r.name}${styleAttr(r.style)}">${r.html}</div>`,
    )
    .join('\n');
  const content = `<div class="sl-layer-content" style="${contentStyle}">${regions}</div>`;
  const free = freeRegion ? `<div class="sl-region sl-layer-free" data-region="free">${freeRegion.html}</div>` : '';
  const chrome = renderChrome(slide.chrome);
  // In print/shown mode, pre-mark builds as shown.
  const body = bg + content + free + chrome;
  return shown ? body.replace(/class="([^"]*\bsl-build\b[^"]*)"/g, 'class="$1 sl-shown"') : body;
}

function band(b: { left: string; center: string; right: string } | null, kind: string): string {
  if (!b) return '';
  return (
    `<div class="sl-${kind}">` +
    `<div class="sl-band-l">${b.left}</div>` +
    `<div class="sl-band-c">${b.center}</div>` +
    `<div class="sl-band-r">${b.right}</div>` +
    `</div>`
  );
}

function renderChrome(chrome: ResolvedChrome | null): string {
  if (!chrome) return '';
  const logo = chrome.logo ? `<div class="sl-logo sl-logo-${chrome.logoPos}">${chrome.logo}</div>` : '';
  return `<div class="sl-layer-chrome">${logo}${band(chrome.header, 'header')}${band(chrome.footer, 'footer')}</div>`;
}

function renderSlideWeb(slide: SlideIR): string {
  const morph = slide.morph ? ` data-morph-slide="${esc(slide.morph)}"` : '';
  // Master-defined names, surfaced for the editor's slide-properties panel (harmless otherwise).
  const dataBg = slide.bgName ? ` data-bg="${esc(slide.bgName)}"` : '';
  const dataVar = slide.variantName ? ` data-variant="${esc(slide.variantName)}"` : '';
  let body = renderLayers(slide, false);
  // The first slide is on screen at first paint — load its images eagerly so it
  // isn't blank while offscreen slides defer (see markdown.ts loading="lazy").
  if (slide.index === 0) body = body.replace(/loading="lazy"/g, 'loading="eager"');
  return (
    `<section class="sl-slide" data-index="${slide.index}" data-transition="${esc(slide.transition)}" ` +
    `data-layout="${esc(slide.layout)}"${dataBg}${dataVar} ` +
    `data-builds="${slide.buildCount}"${morph} style="${cssVars(slide.vars)}">` +
    body +
    `</section>`
  );
}

function renderSlidePrint(slide: SlideIR): string {
  // Print is the PDF source: every page rasterises, so lazy images on later pages
  // would never load and export blank. Load them all eagerly (web does this for
  // slide 0 only — see renderSlideWeb).
  const body = renderLayers(slide, true).replace(/loading="lazy"/g, 'loading="eager"');
  return `<div class="sl-page sl-slide" style="${cssVars(slide.vars)}">${body}</div>`;
}

function cssVars(vars: Record<string, string>): string {
  return serializeStyle(vars);
}

function head(ir: DeckIR, extraCss: string): string {
  const title = ir.meta.title ? esc(ir.meta.title) : 'slaide';
  const fonts = ir.fontImports.map((u) => `<link rel="stylesheet" href="${u}">`).join('\n');
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<!-- The deck manages its own light/dark colours per slide. Declaring color-scheme opts
     out of Chromium "auto dark mode", which otherwise darkens light text in embedded
     webviews (e.g. the WebView2 native viewer) and forced-colors environments. -->
<meta name="color-scheme" content="light dark">
<title>${title}</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
${fonts}
<style>
:root{color-scheme:light dark;}
${tokenCss(ir)}
${BASE_CSS}
${extraCss}
</style>
</head>`;
}

export interface RenderOptions {
  mode?: 'web' | 'print';
  /** An editable render carries the ECharts engine even when the deck has no chart yet — the
   *  editor can insert one, and a chart inserted into a chartless deck has nothing to draw
   *  with. Costs ~1.3MB, so it stays off for view/export renders. */
  editable?: boolean;
}

const PRINT_CSS = (w: number, h: number) => `
@page{size:${w}px ${h}px;margin:0;}
html,body{background:#fff;overflow:visible;height:auto;}
.sl-print-root{display:block;}
.sl-page{position:relative;width:${w}px;height:${h}px;overflow:hidden;break-after:page;page-break-after:always;}
.sl-page:last-child{break-after:auto;}
.sl-slide.sl-page{visibility:visible;opacity:1;}
.sl-layer-content{position:absolute;}
`;

// Inline the chart engines + lazy boot loader — but ONLY the engine(s) the deck actually
// uses, and only if it has charts at all. The bundles ride in inert `text/plain` tags
// (not parsed on load); the boot loader decodes + evals one the first time a chart of
// that kind renders. The boot script must precede RUNTIME_JS so its slaide:change
// listener is attached before the runtime fires its first navigation event.
function chartBlock(renderedHtml: string, editable = false): string {
  const hasMermaid = renderedHtml.includes('sl-mermaid');
  // An editable render also carries the ECharts engine even when the deck has no chart: the
  // editor can insert one, and it would have nothing to draw with. Only ECharts — that is what
  // Insert makes, and mermaid is 4.3MB against ECharts' 1.3MB, so it stays demand-driven.
  const hasEchart = renderedHtml.includes('sl-echart') || editable;
  if (!hasMermaid && !hasEchart) return '';
  const libs =
    (hasMermaid ? `<script type="text/plain" id="sl-mermaid-lib">${MERMAID_LIB_B64}</script>\n` : '') +
    (hasEchart ? `<script type="text/plain" id="sl-echart-lib">${ECHART_LIB_B64}</script>\n` : '');
  return `${libs}<script>${CHARTS_BOOT_JS}</script>\n`;
}

export function renderHtml(ir: DeckIR, opts: RenderOptions = {}): string {
  const mode = opts.mode ?? 'web';
  const { width: w, height: h } = ir.canvas;

  if (mode === 'print') {
    const pages = ir.slides.map(renderSlidePrint).join('\n');
    return `${head(ir, PRINT_CSS(w, h))}
<body class="sl-print">
<div class="sl-print-root">
${pages}
</div>
${chartBlock(pages)}</body>
</html>`;
  }

  const slides = ir.slides.map(renderSlideWeb).join('\n');
  const extraCss = (ir.animCss ? ir.animCss : '') + extraHeadCss(ir);
  const notes = JSON.stringify(ir.slides.map((s) => (s.notes ? mdToInline(s.notes) : null)));
  // The position indicator (progress bar + counter chip) is gated by the master/headmatter
  // `ui.progress` toggle; the floating counter is additionally suppressed when a themed
  // footer already shows page numbers.
  const hasFooter = ir.slides.some((s) => s.chrome?.footer);
  const progressEl = ir.ui.progress ? '<div class="sl-progress"></div>' : '';
  const counter = ir.ui.progress && !hasFooter ? '<div class="sl-counter"></div>' : '';
  // A registered host extension may append a trailing script; empty by default.
  const hostScript = extraBodyScript(ir);
  const extScriptTag = hostScript ? `\n<script>${hostScript}</script>` : '';
  return `${head(ir, extraCss)}
<body>
<div class="sl-viewport">
  <div class="sl-stage" data-w="${w}" data-h="${h}">
${slides}
  </div>
</div>
${progressEl}
${counter}
<button class="sl-present-toggle" title="Present (fullscreen)" aria-label="Present">⤢</button>
<div class="sl-notes"></div>
<div class="sl-help"><div>
  <strong>slaide</strong><br>
  <kbd>→</kbd>/<kbd>Space</kbd> next &nbsp; <kbd>←</kbd> back &nbsp; <kbd>Home</kbd>/<kbd>End</kbd> jump<br>
  <kbd>n</kbd> notes &nbsp; <kbd>f</kbd> fullscreen &nbsp; <kbd>?</kbd> help
</div></div>
<script>window.__SLAIDE_NOTES__=${notes};</script>
${chartBlock(slides, opts.editable)}<script>${RUNTIME_JS}</script>${extScriptTag}
</body>
</html>`;
}

// Lightweight inline markdown for notes (bold/italic/code/linebreaks).
function mdToInline(s: string): string {
  return esc(s)
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/\*(.+?)\*/g, '<em>$1</em>')
    .replace(/`(.+?)`/g, '<code>$1</code>')
    .replace(/\n/g, '<br>');
}
