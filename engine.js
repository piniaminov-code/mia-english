"use strict";
/* Engine for lessons 4-33 of "האנגלית של מיה".
   Adapted from the approved lesson2 flow; same design, voice keys and safety behaviors.
   Expects: window.LESSON config (see lessons-data.js) and AUDIO maps
   (shared-audio.js + the lesson's own audio file, plus l3audio1.js for count games). */
const MIA = "מִיָּה";

/* ---------- diagnostics: remember failures so a recurrence is explainable ---------- */
(function () {
  function logErr(kind, msg) {
    try {
      const k = "mia-l" + LESSON.id + "-errlog";
      const arr = JSON.parse(localStorage.getItem(k) || "[]");
      arr.push({ kind: kind, msg: String(msg).slice(0, 200), at: Date.now() });
      while (arr.length > 20) arr.shift();
      localStorage.setItem(k, JSON.stringify(arr));
    } catch (e) {}
  }
  window.addEventListener("error", e => logErr("error", (e.message || "") + " @" + String(e.filename || "").split("/").pop() + ":" + (e.lineno || 0)));
  window.addEventListener("unhandledrejection", e => logErr("rejection", (e.reason && (e.reason.message || e.reason.name)) || e.reason));
  window.__logErr = logErr;
})();

/* ---------- speech engine (device TTS, fallback only) ---------- */
const Speech = (() => {
  let utterRef = null, speakTimer, resolveCurrent = null, enVoice = null, heVoice = null;
  let lastGesture = 0, firstSpeakDone = false, warmedUp = false, lastUnlock = 0;
  const hasSynth = () => typeof window !== "undefined" && "speechSynthesis" in window && typeof SpeechSynthesisUtterance !== "undefined";
  function pickVoices() {
    if (!hasSynth()) return;
    const voices = window.speechSynthesis.getVoices();
    const en = voices.filter(v => v.lang.replace("_", "-").toLowerCase().startsWith("en-us"));
    enVoice = en.find(v => v.localService) || en[0] || null;
    const he = voices.filter(v => v.lang.replace("_", "-").toLowerCase().startsWith("he"));
    heVoice = he.find(v => v.localService) || he[0] || null;
  }
  if (hasSynth()) { pickVoices(); window.speechSynthesis.addEventListener?.("voiceschanged", pickVoices); }
  ["pointerdown", "touchstart", "keydown", "click"].forEach(ev =>
    window.addEventListener(ev, () => { lastGesture = Date.now(); }, { capture: true, passive: true }));
  function warmUp() {
    // no silent warm-up utterance: on iOS, speechSynthesis grabs the audio
    // session and can keep the lesson's recorded clips from playing
    warmedUp = true;
  }
  if (hasSynth()) window.addEventListener("pointerdown", warmUp, { once: true, capture: true });
  function unlock() {
    lastUnlock = Date.now();
  }
  function say(text, lang) {
    lang = lang || "he";
    if (!hasSynth()) return Promise.resolve();
    const synth = window.speechSynthesis;
    if (resolveCurrent) { const r = resolveCurrent; resolveCurrent = null; r(); }
    clearTimeout(speakTimer);
    const firstDelay = firstSpeakDone ? 0 : 400; firstSpeakDone = true;
    return new Promise(resolve => {
      const run = (attempt) => {
        try {
          if (synth.paused) synth.resume();
          const u = new SpeechSynthesisUtterance(text);
          u.lang = lang === "he" ? "he-IL" : "en-US";
          u.rate = lang === "he" ? 0.8 : 0.5;
          const v = lang === "he" ? heVoice : enVoice;
          if (v) u.voice = v;
          let started = false, done = false;
          const finish = () => { if (done) return; done = true; if (utterRef === u) utterRef = null; if (resolveCurrent) resolveCurrent = null; resolve(); };
          u.onstart = () => { started = true; }; u.onend = finish; u.onerror = finish;
          utterRef = u; resolveCurrent = finish;
          synth.speak(u);
          speakTimer = setTimeout(() => {
            if (!started && utterRef === u) { synth.cancel(); utterRef = null;
              if (attempt < 1) speakTimer = setTimeout(() => run(attempt + 1), 80); else finish();
            } else if (utterRef === u) { finish(); }
          }, attempt < 1 ? 1500 : Math.max(6000, text.length * 300));
        } catch (e) { resolve(); }
      };
      if (synth.speaking || synth.pending || synth.paused) { synth.cancel(); speakTimer = setTimeout(() => run(0), Math.max(80, firstDelay)); }
      else if (firstDelay) speakTimer = setTimeout(() => run(0), firstDelay);
      else run(0);
    });
  }
  return { say, unlock, warmUp };
})();

