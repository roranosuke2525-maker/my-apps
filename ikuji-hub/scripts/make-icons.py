"""アプリのアイコン（青の角丸にひよこ色の丸）を作る。python3 scripts/make-icons.py"""
from pathlib import Path
from PIL import Image, ImageDraw

OUT = Path(__file__).resolve().parent.parent / "public" / "icons"
BLUE = (47, 111, 143, 255)
HIYOKO = (243, 196, 55, 255)
WHITE = (255, 255, 255, 255)


def icon(size: int, rounded: bool) -> Image.Image:
    s = size * 4  # 縮小してなめらかにする
    img = Image.new("RGBA", (s, s), (0, 0, 0, 0) if rounded else BLUE)
    d = ImageDraw.Draw(img)
    if rounded:
        d.rounded_rectangle((0, 0, s, s), radius=int(s * 0.22), fill=BLUE)
    # 棚（3段の線）と、その上のひよこ色の丸
    w = int(s * 0.06)
    for y in (0.58, 0.70, 0.82):
        d.rounded_rectangle((s * 0.24, s * y - w / 2, s * 0.76, s * y + w / 2), radius=w // 2, fill=WHITE)
    r = s * 0.15
    d.ellipse((s * 0.5 - r, s * 0.36 - r, s * 0.5 + r, s * 0.36 + r), fill=HIYOKO)
    return img.resize((size, size), Image.LANCZOS)


OUT.mkdir(parents=True, exist_ok=True)
icon(192, True).save(OUT / "icon-192.png")
icon(512, False).save(OUT / "icon-512.png")  # maskable 兼用なので全面塗り
icon(180, False).save(OUT / "apple-touch-icon.png")  # iOS が自動で角を丸める
print("icons written to", OUT)
