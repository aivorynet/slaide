// Copyright 2026 AIVory, Inc.
// SPDX-License-Identifier: Apache-2.0
// Chart engines (Mermaid diagrams + ECharts data viz), inlined but LAZILY booted.
//
// Each engine's minified UMD bundle ships base64-encoded (see *-lib.generated.ts) and is
// placed by html.ts into an inert `<script type="text/plain">` tag — it is NOT parsed or
// executed on load. The small boot loader below decodes + evals a bundle the *first* time
// one of its charts needs rendering, then renders to inline SVG (themed from the deck's
// CSS vars). Both engines render in the browser, so the same path covers the web runtime
// and the headless-Chromium outputs (PNG/PDF/PPTX).
export { MERMAID_LIB_B64 } from './mermaid-lib.generated.js';
export { ECHART_LIB_B64 } from './echarts-lib.generated.js';

// Vanilla JS, no template literals inside (so it is safe in this String.raw block).
// Exposes window.__slaideCharts = { renderAll, renderIn } and sets
// window.__slaideChartsReady = true once renderAll settles (or immediately if the deck
// has no charts, so the exporters' waitForFunction never hangs).
export const CHARTS_BOOT_JS = String.raw`
(function(){
  if(window.__slaideCharts) return;
  var booted = {};
  var idc = 0;

  function cssVar(name, fallback){
    var v = getComputedStyle(document.documentElement).getPropertyValue(name);
    v = (v||'').trim();
    return v || fallback;
  }
  function b64decode(b64){
    var bin = atob((b64||'').trim());
    var bytes = new Uint8Array(bin.length);
    for(var i=0;i<bin.length;i++) bytes[i] = bin.charCodeAt(i);
    return new TextDecoder('utf-8').decode(bytes);
  }

  // Eval an engine's vendored bundle exactly once, then configure its theme from the
  // deck's CSS custom properties so charts come out on-brand automatically.
  function ensure(engine){
    if(booted[engine]) return booted[engine];
    var global = engine==='echart' ? window.echarts : engine==='mermaid' ? window.mermaid : null;
    if(!global){
      var tag = document.getElementById('sl-'+engine+'-lib');
      if(!tag) return null;
      try{ (0,eval)(b64decode(tag.textContent)); }
      catch(e){ console.error('slaide: failed to boot '+engine, e); return null; }
    }

    if(engine==='mermaid' && window.mermaid){
      var mSlide = document.querySelector('.sl-slide');
      var font = cssVar('--font-sans','') || (mSlide ? getComputedStyle(mSlide).fontFamily : '') || 'system-ui, sans-serif';
      window.mermaid.initialize({
        startOnLoad:false, securityLevel:'strict', theme:'base', fontFamily:font,
        themeVariables:{
          background:'transparent',
          primaryColor: cssVar('--color-surface', cssVar('--color-accent','#5B8CFF')),
          primaryTextColor: cssVar('--color-text','#ffffff'),
          primaryBorderColor: cssVar('--color-accent','#5B8CFF'),
          lineColor: cssVar('--color-accent','#5B8CFF'),
          secondaryColor: cssVar('--color-surface','#121A2B'),
          tertiaryColor: cssVar('--color-surface','#121A2B'),
          textColor: cssVar('--color-text','#ffffff'),
          fontFamily: font
        }
      });
      booted.mermaid = window.mermaid;
    } else if(engine==='echart' && window.echarts){
      var def = ['#5B8CFF','#A855F7','#2DD4BF','#34D399','#FB923C','#EC4899','#818CF8'];
      var list = cssVar('--chart-colors','');
      var colors = list ? list.split(',').map(function(s){return s.trim();}).filter(Boolean) : def;
      var accent = cssVar('--color-accent','');
      if(accent && colors.indexOf(accent)<0) colors = [accent].concat(colors);
      var text = cssVar('--color-text','#ffffff');
      var muted = cssVar('--color-muted','#8B93A7');
      var slideEl = document.querySelector('.sl-slide');
      var font = cssVar('--font-sans','') || (slideEl ? getComputedStyle(slideEl).fontFamily : '') || 'system-ui, sans-serif';
      var axis = {
        axisLine:{lineStyle:{color:muted}},
        axisTick:{lineStyle:{color:muted}},
        axisLabel:{color:muted},
        splitLine:{lineStyle:{color:'rgba(127,127,127,0.18)'}}
      };
      window.echarts.registerTheme('slaide', {
        color: colors, backgroundColor:'transparent',
        textStyle:{ fontFamily:font, color:text },
        title:{ textStyle:{ color:text } },
        legend:{ textStyle:{ color:muted } },
        categoryAxis: axis, valueAxis: axis, logAxis: axis, timeAxis: axis
      });
      booted.echart = window.echarts;
    }
    return booted[engine] || true;
  }

  function renderMermaid(el){
    if(!ensure('mermaid')) return Promise.resolve();
    var graph;
    try{ graph = b64decode(el.getAttribute('data-graph')); }
    catch(e){ return Promise.resolve(); }
    el.setAttribute('data-rendered','1');
    return window.mermaid.render('slm'+(idc++), graph).then(function(r){
      el.innerHTML = r.svg;
    }).catch(function(e){
      el.removeAttribute('data-rendered');
      el.innerHTML = '<pre style="white-space:pre-wrap;font-size:.6em;opacity:.7">'+String((e&&e.message)||e)+'</pre>';
    });
  }
  // How much vertical room the chart really has: from its own top edge down to the
  // bottom of the slide's content box, less anything stacked below it in the same
  // column. Returns 0 when that can't be worked out.
  function roomBelow(el){
    var layer = el.closest ? el.closest('.sl-layer-content') : null;
    if(!layer || !layer.clientHeight) return 0;
    var lr = layer.getBoundingClientRect(), er = el.getBoundingClientRect();
    var floorY = lr.bottom - (parseFloat(window.getComputedStyle(layer).paddingBottom)||0);
    var room = floorY - er.top;
    var kids = layer.getElementsByTagName('*');
    for(var i=0;i<kids.length;i++){
      var k = kids[i];
      if(k === el || el.contains(k) || k.contains(el)) continue;
      var r = k.getBoundingClientRect();
      if(!r.height || r.top < er.bottom - 1) continue;                  // above, or overlapping
      if(r.right <= er.left + 1 || r.left >= er.right - 1) continue;    // another column
      room = Math.min(room, floorY - er.top - r.height);
    }
    return Math.floor(room);
  }
  function renderEchart(el){
    if(!ensure('echart')) return Promise.resolve();
    var opt;
    try{ opt = JSON.parse(b64decode(el.getAttribute('data-option'))); }
    catch(e){ return Promise.resolve(); }
    // A chart in a content-sized grid row has no definite height to resolve against, so
    // it either collapses to 0 or takes an aspect-ratio guess that runs off the bottom of
    // the slide — bars clipped, category axis gone, and nothing says so. Guess only when
    // there is no height at all, and cap the result at the room the slide actually has.
    var w = el.clientWidth||600, h = el.clientHeight;
    var room = roomBelow(el);
    if(!h) h = Math.round(w*0.58);
    if(room > 60 && h > room) h = room;
    if(h !== el.clientHeight) el.style.height = h+'px';
    el.setAttribute('data-rendered','1');
    try{
      var inst = window.echarts.init(el, 'slaide', { renderer:'svg', width:w, height:h });
      // Slides are static stills captured to SVG/PNG/PDF; intro animation would otherwise
      // be caught mid-grow (e.g. bars at ~68% height) by the export screenshot/print.
      if(opt && opt.animation === undefined) opt.animation = false;
      inst.setOption(opt);
      el.__slEchart = inst;
      // Add a viewBox but KEEP the intrinsic width/height attributes: the print/PDF
      // rasterizer needs concrete dimensions (a percentage-sized SVG with no intrinsic
      // size prints distorted), and the viewBox lets CSS max-width/height scale it cleanly.
      var svg = el.querySelector('svg');
      if(svg && !svg.getAttribute('viewBox')){
        var wv = parseFloat(svg.getAttribute('width'))||w, hv = parseFloat(svg.getAttribute('height'))||h;
        svg.setAttribute('viewBox','0 0 '+wv+' '+hv);
        svg.setAttribute('preserveAspectRatio','xMidYMid meet');
      }
    }catch(e){ el.removeAttribute('data-rendered'); }
    return Promise.resolve();
  }
  function renderEl(el){
    if(el.getAttribute('data-rendered')) return Promise.resolve();
    if(el.classList.contains('sl-mermaid')) return renderMermaid(el);
    if(el.classList.contains('sl-echart'))  return renderEchart(el);
    return Promise.resolve();
  }
  function renderNodes(nodes){
    var ps=[]; for(var i=0;i<nodes.length;i++) ps.push(renderEl(nodes[i]));
    return Promise.all(ps);
  }
  function renderIn(root){
    return renderNodes((root||document).querySelectorAll('.sl-chart:not([data-rendered])'));
  }
  function renderAll(){
    return renderNodes(document.querySelectorAll('.sl-chart:not([data-rendered])')).then(function(){
      window.__slaideChartsReady = true;
    });
  }

  window.__slaideCharts = { renderAll:renderAll, renderIn:renderIn, renderEl:renderEl };

  // Render the slide as it becomes active (lazy) — attached synchronously so the runtime's
  // initial slaide:change (fired during parse, e.g. for a deep-linked chart slide) is caught.
  document.addEventListener('slaide:change', function(e){
    var slides = document.querySelectorAll('.sl-slide');
    var idx = (e && e.detail) ? e.detail.index : -1;
    if(idx>=0 && slides[idx]) renderIn(slides[idx]);
  });

  function start(){
    if(!document.querySelector('.sl-chart')){ window.__slaideChartsReady = true; return; }
    // print/PDF: every page is laid out at once and there is no navigation runtime.
    if(document.body && document.body.classList.contains('sl-print')){ renderAll(); return; }
    // web: render whatever slide is on screen right now; later slides render on navigation.
    var active = document.querySelector('.sl-slide.sl-active') || document.querySelector('.sl-slide');
    if(active) renderIn(active);
  }
  // Render on full load (not DOMContentLoaded): charts size to their slot, so the
  // stylesheet + layout must be applied first or ECharts measures a wrong height.
  if(document.readyState==='complete') start();
  else window.addEventListener('load', start);
})();
`;