/* ---------- pre-recorded teacher audio (natural voice) ---------- */
const Player = (() => {
  let current = null, resolveCurrent = null;
  const urls = {};
  // one shared element: iOS Safari blesses playback once per user gesture
  const player = new Audio();
  player.preload = "auto";
  player.playsInline = true;
  function clipUrl(key) {
    if (!urls[key]) {
      if (typeof AUDIO === "undefined" || !AUDIO[key]) return null;
      const bin = atob(AUDIO[key]);
      const bytes = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
      urls[key] = URL.createObjectURL(new Blob([bytes], { type: "audio/mpeg" }));
    }
    return urls[key];
  }
  function unlock() {
    try { const u = clipUrl("he/intro1"); if (u) { const a = new Audio(u); a.muted = true; a.play().then(() => { a.pause(); }).catch(() => {}); } } catch (e) {}
  }
  function play(key) {
    return new Promise(resolve => {
      const u = clipUrl(key);
      if (!u) { resolve(false); return; }
      stop(true);
      let done = false, attempts = 0, retryTimer = null;
      const finish = (ok) => { if (done) return; done = true; if (current === player) current = null; if (resolveCurrent) resolveCurrent = null; resolve(ok !== false); };
      const retryOrFail = (why) => {
        if (done || retryTimer) return;
        window.__audioFail = { key: key, via: why, attempt: attempts, at: Date.now() };
        if (window.__logErr) window.__logErr("audiofail", key + " via " + why + " attempt " + attempts);
        if (attempts < 3) retryTimer = setTimeout(() => { retryTimer = null; attempt(); }, 350);
        else finish(false);
      };
      const attempt = () => {
        if (done) return;
        attempts++;
        current = player; resolveCurrent = finish;
        player.onended = () => finish(true);
        player.onerror = () => retryOrFail("error");
        try { player.src = u; } catch (e) {}
        const p = player.play();
        if (p && p.catch) p.catch((e) => retryOrFail(String(e && e.name || e)));
      };
      attempt();
      setTimeout(() => finish(false), 20000); // never stall the lesson
    });
  }
  function stop(interrupted) {
    if (resolveCurrent) { const f = resolveCurrent; resolveCurrent = null; f(interrupted !== false); }
    if (current) { try { player.onended = null; player.onerror = null; player.pause(); } catch (e) {} current = null; }
  }
  return { play, unlock, stop, clipUrl };
})();

/* say a lesson line: pre-recorded clip first, retry overlay on failure (no TTS fallback for clip lines) */
let activeReplay = null;
async function sayLine(line, isReplay) {
  if (!line.key) { await Speech.say(line.t, line.lang); return; }
  if (!isReplay) { while (activeReplay) { try { await activeReplay; } catch (e) { break; } } }
  for (;;) {
    const ok = await Player.play(line.key);
    if (ok) return;
    await askRetry();
  }
}
function replayLine(line) {
  Speech.unlock(); Player.unlock();
  owl.classList.add("talking");
  const p = sayLine(line, true).then(() => { if (activeReplay === p) activeReplay = null; owl.classList.remove("talking"); });
  activeReplay = p;
}
function askRetry() {
  return new Promise(res => {
    document.getElementById("audioRetry")?.remove();
    const d = document.createElement("div");
    d.id = "audioRetry";
    d.innerHTML = '<button class="cta coral" type="button">🔊 לחצי לשמיעה</button>';
    document.body.appendChild(d);
    d.querySelector("button").addEventListener("click", () => {
      Sfx.tap(); Player.unlock();
      d.remove();
      res(true);
    }, { once: true });
  });
}

/* ---------- tiny WebAudio chimes ---------- */
const Sfx = (() => {
  let ctx = null;
  function ac() { if (!ctx) { try { ctx = new (window.AudioContext || window.webkitAudioContext)(); } catch (e) {} } if (ctx && ctx.state === "suspended") ctx.resume(); return ctx; }
  function tone(freq, t, dur, type, vol) {
    const c = ac(); if (!c) return;
    const o = c.createOscillator(), g = c.createGain();
    o.type = type || "sine"; o.frequency.value = freq;
    g.gain.setValueAtTime(0.0001, c.currentTime + t);
    g.gain.exponentialRampToValueAtTime(vol || 0.18, c.currentTime + t + 0.02);
    g.gain.exponentialRampToValueAtTime(0.0001, c.currentTime + t + dur);
    o.connect(g); g.connect(c.destination);
    o.start(c.currentTime + t); o.stop(c.currentTime + t + dur + 0.05);
  }
  return {
    tap() { tone(660, 0, .12, "sine", .1); },
    good() { tone(523, 0, .16); tone(659, .12, .16); tone(784, .24, .3); },
    wrong() { tone(300, 0, .2, "triangle", .12); tone(240, .15, .3, "triangle", .1); },
    star() { tone(880, 0, .12); tone(1175, .09, .2); },
    fanfare() { [523, 659, 784, 1047].forEach((f, i) => tone(f, i * .14, .3)); tone(1319, .6, .5); }
  };
})();

/* ---------- lesson data ---------- */
const WORDS = LESSON.words;
const PRAISES = [
  { key: "he/praise1", t: "כל הכבוד " + MIA + "!", lang: "he" },
  { key: "he/praise2", t: "מעולה!", lang: "he" },
  { key: "he/praise3", t: "וואו, יופי!", lang: "he" },
  { key: "he/praise4", t: "איזו אלופה!", lang: "he" },
  { key: "he/praise5", t: "נהדר!", lang: "he" }
];

