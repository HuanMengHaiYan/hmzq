import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import tableUrl from './assets/table-9ft.glb?url';
// 多分辨率贴图：GLB 里内嵌的是最小那档，高画质再按档位补更清晰的（见下）
import color512 from './assets/table-tex/color-512.jpg?url';
import color1024 from './assets/table-tex/color-1024.jpg?url';
import color2048 from './assets/table-tex/color-2048.jpg?url';
import normal512 from './assets/table-tex/normal-512.jpg?url';
import normal1024 from './assets/table-tex/normal-1024.jpg?url';
import normal2048 from './assets/table-tex/normal-2048.jpg?url';
import { TABLE } from './constants.js';
import { trackTexture, untrackTexture } from './textures.js';

/**
 * 真实台球桌模型（Tripo 生成的 GLB）
 * ------------------------------------------------------------------
 * 这个模块**只负责"把模型摆正、摆到该在的位置"**，不产生任何碰撞体。
 * 碰撞体仍然全部来自 layout.js 的纯数据（台布 / 库边 / 外框 / 喉口 / 传感器），
 * 由 table.js 的 buildTable({ hideVisual: true }) 建出来 —— 也就是说
 * **模型是纯装饰，物理和它一点关系都没有**。这正是需求里要的"模型不作碰撞体"。
 *
 * 为什么必须对齐"击球区"而不是"外框"：
 *   物理层的球是按 constants.js 的坐标放的（台面 2540×1270、半轴 1.27/0.635），
 *   库边碰撞面就在 ±0.635 / ±1.27 上。视觉上真正要紧的是**库边鼻子的位置**：
 *   只要模型的击球区（两库边鼻尖之间）和物理的 2540×1270 重合，球看起来就贴着
 *   视觉库边反弹；外框厚一点薄一点没人看得见（物理外框是藏在模型身体里的暗墙）。
 *
 * 模型的固有偏差（实测，见 docs/GLB-评估-tripo-v3.1.md）：
 *   外框 1550 × 2580 mm、击球区 1356 × 2404 mm（长宽比 1.773，真实 2.000）。
 *   所以**必须非均匀缩放**：长轴 ×1.057、短轴 ×0.937。差 11%，硬扛回 2:1 的话
 *   球会跑到台呢外面去，所以这 11% 只能吃下去（表现为桌腿截面略呈椭圆，肉眼不可见）。
 *
 * 贴图精度（0.8.0，跟着画质档位走）
 * ------------------------------------------------------------------
 * 源模型是两张 4096² 的 JPEG，GPU 展开后 RGB 每张约 67 MB —— 手机直接爆显存。
 * 这里做成"GLB 内嵌 256 的基线 + 512/1024/2048 三套外置贴图"，运行期按档位换：
 *
 *   档位     贴图   单张显存(含 mip)   两张合计   下来要下载
 *   低       512    1.4 MB             2.8 MB     260 KB
 *   中      1024    5.6 MB            11.2 MB     800 KB
 *   高      2048    22.3 MB           44.6 MB     2.2 MB
 *
 * 为什么内嵌的是最小那档：低画质只下载 GLB（0.72 MB）就够了；高画质再补两张 2048。
 * 比"每个档位各打一个 GLB"省掉三份重复几何（每份 0.77 MB）。
 * 换档位**不重建模型**，只换材质槽上的贴图 —— 不会闪、不会重新归一化。
 */

/**
 * 模型自身坐标系（Tripo 导出）：X = 短边、Z = 长边、Y 向上，原点在**地面中心**
 *
 * ⚠️ 这三个比例不是"看图纸填的"，是**实测反解**出来的，换模型必须重跑：
 *       python test/glb-measure.py src/assets/table-9ft.glb
 *    然后把输出里「库鼻到库鼻」「台呢面高度」的实测值除以外框包围盒尺寸。
 *
 * 旧版写的 1356/1550 与 753.4/803 是早期用「按宽度对齐 1550」的换算推的，
 * 结果击球区被缩成 2400 × 1200（比物理的 2540 × 1270 小 5.8%）、台呢面还高 4.1mm
 * —— 表现就是球在一圈看不见的"多出来的台呢"上滚动、球底嵌进台面 4mm。
 */
