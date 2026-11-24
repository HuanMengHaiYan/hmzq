import { check } from '../lib/harness.mjs';
import { TABLE } from '../../src/constants.js';
import { orthoFrustum } from '../../src/stage.js';
import {
  QUALITY_ITEMS, DEFAULT_QUALITY, SHADOW_SIZE, DPR_CAP, ANISO_LEVEL,
  autoQuality, sanitizeQuality, resolveQuality, presetValue, describeQuality,
} from '../../src/quality.js';

/**
 * 画质设置 + 顶视视锥（纯逻辑，不需要浏览器）
 * ------------------------------------------------------------------
 * 守住两件容易被改坏的事：
 *   ① 画质档位/选项的映射（手机默认值必须真的降下来，桌面必须维持原观感）
 *   ② 顶视模式下"整张球台始终完整在屏内"这条硬要求（任何宽高比）
 * 真机帧率仍需红米 K30 实测，这里只管配置算得对不对。
 */

const vp = (w, h, dpr) => ({ w, h, dpr });

export function testQualityMapping() {
  console.log('\n[28] 画质设置：档位映射与设备默认');

  // Node 里没有触摸 → 走桌面分支：默认必须与改动前完全一致（2048² / 2× / 8×）
  const desktopAuto = autoQuality(false);
  check(desktopAuto.shadow === 'high' && desktopAuto.dpr === '2' && desktopAuto.aniso === 'high',
    '桌面「自动」= 2048² 阴影 + 200% 分辨率 + 8× 过滤（观感零变化）', JSON.stringify(desktopAuto));

  const phoneAuto = autoQuality(true);
  check(phoneAuto.shadow === 'mid' && phoneAuto.dpr === '1.25' && phoneAuto.aniso === 'mid',
    '手机「自动」= 1024² 阴影 + 125% 分辨率 + 4× 过滤（红米 K30 档）', JSON.stringify(phoneAuto));

  // 默认配置（auto）在 Node（非触摸）下解析出的具体值
  const d = resolveQuality(DEFAULT_QUALITY);
  check(d.shadowSize === 2048 && d.dprCap === 2 && d.anisoLevel === 8,
    '默认配置（自动）在桌面解析成 2048² / 2× / 8×',
    `阴影 ${d.shadowSize} dpr ${d.dprCap} aniso ${d.anisoLevel}`);

  // 三个档位：每一档都要同时定下三项（这是"把三个细分项收进档位"的核心）
  const low = resolveQuality({ preset: 'low' });
  check(low.shadowSize === 0 && low.dprCap === 1 && low.anisoLevel === 1,
    '「低」= 关阴影 + 100% 分辨率 + 1× 过滤', `阴影 ${low.shadowSize} dpr ${low.dprCap} aniso ${low.anisoLevel}`);
  const mid = resolveQuality({ preset: 'mid' });
  check(mid.shadowSize === 1024 && mid.dprCap === 1.25 && mid.anisoLevel === 4,
    '「中」= 1024² + 125% + 4×', `阴影 ${mid.shadowSize} dpr ${mid.dprCap} aniso ${mid.anisoLevel}`);
  const high = resolveQuality({ preset: 'high' });
  check(high.shadowSize === 2048 && high.dprCap === 2 && high.anisoLevel === 8,
    '「高」= 2048² + 200% + 8×');
  check(low.shadowSize !== high.shadowSize && low.dprCap !== high.dprCap && low.anisoLevel !== high.anisoLevel,
    '三档确实同时改掉了阴影 / 分辨率 / 纹理三项（不是只改一项）');

  // 「自定义」= 用存下来的三项，不再看档位表
  const fine = resolveQuality({ preset: 'custom', shadow: 'off', dpr: '1', aniso: 'low' });
  check(fine.shadowSize === 0 && fine.dprCap === 1 && fine.anisoLevel === 1,
    '「自定义」按存下来的三项走（关阴影 + 100% + 1×）',
    `阴影 ${fine.shadowSize} dpr ${fine.dprCap} aniso ${fine.anisoLevel}`);
  const fine2 = resolveQuality({ preset: 'custom', shadow: 'mid', dpr: '1.5', aniso: 'high' });
  check(fine2.shadowSize === 1024 && fine2.dprCap === 1.5 && fine2.anisoLevel === 8,
    '「自定义」三项互不干扰（阴影中 + 150% + 8× 可以混搭）');
  // 老存档只有 preset:'custom'、没存三项 → 按设备默认起一套（Node = 桌面）
  const bareCustom = resolveQuality({ preset: 'custom' });
  check(bareCustom.shadowSize === 2048 && bareCustom.dprCap === 2 && bareCustom.anisoLevel === 8,
    '只写了 custom 没写三项 → 按设备默认补齐（不会解析出 undefined）',
    `阴影 ${bareCustom.shadowSize} dpr ${bareCustom.dprCap} aniso ${bareCustom.anisoLevel}`);

  // sanitize：垃圾值一律回落（档位回落 auto、三项回落设备默认），不产生 NaN
  const dirty = sanitizeQuality({ preset: 'nope', shadow: 999, dpr: 'NaN', aniso: null, extra: 1 });
  check(dirty.preset === 'auto' && dirty.shadow === 'high' && dirty.dpr === '2' && dirty.aniso === 'high'
    && dirty.extra === undefined,
    '非法值全部回落（档位→auto、三项→桌面默认），多余字段不保留', JSON.stringify(dirty));
  check(sanitizeQuality({}).preset === 'auto' && sanitizeQuality(null).preset === 'auto',
    '空配置 / null 都是 auto（不抛异常）');

  // 老存储迁移：升级前存的是 自动/流畅/均衡/高清 + 三项单项微调
  const legacy = (v) => sanitizeQuality({ preset: v }).preset;
  check(legacy('smooth') === 'low' && legacy('balanced') === 'mid' && legacy('fancy') === 'high',
    '老档位迁移：流畅→低 / 均衡→中 / 高清→高');
  check(legacy('custom') === 'custom',
    '「自定义」现在是合法档位（细分项回归），不再被迁移掉');
  const oldCustom = sanitizeQuality({ preset: 'custom', shadow: 'off', dpr: '1', aniso: 'low' });
  check(oldCustom.preset === 'custom' && oldCustom.shadow === 'off' && oldCustom.dpr === '1' && oldCustom.aniso === 'low',
    '带三项的旧 custom 记录：原样读回来（不是被清掉）', JSON.stringify(oldCustom));

  // 选项表与 sanitize 必须一一对应：表里有的选项一定能存下来（防"加了选项却没放行"）
  let roundTrip = true;
  for (const item of QUALITY_ITEMS) {
    for (const opt of item.options) {
      const back = sanitizeQuality({ [item.id]: opt.id })[item.id];
      if (back !== opt.id) { roundTrip = false; console.log(`    ↳ ${item.id}=${opt.id} 存不下来`); }
      if (!item.hints[opt.id]) { roundTrip = false; console.log(`    ↳ ${item.id}=${opt.id} 缺 hint`); }
    }
  }
  check(roundTrip, '每个选项都能存下来且有说明文案', `${QUALITY_ITEMS.length} 个画质项`);
  // 面板结构：一行档位 + 四行"自定义专属"的细分项（customOnly 的那几行平时藏起来）
  check(QUALITY_ITEMS.map((i) => i.id).join(',') === 'preset,shadow,dpr,tex,aniso',
    '画质 = 档位 + 阴影 / 分辨率 / 贴图 / 纹理四项', QUALITY_ITEMS.map((i) => i.id).join(','));
  check(QUALITY_ITEMS.filter((i) => i.customOnly).map((i) => i.id).join(',') === 'shadow,dpr,tex,aniso',
    '阴影 / 分辨率 / 贴图 / 纹理 四项标了 customOnly（面板据此只在「自定义」时展开）');
  // 贴图档位：0.8.0 的真实模型贴图跟着档位走（256 是内嵌基线，只在自定义里给）
  check(resolveQuality({ preset: 'low' }).texSize === 512
    && resolveQuality({ preset: 'mid' }).texSize === 1024
    && resolveQuality({ preset: 'high' }).texSize === 2048,
    '贴图精度随档位：低 512 / 中 1024 / 高 2048');
  check(resolveQuality({ preset: 'custom', tex: '256' }).texSize === 256
    && resolveQuality({ preset: 'custom', tex: '4096' }).texSize === 2048,
    '自定义贴图档位：256 可选中、非法值回落到 2048');
  check(QUALITY_ITEMS[0].options.map((o) => o.id).join(',') === 'auto,low,mid,high,custom',
    '档位五选：自动 / 低 / 中 / 高 / 自定义',
    QUALITY_ITEMS[0].options.map((o) => o.name).join(' / '));
  check(presetValue('mid', 'dpr') === '1.25' && presetValue('auto', 'dpr') === null,
    'presetValue：档位取值可查，auto 返回 null（表示按设备）');
  check(SHADOW_SIZE.off === 0 && DPR_CAP['1.25'] === 1.25 && ANISO_LEVEL.mid === 4, '数值表与档位映射对齐');

  // 「当前生效」那行：K30 横屏 873×393 CSS，dpr 1.25 → 1091×491
  const text = describeQuality(resolveQuality({ preset: 'mid' }), vp(873, 393, 2.75));
  check(/阴影 1024²/.test(text) && /1091×491/.test(text) && /贴图 1024²/.test(text) && /各向异性 4×/.test(text),
    'K30 横屏「中」档读数 = 1091×491 像素 + 贴图 1024²', text);
  const text2 = describeQuality(resolveQuality({ preset: 'low' }), vp(873, 393, 2.75));
  check(/阴影 关/.test(text2) && /873×393/.test(text2),
    '「低」档就是原分辨率（dpr 1）', text2);
}