/* ---------- helpers ---------- */
const stage = document.getElementById("stage");
const bubble = document.getElementById("bubble");
const owl = document.getElementById("owl");
const repeatBtn = document.getElementById("repeatBtn");
let session = 0;
let lastPrompt = null;
let stars = 0;

const sleep = ms => new Promise(r => setTimeout(r, ms));
const alive = s => s === session;
function shuffle(a) { a = a.slice(); for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; }

function setBubble(html) { bubble.innerHTML = html; }
function setSeg(id) { const el = document.getElementById(id); if (el) el.classList.add("on"); }
function addStar(fromEl) {
  stars++;
  if (fromEl) {
    const r = fromEl.getBoundingClientRect(), chip = document.getElementById("starsChip").getBoundingClientRect();
    const s = document.createElement("div");
    s.className = "flyStar"; s.textContent = "⭐";
    s.style.left = (r.left + r.width / 2 - 17) + "px"; s.style.top = (r.top + r.height / 2 - 17) + "px";
    document.body.appendChild(s);
    requestAnimationFrame(() => { s.style.left = (chip.left + 10) + "px"; s.style.top = (chip.top + 4) + "px"; s.style.transform = "scale(.4)"; s.style.opacity = ".3"; });
    setTimeout(() => s.remove(), 750);
  }
  setTimeout(() => { document.getElementById("starCount").textContent = stars; }, fromEl ? 650 : 0);
}
async function speakLines(lines, s) {
  for (const line of lines) {
    if (!alive(s)) return;
    if (line.html !== undefined) setBubble(line.html);
    lastPrompt = line;
    owl.classList.add("talking");
    await sayLine(line);
    owl.classList.remove("talking");
    if (!alive(s)) return;
    if (line.pauseAfter) await sleep(line.pauseAfter);
  }
}
function cheer() { owl.classList.remove("cheer"); void owl.offsetWidth; owl.classList.add("cheer"); }

function confetti(n) {
  const colors = ["#FF8A5C", "#3DBEA8", "#FFC93D", "#9B7EDE", "#FF8FB1", "#6BCBFF"];
  for (let i = 0; i < (n || 50); i++) {
    const c = document.createElement("div");
    c.className = "confetti";
    c.style.left = Math.random() * 100 + "vw";
    c.style.background = colors[i % colors.length];
    c.style.animationDuration = (2.2 + Math.random() * 1.8) + "s";
    c.style.animationDelay = (Math.random() * 0.8) + "s";
    if (Math.random() < .5) c.style.borderRadius = "50%";
    document.body.appendChild(c);
    setTimeout(() => c.remove(), 5000);
  }
}

repeatBtn.addEventListener("click", () => {
  if (!lastPrompt) return;
  replayLine(lastPrompt);
});

function praiseLine(html) {
  return Object.assign({}, PRAISES[Math.floor(Math.random() * PRAISES.length)], html ? { html: html } : {});
}

/* ---------- screens ---------- */
function startScreen() {
  session++;
  setBubble("שלום! אני לִילִי 🦉");
  lastPrompt = { t: "שלום! אני לילי!", lang: "he" };
  stage.innerHTML = `
    <div id="startWrap">
      <div class="owlBig">
        <div class="owl" style="position:relative;width:96px;height:112px;">
          <div class="body"></div><div class="belly"></div>
          <div class="eye l"><div class="pupil"></div></div>
          <div class="eye r"><div class="pupil"></div></div>
          <div class="beak"></div><div class="wing l"></div><div class="wing r"></div>
          <div class="foot l"></div><div class="foot r"></div>
        </div>
      </div>
      <p class="title">האנגלית של מיה</p>
      <p class="subtitle">שיעור ${LESSON.id} · ${LESSON.topic} ${LESSON.emoji}</p>
      <button class="cta" id="startBtn">▶ בואי נתחיל!</button>
      <div class="navrow"><a class="navlink" href="lessons.html">🏠 כל השיעורים</a></div>
      <details class="parent">
        <summary>להורים 💛</summary>
        <p>שיעור קצר עם מורה מדברת: מיה שומעת, חוזרת בקול ועונה בלחיצות - בלי קריאה ובלי הקלדה. מומלץ לשבת לידה בפעמים הראשונות, ובסוף לתת לה לספר מה למדה.</p>
      </details>
    </div>`;
  document.getElementById("startBtn").addEventListener("click", () => { Sfx.tap(); Speech.unlock(); Player.unlock(); intro(); });
}

