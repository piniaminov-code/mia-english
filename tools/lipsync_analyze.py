#!/usr/bin/env python3
"""Offline lip-sync timing for the recorded lesson clips.

Reads every *audio*.js bundle in the site root (base64 MP3 clips keyed like "he/intro1"),
decodes each clip locally with ffmpeg (nothing is uploaded anywhere), and writes
<bundle>.lips.json next to it:

    {"v": 1, "fps": 25, "clips": {"he/intro1": "0012223441...", ...}}

One character per 40 ms frame, a mouth shape id:
    0 rest (no overlay - the avatar's own closed smile)
    1 slightly open          (quiet voiced sound, onsets/offsets)
    2 open "a"               (loud, energy weighted to the first-formant band)
    3 wide "e/i"             (energy pushed up into the 1.8-3.5 kHz band)
    4 round "o/u"            (energy concentrated below ~900 Hz, little above)
    5 pressed lips "m/b/p"   (short dip to near-silence between two voiced stretches)

What is measured vs. inferred:
  - WHEN the mouth moves is measured: loudness per 40 ms frame from the waveform,
    and the browser drives the frames from the audio element's own clock.
  - WHICH vowel-ish shape is shown is inferred from coarse spectral balance. It is
    not phoneme recognition (no Hebrew forced aligner is available offline), so a
    given frame's shape can be wrong even when the timing is right.

Usage:  python3 tools/lipsync_analyze.py            (all bundles)
        python3 tools/lipsync_analyze.py l4audio.js (some bundles)
Needs: python3, numpy, ffmpeg.
"""
import base64, json, os, re, subprocess, sys
import numpy as np

SR = 16000
FPS = 25
HOP = SR // FPS          # 640 samples = 40 ms
WIN = 1024
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PAIR = re.compile(r'"([a-z_]+/[^"]+)"\s*:\s*"([A-Za-z0-9+/=]{200,})"')


def decode(mp3: bytes) -> np.ndarray:
    p = subprocess.run(["ffmpeg", "-v", "quiet", "-i", "pipe:0", "-ac", "1", "-ar", str(SR), "-f", "s16le", "pipe:1"],
                       input=mp3, stdout=subprocess.PIPE, check=True)
    return np.frombuffer(p.stdout, dtype=np.int16).astype(np.float32) / 32768.0


def band(spec, freqs, lo, hi):
    m = (freqs >= lo) & (freqs < hi)
    return spec[:, m].sum(axis=1) + 1e-10


def features(x: np.ndarray):
    n = max(1, int(np.ceil(len(x) / HOP)))
    pad = np.concatenate([np.zeros(WIN // 2), x, np.zeros(WIN)])
    win = np.hanning(WIN)
    frames = np.stack([pad[i * HOP:i * HOP + WIN] * win for i in range(n)])
    spec = np.abs(np.fft.rfft(frames, axis=1)) ** 2
    freqs = np.fft.rfftfreq(WIN, 1 / SR)
    rms = np.sqrt((frames ** 2).mean(axis=1)) + 1e-9
    db = 20 * np.log10(rms)
    db -= db.max()                                      # 0 dB = loudest frame of this clip
    db = np.convolve(db, [0.25, 0.5, 0.25], mode="same")  # light smoothing
    low = band(spec, freqs, 150, 700)                   # F0 + low F1 (closed/rounded vowels, nasals)
    mid = band(spec, freqs, 700, 1500)                  # F1 of open vowels ("a")
    hi2 = band(spec, freqs, 1800, 3500)                 # F2/F3 of front vowels ("e", "i")
    fric = band(spec, freqs, 4000, 7900)                # s/sh/f noise
    total = low + mid + hi2 + fric
    return {"db": db, "open": np.log(mid / low), "bright": np.log(hi2 / low), "fric": fric / total}


def classify(f, cal) -> str:
    """cal: per-voice percentiles of the voiced frames (from all clips of that voice)."""
    db, op, br, fr = f["db"], f["open"], f["bright"], f["fric"]
    n = len(db)
    out = []
    for i in range(n):
        d = db[i]
        if d < -32:
            out.append(0)
        elif fr[i] > 0.40 and d < -6:
            out.append(3)                               # hissy consonant: teeth together, lips spread
        elif br[i] < cal["br20"] and op[i] < cal["op30"] and d < -8:
            out.append(5)                               # nasal murmur (m/n): lips together
        elif br[i] < cal["br20"]:
            out.append(4)                               # dark vowel: rounded
        elif br[i] > cal["br70"] and op[i] < cal["op70"]:
            out.append(3)                               # bright vowel: spread
        elif op[i] > cal["op55"] and d > -14:
            out.append(2)                               # open vowel
        elif d > -7:
            out.append(2)
        else:
            out.append(1)
    # stop closures: a short (<=2 frame) dip to near-silence between voiced stretches -> pressed lips
    for i in range(1, n - 1):
        if db[i] < -22 and db[i - 1] > -14:
            j = i
            while j < n and db[j] < -22:
                j += 1
            if j - i <= 2 and j < n and db[j] > -14:
                for k in range(i, j):
                    out[k] = 5
    # no single-frame flicker: a lone frame takes its left neighbour's shape
    for i in range(1, n - 1):
        if out[i] != out[i - 1] and out[i] != out[i + 1] and out[i] not in (0, 5):
            out[i] = out[i - 1]
    return "".join(str(v) for v in out)


def calibrate(feats):
    voiced = [f for f in feats]
    op = np.concatenate([f["open"][f["db"] > -32] for f in voiced])
    br = np.concatenate([f["bright"][f["db"] > -32] for f in voiced])
    pc = lambda a, q: float(np.percentile(a, q))
    return {"op30": pc(op, 30), "op55": pc(op, 55), "op70": pc(op, 70), "br20": pc(br, 20), "br70": pc(br, 70)}


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
            except Exception as e:  # a missing entry just means "no lip-sync" for that clip
                print("  skip", key, e, file=sys.stderr)
    voice = lambda k: "he" if k.startswith("he") else "en"
    cal = {v: calibrate([f for nm in feats for k, f in feats[nm].items() if voice(k) == v] or
                        [f for nm in feats for f in feats[nm].values()]) for v in ("he", "en")}
    for name in names:
        clips = {k: classify(f, cal[voice(k)]) for k, f in feats[name].items()}
        outp = os.path.join(ROOT, name[:-3] + ".lips.json")
        with open(outp, "w", encoding="utf-8") as fh:
            json.dump({"v": 1, "fps": FPS, "clips": clips}, fh, ensure_ascii=False, separators=(",", ":"))
        print(f"{name}: {len(clips)} clips -> {os.path.basename(outp)} ({os.path.getsize(outp)} bytes)")


if __name__ == "__main__":
    main(sys.argv[1:])