const MODEL = {
  clothW: 0.75894,          // 击球区宽 / 外框宽   （实测库鼻 223.28 / 294.2 模型单位）
  clothL: 0.87485,          // 击球区长 / 外框长   （实测库鼻 428.41 / 489.7 模型单位）
  // ⚠️ 这个必须写**绝对值**不能写成占总高的比例：几何修复（scripts/fix-table-glb.py）
  //    会删掉框顶那批悬空装饰块，模型总高跟着变矮，按比例算台呢面就会跑到 +12mm。
  clothY: 0.28746,          // 台呢面在模型原始坐标系里的高度（模型单位，不是米）
  longAxis: 'z',            // 模型的长边在哪个轴上（游戏的长边是 X）→ 需要转 90°
};

/** GLB 里内嵌的贴图边长（prepare-table-glb.py 的 --size） */
export const EMBEDDED_TEX_SIZE = 256;

/** 可选贴图档位（画质面板的“贴图精度”就用这四个值） */
export const TEX_SIZES = [256, 512, 1024, 2048];

/** 档位 → 两张外置贴图的地址（256 用 GLB 内嵌的，不在这里） */
const TEX_FILES = {
  512: { color: color512, normal: normal512 },
  1024: { color: color1024, normal: normal1024 },
  2048: { color: color2048, normal: normal2048 },
};

/** 贴图槽 → 用哪一组文件（材质上是 map / normalMap，文件是 color / normal） */
const SLOT_ROLE = { map: 'color', normalMap: 'normal' };

/** 加载状态：给调试面板 / 自检用（window.__hmzq.model） */
export const modelState = {
  status: 'idle',        // idle | loading | ready | failed | disabled
  url: tableUrl,
  error: null,
  size: null,            // 归一化后的外框尺寸（米）
  triangles: 0,
  texSize: 0,            // 当前实际生效的贴图边长（失败回落时为内嵌那档）
  texMs: 0,              // 换贴图耗时
};

/** 当前挂着的那一份模型的贴图槽绑定（同一时刻只有一张桌子） */
let bindings = [];
/** 换贴图用的小缓存：同一时刻只保留正在用的那一档，切走就释放 */
const texCache = new Map();

/** 把任意输入收拾成合法档位（未知值按 2048 走，也就是“没配就当高画质”） */
export function normalizeTexSize(n) {
  const v = Math.round(Number(n) || 0);
  return TEX_SIZES.includes(v) ? v : 2048;
}

/** 收集材质槽：map → color 图、normalMap → normal 图 */
function collectBindings(root) {
  const out = [];
  root.traverse((o) => {
    if (!o.isMesh || !o.material) return;
    for (const m of (Array.isArray(o.material) ? o.material : [o.material])) {
      for (const key of Object.keys(SLOT_ROLE)) {
        const tex = m[key];
        if (tex) out.push({ material: m, key, role: SLOT_ROLE[key], embedded: tex });
      }
    }
  });
  return out;
}

/**
 * 载入一张外置贴图，**继承 GLB 里那张贴图的全部采样设置**。
 * 这一步不能省：glTF 的 UV 原点在左上，所以 flipY 必须是 false；
 * baseColor 要 SRGB、normal 要线性。凭记忆写死迟早错一个。
 */
async function loadReplacement(url, ref, label) {
  const tex = await new THREE.TextureLoader().loadAsync(url);
  tex.flipY = ref.flipY;
  tex.colorSpace = ref.colorSpace;
  tex.wrapS = ref.wrapS;
  tex.wrapT = ref.wrapT;
  tex.magFilter = ref.magFilter;
  tex.minFilter = ref.minFilter;
  tex.generateMipmaps = ref.generateMipmaps;
  tex.name = label;
  trackTexture(tex);          // 纳入各向异性统一管理（画质设置里的“纹理细节”）
  tex.needsUpdate = true;     // 上面改过采样参数，必须重新上传
  return tex;
}

