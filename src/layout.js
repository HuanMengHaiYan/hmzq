/**
 * 球桌布局（纯数据，不依赖 Three.js）
 * 渲染层（table.js）与无头物理测试（test/headless.mjs）共用同一份几何定义，
 * 保证"看到的"和"测到的"完全一致。
 *
 * kind:  cloth | cushion | wood | tray   → 渲染层据此选材质
 * phys:  clothSurface | cushion | rail | tray | null(纯装饰)
 */
import { BALL_R, TABLE, POCKETS, RACK } from './constants.js';
import { getBallSet, DEFAULT_BALL_SET } from './rules.js';

export const HEAD_SPOT = { x: -TABLE.halfL / 2, z: 0 };   // 白球开球点
export const FOOT_SPOT = { x: TABLE.halfL / 2, z: 0 };    // 正式脚点（三角顶点理论位置）

/** 白球摆放（自由球模式）的两条安全边界 */
export const CUE_PLACE = {
  edgeGap: BALL_R,                                  // 球心离库边内沿至少留一个球半径
  // 球心离袋口中心至少这么远。按**最大的**那个喉口（中袋）算 —— 用角袋的半径会让
  // 白球能摆到中袋口上方，松手就自己掉进去（0.7.0 袋口放大后这条更明显）。
  pocketGap: TABLE.pocketThroatMid + BALL_R * 1.6,
};

/**
 * 把"玩家想把白球摆到哪"收进合法范围里（自由球模式拖动白球时每个 move 都过一遍）。
 * ------------------------------------------------------------------
 * 两条限制缺一不可：
 *   ① 球心必须在库边内沿以内、且留出一个球半径 —— 否则拖着拖着就嵌进库边里；
 *   ② 不能落在袋口上方：喉口是个真洞（见 POCKET_THROAT），球心进洞就会掉下去。
 *      没有这一条时，玩家把白球拖到袋口正上方、手指一松，球就自己落袋了。
 * 落在袋口圆内时沿径向把点推出来；角袋处"推出"会顶到矩形边界，所以推完再夹一次，
 * 迭代几轮让它收敛（袋口与库边夹角那块本来就放不下球，收敛到边界上是正确结果）。
 *
 * @returns {{x, z, moved}} moved = 传入的点是否被挪动过（可以据此提示"这里放不了"）
 */
export function clampCuePlace(x, z, opt = {}) {
  const edgeGap = opt.edgeGap ?? CUE_PLACE.edgeGap;
  const pocketGap = opt.pocketGap ?? CUE_PLACE.pocketGap;
  const limX = TABLE.halfL - edgeGap;
  const limZ = TABLE.halfW - edgeGap;
  const srcX = Number(x) || 0;
  const srcZ = Number(z) || 0;
  let px = Math.min(limX, Math.max(-limX, srcX));
  let pz = Math.min(limZ, Math.max(-limZ, srcZ));

  for (let i = 0; i < 4; i++) {
    let hit = false;
    for (const p of POCKETS) {
      const dx = px - p.x;
      const dz = pz - p.z;
      const d = Math.hypot(dx, dz);
      if (d >= pocketGap) continue;
      hit = true;
      if (d < 1e-6) { px = p.x; pz = p.z - pocketGap; }        // 正好落在袋心：往 -Z 推
      else { px = p.x + (dx / d) * pocketGap; pz = p.z + (dz / d) * pocketGap; }
    }
    px = Math.min(limX, Math.max(-limX, px));
    pz = Math.min(limZ, Math.max(-limZ, pz));
    if (!hit) break;
  }
  return { x: px, z: pz, moved: Math.abs(px - srcX) > 1e-9 || Math.abs(pz - srcZ) > 1e-9 };
}