async function intro() {
  const s = ++session;
  setSeg("seg-learn");
  repeatBtn.style.visibility = "visible";
  stage.innerHTML = "";
  await speakLines([
    { key: "he/intro1", t: "היי " + MIA + "! שמחה לראות אותך שוב!", lang: "he", html: "היי " + MIA + "! 👋", pauseAfter: 300 },
    { key: LESSON.intro2key, t: LESSON.intro2, lang: "he", html: "היום לומדים: " + LESSON.topic + "! " + LESSON.emoji, pauseAfter: 500 },
    { key: "he/intro3", t: "מוכנה? בואי נתחיל!", lang: "he", html: "מוכנה? בואי נתחיל! 🎉" }
  ], s);
  if (!alive(s)) return;
  teachWord(0, s);
}

async function teachWord(i, s) {
  if (!alive(s)) return;
  if (i >= WORDS.length) return game1Intro(s);
  const a = WORDS[i];
  stage.innerHTML = `
    <div class="bigcard" id="bigcard" style="border-color:${a.color}">
      <div class="emo">${a.emo}</div>
      <div class="word">${a.en}</div>
    </div>
    <div class="hint">לחצי על התמונה כדי לשמוע שוב 🔊</div>`;
  const card = document.getElementById("bigcard");
  card.addEventListener("click", () => {
    Sfx.tap();
    replayLine({ key: "en/" + a.en, t: a.en, lang: "en" });
  });
  await speakLines([
    { key: "he/this_" + a.en, t: a.heThis + "!", lang: "he", html: a.heThis + "! " + a.emo, pauseAfter: 200 },
    { key: "he/ineng", t: "באנגלית אומרים:", lang: "he", html: 'באנגלית אומרים: <span class="en">' + a.en + '</span>', pauseAfter: 150 },
    { key: "en/" + a.en, t: a.en, lang: "en", html: '<span class="en">' + a.en + '</span> 🗣️', pauseAfter: 350 },
    { key: "en/" + a.en, t: a.en + "!", lang: "en", html: '<span class="en">' + a.en + '</span> 🗣️', pauseAfter: 250 },
    { key: "he/yourturn", t: "עכשיו תורך, מיה!", lang: "he", html: "עכשיו תורך, מיה! 📢", pauseAfter: 100 },
    { key: "en_slow/" + a.en, t: a.en, lang: "en", html: '<span class="en">' + a.en + '</span> 📢' }
  ], s);
  if (!alive(s)) return;
  await sleep(2400);
  if (!alive(s)) return;
  owl.classList.add("talking");
  await sayLine(PRAISES[Math.floor(Math.random() * PRAISES.length)]);
  owl.classList.remove("talking");
  if (!alive(s)) return;
  // movement break after the 2nd and 4th word
  const moveIdx = (i === 1) ? 0 : (i === 3) ? 1 : -1;
  if (moveIdx >= 0 && LESSON.moves[moveIdx]) {
    const mv = LESSON.moves[moveIdx];
    await speakLines([{ key: mv.key, t: mv.t, lang: "he", html: mv.html }], s);
    if (!alive(s)) return;
    await sleep(3500);
  }
  if (!alive(s)) return;
  teachWord(i + 1, s);
}

function optionsRow(target, count, pool) {
  const others = shuffle((pool || WORDS).filter(a => a.en !== target.en)).slice(0, (count || 3) - 1);
  return shuffle([target].concat(others));
}

async function game1Intro(s) {
  setSeg("seg-g1");
  stage.innerHTML = "";
  await speakLines([
    { key: "he/g1intro1", t: "וואו, למדנו חמש מילים חדשות!", lang: "he", html: "חמש מילים חדשות! 🌟", pauseAfter: 400 },
    { key: "he/g1intro2g", t: "עכשיו משחק! אני אשאל, ותלחצי על התשובה הנכונה!", lang: "he", html: "עכשיו משחק! 🎮 לחצי על התשובה הנכונה" }
  ], s);
  if (!alive(s)) return;
  tapGame(s, true, shuffle(WORDS), game2Intro);
}

async function game2Intro(s) {
  const g2 = LESSON.games[1];
  const introClips = {
    tap:    { key: "he/g2intro_g", t: "כל הכבוד! עכשיו משחק אחרון, בלי רמזים! אני אומרת מילה, ותמצאי אותה!", html: "משחק אחרון: בלי רמזים! 👂" },
    catch:  { key: "he/gcatch", t: "עכשיו משחק תפיסה! הדברים בורחים - תפסי את מה שאני אומרת!", html: "משחק תפיסה! 🏃‍♀️ תפסי את הנכון" },
    memory: { key: "he/gmemory", t: "עכשיו משחק זיכרון! הפכי קלפים ומצאי זוגות זהים!", html: "משחק זיכרון! 🦉 מצאי זוגות" },
    odd:    { key: "he/godd", t: "עכשיו משחק מוזר! איזו תמונה לא שייכת לחברים?", html: "מי לא שייך? 🤔" },
    count:  { key: "he/gcount", t: "עכשיו משחק ספירה! כמה דברים את רואה? מצאי את המספר הנכון!", html: "משחק ספירה! 🔢" },
    sentence:{ key: "he/gsentence", t: "עכשיו משחק משפטים! הקשיבי למשפט באנגלית, ומצאי את התמונה!", html: "משחק משפטים! 💬" }
  };
  const ic = introClips[g2] || introClips.tap;
  setSeg("seg-g2");
  await speakLines([{ key: ic.key, t: ic.t, lang: "he", html: ic.html }], s);
  if (!alive(s)) return;
  if (g2 === "tap") tapGame(s, false, shuffle(WORDS), recap);
  else if (g2 === "catch") catchGame(s, shuffle(WORDS), recap);
  else if (g2 === "memory") memoryGame(s, recap);
  else if (g2 === "odd") oddGame(s, recap);
  else if (g2 === "count") countGame(s, shuffle(WORDS), recap);
  else if (g2 === "sentence") sentenceGame(s, shuffle(WORDS), recap);
}

