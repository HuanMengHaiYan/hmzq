"""GLB 几何实测：在**游戏世界坐标**下量出球桌的关键尺寸。

用途：给 table-model.js 的归一化参数、以及（0.8.0）新碰撞体提供实测依据。
输出的坐标已经是游戏坐标（X = 长边、Z = 短边、Y 向上、台呢面 y = 0），
单位米，可以直接抄进 constants.js / layout.js。

复现的是 src/table-model.js mountTableModel() 的同一条变换链：
    world = root.position + S ⊙ (R_y(90°) · v)          （模型长边在 Z → 转到 X）
其中 S 由「击球区对齐 2540 × 1270」反解，root.position 由「台呢面抬到 y = 0」反解。

    python test/glb-measure.py src/assets/table-9ft.glb
"""
import json
import math
import struct
import sys
from array import array

if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8")

FMT = {5126: ("f", 4), 5125: ("I", 4), 5123: ("H", 2), 5121: ("B", 1)}
NC = {"SCALAR": 1, "VEC2": 2, "VEC3": 3, "VEC4": 4}

# 比例直接从 src/table-model.js 的 MODEL 常量里读 —— 免得脚本和代码各写一份然后漂移
def read_model_consts(path="src/table-model.js"):
    import os
    import re
    if not os.path.exists(path):
        path = os.path.join(os.path.dirname(__file__), "..", "src", "table-model.js")
    txt = open(path, encoding="utf-8").read()
    body = re.search(r"const MODEL = \{(.*?)\};", txt, re.S).group(1)
    out = {}
    for key in ("clothW", "clothL", "clothY"):
        expr = re.search(key + r"\s*:\s*([0-9./*+\- ]+?),", body).group(1)
        out[key] = eval(expr)          # 只含数字与四则运算，来自本仓库源码
    return out


MC = read_model_consts()
CLOTH_W_RATIO = MC["clothW"]
CLOTH_L_RATIO = MC["clothL"]
CLOTH_Y_RATIO = MC["clothY"]
HALF_L, HALF_W = 1.27, 0.635          # constants.js TABLE.halfL / halfW


def load(path):
    raw = open(path, "rb").read()
    off, gltf, binc = 12, None, None
    while off < len(raw):
        clen, ctype = struct.unpack_from("<II", raw, off)
        body = raw[off + 8: off + 8 + clen]
        if ctype == 0x4E4F534A:
            gltf = json.loads(body.decode("utf-8"))
        elif ctype == 0x004E4942:
            binc = body
        off += 8 + clen + ((4 - clen % 4) % 4)
    return gltf, binc


def read_acc(gltf, binc, i):
    a = gltf["accessors"][i]
    bv = gltf["bufferViews"][a["bufferView"]]
    base = bv.get("byteOffset", 0) + a.get("byteOffset", 0)
    n, nc = a["count"], NC[a["type"]]
    fmt, isz = FMT[a["componentType"]]
    stride = bv.get("byteStride") or (nc * isz)
    if stride == nc * isz:
        arr = array(fmt)
        arr.frombytes(binc[base: base + n * nc * isz])
        return list(arr)
    out = []
    for k in range(n):
        out.extend(struct.unpack_from("<" + fmt * nc, binc, base + k * stride))
    return out


