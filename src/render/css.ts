// Copyright 2026 AIVory, Inc.
// SPDX-License-Identifier: Apache-2.0
// Base stylesheet + token injection. Visual quality lives here.
import type { DeckIR } from '../types.js';
import { buildBaseCss, entranceCss, slideTransitionCss } from './anim.js';

export function tokenCss(ir: DeckIR): string {
  const lines = Object.entries(ir.tokens).map(([k, v]) => `  ${k}: ${v};`);
  return `:root{\n${lines.join('\n')}\n  --canvas-w:${ir.canvas.width}px;\n  --canvas-h:${ir.canvas.height}px;\n  --transition-ms:${ir.transitions.duration}ms;\n}`;
}

const STATIC_CSS = `
*,*::before,*::after{box-sizing:border-box;}
html,body{margin:0;height:100%;}
body{
  background:var(--sl-stage-bg,#0a0a0e);
  font-family:var(--font-sans, system-ui, sans-serif);
  color:var(--color-text,#eee);
  overflow:hidden;
  -webkit-font-smoothing:antialiased;
  text-rendering:optimizeLegibility;
}
.sl-viewport{position:fixed;inset:0;overflow:hidden;background:var(--sl-stage-bg,#0a0a0e);}

/* thin, unobtrusive scrollbars wherever the deck scrolls (notes, code, help) */
*{scrollbar-width:thin;scrollbar-color:rgba(255,255,255,.22) transparent;}
::-webkit-scrollbar{width:9px;height:9px;}
::-webkit-scrollbar-track{background:transparent;}
::-webkit-scrollbar-thumb{background:rgba(255,255,255,.2);border-radius:9px;border:2px solid transparent;background-clip:padding-box;}
::-webkit-scrollbar-thumb:hover{background:rgba(255,255,255,.34);background-clip:padding-box;}
::-webkit-scrollbar-corner{background:transparent;}
.sl-stage{
  position:absolute;
  left:0;top:0;
  width:var(--canvas-w);
  height:var(--canvas-h);
  transform-origin:0 0;
  box-shadow:0 24px 80px -20px rgba(0,0,0,.6);
  overflow:hidden;
}
/* Presentation default: a viewed/presented/exported deck is not text-selectable — dragging to
   highlight slide text breaks the "this is a slideshow" feel. Unconditional + editor-token-free
   so it covers OSS/non-editable/exported renders and keeps the paywall boundary clean; the Pro
   editor's edit CSS re-enables selection on editable regions while editing. */
.sl-stage, .sl-stage *{
  -webkit-user-select:none; user-select:none;
}

/* ---- slide + layers ---- */
.sl-slide{
  position:absolute;inset:0;width:100%;height:100%;
  background:var(--color-background,#111);
  color:var(--color-text,#eee);
  font-size:var(--type-base,22px);
  line-height:1.5;
  overflow:hidden;
  visibility:hidden;
  opacity:0;
}
.sl-slide.sl-active{visibility:visible;opacity:1;}
.sl-layer-bg{position:absolute;inset:0;z-index:0;}
.sl-layer-content{
  position:absolute;inset:0;z-index:1;
  display:grid;
  width:100%;height:100%;
  padding:var(--slide-padding,6%);
  gap:var(--slide-gap,.8em);
  align-content:start;
  justify-items:stretch;
}
.sl-region{min-width:0;min-height:0;}

/* ---- free layer: absolutely positioned shapes/boxes ---- */
.sl-layer-free{position:absolute;inset:0;z-index:2;pointer-events:none;}
.sl-shape{position:absolute;box-sizing:border-box;}
.sl-shape[data-shape="text"]{display:flex;flex-direction:column;justify-content:center;overflow:hidden;outline:none;}

/* ---- typography ---- */
.sl-slide h1,.sl-slide h2,.sl-slide h3,.sl-slide h4{
  font-family:var(--font-display,var(--font-sans));
  font-weight:700;line-height:1.08;margin:0 0 .3em;color:var(--color-heading,var(--color-text));
  letter-spacing:-0.01em;
}
.sl-slide h1{font-size:var(--size-h1,3em);}
.sl-slide h2{font-size:var(--size-h2,2.2em);}
.sl-slide h3{font-size:var(--size-h3,1.6em);}
.sl-slide h4{font-size:var(--size-h4,1.3em);}
.sl-slide p{margin:0 0 .6em;}
.sl-slide ul,.sl-slide ol{margin:.2em 0;padding-left:1.2em;}
.sl-slide li{margin:.35em 0;}
.sl-slide a{color:var(--color-link,var(--color-accent,#6cf));text-decoration:none;border-bottom:1px solid currentColor;}
.sl-slide strong{color:inherit;font-weight:700;}
.sl-slide code{font-family:var(--font-mono,ui-monospace,monospace);font-size:.9em;background:var(--code-inline-bg,rgba(127,127,127,.18));padding:.1em .35em;border-radius:4px;}
.sl-slide pre{font-family:var(--font-mono,ui-monospace,monospace);background:var(--code-bg,rgba(127,127,127,.12));color:var(--code-fg,inherit);padding:var(--code-pad,1.1em 1.3em);border-radius:var(--code-radius,12px);overflow:auto;font-size:.8em;line-height:1.55;box-shadow:var(--code-shadow,none);}
.sl-slide pre code{background:none;padding:0;color:inherit;}
.sl-slide blockquote{margin:0;padding-left:.8em;border-left:4px solid var(--color-accent,#6cf);font-style:italic;color:var(--color-muted,inherit);}
.sl-slide blockquote p{font-size:1.15em;}
.sl-img{max-width:100%;max-height:100%;object-fit:contain;border-radius:8px;display:block;}

/* slot types */
.sl-slot-title{font-family:var(--font-display,inherit);font-weight:700;font-size:var(--size-h2,2.2em);line-height:1.08;letter-spacing:-0.01em;color:var(--color-heading,var(--color-text));}
.sl-slot-subtitle{font-size:var(--size-h3,1.4em);color:var(--color-muted,var(--color-accent));font-weight:400;}
.sl-slot-body{font-size:var(--size-body,var(--type-base));}
.sl-slot-image,.sl-slot-media{display:grid;place-items:center;height:100%;position:relative;}
.sl-slot-media .sl-img{width:100%;height:100%;object-fit:cover;border-radius:0;}
.sl-slot-quote{font-size:var(--size-h3);font-style:italic;}
.sl-slot-caption{font-size:var(--size-caption,.8em);color:var(--color-muted);}

/* ---- tables ---- */
.sl-slide table{border-collapse:collapse;width:100%;font-size:.82em;}
.sl-slide th{text-align:left;color:var(--color-muted);font-weight:600;padding:.45em .8em;border-bottom:1px solid color-mix(in srgb, currentColor 20%, transparent);}
.sl-slide td{padding:.6em .8em;border-bottom:1px solid color-mix(in srgb, currentColor 10%, transparent);vertical-align:top;}
.sl-slide tr:last-child td{border-bottom:none;}

/* ---- gradient text & image utilities ---- */
.sl-grad{background-image:var(--gradient-brand);-webkit-background-clip:text;background-clip:text;color:transparent;-webkit-text-fill-color:transparent;}
/* whole-slot gradient text fill (slot style: fill: <gradient>) */
.sl-region[style*="--region-fill"]{background-image:var(--region-fill);-webkit-background-clip:text;background-clip:text;color:transparent;-webkit-text-fill-color:transparent;}
.sl-img.round{border-radius:50%;object-fit:cover;aspect-ratio:1/1;}
.sl-img.cover{object-fit:cover;width:100%;height:100%;}
.sl-img.shadow{box-shadow:0 18px 50px -16px rgba(0,0,0,.6);}
.sl-img.right{float:right;margin:0 0 .6em 1.4em;}
.sl-img.left{float:left;margin:0 1.4em .6em 0;}
.sl-img.logo{display:inline-block;filter:brightness(0) invert(1);opacity:.82;vertical-align:middle;margin:0 .4em;}
.sl-img.logo-dark{filter:none;}
.sl-video{max-width:100%;max-height:100%;border-radius:8px;display:block;}
.sl-slot-media .sl-video{width:100%;height:100%;object-fit:cover;border-radius:0;}
.sl-audio{width:100%;margin:.4em 0;}
.sl-embed-wrap{position:relative;width:100%;height:100%;min-height:0;}
.sl-embed,.sl-widget{width:100%;height:100%;min-height:240px;border:0;border-radius:10px;background:transparent;display:block;}
.sl-embed-fallback{display:none;align-items:center;justify-content:center;height:100%;min-height:240px;border:1px dashed var(--color-muted,#888);border-radius:10px;color:var(--color-muted,#888);font-family:var(--font-sans,system-ui);}
@media print{.sl-embed,.sl-widget{display:none;} .sl-embed-fallback{display:flex;}}
/* inline svg follows the region's text-align (left/center) */
.sl-svg{display:block;}
.sl-svg svg{display:inline-block;vertical-align:middle;max-width:100%;max-height:100%;height:auto;}

/* ---- charts: mermaid diagrams + echarts data viz (rendered to inline SVG) ---- */
/* .sl-mermaid is a pre — the .sl-slide prefix outranks ".sl-slide pre" so the default
   code-panel background/padding/radius is stripped and the chart reads as a figure. */
.sl-slide .sl-chart{display:flex;justify-content:center;align-items:center;width:100%;height:100%;
  margin:0;background:none;padding:0;box-shadow:none;border-radius:0;overflow:visible;}
.sl-slide .sl-chart svg{max-width:100%;max-height:100%;height:auto;}
.sl-slide .sl-echart{display:block;}
@media print{.sl-chart{break-inside:avoid;}}

/* ---- chrome: header / footer / logo (overlay layer) ---- */
.sl-layer-chrome{position:absolute;inset:0;z-index:3;pointer-events:none;}
.sl-header,.sl-footer{position:absolute;left:0;right:0;display:grid;grid-template-columns:1fr auto 1fr;align-items:center;
  padding:0 var(--chrome-pad,6%);font-family:var(--font-sans,system-ui);font-size:var(--chrome-size,15px);color:var(--color-muted,#888);}
.sl-header{top:var(--chrome-top,4.4%);}
.sl-footer{bottom:var(--chrome-bottom,5%);font-size:var(--chrome-foot-size,17px);color:var(--color-text,#eee);}
.sl-footer .sl-band-c,.sl-footer .sl-band-r{font-size:var(--chrome-page-size,inherit);}
.sl-band-l{justify-self:start;text-align:left;}
.sl-band-c{justify-self:center;text-align:center;}
.sl-band-r{justify-self:end;text-align:right;}
.sl-footer .sl-band-r{color:var(--color-muted);}
.sl-header p,.sl-footer p{margin:0;display:inline;}
.sl-logo{position:absolute;color:var(--color-text,#fff);}
.sl-logo svg,.sl-logo img{height:var(--logo-h,30px);width:auto;display:block;}
.sl-logo-top-left{top:var(--chrome-top,4.4%);left:var(--chrome-pad,6%);}
.sl-logo-top-right{top:var(--chrome-top,4.4%);right:var(--chrome-pad,6%);}
.sl-logo-bottom-left{bottom:var(--chrome-bottom,5%);left:var(--chrome-pad,6%);}
.sl-logo-bottom-right{bottom:var(--chrome-bottom,5%);right:var(--chrome-pad,6%);}

/* ---- present-mode toggle (the web viewer's switch into fullscreen) ---- */
.sl-present-toggle{position:fixed;right:14px;top:12px;z-index:55;width:34px;height:34px;border:0;border-radius:9px;
  background:rgba(0,0,0,.3);color:#fff;opacity:.26;cursor:pointer;font:16px/1 var(--font-sans,system-ui);
  display:grid;place-items:center;backdrop-filter:blur(6px);transition:opacity .2s;}
.sl-present-toggle:hover{opacity:.85;}
body.sl-presenting .sl-present-toggle,body.slv-presenting .sl-present-toggle,
body.sl-presenting .sl-counter,body.slv-presenting .sl-counter,
body.sl-presenting .sl-progress,body.slv-presenting .sl-progress{opacity:0;pointer-events:none;}
body.sl-presenting .sl-stage,body.slv-presenting .sl-stage{box-shadow:none;}
@media print{.sl-present-toggle{display:none;}}

/* ---- builds + transitions live in anim.ts (appended to BASE_CSS below) ---- */

/* ---- UI chrome ---- */
.sl-progress{position:fixed;left:0;bottom:0;height:3px;background:var(--color-accent,#6cf);width:0;z-index:50;transition:width .3s ease;}
.sl-counter{position:fixed;right:14px;bottom:12px;font:600 13px/1 var(--font-sans,system-ui);color:#fff;opacity:.35;z-index:50;background:rgba(0,0,0,.3);padding:5px 9px;border-radius:20px;backdrop-filter:blur(6px);}
.sl-counter:hover{opacity:.8;}
.sl-notes{position:fixed;left:var(--sl-dock-left,0px);right:var(--sl-dock-right,0px);bottom:var(--sl-dock-bottom,0px);height:180px;overflow:auto;background:rgba(10,10,16,.94);color:#ddd;padding:16px 22px;font:15px/1.6 var(--font-sans,system-ui);z-index:60;border-top:2px solid var(--color-accent,#6cf);display:none;box-sizing:border-box;}
.sl-notes.sl-open{display:block;}
.sl-help{position:fixed;inset:0;display:none;place-items:center;background:rgba(5,5,10,.82);z-index:70;}
.sl-help.sl-open{display:grid;}
.sl-help div{background:#16161f;color:#eee;padding:26px 30px;border-radius:14px;font:15px/1.9 var(--font-sans,system-ui);box-shadow:0 30px 80px -20px #000;}
.sl-help kbd{background:#2a2a38;border-radius:5px;padding:2px 7px;font-family:var(--font-mono,monospace);font-size:.85em;}
`;

// Builds + slide transitions are generated from the single-source catalog in anim.ts
// (so adding an effect is one catalog entry, not edits scattered across files).
export const BASE_CSS = STATIC_CSS + '\n' + buildBaseCss() + '\n' + entranceCss() + '\n' + slideTransitionCss();