/* ---------- game 1: listen and tap (with Hebrew prompt), or without hint ---------- */
function tapGame(s, withPrompt, order, doneCb) {
  let round = 0;
  const play = async () => {
    if (!alive(s)) return;
    if (round >= order.length) return doneCb(s);
    const target = order[round];
    const opts = optionsRow(target, 3);
    stage.innerHTML = `<div class="optgrid">${opts.map(o =>
      `<div class="opt" data-en="${o.en}" style="border-color:${o.color}33"><div class="emo">${o.emo}</div></div>`).join("")}</div>
      <div class="hint">${withPrompt ? "איפה ה..." : "מה שמעת?"} 🔊 לחצי עליי לשמוע שוב</div>`;
    await sleep(500);
    if (!alive(s)) return;
    if (withPrompt) {
      await speakLines([
        { key: "he/where", t: "איפה ה", lang: "he", html: 'איפה ה<span class="en">' + target.en + '</span>?', pauseAfter: 50 },
        { key: "en/" + target.en, t: target.en + "?", lang: "en", html: 'איפה ה<span class="en">' + target.en + '</span>?' }
      ], s);
    } else {
      await speakLines([{ key: "en/" + target.en, t: target.en, lang: "en", html: "👂 מה שמעת?" }], s);
      if (!alive(s)) return;
      await sleep(300);
      if (!alive(s)) return;
      owl.classList.add("talking"); await sayLine({ key: "en/" + target.en, t: target.en, lang: "en" }); owl.classList.remove("talking");
    }
    if (!alive(s)) return;
    let locked = false;
    stage.querySelectorAll(".opt").forEach(el => {
      el.addEventListener("click", async () => {
        if (locked || !alive(s)) return;
        Speech.unlock();
        if (el.dataset.en === target.en) {
          locked = true;
          el.classList.add("right");
          Sfx.good(); Sfx.star(); cheer();
          addStar(el);
          await speakLines([praiseLine("🌟 " + el.querySelector(".emo").textContent + ' <span class="en">' + target.en + '</span>!')], s);
          if (!alive(s)) return;
          round++;
          play();
        } else {
          locked = true;
          el.classList.add("wrong");
          Sfx.wrong();
          stage.querySelector(".optgrid")?.classList.add("shake");
          await speakLines([{ key: "he/wrong", t: "אופסי, זה לא זה. נסי שוב!", lang: "he", html: "אופסי, נסי שוב! 💪" }], s);
          setTimeout(() => { stage.querySelector(".optgrid")?.classList.remove("shake"); locked = false; }, 300);
          if (!alive(s)) return;
          if (withPrompt) { owl.classList.add("talking"); await sayLine({ key: "he/where", t: "איפה ה", lang: "he" }); await sayLine({ key: "en/" + target.en, t: target.en + "?", lang: "en" }); owl.classList.remove("talking"); }
          else { owl.classList.add("talking"); await sayLine({ key: "en/" + target.en, t: target.en, lang: "en" }); owl.classList.remove("talking"); }
        }
      });
    });
  };
  play();
}