def build(path):
    """返回 (世界坐标顶点列表 [(x,y,z)], 三角形索引列表 [(i,j,k)], 归一化信息)"""
    gltf, binc = load(path)
    mesh = gltf["meshes"][0]
    prim = mesh["primitives"][0]
    pos = read_acc(gltf, binc, prim["attributes"]["POSITION"])
    idx = read_acc(gltf, binc, prim["indices"])
    v0 = [(pos[i * 3], pos[i * 3 + 1], pos[i * 3 + 2]) for i in range(len(pos) // 3)]

    xs = [p[0] for p in v0]
    ys = [p[1] for p in v0]
    zs = [p[2] for p in v0]
    d0 = (max(xs) - min(xs), max(ys) - min(ys), max(zs) - min(zs))
    miny0 = min(ys)

    cloth_l = d0[2] * CLOTH_L_RATIO
    cloth_w = d0[0] * CLOTH_W_RATIO
    sx = (HALF_L * 2) / cloth_l
    sz = (HALF_W * 2) / cloth_w
    sy = math.sqrt(sx * sz)

    # R_y(90°): x' = z, y' = y, z' = -x    然后乘 S
    def to_world(p):
        return (p[2] * sx, p[1] * sy, -p[0] * sz)

    w = [to_world(p) for p in v0]
    # root.position: x/z 居中，y 让「台呢面」落在 0
    cx = (min(p[0] for p in w) + max(p[0] for p in w)) / 2
    cz = (min(p[2] for p in w) + max(p[2] for p in w)) / 2
    py = -(miny0 + CLOTH_Y_RATIO) * sy   # CLOTH_Y_RATIO 是绝对值（模型原始单位）
    w = [(p[0] - cx, p[1] + py, p[2] - cz) for p in w]

    tris = [(idx[i], idx[i + 1], idx[i + 2]) for i in range(0, len(idx), 3)]
    info = dict(d0=d0, sx=sx, sy=sy, sz=sz, pos=(cx, py, cz))
    return w, tris, info


class Grid:
    """XZ 平面分桶，加速竖直射线求交"""

    CELL = 0.06

    def __init__(self, verts, tris):
        self.v = verts
        self.t = tris
        self.g = {}
        c = self.CELL
        for ti, (a, b, d) in enumerate(tris):
            pa, pb, pd = verts[a], verts[b], verts[d]
            x0 = int(math.floor(min(pa[0], pb[0], pd[0]) / c))
            x1 = int(math.floor(max(pa[0], pb[0], pd[0]) / c))
            z0 = int(math.floor(min(pa[2], pb[2], pd[2]) / c))
            z1 = int(math.floor(max(pa[2], pb[2], pd[2]) / c))
            for ix in range(x0, x1 + 1):
                for iz in range(z0, z1 + 1):
                    self.g.setdefault((ix, iz), []).append(ti)

    def hits(self, x, z, y_top=3.0, y_bot=-3.0):
        """竖直向下射线的全部命中高度（降序）"""
        c = self.CELL
        cand = self.g.get((int(math.floor(x / c)), int(math.floor(z / c))), ())
        out = []
        for ti in cand:
            pa, pb, pd = self.v[self.t[ti][0]], self.v[self.t[ti][1]], self.v[self.t[ti][2]]
            # XZ 平面内的重心坐标（射线沿 Y，投影到 XZ 就是点是否在三角形内）
            x1, z1 = pa[0], pa[2]
            x2, z2 = pb[0], pb[2]
            x3, z3 = pd[0], pd[2]
            den = (z2 - z3) * (x1 - x3) + (x3 - x2) * (z1 - z3)
            if abs(den) < 1e-12:
                continue
            l1 = ((z2 - z3) * (x - x3) + (x3 - x2) * (z - z3)) / den
            l2 = ((z3 - z1) * (x - x3) + (x1 - x3) * (z - z3)) / den
            l3 = 1 - l1 - l2
            if l1 < -1e-6 or l2 < -1e-6 or l3 < -1e-6:
                continue
            y = l1 * pa[1] + l2 * pb[1] + l3 * pd[1]
            if y_bot <= y <= y_top:
                out.append(y)
        out.sort(reverse=True)
        return out

    def top(self, x, z, ybot=-3.0):
        h = self.hits(x, z, y_bot=ybot)
        return h[0] if h else None


def fmt_mm(v):
    return "%.1f" % (v * 1000) if v is not None else "——"


def main(path):
    v, tris, info = build(path)
    d0 = info["d0"]
    print("=" * 70)
    print("归一化：模型原始 %.4f × %.4f × %.4f" % d0)
    print("        sx=%.5f sy=%.5f sz=%.5f   root.position=(%.4f, %.4f, %.4f)" % (
        info["sx"], info["sy"], info["sz"], *info["pos"]))
    xs = [p[0] for p in v]
    ys = [p[1] for p in v]
    zs = [p[2] for p in v]
    print("世界包围盒：X %.4f..%.4f  Y %.4f..%.4f  Z %.4f..%.4f" % (
        min(xs), max(xs), min(ys), max(ys), min(zs), max(zs)))

    grid = Grid(v, tris)

    print("\n— 台呢面高度（沿中线取点，向下射线最高命中）—")
    for p in [(0.0, 0.0), (0.3, 0.2), (-0.6, -0.15), (0.9, 0.1)]:
        print("  (%+.2f,%+.2f) → %s mm  %s" % (p[0], p[1], fmt_mm(grid.top(*p)),
                                              " ".join(fmt_mm(h) for h in grid.hits(*p, y_top=0.2)[:4])))

    print("\n— 库边鼻尖（内沿）位置：沿垂直方向扫，找高度突变的点 —")
    # 长库边：x 取 0.5（避开中袋），z 从小往大扫
    def find_nose(fixed, axis, sign, lo, hi, step=0.0005):
        """axis: 'z' 沿 Z 扫 / 'x' 沿 X 扫；sign: 从台面内侧往外的方向"""
        t = lo
        while t * sign < hi * sign:
            x, z = (fixed, t) if axis == "z" else (t, fixed)
            h = grid.top(x, z)
            if h is not None and h > 0.005:
                return t, h
            t += step * sign
        return None, None

    for name, fixed, axis, sign in [
        ("长库边 +Z (x=0.5)", 0.5, "z", +1),
        ("长库边 -Z (x=0.5)", 0.5, "z", -1),
        ("短库边 +X (z=0)", 0.0, "x", +1),
        ("短库边 -X (z=0)", 0.0, "x", -1),
    ]:
        lo = 0.50 if axis == "z" else 1.10
        nose, h = find_nose(fixed, axis, sign, lo, 0.90 if axis == "z" else 1.55)
        print("  %-22s 内沿 %s mm   该处顶高 %s mm   理论 %s mm" % (
            name, fmt_mm(nose), fmt_mm(h), "635" if axis == "z" else "1270"))

    print("\n— 长库边横向剖面（x=0.5，z 从内往外）—")
    z = 0.52
    while z <= 0.76:
        h = grid.top(0.5, z)
        print("  z=%4.0f mm  %s" % (z * 1000, "空" if h is None else "%.1f mm" % (h * 1000)))
        z += 0.004

    print("\n— 短库边横向剖面（z=0，x 从内往外）—")
    x = 1.14
    while x <= 1.44:
        h = grid.top(x, 0.0)
        print("  x=%4.0f mm  %s" % (x * 1000, "空" if h is None else "%.1f mm" % (h * 1000)))
        x += 0.004

    print("\n— 库边顶面高度（库边中段多点）—")
    for p in [(0.5, 0.66), (-0.5, -0.66), (1.30, 0.3)]:
        print("  (%+.2f,%+.2f) 最高 %s mm" % (p[0], p[1], fmt_mm(grid.top(*p))))

    print("\n— 长库边沿 X 扫描：哪一段没有库边（= 中袋断口）—")
    znose = 0.635 + 0.01
    rows = []
    x = -1.35
    while x <= 1.35:
        h = grid.top(x, znose)
        rows.append((x, h))
        x += 0.002
    runs = []
    cur = None
    for x, h in rows:
        empty = (h is None) or (h < 0.004)
        if cur is None or cur[0] != empty:
            cur = [empty, x, x]
            runs.append(cur)
        else:
            cur[2] = x
    for empty, a, b in runs:
        tag = "无库边(断口)" if empty else "有库边"
        if b - a > 0.004:
            print("  X %+.4f .. %+.4f  (%5.1f mm)  %s" % (a, b, (b - a) * 1000, tag))

    print("\n— 短库边沿 Z 扫描：角袋断口 —")
    xnose = 1.27 + 0.01
    rows = []
    z = -0.72
    while z <= 0.72:
        h = grid.top(xnose, z)
        rows.append((z, h))
        z += 0.002
    runs = []
    cur = None
    for z, h in rows:
        empty = (h is None) or (h < 0.004)
        if cur is None or cur[0] != empty:
            cur = [empty, z, z]
            runs.append(cur)
        else:
            cur[2] = z
    for empty, a, b in runs:
        if b - a > 0.004:
            print("  Z %+.4f .. %+.4f  (%5.1f mm)  %s" % (a, b, (b - a) * 1000,
                                                          "无库边(断口)" if empty else "有库边"))

    print("\n— 外框：沿 X / Z 找最外沿与框顶高 —")
    for name, fixed, axis, sign in [
        ("外框 +Z", 0.5, "z", +1), ("外框 -Z", 0.5, "z", -1),
        ("外框 +X", 0.0, "x", +1), ("外框 -X", 0.0, "x", -1),
    ]:
        lo = 0.70 if axis == "z" else 1.35
        t, h = find_nose(fixed, axis, sign, 0.95 if axis == "z" else 1.6, 2.0)
        print("  %-8s 最外沿 %s mm  (%s mm 处仍有几何)" % (name, fmt_mm(t), fmt_mm(t)))

    print("\n— 世界包围盒（含裙板/腿）—")
    print("  X %+.4f .. %+.4f   Z %+.4f .. %+.4f   Y %+.4f .. %+.4f" % (
        min(xs), max(xs), min(zs), max(zs), min(ys), max(ys)))

    print("\n— 台呢矩形（y 在 ±1.5mm 内的顶点范围，含袋口缺角）—")
    near = [p for p in v if abs(p[1]) <= 0.0015]
    if near:
        print("  X %+.4f .. %+.4f (%.0f mm)  Z %+.4f .. %+.4f (%.0f mm)  n=%d" % (
            min(p[0] for p in near), max(p[0] for p in near),
            (max(p[0] for p in near) - min(p[0] for p in near)) * 1000,
            min(p[2] for p in near), max(p[2] for p in near),
            (max(p[2] for p in near) - min(p[2] for p in near)) * 1000, len(near)))

    print("\n— 台呢下有没有叠板：取台面中心与几个点，向下看所有命中层 —")
    for p in [(0.0, 0.0), (0.6, 0.3), (-0.9, -0.25), (0.0, 0.60)]:
        print("  (%+.2f,%+.2f) → %s" % (p[0], p[1],
                                        "  ".join(fmt_mm(h) for h in grid.hits(*p) if h < 0.2)))

    print("\n— 角袋：沿 45° 对角线从角点向内扫（0=空，有值=有面）—")
    for sx_, sz_ in [(1, 1), (1, -1), (-1, 1), (-1, -1)]:
        # 角点取台呢理论角点（±1.27, ±0.635）向外一点的袋心
        px, pz = sx_ * (HALF_L - 0.02), sz_ * (HALF_W - 0.02)
        seq = []
        for k in range(0, 170, 4):
            d = k / 1000.0
            h = grid.top(px + sx_ * d, pz + sz_ * d)
            seq.append("空" if h is None or h < -1.0 else "%.0f" % (h * 1000))
        print("  角(%+d,%+d) 0..170mm: %s" % (sx_, sz_, " ".join(seq)))

    print("\n— 中袋：沿法线从外向内扫（x=0, z 从 0.75 往下）—")
    seq = []
    z = 0.780
    while z >= 0.560:
        h = grid.top(0.0, z)
        seq.append("%.0f:%s" % (z * 1000, "空" if h is None or h < -1.0 else "%.0f" % (h * 1000)))
        z -= 0.004
    print("  " + "  ".join(seq))


if __name__ == "__main__":
    main(sys.argv[1] if len(sys.argv) > 1 else "src/assets/table-9ft.glb")
