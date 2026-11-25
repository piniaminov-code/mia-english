"use strict";
/* Mia avatar + lip-sync for the lesson guide.
   - Mounts the approved avatar picture (assets/mia-avatar.jpg) into every .owl / .avatarSlot.
     If the picture cannot load, the page keeps its drawn owl (.owl) or shows nothing
     (.avatarSlot), so the text of the page still carries everything.
   - While a recorded clip plays, one of 5 mouth sprites (assets/mouth/m1..m5.png) is laid
     over the mouth. Which one comes from <audio-bundle>.lips.json (precomputed offline by
     tools/lipsync_analyze.py from the same approved recordings), indexed by the audio
     element's own currentTime, so the mouth follows the sound actually playing.
   Pages announce a clip with: window.dispatchEvent(new CustomEvent("clipplay", {detail:{key, el}})) */
(function () {
  const SRC = window.GUIDE_AVATAR || "assets/mia-avatar.jpg";
  const MOUTHS = [1, 2, 3, 4, 5].map(n => "assets/mouth/m" + n + ".png");
  const LIPS = {};
  let fps = 25;

  // timing files sit next to each audio bundle: l4audio.js -> l4audio.lips.json
  const loads = Array.from(document.querySelectorAll("script[src]"))
    .map(s => s.getAttribute("src").split("?")[0])
    .filter(s => /audio\d*\.js$/i.test(s))
    .map(s => fetch(s.replace(/\.js$/i, ".lips.json"))
      .then(r => (r.ok ? r.json() : null))
      .then(j => { if (j && j.clips) { Object.assign(LIPS, j.clips); if (j.fps) fps = j.fps; } })
      .catch(() => {}));
  const ready = Promise.all(loads);

  const css = document.createElement("style");
  css.textContent = `
  .owl.hasImg{width:100px !important;height:100px !important;flex:0 0 100px;align-self:flex-end;}
  .owl.hasImg > :not(.avatarWrap){display:none !important;}
  .avatarSlot{display:none;position:relative;}
  .avatarSlot.hasImg{display:block;}
  .avatarWrap{position:relative;width:100%;height:100%;border-radius:50%;overflow:hidden;background:#BFEDE6;
    box-shadow:0 0 0 4px #fff, 0 8px 20px rgba(74,59,49,.18);transition:box-shadow .25s;}
  .avatarWrap img{position:absolute;display:block;pointer-events:none;user-select:none;-webkit-user-drag:none;}
  .avatarWrap .avatarImg{inset:0;width:100%;height:100%;object-fit:cover;}
  .avatarWrap .mouthOverlay{left:47.917%;top:57.8125%;width:19.792%;height:12.5%;visibility:hidden;}
  .avatarWrap .mouthOverlay.on{visibility:visible;}
  .owl.talking .avatarWrap, .avatarSlot.talking .avatarWrap{box-shadow:0 0 0 4px #fff, 0 0 0 9px rgba(255,201,61,.55), 0 8px 20px rgba(74,59,49,.18);}
  .owl.cheer.hasImg{animation:avatarHop .6s ease;}
  @keyframes avatarHop{0%,100%{transform:translateY(0);} 40%{transform:translateY(-10px);}}
  #startWrap .owlBig .owl.hasImg{width:96px !important;height:96px !important;}
  `;
  document.head.appendChild(css);

  let imgOk = null; // null = not known yet
  const pending = [];
  const probe = new Image();
  probe.onload = () => { imgOk = true; pending.splice(0).forEach(fill); MOUTHS.forEach(u => { const i = new Image(); i.src = u; }); };
  probe.onerror = () => { imgOk = false; pending.length = 0; };
  probe.src = SRC;

  function fill(slot) {
    if (!slot.isConnected || slot.classList.contains("hasImg")) return;
    const w = document.createElement("div");
    w.className = "avatarWrap";
    w.innerHTML = '<img class="avatarImg" alt="מיה" draggable="false"><img class="mouthOverlay" alt="" aria-hidden="true" draggable="false">';
    const img = w.firstChild;
    img.onerror = () => { w.remove(); slot.classList.remove("hasImg"); }; // back to the drawn owl / nothing
    img.src = SRC;
    slot.appendChild(w);
    slot.classList.add("hasImg");
  }
  function mount(root) {
    (root || document).querySelectorAll(".owl, .avatarSlot").forEach(slot => {
      if (imgOk === true) fill(slot); else if (imgOk === null) pending.push(slot);
    });
  }

  // ---- mouth driving ----
  let cur = null, raf = 0, shown = -1;
  function setShape(n) {
    if (n === shown) return;
    shown = n;
    document.querySelectorAll(".avatarWrap .mouthOverlay").forEach(m => {
      if (n > 0) { m.src = MOUTHS[n - 1]; m.classList.add("on"); } else m.classList.remove("on");
    });
  }
  function shapeAt(key, t) {
    const s = LIPS[key];
    if (!s || !(t >= 0)) return 0;
    return +s.charAt(Math.floor(t * fps)) || 0;
  }
  function tick() {
    raf = 0;
    if (!cur) { setShape(0); return; }
    const el = cur.el;
    if (el.paused || el.ended) { setShape(0); cur = null; return; }
    setShape(shapeAt(cur.key, el.currentTime));
    raf = requestAnimationFrame(tick);
  }
  window.addEventListener("clipplay", e => {
    if (!e.detail || !e.detail.el) return;
    cur = { key: e.detail.key, el: e.detail.el };
    shown = -1;
    if (!raf) raf = requestAnimationFrame(tick);
  });

  // mount what is on the page now, and anything a lesson draws later (start screen, finale)
  mount(document);
  new MutationObserver(muts => {
    for (const m of muts) m.addedNodes.forEach(n => { if (n.nodeType === 1) { if (n.matches(".owl, .avatarSlot")) mount(n.parentNode); else if (n.querySelector(".owl, .avatarSlot")) mount(n); } });
  }).observe(document.body, { childList: true, subtree: true });

  window.LipSync = { mount, ready, shapeAt, setShape, data: LIPS, get fps() { return fps; } };
})();
