/**
 * 画质设置（渲染侧的性能开关）
 * ------------------------------------------------------------------
 * 面板上是**一档 + 四个细分项**：画质档位（自动 / 低 / 中 / 高 / 自定义），
 * 只有选了「自定义」才展开阴影精度 / 渲染分辨率 / 贴图精度 / 纹理细节四项。
 *
 * 为什么默认不展开四项（2026-09-20 改，2026-11-13 加第四项）：手机的渲染预算和
 * 台式机差一个数量级（本次的兼容下限是红米 K30 一档的骁龙 730G / Adreno 618），
 * 真正贵的就这几件事 ——
 *   ① 阴影贴图：2048² × 2 盏灯 = 每帧 839 万像素的重绘（世界静止时也在画）
 *   ② 像素总数：devicePixelRatio 2 意味着一帧要着色 4 倍于 CSS 像素的点
 *   ③ 各向异性过滤：8× 的采样成本明显高于 1×
 *   ④ 桌面贴图：0.8.0 换成真实模型后，2048² 两张要占 45 MB 显存，512² 只要 2.8 MB
 * 这几项是同一个"像素/显存预算"的几个旋钮，分开摆只会让人来回试错，
 * 所以先给四个档位让人一次选完；真要抠细节再进「自定义」。
 * 档位下那行「当前：阴影 …·渲染…·贴图…·各向异性…」始终如实显示实际取值（方便真机上报）。
 *
 * 切档位会把各项一起刷成该档的值 —— 之后再进「自定义」是从这一档起步微调，
 * 不会回到出厂默认。改动任一细分项 → 档位自动落到「自定义」。
 *
 * 连同"阴影按需刷新"一起，全部共用 hmzq.quality.v1 这一个存储键。
 *
 * ⚠️ 默认值 / 档位映射在 public/launcher-quality.js 里有一份镜像
 *    （启动器是 public/ 下的经典脚本，不能 import 这里），改一边必须同步另一边。
 */
import { host } from './platform/index.js';
import { applyAnisotropy } from './textures.js';

const KEY = 'hmzq.quality.v1';

/** 阴影贴图边长（0 = 关掉阴影，静物没有任何投影） */
export const SHADOW_SIZE = { off: 0, low: 512, mid: 1024, high: 2048 };

/** 渲染分辨率上限：每个 CSS 像素最多渲染几个物理像素（键即 UI 上的选项 id） */
export const DPR_CAP = { 1: 1, 1.25: 1.25, 1.5: 1.5, 2: 2 };

/** 纹理各向异性过滤级别 */
export const ANISO_LEVEL = { low: 1, mid: 4, high: 8 };

/**
 * 台球桌贴图边长（0.8.0）。
 * 模型是单 mesh 双贴图（baseColor + normal），显存随边长平方涨：
 *   512 → 两张合计 2.8 MB、1024 → 11.2 MB、2048 → 44.6 MB（都含 mip）。
 * 256 是 GLB 内嵌的基线（不用额外下载），只在「自定义」里给人选。
 */
export const TEX_EDGE = [256, 512, 1024, 2048];
export const TEX_IDS = TEX_EDGE.map(String);

/**
 * 选项表：游戏内设置面板与启动器面板都由它驱动（启动器那份是镜像）。
 * `customOnly: true` 的三行只在档位 = 自定义 时露出来（其余档位整行隐藏），
 * 面板按这个标记自动显隐，加新项只要往表里加一行，HTML 与 CSS 都不用动。
 */
