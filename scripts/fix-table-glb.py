"""对 Tripo 导出的台球桌 GLB 做几何修复（只删面，不加面）。

挖洞形状的依据：**物理袋口 + 真实球桌的袋兜口**。
`layout.js` 的台布是 6 块矩形拼出来的，袋口处让出的缺口是 125 mm 宽的方孔
（`pocketCut 75 + cushionW 50`，中袋 `pocketGapMid 62.5×2`）。物理喉口（角 57 / 中 60）
完全落在这个方孔里 —— 所以**台呢上的开口按这个宽度挖**，视觉边缘与物理边界天然重合。

形状用**胶囊**（一条线段 + 半径 62.5 的圆头）：
  · 靠台面一端 = 物理袋心沿袋口方向向内 14 mm → 台呢上切出一段圆弧缺口（真实袋口的圆润感）；
  · 靠框一端   = 角袋 (±1.390, ±0.755) / 中袋 (±0, 0.77) → 木框上是一个圆润的袋兜口，
    且**不切穿框外沿**（真实球桌的袋兜口外面还有一圈框边）；
  · 角袋沿对角线、中袋沿横向 —— 与真实袋口的方向一致。

⚠️ 之前两版都错了，记在这里免得再走：
   ① 以袋心为圆心的**纯圆**：台呢上啃出圆坑没错，但台面以下放宽到 150 mm，
      把木框下半部掏空 → 从上方看木框上凭空多出一圈洞，而且模型自带的斜缺口没盖住，
      两个洞叠在一起就是用户说的"大坑，不符合实际台球桌的形状"。
   ② **轴对齐矩形**（照抄台布拼接）：台呢/物理边界是准的，但直角切口生硬，
      细分台阶在直边上变成一排毛刺，比圆弧更扎眼。
   胶囊把"台呢圆弧 + 框上袋兜口 + 中间连通"三件事一次做完。

另外两件"代码侧怎么调都救不回来"的事：

  1. `--sights`   删掉框顶那批悬空的装饰小块（完全浮在 38 mm 以上、bbox < 60 mm 的独立分量）。
  2. `--underboard` 删掉台面下方那两块几乎整桌大的水平板（106 mm / 289 mm）。

⚠️ 按"三角形质心在不在区域内"整块删会留下毫米级锯齿，透光看是一圈毛刺；
   所以边界上的三角形要**细分**到边长 < 4 mm 再判 —— 这是本脚本唯一"加面"的地方。

用法：
  python scripts/fix-table-glb.py <输入.glb> <输出.glb> [--pockets] [--sights] [--underboard]
不加任何开关时三项全做。
"""
import json
import math
import struct
import sys

FMT = {5126: ("f", 4), 5125: ("I", 4), 5123: ("H", 2), 5121: ("B", 1)}
NC = {"SCALAR": 1, "VEC2": 2, "VEC3": 3, "VEC4": 4}

# ---- 与游戏一致的规格（世界坐标，米）----
HALF_L, HALF_W = 1.27, 0.635          # 库鼻
POCKET_CUT = 0.075                    # 袋口自库鼻向内让出
CUSHION_W = 0.050                     # 库边厚度
GAP_MID = 0.0625                      # 中袋口半宽（TABLE.pocketGapMid）
POCKET_OFF = (POCKET_CUT - CUSHION_W) / 2   # 袋心相对库鼻交点的偏移（12.5 mm）

# ---- 洞口 = 进球判定圆，同一个圆 ----
# 与 src/constants.js 的 TABLE.pocketThroat / pocketThroatMid 一一对应。
# 球心进入这个圆才算落袋（判据见 src/pockets.js），所以**台面被挖掉的洞必须是它**：
# 洞比判定圆大 → 球在台呢上"悬空"掉下去；洞比判定圆小 → 球先撞切口再进袋。
THROAT = {"corner": 0.057, "middle": 0.060}
# 视觉余量 1 mm：切线是 6 mm 细分出来的多边形，留 1 mm 让锯齿不会露在洞口以内。
R_VIS = 0.001

