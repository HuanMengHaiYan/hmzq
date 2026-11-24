"""把两张 64.5/55.8 度的俯视生成图，分段重投影到精确 75 度。

原理（正交投影）：
  台面是水平面    -> 纵深投影长度 ∝ sin(仰角)  => 台面段纵向 × A
  框侧/桌腿是竖直面 -> 投影高度 ∝ cos(仰角)      => 框腿段纵向 × B
分界线取台呢近端底边，两段分开缩放，等价于把相机抬高到 75°。

两个刻意的取舍：
1. A 用台呢「上底+下底的平均宽度」定比例尺 —— 生成图是透视图，台呢呈梯形，
   只取底边会把角度算高、只取顶边会算低。
2. B 保留 AI 原有的夸张幅度（AI 画的腿比几何正确值长约 36%），不硬压到理论值，
   否则近端框会被压成一条线、腿缩成小方块，反而不像桌腿。
"""
from PIL import Image, ImageOps
import math, os

SRC = os.path.dirname(os.path.abspath(__file__))
T_TARGET = math.radians(75.0)
SIN75, COS75 = math.sin(T_TARGET), math.cos(T_TARGET)
TABLE_H = 800.0
LEG_ART = 1.36           # AI 画腿相对几何正确值的平均放大倍数
PS = 1024

JOBS = [
    ("src-top-front-raw.png", "front", 2540.0),
    ("src-top-left-raw.png", "left", 1270.0),
]


def is_green(R, G, B):
    return G > 70 and R < 130 and G - R > 28 and G - B > 22


def green_geom(im):
    """返回台呢上下边 y、上下底宽；梯形（透视）下的稳健取法。"""
    w, h = im.size
    px = im.load()
    rows = []
    for y in range(h):
        c = 0
        for x in range(0, w, 2):
            if is_green(*px[x, y]):
                c += 1
        rows.append(c)
    rmax = max(rows)
    ys = [y for y, c in enumerate(rows) if c > rmax * 0.40]
    y_top, y_bot = ys[0], ys[-1]

    def row_width(y):
        y = min(h - 1, max(0, y))
        xs = [x for x in range(w) if is_green(*px[x, y])]
        return (min(xs), max(xs)) if xs else (0, 0)

    xt0, xt1 = row_width(y_top + 4)
    xb0, xb1 = row_width(y_bot - 4)
    return xt0, xt1, xb0, xb1, y_top, y_bot


def obj_bbox(im):
    return ImageOps.grayscale(im).point(lambda v: 255 if v < 238 else 0).getbbox()


def seg_transform(im, ys, A, B):
    W, H = im.size
    h1 = int(round(ys * A))
    h2 = int(round((H - ys) * B))
    return im.transform(
        (W, h1 + h2), Image.MESH,
        [((0, 0, W, h1), (0, 0, 0, ys, W, ys, W, 0)),
         ((0, h1, W, h1 + h2), (0, ys, 0, H, W, H, W, ys))],
        Image.BICUBIC,
    )


def fit_canvas(im):
    im = im.crop(obj_bbox(im))
    canvas = Image.new("RGB", (PS, PS), (255, 255, 255))
    canvas.paste(im, ((PS - im.width) // 2, (PS - im.height) // 2))
    return canvas


results = {}
for fn, name, real_w in JOBS:
    im = Image.open(os.path.join(SRC, fn)).convert("RGB")
    xt0, xt1, xb0, xb1, y_top, y_bot = green_geom(im)
    w_top, w_bot = xt1 - xt0 + 1, xb1 - xb0 + 1
    w_mean = (w_top + w_bot) / 2.0
    gh = y_bot - y_top
    real_h = 1270.0 if real_w == 2540.0 else 2540.0
    s = w_mean / real_w

    sin_t = gh / (real_h * s)
    if sin_t <= 1.0:
        angle_txt = f"仰角 {math.degrees(math.asin(sin_t)):5.1f}°"
    else:
        angle_txt = f"台面纵深画深 {(sin_t - 1) * 100:4.1f}%（等效仰角 >90°）"

    target_gh = real_h * SIN75 * s
    A = target_gh / gh

    ob = obj_bbox(im)
    leg_src = max(1, ob[3] - y_bot)
    leg_dst = TABLE_H * COS75 * s * LEG_ART
    B = leg_dst / leg_src

    out = fit_canvas(seg_transform(im, y_bot, A, B))
    out.save(os.path.join(SRC, name + ".png"))

    xt0b, xt1b, xb0b, xb1b, yt, yb = green_geom(out)
    wm2 = ((xt1b - xt0b + 1) + (xb1b - xb0b + 1)) / 2.0
    gh2 = yb - yt
    o2 = obj_bbox(out)
    print(f"{name:6s} 源 台呢 上底{w_top} 下底{w_bot} 高{gh} -> {angle_txt}  框+腿 {leg_src}px")
    print(f"       A={A:.4f} B={B:.4f}")
    print(f"       出 台呢 上底{xt1b-xt0b+1} 下底{xb1b-xb0b+1} 高{gh2}  w/h={wm2/gh2:.3f} (目标 {1/(0.5*SIN75):.3f})  框+腿 {o2[3]-yb}px  外框 {o2[2]-o2[0]}x{o2[3]-o2[1]}")
    results[name] = out

front, left = results["front"], results["left"]
back = front.transpose(Image.FLIP_LEFT_RIGHT)
right = left.transpose(Image.FLIP_LEFT_RIGHT)
back.save(os.path.join(SRC, "back.png"))
right.save(os.path.join(SRC, "right.png"))

sheet = Image.new("RGB", (PS * 2, PS * 2), (255, 255, 255))
sheet.paste(front, (0, 0))
sheet.paste(left, (PS, 0))
sheet.paste(right, (0, PS))
sheet.paste(back, (PS, PS))
sheet.save(os.path.join(SRC, "preview-2x2-top.png"))
print("4 张 + 预览已输出")
