"""GLB 快速体检：结构 / 材质 / 尺寸比例 / 连通分量 / 台面水平板。

用途：验收 Tripo 等工具导出的台球桌模型。通用的部分放这里，
「袋口是不是真通孔」要靠射线扫描且需要人工定位袋口坐标，见
docs/GLB-评估-tripo-v3.1.md 里记的方法，不在这里硬编码。

    python test/glb-check.py <模型.glb>
"""
import json
import struct
import sys
from array import array
from collections import Counter

FMT = {5126: ("f", 4), 5125: ("I", 4), 5123: ("H", 2), 5121: ("B", 1)}
NC = {"SCALAR": 1, "VEC2": 2, "VEC3": 3, "VEC4": 4}

REAL_W, REAL_L, REAL_H = 1550.0, 2830.0, 800.0


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
    return gltf, binc, len(raw)


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


def main(path):
    gltf, binc, size = load(path)
    acc = gltf["accessors"]
    print("=" * 62)
    print("文件 %.2f MB  glTF %s  生成器 %s"
          % (size / 1048576, gltf["asset"].get("version", "2.0"), gltf["asset"].get("generator")))
    print("nodes %d  meshes %d  materials %d  textures %d  images %d"
          % (len(gltf.get("nodes", [])), len(gltf.get("meshes", [])),
             len(gltf.get("materials", [])), len(gltf.get("textures", [])),
             len(gltf.get("images", []))))

    tris = verts = 0
    pos_acc = None
    for m in gltf.get("meshes", []):
        for p in m["primitives"]:
            va = acc[p["attributes"]["POSITION"]]
            tris += acc[p["indices"]]["count"] // 3 if "indices" in p else va["count"] // 3
            verts += va["count"]
            pos_acc = p["attributes"]["POSITION"]
    print("三角 %d  顶点 %d  %s" % (tris, verts, "游戏友好" if tris < 60000 else "偏重"))

    for i, m in enumerate(gltf.get("materials", [])):
        pbr = m.get("pbrMetallicRoughness", {})
        print("材质[%d] %s  baseColorTex=%s  MRtex=%s  normalTex=%s  metal=%.2f rough=%.2f doubleSided=%s"
              % (i, m.get("name", "")[:20],
                 "有" if pbr.get("baseColorTexture") else "无",
                 "有" if pbr.get("metallicRoughnessTexture") else "无",
                 "有" if m.get("normalTexture") else "无",
                 pbr.get("metallicFactor", 1.0), pbr.get("roughnessFactor", 1.0),
                 m.get("doubleSided", False)))
        if pbr.get("metallicFactor", 1.0) == 0 and not pbr.get("metallicRoughnessTexture"):
            print("        ⚠️ metal=0 且无 MR 贴图：模型里的金属件渲染出来是哑光塑料色")

    for i, im in enumerate(gltf.get("images", [])):
        bv = gltf["bufferViews"][im["bufferView"]]
        o, ln = bv.get("byteOffset", 0), bv["byteLength"]
        data = binc[o: o + ln]
        wh = "?"
        try:
            if data[:8] == b"\x89PNG\r\n\x1a\n":
                wh = "%dx%d" % struct.unpack_from(">II", data, 16)
            elif data[:2] == b"\xff\xd8":
                k = 2
                while k + 9 < len(data):
                    if data[k] != 0xFF:
                        k += 1
                        continue
                    mk = data[k + 1]
                    if mk in (0xC0, 0xC1, 0xC2, 0xC3):
                        hh, ww = struct.unpack_from(">HH", data, k + 5)
                        wh = "%dx%d" % (ww, hh)
                        break
                    if mk in (0xD8, 0xD9) or 0xD0 <= mk <= 0xD7:
                        k += 2
                        continue
                    k += 2 + struct.unpack_from(">H", data, k + 2)[0]
        except Exception:
            pass
        print("贴图[%d] %s  %s  %d KB" % (i, im.get("mimeType", ""), wh, ln // 1024))

    pos = read_acc(gltf, binc, pos_acc)
    V = [tuple(pos[i * 3:i * 3 + 3]) for i in range(len(pos) // 3)]
    xs = [v[0] for v in V]; ys = [v[1] for v in V]; zs = [v[2] for v in V]
    x0, x1, y0, y1, z0, z1 = min(xs), max(xs), min(ys), max(ys), min(zs), max(zs)
    print("\n包围盒 %.4f × %.4f × %.4f（X宽 Y高 Z长）" % (x1 - x0, y1 - y0, z1 - z0))
    s = (x1 - x0) / REAL_W
    print("按宽度对齐 1550mm 的比例尺 %.6f 单位/mm" % s)
    print("  实测长宽比 %.3f  (真实外框 %.3f)  偏差 %+.1f%%"
          % ((z1 - z0) / (x1 - x0), REAL_L / REAL_W,
             ((z1 - z0) / (x1 - x0)) / (REAL_L / REAL_W) * 100 - 100))
    print("  高度若按同比例尺应为 %.4f，实测 %.4f  → %.0f mm（真实 %.0f）"
          % (REAL_H * s, y1 - y0, (y1 - y0) / s, REAL_H))

    print("\n水平板（顶点密集且 y 集中，按 800mm 总高换算）：")
    NB = 160
    hist = [0] * NB
    for y in ys:
        hist[min(NB - 1, int((y - y0) / (y1 - y0) * NB))] += 1
    for b in sorted(range(NB), key=lambda b: -hist[b])[:6]:
        yy = y0 + (b + 0.5) / NB * (y1 - y0)
        sel = [v for v in V if abs(v[1] - yy) < (y1 - y0) / NB]
        if len(sel) < 20:
            continue
        sx = max(p[0] for p in sel) - min(p[0] for p in sel)
        print("  y=%.0f mm  峰值层顶点 %d  覆盖 X %.0f mm  (峰值层中最大跨度 %.0f mm)"
              % ((yy - y0) / s, hist[b], sx / s, sx / s))

    prim = gltf["meshes"][0]["primitives"][0]
    idx = [int(x) for x in read_acc(gltf, binc, prim["indices"])]
    n = len(V)
    par = list(range(n))

    def find(x):
        while par[x] != x:
            par[x] = par[par[x]]
            x = par[x]
        return x

    for t in range(0, len(idx), 3):
        for a_, b_ in ((idx[t], idx[t + 1]), (idx[t + 1], idx[t + 2])):
            ra, rb = find(a_), find(b_)
            if ra != rb:
                par[ra] = rb
    comp = Counter(find(i) for i in range(n))
    print("\n连通分量 %d  %s" % (len(comp),
          "（碎片化，非水密；布尔挖洞会麻烦，但部件天然分离好删）" if len(comp) > 50 else "（整体焊接）"))
    print("最大 8 块：%s" % ", ".join(str(c) for _, c in comp.most_common(8)))
    print("=" * 62)


if __name__ == "__main__":
    main(sys.argv[1] if len(sys.argv) > 1 else "model.glb")