function disposeSlotSet(set) {
  for (const t of Object.values(set)) {
    untrackTexture(t);
    t.dispose();
  }
}

function assignRole(role, tex) {
  for (const b of bindings) {
    if (b.role !== role) continue;
    b.material[b.key] = tex;
  }
}

/**
 * 换成某一档贴图（运行期可直接调，不重建模型）。
 * @param size 256 / 512 / 1024 / 2048
 * @returns {Promise<number>} 实际生效的档位（加载失败时回落内嵌那档）
 */
export async function applyTextureSize(size) {
  const n = normalizeTexSize(size);
  // 没有模型（关闭 / 加载失败）时什么也不做 —— 别把 modelState 写成"已生效 256"
  if (!bindings.length) return modelState.texSize || EMBEDDED_TEX_SIZE;
  // 256 = GLB 里自带的那张，零成本
  if (n === EMBEDDED_TEX_SIZE) {
    for (const b of bindings) b.material[b.key] = b.embedded;
    for (const [k, set] of texCache) {
      if (k === n) continue;
      disposeSlotSet(set);
      texCache.delete(k);
    }
    modelState.texSize = n;
    return n;
  }

  const t0 = (globalThis.performance?.now?.() ?? 0);
  let set = texCache.get(n);
  if (!set) {
    const files = TEX_FILES[n];
    const refs = {};
    for (const role of new Set(bindings.map((b) => b.role))) {
      const ref = bindings.find((b) => b.role === role).embedded;
      refs[role] = ref;
    }
    try {
      const loaded = {};
      await Promise.all(Object.keys(refs).map(async (role) => {
        loaded[role] = await loadReplacement(files[role], refs[role], `table-${role}-${n}`);
      }));
      set = loaded;
      texCache.set(n, set);
      modelState.texMs = Math.round((globalThis.performance?.now?.() ?? 0) - t0);   // 只记真正解码的那次
    } catch (e) {
      // 贴图补不下来 → 保持现状（内嵌那档），游戏照常跑
      console.warn('[table-model] 贴图 ' + n + ' 加载失败，沿用当前贴图：' + (e?.message || e));
      modelState.texSize = EMBEDDED_TEX_SIZE;
      return modelState.texSize;
    }
  }

  for (const role of Object.keys(set)) assignRole(role, set[role]);

  // 只留正在用的这一档：换走的那套立刻释放显存（手机上这就是 40 MB）
  for (const [k, old] of texCache) {
    if (k === n) continue;
    disposeSlotSet(old);
    texCache.delete(k);
  }

  modelState.texSize = n;
  return n;
}

/**
 * 加载并把模型摆到与物理台面完全重合的位置。
 * @param parent 挂到哪个 Object3D 下（传 stage.scene）
 * @param opts.enabled  false 时直接返回 null（保留原来的参数化桌面）
 * @param opts.texSize  初始贴图档位（来自画质设置，默认 2048）
 * @returns {Promise<THREE.Group|null>} 失败/关闭时返回 null，调用方据此回落到方块桌面
 */