/**
 * 三角摆球顶点实际位置 = 脚点 + RACK.shiftX。
 * shiftX 是"整堆球前后平移"的唯一旋钮：+X 往脚区推、-X 往头区收。
 * 之所以不直接改 FOOT_SPOT，是因为脚点是球台本身的标准刻度，摆球偏移属于玩法调参。
 * @param shiftX 不传则用 constants.js 里的 RACK.shiftX
 */
export function rackApex(shiftX = RACK.shiftX) {
  return { x: FOOT_SPOT.x + shiftX, z: 0 };
}

/**
 * 全部方块定义。
 * @param opts.railHalfL/railHalfW 外框碰撞围墙的**外沿**（米）。默认按参数化桌面算
 *        （台面 + 库边 + 9cm 木框）；换成真实模型时要传**模型外框的实际外沿**，
 *        否则球飞出台面会先撞在一圈比视觉木框还小的隐形墙上 —— 看起来就是
 *        "球钻进木头里又弹回来"。
 */
export function tableBoxes(opts = {}) {
  const {
    halfL, halfW, cloth, pocketGapMid: gMid, pocketCut: cut,
    cushionH, cushionW, railW, railH,
    outerHalfL, outerHalfW, apronDrop, trayY, legH,
  } = TABLE;

  // 外框围墙：外沿 / 内沿之间就是这个 box 的厚度
  const railOutL = opts.railHalfL ?? (halfL + cushionW + railW);
  const railOutW = opts.railHalfW ?? (halfW + cushionW + railW);
  const railInL = halfL + cushionW;
  const railInW = halfW + cushionW;
  const railThickX = Math.max(0.01, railOutL - railInL);   // 短边围墙的厚度（沿 X）
  const railThickZ = Math.max(0.01, railOutW - railInW);   // 长边围墙的厚度（沿 Z）

  const boxes = [];
  const push = (o) => boxes.push({ visible: true, castShadow: false, phys: null, ...o });

  // 台布一直铺到库边外沿（= 木框内沿），袋口才有"贴台边"的开口空间
  const exL = halfL + cushionW;    // 台布 X 外沿
  const exW = halfW + cushionW;    // 台布 Z 外沿
  const inL = halfL - cut;         // 袋口向内延伸到的位置（角袋）
  const inW = halfW - cut;
  const surfaceY = -cloth / 2;

  // ---- 1) 台布：中间整条 + 上下各两段，让出 6 个袋口 ----
  push({
    id: 'cloth-center', kind: 'cloth', phys: 'clothSurface',
    size: [exL * 2, cloth, inW * 2],
    pos: [0, surfaceY, 0],
  });
  const stripLenX = inL - gMid;              // 单侧长条台布长度
  const stripCx = (gMid + inL) / 2;          // 其中心 X
  const stripW = exW - inW;                  // 长条宽度（含库边底下那一截）
  const stripCz = (inW + exW) / 2;           // 其中心 Z
  for (const zs of [1, -1]) {
    for (const xs of [1, -1]) {
      push({
        id: `cloth-edge-${xs}-${zs}`, kind: 'cloth', phys: 'clothSurface',
        size: [stripLenX, cloth, stripW],
        pos: [xs * stripCx, surfaceY, zs * stripCz],
      });
    }
  }

  // ---- 2) 橡胶库边（袋口处断开；长度与台布长条完全对齐）----
  for (const zs of [1, -1]) {
    for (const xs of [1, -1]) {
      push({
        id: `cushion-long-${xs}-${zs}`, kind: 'cushion', phys: 'cushion', castShadow: true,
        size: [stripLenX, cushionH, cushionW],
        pos: [xs * stripCx, cushionH / 2, zs * (halfW + cushionW / 2)],
      });
    }
  }
  for (const xs of [1, -1]) {
    push({
      id: `cushion-short-${xs}`, kind: 'cushion', phys: 'cushion', castShadow: true,
      size: [cushionW, cushionH, inW * 2],
      pos: [xs * (halfL + cushionW / 2), cushionH / 2, 0],
    });
  }

  // ---- 3) 木质外框（闭合一圈，兼作防飞出围墙）----
  for (const zs of [1, -1]) {
    push({
      id: `rail-long-${zs}`, kind: 'wood', phys: 'rail', castShadow: true,
      size: [railOutL * 2, railH, railThickZ],
      pos: [0, railH / 2, zs * (railOutW + railInW) / 2],
    });
  }
  for (const xs of [1, -1]) {
    push({
      id: `rail-short-${xs}`, kind: 'wood', phys: 'rail', castShadow: true,
      size: [railThickX, railH, railInW * 2],
      pos: [xs * (railOutL + railInL) / 2, railH / 2, 0],
    });
  }

  // ---- 4) 桌裙 + 桌腿（纯装饰）----
  for (const zs of [1, -1]) {
    push({
      id: `apron-long-${zs}`, kind: 'wood', castShadow: true,
      size: [outerHalfL * 2, apronDrop, 0.022],
      pos: [0, -cloth - apronDrop / 2, zs * (outerHalfW - 0.011)],
    });
  }
  for (const xs of [1, -1]) {
    push({
      id: `apron-short-${xs}`, kind: 'wood', castShadow: true,
      size: [0.022, apronDrop, outerHalfW * 2 - 0.044],
      pos: [xs * (outerHalfL - 0.011), -cloth - apronDrop / 2, 0],
    });
  }
  for (const xs of [1, -1]) {
    for (const zs of [1, -1]) {
      push({
        id: `leg-${xs}-${zs}`, kind: 'wood', castShadow: true,
        size: [0.085, legH, 0.085],
        pos: [xs * (outerHalfL - 0.07), -cloth - apronDrop - legH / 2, zs * (outerHalfW - 0.07)],
      });
    }
  }

  // ---- 5) 不可见顶盖：紧贴外框顶面，任何情况下球都无法飞出台面 ----
  push({
    id: 'lid', kind: 'tray', phys: 'lid', visible: false,
    size: [outerHalfL * 2, 0.02, outerHalfW * 2],
    pos: [0, railH + 0.01, 0],
  });

  // ---- 6) 落球盘：兜住落袋的球 ----
  push({
    id: 'tray-floor', kind: 'tray', phys: 'tray',
    size: [outerHalfL * 2, 0.04, outerHalfW * 2],
    pos: [0, trayY, 0],
  });
  // 桌腔围墙（不可见）：从落球盘一直封到台面底部，
  // 否则落袋球会带着横向速度在桌面下方"飞"出桌体外。厚 8cm 防止高速穿透。
  const tw = 0.08;
  const wallTop = -cloth - 0.01;
  const th = wallTop - trayY;
  for (const zs of [1, -1]) {
    push({
      id: `tray-wall-z${zs}`, kind: 'tray', phys: 'tray', visible: false,
      size: [outerHalfL * 2, th, tw],
      pos: [0, trayY + th / 2, zs * (outerHalfW - tw / 2)],
    });
  }
  for (const xs of [1, -1]) {
    push({
      id: `tray-wall-x${xs}`, kind: 'tray', phys: 'tray', visible: false,
      size: [tw, th, outerHalfW * 2],
      pos: [xs * (outerHalfL - tw / 2), trayY + th / 2, 0],
    });
  }

  // ---- 7) 袋口收口环：把 6 个方形开口收成圆形喉口（不可见，纯物理）----
  for (const b of pocketCollarBoxes()) boxes.push({ visible: false, castShadow: false, phys: null, ...b });

  return boxes;
}

