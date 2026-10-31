"""gen-art.mjs で描いた PNG を、アプリで使う WebP にする。
  python3 scripts/finish-art.py <描いた絵のフォルダ> [id の一部…]
- sprite（pet/ mon/ boss/ cast/）：白い背景を外側から塗りつぶして透明にし、余白を詰めて 384px に収める
- bg/：1280x720 の WebP
- パーティー（public/img/party/gemini/*.png）は cast/party_<名前>.webp にする（背景は羊皮紙色なので、その色で抜く）
"""
import sys
from collections import deque
from pathlib import Path

from PIL import Image, ImageFilter

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "public" / "img"
SPRITE_MAX = 384


def remove_background(im, tol=38):
    """四辺から、背景に近い色の画素をたどって透明にする（輪郭の内側の白は残る）"""
    im = im.convert("RGBA")
    w, h = im.size
    px = im.load()
    # 背景色＝四隅の平均
    corners = [px[0, 0], px[w - 1, 0], px[0, h - 1], px[w - 1, h - 1]]
    bg = tuple(sum(c[i] for c in corners) // 4 for i in range(3))

    def near(c):
        return abs(c[0] - bg[0]) + abs(c[1] - bg[1]) + abs(c[2] - bg[2]) <= tol * 3

    seen = bytearray(w * h)
    q = deque()
    for x in range(w):
        q.append((x, 0)); q.append((x, h - 1))
    for y in range(h):
        q.append((0, y)); q.append((w - 1, y))
    mask = Image.new("L", (w, h), 255)
    mp = mask.load()
    while q:
        x, y = q.popleft()
        i = y * w + x
        if seen[i]:
            continue
        seen[i] = 1
        if not near(px[x, y]):
            continue
        mp[x, y] = 0
        if x > 0: q.append((x - 1, y))
        if x < w - 1: q.append((x + 1, y))
        if y > 0: q.append((x, y - 1))
        if y < h - 1: q.append((x, y + 1))
    # 輪郭をなめらかに（1px ぼかして、少しだけ内側へ）
    mask = mask.filter(ImageFilter.MinFilter(3)).filter(ImageFilter.GaussianBlur(0.8))
    im.putalpha(mask)
    return im


def finish_sprite(src, dst):
    im = remove_background(Image.open(src))
    box = im.getchannel("A").point(lambda a: 255 if a > 16 else 0).getbbox()
    if box:
        im = im.crop(box)
    im.thumbnail((SPRITE_MAX, SPRITE_MAX), Image.LANCZOS)
    # 正方形のキャンバスの下寄せ（足元をそろえる）
    side = max(im.size)
    canvas = Image.new("RGBA", (side, side), (0, 0, 0, 0))
    canvas.paste(im, ((side - im.width) // 2, side - im.height))
    dst.parent.mkdir(parents=True, exist_ok=True)
    canvas.save(dst, "WEBP", quality=86, method=6)


def finish_bg(src, dst):
    im = Image.open(src).convert("RGB").resize((1280, 720), Image.LANCZOS)
    dst.parent.mkdir(parents=True, exist_ok=True)
    im.save(dst, "WEBP", quality=80, method=6)


def main():
    raw = Path(sys.argv[1])
    only = sys.argv[2:]
    for src in sorted(raw.rglob("*.png")):
        rel = src.relative_to(raw).with_suffix("")
        if only and not any(o in str(rel) for o in only):
            continue
        dst = OUT / rel.with_suffix(".webp")
        (finish_bg if rel.parts[0] == "bg" else finish_sprite)(src, dst)
        print("ok", rel)
    if not only or any("party" in o for o in only):
        for src in sorted((OUT / "party" / "gemini").glob("*.png")):
            finish_sprite(src, OUT / "cast" / f"party_{src.stem}.webp")
            print("ok party", src.stem)


if __name__ == "__main__":
    main()