export const QUALITY_ITEMS = [
  {
    id: 'preset',
    name: '画质档位',
    hints: {
      auto: '按设备挑一档：手机偏保守（中）、桌面放开（高）。下面那行会显示实际取值。',
      low: '关阴影 + 原分辨率 + 512 贴图 + 最低纹理过滤：最省电，适合老机型或发烫时用。',
      mid: '阴影 1024 + 125% 分辨率 + 1024 贴图 + 4× 过滤：手机上推荐，观感与性能的平衡点。',
      high: '阴影 2048 + 200% 分辨率 + 2048 贴图 + 8× 过滤：桌面观感最好，手机上偏烫。',
      custom: '自己定下面四项：阴影精度 / 渲染分辨率 / 贴图精度 / 纹理细节。改任意一项都会落到这里。',
    },
    options: [
      { id: 'auto', name: '自动' },
      { id: 'low', name: '低' },
      { id: 'mid', name: '中' },
      { id: 'high', name: '高' },
      { id: 'custom', name: '自定义' },
    ],
  },
  {
    id: 'shadow', name: '阴影精度', customOnly: true,
    hints: {
      off: '关掉阴影：最省，但球和杆没有投影，立体感弱一些。',
      low: '512² 阴影：能看到投影，边缘略糊。',
      mid: '1024² 阴影：手机上推荐的平衡点。',
      high: '2048² 阴影：边缘最干净，代价是每帧多画 4 倍阴影像素。',
    },
    options: [
      { id: 'off', name: '关' },
      { id: 'low', name: '512' },
      { id: 'mid', name: '1024' },
      { id: 'high', name: '2048' },
    ],
  },
  {
    id: 'dpr', name: '渲染分辨率', customOnly: true,
    hints: {
      1: '100%：一个 CSS 像素渲染一个物理像素，最省。',
      1.25: '125%：略微超采样，锯齿更少。',
      1.5: '150%：明显更清晰，开销约为 100% 的 2.25 倍。',
      2: '200%：最锐利，开销约为 100% 的 4 倍。',
    },
    options: [
      { id: '1', name: '100%' },
      { id: '1.25', name: '125%' },
      { id: '1.5', name: '150%' },
      { id: '2', name: '200%' },
    ],
  },
  {
    id: 'tex', name: '贴图精度', customOnly: true,
    hints: {
      256: '256²：几乎不占显存（两张 1 MB），近看台呢和木纹会糊，只在内存极紧张时用。',
      512: '512²：显存约 3 MB，远景够用，凑近看木纹偏模糊 —— 低档位默认。',
      1024: '1024²：显存约 11 MB，桌面与手机都清楚的平衡点 —— 中档位默认。',
      2048: '2048²：显存约 45 MB，木纹与台呢最细腻 —— 高档位默认，老机型慎用。',
    },
    options: [
      { id: '256', name: '256' },
      { id: '512', name: '512' },
      { id: '1024', name: '1024' },
      { id: '2048', name: '2048' },
    ],
  },
  {
    id: 'aniso', name: '纹理细节', customOnly: true,
    hints: {
      low: '1×：不过滤，斜着看台布会有糊斑。',
      mid: '4×：够用，斜视观感明显改善。',
      high: '8×：最清晰，采样成本最高。',
    },
    options: [
      { id: 'low', name: '1×' },
      { id: 'mid', name: '4×' },
      { id: 'high', name: '8×' },
    ],
  },
];

export const DEFAULT_QUALITY = { preset: 'auto' };

/** preset 的合法值 */
export const PRESET_IDS = ['auto', 'low', 'mid', 'high', 'custom'];

/** 三个细分项各自的合法值（sanitize 用） */
export const SHADOW_IDS = Object.keys(SHADOW_SIZE);
export const DPR_IDS = Object.keys(DPR_CAP);
export const ANISO_IDS = Object.keys(ANISO_LEVEL);

/** 档位 → 各项具体值（auto 不在这里，走设备默认） */
const PRESETS = {
  low: { shadow: 'off', dpr: '1', aniso: 'low', tex: '512' },
  mid: { shadow: 'mid', dpr: '1.25', aniso: 'mid', tex: '1024' },
  high: { shadow: 'high', dpr: '2', aniso: 'high', tex: '2048' },
};

/**
 * 老档位 id → 新档位 id。
 * 2026-09-20 之前面板上是「自动 / 流畅 / 均衡 / 高清」（三个单项微调会落到 custom）。
 * custom 现在重新合法了（细分项回来了），所以只迁移前三个老名字，
 * 免得老用户升级后画质莫名其妙卡在某个写死的水平上。
 */
