#!/usr/bin/env python3
"""Draw the avatar's talking-mouth overlay sprites (assets/mouth/m1..m5.png).

The avatar picture itself is never modified. Each sprite covers only the mouth box
(BOX below, in the 384x384 avatar's pixel space): the original lips are hidden by skin
filled in from the avatar's own pixels just above and below the mouth, and a new mouth
shape is painted with colours sampled from her lips. Edges are feathered so the sprite
blends into the face. Shape 0 (rest) has no sprite: the original closed smile shows.

Usage: python3 tools/make_mouth_sprites.py   (needs Pillow)
"""
import os
from PIL import Image, ImageDraw, ImageFilter

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SRC = os.path.join(ROOT, "assets", "mia-avatar.jpg")
OUT = os.path.join(ROOT, "assets", "mouth")
BOX = (184, 222, 260, 270)          # x0, y0, x1, y1 in the 384px avatar
SS = 8                               # supersampling for smooth curves
CX, LINE = 222 - BOX[0], 243 - BOX[1]  # mouth centre x, lip line y (box coords)

UPPER = (214, 104, 92)
LOWER = (232, 128, 116)
LIPLINE = (170, 66, 60)
INSIDE = (92, 30, 38)
TEETH = (242, 234, 226)
TONGUE = (214, 98, 102)


def skin_fill(im):
    """Hide the original lips: per column, blend the skin rows above and below the mouth."""
    w, h = BOX[2] - BOX[0], BOX[3] - BOX[1]
    out = Image.new("RGB", (w, h))
    top_y, bot_y = 232, 262
    px = im.load()
    for x in range(w):
        ax = BOX[0] + x
        a = [sum(px[ax + dx, top_y + dy][c] for dx in (-1, 0, 1) for dy in (-1, 0, 1)) / 9 for c in range(3)]
        b = [sum(px[ax + dx, bot_y + dy][c] for dx in (-1, 0, 1) for dy in (-1, 0, 1)) / 9 for c in range(3)]
        for y in range(h):
            ay = BOX[1] + y
            if ay <= top_y or ay >= bot_y:
                out.putpixel((x, y), px[ax, ay])
            else:
                t = (ay - top_y) / (bot_y - top_y)
                out.putpixel((x, y), tuple(int(a[c] * (1 - t) + b[c] * t) for c in range(3)))
    return out.filter(ImageFilter.GaussianBlur(1.2))


def bez(p0, p1, p2, n=24):
    return [((1 - t) ** 2 * p0[0] + 2 * (1 - t) * t * p1[0] + t * t * p2[0],
             (1 - t) ** 2 * p0[1] + 2 * (1 - t) * t * p1[1] + t * t * p2[1]) for t in (i / n for i in range(n + 1))]


def S(pts):
    return [(x * SS, y * SS) for x, y in pts]


def mouth(shape):
    """Return an RGBA layer (box size) with the painted mouth for shape 1..5."""
    w, h = BOX[2] - BOX[0], BOX[3] - BOX[1]
    L = Image.new("RGBA", (w * SS, h * SS), (0, 0, 0, 0))
    d = ImageDraw.Draw(L)
    # (half width, upper lip top, opening half-height, lower lip bottom, teeth, tongue)
    # curve controls sit at 2x the offsets, so the drawn extents are: upper lip top ~up,
    # opening ~op below the line, lower lip bottom ~lo below the line
    spec = {
        1: (26, 4.5, 2.2, 10.0, False, False),  # slightly open
        2: (23, 5.0, 8.0, 15.5, True, True),    # open "a"
        3: (29, 4.0, 3.8, 10.5, True, False),   # wide "e/i"
        4: (15, 6.0, 6.5, 13.5, False, True),   # round "o/u"
        5: (25, 4.0, 0.0, 9.0, False, False),   # pressed "m/b/p"
    }[shape]
    hw, up, op, lo, teeth, tongue = spec
    lift = 2.0 if shape in (1, 3, 5) else 1.0   # corners turn up, like her smile
    l, r = (CX - hw, LINE - lift), (CX + hw, LINE - lift)
    top = bez(l, (CX, LINE - up * 2.0), r)
    bottom = bez(r, (CX, LINE + lo * 2.0), l)
    d.polygon(S(top + bottom), fill=LOWER)
    # upper lip (slightly darker), with the small cupid's-bow dip
    upper = bez(l, (CX - hw * 0.5, LINE - up * 1.6), (CX, LINE - up * 0.8)) + \
        bez((CX, LINE - up * 0.8), (CX + hw * 0.5, LINE - up * 1.6), r)
    if op > 0:
        open_top = bez(r, (CX, LINE - op * 0.6), l)
        open_bot = bez(l, (CX, LINE + op * 2.0), r)
        d.polygon(S(upper + open_top), fill=UPPER)
        d.polygon(S(open_bot + open_top[::-1][1:-1]), fill=INSIDE)
        if teeth:
            tl = bez((CX - hw * 0.62, LINE), (CX, LINE - op * 0.55), (CX + hw * 0.62, LINE))
            tb = bez((CX + hw * 0.62, LINE), (CX, LINE + op * 0.75), (CX - hw * 0.62, LINE))
            d.polygon(S(tl + tb), fill=TEETH)
        if tongue:
            d.ellipse([(CX - hw * 0.45) * SS, (LINE + op * 0.9) * SS, (CX + hw * 0.45) * SS, (LINE + op * 2.0) * SS], fill=TONGUE)
        d.line(S(open_top), fill=LIPLINE, width=SS)
    else:
        d.polygon(S(upper + [r, l]), fill=UPPER)
        d.line(S(bez(l, (CX, LINE + 1.2), r)), fill=LIPLINE, width=int(SS * 1.6))
    # soft highlight on the lower lip, like the painting
    hy = LINE + op + (lo - op) * 0.45
    d.ellipse([(CX - hw * 0.38) * SS, (hy - 1.6) * SS, (CX + hw * 0.22) * SS, (hy + 1.4) * SS], fill=(250, 186, 174, 190))
    # little shadowed corners, as in the painting
    for cx in (l[0], r[0]):
        d.ellipse([(cx - 1.6) * SS, (LINE - lift - 1.2) * SS, (cx + 1.6) * SS, (LINE - lift + 1.6) * SS], fill=(176, 92, 78, 150))
    L = L.resize((w, h), Image.LANCZOS)
    return L.filter(ImageFilter.GaussianBlur(0.6))


def feather(w, h):
    m = Image.new("L", (w * 4, h * 4), 0)
    ImageDraw.Draw(m).ellipse([2 * 4, 3 * 4, (w - 2) * 4, (h - 2) * 4], fill=255)
    return m.resize((w, h), Image.LANCZOS).filter(ImageFilter.GaussianBlur(2.5))


def main():
    os.makedirs(OUT, exist_ok=True)
    im = Image.open(SRC).convert("RGB")
    skin = skin_fill(im)
    w, h = skin.size
    alpha = feather(w, h)
    for shape in range(1, 6):
        base = skin.convert("RGBA")
        base.putalpha(alpha)
        base.alpha_composite(mouth(shape))
        base.save(os.path.join(OUT, f"m{shape}.png"), optimize=True)
        print("wrote", f"m{shape}.png")


if __name__ == "__main__":
    main()
