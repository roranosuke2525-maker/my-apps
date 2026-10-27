"""アプリのアイコン（藍緑の地に付箋としおりひも）を作る。python3 scripts/make-icons.py"""
from pathlib import Path
from PIL import Image, ImageDraw

OUT = Path(__file__).resolve().parent.parent / "public" / "icons"
CLOTH = (31, 77, 82, 255)
PAPER = (245, 246, 242, 255)
FLAG = (228, 243, 107, 255)
TAB = (239, 111, 140, 255)


def icon(size: int, rounded: bool) -> Image.Image:
    s = size * 4  # 縮小してなめらかにする
    img = Image.new("RGBA", (s, s), (0, 0, 0, 0) if rounded else CLOTH)
    d = ImageDraw.Draw(img)
    if rounded:
        d.rounded_rectangle((0, 0, s, s), radius=int(s * 0.22), fill=CLOTH)
    # 本のページ
    d.rounded_rectangle((s * 0.24, s * 0.2, s * 0.76, s * 0.82), radius=int(s * 0.03), fill=PAPER)
    for i in range(5):
        y = s * (0.34 + i * 0.09)
        d.line((s * 0.32, y, s * 0.62, y), fill=(200, 205, 198, 255), width=int(s * 0.018))
    # 付箋
    d.polygon([(s * 0.56, s * 0.14), (s * 0.8, s * 0.14), (s * 0.8, s * 0.36), (s * 0.56, s * 0.42)], fill=FLAG)
    # しおりひも
    d.polygon([(s * 0.3, s * 0.2), (s * 0.4, s * 0.2), (s * 0.4, s * 0.9), (s * 0.35, s * 0.84), (s * 0.3, s * 0.9)], fill=TAB)
    return img.resize((size, size), Image.LANCZOS)


OUT.mkdir(parents=True, exist_ok=True)
icon(192, True).save(OUT / "icon-192.png")
icon(512, False).save(OUT / "icon-512.png")  # maskable 兼用なので全面塗り
icon(180, False).save(OUT / "apple-touch-icon.png")  # iOS が自動で角を丸める
print("icons written to", OUT)
