"""アプリのアイコン（墨色の角丸に新聞の紙面）を作る。python3 scripts/make-icons.py"""
from pathlib import Path
from PIL import Image, ImageDraw

OUT = Path(__file__).resolve().parent.parent / "public" / "icons"
INK = (30, 27, 22, 255)
PAPER = (246, 242, 232, 255)
RULE = (150, 140, 122, 255)
RED = (208, 38, 47, 255)


def icon(size: int, rounded: bool) -> Image.Image:
    s = size * 4  # 縮小してなめらかにする
    img = Image.new("RGBA", (s, s), (0, 0, 0, 0) if rounded else INK)
    d = ImageDraw.Draw(img)
    if rounded:
        d.rounded_rectangle((0, 0, s, s), radius=int(s * 0.22), fill=INK)
    # 紙面
    x0, y0, x1, y1 = s * 0.22, s * 0.2, s * 0.78, s * 0.8
    d.rounded_rectangle((x0, y0, x1, y1), radius=int(s * 0.03), fill=PAPER)
    pad = s * 0.05
    # 題字の帯と二重線
    d.rectangle((x0 + pad, y0 + pad, x1 - pad, y0 + pad + s * 0.07), fill=INK)
    d.rectangle((x0 + pad, y0 + pad + s * 0.095, x1 - pad, y0 + pad + s * 0.105), fill=INK)
    # 写真
    top = y0 + pad + s * 0.14
    mid = (x0 + x1) / 2
    d.rectangle((x0 + pad, top, mid - s * 0.02, top + s * 0.16), fill=RED)
    # 段組みの線
    lw = s * 0.018
    for i in range(4):
        y = top + i * s * 0.045
        d.rectangle((mid + s * 0.02, y, x1 - pad, y + lw), fill=RULE)
    for i in range(4):
        y = top + s * 0.2 + i * s * 0.045
        d.rectangle((x0 + pad, y, x1 - pad, y + lw), fill=RULE)
    return img.resize((size, size), Image.LANCZOS)


OUT.mkdir(parents=True, exist_ok=True)
icon(192, True).save(OUT / "icon-192.png")
icon(512, False).save(OUT / "icon-512.png")  # maskable 兼用なので全面塗り
icon(180, False).save(OUT / "apple-touch-icon.png")  # iOS が自動で角を丸める
print("icons written to", OUT)
