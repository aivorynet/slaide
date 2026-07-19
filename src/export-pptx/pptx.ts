// Copyright 2026 AIVory, Inc.
// SPDX-License-Identifier: Apache-2.0
// @slaide/export-pptx — slaide deck -> editable PowerPoint (.pptx).
//
// Strategy: render the deck's web HTML in headless Chromium, then MEASURE the laid-out
// result (each region's real box + per-run computed styles, images, and backgrounds) and
// rebuild it as native PPTX shapes via pptxgenjs. Measuring the rendered DOM means this
// works for ANY deck — grid layouts and absolute `anchor:` slots alike — and round-trips
// an imported deck back to PowerPoint with its geometry intact. The result is fully
// editable in PowerPoint (real text boxes, runs, pictures), not a flat raster.
import { renderDeckHtml } from '../index.js';
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { injectAnim, type SlideAnim } from './inject-anim.js';

export interface PptxOptions {
  out: string;
  /** inject slide transitions (default true). */
  transitions?: boolean;
  /** inject per-paragraph build/entrance animations (default true). */
  builds?: boolean;
  /** embed the deck's web fonts into the file so it renders without them installed (default true). */
  embedFonts?: boolean;
}

// One styled run of text inside a region.
interface Run {
  text: string;
  bold?: boolean;
  italic?: boolean;
  underline?: boolean;
  color?: string; // RRGGBB
  sizePt?: number;
  font?: string;
  breakLine?: boolean;
  bullet?: boolean;
  b?: string | null; // data-build group of the paragraph this run belongs to (null = no build)
}
// A filled / bordered rectangle: a card, pill, full-slide colour panel, or free-layer box.
interface ShapeBox {
  x: number; y: number; w: number; h: number; // px, canvas-relative
  fill?: string; // RRGGBB
  fillAlpha?: number; // 0..1
  borderColor?: string;
  borderAlpha?: number; // 0..1
  borderWidth?: number; // px
  radius?: number; // px
}
// One measured text block (a paragraph / heading / list / inline-only container). Emitting
// one PPTX text box per block — each at its own measured box — reproduces the HTML's padding,
// per-paragraph gaps, vertical distribution and alignment, which a single per-region box loses.
interface TextBox {
  x: number; y: number; w: number; h: number; // px, canvas-relative
  align: string;
  lineSpacing?: number; // multiple of font size (e.g. 1.2)
  runs: Run[];
}
interface RegionBox {
  shapes: ShapeBox[];
  textBoxes: TextBox[];
  // `fit` = computed object-fit (drives pptxgenjs sizing). `cap` is a temp DOM marker so Node
  // can element-screenshot the rendered <img> when fetching its src fails; `data` is the
  // resolved data-URI payload; `shot` marks a screenshot fallback (already cropped — no sizing).
  imgs?: { x: number; y: number; w: number; h: number; src: string; fit?: string; cap?: string; data?: string; shot?: boolean }[];
  // Charts / inline SVG, captured as transparent PNGs (their internal <text> must not be
  // walked into text runs). `cap` is a temp DOM marker used to element-screenshot in Node.
  shots?: { x: number; y: number; w: number; h: number; cap: string; data?: string }[];
}
interface SlideData {
  // 'raster': a gradient or remote-url() background — Node screenshots the active slide's bg
  // layers (content hidden) into `data` so the PPTX background matches the render exactly.
  bg:
    | { type: 'color'; color: string }
    | { type: 'image'; src: string }
    | { type: 'raster'; data?: string }
    | null;
  regions: RegionBox[];
  transition: string; // slide transition name from the IR (e.g. fade, slide-left, morph)
  transitionMs?: number; // per-slide --transition-ms override, if any
}

