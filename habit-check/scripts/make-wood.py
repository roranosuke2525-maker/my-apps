# 木目の背景画像を作る（walnut: 帯・メニュー用の濃い木目、oak: 画面全体の明るい木目）
#   python3 scripts/make-wood.py   → public/img/walnut.jpg, public/img/oak.jpg
import numpy as np
from PIL import Image
import os
OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'public', 'img')
rng = np.random.default_rng(23)

def noise(w, h, gx, gy):
    a = rng.random((gy, gx)).astype(np.float32)
    return np.asarray(Image.fromarray(a, 'F').resize((w, h), Image.BICUBIC), dtype=np.float32)

def fbm(w, h, gx, gy, octaves=4, gain=0.5):
    s = np.zeros((h, w), np.float32); amp = 1.0; tot = 0.0
    for i in range(octaves):
        s += noise(w, h, gx * 2**i, gy * 2**i) * amp
        tot += amp; amp *= gain
    return s / tot

def wood(w, h, dark, mid, light, rings, warp, fiber_amt, pore_amt, out):
    y = np.linspace(0, 1, h, dtype=np.float32)[:, None] * np.ones((1, w), np.float32)
    n = fbm(w, h, 2, 4, 4)
    n2 = fbm(w, h, 4, 10, 3)
    u = y * rings + (n - 0.5) * warp + (n2 - 0.5) * warp * 0.25
    r = u - np.floor(u)
    band = np.exp(-((r - 0.78) / 0.07) ** 2) * 0.85 + (0.5 - 0.5 * np.cos(2 * np.pi * (r - 0.28))) * 0.3     # soft latewood + gradual earlywood
    fiber = fbm(w, h, 3, h // 2, 3, 0.6) - 0.5                              # long thin streaks
    fine = fbm(w, h, 8, h, 2, 0.6) - 0.5
    pores = (rng.random((h, w)) < 0.02).astype(np.float32)
    pores = np.asarray(Image.fromarray(pores, 'F').resize((w // 6, h), Image.BILINEAR).resize((w, h), Image.BILINEAR))
    v = band + fiber_amt * fiber + fiber_amt * 0.6 * fine + pore_amt * pores + 0.18 * (n - 0.5)
    v = np.clip(v, 0, 1)
    d, m, l = (np.array(c, np.float32) for c in (dark, mid, light))
    v3 = v[..., None]
    img = np.where(v3 < 0.5, l + (m - l) * (v3 / 0.5), m + (d - m) * ((v3 - 0.5) / 0.5))
    Image.fromarray(np.clip(img, 0, 255).astype(np.uint8)).save(out, quality=88)

wood(780, 300, (52, 30, 17), (92, 58, 35), (128, 86, 55), rings=6, warp=1.6, fiber_amt=0.35, pore_amt=1.2, out=OUT + '/walnut.jpg')
wood(780, 1688, (214, 188, 152), (232, 214, 188), (247, 238, 224), rings=11, warp=1.4, fiber_amt=0.28, pore_amt=0.8, out=OUT + '/oak.jpg')