IN_L, IN_W = HALF_L - POCKET_CUT, HALF_W - POCKET_CUT   # 1195 / 560（物理边界）
# 框内袋兜口中心。⚠️ 必须留出框边：模型外沿 1451.7 / 836.7，中心 + R_HOLE 不能越过去，
# 否则胶囊把木框切穿到桌外 —— 从外侧看是个豁口，从上方看是个通到外面的洞。
OUT_L, OUT_W = 1.333, 0.706           # 模型库边外沿 = 木框内沿（实测 1333 / 706）
# ⚠️ 只能挖到库边顶（39 mm）以下。定成 50 mm 会把**木框顶面（44.6 mm）**也算进挖洞高度，
# 胶囊轴一穿过框顶的大三角形就一路细分到底 —— 面数从 4.5 万炸到 32 万、GLB 9.7 MB。
Y_TOP = 0.041
Y_BOTTOM = -0.40                      # 挖到桌腔
SPLIT_EDGE = 0.004                    # 细分目标边长（米）：圆洞切成 4 mm 段，视觉才圆
SPLIT_DEPTH = 9                       # 台呢是 2.5 m 的大三角形，深度不够会停在 20 mm 的台阶上


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
    out = []
    for k in range(n):
        out.extend(struct.unpack_from("<" + fmt * nc, binc, base + k * stride))
    return out


def model_consts():
    """从 src/table-model.js 读归一化比例（保持单一来源）"""
    import os
    import re
    p = os.path.join(os.path.dirname(__file__), "..", "src", "table-model.js")
    txt = open(p, encoding="utf-8").read()
    body = re.search(r"const MODEL = \{(.*?)\};", txt, re.S).group(1)
    out = {}
    for key in ("clothW", "clothL", "clothY"):
        expr = re.search(key + r"\s*:\s*([0-9./*+\- ]+?),", body).group(1)
        out[key] = eval(expr)
    return out


def holes():
    """6 个袋口的圆形洞口：**圆心 = 物理袋心，半径 = 该袋的喉口半径**。

    历史教训（0.8.0-test 三次返工）：
      · 第一版按"袋心 + 圆"挖，但半径给到 60/70 且往框外放 150 mm
        → 木框下半部被掏空，用户说"这不像台球桌，像挖了个大坑"；
      · 第二版改成 125 mm 宽、向框内沿延伸的**胶囊**，想把物理方孔的四条边界都盖住
        → 台呢上被咬掉的月牙重心整个偏台内，视觉洞口与判定圆错位约 40 mm，
        用户圈出来的"判定区"（袋心）和看到的黑坑对不上。
    现在回到最朴素的定义：**挖掉的就是判定圆本身**，一个袋一个圆，不多挖一寸。
    """
    out = []
    for sx in (-1, 1):
        for sz in (-1, 1):
            out.append((sx * (HALF_L - POCKET_OFF), sz * (HALF_W - POCKET_OFF),
                        THROAT["corner"] + R_VIS, "corner"))
    for sz in (-1, 1):
        out.append((0.0, sz * (HALF_W - POCKET_OFF), THROAT["middle"] + R_VIS, "middle"))
    return out


HOLES = holes()


def clearance(x, y, z):
    """世界坐标点到"要挖掉的区域"的有符号距离：< 0 = 在洞内，> 0 = 在外。

    区域 = 圆 ∪ 圆 ∪ … ∩ 台面矩形（|x| ≤ 1333、|z| ≤ 706 = 模型库边外沿）。
    ⚠️ 矩形裁剪不能省：圆的外沿虽然远到不了木框，但留着这层保护，
       以后有人放大喉口半径也不会把框啃穿（框顶 44.6 mm 在 Y_TOP 之上，本就不会被切）。
    """
    if y > Y_TOP or y < Y_BOTTOM:
        return 1e9
    clip = max(abs(x) - OUT_L, abs(z) - OUT_W)
    best = 1e18
    for cx, cz, r, _ in HOLES:
        d = math.hypot(x - cx, z - cz) - r
        if d < best:
            best = d
    return max(best, clip)


def _pt_seg_d2(px, pz, ax, az, bx, bz):
    vx, vz = bx - ax, bz - az
    wx, wz = px - ax, pz - az
    L = vx * vx + vz * vz
    t = 0.0 if L < 1e-12 else max(0.0, min(1.0, (wx * vx + wz * vz) / L))
    dx, dz = wx - t * vx, wz - t * vz
    return dx * dx + dz * dz


def _in_tri(px, pz, a, b, c):
    d1 = (px - a[0]) * (b[1] - a[1]) - (b[0] - a[0]) * (pz - a[1])
    d2 = (px - b[0]) * (c[1] - b[1]) - (c[0] - b[0]) * (pz - b[1])
    d3 = (px - c[0]) * (a[1] - c[1]) - (a[0] - c[0]) * (pz - c[1])
    neg = (d1 < 0) or (d2 < 0) or (d3 < 0)
    pos = (d1 > 0) or (d2 > 0) or (d3 > 0)
    return not (neg and pos)


