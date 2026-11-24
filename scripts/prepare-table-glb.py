"""把 Tripo 导出的台球桌 GLB 压成游戏资产（并另出一套多分辨率贴图）。

做四件事（都不改几何形状与 UV）：
  1. 贴图降采样到 --size（默认 256），重新编码 JPEG —— 原始 4096² 两张，
     GPU 展开后每张 67 MB，手机直接爆显存；
  2. 额外按 --sizes 导出一套 `color-<n>.jpg` / `normal-<n>.jpg`（默认 512/1024/2048），
     游戏里按画质档位换贴图（见 src/table-model.js）；
  3. 索引从 uint32 压成 uint16（顶点 17605 < 65536，省 111 KB）；
  4. 重排 bufferView / buffer，写出新的 GLB。

为什么 GLB 里内嵌的是**最小**那一档：
  贴图档位越低越省显存，但 GLB 本身总得带一张图才能独立显示。内嵌 256 之后，
  低画质只下载 GLB（约 0.7 MB），高画质再补 2048 的两张（约 1.9 MB）——
  比"每个档位各打一个 GLB"省掉三份重复几何（每份 0.68 MB）。

用法：
  python scripts/prepare-table-glb.py <输入.glb> <输出.glb> [--size 256]
                                      [--sizes 512,1024,2048] [--tex-dir src/assets/table-tex]
"""
import io
import json
import os
import struct
import sys

from PIL import Image

args = sys.argv[1:]
if len(args) < 2:
    print(__doc__)
    sys.exit(1)
src, dst = args[0], args[1]


def opt(name, default):
    return args[args.index(name) + 1] if name in args else default


size = int(opt("--size", "256"))
sizes = [int(x) for x in opt("--sizes", "512,1024,2048").split(",") if x.strip()]
tex_dir = opt("--tex-dir", os.path.join(os.path.dirname(dst), "table-tex"))

raw = open(src, "rb").read()
off, gltf, binc = 12, None, None
while off < len(raw):
    clen, ctype = struct.unpack_from("<II", raw, off)
    body = raw[off + 8: off + 8 + clen]
    if ctype == 0x4E4F534A:
        gltf = json.loads(body.decode())
    elif ctype == 0x004E4942:
        binc = body
    off += 8 + clen + ((4 - clen % 4) % 4)

bvs = gltf["bufferViews"]
acc = gltf["accessors"]
prim = gltf["meshes"][0]["primitives"][0]

img_bv = {im["bufferView"] for im in gltf.get("images", [])}
orig_sizes = {i: bvs[i]["byteLength"] for i in range(len(bvs))}

# 贴图角色：baseColor 走 JPEG 88、normal 走 JPEG 92 且不做色度采样（否则凹凸被抹平）
ROLE = {}
mat = gltf["materials"][0]
pbr = mat.get("pbrMetallicRoughness", {})
if "baseColorTexture" in pbr:
    ROLE[gltf["textures"][pbr["baseColorTexture"]["index"]]["source"]] = "color"
if "normalTexture" in mat:
    ROLE[gltf["textures"][mat["normalTexture"]["index"]]["source"]] = "normal"

# ---- 1. 索引压成 uint16 ----
idx_bv = bvs[acc[prim["indices"]]["bufferView"]]
idx_off = idx_bv.get("byteOffset", 0)
n_idx = acc[prim["indices"]]["count"]
# 输入可能已经是 uint16（scripts/fix-table-glb.py 的输出）—— 按 componentType 选格式
_in_fmt = "<%dH" % n_idx if acc[prim["indices"]]["componentType"] == 5123 else "<%dI" % n_idx
idx32 = struct.unpack_from(_in_fmt, binc, idx_off)
assert max(idx32) < 65536, "顶点数超过 65536，不能压成 uint16"
idx16 = struct.pack("<%dH" % n_idx, *idx32)
acc[prim["indices"]]["componentType"] = 5123
acc[prim["indices"]]["byteOffset"] = 0


