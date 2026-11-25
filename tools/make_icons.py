#!/usr/bin/env python3
"""App icons for "add to home screen", made only from the approved avatar
(assets/mia-avatar.jpg, unaltered pixels, scaled) on the site's own sky-to-cream background.

  icons/icon-192.png, icons/icon-512.png      "any" icons (avatar circle with a white ring)
  icons/icon-maskable-512.png                 maskable: avatar inside the 80% safe zone
  icons/apple-touch-icon.png (180)            iOS home screen (opaque; iOS rounds the corners)
  favicon.ico (16+32+48), icons/favicon-32.png
Usage: python3 tools/make_icons.py   (needs Pillow)
"""
import os
from PIL import Image, ImageDraw

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
AV = Image.open(os.path.join(ROOT, "assets", "mia-avatar.jpg")).convert("RGB")
OUT = os.path.join(ROOT, "icons")
STOPS = [(0.0, (0xBF, 0xE9, 0xFF)), (0.55, (0xDF, 0xF4, 0xE4)), (1.0, (0xFF, 0xF3, 0xD6))]   # body gradient


def background(n):
    bg = Image.new("RGB", (n, n))
    px = bg.load()
    for y in range(n):
        t = y / (n - 1)
        for (t0, c0), (t1, c1) in zip(STOPS, STOPS[1:]):
            if t0 <= t <= t1:
                u = (t - t0) / (t1 - t0)
                c = tuple(int(c0[i] + (c1[i] - c0[i]) * u) for i in range(3))
                break
        for x in range(n):
            px[x, y] = c
    return bg


def icon(n, frac, ring=0.035):
    """Avatar circle covering `frac` of the icon width, centred, white ring."""
    S = 4
    big = background(n * S)
    d = int(n * S * frac)
    off = (n * S - d) // 2
    r = int(n * S * ring)
    ImageDraw.Draw(big).ellipse([off - r, off - r, off + d + r, off + d + r], fill=(255, 255, 255))
    face = AV.resize((d, d), Image.LANCZOS)
    m = Image.new("L", (d, d), 0)
    ImageDraw.Draw(m).ellipse([0, 0, d - 1, d - 1], fill=255)
    big.paste(face, (off, off), m)
    return big.resize((n, n), Image.LANCZOS)


def main():
    os.makedirs(OUT, exist_ok=True)
    icon(192, 0.84).save(os.path.join(OUT, "icon-192.png"), optimize=True)
    icon(512, 0.84).save(os.path.join(OUT, "icon-512.png"), optimize=True)
    icon(512, 0.66, 0.03).save(os.path.join(OUT, "icon-maskable-512.png"), optimize=True)   # circle r=0.36 < 0.40 safe zone
    icon(180, 0.86).save(os.path.join(OUT, "apple-touch-icon.png"), optimize=True)
    fav = icon(64, 0.92, 0.03)
    fav.resize((32, 32), Image.LANCZOS).save(os.path.join(OUT, "favicon-32.png"), optimize=True)
    fav.save(os.path.join(ROOT, "favicon.ico"), sizes=[(16, 16), (32, 32), (48, 48)])
    print("icons written")


if __name__ == "__main__":
    main()