def tri_hits_circle(cx, cz, r, tri):
    """三角形（XZ 投影）是否与圆相交。

    ⚠️ 与之前的线段-胶囊判据同一个坑：不能用"圆的包围盒 vs 三角形包围盒"，
    台呢是 200 mm 的大三角形，外接框判据会让它一路细分到底（面数炸十倍）。
    """
    r2 = r * r
    a, b, c = tri
    for p in (a, b, c):
        if (p[0] - cx) ** 2 + (p[1] - cz) ** 2 <= r2:
            return True
    if _in_tri(cx, cz, a, b, c):
        return True
    for p, q in ((a, b), (b, c), (c, a)):
        if _pt_seg_d2(cx, cz, p[0], p[1], q[0], q[1]) <= r2:
            return True
    return False


def hits_any(pts):
    """三角形（XZ 投影）是否与任一口袋圆相交。"""
    tri = ((pts[0][0], pts[0][1]), (pts[1][0], pts[1][1]), (pts[2][0], pts[2][1]))
    for cx, cz, r, _ in HOLES:
        if tri_hits_circle(cx, cz, r, tri):
            return True
    return False


def main():
    args = sys.argv[1:]
    if len(args) < 2:
        print(__doc__)
        sys.exit(1)
    src, dst = args[0], args[1]
    explicit = {"--pockets", "--sights", "--underboard"} & set(args)
    do_pockets = "--pockets" in args or not explicit
    do_sights = "--sights" in args or not explicit
    do_under = "--underboard" in args or not explicit

    gltf, binc = load(src)
    prim = gltf["meshes"][0]["primitives"][0]
    acc = gltf["accessors"]

    def grab(key, ncomp):
        ai = prim["attributes"][key]
        d = read_acc(gltf, binc, ai)
        return [tuple(d[i * ncomp:(i + 1) * ncomp]) for i in range(len(d) // ncomp)]

    POS = grab("POSITION", 3)
    NRM = grab("NORMAL", 3)
    UV = grab("TEXCOORD_0", 2)
    idx = read_acc(gltf, binc, prim["indices"])
    tris = [(idx[i], idx[i + 1], idx[i + 2]) for i in range(0, len(idx), 3)]
    nv0 = len(POS)

    # ---------- 复现 table-model.js 的归一化，把顶点搬到世界坐标 ----------
    mc = model_consts()
    xs = [p[0] for p in POS]
    ys = [p[1] for p in POS]
    zs = [p[2] for p in POS]
    d0 = (max(xs) - min(xs), max(ys) - min(ys), max(zs) - min(zs))
    sy = math.sqrt((HALF_L * 2) / (d0[2] * mc["clothL"]) * (HALF_W * 2) / (d0[0] * mc["clothW"]))
    sx = (HALF_L * 2) / (d0[2] * mc["clothL"])
    sz = (HALF_W * 2) / (d0[0] * mc["clothW"])
    ty = -(min(ys) + mc["clothY"]) * sy
    WORLD = [(p[2] * sx, p[1] * sy + ty, -p[0] * sz) for p in POS]
    cxw = (min(w[0] for w in WORLD) + max(w[0] for w in WORLD)) / 2
    czw = (min(w[2] for w in WORLD) + max(w[2] for w in WORLD)) / 2
    WORLD = [(w[0] - cxw, w[1], w[2] - czw) for w in WORLD]

    print("归一化 sx=%.4f sy=%.4f sz=%.4f ty=%.4f" % (sx, sy, sz, ty))
    print("世界包围盒 X %.3f..%.3f  Y %.3f..%.3f  Z %.3f..%.3f"
          % (min(w[0] for w in WORLD), max(w[0] for w in WORLD),
             min(w[1] for w in WORLD), max(w[1] for w in WORLD),
             min(w[2] for w in WORLD), max(w[2] for w in WORLD)))

    # ---------- 整块删除：框顶装饰小块 / 台面下的板 ----------
    keep = [True] * len(tris)
    if do_sights or do_under:
        par = list(range(len(POS)))

        def find(a):
            while par[a] != a:
                par[a] = par[par[a]]
                a = par[a]
            return a

        for a, b, c in tris:
            ra = find(a)
            for v in (b, c):
                rv = find(v)
                if rv != ra:
                    par[rv] = ra

        comp = {}
        for ti, (a, b, c) in enumerate(tris):
            comp.setdefault(find(a), []).append(ti)

        n_sight = n_under = 0
        for root, ts in comp.items():
            pts = {v for ti in ts for v in tris[ti]}
            x0 = min(WORLD[p][0] for p in pts); x1 = max(WORLD[p][0] for p in pts)
            y0 = min(WORLD[p][1] for p in pts); y1 = max(WORLD[p][1] for p in pts)
            z0 = min(WORLD[p][2] for p in pts); z1 = max(WORLD[p][2] for p in pts)
            size = max(x1 - x0, y1 - y0, z1 - z0)
            if do_sights and size < 0.060 and y0 > 0.038 and (y1 - y0) > 0.003:
                for ti in ts:
                    keep[ti] = False
                n_sight += len(ts)
            elif (do_under and (y1 - y0) < 0.012 and (x1 - x0) > 1.0
                  and (z1 - z0) > 0.6 and y1 < -0.02):
                for ti in ts:
                    keep[ti] = False
                n_under += len(ts)
                print("  删板 y=%.0f mm  %.0f x %.0f mm  %d 个三角形"
                      % (y0 * 1000, (x1 - x0) * 1000, (z1 - z0) * 1000, len(ts)))
        print("框顶装饰：删除 %d 个三角形" % n_sight)
        print("台面下板：删除 %d 个三角形" % n_under)

    # ---------- 袋口：整块删 + 边界细分 ----------
    out = []
    cache = {}
    stats = dict(kill=0, split=0)

    def add_mid(a, b):
        key = (a, b) if a < b else (b, a)
        if key in cache:
            return cache[key]
        i = len(POS)
        POS.append(tuple((POS[a][k] + POS[b][k]) * 0.5 for k in range(3)))
        # 法线必须**归一化**：两个单位向量一平均长度就小于 1，未归一的法线在着色里
        # 会被当成"偏暗"，细分边界上每一条边都留一道浅色细线，俯视看是一圈虚线轮廓。
        n = [(NRM[a][k] + NRM[b][k]) * 0.5 for k in range(3)]
        ln = math.sqrt(n[0] * n[0] + n[1] * n[1] + n[2] * n[2]) or 1.0
        NRM.append((n[0] / ln, n[1] / ln, n[2] / ln))
        UV.append(tuple((UV[a][k] + UV[b][k]) * 0.5 for k in range(2)))
        WORLD.append(tuple((WORLD[a][k] + WORLD[b][k]) * 0.5 for k in range(3)))
        cache[key] = i
        return i

    def dist3(p, q):
        return math.sqrt(sum((p[k] - q[k]) ** 2 for k in range(3)))

    def split(a, b, c, depth):
        wa, wb, wc = WORLD[a], WORLD[b], WORLD[c]
        ca = clearance(*wa); cb = clearance(*wb); cc = clearance(*wc)
        if ca < 0 and cb < 0 and cc < 0:
            stats["kill"] += 1
            return
        # 早停：三个顶点都在外、且三角形包围盒根本不碰任何缺口矩形 → 原样保留。
        if ca > 0 and cb > 0 and cc > 0:
            my = (wa[1] + wb[1] + wc[1]) / 3
            if not (Y_BOTTOM <= my <= Y_TOP):
                out.append((a, b, c))
                return
            tri = ((wa[0], wa[2]), (wb[0], wb[2]), (wc[0], wc[2]))
            if not hits_any(tri):
                out.append((a, b, c))
                return
        if depth <= 0 or max(dist3(wa, wb), dist3(wb, wc), dist3(wc, wa)) < SPLIT_EDGE:
            # ⚠️ 保留判据：**三个顶点都在洞外**（ca/cb/cc 是进函数时算的顶点有符号距离）。
            #    · 写成 (ca+cb+cc) >= 0 → 把"一个顶点在洞内、两个在外"的三角形整块留下，
            #      那个顶点就变成一条伸进洞口的细长碎片（俯视是横穿袋口的黑线，0.7.0 的"黑刺"）；
            #    · 写质心 → 碎片小一点但仍有：4 mm 的三角形质心在外、顶点却能扎进洞里 2~3 mm，
            #      近景看就是"台呢尖角戳进洞口"（0.8.0-test 第三次返工）。
            #    三顶点全在外，等于**洞只会略大、绝不会小于判定圆** —— 方向是对的：
            #    球永远不会先撞上一块戳进洞里的台呢。误差上界 = SPLIT_EDGE（4 mm），
            #    相对 114/120 mm 的洞口是 3%，肉眼看不出来。
            if ca > 0 and cb > 0 and cc > 0:
                out.append((a, b, c))
            else:
                stats["kill"] += 1
            return
        ab = add_mid(a, b); bc = add_mid(b, c); ca_ = add_mid(c, a)
        stats["split"] += 1
        split(a, ab, ca_, depth - 1)
        split(ab, b, bc, depth - 1)
        split(ca_, bc, c, depth - 1)
        split(ab, bc, ca_, depth - 1)

    for ti, t in enumerate(tris):
        if not keep[ti]:
            continue
        if not do_pockets:
            out.append(t)
            continue
        # 完全在洞外且离得很远的三角形直接过（省掉 90% 的细分开销）
        far = min(clearance(*WORLD[v]) for v in t)
        if far > 0.10:
            out.append(t)
            continue
        split(t[0], t[1], t[2], SPLIT_DEPTH)

    print("袋口：细分 %d 次，丢弃 %d 个子三角形" % (stats["split"], stats["kill"]))
    print("三角形 %d -> %d   顶点 %d -> %d" % (len(tris), len(out), nv0, len(POS)))

    # ---------- 写回：重建三个属性 bufferView + 索引 ----------
    bvs = gltf["bufferViews"]
    img_bv = {im["bufferView"] for im in gltf.get("images", [])}
    attr_bv = {k: bvs[acc[prim["attributes"][k]]["bufferView"]]
               for k in ("POSITION", "NORMAL", "TEXCOORD_0")}
    idx_bv_i = acc[prim["indices"]]["bufferView"]

    def pack(vals, ncomp, ctype):
        fmt = FMT[ctype][0]
        flat = [x for v in vals for x in v[:ncomp]]
        return struct.pack("<%d%s" % (len(flat), fmt), *flat)

    new_data = {
        "POSITION": pack(POS, 3, 5126),
        "NORMAL": pack(NRM, 3, 5126),
        "TEXCOORD_0": pack(UV, 2, 5126),
    }
    use16 = len(POS) < 65536
    flat_idx = [x for t in out for x in t]
    new_idx = struct.pack("<%d%s" % (len(flat_idx), "H" if use16 else "I"), *flat_idx)
    acc[prim["indices"]]["count"] = len(flat_idx)
    acc[prim["indices"]]["componentType"] = 5123 if use16 else 5125
    acc[prim["indices"]]["byteOffset"] = 0
    for k in ("POSITION", "NORMAL", "TEXCOORD_0"):
        acc[prim["attributes"][k]]["count"] = len(POS)

    # 重建整个 bin：命中属性/索引的 bufferView 换新数据，其余（贴图）原样搬
    replace = {}
    for k in ("POSITION", "NORMAL", "TEXCOORD_0"):
        replace[id(attr_bv[k])] = new_data[k]
    replace[id(bvs[idx_bv_i])] = new_idx

    new_bin = bytearray()
    new_bvs = []
    for bv in bvs:
        o, n = bv.get("byteOffset", 0), bv["byteLength"]
        data = replace.get(id(bv)) or binc[o:o + n]
        while len(new_bin) % 4:
            new_bin.append(0)
        nb = {k: v for k, v in bv.items() if k not in ("byteOffset", "byteLength", "byteStride")}
        nb["byteOffset"] = len(new_bin)
        nb["byteLength"] = len(data)
        new_bvs.append(nb)
        new_bin.extend(data)

    gltf["bufferViews"] = new_bvs
    gltf["buffers"] = [{"byteLength": len(new_bin)}]

    js = json.dumps(gltf, separators=(",", ":")).encode()
    while len(js) % 4:
        js += b" "
    while len(new_bin) % 4:
        new_bin.append(0)
    blob = bytearray()
    blob += struct.pack("<III", 0x46546C67, 2, 12 + 8 + len(js) + 8 + len(new_bin))
    blob += struct.pack("<II", len(js), 0x4E4F534A) + js
    blob += struct.pack("<II", len(new_bin), 0x004E4942) + bytes(new_bin)
    open(dst, "wb").write(blob)
    print("写出 %s  %.2f MB" % (dst, len(blob) / 1048576))


if __name__ == "__main__":
    main()
