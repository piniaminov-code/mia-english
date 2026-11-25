#!/usr/bin/env python3
"""Offline mouth timing (visemes) for the recorded lesson clips - version 2.

Reads every *audio*.js bundle in the site root (base64 MP3 clips keyed like "he/intro1"),
decodes each clip locally with ffmpeg (nothing is uploaded anywhere), and writes
<bundle>.lips.json next to it:

  {"v": 2, "unit": 10, "clips": {"he/intro1": {"m": "0:12 5:6 2:14 ...", "b": [31, 58]}, ...}}

  m: run-length mouth track, "shape:duration" with durations in 10 ms units
  b: times (10 ms units) of stressed-syllable peaks, used for a small head bob

Mouth shapes:
  0 rest       silence - no overlay, the avatar's own closed smile
  1 small      quiet / weak vowels, onsets and offsets
  2 aa         loud open vowel (energy weighted to the 700-2000 Hz first-formant region)
  3 ee         spread vowel (energy pushed up into the 2-4 kHz band)
  4 oo         rounded vowel (energy concentrated below ~900 Hz)
  5 closed     m/b/p: nasal murmur, or a short silent gap before a burst (plosive closure)
  6 f/v        teeth on lower lip: weak, flat, noisy frames
  7 s/sh       narrow, teeth showing: strong high-frequency hiss (high zero-crossing rate)

Features per 10 ms frame (32 ms Hann window): RMS loudness relative to the clip's peak,
zero-crossing rate, spectral centroid, and band-energy ratios. Vowel-colour thresholds are
percentiles calibrated separately for the Hebrew teacher voice and the English voice.

What this is and is not: it is driven by the sound itself, frame by frame. It is NOT a
phoneme alignment of the words (no Hebrew forced aligner is available offline), so the
timing of opening/closing is measured, while the specific shape is an informed guess.

Smoothing: a 5-frame mode filter, then every run is held at least MIN_HOLD (60 ms); short
runs are merged into the more similar neighbour. The browser crossfades between shapes.

Usage:  python3 tools/lipsync_analyze.py            (all bundles)
Needs:  python3, numpy, ffmpeg.
"""
import base64, json, os, re, subprocess, sys
import numpy as np

SR = 16000
HOP = 160          # 10 ms
WIN = 512          # 32 ms
MIN_HOLD = 6       # frames of 10 ms = 60 ms
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PAIR = re.compile(r'"([a-z_]+/[^"]+)"\s*:\s*"([A-Za-z0-9+/=]{200,})"')

REST, SMALL, AA, EE, OO, CLOSED, FV, SS = range(8)


def decode(mp3: bytes) -> np.ndarray:
    p = subprocess.run(["ffmpeg", "-v", "quiet", "-i", "pipe:0", "-ac", "1", "-ar", str(SR), "-f", "s16le", "pipe:1"],
                       input=mp3, stdout=subprocess.PIPE, check=True)
    return np.frombuffer(p.stdout, dtype=np.int16).astype(np.float32) / 32768.0