/* ---------- catch game: floating items, tap the called one ---------- */
function catchGame(s, order, doneCb) {
  let round = 0;
  let movers = [];
  function stopMovers() { movers.forEach(m => cancelAnimationFrame(m.raf)); movers = []; }
  const play = async () => {
    if (!alive(s)) return;
    if (round >= order.length) { stopMovers(); return doneCb(s); }
    const target = order[round];
    const opts = optionsRow(target, 4);
    stage.innerHTML = `<div id="catchField">${opts.map(o =>
      `<div class="floater" data-en="${o.en}">${o.emo}</div>`).join("")}</div>
      <div class="hint">תפסי את ה... 🔊</div>`;
    const field = document.getElementById("catchField");
    const W = field.clientWidth, H = field.clientHeight;
    stopMovers();
    field.querySelectorAll(".floater").forEach((el, idx) => {
      const m = {
        el, x: Math.random() * (W - 76), y: Math.random() * (H - 76),
        vx: (0.4 + Math.random() * 0.5) * (idx % 2 ? 1 : -1),
        vy: (0.35 + Math.random() * 0.45) * (idx < 2 ? 1 : -1), raf: 0
      };
      const step = () => {
        m.x += m.vx; m.y += m.vy;
        if (m.x < 0 || m.x > W - 76) m.vx *= -1;
        if (m.y < 0 || m.y > H - 76) m.vy *= -1;
        m.x = Math.max(0, Math.min(W - 76, m.x)); m.y = Math.max(0, Math.min(H - 76, m.y));
        el.style.left = m.x + "px"; el.style.top = m.y + "px";
        m.raf = requestAnimationFrame(step);
      };
      step();
      movers.push(m);
    });
    await sleep(500);
    if (!alive(s)) { stopMovers(); return; }
    await speakLines([
      { key: "he/where", t: "איפה ה", lang: "he", html: 'איפה ה<span class="en">' + target.en + '</span>?', pauseAfter: 50 },
      { key: "en/" + target.en, t: target.en + "?", lang: "en", html: 'איפה ה<span class="en">' + target.en + '</span>?' }
    ], s);
    if (!alive(s)) { stopMovers(); return; }
    let locked = false;
    field.querySelectorAll(".floater").forEach(el => {
      el.addEventListener("click", async () => {
        if (locked || !alive(s)) return;
        Speech.unlock();
        if (el.dataset.en === target.en) {
          locked = true;
          el.classList.add("right");
          Sfx.good(); Sfx.star(); cheer();
          addStar(el);
          await speakLines([praiseLine("🌟 " + el.textContent + ' <span class="en">' + target.en + '</span>!')], s);
          if (!alive(s)) { stopMovers(); return; }
          round++;
          play();
        } else {
          locked = true;
          el.classList.add("wrongPick");
          Sfx.wrong();
          await speakLines([{ key: "he/wrong", t: "אופסי, זה לא זה. נסי שוב!", lang: "he", html: "אופסי, נסי שוב! 💪" }], s);
          locked = false;
          if (!alive(s)) { stopMovers(); return; }
          owl.classList.add("talking"); await sayLine({ key: "he/where", t: "איפה ה", lang: "he" }); await sayLine({ key: "en/" + target.en, t: target.en + "?", lang: "en" }); owl.classList.remove("talking");
        }
      });
    });
  };
  play();
}

/* ---------- memory game: flip cards, find matching pairs, hear the word ---------- */
function memoryGame(s, doneCb) {
  let doneCalled = false;
  const finishOnce = () => { if (doneCalled) return; doneCalled = true; doneCb(s); };
  const picks = shuffle(WORDS).slice(0, 4);
  const cards = shuffle(picks.concat(picks));
  let open = [], matched = 0, lock = false;
  stage.innerHTML = `<div class="memgrid">${cards.map((c, i) =>
    `<button class="memcard" data-en="${c.en}" data-i="${i}" type="button"><div class="inner"><div class="face front">🦉</div><div class="face back">${c.emo}</div></div></button>`).join("")}</div>
    <div class="hint">הפכי קלפים ומצאי זוגות זהים 🦉</div>`;
  stage.querySelectorAll(".memcard").forEach(el => {
    el.addEventListener("click", async () => {
      if (lock || !alive(s) || el.classList.contains("flipped")) return;
      Speech.unlock();
      el.classList.add("flipped");
      const word = el.dataset.en;
      replayLine({ key: "en/" + word, t: word, lang: "en" });
      open.push(el);
      if (open.length < 2) return;
      lock = true;
      const [a, b] = open; open = [];
      await sleep(700);
      if (!alive(s)) return;
      if (a.dataset.en === b.dataset.en) {
        a.classList.add("matched"); b.classList.add("matched");
        Sfx.good(); Sfx.star(); cheer();
        addStar(b);
        matched++;
        lock = false;
        await speakLines([praiseLine('🌟 זוג של <span class="en">' + a.dataset.en + '</span>!')], s);
        if (!alive(s)) return;
        if (matched >= picks.length) { await sleep(600); finishOnce(); }
      } else {
        Sfx.wrong();
        await sleep(700);
        if (!alive(s)) return;
        a.classList.remove("flipped"); b.classList.remove("flipped");
        lock = false;
      }
    });
  });
}

