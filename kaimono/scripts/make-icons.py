"""アプリのアイコン（深緑の地に買い物かごとチェック）を作る。python3 scripts/make-icons.py"""
from pathlib import Path
from PIL import Image, ImageDraw

OUT = Path(__file__).resolve().parent.parent / "public" / "icons"
GREEN = (47, 107, 79, 255)
CREAM = (250, 246, 236, 255)
STRAW = (232, 196, 120, 255)
CHECK = (47, 107, 79, 255)


def icon(size: int, rounded: bool) -> Image.Image:
    s = size * 4  # 縮小してなめらかにする
    img = Image.new("RGBA", (s, s), (0, 0, 0, 0) if rounded else GREEN)
    d = ImageDraw.Draw(img)
    if rounded:
        d.rounded_rectangle((0, 0, s, s), radius=int(s * 0.22), fill=GREEN)
    w = int(s * 0.045)
    # 持ち手
    d.arc((s * 0.32, s * 0.16, s * 0.68, s * 0.56), 180, 360, fill=STRAW, width=w)
    # かご
    d.polygon([(s * 0.2, s * 0.4), (s * 0.8, s * 0.4), (s * 0.72, s * 0.8), (s * 0.28, s * 0.8)], fill=STRAW)
    d.rounded_rectangle((s * 0.17, s * 0.36, s * 0.83, s * 0.44), radius=int(s * 0.03), fill=CREAM)
    # チェック
    d.line([(s * 0.38, s * 0.6), (s * 0.47, s * 0.69), (s * 0.63, s * 0.52)], fill=CHECK, width=int(s * 0.06), joint="curve")
    return img.resize((size, size), Image.LANCZOS)


OUT.mkdir(parents=True, exist_ok=True)
icon(192, True).save(OUT / "icon-192.png")
icon(512, False).save(OUT / "icon-512.png")  # maskable 兼用なので全面塗り
icon(180, False).save(OUT / "apple-touch-icon.png")  # iOS が自動で角を丸める
print("icons written to", OUT)