const LEGACY_PRESET = { smooth: 'low', balanced: 'mid', fancy: 'high' };

/**
 * 「自动」按设备给默认值：
 *   触摸设备（手机 / 平板）—— 阴影减半 + 1.25× 分辨率 + 4× 过滤，画质几乎看不出，
 *     但像素量与阴影开销都降到桌面档的三分之一以下（见 docs/perf-android.md）。
 *   桌面 / Electron —— 保持原来的观感（2048² + 2× + 8×），零变化。
 */
export function autoQuality(touch = !!host.touch) {
  return touch
    ? { shadow: 'mid', dpr: '1.25', aniso: 'mid', tex: '1024' }
    : { shadow: 'high', dpr: '2', aniso: 'high', tex: '2048' };
}

/**
 * 收拾成合法配置（未知值一律回落 auto；老档位 id 迁移到新档位）。
 * 四项细分值**什么时候都留着**：这样从「自定义」切走再切回来，上次调的四项还在。
 * 没有值（老存档 / 第一次进自定义）就按设备默认起一套。
 */
export function sanitizeQuality(raw) {
  const o = (raw && typeof raw === 'object') ? raw : {};
  const v = String(o.preset ?? '');
  const preset = PRESET_IDS.includes(v) ? v : (LEGACY_PRESET[v] || DEFAULT_QUALITY.preset);
  const d = autoQuality();
  const pick = (val, ids, fb) => (ids.includes(String(val)) ? String(val) : fb);
  return {
    preset,
    shadow: pick(o.shadow, SHADOW_IDS, d.shadow),
    dpr: pick(o.dpr, DPR_IDS, d.dpr),
    tex: pick(o.tex, TEX_IDS, d.tex),
    aniso: pick(o.aniso, ANISO_IDS, d.aniso),
  };
}

/** 配置 → 可直接喂给渲染器的具体数值（auto → 按设备挑的那一档；custom → 用存的四项） */
export function resolveQuality(raw) {
  const q = sanitizeQuality(raw);
  // ⚠️ 别写成 `q.preset === 'custom' ? q : PRESETS[q.preset]`：
  //    q 里还带着 preset 字段，直接喂下去 shadowSize 会拿到字符串。
  const { shadow, dpr, aniso, tex } = q.preset === 'custom'
    ? { shadow: q.shadow, dpr: q.dpr, aniso: q.aniso, tex: q.tex }
    : (PRESETS[q.preset] || autoQuality());
  return {
    preset: q.preset,
    shadow, dpr, aniso, tex,
    shadowSize: SHADOW_SIZE[shadow] ?? 0,
    dprCap: DPR_CAP[dpr] ?? 2,
    anisoLevel: ANISO_LEVEL[aniso] ?? 4,
    texSize: Number(tex) || 2048,
  };
}

export function loadQuality() {
  return sanitizeQuality(host.storage?.get(KEY, null));
}

/** 四个"自定义专属"的细分项（改任一项都会把档位落成 custom） */
export const FINE_ITEMS = ['shadow', 'dpr', 'tex', 'aniso'];

/** 某个档位对某一项的具体取值（auto / custom → null，表示"按设备挑 / 用户自己定的"） */
export function presetValue(presetId, itemId) {
  const p = PRESETS[presetId];
  return p ? (p[itemId] ?? null) : null;
}

export function saveQuality(q) {
  const s = sanitizeQuality(q);
  try { host.storage?.set(KEY, s); } catch { /* 无存储也能玩 */ }
  return s;
}

/** 一行"当前真的在用什么"的说明（设置面板显示，也方便真机上报数据） */
export function describeQuality(q = resolveQuality(loadQuality()), vp = host.viewport()) {
  const pr = Math.min(vp.dpr || 1, q.dprCap);
  return `当前：阴影 ${q.shadowSize ? `${q.shadowSize}²` : '关'}`
    + ` · 渲染 ${Math.round(vp.w * pr)}×${Math.round(vp.h * pr)}`
    + ` · 贴图 ${q.texSize}²`
    + ` · 各向异性 ${q.anisoLevel}×`;
}

