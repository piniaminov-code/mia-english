#!/usr/bin/env python3
"""Face overlay sprites for the talking Mia avatar (v2).

The avatar picture (assets/mia-avatar.jpg) is never modified. Every sprite is a small
feathered PNG laid over one region of it, built from the avatar's OWN pixels:

  assets/mouth/m1.png .. m7.png   mouth shapes (box MOUTH_BOX)
      1 small   2 aa (open)   3 ee (spread)   4 oo (round)   5 closed m/b/p
      6 f/v (upper teeth on lower lip)   7 s/sh (narrow, teeth together)
    - the original lips are hidden by skin interpolated, column by column, from the
      avatar's skin just above and below the mouth
    - lips are painted with vertical gradients sampled from her real lips (darker upper
      lip, lighter lower lip with a soft highlight), corners shaded like the painting
    - open shapes also drop the chin 1-3 px (the avatar's own chin pixels, shifted)
  assets/mouth/blink1.png (half) and blink2.png (closed)   eyelids (box EYES_BOX)
  assets/mouth/brow.png   brows lifted 3 px (box BROW_BOX), shown briefly on questions

Rest (no sprite) = the original face. Sprites are drawn at 2x the avatar's pixel density.
Usage: python3 tools/make_mouth_sprites.py   (needs Pillow + numpy)
"""
import os
import numpy as np
from PIL import Image, ImageDraw, ImageFilter

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SRC = os.path.join(ROOT, "assets", "mia-avatar.jpg")
OUT = os.path.join(ROOT, "assets", "mouth")
MOUTH_BOX = (180, 218, 264, 284)   # x0, y0, x1, y1 in the 384 px avatar
EYES_BOX = (168, 150, 294, 202)
BROW_BOX = (180, 134, 300, 172)
UP = 2                              # output scale vs avatar pixels
SS = 6                              # supersampling for curves

UPPER_T, UPPER_B = (196, 92, 84), (222, 112, 100)    # upper lip: top -> bottom
LOWER_T, LOWER_B = (234, 132, 120), (220, 116, 104)  # lower lip
LIPLINE = (160, 62, 58)
INSIDE_T, INSIDE_B = (84, 26, 34), (120, 44, 50)
TEETH = (240, 233, 226)
TONGUE = (208, 96, 100)


def crop(im, box, scale=UP):
    return im.crop(box).resize(((box[2] - box[0]) * scale, (box[3] - box[1]) * scale), Image.LANCZOS)


def inpaint_rows(arr, y_top, y_bot):
    """Replace rows y_top..y_bot with a per-column blend of the rows just outside."""
    a = arr[max(0, y_top - 2):y_top + 1].mean(axis=0)
    b = arr[y_bot:y_bot + 3].mean(axis=0)
    for y in range(y_top, y_bot):
        t = (y - y_top) / max(1, (y_bot - y_top))
        arr[y] = a * (1 - t) + b * t
    return arr


def feather(w, h, inset, blur):
    m = Image.new("L", (w * 4, h * 4), 0)
    ImageDraw.Draw(m).ellipse([inset * 4, inset * 4, (w - inset) * 4, (h - inset) * 4], fill=255)
    return m.resize((w, h), Image.LANCZOS).filter(ImageFilter.GaussianBlur(blur))


def grad_fill(size, mask_poly, c_top, c_bot, y0, y1):
    """RGBA layer: polygon filled with a vertical gradient between rows y0..y1 (supersampled px)."""
    W, H = size
    m = Image.new("L", size, 0)
    ImageDraw.Draw(m).polygon(mask_poly, fill=255)
    ys = np.clip((np.arange(H) - y0) / max(1, (y1 - y0)), 0, 1)[:, None]
    col = np.array(c_top)[None, None, :] * (1 - ys[..., None]) + np.array(c_bot)[None, None, :] * ys[..., None]
    img = np.broadcast_to(col, (H, W, 3)).astype(np.uint8)
    layer = Image.fromarray(img, "RGB").convert("RGBA")
    layer.putalpha(m)
    return layer


def bez(p0, p1, p2, n=30):
    return [((1 - t) ** 2 * p0[0] + 2 * (1 - t) * t * p1[0] + t * t * p2[0],
             (1 - t) ** 2 * p0[1] + 2 * (1 - t) * t * p1[1] + t * t * p2[1]) for t in (i / n for i in range(n + 1))]


# half width, upper lip height, opening, lower lip bottom, teeth, tongue, chin drop (avatar px)
SHAPES = {
    1: (25, 4.2, 2.4, 10.0, False, False, 1),
    2: (22, 4.6, 8.5, 16.0, True, True, 3),
    3: (29, 3.8, 3.6, 10.0, True, False, 1),
    4: (14, 6.0, 6.0, 13.0, False, True, 2),
    5: (25, 4.2, 0.0, 9.0, False, False, 0),
    6: (25, 4.4, 2.6, 8.2, "upper", False, 1),
    7: (21, 4.2, 2.8, 10.0, "full", False, 1),
}