/** 袋口开口规格：台面被切掉的正方形开口（库边断口围出来的那块） */
export const POCKET_HOLE = {
  // 开口：向内 pocketCut、向外 cushionW → 边长 = pocketCut + cushionW
  half: (TABLE.pocketCut + TABLE.cushionW) / 2,
  inward: TABLE.pocketCut,
};

/** 6 个袋口传感器规格（不可见，仅用于进袋判定） */
export const POCKET_SENSOR = {
  radius: TABLE.pocketSensorR,
  halfHeight: 0.06,
  y: -0.15,
};

/**
 * 落球喉口：真正会让球掉下去的是一个圆孔。
 *
 * 之前「整个 12.5cm 见方的开口都是洞」，带来三个明显失真的后果：
 *   1. 球可以贴着方形开口的刀刃边缘再滚上好几厘米才掉下去（沿边「卷」进袋）；
 *   2. 同一个袋能同时吃掉 2~3 颗球（开球时尤其夸张）；
 *   3. 贴库慢速滚过袋口必进，袋口等于一个「吸尘口」。
 * 真实球台的袋口位置本身就是一个圆形坑位，这里用一圈旋转方块把方形开口收成圆孔：
 * 只有球心真的进到这个圆里才落袋，其余位置球是停在袋口边缘平台上的。
 *
 * ⚠️ 角袋与中袋半径不同（中袋更大，见 constants.js 的 TABLE.pocketThroat）：
 *    凡是要拿"喉口半径"做判定的地方一律走 throatRadiusOf(pocket)，不要再用单一常量。
 */
