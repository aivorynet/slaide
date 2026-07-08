// Copyright 2026 AIVory, Inc.
// SPDX-License-Identifier: Apache-2.0
// Client runtime, emitted as an inline <script>. Vanilla JS, no dependencies.
// Operates on server-rendered DOM: .sl-stage > .sl-slide[data-index][data-transition].
export const RUNTIME_JS = String.raw`
(function(){
  var stage = document.querySelector('.sl-stage');
  if(!stage) return;
  var vp = document.querySelector('.sl-viewport');
  // Scope to the stage: a host (web editor) may clone .sl-slide into a filmstrip elsewhere in the
  // document; collecting from the whole document would pollute the count/index and navigation.
  var slides = Array.prototype.slice.call(stage.querySelectorAll('.sl-slide'));
  var CW = parseFloat(stage.dataset.w)||1280, CH = parseFloat(stage.dataset.h)||720;
  var notes = (window.__SLAIDE_NOTES__)||[];
  var cur = 0, step = 0, busy = false, pendingNav = null;
  var zoomFactor = 1, panX = 0, panY = 0;
  // When false, taps don't advance and drag-pan is off (for interactive embeds,
  // kiosk mode, or a host that drives navigation itself). Default: on.
  var navEnabled = true;

  // True when keyboard focus is in an editable field, so navigation keys (Space,
  // arrows) belong to the field and must not be hijacked for slide control.
  function isTyping(){
    var a = document.activeElement;
    return !!(a && (a.isContentEditable || /^(input|textarea|select)$/i.test(a.tagName||'')));
  }

  function buildCount(i){ return parseInt(slides[i].dataset.builds||'0',10); }

  function applyBuilds(slide, n){
    var els = slide.querySelectorAll('[data-build]');
    for(var i=0;i<els.length;i++){
      var b = parseInt(els[i].getAttribute('data-build'),10);
      els[i].classList.toggle('sl-shown', b<=n);
    }
  }

  function clampPan(s, vw, vh){
    // Limit pan to the overflow on each axis so the scaled stage can't drift
    // off-screen (only meaningful when zoomed in past fit).
    var ox = Math.max(0, (CW*s - vw)/2), oy = Math.max(0, (CH*s - vh)/2);
    panX = Math.max(-ox, Math.min(ox, panX));
    panY = Math.max(-oy, Math.min(oy, panY));
  }
  function cssVar(cs, name){ var n = parseFloat(cs.getPropertyValue(name)); return isFinite(n) ? n : 0; }
  function scale(){
    var pres = isPresenting();
    var cs = getComputedStyle(document.documentElement);
    var dl = pres ? 0 : cssVar(cs,'--sl-dock-left'), dr = pres ? 0 : cssVar(cs,'--sl-dock-right');
    var dt = pres ? 0 : cssVar(cs,'--sl-dock-top');
    // Bottom dock = chrome dock (bstrip/filmstrip, absolute) + notes reservation (independent), so
    // the two writers never clobber each other. .sl-notes sits at --sl-dock-bottom (above the chrome).
    var db = pres ? 0 : cssVar(cs,'--sl-dock-bottom') + cssVar(cs,'--sl-dock-notes');
    var vw = window.innerWidth - dl - dr, vh = window.innerHeight - dt - db;
    var fit = Math.min(vw/CW, vh/CH);
    var s = fit * zoomFactor;
    if(zoomFactor<=1){ panX = panY = 0; } else { clampPan(s, vw, vh); }
    var tx = dl + (vw - CW*s)/2 + panX, ty = dt + (vh - CH*s)/2 + panY;
    stage.style.transform = 'translate('+tx+'px,'+ty+'px) scale('+s+')';
  }

  function updateChrome(){
    var prog = document.querySelector('.sl-progress');
    if(prog) prog.style.width = (((cur)/(Math.max(1,slides.length-1)))*100)+'%';
    var ctr = document.querySelector('.sl-counter');
    if(ctr) ctr.textContent = (cur+1)+' / '+slides.length;
    var np = document.querySelector('.sl-notes');
    if(np && np.classList.contains('sl-open')) np.innerHTML = notes[cur] ? notes[cur] : '<em style="opacity:.5">No notes for this slide.</em>';
    var hash = '#'+(cur+1)+(step>0?('.'+step):'');
    if(location.hash !== hash) history.replaceState(null,'',hash);
    // Single chokepoint every navigation path passes through — let the injected
    // viewer chrome (ribbon) sync its counter + thumbnail highlight reactively.
    try{ document.dispatchEvent(new CustomEvent('slaide:change',{detail:{index:cur,step:step,count:slides.length}})); }catch(e){}
  }

  // The transition name IS the CSS class infix (sl-anim-<name>-in/out), defined once
  // in anim.ts. Direction is handled by an extra sl-anim-rev modifier (see goTo), so
  // adding a transition never touches this file. 'none'/'morph' are the two specials.
  function animType(slide){
    var t = slide.dataset.transition || 'fade';
    if(t==='none') return null;
    if(t==='morph') return 'morph';
    return t;
  }

  function activate(i, full){
    slides.forEach(function(s,idx){ s.classList.toggle('sl-active', idx===i); });
    step = full ? buildCount(i) : 0;
    applyBuilds(slides[i], step);
  }

  function morph(oldEl, newEl, after){
    if(!document.startViewTransition){ after(); return; }
    // pair shared [data-morph] ids transiently to avoid duplicate VT names
    var oldMap={}, pairs=[];
    oldEl.querySelectorAll('[data-morph]').forEach(function(e){ oldMap[e.dataset.morph]=e; });
    newEl.querySelectorAll('[data-morph]').forEach(function(e){
      var o = oldMap[e.dataset.morph];
      if(o){ o.style.viewTransitionName='vt-'+e.dataset.morph; e.style.viewTransitionName='vt-'+e.dataset.morph; pairs.push(o); pairs.push(e); }
    });
    var vt = document.startViewTransition(function(){ after(); });
    vt.finished.finally(function(){ pairs.forEach(function(e){ e.style.viewTransitionName=''; }); });
  }

  function goTo(i, dir){
    if(i<0||i>=slides.length||i===cur||busy) return;
    var oldSlide = slides[cur], newSlide = slides[i];
    var type = animType(newSlide);

    if(type==='morph'){
      morph(oldSlide, newSlide, function(){ activate(i, dir<0); });
      cur=i; updateChrome(); sync(); return;
    }
    if(!type){ activate(i, dir<0); cur=i; updateChrome(); sync(); return; }

    busy = true;
    var inC='sl-anim-'+type+'-in', outC='sl-anim-'+type+'-out';
    newSlide.classList.add('sl-active', inC);
    oldSlide.classList.add(outC);
    if(dir<0){ newSlide.classList.add('sl-anim-rev'); oldSlide.classList.add('sl-anim-rev'); }
    step = dir<0 ? buildCount(i) : 0; applyBuilds(newSlide, step);
    var done=0;
    function endOld(){ if(done&1) return; done|=1; oldSlide.classList.remove('sl-active', outC, 'sl-anim-rev'); oldSlide.removeEventListener('animationend', endOld); fin(); }
    function endNew(){ if(done&2) return; done|=2; newSlide.classList.remove(inC, 'sl-anim-rev'); newSlide.removeEventListener('animationend', endNew); fin(); }
    function fin(){ if((done&3)===3){ busy=false; if(pendingNav){ var p=pendingNav; pendingNav=null; if(p==='fwd') forward(); else backward(); } } }
    oldSlide.addEventListener('animationend', endOld);
    newSlide.addEventListener('animationend', endNew);
    requestAnimationFrame(function(){
      var cs1=getComputedStyle(oldSlide),cs2=getComputedStyle(newSlide);
      if(!cs1.animationName||cs1.animationName==='none'||cs1.animationDuration==='0s') endOld();
      if(!cs2.animationName||cs2.animationName==='none'||cs2.animationDuration==='0s') endNew();
    });
    setTimeout(function(){ if(busy){ endOld(); endNew(); } }, 800);
    cur=i; updateChrome(); sync();
  }

  function forward(){
    if(busy){ pendingNav='fwd'; return; }
    if(blanked) blank('');
    if(step < buildCount(cur)){ step++; applyBuilds(slides[cur], step); updateChrome(); sync(); return; }
    goTo(cur+1, 1);
  }
  function backward(){
    if(busy){ pendingNav='bwd'; return; }
    if(blanked) blank('');
    if(step > 0){ step--; applyBuilds(slides[cur], step); updateChrome(); sync(); return; }
    goTo(cur-1, -1);
  }

  function toggle(sel){ var e=document.querySelector(sel); if(e) e.classList.toggle('sl-open'); updateChrome(); }
  var NOTES_H = 180;
  // Dock the notes panel BENEATH the slide (not floating over it). The panel is a fixed sibling;
  // it reserves its own space via the INDEPENDENT --sl-dock-notes var (summed into the stage fit by
  // scale()), and anchors at --sl-dock-bottom so it sits flush above the chrome dock (the editor
  // filmstrip, or nothing). Keeping notes' reservation separate from --sl-dock-bottom means the
  // bstrip's absolute writes and the notes' toggle never clobber each other (no overlap on toggle).
  function setNotesOpen(open){
    var np = document.querySelector('.sl-notes');
    if(!np) return;
    if(open === np.classList.contains('sl-open')) return;   // already in the requested state
    var ds = document.documentElement.style;
    if(open){ np.classList.add('sl-open'); ds.setProperty('--sl-dock-notes', NOTES_H + 'px'); }
    else    { np.classList.remove('sl-open'); ds.setProperty('--sl-dock-notes', '0px'); }
    // innerHTML is populated by the updateChrome() call below (it fills .sl-notes when open).
    scale();
    updateChrome();
  }
  function toggleNotes(){
    var np = document.querySelector('.sl-notes');
    if(np) setNotesOpen(!np.classList.contains('sl-open'));
  }

  // ---- present extras: screen blank (b/w), presenter view, cross-window sync ----------------
  var blanked = '';
  function blank(kind){
    blanked = kind;
    // While presenting on a second screen, blank the AUDIENCE (projector), not our own control
    // screen: the web presenter window, or the native main that opened an audience window, relays.
    if(AM_PRESENTER || window.__slvHasAudience){
      if(chan){ try{ chan.postMessage({ blank: kind }); }catch(e){} }   // web → audience window
      if(window.__slvBlank){ try{ window.__slvBlank(kind); }catch(e){} } // native → Rust → audience window
      return;
    }
    var el = document.getElementById('sl-blank');
    if(!el){ el = document.createElement('div'); el.id = 'sl-blank';
      el.addEventListener('click', function(){ blank(''); }); document.body.appendChild(el); }
    el.className = kind ? ('sl-blank sl-blank-' + kind) : '';
  }

  // Same-origin sync between the audience window and the presenter window, keyed to this deck.
  var chan = (typeof BroadcastChannel !== 'undefined') ? new BroadcastChannel('slaide:present:' + location.pathname) : null;
  var applyingRemote = false, remoteT = 0;
  function publish(){
    if(applyingRemote) return;
    if(chan){ try{ chan.postMessage({ cur: cur, step: step }); }catch(e){} }   // web: cross-tab sync
    if(window.__slvNav){ try{ window.__slvNav(cur, step); }catch(e){} }          // native: host relays to the audience window
  }
  function applyRemote(d){
    if(!d || typeof d.cur !== 'number') return;
    if(busy){ clearTimeout(remoteT); remoteT = setTimeout(function(){ applyRemote(d); }, 120); return; }  // wait out an in-flight transition
    applyingRemote = true;
    try{
      if(d.cur !== cur){ goTo(d.cur, d.cur > cur ? 1 : -1); }
      if(typeof d.step === 'number' && d.step !== step){ step = Math.max(0, Math.min(buildCount(cur), d.step)); applyBuilds(slides[cur], step); updateChrome(); }
      if(AM_PRESENTER) renderPresenter();
    } finally { applyingRemote = false; }
  }
  if(chan){ chan.onmessage = function(ev){
    var d = ev.data || {};
    if(typeof d.blank === 'string'){ blank(d.blank); return; }   // audience: blank/restore the projector
    applyRemote(d);
  }; }
  function sync(){ publish(); if(AM_PRESENTER && document.getElementById('sl-pv')) renderPresenter(); }

  // ---- presenter view: a second window with the current + next slide, notes, timer + clock ----
  var AM_PRESENTER = /[?&]slvview=presenter/.test(location.search);
  // The audience window (native second-screen present): follows the main window only — no chrome,
  // no local navigation. (Match 'present' exactly, not the 'presenter' prefix.)
  var AM_AUDIENCE = /[?&]slvview=present([&#]|$)/.test(location.search);
  var presenterWin = null, pvStart = 0;
  function presenter(){
    if(AM_PRESENTER) return;                                    // this IS the presenter window
    var u = location.href.replace(/#.*$/, '');
    u += (u.indexOf('?') >= 0 ? '&' : '?') + 'slvview=presenter';
    u += '#' + (cur + 1) + (step ? '.' + step : '');            // open at our current position
    try{ presenterWin = window.open(u, 'slaide-presenter', 'width=1180,height=760,menubar=no,toolbar=no'); }catch(e){}
  }
  function renderSlideInto(frame, idx){
    if(!frame) return; frame.innerHTML = '';
    if(idx == null || idx < 0){ frame.className = 'sl-pv-frame'; return; }
    if(idx >= slides.length){ frame.className = 'sl-pv-frame sl-pv-end'; frame.textContent = 'End of deck'; return; }
    frame.className = 'sl-pv-frame';
    var box = document.createElement('div');
    box.style.cssText = 'position:absolute;top:0;left:0;width:' + CW + 'px;height:' + CH + 'px;transform-origin:0 0;transform:scale(' + ((frame.clientWidth || 480) / CW) + ');';
    var clone = slides[idx].cloneNode(true);
    clone.removeAttribute('id'); clone.classList.add('sl-active'); clone.classList.remove('sl-anim-rev');
    clone.style.cssText += ';position:absolute;top:0;left:0;display:block;visibility:visible;opacity:1;transform:none;';
    applyBuilds(clone, buildCount(idx));                        // preview fully built
    box.appendChild(clone); frame.appendChild(box);
  }
  function pad(n){ return (n < 10 ? '0' : '') + n; }
  function fmt(ms){ var s = Math.floor(ms / 1000), h = Math.floor(s / 3600); return (h ? pad(h) + ':' : '') + pad(Math.floor(s / 60) % 60) + ':' + pad(s % 60); }
  function renderPresenter(){
    if(!document.getElementById('sl-pv')) return;
    renderSlideInto(document.getElementById('sl-pv-cur-frame'), cur);
    renderSlideInto(document.getElementById('sl-pv-next-frame'), cur + 1);
    var nb = document.getElementById('sl-pv-notes-body');
    if(nb){ var n = notes[cur]; nb.innerHTML = (n && String(n).trim()) ? String(n) : '<span class="sl-pv-dim">No notes for this slide.</span>'; }
    var cc = document.getElementById('sl-pv-count'); if(cc) cc.textContent = (cur + 1) + ' / ' + slides.length;
  }
  function buildPresenter(){
    document.body.classList.add('sl-presenter');
    var pv = document.createElement('div'); pv.id = 'sl-pv';
    pv.innerHTML =
      '<div class="sl-pv-main">' +
        '<div class="sl-pv-cur"><div class="sl-pv-lbl">Current</div><div class="sl-pv-frame" id="sl-pv-cur-frame"></div></div>' +
        '<div class="sl-pv-side">' +
          '<div class="sl-pv-next"><div class="sl-pv-lbl">Next</div><div class="sl-pv-frame" id="sl-pv-next-frame"></div></div>' +
          '<div class="sl-pv-notes"><div class="sl-pv-lbl">Notes</div><div id="sl-pv-notes-body"></div></div>' +
        '</div>' +
      '</div>' +
      '<div class="sl-pv-bar">' +
        '<button class="sl-pv-btn" id="sl-pv-prev" title="Previous (Left)">&#8249;</button>' +
        '<button class="sl-pv-btn" id="sl-pv-nextb" title="Next (Right)">&#8250;</button>' +
        '<span class="sl-pv-count" id="sl-pv-count"></span>' +
        '<span class="sl-pv-timer" id="sl-pv-timer">00:00</span>' +
        '<span class="sl-pv-clock" id="sl-pv-clock"></span>' +
      '</div>';
    document.body.appendChild(pv);
    document.getElementById('sl-pv-prev').addEventListener('click', backward);
    document.getElementById('sl-pv-nextb').addEventListener('click', forward);
    pvStart = Date.now();
    setInterval(function(){
      var t = document.getElementById('sl-pv-timer'); if(t) t.textContent = fmt(Date.now() - pvStart);
      var c = document.getElementById('sl-pv-clock'); if(c){ var d = new Date(); c.textContent = pad(d.getHours()) + ':' + pad(d.getMinutes()); }
    }, 1000);
    window.addEventListener('resize', renderPresenter);
    renderPresenter();
  }
  (function injectPvCss(){
    var css = '#sl-blank{position:fixed;inset:0;z-index:2147483646;cursor:none;display:none;}'
      + '#sl-blank.sl-blank-b{display:block;background:#000;}#sl-blank.sl-blank-w{display:block;background:#fff;}'
      + 'body.sl-presenter>*:not(#sl-pv){display:none !important;}'
      + '#sl-pv{position:fixed;inset:0;z-index:2147483645;display:flex;flex-direction:column;background:#0d0d12;color:#e9e9f1;font:14px/1.45 system-ui,-apple-system,"Segoe UI",sans-serif;}'
      + '.sl-pv-main{flex:1;display:flex;min-height:0;gap:18px;padding:18px;}'
      + '.sl-pv-cur{flex:1.7;display:flex;flex-direction:column;min-width:0;}'
      + '.sl-pv-side{flex:1;display:flex;flex-direction:column;gap:14px;min-width:0;}'
      + '.sl-pv-lbl{font:600 10.5px system-ui;letter-spacing:.12em;text-transform:uppercase;color:#7d8398;margin:0 0 7px;}'
      + '.sl-pv-frame{position:relative;width:100%;aspect-ratio:' + CW + '/' + CH + ';background:#000;border-radius:11px;overflow:hidden;box-shadow:0 10px 34px -12px rgba(0,0,0,.7);}'
      + '.sl-pv-frame.sl-pv-end{display:flex;align-items:center;justify-content:center;color:#5f6478;font-weight:600;letter-spacing:.04em;}'
      + '.sl-pv-next{flex:none;}'
      + '.sl-pv-notes{flex:1;min-height:0;display:flex;flex-direction:column;}'
      + '#sl-pv-notes-body{flex:1;overflow:auto;background:#16161f;border-radius:11px;padding:15px 17px;font-size:17px;line-height:1.5;}'
      + '.sl-pv-dim{color:#6b7086;}'
      + '.sl-pv-bar{flex:none;height:58px;display:flex;align-items:center;gap:16px;padding:0 22px;background:#15151e;border-top:1px solid rgba(255,255,255,.08);}'
      + '.sl-pv-btn{all:unset;cursor:pointer;width:42px;height:38px;display:inline-flex;align-items:center;justify-content:center;border-radius:9px;background:rgba(255,255,255,.06);color:#e9e9f1;font-size:22px;line-height:1;}'
      + '.sl-pv-btn:hover{background:rgba(255,255,255,.13);}'
      + '.sl-pv-count{font-weight:600;font-size:15px;}'
      + '.sl-pv-timer{font-variant-numeric:tabular-nums;font-size:19px;font-weight:600;}'
      + '.sl-pv-clock{margin-left:auto;color:#7d8398;font-variant-numeric:tabular-nums;font-size:15px;}';
    var st = document.createElement('style'); st.textContent = css; document.head.appendChild(st);
  })();

  document.addEventListener('keydown', function(e){
    // Presentation shortcuts fire regardless of focus (PowerPoint parity): F5 presents from the
    // top, Shift+F5 from the current slide, Esc always stops. Handled before the typing guard so
    // they work even mid-edit, and before nav so Esc-to-stop wins over Esc-to-close-panels.
    if(e.key === 'F5'){ e.preventDefault(); setPresenting(true, e.shiftKey); return; }
    if(e.key === 'Escape'){                                  // Esc clears a blank screen first, then stops presenting
      if(blanked){ e.preventDefault(); blank(''); return; }
      if(isPresenting()){ e.preventDefault(); setPresenting(false); return; }
    }
    if(AM_AUDIENCE) return;                                  // the audience window only mirrors — no local nav
    // When focus is in an editable field, keystrokes belong to it (typing a space,
    // moving the caret) — don't hijack them for slide navigation.
    if(isTyping()) return;
    switch(e.key){
      case 'ArrowRight': case 'ArrowUp': case ' ': case 'PageDown': forward(); e.preventDefault(); break;
      case 'ArrowLeft': case 'ArrowDown': case 'PageUp': backward(); e.preventDefault(); break;
      case 'Home': goTo(0,1); break;
      case 'End': goTo(slides.length-1,1); break;
      case 'n': case 'N': toggleNotes(); break;
      case 'f': case 'F': setPresenting(!isPresenting(), true); break;
      case 'p': case 'P': presenter(); break;
      case 'b': case 'B': blank(blanked==='b'?'':'b'); e.preventDefault(); break;
      case 'w': case 'W': blank(blanked==='w'?'':'w'); e.preventDefault(); break;
      case '?': case 'h': toggle('.sl-help'); break;
      case 'Escape':
        // Close any open overlay (help, etc.) directly; notes go through setNotesOpen so the
        // reserved bottom dock unwinds too. (Loop param is el; the outer e is the KeyboardEvent.)
        document.querySelectorAll('.sl-open').forEach(function(el){ if(!el.classList.contains('sl-notes')) el.classList.remove('sl-open'); });
        setNotesOpen(false);
        break;
    }
  });
  // ---- drag-to-pan (only when zoomed in past fit) -------------------------
  var dragging=false, dragMoved=false, dragX=0, dragY=0;
  if(vp){
    vp.addEventListener('pointerdown', function(e){
      if(zoomFactor<=1 || !navEnabled) return;
      dragging=true; dragMoved=false; dragX=e.clientX; dragY=e.clientY;
      try{ vp.setPointerCapture(e.pointerId); }catch(_){}
      vp.style.cursor='grabbing';
    });
    vp.addEventListener('pointermove', function(e){
      if(!dragging) return;
      var dx=e.clientX-dragX, dy=e.clientY-dragY;
      if(Math.abs(dx)+Math.abs(dy)>3) dragMoved=true;
      panX+=dx; panY+=dy; dragX=e.clientX; dragY=e.clientY; scale();
    });
    function endDrag(e){ if(!dragging) return; dragging=false; vp.style.cursor=zoomFactor>1?'grab':''; try{ vp.releasePointerCapture(e.pointerId); }catch(_){} }
    vp.addEventListener('pointerup', endDrag);
    vp.addEventListener('pointercancel', endDrag);
    vp.addEventListener('click', function(e){
      if(!navEnabled || isTyping()) return;                      // nav disabled, or focus is in a field
      if(dragMoved){ dragMoved=false; return; }                  // finished a pan, not a tap
      var sel = window.getSelection && window.getSelection();
      if(sel && !sel.isCollapsed && String(sel)) return;         // user is selecting text — let them, don't advance
      if(e.target.closest('a')) return;
      if(e.target.closest('.sl-notes,.sl-help,.sl-counter')) return;
      forward();
    });
  }
  window.addEventListener('resize', scale);

  // ---- present mode — Fullscreen API by default; a host (native viewer / web ribbon) can take
  //      it over via window.__slvPresentHook (the desktop app drives an OS-window fullscreen over
  //      IPC, where document.fullscreenElement never sets — hence the class-based check below).
  function isPresenting(){
    return !!document.fullscreenElement
      || document.body.classList.contains('sl-presenting')
      || document.body.classList.contains('slv-presenting');
  }
  function setPresenting(on, fromCurrent){
    if(on && !fromCurrent) goTo(0, 1);                  // F5 / present button → start from the top
    if(typeof window.__slvPresentHook === 'function'){ window.__slvPresentHook(!!on); return; }
    if(on){ if(!document.fullscreenElement && document.documentElement.requestFullscreen) document.documentElement.requestFullscreen(); }
    else if(document.fullscreenElement && document.exitFullscreen){ document.exitFullscreen(); }
  }
  document.addEventListener('fullscreenchange', function(){
    document.body.classList.toggle('sl-presenting', !!document.fullscreenElement);
    scale();
  });
  var presentBtn = document.querySelector('.sl-present-toggle');
  if(presentBtn) presentBtn.addEventListener('click', function(){ setPresenting(!isPresenting(), true); });

  // Public control API (embedding + testing).
  window.slaide = {
    next: forward,
    prev: backward,
    goTo: function(i){ goTo(i, i>cur?1:-1); },
    relayout: function(){ scale(); }, // recompute the stage fit (e.g. after the dock opens/closes)
    show: function(i){ if(!slides.length) return; i=Math.max(0,Math.min(slides.length-1,i)); activate(i, true); cur=i; updateChrome(); },
    // Re-collect slides after the host appended/replaced .sl-slide nodes in the stage (live agent
    // build: new slides stream in one by one). Preserve the current index; re-assert active + builds
    // + chrome. Returns the new slide count.
    rescan: function(){
      slides = Array.prototype.slice.call(stage.querySelectorAll(':scope > .sl-slide'));
      if(!slides.length) return 0;
      cur = Math.max(0, Math.min(cur, slides.length-1));
      slides.forEach(function(s,idx){ s.classList.toggle('sl-active', idx===cur); });
      if(step > buildCount(cur)) step = buildCount(cur);
      applyBuilds(slides[cur], step);
      scale(); updateChrome();
      return slides.length;
    },
    setInteractive: function(on){ navEnabled = on!==false; },
    toggleNotes: function(){ toggleNotes(); },
    toggleHelp: function(){ toggle('.sl-help'); },
    zoom: function(f){
      zoomFactor = (f==='fit'||!f) ? 1 : Math.max(0.25, Math.min(8, f));
      if(zoomFactor===1){ panX=panY=0; }
      if(vp) vp.style.cursor = zoomFactor>1 ? 'grab' : '';
      scale();
      return zoomFactor;
    },
    zoomBy: function(d){ return window.slaide.zoom(zoomFactor*d); },
    pan: function(dx,dy){ panX+=dx; panY+=dy; scale(); },
    present: function(on, fromCurrent){ setPresenting(on!==false, fromCurrent); },
    presenter: presenter,                                   // open the separate presenter view
    blank: function(k){ blank(k==='b'||k==='w' ? k : ''); }, // 'b' | 'w' | '' (clear)
    __applyRemote: function(c, s){ applyRemote({ cur: c, step: s }); }, // host pushes the audience window in sync
    get zoomLevel(){ return zoomFactor; },
    get index(){ return cur; },
    get count(){ return slides.length; }
  };

  // initial state from hash
  var m = (location.hash||'').match(/#(\d+)(?:\.(\d+))?/);
  if(m){ cur = Math.min(slides.length-1, Math.max(0, parseInt(m[1],10)-1)); }
  slides.forEach(function(s,idx){ s.classList.toggle('sl-active', idx===cur); });
  step = m && m[2] ? Math.min(buildCount(cur), parseInt(m[2],10)) : 0;
  applyBuilds(slides[cur], step);
  scale(); updateChrome();
  if(AM_PRESENTER) buildPresenter();                        // this window is the presenter view
  if(AM_AUDIENCE){ document.body.classList.add('slv-presenting'); navEnabled = false; }  // clean mirror, host-driven
  if(document.body.classList.contains('sl-editing')) navEnabled = false;
})();
`;
