// Copyright 2026 AIVory, Inc.
// SPDX-License-Identifier: Apache-2.0
// Export-time optimizers. Like the PDF/PNG/PPTX paths these drive a headless Chromium
// (Playwright, an optional dependency) — there is no new runtime dependency.
//
//  - bakeCharts: pre-render ```mermaid / ```echart charts to STATIC inline SVG and remove
//    the engine bundles + boot script, so an exported .html carries no chart-engine code.
//    A `chartCache` makes this incremental: each chart is keyed by its source + theme hash,
//    so an unchanged chart is injected from cache (no browser) and only new/changed charts
//    hit Chromium — and if EVERY chart is cached the bake runs with no browser at all.
//  - image optimization: downscale to a max width and re-encode raster images to shrink
//    exported files — WebP for inlined HTML (best ratio, keeps alpha), format-preserving
//    for .slaidec assets (so the on-disk filename/reference stays valid).
import { createHash } from 'node:crypto';
import type { Page } from 'playwright';

/**
 * A content-addressed store of baked chart SVGs. `themeHash` folds the deck's resolved chart
 * tokens into the key so a re-theme re-bakes; `get` returns a cached SVG (or null), `put` stores
 * a freshly baked one. Implementations MUST be write-once per hash (never overwrite) so a given
 * (source, theme) always maps to identical bytes — that is what keeps a `.slaidec` re-pack
 * byte-identical (baked SVG bytes, e.g. mermaid element ids, are not stable across re-bakes).
 */
export interface ChartCache {
  themeHash: string;
  get(hash: string): string | null;
  put(hash: string, svg: string): void;
}

/** Empty `.sl-chart` placeholder element (div=echart / pre=mermaid), pre-boot (no SVG yet). */
const CHART_EL_RE = /<(div|pre)\b([^>]*\bclass="[^"]*\bsl-chart\b[^"]*"[^>]*)>\s*<\/\1>/g;

export function chartHash(b64: string, themeHash: string): string {
  return createHash('sha1').update(b64 + '|' + themeHash).digest('hex');
}

interface ChartPlaceholder { full: string; tag: string; attrs: string; b64: string }

function scanCharts(html: string): ChartPlaceholder[] {
  const out: ChartPlaceholder[] = [];
  CHART_EL_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = CHART_EL_RE.exec(html))) {
    const dm = /data-(?:option|graph)="([^"]*)"/.exec(m[2]);
    if (dm) out.push({ full: m[0], tag: m[1], attrs: m[2], b64: dm[1] });
  }
  return out;
}

/** Remove the inert chart-lib blobs + the boot `<script>` — the browser never runs a chart engine. */
function stripChartEngine(html: string): string {
  return html
    .replace(/<script type="text\/plain" id="sl-(?:mermaid|echart)-lib">[\s\S]*?<\/script>\s*/g, '')
    .replace(/<script>(?:(?!<\/script>)[\s\S])*?__slaideCharts(?:(?!<\/script>)[\s\S])*?<\/script>\s*/g, '');
}

/**
 * Inject baked SVGs from `cache` into a render's chart placeholders (no browser). Strips the chart
 * engine (lib blobs + boot script) ONLY when every chart was injected, so a partial cache degrades
 * to the live boot rather than a blank chart. Used by the all-cached fast path below AND by the
 * engine to serve an editor render: the bake runs on a CLEAN (non-editable) render to fill the
 * cache, then these SVGs are injected into the editable html (which must never be run in Chromium).
 */
export function injectBakedCharts(html: string, cache: ChartCache): { html: string; injected: number; total: number } {
  const charts = scanCharts(html);
  let injected = 0;
  let out = html;
  for (const c of charts) {
    const svg = cache.get(chartHash(c.b64, cache.themeHash));
    if (svg == null) continue;
    injected++;
    const cleanAttrs = c.attrs.replace(/\s*data-(?:option|graph)="[^"]*"/g, '');
    out = out.replace(c.full, `<${c.tag}${cleanAttrs} data-rendered="1">${svg}</${c.tag}>`);
  }
  if (injected === charts.length) out = stripChartEngine(out);
  return { html: out, injected, total: charts.length };
}

/** Image optimization knobs. `quality` is 1..100; `maxWidth` downscales (never upscales). */
export interface ImageOpts {
  maxWidth?: number;
  quality?: number;
}

async function loadPlaywright(): Promise<typeof import('playwright')> {
  try {
    return await import('playwright');
  } catch {
    throw new Error(
      'This export option needs Playwright:\n  npm install playwright\n  npx playwright install chromium',
    );
  }
}