export const POCKET_THROAT = {
  corner: TABLE.pocketThroat,       // 57mm（直径 114mm）
  middle: TABLE.pocketThroatMid,    // 60mm（直径 120mm）
  segments: 12,        // 收口环分段数（多边形逼近圆）
  thickness: 0.02,     // 收口环厚度，顶面与台面齐平（球滚过去没有任何台阶）
};

/**
 * 某个袋的喉口半径。
 * @param p 袋口对象（constants 的 POCKETS 元素 / pocketSensors() 的项 / pocketLids() 的项）
 *          认 `type`；只有 `name` 时按名字兜底（'中袋' 三个字出现在中袋的名字里）
 */
export function throatRadiusOf(p) {
  if (!p) return POCKET_THROAT.corner;
  if (p.type) return p.type === 'middle' ? POCKET_THROAT.middle : POCKET_THROAT.corner;
  return String(p.name || '').includes('中袋') ? POCKET_THROAT.middle : POCKET_THROAT.corner;
}

/**
 * 袋口收口环：把方形开口（12.5cm 见方）收成圆形喉口的一圈扁方块。
 * 顶面与台面齐平（y=0），所以视觉上看不出来，物理上球可以稳稳滚过去。
 * 每个分段是「切向 × 厚 × 径向进深」的方块，绕 Y 轴旋转后拼成一圈：
 *   rotY = π/2 − θ 使 local +Z 指向径向（θ 为该分段的方位角）。
 * 返回的是普通 box 数据（带 rotY），渲染层与物理测试层共用。
 */
export function pocketCollarBoxes() {
  const a = POCKET_HOLE.half;                 // 方形开口半宽
  const th = POCKET_THROAT.thickness;
  const N = POCKET_THROAT.segments;  // 从袋心出发、方位角 ang 方向的射线打到方框边界的距离
  const rSquare = (ang) => a / Math.max(Math.abs(Math.cos(ang)), Math.abs(Math.sin(ang)));

  const out = [];
  POCKETS.forEach((p, index) => {
    const r = throatRadiusOf(p);              // 角袋 / 中袋半径不同（中袋更大）
    for (let k = 0; k < N; k++) {
      const a0 = (k / N) * Math.PI * 2;
      const a1 = ((k + 1) / N) * Math.PI * 2;
      const mid = (a0 + a1) / 2;
      // 外缘取该扇形内方框边界的最远处，保证一直铺到绿色台布边上
      const rOut = Math.max(rSquare(a0), rSquare(a1), rSquare(mid)) - 0.0004;
      const depth = rOut - r;                                       // 径向进深
      // 喉口比方口半宽还大时（理论上限 62.5mm）这一段就没有"收口"可言，跳过。
      // 现在的 57 / 60mm 都在限内，这条只是防止以后把喉口调过头时生成负尺寸的刚体。
      if (depth <= 1e-4) continue;
      const width = 2 * rOut * Math.sin((a1 - a0) / 2) * 1.08;      // 切向宽度（略放量与邻居咬合）
      const rMid = r + depth / 2;
      out.push({
        id: `pocket-collar-${index}-${k}`,
        kind: 'cloth', phys: 'clothSurface', visible: false,
        size: [width, th, depth],
        pos: [p.x + rMid * Math.cos(mid), -th / 2, p.z + rMid * Math.sin(mid)],
        rotY: Math.PI / 2 - mid,
      });
    }
  });
  return out;
}

