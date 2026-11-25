"use strict";
/* Mia avatar + audio-driven face animation (v2).
   - Mounts the approved avatar (assets/mia-avatar.jpg) into every .owl / .avatarSlot. If the
     picture cannot load, the page keeps its drawn owl (.owl) or shows nothing (.avatarSlot).
   - While a recorded clip plays, the mouth follows a precomputed track
     (<audio-bundle>.lips.json, made offline by tools/lipsync_analyze.py from the same
     approved recordings), indexed by the audio element's own currentTime. Neighbouring mouth
     shapes crossfade over ~50 ms instead of hard-swapping.
   - Secondary motion: a small head bob on stressed syllables (from the same file), blinks
     every 3-5 s, a brow lift while a question is being asked, a hop + stars on right answers
     and a gentle tilt on wrong ones. The avatar picture itself is never altered.
   Pages announce a clip with: window.dispatchEvent(new CustomEvent("clipplay", {detail:{key, el}})) */
(function () {
  const SRC = window.GUIDE_AVATAR || "assets/mia-avatar.jpg";
  const DIR = "assets/mouth/";
  const SHAPES = [1, 2, 3, 4, 5, 6, 7];
  const TRACK = {};   // key -> {starts:[ms], shapes:[n], beats:[ms]}
  const reduceMotion = window.matchMedia && matchMedia("(prefers-reduced-motion: reduce)").matches;

  function parse(clip, unit) {
    if (typeof clip === "string") { // v1: one char per 40 ms frame
      const starts = [], shapes = [];
      for (let i = 0; i < clip.length; i++) if (i === 0 || clip[i] !== clip[i - 1]) { starts.push(i * 40); shapes.push(+clip[i]); }
      return { starts, shapes, beats: [] };
    }
    const starts = [], shapes = [];
    let t = 0;
    String(clip.m || "").split(" ").forEach(run => { const p = run.split(":"); if (p.length === 2) { starts.push(t); shapes.push(+p[0]); t += (+p[1]) * unit; } });
    return { starts, shapes, beats: (clip.b || []).map(b => b * unit) };
  }
  const loads = Array.from(document.querySelectorAll("script[src]"))
    .map(s => s.getAttribute("src").split("?")[0])
    .filter(s => /audio\d*\.js$/i.test(s))
    .map(s => fetch(s.replace(/\.js$/i, ".lips.json"))
      .then(r => (r.ok ? r.json() : null))
      .then(j => { if (j && j.clips) for (const k in j.clips) TRACK[k] = parse(j.clips[k], j.unit || 10); })
      .catch(() => {}));
  const ready = Promise.all(loads);

  const css = document.createElement("style");
  css.textContent = `
  .owl.hasImg{width:100px !important;height:100px !important;flex:0 0 100px;align-self:flex-end;}
  .owl.hasImg > :not(.avatarWrap){display:none !important;}
  .avatarSlot{display:none;position:relative;}
  .avatarSlot.hasImg{display:block;}
  .avatarWrap{position:relative;width:100%;height:100%;border-radius:50%;overflow:hidden;background:#BFEDE6;
    box-shadow:0 0 0 4px #fff, 0 8px 20px rgba(74,59,49,.18);transition:box-shadow .25s, transform .5s cubic-bezier(.34,1.56,.64,1);}
  .avatarFace{position:absolute;inset:0;transform-origin:50% 100%;transition:transform .11s ease-out;}
  .avatarFace.bob{transform:translateY(-1.6%) scale(1.03);}
  .avatarFace img{position:absolute;display:block;pointer-events:none;user-select:none;-webkit-user-drag:none;}
  .avatarFace .avatarImg{inset:0;width:100%;height:100%;object-fit:cover;}
  .avatarFace .ov{opacity:0;transition:opacity 50ms linear;will-change:opacity;}
  .avatarFace .ov.on{opacity:1;}
  .avatarFace .mouth{left:46.875%;top:56.771%;width:21.875%;height:17.1875%;}
  .avatarFace .lid{left:43.75%;top:39.0625%;width:32.8125%;height:13.542%;transition:none;}
  .avatarFace .brow{left:46.875%;top:34.896%;width:31.25%;height:9.896%;transition:opacity .18s ease;}
  .owl.talking .avatarWrap, .avatarSlot.talking .avatarWrap{box-shadow:0 0 0 4px #fff, 0 0 0 9px rgba(255,201,61,.55), 0 8px 20px rgba(74,59,49,.18);}
  .owl.cheer.hasImg{animation:avatarHop .6s ease;}
  @keyframes avatarHop{0%,100%{transform:translateY(0);} 35%{transform:translateY(-14px);} 60%{transform:translateY(-4px);} 80%{transform:translateY(-7px);}}
  .avatarWrap.tilt{transform:rotate(-6deg);}
  .starBurst{position:fixed;z-index:70;pointer-events:none;font-size:22px;transition:transform .7s cubic-bezier(.2,.8,.3,1), opacity .7s ease;}
  #startWrap .owlBig .owl.hasImg{width:110px !important;height:110px !important;}
  @media (min-height:760px) and (min-width:600px){ #teacherRow .owl.hasImg{width:160px !important;height:160px !important;flex-basis:160px;} #teacherRow{min-height:176px;} }
  @media (prefers-reduced-motion: reduce){ .owl.cheer.hasImg{animation:none;} .avatarFace{transition:none;} .avatarWrap{transition:box-shadow .25s;} }
  `;
  document.head.appendChild(css);

  let imgOk = null;
  const pending = [];
  const probe = new Image();
  probe.onload = () => {
    imgOk = true; pending.splice(0).forEach(fill);
    SHAPES.map(n => DIR + "m" + n + ".png").concat([DIR + "blink1.png", DIR + "blink2.png", DIR + "brow.png"]).forEach(u => { const i = new Image(); i.src = u; });
  };
  probe.onerror = () => { imgOk = false; pending.length = 0; };
  probe.src = SRC;

  function fill(slot) {
    if (!slot.isConnected || slot.classList.contains("hasImg")) return;
    const w = document.createElement("div");
    w.className = "avatarWrap";
    w.innerHTML = '<div class="avatarFace"><img class="avatarImg" alt="מיה" draggable="false">' +
      SHAPES.map(n => `<img class="ov mouth" data-s="${n}" src="${DIR}m${n}.png" alt="" aria-hidden="true" draggable="false">`).join("") +
      `<img class="ov lid" data-l="1" src="${DIR}blink1.png" alt="" aria-hidden="true" draggable="false">` +
      `<img class="ov lid" data-l="2" src="${DIR}blink2.png" alt="" aria-hidden="true" draggable="false">` +
      `<img class="ov brow" src="${DIR}brow.png" alt="" aria-hidden="true" draggable="false"></div>`;
    const img = w.querySelector(".avatarImg");
    img.onerror = () => { w.remove(); slot.classList.remove("hasImg"); };
    img.src = SRC;
    slot.appendChild(w);
    slot.classList.add("hasImg");
    if (shown > 0) setShape(shown, true);
  }
  function mount(root) {
    (root || document).querySelectorAll(".owl, .avatarSlot").forEach(slot => {
      if (imgOk === true) fill(slot); else if (imgOk === null) pending.push(slot);
    });
  }

  // ---- mouth: crossfade between shape sprites ----
  let shown = 0;
  const log = [];                // [audio time, segment start, shape] at each switch, for measurement
  function setShape(n, force) {
    if (n === shown && !force) return;
    shown = n;
    document.querySelectorAll(".avatarFace .mouth").forEach(m => m.classList.toggle("on", +m.dataset.s === n));
  }
  function segAt(tr, ms) {
    let lo = 0, hi = tr.starts.length - 1, k = -1;
    while (lo <= hi) { const mid = (lo + hi) >> 1; if (tr.starts[mid] <= ms) { k = mid; lo = mid + 1; } else hi = mid - 1; }
    return k;
  }
  function shapeAt(key, t) {
    const tr = TRACK[key];
    if (!tr || !(t >= 0)) return 0;
    const k = segAt(tr, t * 1000);
    return k < 0 ? 0 : tr.shapes[k];
  }

  // ---- head bob on stressed syllables ----
  let beatIdx = 0;
  function bob() {
    if (reduceMotion) return;
    document.querySelectorAll(".avatarFace").forEach(f => { f.classList.add("bob"); setTimeout(() => f.classList.remove("bob"), 130); });
  }

  let cur = null, raf = 0;
  function tick() {
    raf = 0;
    if (!cur) { setShape(0); return; }
    const el = cur.el;
    if (el.paused || el.ended) { setShape(0); brow(false); cur = null; return; }
    const tr = TRACK[cur.key];
    if (tr) {
      const ms = el.currentTime * 1000;
      const k = segAt(tr, ms);
      const n = k < 0 ? 0 : tr.shapes[k];
      if (n !== shown) { log.push([el.currentTime, k < 0 ? 0 : tr.starts[k] / 1000, n, performance.now()]); if (log.length > 4000) log.shift(); }
      setShape(n);
      while (beatIdx < tr.beats.length && tr.beats[beatIdx] <= ms) { if (ms - tr.beats[beatIdx] < 120) bob(); beatIdx++; }
    } else setShape(0);
    raf = requestAnimationFrame(tick);
  }
  window.addEventListener("clipplay", e => {
    if (!e.detail || !e.detail.el) return;
    cur = { key: e.detail.key, el: e.detail.el };
    beatIdx = 0;
    const b = document.getElementById("bubble");
    brow(!!(b && /\?/.test(b.textContent || "")));
    if (!raf) raf = requestAnimationFrame(tick);
  });

  // ---- eyebrows: lifted while a question is being asked ----
  function brow(on) { document.querySelectorAll(".avatarFace .brow").forEach(x => x.classList.toggle("on", on)); }

  // ---- blinks every 3-5 s (half, closed, half) ----
  function lids(n) { document.querySelectorAll(".avatarFace .lid").forEach(x => x.classList.toggle("on", +x.dataset.l === n)); }
  function blinkLoop() {
    setTimeout(() => {
      if (!document.hidden) {
        lids(1); setTimeout(() => lids(2), 45); setTimeout(() => lids(1), 120); setTimeout(() => lids(0), 165);
      }
      blinkLoop();
    }, 3000 + Math.random() * 2000);
  }
  blinkLoop();

  // ---- reactions: hop + stars when the page cheers, gentle tilt on a miss ----
  function starBurst(slot) {
    if (reduceMotion || !slot) return;
    const r = slot.getBoundingClientRect();
    for (let i = 0; i < 6; i++) {
      const s = document.createElement("span");
      s.className = "starBurst"; s.textContent = i % 2 ? "⭐" : "✨";
      s.style.left = (r.left + r.width / 2 - 11) + "px"; s.style.top = (r.top + r.height / 2 - 11) + "px";
      document.body.appendChild(s);
      const a = (i / 6) * Math.PI * 2 - Math.PI / 2, d = r.width * 0.75;
      requestAnimationFrame(() => requestAnimationFrame(() => { s.style.transform = `translate(${Math.cos(a) * d}px, ${Math.sin(a) * d}px) scale(1.2)`; s.style.opacity = "0"; }));
      setTimeout(() => s.remove(), 800);
    }
  }
  function encourage() {
    document.querySelectorAll(".owl.hasImg .avatarWrap").forEach(w => { w.classList.add("tilt"); setTimeout(() => w.classList.remove("tilt"), 900); });
    brow(true); setTimeout(() => { if (!cur) brow(false); }, 1100);
  }
  // any page that adds .cheer to its guide (engine + older lessons) gets the star burst
  const guide = document.getElementById("owl");
  // (fires exactly once per hop, when the hop animation starts)
  if (guide) guide.addEventListener("animationstart", e => { if (e.animationName === "avatarHop") starBurst(guide); });

  mount(document);
  new MutationObserver(muts => {
    for (const m of muts) m.addedNodes.forEach(n => { if (n.nodeType === 1) { if (n.matches(".owl, .avatarSlot")) mount(n.parentNode); else if (n.querySelector(".owl, .avatarSlot")) mount(n); } });
  }).observe(document.body, { childList: true, subtree: true });

  window.LipSync = { mount, ready, shapeAt, setShape, encourage, starBurst, tracks: TRACK, log };
})();