/** Decode a data URI in the page, optionally downscale to maxWidth, re-encode to `mime`@quality. */
function recode(page: Page, dataUri: string, mime: string, o: ImageOpts): Promise<string> {
  return page.evaluate(
    async (a: { uri: string; mime: string; maxWidth: number; quality: number }) => {
      const img = new Image();
      const ok = await new Promise<boolean>((res) => {
        img.onload = () => res(true);
        img.onerror = () => res(false);
        img.src = a.uri;
      });
      if (!ok || !img.naturalWidth) return a.uri;
      const w = img.naturalWidth;
      const h = img.naturalHeight;
      const scale = a.maxWidth && w > a.maxWidth ? a.maxWidth / w : 1;
      const cw = Math.max(1, Math.round(w * scale));
      const ch = Math.max(1, Math.round(h * scale));
      const c = document.createElement('canvas');
      c.width = cw;
      c.height = ch;
      const ctx = c.getContext('2d');
      if (!ctx) return a.uri;
      ctx.drawImage(img, 0, 0, cw, ch);
      try {
        return c.toDataURL(a.mime, a.quality / 100);
      } catch {
        return a.uri;
      }
    },
    { uri: dataUri, mime, maxWidth: o.maxWidth ?? 0, quality: o.quality ?? 80 },
  );
}

// Matches inlined raster data URIs (NOT svg+xml — vectors are already tiny).
const DATAURI_RE = /data:image\/(?:png|jpe?g|webp);base64,[A-Za-z0-9+/=]+/g;

async function optimizeImagesInHtml(page: Page, html: string, o: ImageOpts): Promise<string> {
  const uris = Array.from(new Set(html.match(DATAURI_RE) ?? []));
  let out = html;
  for (const uri of uris) {
    // WebP keeps transparency and gives the best ratio for inlined HTML.
    const webp = await recode(page, uri, 'image/webp', o);
    if (webp && webp.startsWith('data:') && webp.length < uri.length) out = out.split(uri).join(webp);
  }
  return out;
}