def encode(im, role):
    buf = io.BytesIO()
    if role == "normal":
        im.save(buf, "JPEG", quality=92, subsampling=0, optimize=True)
    else:
        im.save(buf, "JPEG", quality=88, subsampling=0, optimize=True)
    return buf.getvalue()


def resized(im, n):
    w, h = im.size
    k = min(1.0, n / max(w, h))
    if k >= 1.0:
        return im
    return im.resize((max(1, round(w * k)), max(1, round(h * k))), Image.LANCZOS)


# ---- 2. 逐块重建 buffer（贴图按 --size 重编码）----
new_bin = bytearray()
new_bvs = []
for i, bv in enumerate(bvs):
    o = bv.get("byteOffset", 0)
    n = bv["byteLength"]
    if i == acc[prim["indices"]]["bufferView"]:
        data = idx16
    elif i in img_bv:
        # bufferView -> image 反查角色（color / normal）
        role = next((ROLE[k] for k, im in enumerate(gltf["images"]) if im["bufferView"] == i), "color")
        im = Image.open(io.BytesIO(binc[o:o + n])).convert("RGB")
        im2 = resized(im, size)
        data = encode(im2, role)
        print("  内嵌 %-6s %4dx%-4d -> %4dx%-4d   %6.0f KB -> %5.0f KB"
              % (role, im.size[0], im.size[1], im2.size[0], im2.size[1], n / 1024, len(data) / 1024))
    else:
        data = binc[o:o + n]
    while len(new_bin) % 4:
        new_bin.append(0)
    nb = {k: v for k, v in bv.items() if k not in ("byteOffset", "byteLength")}
    nb["byteOffset"] = len(new_bin)
    nb["byteLength"] = len(data)
    new_bvs.append(nb)
    new_bin.extend(data)

gltf["bufferViews"] = new_bvs
gltf["buffers"] = [{"byteLength": len(new_bin)}]
gltf["accessors"] = acc

js = json.dumps(gltf, separators=(",", ":")).encode()
while len(js) % 4:
    js += b" "
while len(new_bin) % 4:
    new_bin.append(0)

out = bytearray()
out += struct.pack("<III", 0x46546C67, 2, 12 + 8 + len(js) + 8 + len(new_bin))
out += struct.pack("<II", len(js), 0x4E4F534A) + js
out += struct.pack("<II", len(new_bin), 0x004E4942) + bytes(new_bin)

os.makedirs(os.path.dirname(os.path.abspath(dst)), exist_ok=True)
open(dst, "wb").write(out)

# ---- 3. 另出一套多分辨率贴图（运行期按画质档位换）----
os.makedirs(tex_dir, exist_ok=True)
saved = 0
for im_json in gltf["images"]:
    bv = bvs[im_json["bufferView"]]
    o, n = bv.get("byteOffset", 0), bv["byteLength"]
    role = next((ROLE[k] for k, x in enumerate(gltf["images"]) if x["bufferView"] == im_json["bufferView"]), "color")
    # ⚠️ 一定从**原图**（binc + 原 bvs 偏移）解码后再缩：new_bin 里已经是降过的了
    base = Image.open(io.BytesIO(binc[o:o + n])).convert("RGB")
    for n_target in sizes:
        im2 = resized(base, n_target)
        path = os.path.join(tex_dir, "%s-%d.jpg" % (role, n_target))
        data = encode(im2, role)
        open(path, "wb").write(data)
        saved += len(data)
        print("  贴图 %-6s %5d²  %5.0f KB  -> %s" % (role, n_target, len(data) / 1024, path))

print()
print("几何  %.0f KB" % (sum(orig_sizes[i] for i in range(len(bvs)) if i not in img_bv) / 1024))
print("索引  %.0f KB -> %.0f KB" % (orig_sizes[acc[prim["indices"]]["bufferView"]] / 1024, len(idx16) / 1024))
print("GLB   %s   %.2f MB" % (dst, len(out) / 1048576))
print("贴图  %s   %d 张  %.2f MB" % (tex_dir, len(sizes) * len(gltf["images"]), saved / 1048576))