export function testOrthoCoverage() {
  console.log('\n[29] 顶视：任何宽高比下整张球台都在屏内');

  const needLong = TABLE.outerHalfL;       // 含库边 + 木框的长半轴（世界 X）
  const needShort = TABLE.outerHalfW;      // 短半轴（世界 Z）
  check(needLong > TABLE.halfL && needShort > TABLE.halfW,
    '外框比台面大（按外框算才不会裁掉木框）',
    `台面 ${TABLE.halfL}/${TABLE.halfW} → 外框 ${needLong.toFixed(3)}/${needShort.toFixed(3)}`);

  // 盘面在视锥里实际占了多少面积（横屏：halfW=X、halfH=Z；竖屏转过 90°：halfW=Z、halfH=X）
  const coverArea = (f) => {
    const worldX = f.portrait ? 2 * f.halfH : 2 * f.halfW;
    const worldZ = f.portrait ? 2 * f.halfW : 2 * f.halfH;
    return (2 * needLong * 2 * needShort) / (worldX * worldZ);
  };

  const cases = [
    ['超宽屏 21:9', 21 / 9], ['桌面 16:9', 16 / 9], ['Surface 3:2', 1.5],
    ['方形 1:1', 1], ['竖屏手机 393×873', 393 / 873], ['极窄 9:21', 9 / 21],
    ['窄到 0.35', 0.35], ['宽到 3.5', 3.5],
  ];
  for (const [name, a] of cases) {
    const f = orthoFrustum(a);
    // 转过 90° 后两个轴的角色互换，按 f.portrait 取对应关系来判"台子是否在屏内"
    const coverW = f.portrait ? f.halfW - needShort : f.halfW - needLong;
    const coverH = f.portrait ? f.halfH - needLong : f.halfH - needShort;
    check(coverW > 0 && coverH > 0, `${name}：整张台在屏内`,
      `余量 横 ${coverW.toFixed(2)}m / 纵 ${coverH.toFixed(2)}m`);
    check(f.portrait === (a < 1), `${name}：竖屏判定与宽高比一致`, `portrait=${f.portrait}`);
  }
  // 除边距（0.35m）外不该再有多余空白被浪费太多：最短边贴边距即可
  const tight = orthoFrustum(16 / 9);
  check(Math.abs(tight.halfH - (needShort + 0.35)) < 1e-9,
    '横屏：最短边方向恰好留出 TOP.margin（不白留空）', `halfH=${tight.halfH.toFixed(3)}`);

  // 竖屏：整个视野转 90°，长边交给屏幕的长边 —— 台子占屏面积必须比"不转"大得多
  const a = 393 / 873;
  const portrait = orthoFrustum(a);
  check(portrait.portrait === true, '竖屏时视锥转过 90°（stage 会同步相机 up 轴）');
  check(Math.abs(portrait.halfW - (needShort + 0.35)) < 1e-6,
    '竖屏：横向贴边距（短边方向不白留空）', `halfW=${portrait.halfW.toFixed(3)}`);
  check(portrait.halfH + 1e-9 >= needLong + 0.35, '竖屏：竖直方向撑住台长（长边顺着屏幕长边）',
    `halfH=${portrait.halfH.toFixed(3)}`);
  const oldHalfH = Math.max(needShort + 0.35, (needLong + 0.35) / a);   // 对照：旧算法（横着放长边）
  const oldArea = (2 * needLong * 2 * needShort) / ((oldHalfH * a * 2) * (oldHalfH * 2));
  const newArea = coverArea(portrait);
  check(newArea > oldArea * 2, '竖屏转 90° 后台子占屏面积至少翻倍（老算法只占 ' +
    (oldArea * 100).toFixed(0) + '% → 新 ' + (newArea * 100).toFixed(0) + '%）');

  // 异常宽高比不能算出 NaN（会让相机整个崩掉）
  for (const bad of [0, -1, NaN, Infinity]) {
    const f = orthoFrustum(bad);
    check(Number.isFinite(f.halfW) && Number.isFinite(f.halfH) && f.halfW > 0 && f.halfH > 0,
      `异常宽高比 ${bad} 有安全回落`, `${f.halfW.toFixed(2)} × ${f.halfH.toFixed(2)}`);
  }
}