/** Bake charts and/or optimize inlined images for a standalone HTML export, in one session. */
export async function optimizeExportHtml(
  html: string,
  opts: {
    canvas: { width: number; height: number };
    bake?: boolean;
    image?: ImageOpts;
    browser?: import('playwright').Browser;
    chartCache?: ChartCache;
  },
): Promise<string> {
  // Real charts are present only when an engine lib tag was injected (the `.sl-chart`
  // class string is always in the stylesheet, so don't key off that).
  const needBake = !!opts.bake && (html.includes('id="sl-mermaid-lib"') || html.includes('id="sl-echart-lib"'));
  if (!needBake && !opts.image) return html;

  // Resolve the chart cache BEFORE touching a browser: a fully-cached deck bakes with no Chromium
  // (and even without Playwright installed). Only cache misses need a headless render.
  let charts: ChartPlaceholder[] = [];
  const cachedByB64: Record<string, string> = {};
  if (needBake && opts.chartCache) {
    charts = scanCharts(html);
    for (const c of charts) {
      const svg = opts.chartCache.get(chartHash(c.b64, opts.chartCache.themeHash));
      if (svg != null) cachedByB64[c.b64] = svg;
    }
    const allCached = charts.length > 0 && charts.every((c) => c.b64 in cachedByB64);
    if (allCached && !opts.image) return injectBakedCharts(html, opts.chartCache).html;
  }

  const { chromium } = await loadPlaywright();
  const browser = opts.browser ?? (await chromium.launch());
  try {
    const page = await browser.newPage({ viewport: { width: opts.canvas.width, height: opts.canvas.height } });
    let out = html;
    if (needBake) {
      await page.setContent(out, { waitUntil: 'networkidle' });
      await page.evaluate(() => (document as any).fonts?.ready);
      // Pre-inject cached SVGs (marked data-rendered so the boot skips them) — only misses render.
      await page.evaluate((cached: Record<string, string>) => {
        document.querySelectorAll('.sl-chart').forEach((el) => {
          const b64 = el.getAttribute('data-option') || el.getAttribute('data-graph') || '';
          if (b64 && cached[b64] != null) {
            el.innerHTML = cached[b64];
            el.setAttribute('data-rendered', '1');
            el.setAttribute('data-cache-hit', '1');
          }
        });
      }, cachedByB64);
      // Render each (uncached) chart with ITS slide active — a chart sizes to its slot, and a slot
      // in a flowing/box layout measures wrong while a different slide is active (the live runtime
      // avoids this by only rendering a chart when its slide becomes active). Stepping through
      // matches that, so a baked chart lands exactly where the live renderer puts it.
      await page.evaluate(async () => {
        const w = window as any;
        const slides = Array.from(document.querySelectorAll('.sl-slide'));
        for (let i = 0; i < slides.length; i++) {
          const s = slides[i] as HTMLElement;
          if (!s.querySelector('.sl-chart:not([data-rendered])')) continue;
          if (w.slaide && typeof w.slaide.goTo === 'function') w.slaide.goTo(i);
          await new Promise((r) => setTimeout(r, 90)); // let layout settle on the now-active slide
          if (w.__slaideCharts) await w.__slaideCharts.renderIn(s);
        }
        w.__slaideChartsReady = true;
      });
      await page
        .waitForFunction(() => (window as any).__slaideChartsReady === true, { timeout: 8000 })
        .catch(() => {});
      const res = await page.evaluate(() => {
        const fresh: Record<string, string> = {};
        // Freeze each chart as its rendered SVG; capture the newly-rendered ones for the cache;
        // drop the now-useless data + engine plumbing.
        document.querySelectorAll('.sl-chart').forEach((el) => {
          const svg = el.querySelector('svg') as SVGSVGElement | null;
          const b64 = el.getAttribute('data-option') || el.getAttribute('data-graph') || '';
          const cacheHit = el.getAttribute('data-cache-hit') === '1';
          if (svg) {
            // ECharts renders the SVG `position:absolute` inside its own sizing wrapper. Frozen
            // as the chart's only child that wrapper is gone, so the absolute SVG escapes to the
            // slide origin — pin it back to normal flow (it's centred by the .sl-chart flexbox).
            svg.style.position = 'static';
            svg.style.left = '';
            svg.style.top = '';
            el.innerHTML = svg.outerHTML;
            if (!cacheHit && b64) fresh[b64] = svg.outerHTML;
          }
          el.removeAttribute('data-graph');
          el.removeAttribute('data-option');
          el.removeAttribute('data-rendered');
          el.removeAttribute('data-cache-hit');
        });
        document.querySelectorAll('#sl-mermaid-lib, #sl-echart-lib').forEach((n) => n.remove());
        document.querySelectorAll('script').forEach((s) => {
          if (s.textContent && s.textContent.indexOf('__slaideCharts') >= 0) s.remove();
        });
        // Drop transient runtime state so the static file opens clean (the nav runtime re-inits).
        const stage = document.querySelector('.sl-stage') as HTMLElement | null;
        if (stage) stage.style.transform = '';
        document.querySelectorAll('.sl-active').forEach((s) => s.classList.remove('sl-active'));
        document.querySelectorAll('.sl-shown').forEach((s) => s.classList.remove('sl-shown'));
        // Stepping slides to bake charts leaves mid-flight transition classes on the slides
        // (animationend never fires within the headless freeze window) — strip every sl-anim-*
        // so the static file doesn't play the cover's out-transition on load (a black first slide).
        document.querySelectorAll('.sl-slide').forEach((s) => {
          Array.from(s.classList).forEach((c) => {
            if (c.indexOf('sl-anim-') === 0) s.classList.remove(c);
          });
        });
        return { html: '<!doctype html>\n' + document.documentElement.outerHTML, fresh };
      });
      out = res.html;
      // Persist newly-baked SVGs (write-once per hash — never overwrite a cached entry).
      if (opts.chartCache) {
        for (const [b64, svg] of Object.entries(res.fresh)) {
          opts.chartCache.put(chartHash(b64, opts.chartCache.themeHash), svg);
        }
      }
    }
    if (opts.image) out = await optimizeImagesInHtml(page, out, opts.image);
    return out;
  } finally {
    if (!opts.browser) await browser.close();
  }
}

/** Re-encode raster asset buffers, KEEPING each one's format (so its filename stays valid).
 *  Returns a buffer only when smaller. Used when packing a `.slaidec`. */
export async function optimizeImageBuffers(
  files: { name: string; buf: Buffer }[],
  o: ImageOpts,
  injected?: import('playwright').Browser,
): Promise<Map<string, Buffer>> {
  const result = new Map<string, Buffer>();
  const targets = files.filter((f) => /\.(png|jpe?g|webp)$/i.test(f.name));
  if (!targets.length) return result;
  const { chromium } = await loadPlaywright();
  const browser = injected ?? (await chromium.launch());
  try {
    const page = await browser.newPage();
    for (const f of targets) {
      const ext = (f.name.match(/\.(png|jpe?g|webp)$/i)?.[1] || '').toLowerCase();
      const mime = ext === 'png' ? 'image/png' : ext === 'webp' ? 'image/webp' : 'image/jpeg';
      const re = await recode(page, `data:${mime};base64,${f.buf.toString('base64')}`, mime, o);
      if (re && re.startsWith('data:')) {
        const b = Buffer.from(re.split(',')[1] ?? '', 'base64');
        if (b.length && b.length < f.buf.length) result.set(f.name, b);
      }
    }
    return result;
  } finally {
    if (!injected) await browser.close();
  }
}