def features(x: np.ndarray) -> dict:
    n = max(1, int(np.ceil(len(x) / HOP)))
    pad = np.concatenate([np.zeros(WIN // 2), x, np.zeros(WIN)])
    win = np.hanning(WIN)
    raw = np.stack([pad[i * HOP:i * HOP + WIN] for i in range(n)])
    frames = raw * win
    spec = np.abs(np.fft.rfft(frames, axis=1)) ** 2 + 1e-12
    f = np.fft.rfftfreq(WIN, 1 / SR)

    def band(lo, hi):
        m = (f >= lo) & (f < hi)
        return spec[:, m].sum(axis=1) + 1e-10

    rms = np.sqrt((frames ** 2).mean(axis=1)) + 1e-9
    db = 20 * np.log10(rms)
    db -= db.max()
    db_s = np.convolve(db, np.ones(3) / 3, mode="same")
    signs = np.signbit(raw[:, WIN // 4: 3 * WIN // 4])
    zcr = (signs[:, 1:] != signs[:, :-1]).mean(axis=1)
    low, mid, hi, top = band(100, 900), band(900, 2000), band(2000, 4000), band(4000, 7900)
    tot = low + mid + hi + top
    cen = (spec * f).sum(axis=1) / spec.sum(axis=1)
    return {"db": db_s, "zcr": zcr, "cen": cen, "open": np.log(mid / low), "bright": np.log(hi / low),
            "top": top / tot, "low": low / tot}


def calibrate(feats):
    voiced = [(f["open"][m], f["bright"][m]) for f in feats for m in [(f["db"] > -30) & (f["zcr"] < 0.12)]]
    op = np.concatenate([v[0] for v in voiced]); br = np.concatenate([v[1] for v in voiced])
    pc = lambda a, q: float(np.percentile(a, q))
    return {"op50": pc(op, 50), "op60": pc(op, 60), "br20": pc(br, 20), "br70": pc(br, 70), "op25": pc(op, 25)}


def classify(F, cal):
    db, zcr, cen, op, br, top, low = F["db"], F["zcr"], F["cen"], F["open"], F["bright"], F["top"], F["low"]
    n = len(db)
    lab = np.zeros(n, dtype=int)
    for i in range(n):
        d = db[i]
        if d < -36:
            lab[i] = REST
        elif zcr[i] > 0.18 and top[i] > 0.30:                    # unvoiced hiss
            lab[i] = SS if (cen[i] > 4200 and d > -26) else FV
        elif zcr[i] > 0.12 and top[i] > 0.20 and d < -14:
            lab[i] = FV                                           # weak, noisy: f/v/h
        elif br[i] > cal["br70"]:
            lab[i] = EE if d > -22 else SMALL
        elif low[i] > 0.85 and op[i] < cal["op25"] and br[i] < cal["br20"] and d < -9:
            lab[i] = CLOSED                                       # nasal murmur (m/n): lips together
        elif br[i] < cal["br20"] and op[i] < cal["op50"]:
            lab[i] = OO
        elif op[i] > cal["op60"] and d > -13:
            lab[i] = AA
        elif d > -8:
            lab[i] = AA
        else:
            lab[i] = SMALL
    # syllable rhythm: in a loudness valley >=4 dB below the peaks on both sides (within 120 ms)
    # the jaw half-closes between syllables
    env = np.convolve(db, np.ones(5) / 5, mode="same")
    for i in range(3, n - 3):
        if lab[i] in (AA, EE, OO) and env[i] == env[i - 3:i + 4].min():
            lp, rp = env[max(0, i - 12):i].max(), env[i + 1:i + 13].max()
            if lp - env[i] >= 4 and rp - env[i] >= 4:
                lab[max(0, i - 3):i + 3] = SMALL
    # lip closures (b/p/m): a short dip (<=90 ms) at least 8 dB below the voiced sound on both
    # sides, or a near-silent gap before a burst
    i = 1
    while i < n - 1:
        if db[i] < db[i - 1] - 3:
            j = i
            while j < n and db[j] < db[i - 1] - 3 and j - i < 12:
                j += 1
            seg = db[i:j]
            if 0 < j - i <= 9 and j < n:
                before = db[max(0, i - 6):i].max()
                after = db[j:min(n, j + 6)].max()
                bottom = seg.min()
                if (before - bottom >= 8 and after - bottom >= 8 and before > -20 and after > -20) or \
                        (bottom < -28 and before > -20 and after > -20):
                    k0 = i + int(np.argmin(seg))
                    lab[max(i, k0 - 3):min(j, k0 + 3)] = CLOSED
            i = j
        i += 1
    return lab


# perceptual similarity between shapes, used when a short run must merge into a neighbour
SIM = {(SMALL, AA): 2, (SMALL, EE): 2, (SMALL, OO): 2, (AA, EE): 1, (AA, OO): 1, (CLOSED, REST): 2,
       (FV, SS): 2, (SS, EE): 2, (CLOSED, SMALL): 1, (FV, SMALL): 1}


def sim(a, b):
    return 3 if a == b else SIM.get((a, b), SIM.get((b, a), 0))


def smooth(lab):
    n = len(lab)
    out = lab.copy()
    for i in range(2, n - 2):                                     # 5-frame mode filter
        w = list(lab[i - 2:i + 3])
        best = max(set(w), key=lambda v: (w.count(v), v == lab[i]))
        if w.count(best) >= 3:
            out[i] = best
    runs = []
    for v in out:
        if runs and runs[-1][0] == v:
            runs[-1][1] += 1
        else:
            runs.append([int(v), 1])
    changed = True
    while changed and len(runs) > 1:                              # enforce the minimum hold
        changed = False
        k = min(range(len(runs)), key=lambda r: runs[r][1])
        if runs[k][1] >= MIN_HOLD:
            break
        left = runs[k - 1] if k > 0 else None
        right = runs[k + 1] if k + 1 < len(runs) else None
        tgt = max([x for x in (left, right) if x], key=lambda r: (sim(r[0], runs[k][0]), r[1]))
        tgt[1] += runs[k][1]
        del runs[k]
        merged = []                                               # join equal neighbours
        for r in runs:
            if merged and merged[-1][0] == r[0]:
                merged[-1][1] += r[1]
            else:
                merged.append(r)
        runs = merged
        changed = True
    return runs


def beats(db):
    """Stressed-syllable peaks: local maxima of the loudness envelope, >=180 ms apart."""
    env = np.convolve(db, np.ones(9) / 9, mode="same")
    pk = [i for i in range(4, len(env) - 4) if env[i] > -9 and env[i] == env[i - 4:i + 5].max()]
    out = []
    for i in pk:
        if not out or i - out[-1] >= 18:
            out.append(i)
    return out


def main(names):
    if not names:
        names = sorted(f for f in os.listdir(ROOT) if re.search(r"audio\d*\.js$", f))
    feats = {}
    for name in names:
        src = open(os.path.join(ROOT, name), encoding="utf-8").read()
        feats[name] = {}
        for key, b64 in PAIR.findall(src):
            try:
                feats[name][key] = features(decode(base64.b64decode(b64)))
            except Exception as e:
                print("  skip", key, e, file=sys.stderr)
    voice = lambda k: "he" if k.startswith("he") else "en"
    allf = [(k, f) for nm in feats for k, f in feats[nm].items()]
    cal = {v: calibrate([f for k, f in allf if voice(k) == v] or [f for _, f in allf]) for v in ("he", "en")}
    stats, vsecs = [], []
    for name in names:
        clips = {}
        for k, F in feats[name].items():
            runs = smooth(classify(F, cal[voice(k)]))
            clips[k] = {"m": " ".join(f"{s}:{d}" for s, d in runs), "b": beats(F["db"])}
            dur = len(F["db"]) / 100
            stats.append((k, dur, len(runs) - 1, min(d for _, d in runs) * 10))
            vsecs.append(sum(d for sh, d in runs if sh != REST) / 100)
        outp = os.path.join(ROOT, name[:-3] + ".lips.json")
        with open(outp, "w", encoding="utf-8") as fh:
            json.dump({"v": 2, "unit": 10, "clips": clips}, fh, ensure_ascii=False, separators=(",", ":"))
        print(f"{name}: {len(clips)} clips -> {os.path.basename(outp)} ({os.path.getsize(outp)} bytes)")
    rates = np.array([t / d for _, d, t, _ in stats if d > 0.5])
    voiced = np.array([t / max(0.3, v) for _, d, t, _, v in [(k, d, t, m, vs) for (k, d, t, m), vs in zip(stats, vsecs)] if d > 0.5])
    print(f"per voiced second: median {np.median(voiced):.1f}  p10 {np.percentile(voiced, 10):.1f}  p90 {np.percentile(voiced, 90):.1f}")
    print(f"clips={len(stats)}  transitions/s: median {np.median(rates):.1f}  p10 {np.percentile(rates, 10):.1f}"
          f"  p90 {np.percentile(rates, 90):.1f}  shortest run {min(s[3] for s in stats)} ms")


if __name__ == "__main__":
    main(sys.argv[1:])
