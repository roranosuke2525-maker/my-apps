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


def shrink(arr, k):
    h, w = arr.shape
    h2, w2 = h // k, w // k
    return arr[:h2 * k, :w2 * k].reshape(h2, k, w2, k).mean(axis=(1, 3))


def align_face(base, bb, im, vb):
    """差分の人物を、元の絵の人物ぜんたいにいちばん重なる大きさ・位置にする（顔だけでなく体も合わせる）。
    粗い解像度で大きさと位置を探し、元の解像度で位置を詰める。戻り値：(拡大縮小した差分, 置く x, 置く y)"""
    bw, bh = bb[2] - bb[0], bb[3] - bb[1]
    L0 = lum(base)
    A0 = np.asarray(base.getchannel("A"), dtype=np.float32) / 255
    K = 3
    tmpl = shrink(L0[bb[1]:bb[3], bb[0]:bb[2]], K)
    wgt = shrink(A0[bb[1]:bb[3], bb[0]:bb[2]], K)
    # 顔のあたりを重く見る（口パク・まばたきで顔が跳ねないように）
    yy = np.linspace(0, 1, wgt.shape[0])[:, None]
    wgt = wgt * (1 + 2 * np.exp(-((yy - 0.12) / 0.14) ** 2))
    vh = vb[3] - vb[1]

    def score(L, x, y, k):
        th, tw = tmpl.shape
        if x < 0 or y < 0 or x + tw > L.shape[1] or y + th > L.shape[0]:
            return None
        return float((np.abs(L[y:y + th, x:x + tw] - tmpl) * wgt).sum())

    best = None
    for k in range(-8, 9):
        scale = (bh / max(1, vh)) * (1 + k * 0.03)
        fig = im.resize((max(1, round(im.width * scale)), max(1, round(im.height * scale))), Image.LANCZOS)
        L = shrink(lum(fig), K)
        cx = round(((vb[0] + (vb[2] - vb[0]) / 2) * scale - (bb[0] + bw / 2)) / K)
        cy = round((vb[1] * scale - bb[1]) / K)
        for oy in range(-14, 15):
            for ox in range(-14, 15):
                d = score(L, bb[0] // K + cx + ox, bb[1] // K + cy + oy, K)
                if d is not None and (best is None or d < best[0]):
                    best = (d, fig, -(cx + ox) * K, -(cy + oy) * K, scale)
    _, fig, dx, dy, _ = best
    # 元の解像度で位置を詰める
    Lf = lum(fig)
    tmplf = L0[bb[1]:bb[3], bb[0]:bb[2]]
    wf = A0[bb[1]:bb[3], bb[0]:bb[2]]
    th, tw = tmplf.shape
    fine = None
    for oy in range(-K, K + 1):
        for ox in range(-K, K + 1):
            x, y = bb[0] - dx + ox, bb[1] - dy + oy
            if x < 0 or y < 0 or x + tw > Lf.shape[1] or y + th > Lf.shape[0]:
                continue
            d = float((np.abs(Lf[y:y + th, x:x + tw] - tmplf) * wf).sum())
            if fine is None or d < fine[0]:
                fine = (d, dx - ox, dy - oy)
    if fine:
        _, dx, dy = fine
    return fig, dx, dy


def process(name, base_name, src_im, is_png):
    base_path = OUT / "cast2" / f"{base_name}.webp"
    if not base_path.exists():
        return "元の絵がない"
    base = Image.open(base_path).convert("RGBA")
    bb = bbox_of(base)
    if is_png:
        # 端に枠や縁取りが描かれることがあるので、外側3%を落としてから背景を抜く
        mx, my = int(src_im.width * 0.03), int(src_im.height * 0.03)
        src_im = src_im.crop((mx, my, src_im.width - mx, src_im.height - my))
        im = remove_background(src_im, TOLERANCE.get(f"cast2/{base_name}", 38))
    else:
        im = src_im.convert("RGBA")
    vb = bbox_of(im)
    if not bb or not vb:
        return "人物が見つからない"
    fig, dx, dy = align_face(base, bb, im, vb)
    canvas = Image.new("RGBA", base.size, (0, 0, 0, 0))
    canvas.alpha_composite(fig, dest=(max(0, dx), max(0, dy)), source=(max(0, -dx), max(0, -dy)))
    canvas.save(OUT / "cast2" / f"{name}.webp", "WEBP", quality=86, method=6)
    return None


MOTION_SUFFIX = ("_talk", "_blink", "_gesture")


def main():
    done = failed = 0
    if sys.argv[1] == "--realign":
        # 表情・構えの差分（webp）を、元の絵の人物に合わせ直す（元の絵と差分で大きさが違うと、切り替えで伸び縮みして見える）
        bases = {p.stem for p in (OUT / "cast2").glob("*.webp") if "_" not in p.stem.replace("hero_", "hero")}
        for src in sorted((OUT / "cast2").glob("*_*.webp")):
            name = src.stem
            if name in bases or name.endswith(MOTION_SUFFIX):
                continue
            base_name = max((b for b in bases if name.startswith(f"{b}_")), key=len, default=None)
            if not base_name:
                continue
            err = process(name, base_name, Image.open(src), False)
            print(f"{'skip' if err else 'ok'} {name}{': ' + err if err else ''}")
            done += not err
            failed += bool(err)
    else:
        raw = Path(sys.argv[1])
        for src in sorted((raw / "cast2").glob("*.png")):
            name = src.stem
            base_name = name.rsplit("_", 1)[0]
            err = process(name, base_name, Image.open(src), True)
            if err:
                print(f"skip {name}: {err}")
            done += not err
            failed += bool(err)
    print(f"ok {done} / skip {failed}")


if __name__ == "__main__":
    main()