// Runs in the page context (returned by page.evaluate). Kept as a stringified function so it
// ships to the browser; documents the DOM->structure extraction in one place.
//
// Text is measured at BLOCK granularity: one text box per leaf block (paragraph / heading /
// list / inline-only container), each at its own getBoundingClientRect. Copying the rendered
// position of every block reproduces card padding, per-paragraph gaps, vertical distribution
// and per-block alignment — a single per-region text box loses all of these (text flush to the
// card edges, paragraphs crammed under one uniform line spacing).
const EXTRACT = String.raw`
(function(){
  function rgbToHex(s){
    var m = (s||'').match(/[\d.]+/g);
    if(!m) return null;
    if(m.length>=4 && parseFloat(m[3])===0) return null; // fully transparent
    var r=+m[0],g=+m[1],b=+m[2];
    return ((1<<24)+(r<<16)+(g<<8)+b).toString(16).slice(1).toUpperCase();
  }
  function firstGradientColor(bgImg){
    if(!bgImg) return null;
    var hex = bgImg.match(/#([0-9a-fA-F]{6})/);
    if(hex) return hex[1].toUpperCase();
    var rgb = bgImg.match(/rgba?\([^)]+\)/);
    return rgb ? rgbToHex(rgb[0]) : null;
  }
  var curRegionFill = null; // a gradient-text region's stop colour (set while walking its runs)
  function runColor(cs){
    // gradient text fill renders the glyph colour transparent; recover the gradient's first
    // stop so the run isn't exported as invisible/black. A slot-level gradient (fill: <grad>
    // -> --region-fill, clipped to the text) lives on the REGION, not the run, so fall back to
    // the region's gradient stop before defaulting to black.
    var fill = cs.webkitTextFillColor || cs.color;
    var hex = rgbToHex(fill);
    if(hex) return hex;
    return firstGradientColor(cs.backgroundImage) || curRegionFill || '000000';
  }
  var BLOCK = {p:1,li:1,div:1,ul:1,ol:1,h1:1,h2:1,h3:1,h4:1,h5:1,h6:1,blockquote:1,tr:1,table:1,section:1,figure:1,pre:1};
  var TERMINAL = {p:1,h1:1,h2:1,h3:1,h4:1,h5:1,h6:1,blockquote:1,pre:1}; // always one text unit
  var WHOLE = {ul:1,ol:1,table:1}; // kept whole so bullets / rows stay in one box
  function skip(el){
    var t = el.tagName.toLowerCase();
    if(t==='img') return true;
    return !!(el.classList && (el.classList.contains('sl-chart')||el.classList.contains('sl-svg')));
  }
  function alphaOf(s){ var m=(s||'').match(/[\d.]+/g); return (m && m.length>=4) ? parseFloat(m[3]) : 1; }
  function extract(slideEl){
    var sRect = slideEl.getBoundingClientRect();
    function box(el){ var r = el.getBoundingClientRect(); return { x: r.left - sRect.left, y: r.top - sRect.top, w: r.width, h: r.height }; }
    var capId = 0; // per-slide marker id; selectors are scoped to .sl-active so reuse is safe

    // background: prefer the bg layer, else the slide's own background colour
    var bg = null;
    var bgl = slideEl.querySelector('.sl-layer-bg');
    var probes = bgl ? [bgl, slideEl] : [slideEl];
    for(var i=0;i<probes.length && !bg;i++){
      var cs = getComputedStyle(probes[i]);
      if(cs.backgroundImage && cs.backgroundImage.indexOf('url(')===0){
        var m = cs.backgroundImage.match(/url\(["']?(.+?)["']?\)/);
        // data: images embed directly; remote url() backgrounds get rasterised in Node (a
        // screenshot of the bg layers) so cover/position/dim survive instead of being dropped.
        if(m) bg = m[1].indexOf('data:')===0 ? { type:'image', src: m[1] } : { type:'raster' };
      } else if(cs.backgroundImage && cs.backgroundImage.indexOf('gradient')>=0){
        // gradients rasterise too — a first-stop colour approximation loses the gradient.
        bg = { type:'raster' };
      } else {
        var c = rgbToHex(cs.backgroundColor);
        if(c) bg = { type:'color', color: c };
      }
    }

    // walk a subtree into styled runs. curBuild = the data-build group inherited from the
    // nearest ancestor (null = appears with the slide); it rides on each run so paragraph
    // builds can be reconstructed.
    function walk(node, curBuild, runs){
      node.childNodes.forEach(function(ch){
        if(ch.nodeType===3){
          var t = ch.textContent;
          if(!t) return;
          if(!t.trim()){
            // collapse inter-run whitespace to a single joining space, so two adjacent inline
            // spans ("88 %" + "Beteiligung") don't concatenate into "88 %Beteiligung".
            var prev = runs[runs.length-1];
            if(prev && !prev.breakLine && !/\s$/.test(prev.text)) prev.text += ' ';
            return;
          }
          var cs = getComputedStyle(ch.parentElement);
          runs.push({
            text: t.replace(/\s+/g,' '),
            bold: parseInt(cs.fontWeight,10) >= 600 || undefined,
            italic: cs.fontStyle==='italic' || undefined,
            underline: (cs.textDecorationLine||'').indexOf('underline')>=0 || undefined,
            color: runColor(cs),
            sizePt: Math.round(parseFloat(cs.fontSize)*0.75*10)/10,
            font: (cs.fontFamily||'').split(',')[0].replace(/["']/g,'').trim(),
            b: curBuild
          });
        } else if(ch.nodeType===1){
          var tag = ch.tagName.toLowerCase();
          if(tag==='img') return;
          // charts / inline svg are captured as images — never walk their internal <text>
          if(ch.classList && (ch.classList.contains('sl-chart')||ch.classList.contains('sl-svg'))) return;
          if(tag==='br'){ if(runs.length) runs[runs.length-1].breakLine=true; return; }
          var bAttr = ch.getAttribute ? ch.getAttribute('data-build') : null;
          var childBuild = (bAttr!=null) ? bAttr : curBuild;
          var block = BLOCK[tag]===1;
          if(block && runs.length && !runs[runs.length-1].breakLine) runs[runs.length-1].breakLine=true;
          var first = runs.length;
          walk(ch, childBuild, runs);
          if(tag==='li' && runs[first]) runs[first].bullet=true;
          if(block && runs.length && !runs[runs.length-1].breakLine) runs[runs.length-1].breakLine=true;
        }
      });
    }
    // measure one element as a text box (null if it holds no text)
    function unitFromEl(el, curBuild){
      var runs = [];
      walk(el, curBuild, runs);
      if(runs.length) runs[runs.length-1].breakLine = false; // no trailing empty paragraph
      if(!runs.length) return null;
      var cs = getComputedStyle(el);
      var b = box(el);
      var lh = parseFloat(cs.lineHeight), fs = parseFloat(cs.fontSize);
      var ls = (isFinite(lh) && isFinite(fs) && fs>0) ? Math.round(lh/fs*100)/100 : undefined;
      return { x:b.x, y:b.y, w:b.w, h:b.h, align: cs.textAlign, lineSpacing: ls, runs: runs };
    }
    function hasBlockChild(el){
      for(var i=0;i<el.children.length;i++){
        var c = el.children[i];
        if(skip(c)) continue;
        if(BLOCK[c.tagName.toLowerCase()]===1) return true;
      }
      return false;
    }
    // Descend through wrapper / flex / build containers to the leaf text blocks; lists and
    // tables are kept whole. Each leaf is measured at its own box, so padding and per-paragraph
    // gaps come for free from the real rendered layout.
    function collectUnits(el, curBuild, out){
      if(!hasBlockChild(el)){
        var u = unitFromEl(el, curBuild);
        if(u) out.push(u);
        return;
      }
      for(var i=0;i<el.children.length;i++){
        var ch = el.children[i];
        if(skip(ch)) continue;
        var tag = ch.tagName.toLowerCase();
        var bAttr = ch.getAttribute ? ch.getAttribute('data-build') : null;
        var childBuild = (bAttr!=null) ? bAttr : curBuild;
        if(WHOLE[tag]===1 || TERMINAL[tag]===1){
          var u = unitFromEl(ch, childBuild);
          if(u) out.push(u);
        } else if(hasBlockChild(ch)){
          collectUnits(ch, childBuild, out);
        } else {
          var u2 = unitFromEl(ch, childBuild);
          if(u2) out.push(u2);
        }
      }
    }

    var regions = [];
    slideEl.querySelectorAll('.sl-region').forEach(function(region){
      var rcs = getComputedStyle(region);
      var rbox = box(region);
      var shapes = [];
      // a region with background-clip:text paints a gradient onto its TEXT, not a box.
      var clipText = (rcs.webkitBackgroundClip==='text' || rcs.backgroundClip==='text');
      var gradImg = (rcs.backgroundImage && rcs.backgroundImage.indexOf('gradient')>=0) ? firstGradientColor(rcs.backgroundImage) : null;
      curRegionFill = clipText ? gradImg : null;
      // region box fill / border / radius (cards, pills, colour panels, dark backgrounds)
      var fill = rgbToHex(rcs.backgroundColor);
      var fillAlpha = fill ? alphaOf(rcs.backgroundColor) : 1;
      if(!fill && gradImg && !clipText){ fill = gradImg; fillAlpha = 1; }
      var bw = parseFloat(rcs.borderTopWidth) || 0;
      var borderColor = bw>0 ? rgbToHex(rcs.borderTopColor) : null;
      var borderAlpha = borderColor ? alphaOf(rcs.borderTopColor) : 1;
      var radius = parseFloat(rcs.borderTopLeftRadius) || 0;
      if(fill || borderColor){
        shapes.push({ x:rbox.x, y:rbox.y, w:rbox.w, h:rbox.h,
          fill: fill || undefined, fillAlpha: fillAlpha,
          borderColor: borderColor || undefined, borderAlpha: borderAlpha,
          borderWidth: bw || undefined, radius: radius || undefined });
      }
      // free-layer placed boxes (.sl-shape) carry their own fill / border / radius
      region.querySelectorAll('.sl-shape').forEach(function(sh){
        var scs = getComputedStyle(sh);
        var sclip = (scs.webkitBackgroundClip==='text' || scs.backgroundClip==='text');
        var sgrad = (scs.backgroundImage && scs.backgroundImage.indexOf('gradient')>=0) ? firstGradientColor(scs.backgroundImage) : null;
        var sfill = rgbToHex(scs.backgroundColor);
        if(!sfill && sgrad && !sclip) sfill = sgrad;
        var sbw = parseFloat(scs.borderTopWidth) || 0;
        var sbc = sbw>0 ? rgbToHex(scs.borderTopColor) : null;
        if(!sfill && !sbc) return;
        var sb = box(sh);
        shapes.push({ x:sb.x, y:sb.y, w:sb.w, h:sb.h,
          fill: sfill || undefined, fillAlpha: sfill ? alphaOf(scs.backgroundColor) : 1,
          borderColor: sbc || undefined, borderAlpha: sbc ? alphaOf(scs.borderTopColor) : 1,
          borderWidth: sbw || undefined, radius: (parseFloat(scs.borderTopLeftRadius)||0) || undefined });
      });
      // images (image slots + any placed images) — record object-fit (drives pptxgenjs sizing)
      // and tag each with a data-sl-cap marker so Node can element-screenshot the rendered <img>
      // (while its slide is active) if fetching the src fails.
      var imgs = [];
      region.querySelectorAll('img').forEach(function(im){
        if(im.closest('.sl-chart, .sl-svg')) return;
        var ib = box(im);
        if(ib.w>1 && ib.h>1 && im.src){
          var icap = String(capId++);
          im.setAttribute('data-sl-cap', icap);
          imgs.push({ x:ib.x, y:ib.y, w:ib.w, h:ib.h, src: im.src,
            fit: getComputedStyle(im).objectFit || undefined, cap: icap });
        }
      });
      // charts (mermaid/echarts) + inline svg → tag each for an element screenshot in Node
      var shots = [];
      region.querySelectorAll('.sl-chart, .sl-svg').forEach(function(cel){
        if(cel.parentElement && cel.parentElement.closest('.sl-chart, .sl-svg')) return; // skip nested
        var cb = box(cel);
        if(cb.w<2 || cb.h<2) return;
        var cap = String(capId++);
        cel.setAttribute('data-sl-cap', cap);
        shots.push({ x:cb.x, y:cb.y, w:cb.w, h:cb.h, cap:cap });
      });
      // text, measured at block granularity
      var textBoxes = [];
      collectUnits(region, null, textBoxes);
      curRegionFill = null;
      if(shapes.length || textBoxes.length || imgs.length || shots.length){
        regions.push({
          shapes: shapes, textBoxes: textBoxes,
          imgs: imgs.length ? imgs : undefined,
          shots: shots.length ? shots : undefined
        });
      }
    });
    return { bg: bg, regions: regions };
  }
  return extract;
})()
`;