/* ---------- odd-one-out: which picture does not belong ---------- */
function oddGame(s, doneCb) {
  let round = 0;
  const play = async () => {
    if (!alive(s)) return;
    if (round >= LESSON.oddExtras.length) return doneCb(s);
    const odd = LESSON.oddExtras[round];
    const friends = shuffle(WORDS).slice(0, 3);
    const opts = shuffle(friends.concat([odd]));
    stage.innerHTML = `<div class="optgrid four">${opts.map(o =>
      `<div class="opt" data-en="${o.en}" style="border-color:${(o.color || "#DDD")}33"><div class="emo">${o.emo}</div></div>`).join("")}</div>
      <div class="hint">מי לא שייך לחברים? 🤔</div>`;
    await sleep(400);
    if (!alive(s)) return;
    await speakLines([{ key: "he/godd_q", t: "איזו תמונה לא שייכת?", lang: "he", html: "איזו תמונה לא שייכת? 🤔" }], s);
    if (!alive(s)) return;
    let locked = false;
    stage.querySelectorAll(".opt").forEach(el => {
      el.addEventListener("click", async () => {
        if (locked || !alive(s)) return;
        Speech.unlock();
        if (el.dataset.en === odd.en) {
          locked = true;
          el.classList.add("right");
          Sfx.good(); Sfx.star(); cheer();
          addStar(el);
          await speakLines([praiseLine('🌟 נכון! ' + el.querySelector(".emo").textContent + ' לא שייך!')], s);
          if (!alive(s)) return;
          round++;
          play();
        } else {
          locked = true;
          el.classList.add("wrong");
          Sfx.wrong();
          stage.querySelector(".optgrid")?.classList.add("shake");
          await speakLines([{ key: "he/wrong", t: "אופסי, זה לא זה. נסי שוב!", lang: "he", html: "אופסי, נסי שוב! 💪" }], s);
          setTimeout(() => { stage.querySelector(".optgrid")?.classList.remove("shake"); locked = false; }, 300);
        }
      });
    });
  };
  play();
}

/* ---------- count game: how many do you see? (reviews numbers 1-5, approved l3 clips) ---------- */
function countGame(s, order, doneCb) {
  const NUMS = ["one", "two", "three", "four", "five"];
  const numberStart = LESSON.id === 12 ? 11 : LESSON.id === 13 ? 16 : 0;
  let round = 0;
  const play = async () => {
    if (!alive(s)) return;
    if (round >= order.length) return doneCb(s);
    const word = order[round];
    const targetCount = numberStart ? numberStart + WORDS.findIndex(w => w.en === word.en) : round + 1;
    const targetName = numberStart ? word.en : NUMS[targetCount - 1];
    const candidates = NUMS.map((_, i) => i + (numberStart || 1));
    const counts = shuffle([targetCount, ...shuffle(candidates.filter(n => n !== targetCount)).slice(0, 2)]);
    stage.innerHTML = `<div class="countgrid">${counts.map(n =>
      `<div class="countopt" data-n="${n}">${numberStart ? `<div class="dotgroup">${Array(n).fill('<span class="countdot"></span>').join("")}</div>` : Array(n).fill(`<span class="emo">${word.emo}</span>`).join("")}<span class="badge">${n}</span></div>`).join("")}</div>
      <div class="hint">כמה דברים את רואה? 🔊</div>`;
    await sleep(500);
    if (!alive(s)) return;
    await speakLines([
      { key: "he/where", t: "איפה ה", lang: "he", html: 'מצאי <span class="en" dir="ltr">' + targetName + '</span>', pauseAfter: 50 },
      { key: "en/" + targetName, t: targetName + "?", lang: "en", html: 'מצאי <span class="en" dir="ltr">' + targetName + '</span>' }
    ], s);
    if (!alive(s)) return;
    let locked = false;
    stage.querySelectorAll(".countopt").forEach(el => {
      el.addEventListener("click", async () => {
        if (locked || !alive(s)) return;
        Speech.unlock();
        if (parseInt(el.dataset.n, 10) === targetCount) {
          locked = true;
          el.classList.add("right");
          Sfx.good(); Sfx.star(); cheer();
          addStar(el);
          await speakLines([praiseLine('🌟 <span class="en">' + targetName + '</span> ' + word.emo + '!')], s);
          if (!alive(s)) return;
          round++;
          play();
        } else {
          locked = true;
          el.classList.add("wrong");
          Sfx.wrong();
          stage.querySelector(".countgrid")?.classList.add("shake");
          await speakLines([{ key: "he/wrong", t: "אופסי, זה לא זה. נסי שוב!", lang: "he", html: "אופסי, נסי שוב! 💪" }], s);
          setTimeout(() => { stage.querySelector(".countgrid")?.classList.remove("shake"); locked = false; }, 300);
          if (!alive(s)) return;
          owl.classList.add("talking"); await sayLine({ key: "he/where", t: "איפה ה", lang: "he" }); await sayLine({ key: "en/" + targetName, t: targetName + "?", lang: "en" }); owl.classList.remove("talking");
        }
      });
    });
  };
  play();
}

/* ---------- sentence game: hear "I see a <word>", tap the picture ---------- */
function sentenceGame(s, order, doneCb) {
  // This fixed audio frame needs a singular count noun. Other words still appear in learning and recap.
  order = order.filter(w => !["soap", "mommy", "happy"].includes(w.en));
  let round = 0;
  const play = async () => {
    if (!alive(s)) return;
    if (round >= order.length) return doneCb(s);
    const target = order[round];
    const opts = optionsRow(target, 3);
    stage.innerHTML = `<div class="sentCard" dir="ltr">I see a <span class="en">${target.en}</span> ${target.emo}</div>
      <div class="optgrid">${opts.map(o =>
      `<div class="opt" data-en="${o.en}" style="border-color:${o.color}33"><div class="emo">${o.emo}</div></div>`).join("")}</div>
      <div class="hint">👂 הקשיבי למשפט ומצאי את התמונה</div>`;
    await sleep(500);
    if (!alive(s)) return;
    await speakLines([
      { key: "en/iseea", t: "I see a", lang: "en", html: '<span dir="ltr" style="display:inline-block">I see a <span class="en">' + target.en + '</span></span>', pauseAfter: 30 },
      { key: "en/" + target.en, t: target.en + ".", lang: "en", html: '<span dir="ltr" style="display:inline-block">I see a <span class="en">' + target.en + '</span></span>' }
    ], s);
    if (!alive(s)) return;
    let locked = false;
    stage.querySelectorAll(".opt").forEach(el => {
      el.addEventListener("click", async () => {
        if (locked || !alive(s)) return;
        Speech.unlock();
        if (el.dataset.en === target.en) {
          locked = true;
          el.classList.add("right");
          Sfx.good(); Sfx.star(); cheer();
          addStar(el);
          await speakLines([praiseLine('🌟 <span dir="ltr" style="display:inline-block">I see a <span class="en">' + target.en + '</span>!</span>')], s);
          if (!alive(s)) return;
          round++;
          play();
        } else {
          locked = true;
          el.classList.add("wrong");
          Sfx.wrong();
          stage.querySelector(".optgrid")?.classList.add("shake");
          await speakLines([{ key: "he/wrong", t: "אופסי, זה לא זה. נסי שוב!", lang: "he", html: "אופסי, נסי שוב! 💪" }], s);
          setTimeout(() => { stage.querySelector(".optgrid")?.classList.remove("shake"); locked = false; }, 300);
          if (!alive(s)) return;
          owl.classList.add("talking"); await sayLine({ key: "en/iseea", t: "I see a", lang: "en" }); await sayLine({ key: "en/" + target.en, t: target.en + ".", lang: "en" }); owl.classList.remove("talking");
        }
      });
    });
  };
  play();
}

/* ---------- recap + finale ---------- */
async function recap(s) {
  setSeg("seg-end");
  stage.innerHTML = `<div class="parade">${WORDS.map(a =>
    `<div class="pitem" id="p-${a.en.replace(/\s/g, "_")}"><div class="emo">${a.emo}</div><div class="word">${a.en}</div></div>`).join("")}</div>`;
  await speakLines([{ key: "he/recap", t: "בואי נזכור מה למדנו היום!", lang: "he", html: "מה למדנו היום? 🌈", pauseAfter: 300 }], s);
  for (const a of WORDS) {
    if (!alive(s)) return;
    document.querySelectorAll(".pitem").forEach(p => p.classList.remove("now"));
    const el = document.getElementById("p-" + a.en.replace(/\s/g, "_"));
    if (el) el.classList.add("now");
    setBubble('<span class="en">' + a.en + '</span> - ' + a.he + ' ' + a.emo);
    owl.classList.add("talking");
    await sayLine({ key: "en/" + a.en, t: a.en, lang: "en" });
    owl.classList.remove("talking");
    if (!alive(s)) return;
    await sleep(500);
  }
  if (!alive(s)) return;
  finale(s);
}

async function finale(s) {
  setSeg("seg-end");
  Sfx.fanfare();
  confetti(70);
  const f2 = LESSON.finale2 || "למדנו היום חמש מילים חדשות באנגלית!";
  stage.innerHTML = `
    <div id="finaleWrap">
      <div class="sticker">${LESSON.medal || "🏅"}</div>
      <div class="starRow">${Array(Math.min(stars, 10)).fill(0).map((_, i) => `<span style="animation-delay:${i * 0.12}s">⭐</span>`).join("")}</div>
      <p class="title">כל הכבוד ${MIA}!</p>
      <p class="subtitle">סיימנו שיעור שלם באנגלית!</p>
      <button class="cta" id="againBtn">🔁 עוד פעם</button>
      <a class="navlink" href="lessons.html" style="margin-top:12px">🏠 כל השיעורים</a>
    </div>`;
  try { localStorage.setItem("mia-english-lesson" + LESSON.id, JSON.stringify({ done: true, stars: stars, at: Date.now() })); } catch (e) {}
  await speakLines([
    { key: "he/finale1", t: "כל הכבוד " + MIA + "! סיימנו שיעור שלם באנגלית!", lang: "he", html: "כל הכבוד " + MIA + "! 🏅", pauseAfter: 300 },
    { key: LESSON.finale2key || "he/finale2", t: f2, lang: "he", html: WORDS.map(w => w.en).join(" · "), pauseAfter: 300 },
    { key: "he/finale3", t: "מיה, אלופת האנגלית! נתראה בשיעור הבא! ביי ביי!", lang: "he", html: "מיה, אלופת האנגלית! 👋💛" }
  ], s);
  if (!alive(s)) return;
  document.getElementById("againBtn")?.addEventListener("click", () => { Sfx.tap(); stars = 0; document.getElementById("starCount").textContent = 0; ["seg-learn", "seg-g1", "seg-g2", "seg-end"].forEach(id => document.getElementById(id)?.classList.remove("on")); intro(); });
}

startScreen();