/**
 * 袋口盖板：与台面齐平的薄板，启用时该袋「关闭」（球滚过去不会掉）。
 * 仅用于玩法规则（例如开球保护），默认始终是关闭盖板 = 袋口敞开的状态。
 */
export function pocketLids() {
  return POCKETS.map((p, index) => ({
    index,
    id: `pocket-lid-${index}`,
    name: p.name,
    type: p.type,
    x: p.x,
    z: p.z,
    half: POCKET_HOLE.half - 0.001,
    thickness: 0.02,   // 顶面 y=0 → 中心 y=-thickness/2
  }));
}

export function pocketSensors() {
  return POCKETS.map((p, i) => ({
    index: i,
    name: p.name,
    type: p.type,
    x: p.x,
    z: p.z,
    y: POCKET_SENSOR.y,
    radius: POCKET_SENSOR.radius,
    halfHeight: POCKET_SENSOR.halfHeight,
    // 该袋的喉口半径：进袋判定要按袋型判（角袋 57 / 中袋 60），
    // 用单一常量会在中袋留下 3mm 的"假进袋"、或在角袋放宽 3mm。
    throat: throatRadiusOf(p),
  }));
}

/** 相邻两球的间距（略大于直径，避免初始就重叠） */
const BALL_GAP = BALL_R * 2 * 1.004;
/** 行距：三角/菱形球堆里相邻两行的 X 间距 */
const ROW_DX = BALL_GAP * Math.cos(Math.PI / 6);

/**
 * 任意球组的架球位置（行距 = 2R·cos30°，每行沿 Z 居中）。
 * 形状完全由 rules.js 的 rows 决定（中式黑八是五排三角形），
 * 将来加斯诺克 / 俄式只要给一组新的 rows，共用这一段逻辑。
 * @param setId 球组 id（见 rules.js）
 * @param shiftX 整堆球的前后平移，默认取 constants.js 的 RACK.shiftX
 */
export function rackLayoutFor(setId = DEFAULT_BALL_SET, shiftX = RACK.shiftX) {
  const set = getBallSet(setId);
  const apexX = FOOT_SPOT.x + shiftX;
  const out = [];
  let k = 0;
  for (let row = 0; row < set.rows.length; row++) {
    const n = set.rows[row];
    for (let i = 0; i < n; i++) {
      out.push({
        number: set.order[k++],
        x: apexX + row * ROW_DX,
        z: (i - (n - 1) / 2) * BALL_GAP,
      });
    }
  }
  return out;
}

/** 中式黑八的架球位置 —— 现在只有这一套，保留为便捷入口 */
export function rackPositions(shiftX = RACK.shiftX) {
  return rackLayoutFor(DEFAULT_BALL_SET, shiftX);
}

/** 某球组的全部初始位置：0 = 白球（白球始终在开球点，不随球堆平移） */
export function allBallSpawnsFor(setId = DEFAULT_BALL_SET, shiftX = RACK.shiftX) {
  return [{ number: 0, x: HEAD_SPOT.x, z: HEAD_SPOT.z }, ...rackLayoutFor(setId, shiftX)];
}

/** 16 颗球的初始位置（中式黑八） */
export function allBallSpawns(shiftX = RACK.shiftX) {
  return allBallSpawnsFor(DEFAULT_BALL_SET, shiftX);
}