async function loadPlaywright(): Promise<typeof import('playwright')> {
  try {
    return await import('playwright');
  } catch {
    throw new Error('PPTX export needs Playwright. Install it:\n  npm install playwright\n  npx playwright install chromium');
  }
}

function mapAlign(a: string): 'left' | 'center' | 'right' | 'justify' {
  if (a === 'center') return 'center';
  if (a === 'right' || a === 'end') return 'right';
  if (a === 'justify') return 'justify';
  return 'left';
}

const PX_PER_IN = 96;

// ---- remote image resolution (fetch-first, screenshot fallback) -----------------------------
// Hosted decks reference http(s) image URLs (org asset store, Unsplash, ...). pptxgenjs needs
// bytes, so fetch each src once per process (module-level cache — repeated exports and repeated
// uses of one asset pay one fetch) and fall back to an element screenshot of the rendered <img>
// when the fetch fails (auth-walled CDN, dead URL). Never fails the export.
const IMG_UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';
const IMG_FETCH_TIMEOUT_MS = 30_000;
const IMG_FETCH_MAX_BYTES = 20 * 1024 * 1024;
const imgFetchCache = new Map<string, Promise<{ data: string } | null>>();

function sniffImageMime(buf: Buffer): string | null {
  if (buf.length >= 8 && buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47) return 'image/png';
  if (buf.length >= 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'image/jpeg';
  if (buf.length >= 6 && buf.subarray(0, 4).toString('latin1') === 'GIF8') return 'image/gif';
  if (buf.length >= 12 && buf.subarray(0, 4).toString('latin1') === 'RIFF' && buf.subarray(8, 12).toString('latin1') === 'WEBP') return 'image/webp';
  const head = buf.subarray(0, 256).toString('utf8').trimStart().toLowerCase();
  if (head.startsWith('<svg') || head.startsWith('<?xml')) return 'image/svg+xml';
  return null;
}

function fetchImageData(src: string): Promise<{ data: string } | null> {
  let p = imgFetchCache.get(src);
  if (!p) {
    p = (async () => {
      const ctrl = new AbortController();
      const t = setTimeout(() => ctrl.abort(), IMG_FETCH_TIMEOUT_MS);
      try {
        const r = await fetch(src, { headers: { 'User-Agent': IMG_UA }, signal: ctrl.signal });
        if (!r.ok) return null;
        const buf = Buffer.from(await r.arrayBuffer());
        if (!buf.length || buf.length > IMG_FETCH_MAX_BYTES) return null;
        const ct = (r.headers.get('content-type') || '').split(';')[0].trim();
        const mime = ct.startsWith('image/') ? ct : sniffImageMime(buf);
        if (!mime) return null; // not an image payload — let the screenshot fallback handle it
        return { data: `data:${mime};base64,${buf.toString('base64')}` };
      } catch {
        return null;
      } finally {
        clearTimeout(t);
      }
    })();
    imgFetchCache.set(src, p);
  }
  return p;
}

export async function exportPptx(
  deckPath: string,
  opts: PptxOptions,
  injected?: import('playwright').Browser,
): Promise<string> {
  const source = readFileSync(deckPath, 'utf8');
  const { html, ir } = renderDeckHtml(source, dirname(resolve(deckPath)), { mode: 'web', inline: true });
  const W = ir.canvas.width;
  const H = ir.canvas.height;

  const { chromium } = await loadPlaywright();
  const browser = injected ?? (await chromium.launch());
  let slidesData: SlideData[];
  try {
    const page = await browser.newPage({ viewport: { width: W, height: H }, deviceScaleFactor: 1 });
    // Pin the stage at 1:1 (no fit-scaling) so getBoundingClientRect is in canvas px.
    const doc = html.replace(
      '</head>',
      '<style>.sl-stage{transform:none !important;}.sl-counter,.sl-progress,.sl-notes,.sl-help{display:none !important;}</style></head>',
    );
    await page.setContent(doc, { waitUntil: 'networkidle' });
    await page.evaluate(() => (document as any).fonts?.ready);
    // Render charts (lazy) and wait until they settle before measuring the DOM. Gated on the
    // chart-lib signal + 3-arg waitForFunction form — see render-png/shoot.ts's shootHtml.
    if (doc.includes('id="sl-mermaid-lib"') || doc.includes('id="sl-echart-lib"')) {
      await page.evaluate(() => (window as any).__slaideCharts?.renderAll());
      await page
        .waitForFunction(() => (window as any).__slaideChartsReady === true, undefined, { timeout: 8000 })
        .catch(() => {});
    }
    await page.waitForTimeout(300);
    slidesData = [];
    for (let i = 0; i < ir.slides.length; i++) {
      await page.evaluate((n) => (window as any).slaide.show(n), i);
      await page.waitForTimeout(80);
      const data = (await page.evaluate(
        ([extractSrc]) => {
          const extract = eval(extractSrc as string);
          const slide = document.querySelector('.sl-slide.sl-active') || document.querySelectorAll('.sl-slide')[0];
          return extract(slide);
        },
        [EXTRACT],
      )) as SlideData;
      // Screenshot each tagged chart/svg element (transparent PNG) on the active slide.
      for (const region of data.regions) {
        if (!region.shots) continue;
        for (const shot of region.shots) {
          const handle = await page.$(`.sl-slide.sl-active [data-sl-cap="${shot.cap}"]`);
          if (!handle) continue;
          const png = await handle.screenshot({ omitBackground: true });
          shot.data = 'data:image/png;base64,' + Buffer.from(png).toString('base64');
        }
      }
      // Resolve each image to bytes while its slide is still active: data: srcs pass through,
      // http(s) srcs are fetched (module-level cache), and a failed fetch falls back to an
      // element screenshot of the rendered <img> (same pattern as the chart shots above).
      for (const region of data.regions) {
        for (const im of region.imgs ?? []) {
          if (im.src.startsWith('data:')) continue;
          if (/^https?:/i.test(im.src)) {
            const fetched = await fetchImageData(im.src);
            if (fetched) { im.data = fetched.data; continue; }
          }
          if (!im.cap) continue;
          const handle = await page.$(`.sl-slide.sl-active [data-sl-cap="${im.cap}"]`);
          if (!handle) continue;
          try {
            const png = await handle.screenshot({ omitBackground: true });
            im.data = 'data:image/png;base64,' + Buffer.from(png).toString('base64');
            im.shot = true; // already cropped to its rendered box — emit without sizing
          } catch { /* image dropped from the export rather than failing it */ }
        }
      }
      // Raster backgrounds (gradient or remote-url()): hide the content layers, screenshot the
      // active slide (bg layers only), restore. JPEG q90 — backgrounds are opaque and large.
      if (data.bg?.type === 'raster') {
        await page.evaluate(() => {
          const st = document.createElement('style');
          st.id = 'sl-pptx-bg-shot';
          st.textContent =
            '.sl-slide.sl-active .sl-layer-content,.sl-slide.sl-active .sl-layer-chrome,.sl-slide.sl-active .sl-layer-free{visibility:hidden !important}';
          document.head.appendChild(st);
        });
        try {
          const slideEl = await page.$('.sl-slide.sl-active');
          if (slideEl) {
            const jpg = await slideEl.screenshot({ type: 'jpeg', quality: 90 });
            data.bg.data = 'data:image/jpeg;base64,' + Buffer.from(jpg).toString('base64');
          }
        } catch { /* background falls back to none rather than failing the export */ }
        await page.evaluate(() => document.getElementById('sl-pptx-bg-shot')?.remove());
      }
      data.transition = ir.slides[i].transition;
      const tms = ir.slides[i].vars['--transition-ms'];
      data.transitionMs = tms ? parseInt(tms, 10) : undefined;
      slidesData.push(data);
    }
  } finally {
    if (!injected) await browser.close();
  }

  let mod: any;
  try {
    mod = await import('pptxgenjs');
  } catch {
    throw new Error('PPTX export needs pptxgenjs (an optional dependency). Install it:\n  npm install pptxgenjs');
  }
  const PptxGen = mod.default ?? mod;
  const pptx = new PptxGen();
  pptx.defineLayout({ name: 'slaide', width: W / PX_PER_IN, height: H / PX_PER_IN });
  pptx.layout = 'slaide';
  if (ir.meta.title) pptx.title = ir.meta.title;
  if (ir.meta.author) pptx.author = ir.meta.author;

  const stripData = (s: string) => s.replace(/^data:/, '');

  const inch = (px: number) => px / PX_PER_IN;

  for (const data of slidesData) {
    const slide = pptx.addSlide();
    if (data.bg?.type === 'color') slide.background = { color: data.bg.color };
    else if (data.bg?.type === 'image' && data.bg.src.startsWith('data:')) slide.background = { data: stripData(data.bg.src) };
    else if (data.bg?.type === 'raster' && data.bg.data) slide.background = { data: stripData(data.bg.data) };

    // Regions are walked in DOM order = paint order, so shapes/images/text stack correctly.
    const transp = (a?: number) => (a !== undefined && a < 1 ? Math.round((1 - a) * 100) : undefined);
    for (const r of data.regions) {
      // 1. box fills / borders (region cards, pills, colour panels, free-layer boxes)
      for (const s of r.shapes) {
        const shapeOpts: any = {
          x: inch(s.x), y: inch(s.y), w: inch(s.w), h: inch(s.h),
          fill: s.fill ? { color: s.fill, transparency: transp(s.fillAlpha) } : { type: 'none' },
        };
        if (s.borderColor) shapeOpts.line = { color: s.borderColor, transparency: transp(s.borderAlpha), width: Math.max(0.5, (s.borderWidth ?? 1) * 0.75) };
        if (s.radius) shapeOpts.rectRadius = inch(Math.min(s.radius, s.w / 2, s.h / 2));
        slide.addShape(s.radius ? ('roundRect' as any) : ('rect' as any), shapeOpts);
      }

      // 2. images (image slots + placed images) — `data` is the fetched/screenshotted payload,
      //    data: srcs pass straight through. object-fit maps to pptxgenjs sizing so a cover-
      //    cropped photo exports cropped instead of squashed; screenshot fallbacks are already
      //    cropped to their rendered box, so they get no sizing.
      for (const im of r.imgs ?? []) {
        const payload = im.data ?? (im.src.startsWith('data:') ? im.src : null);
        if (!payload) continue;
        const imgOpts: any = { data: stripData(payload), x: inch(im.x), y: inch(im.y), w: inch(im.w), h: inch(im.h) };
        if (!im.shot) {
          if (im.fit === 'cover') imgOpts.sizing = { type: 'cover', w: inch(im.w), h: inch(im.h) };
          else if (im.fit === 'contain') imgOpts.sizing = { type: 'contain', w: inch(im.w), h: inch(im.h) };
        }
        slide.addImage(imgOpts);
      }

      // 2b. charts / inline svg captured as transparent PNGs
      for (const s of r.shots ?? []) {
        if (s.data) slide.addImage({ data: stripData(s.data), x: inch(s.x), y: inch(s.y), w: inch(s.w), h: inch(s.h) });
      }

      // 3. text — one box per measured block, at its real position (preserves padding, gaps,
      //    per-block alignment). valign:'middle' anchors each block on its stable centre so a
      //    PowerPoint line box slightly taller than the HTML one grows symmetrically, not down.
      for (const tb of r.textBoxes) {
        const runs = tb.runs.map((run) => ({
          text: run.text,
          options: {
            bold: run.bold,
            italic: run.italic,
            underline: run.underline ? { style: 'sng' as const } : undefined,
            color: run.color,
            fontSize: run.sizePt,
            fontFace: run.font,
            breakLine: run.breakLine,
            bullet: run.bullet ? true : undefined,
          },
        }));
        slide.addText(runs as any, {
          x: inch(tb.x), y: inch(tb.y), w: inch(tb.w), h: inch(tb.h),
          align: mapAlign(tb.align),
          valign: 'middle',
          margin: 0,
          autoFit: false,
          wrap: true,
          lineSpacingMultiple: tb.lineSpacing && tb.lineSpacing > 0.5 && tb.lineSpacing < 3 ? tb.lineSpacing : undefined,
        });
      }
    }
  }

  // pptxgenjs cannot emit transitions or build animations, so write to a buffer and splice the
  // missing OOXML in with one zip pass (see inject-anim.ts). Each kind is opt-out via PptxOptions.
  let buf = (await pptx.write({ outputType: 'nodebuffer' })) as Buffer;
  const anims: SlideAnim[] = slidesData.map((d) => ({
    transition: opts.transitions === false ? undefined : { name: d.transition, durationMs: d.transitionMs ?? ir.transitions.duration },
    // One build spec per text box, in add order (= document order of text-bearing <p:sp>),
    // so inject-anim's textSpids() line up 1:1.
    builds: opts.builds === false ? undefined : d.regions.flatMap((r) => r.textBoxes.map((tb) => ({ pBuilds: paragraphBuilds(tb.runs) }))),
  }));
  buf = await injectAnim(buf, anims, { safe: false });
  // Embed the deck's web fonts (best-effort) so the file renders on machines that lack them.
  if (opts.embedFonts !== false && ir.fontImports.length) {
    const { embedFonts } = await import('./embed-fonts.js');
    buf = await embedFonts(buf, ir.fontImports);
  }
  writeFileSync(opts.out, buf);
  return opts.out;
}

// Split a region's runs into paragraphs (pptxgenjs starts a new paragraph after each run whose
// breakLine is set) and flag the ones that carry a build, so they can reveal on click.
function paragraphBuilds(runs: Run[]): boolean[] {
  const flags: boolean[] = [];
  let cur = false;
  for (const r of runs) {
    if (r.b != null) cur = true;
    if (r.breakLine) {
      flags.push(cur);
      cur = false;
    }
  }
  flags.push(cur); // trailing paragraph (EXTRACT clears the last run's breakLine)
  return flags;
}