/**
 * 画质管理器：改设置 → 立刻作用到渲染器（无需重启、无需重进）。
 * 只管渲染，不碰玩法与 DOM；设置面板的 DOM 在 quality-ui.js。
 */
export class Quality {
  /**
   * @param stage Stage 实例
   * @param hooks.onTextureSize 换模型贴图档位的回调（main.js 接到 table-model.js）
   */
  constructor(stage, hooks = {}) {
    this.stage = stage;
    this.onTextureSize = hooks.onTextureSize || null;
    this.prefs = loadQuality();
  }

  /** 当前生效的具体数值 */
  get resolved() { return resolveQuality(this.prefs); }

  /** 改一项或几项：落盘 + 立刻生效 */
  set(patch) {
    const next = Object.assign({}, this.prefs, patch);
    const fine = FINE_ITEMS.some((k) => patch[k] != null);
    if (fine) next.preset = 'custom';                 // 动细分项 = 自定义
    else if (patch.preset && patch.preset !== 'custom') {
      // 换档位：各项一起刷成这一档的值 —— 之后进「自定义」是从这一档起步微调，
      // 而不是跳回出厂默认（否则"高 → 自定义"看到的是中档的值，很费解）
      Object.assign(next, PRESETS[patch.preset] || autoQuality());
    }
    this.prefs = saveQuality(next);
    this.apply();
    return this.prefs;
  }

  apply() {
    const r = this.stage.renderer;
    const q = this.resolved;
    const vp = host.viewport();

    // ① 阴影贴图：改尺寸要把旧的 renderTarget 丢掉，three 才会按新边长重建
    // ⚠️ 关阴影时把 light.castShadow 一起关掉（不是可选项）：只置
    //    renderer.shadowMap.enabled = false、灯的 castShadow 仍为 true 的话，
    //    three 会往 uniform 里塞一个 **null 的 shadowMap** 却照样走 shadow 分支，
    //    采样空纹理的结果取决于驱动（GLES 上常见是恒 0 → 只剩环境光 → 整场发黑）。
    //    2026-11-13 在无头 Chrome 里确实见过一次「切到低档整场变黑」，但按同一路径
    //    没能稳定复现，所以这条按**防御**处理，不宣称修掉了某个必现现象。
    const shadowsOn = q.shadowSize > 0;
    r.shadowMap.enabled = shadowsOn;
    for (const light of this.stage.shadowLights) {
      const s = light.shadow;
      if (!s) continue;
      light.castShadow = shadowsOn;
      if (!shadowsOn) continue;
      if (s.mapSize.width === q.shadowSize) continue;
      s.mapSize.set(q.shadowSize, q.shadowSize);
      s.map?.dispose();
      s.map = null;      // 置空 → three 下一帧按新 mapSize 重建
    }

    // ② 像素比：先改 ratio 再 setSize（setSize 会按 ratio 重算 drawingBuffer）
    r.setPixelRatio(Math.min(vp.dpr || 1, q.dprCap));
    this.stage.resize();

    // ③ 模型贴图档位：只换贴图、不重建模型。
    //    必须在 applyAnisotropy **之前**发起 —— 新贴图是异步建的，建的时候会读
    //    textures.js 里的当前级别，这样一步到位；反过来则会先用旧级别上传一次。
    if (this.onTextureSize) this.onTextureSize(q.texSize);

    // ④ 纹理过滤
    applyAnisotropy(q.anisoLevel, r.capabilities?.getMaxAnisotropy?.() || 8);

    // ⑤ 阴影按需刷新：世界静止时不重画（球在动 / 杆在动时由 updateShadows 打开）
    this.stage.setOnDemandShadows(true);
    return q;
  }
}