export async function mountTableModel(parent, opts = {}) {
  if (opts.enabled === false) {
    modelState.status = 'disabled';
    return null;
  }
  modelState.status = 'loading';
  const t0 = (globalThis.performance?.now?.() ?? 0);
  try {
    const gltf = await new GLTFLoader().loadAsync(tableUrl);
    const node = gltf.scene || gltf.scenes?.[0];
    if (!node) throw new Error('GLB 里没有场景');

    // ---------- 1. 量原始包围盒（模型自身坐标系）----------
    node.updateMatrixWorld(true);
    const box0 = new THREE.Box3().setFromObject(node);
    const d0 = box0.getSize(new THREE.Vector3());
    const c0 = box0.getCenter(new THREE.Vector3());

    // 长轴对齐：模型长边在 Z，游戏长边在 X → 绕 Y 转 +90°（R_y(90°): x' = z, z' = -x）
    // 只转 90° 的整数倍，所以"旋转 + 非均匀缩放"不会产生错切。
    if (MODEL.longAxis === 'z') node.rotation.y = Math.PI / 2;

    // ---------- 2. 非均匀缩放：把击球区对齐到 2540 × 1270 ----------
    const clothL = d0.z * MODEL.clothL;    // 模型长边（转完会落在游戏 X 上）
    const clothW = d0.x * MODEL.clothW;    // 模型短边（转完落在游戏 Z 上）
    const sx = (TABLE.halfL * 2) / clothL;
    const sz = (TABLE.halfW * 2) / clothW;
    // 高度没有物理参照（球不会碰到桌腿），取几何平均：既不显得压扁也不显得拔高。
    const sy = Math.sqrt(sx * sz);

    const root = new THREE.Group();
    root.name = 'table-model';
    root.add(node);
    root.scale.set(sx, sy, sz);
    root.updateMatrixWorld(true);

    // ---------- 3. 摆到 (0, 台呢面=0, 0) ----------
    // 旋转后的包围盒要用世界盒重新量（node 已挂在 root 上，但 root 还没缩放完）
    const box1 = new THREE.Box3().setFromObject(root);
    const c1 = box1.getCenter(new THREE.Vector3());
    root.position.set(-c1.x, -(box0.min.y + MODEL.clothY) * sy, -c1.z);
    root.updateMatrixWorld(true);

    // ---------- 4. 阴影 / 材质微调 ----------
    let tris = 0;
    node.traverse((o) => {
      if (!o.isMesh) return;
      o.castShadow = true;
      o.receiveShadow = true;
      o.frustumCulled = false;          // 单 mesh 覆盖整桌，包围球很大，视锥剔除只会帮倒忙
      const g = o.geometry;
      if (g) tris += (g.index ? g.index.count : g.attributes.position.count) / 3;
      for (const m of (Array.isArray(o.material) ? o.material : [o.material])) {
        if (!m) continue;
        // Tripo 导出一律 metal=0 / rough=0.5，于是六条银腿是哑光塑料色。
        // 单材质没法只给腿改金属度（UV 岛才能分），这里先给一个折中的值：
        // 抬高一点点金属度 + 收一点粗糙度，银件有金属感、木件也还不至于像金属。
        if (m.isMeshStandardMaterial) {
          m.metalness = 0.25;
          m.roughness = 0.42;
          m.envMapIntensity = 0.6;
          m.side = THREE.FrontSide;   // 原模型 doubleSided=true，渲染成本翻倍
          m.needsUpdate = true;
        }
      }
    });

    parent.add(root);

    // ---------- 5. 贴图档位（画质设置驱动，运行期可换）----------
    bindings = collectBindings(root);
    await applyTextureSize(opts.texSize ?? 2048);

    const box2 = new THREE.Box3().setFromObject(root);
    const d2 = box2.getSize(new THREE.Vector3());
    modelState.status = 'ready';
    modelState.size = { x: d2.x, y: d2.y, z: d2.z };
    modelState.bottom = box2.min.y;      // 桌脚落地点：stage.setFloorY() 用它把地面压到脚下
    modelState.ms = Math.round((globalThis.performance?.now?.() ?? 0) - t0);   // 解码+归一化耗时
    modelState.triangles = Math.round(tris);
    return root;
  } catch (e) {
    modelState.status = 'failed';
    modelState.error = e?.message || String(e);
    console.warn('[table-model] 模型加载失败，回落到参数化桌面：' + modelState.error);
    return null;
  }
}
