"""動きの差分（口・まばたき・手ぶり）の PNG を、元の立ち絵とぴったり重なる WebP にする。
  python3 scripts/finish-motion.py <描いた絵のフォルダ>
元の絵（public/img/cast2/<名前>.webp）の人物の枠に合わせて、差分の人物を同じ大きさ・同じ位置に置く。
（Gemini が描いた差分は少し構図がずれるので、そのまま詰めると口パクのたびに絵が跳ねる）
"""
import sys
from pathlib import Path

import numpy as np
from PIL import Image

import importlib.util

_spec = importlib.util.spec_from_file_location("finish_art", Path(__file__).resolve().parent / "finish-art.py")
_fa = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(_fa)
remove_background, OUT, TOLERANCE = _fa.remove_background, _fa.OUT, _fa.TOLERANCE


def bbox_of(im):
    return im.getchannel("A").point(lambda a: 255 if a > 16 else 0).getbbox()


def lum(img):
    """明るさ×不透明度（背景は0）。合わせ込みの比べもの用"""
    a = np.asarray(img.getchannel("A"), dtype=np.float32) / 255
    g = np.asarray(img.convert("L"), dtype=np.float32) / 255
    return g * a + (1 - a)  # 背景は白あつかい


def align_face(base, bb, im, vb):
    """差分の人物を、元の絵の顔（人物の上から25%・中央の半分）にいちばん重なる大きさ・位置にする。
    戻り値：(拡大縮小した差分, 置く x, 置く y)"""
    bw, bh = bb[2] - bb[0], bb[3] - bb[1]
    # 元の顔の切り出し
    fx0, fy0 = bb[0] + int(bw * 0.25), bb[1]
    fx1, fy1 = bb[0] + int(bw * 0.75), bb[1] + int(bh * 0.25)
    tmpl = lum(base)[fy0:fy1, fx0:fx1]
    vh = vb[3] - vb[1]
    best = None
    for k in range(-8, 9):
        scale = (bh / max(1, vh)) * (1 + k * 0.03)
        fig = im.resize((max(1, round(im.width * scale)), max(1, round(im.height * scale))), Image.LANCZOS)
        L = lum(fig)
        # 差分の人物の上端を元の上端に合わせたあたりを中心に、前後へ探す
        cx = round((vb[0] + (vb[2] - vb[0]) / 2) * scale - (bb[0] + bw / 2))
        cy = round(vb[1] * scale - bb[1])
        th, tw = tmpl.shape
        for oy in range(-36, 37, 3):
            for ox in range(-36, 37, 3):
                x = fx0 + cx + ox
                y = fy0 + cy + oy
                if x < 0 or y < 0 or x + tw > L.shape[1] or y + th > L.shape[0]:
                    continue
                d = float(np.mean(np.abs(L[y:y + th, x:x + tw] - tmpl)))
                if best is None or d < best[0]:
                    best = (d, fig, -(cx + ox), -(cy + oy))
    _, fig, dx, dy = best
    return fig, dx, dy


def main():
    raw = Path(sys.argv[1])
    done = failed = 0
    for src in sorted((raw / "cast2").glob("*.png")):
        name = src.stem
        base_name = name.rsplit("_", 1)[0]
        base_path = OUT / "cast2" / f"{base_name}.webp"
        if not base_path.exists():
            print(f"skip {name}: 元の絵がない")
            failed += 1
            continue
        base = Image.open(base_path).convert("RGBA")
        bb = bbox_of(base)
        # 端に枠や縁取りが描かれることがあるので、外側3%を落としてから背景を抜く
        raw_im = Image.open(src)
        mx, my = int(raw_im.width * 0.03), int(raw_im.height * 0.03)
        raw_im = raw_im.crop((mx, my, raw_im.width - mx, raw_im.height - my))
        im = remove_background(raw_im, TOLERANCE.get(f"cast2/{base_name}", 38))
        vb = bbox_of(im)
        if not bb or not vb:
            print(f"skip {name}: 人物が見つからない")
            failed += 1
            continue
        fig, dx, dy = align_face(base, bb, im, vb)
        canvas = Image.new("RGBA", base.size, (0, 0, 0, 0))
        canvas.alpha_composite(fig, dest=(max(0, dx), max(0, dy)), source=(max(0, -dx), max(0, -dy)))
        dst = OUT / "cast2" / f"{name}.webp"
        canvas.save(dst, "WEBP", quality=86, method=6)
        done += 1
    print(f"ok {done} / skip {failed}")


if __name__ == "__main__":
    main()
