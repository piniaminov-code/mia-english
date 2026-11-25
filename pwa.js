"use strict";
/* "מסך מלא" and "הוספה למסך הבית" controls. Shown only inside .pwaSlot elements (start
   screens + lesson picker), never during a lesson, never in print, and not at all when the
   site already runs as an installed app. Honest about platform support:
   - Fullscreen: only where the Fullscreen API exists. iPhone Safari has no page fullscreen,
     so the button is hidden there rather than shown and failing.
   - Install: Chrome/Edge/Android use the browser's own install prompt (beforeinstallprompt)
     when the browser offers one; iPhone/iPad Safari get the Share -> "הוספה למסך הבית" steps;
     other browsers get a plain explanation. No network requests, no analytics. */
(function () {
  const ua = navigator.userAgent || "";
  const isIOS = /iPhone|iPad|iPod/.test(ua) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
  const isIPhone = /iPhone|iPod/.test(ua);
  const standalone = () => (window.matchMedia && (matchMedia("(display-mode: standalone)").matches ||
    matchMedia("(display-mode: fullscreen)").matches || matchMedia("(display-mode: minimal-ui)").matches)) || navigator.standalone === true;
  const fsEnabled = () => !isIPhone && !!(document.fullscreenEnabled || document.webkitFullscreenEnabled);
  const fsEl = () => document.fullscreenElement || document.webkitFullscreenElement;
  let deferred = null;

  const css = document.createElement("style");
  css.textContent = `
  #app{padding-top:max(10px, env(safe-area-inset-top)); padding-left:max(14px, env(safe-area-inset-left)); padding-right:max(14px, env(safe-area-inset-right));}
  .pwaSlot{display:flex; gap:8px; justify-content:center; flex-wrap:wrap; margin-top:6px;}
  .pwaSlot:empty{display:none;}
  .pwaBtn{min-height:44px; min-width:44px; padding:8px 14px; border:none; border-radius:999px; background:rgba(255,255,255,.75);
    color:var(--ink,#4A3B31); font:inherit; font-size:14px; font-weight:800; box-shadow:0 4px 12px rgba(74,59,49,.12); cursor:pointer;}
  .pwaBtn:active{transform:scale(.96);}
  #pwaSheet{position:fixed; inset:0; z-index:90; display:flex; align-items:flex-end; justify-content:center; background:rgba(40,30,20,.35);}
  #pwaSheet .box{direction:rtl; text-align:right; background:#fff; color:#4A3B31; width:min(100%,440px); border-radius:22px 22px 0 0;
    padding:18px 20px calc(18px + env(safe-area-inset-bottom)); box-shadow:0 -8px 30px rgba(0,0,0,.18); font-size:16px; line-height:1.55; animation:pwaUp .25s ease;}
  #pwaSheet h2{font-size:19px; margin:0 0 8px;}
  #pwaSheet ol{margin:6px 0 12px; padding-right:22px;}
  #pwaSheet .close{display:block; width:100%; min-height:44px; margin-top:8px; border:none; border-radius:999px; background:#3DBEA8; color:#fff; font:inherit; font-weight:900; font-size:17px;}
  @keyframes pwaUp{from{transform:translateY(30px); opacity:0;}}
  @media (prefers-reduced-motion: reduce){ #pwaSheet .box{animation:none;} .pwaBtn:active{transform:none;} }
  @media print{ .pwaSlot, #pwaSheet{display:none !important;} }
  `;
  document.head.appendChild(css);

  function sheet(title, html) {
    document.getElementById("pwaSheet")?.remove();
    const d = document.createElement("div");
    d.id = "pwaSheet"; d.setAttribute("role", "dialog"); d.setAttribute("aria-modal", "true"); d.setAttribute("aria-label", title);
    d.innerHTML = `<div class="box"><h2>${title}</h2>${html}<button class="close" type="button">הבנתי</button></div>`;
    d.addEventListener("click", e => { if (e.target === d || e.target.classList.contains("close")) d.remove(); });
    document.body.appendChild(d);
    d.querySelector(".close").focus();
  }
  function install() {
    if (deferred) {
      const p = deferred; deferred = null;
      p.prompt();
      p.userChoice.finally(render);
      return;
    }
    if (isIOS) {
      sheet("הוספה למסך הבית", `<ol><li>לחצו על כפתור השיתוף <b>⬆︎</b> (בתחתית המסך בספארי, או למעלה באייפד).</li>
        <li>גללו ובחרו <b>"הוספה למסך הבית"</b>.</li><li>לחצו <b>"הוספה"</b>.</li></ol>
        <p>האפליקציה תיפתח מהאייקון של מיה, בלי שורת כתובת.</p>`);
    } else {
      sheet("הוספה למסך הבית", `<p>הדפדפן הזה לא מציע כאן התקנה ישירה.</p>
        <ul><li>בכרום או אדג': פתחו את תפריט הדפדפן (⋮) ובחרו <b>"התקנת האפליקציה"</b> או <b>"הוספה למסך הבית"</b>, אם האפשרות מופיעה.</li>
        <li>בספארי במק או בפיירפוקס: אפשר להוסיף סימנייה לדף.</li></ul>`);
    }
  }
  function toggleFs() {
    const el = document.documentElement;
    if (fsEl()) (document.exitFullscreen || document.webkitExitFullscreen).call(document);
    else (el.requestFullscreen || el.webkitRequestFullscreen).call(el).catch?.(() => {});
  }
  function render() {
    document.querySelectorAll(".pwaSlot").forEach(slot => {
      slot.innerHTML = "";
      if (standalone()) return;
      if (fsEnabled()) {
        const b = document.createElement("button");
        b.type = "button"; b.className = "pwaBtn pwaFs";
        b.textContent = fsEl() ? "↙︎ יציאה ממסך מלא" : "⛶ מסך מלא";
        b.addEventListener("click", toggleFs);
        slot.appendChild(b);
      }
      const i = document.createElement("button");
      i.type = "button"; i.className = "pwaBtn pwaInstall"; i.textContent = "📲 הוספה למסך הבית";
      i.addEventListener("click", install);
      slot.appendChild(i);
    });
  }
  window.addEventListener("beforeinstallprompt", e => { e.preventDefault(); deferred = e; render(); });
  window.addEventListener("appinstalled", () => { deferred = null; render(); });
  document.addEventListener("fullscreenchange", render);
  document.addEventListener("webkitfullscreenchange", render);
  if (window.matchMedia) matchMedia("(display-mode: standalone)").addEventListener?.("change", render);
  // slots appear when a start screen is drawn
  new MutationObserver(muts => { for (const m of muts) for (const n of m.addedNodes) if (n.nodeType === 1 && (n.matches(".pwaSlot") || n.querySelector(".pwaSlot"))) { render(); return; } })
    .observe(document.body, { childList: true, subtree: true });
  render();
  window.PWA = { render, standalone, fsEnabled, isIOS };
})();
