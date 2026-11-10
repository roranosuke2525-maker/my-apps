"""アプリのアイコン（ミントに白い星とピーチのしおりのリボン）を作る。python3 scripts/make-icons.py"""
import math
from pathlib import Path
from PIL import Image, ImageDraw

OUT = Path(__file__).resolve().parent.parent / "public" / "icons"
NIGHT = (79, 176, 140, 255)
GOLD = (255, 255, 255, 255)
PINK = (240, 140, 125, 255)


def star(cx, cy, r_out, r_in, n=5):
    pts = []
    for i in range(n * 2):
        r = r_out if i % 2 == 0 else r_in
        a = -math.pi / 2 + i * math.pi / n
        pts.append((cx + r * math.cos(a), cy + r * math.sin(a)))
    return pts


def icon(size: int, rounded: bool) -> Image.Image:
    s = size * 4
    img = Image.new("RGBA", (s, s), (0, 0, 0, 0) if rounded else NIGHT)
    d = ImageDraw.Draw(img)
    if rounded:
        d.rounded_rectangle((0, 0, s, s), radius=int(s * 0.22), fill=NIGHT)
    # しおりのリボン
    x0, x1 = s * 0.60, s * 0.74
    d.polygon([(x0, 0), (x1, 0), (x1, s * 0.40), ((x0 + x1) / 2, s * 0.33), (x0, s * 0.40)], fill=PINK)
    # 大きな星と小さな星
    d.polygon(star(s * 0.44, s * 0.56, s * 0.26, s * 0.11), fill=GOLD)
    for cx, cy, r in ((0.20, 0.24, 0.035), (0.82, 0.62, 0.03), (0.72, 0.84, 0.022)):
        d.polygon(star(s * cx, s * cy, s * r, s * r * 0.45), fill=(255, 243, 223, 240))
    return img.resize((size, size), Image.LANCZOS)


OUT.mkdir(parents=True, exist_ok=True)
icon(192, True).save(OUT / "icon-192.png")
icon(512, False).save(OUT / "icon-512.png")  # maskable 兼用なので全面塗り
icon(180, False).save(OUT / "apple-touch-icon.png")  # iOS が自動で角を丸める
print("icons written to", OUT)