def mouth_sprite(im, shape):
    x0, y0, x1, y1 = MOUTH_BOX
    w, h = (x1 - x0), (y1 - y0)
    base = np.asarray(im.crop(MOUTH_BOX)).astype(float)
    cx, line = 222 - x0, 243 - y0
    hw, up, op, lo, teeth, tongue, jaw = SHAPES[shape]
    orig = base.copy()
    base = inpaint_rows(base, 232 - y0, 261 - y0)              # hide the original lips
    if jaw:
        yj = 252 - y0                                          # chin and below move down
        base[yj + jaw:] = np.vstack([inpaint_rows(orig.copy(), 232 - y0, 261 - y0)[yj:h - jaw]])
        base[yj:yj + jaw] = base[yj - 1]
    skin = Image.fromarray(base.clip(0, 255).astype(np.uint8)).resize((w * UP, h * UP), Image.LANCZOS)
    skin = skin.filter(ImageFilter.GaussianBlur(1.0 * UP))
    K = UP * SS
    W, H = w * K, h * K
    L = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    P = lambda pts: [(x * K, y * K) for x, y in pts]
    lift = 2.0 if shape in (1, 3, 5, 6, 7) else 1.0
    l, r = (cx - hw, line - lift), (cx + hw, line - lift)
    outer = bez(l, (cx, line - up * 2), r) + bez(r, (cx, line + lo * 2), l)
    L.alpha_composite(grad_fill((W, H), P(outer), LOWER_T, LOWER_B, (line) * K, (line + lo) * K))
    upper = bez(l, (cx - hw * 0.5, line - up * 1.7), (cx, line - up * 0.75)) + \
        bez((cx, line - up * 0.75), (cx + hw * 0.5, line - up * 1.7), r)
    d = ImageDraw.Draw(L)
    if op > 0:
        o_top = bez(r, (cx, line - op * 0.5), l)
        o_bot = bez(l, (cx, line + op * 2), r)
        L.alpha_composite(grad_fill((W, H), P(upper + o_top), UPPER_T, UPPER_B, (line - up) * K, line * K))
        L.alpha_composite(grad_fill((W, H), P(o_bot + o_top[::-1][1:-1]), INSIDE_T, INSIDE_B, line * K, (line + op) * K))
        d = ImageDraw.Draw(L)
        if teeth:
            depth = {True: 0.75, "upper": 0.95, "full": 1.7}[teeth]
            tl = bez((cx - hw * 0.66, line - lift * 0.4), (cx, line - op * 0.5), (cx + hw * 0.66, line - lift * 0.4))
            tb = bez((cx + hw * 0.66, line - lift * 0.4), (cx, line + op * depth), (cx - hw * 0.66, line - lift * 0.4))
            d.polygon(P(tl + tb), fill=TEETH)
            if teeth == "full":                                 # line between upper and lower teeth
                d.line(P(bez((cx - hw * 0.5, line + op * 0.3), (cx, line + op * 0.55), (cx + hw * 0.5, line + op * 0.3))),
                       fill=(205, 196, 190), width=max(1, K // 2))
        if tongue:
            d.ellipse([(cx - hw * 0.42) * K, (line + op * 0.95) * K, (cx + hw * 0.42) * K, (line + op * 2.0) * K], fill=TONGUE)
        d.line(P(o_top), fill=LIPLINE, width=K)
    else:
        L.alpha_composite(grad_fill((W, H), P(upper + [r, l]), UPPER_T, UPPER_B, (line - up) * K, line * K))
        d = ImageDraw.Draw(L)
        d.line(P(bez(l, (cx, line + 1.4), r)), fill=LIPLINE, width=int(K * 1.4))
    # lower-lip gloss and shaded corners, as in the painting
    hy = line + op + (lo - op) * 0.42
    d.ellipse([(cx - hw * 0.36) * K, (hy - 1.4) * K, (cx + hw * 0.2) * K, (hy + 1.2) * K], fill=(246, 176, 164, 70))
    for x in (l[0], r[0]):
        d.ellipse([(x - 1.8) * K, (line - lift - 1.4) * K, (x + 1.8) * K, (line - lift + 1.8) * K], fill=(196, 112, 96, 55))
    L = L.resize((w * UP, h * UP), Image.LANCZOS).filter(ImageFilter.GaussianBlur(0.45 * UP))
    out = skin.convert("RGBA")
    out.putalpha(feather(w * UP, h * UP, 3 * UP, 2.6 * UP))
    out.alpha_composite(L)
    return out


def blink_sprite(im, amount):
    """amount 0.5 = half-closed lids, 1.0 = closed.
    Lid skin: per column, interpolated between the avatar's skin just above the upper lashes
    and just below the lower lid (same technique as the mouth). The alpha mask is feathered
    on its own, and the lash arc is drawn supersampled so it stays smooth at phone size."""
    x0, y0, x1, y1 = EYES_BOX
    w, h = x1 - x0, y1 - y0
    a = np.asarray(im.crop(EYES_BOX)).astype(float)
    skin = a.copy()
    mask = Image.new("L", (w * 8, h * 8), 0)
    md = ImageDraw.Draw(mask)
    eyes = [(195 - x0, 173.5 - y0, 21.5, 13.0), (267 - x0, 182 - y0, 18.0, 13.5)]   # cx, cy, rx, ry
    arcs = []
    for cx, cy, rx, ry in eyes:
        ya, yb = int(cy - ry - 4), int(cy + ry + 4)
        for x in range(int(cx - rx - 4), int(cx + rx + 5)):
            if 0 <= x < w:
                top, bot = a[ya - 1:ya + 1, x].mean(axis=0), a[yb:yb + 2, x].mean(axis=0)
                for y in range(ya, yb):
                    t = (y - ya) / (yb - ya)
                    skin[y, x] = top * (1 - t) + bot * t
        # lid region: from above the lashes down to the lid edge
        n = 48
        xs = [cx - rx - 1 + (2 * rx + 2) * i / n for i in range(n + 1)]
        def edge(x):
            u = (x - cx) / (rx + 1)
            return (cy - ry - 1) + ((cy + ry * 0.95) - (cy - ry - 1)) * amount * (1 - 0.35 * u * u)
        poly = [(x, cy - ry - 4) for x in xs] + [(x, edge(x)) for x in reversed(xs)]
        md.polygon([(x * 8, y * 8) for x, y in poly], fill=255)
        md.ellipse([(cx - rx - 2) * 8, (cy - ry - 5) * 8, (cx + rx + 2) * 8, (cy + ry + 3) * 8], outline=0)
        lash_y = (lambda x: edge(x) - 0.6) if amount < 1 else             (lambda x: cy + ry * 0.45 - ry * 0.45 * ((x - cx) / rx) ** 2)
        arcs.append([(x, lash_y(x)) for x in xs[2:-2]])
    clip = Image.new("L", (w * 8, h * 8), 0)
    cd = ImageDraw.Draw(clip)
    for cx, cy, rx, ry in eyes:
        cd.ellipse([(cx - rx - 3) * 8, (cy - ry - 6) * 8, (cx + rx + 3) * 8, (cy + ry + 3) * 8], fill=255)
    mask = Image.fromarray(np.minimum(np.asarray(mask), np.asarray(clip)))
    mask = mask.resize((w * UP, h * UP), Image.LANCZOS).filter(ImageFilter.GaussianBlur(0.9 * UP))
    img = Image.fromarray(skin.clip(0, 255).astype(np.uint8)).filter(ImageFilter.BoxBlur(2))
    img = img.resize((w * UP, h * UP), Image.LANCZOS).filter(ImageFilter.GaussianBlur(1.2 * UP)).convert("RGBA")
    img.putalpha(mask)
    K = UP * 4
    lay = Image.new("RGBA", (w * K, h * K), (0, 0, 0, 0))
    ld = ImageDraw.Draw(lay)
    for pts in arcs:
        ld.line([(x * K, y * K) for x, y in pts], fill=(104, 66, 52, 190), width=int(0.95 * K), joint="curve")
    img.alpha_composite(lay.resize((w * UP, h * UP), Image.LANCZOS).filter(ImageFilter.GaussianBlur(0.25 * UP)))
    return img


def brow_sprite(im, lift=3):
    x0, y0, x1, y1 = BROW_BOX
    w, h = x1 - x0, y1 - y0
    src = np.asarray(im.crop((x0, y0 + lift, x1, y1 + lift)))         # brows appear `lift` px higher
    img = Image.fromarray(src).resize((w * UP, h * UP), Image.LANCZOS).convert("RGBA")
    img.putalpha(feather(w * UP, h * UP, 8 * UP, 4 * UP))
    return img


def main():
    os.makedirs(OUT, exist_ok=True)
    im = Image.open(SRC).convert("RGB")
    for s in SHAPES:
        mouth_sprite(im, s).save(os.path.join(OUT, f"m{s}.png"), optimize=True)
    blink_sprite(im, 0.5).save(os.path.join(OUT, "blink1.png"), optimize=True)
    blink_sprite(im, 1.0).save(os.path.join(OUT, "blink2.png"), optimize=True)
    brow_sprite(im).save(os.path.join(OUT, "brow.png"), optimize=True)
    print("boxes (avatar px): mouth", MOUTH_BOX, "eyes", EYES_BOX, "brow", BROW_BOX)


if __name__ == "__main__":
    main()
