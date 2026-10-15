#!/usr/bin/env python3
"""Gera os ícones do PWA (PNG) com Pillow. Uso: python3 scripts/make-icons.py"""
from PIL import Image, ImageDraw
import os

OUT = os.path.join(os.path.dirname(__file__), "..", "public", "icons")
os.makedirs(OUT, exist_ok=True)

def draw(size, maskable=False):
    S = size * 4  # supersampling
    im = Image.new("RGBA", (S, S), (0, 0, 0, 0))
    d = ImageDraw.Draw(im)
    bg1, bg2 = (79, 70, 229), (14, 165, 233)
    # gradiente diagonal
    grad = Image.new("RGBA", (S, S))
    gp = grad.load()
    for y in range(S):
        for x in range(S):
            t = (x + y) / (2 * S)
            gp[x, y] = tuple(int(bg1[i] + (bg2[i] - bg1[i]) * t) for i in range(3)) + (255,)
    mask = Image.new("L", (S, S), 0)
    md = ImageDraw.Draw(mask)
    if maskable:
        md.rectangle([0, 0, S, S], fill=255)
    else:
        md.rounded_rectangle([0, 0, S - 1, S - 1], radius=int(S * 0.22), fill=255)
    im.paste(grad, (0, 0), mask)
    d = ImageDraw.Draw(im)
    k = 0.62 if maskable else 0.74  # área segura para maskable
    cx, cy = S / 2, S / 2 - S * 0.02
    w, h = S * k * 0.78, S * k * 0.58
    x0, y0, x1, y1 = cx - w / 2, cy - h / 2, cx + w / 2, cy + h / 2
    d.rounded_rectangle([x0, y0, x1, y1], radius=h * 0.28, fill=(255, 255, 255, 255))
    # rabinho do balão
    d.polygon([(x0 + w * 0.18, y1 - 2), (x0 + w * 0.18, y1 + h * 0.28), (x0 + w * 0.42, y1 - 2)], fill=(255, 255, 255, 255))
    # três pontos
    r = h * 0.085
    for i in (-1, 0, 1):
        px = cx + i * w * 0.2
        d.ellipse([px - r, cy - r, px + r, cy + r], fill=(79, 70, 229, 255))
    return im.resize((size, size), Image.LANCZOS)

for s in (192, 512):
    draw(s).save(os.path.join(OUT, f"icon-{s}.png"))
    draw(s, True).save(os.path.join(OUT, f"icon-maskable-{s}.png"))
draw(180, True).save(os.path.join(OUT, "apple-touch-icon.png"))
draw(64).save(os.path.join(OUT, "favicon-64.png"))
print("ícones gerados em", os.path.abspath(OUT))
