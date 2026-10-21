"""アプリのアイコン（緑の角丸にチェックマーク）を作る。python3 scripts/make-icons.py"""
from pathlib import Path
from PIL import Image, ImageDraw

OUT = Path(__file__).resolve().parent.parent / "public" / "icons"
GREEN = (47, 125, 91, 255)


def icon(size: int, rounded: bool) -> Image.Image:
    s = size * 4  # 縮小してなめらかにする
    img = Image.new("RGBA", (s, s), (0, 0, 0, 0) if rounded else GREEN)
    d = ImageDraw.Draw(img)
    if rounded:
        d.rounded_rectangle((0, 0, s, s), radius=int(s * 0.22), fill=GREEN)
    w = int(s * 0.09)
    pts = [(s * 0.28, s * 0.52), (s * 0.44, s * 0.67), (s * 0.73, s * 0.36)]
    d.line(pts, fill="white", width=w, joint="curve")
    for x, y in (pts[0], pts[-1]):
        d.ellipse((x - w / 2, y - w / 2, x + w / 2, y + w / 2), fill="white")
    return img.resize((size, size), Image.LANCZOS)


OUT.mkdir(parents=True, exist_ok=True)
icon(192, True).save(OUT / "icon-192.png")
icon(512, False).save(OUT / "icon-512.png")  # maskable 兼用なので全面塗り
icon(180, False).save(OUT / "apple-touch-icon.png")  # iOS が自動で角を丸める
print("icons written to", OUT)
