/**
 * 自动瞄准 / 自动进球（纯几何 + 实测物理模型，不碰 three、不碰 DOM）
 * ------------------------------------------------------------------
 * 和 duo.js / modes.js 一样刻意做成"无头可测"：`test/suites/autoaim.mjs` 直接 import 它，
 * 用**真实物理**跑几百个随机球位，看自动出杆到底进没进 —— 命中率是量出来的，不是靠肉眼。
 *
 * 一次规划做三件事：
 *   ① 枚举「每颗合法目标球 × 每个袋口」，用幽灵球几何算出白球该怎么撞；
 *   ② 用实测拟合的两条速度曲线反解需要多大冲量（力度）；
 *   ③ 按"好不好进"打分，选最容易那一颗；一颗都进不了时给一个"至少别犯规"的兜底方案。
 *
 * 几何（幽灵球）：
 *   想让目标球 B 沿 u 方向进袋 P，白球撞击瞬间必须停在 G = B − 2R·u（B 背向袋口的那一侧），
 *   此时两球心距正好 2R，碰撞法线 = unit(B − G) = u，目标球被推向 u。
 *   ⚠️ 幽灵球必须在**背向袋口**那一侧（写成 + 会让白球从袋口那头撞过来，球被打飞出台面方向）。
 *
 * throw 补偿：
 *   切球时两球间的摩擦会把目标球往白球前进的切向带偏（实测 ≈ 0.12 × cut）。
 *   1m 外偏 2° 就够球擦着袋口过去了，所以这里按 cut 反方向预旋一个补偿角再算几何。
 */
import { AUTO, BALL_R, BALL_MASS, PHYS, POCKETS, SHOT, TABLE } from './constants.js';

const TWO_R = BALL_R * 2;

/* ---------- 滚动摩擦模型（0.7.0，体检 P1） ----------
 * 与 sim.js 的 applyRollFriction 是同一套模型的连续形式：
 *   dv/dt = −(rollDecel + rollDamp·v)  →  dv/dd = −(rollDecel + rollDamp·v)/v
 * 解析解：初速 v0 减速到停的总行程
 *   stopDist(v0) = (k·v0 − a·ln((a + k·v0)/a)) / k²      （a = rollDecel，k = rollDamp）
 * 行程反解用二分（单调，40 次迭代误差 < 1e-9 m）。
 * 旧的"每米固定掉 cueDecel"直线模型已废弃 —— 那是指数阻尼的等价形，
 * 长台要打得比真实重一倍以上。 */

/** 从速度 v 减速到停（v→0）能滚多远（米） */
function stopDist(v, a, k) {
  if (v <= 0) return 0;
  return (k * v - a * Math.log((a + k * v) / a)) / (k * k);
}

/** 行程反解：走 d 米之后还剩 vEnd 的速度，初速需要多少（二分） */
function speedForDistance(d, vEnd, a, k) {
  const base = stopDist(vEnd, a, k);
  let lo = vEnd;
  let hi = Math.max(0.5, vEnd) * 2;
  while (stopDist(hi, a, k) - base < d) hi *= 2;         // 上界指数扩张，d 再大也不怕
  for (let i = 0; i < 40; i++) {
    const mid = (lo + hi) / 2;
    if (stopDist(mid, a, k) - base < d) lo = mid;
    else hi = mid;
  }
  return (lo + hi) / 2;
}

/** 单位向量 */
function unit(x, z) {
  const d = Math.hypot(x, z) || 1;
  return { x: x / d, z: z / d };
}

/** 在 (x,z) 平面里把向量旋转 ang 弧度（正方向 = 从 +X 转向 +Z） */
function rot(v, ang) {
  const c = Math.cos(ang);
  const s = Math.sin(ang);
  return { x: v.x * c - v.z * s, z: v.x * s + v.z * c };
}

/** 叉积（用于求有符号夹角）：cross(u,d) > 0 表示 d 在 u 的 +Z 侧 */
function cross(u, d) {
  return u.x * d.z - u.z * d.x;
}

/** 有符号夹角：从 u 转到 d 的角度（rad，正号与 rot() 同向） */
function signedAngle(u, d) {
  return Math.atan2(cross(u, d), u.x * d.x + u.z * d.z);
}

/**
 * 出杆方向 → aimAngle。
 * ⚠️ 与 aimer.js 的 aimVector 严格对应：方向向量 = (sinθ, 0, cosθ)。
 */
export function angleOfDir(d) {
  return Math.atan2(d.x, d.z);
}

/** 点到线段的最短距离（路径净空检测用） */
function distPointSeg(p, a, b) {
  const vx = b.x - a.x;
  const vz = b.z - a.z;
  const L2 = vx * vx + vz * vz;
  let t = L2 > 1e-12 ? ((p.x - a.x) * vx + (p.z - a.z) * vz) / L2 : 0;
  t = t < 0 ? 0 : t > 1 ? 1 : t;
  return Math.hypot(p.x - a.x - vx * t, p.z - a.z - vz * t);
}

/** 某条路径上有没有别的球挡着（gap = 需要的净空） */
function pathBlocked(a, b, others, gap) {
  for (const o of others) {
    if (distPointSeg(o, a, b) < gap) return true;
  }
  return false;
}

/** 白球能不能真的站到幽灵球那个点上（不能落在台外、也不能悬在袋口上） */
function ghostReachable(g) {
  if (Math.abs(g.x) > TABLE.halfL - BALL_R * 0.4) return false;
  if (Math.abs(g.z) > TABLE.halfW - BALL_R * 0.4) return false;
  for (const p of POCKETS) {
    if (Math.hypot(g.x - p.x, g.z - p.z) < BALL_R * 2.2) return false;
  }
  return true;
}

/** 这条线段会不会把球送进某个袋（用来判断"白球会不会自己掉袋"） */
function crossesPocket(a, b) {
  for (const p of POCKETS) {
    if (distPointSeg(p, a, b) < BALL_R * 1.15) return true;
  }
  return false;
}

/**
 * 力度反解：要走 d1（白球 → 撞击点）+ d2（目标球 → 袋口），需要多大冲量？
 * ------------------------------------------------------------------
 * 单独导出是为了能被直接断言（"越远力度越大""切得越薄力度越大""不超玩家设置的上限"），
 * 不必靠随机球位去碰运气。
 *
 * 0.7.0 起用滚动摩擦的解析模型（见文件头部）：不再是"每米固定掉多少"的直线，
 * 而是按 rollDecel/rollDamp 两参数反解 —— 与游戏里真实的物理步进一致。
 *
 * @param d1  白球到幽灵球的距离（m）
 * @param d2  目标球到袋口的距离（m）
 * @param cut 切角（rad）：0 = 正撞，越大越"薄"
 * @param cfg AUTO 参数（含 min / max 冲量区间）
 */
export function estimatePower(d1, d2, cut, cfg = AUTO) {
  const a = PHYS.ball.rollDecel;
  const k = PHYS.ball.rollDamp;
  // 目标球要滚 d2 + 余量，到袋口时还剩 ballV0 的余速 → 反解它被撞那一瞬的初速
  const v2 = speedForDistance(d2 + cfg.overrun, cfg.ballV0, a, k);
  const v1 = v2 / Math.max(0.2, cfg.transfer * Math.cos(cut));
  // 白球走到撞击点这一路也被摩擦吃掉一截 → 再反解一程
  const v0 = Math.min(speedForDistance(d1, v1, a, k) * cfg.safety, cfg.maxSpeed);
  const min = cfg.min ?? SHOT.minImpulse;
  const max = cfg.max ?? SHOT.maxImpulse;
  const impulse = clamp(BALL_MASS * v0, min, max);
  return {
    v0,
    impulse,
    power: (impulse - min) / Math.max(1e-6, max - min),
  };
}

/**
 * 单个「目标球 × 袋口」方案的评估。
 * @param strict true = 严格要求路径全通（用于"能进的球"）；false = 兜底，只求打到球
 */
function evalPlan(cue, ball, pocket, pocketIndex, others, cfg, strict) {
  const u0 = unit(pocket.x - ball.x, pocket.z - ball.z);
  const d2 = Math.hypot(pocket.x - ball.x, pocket.z - ball.z);
  const maxCut = strict ? cfg.maxCut : cfg.maxCutFallback;

  // ---- 迭代求"瞄准方向"（带 throw 补偿）----
  // u 是"期望目标球出射的方向"；因为有 throw，实际瞄的时候要往反方向预偏一点。
  // 偏差角依赖切角，切角又依赖瞄准方向 —— 迭代 3 次足够收敛（每次修正量 < 0.5°）。
  let u = u0;
  let g = null;
  let dir = null;
  let d1 = 0;
  let cut = 0;
  for (let it = 0; it < 3; it++) {
    g = { x: ball.x - TWO_R * u.x, z: ball.z - TWO_R * u.z };
    dir = unit(g.x - cue.x, g.z - cue.z);
    d1 = Math.hypot(g.x - cue.x, g.z - cue.z);
    const sgn = signedAngle(u, dir);
    cut = Math.abs(sgn);
    if (cut > maxCut) return null;
    u = rot(u0, -cfg.throwK * sgn);
  }
  const cosT = Math.cos(cut);
  if (cosT < 0.08) return null;

  if (!ghostReachable(g)) return null;

  // ---- 路径净空 ----
  if (strict) {
    if (pathBlocked(cue, g, others, cfg.clearGap)) return null;        // 白球撞不到
    if (pathBlocked(ball, pocket, others, cfg.clearGap)) return null;  // 目标球进不去
  } else if (pathBlocked(cue, g, others, TWO_R * 0.98)) {
    return null;                                                       // 兜底也要能碰到球
  }

  // ---- 力度：反解需要多大初速 ----
  // 目标球要滚 d2 + 余量；它到手的速度只有白球撞前速度的 transfer·cos(cut) 倍；
  // 白球走到撞击点这一路还要被滚动摩擦吃掉一截（与 estimatePower 同一套解析模型）。
  const fricA = PHYS.ball.rollDecel;
  const fricK = PHYS.ball.rollDamp;
  const v2 = speedForDistance(d2 + cfg.overrun, cfg.ballV0, fricA, fricK);
  const v1 = v2 / Math.max(0.2, cfg.transfer * cosT);      // 撞击瞬间白球应有的速度
  const need = speedForDistance(d1, v1, fricA, fricK) * cfg.safety;   // 不加钳制时的出杆速度
  // 贴库时只打"轻推够得着"的球：漂移随速度涨，硬杆打贴库球基本必丢
  if (strict && cfg.tight && need > cfg.tightSpeed) return null;
  const est = estimatePower(d1, d2, cut, { ...cfg, maxSpeed: cfg.tight ? cfg.tightSpeed : cfg.maxSpeed });
  const v0 = est.v0;

  // ---- 白球撞完往哪走（会不会自己掉袋）----
  const after = unit(dir.x - cosT * u.x, dir.z - cosT * u.z);
  const vAfter = v1 * Math.sin(cut);
  const cueRun = stopDist(Math.max(0, vAfter - cfg.cueV0), fricA, fricK);
  const cueEnd = { x: g.x + after.x * cueRun, z: g.z + after.z * cueRun };
  const cueRisk = crossesPocket(g, cueEnd);

  // ---- 打分：越小越容易进 ----
  let score = cfg.wCut * cut + cfg.wPot * d2 + cfg.wCue * d1;
  if (cueRisk) score += cfg.penaltyCue;
  if (!strict) score += 3;      // 兜底方案排在所有"能进的"后面

  return {
    number: ball.number,
    pocket: pocketIndex,
    pocketName: pocket.name,
    aimAngle: angleOfDir(dir),
    impulse: est.impulse,
    v0,
    power: est.power,
    cut,
    d1,
    d2,
    score,
    cueRisk,
    strict,
  };
}

function clamp(v, lo, hi) {
  return v < lo ? lo : v > hi ? hi : v;
}

/**
 * 最后兜底：连"碰一下"的方案都算不出来时，也要给一个。
 * ------------------------------------------------------------------
 * 什么时候会走到这里：**白球被球堆夹住**（典型是弱开球之后球堆没散开，白球就贴在堆上）。
 * 这时候通往任何一颗球的幽灵球的直线都会被邻球挡住（`pathBlocked` 通不过），
 * strict 与 loose 全是空的 —— 早期版本就直接返回 null，表现是**玩家点了按钮什么都没发生**。
 *
 * 所以这里退化成"朝最近那颗合法球推过去"：不指望进球，只求把球型撞开，下一杆就有得选了。
 * 力度按"把球推出 0.8m"反解（比贴库限速低，够撞开又不至于乱飞）。
 */
function lastResort(cue, pool, cfg) {
  let near = null;
  let nd = Infinity;
  for (const b of pool) {
    const d = Math.hypot(b.x - cue.x, b.z - cue.z);
    if (d < nd) { nd = d; near = b; }
  }
  if (!near) return null;
  const dir = unit(near.x - cue.x, near.z - cue.z);
  const est = estimatePower(Math.max(0.05, nd - TWO_R), 0.8, 0, cfg);
  return {
    number: near.number,
    pocket: -1,
    pocketName: '',
    aimAngle: angleOfDir(dir),
    impulse: est.impulse,
    v0: est.v0,
    power: est.power,
    cut: 0,
    d1: nd,
    d2: 0.8,
    score: Infinity,
    cueRisk: false,
    strict: false,
    lastResort: true,
  };
}

/**
 * 规划一次自动击球。
 *
 * @param cue     {x, z} 白球位置（球心，米）
 * @param balls   场上所有球 [{number, x, z, potted?, hidden?}]（含白球也行，会被剔除）
 * @param targets 允许打的球号（数组 | null = 全部）。本地双人传"自己那组剩下的球"，
 *                这样它绝不会替你去打对方的球 / 提前把黑八打进去。
 * @param range   冲量区间 {min, max}（默认取当前 SHOT 设置，玩家改过力度上限就跟著变）
 * @returns { best, candidates, fallback } best 为 null 表示连兜底都打不了
 */
export function planAutoShot(input = {}) {
  const {
    cue,
    balls = [],
    targets = null,
    pockets = POCKETS,
    range = { min: SHOT.minImpulse, max: SHOT.maxImpulse },
    opts = {},
  } = input;
  if (!cue) return { best: null, candidates: [], fallback: null };

  const cfg = { ...AUTO, min: range.min, max: range.max, ...opts };
  // 白球贴库时出杆方向会被物理引擎的接触求解带偏（实测 1~9°，见 constants.js 的 AUTO 注释），
  // 这时候"薄球 + 长距离"基本必丢，所以把切角与距离的权重放大，逼它挑最直、最近的那一颗。
  const cueGap = Math.min(TABLE.halfL - Math.abs(cue.x), TABLE.halfW - Math.abs(cue.z)) - BALL_R;
  if (cueGap < cfg.nearCushion) {
    cfg.wCut *= cfg.tightCut;
    cfg.wCue *= cfg.tightCue;
    cfg.tight = true;
  }
  const allow = targets ? new Set(targets.map(Number)) : null;
  const live = balls.filter((b) => b && !b.potted && !b.hidden && Number(b.number) !== 0);
  const pool = allow ? live.filter((b) => allow.has(Number(b.number))) : live;

  const strict = [];
  const loose = [];
  for (const b of pool) {
    const others = live.filter((o) => o !== b);
    for (let i = 0; i < pockets.length; i++) {
      const plan = evalPlan(cue, b, pockets[i], i, others, cfg, true);
      if (plan) strict.push(plan);
      else {
        const fb = evalPlan(cue, b, pockets[i], i, others, cfg, false);
        if (fb) loose.push(fb);
      }
    }
  }

  strict.sort((a, b) => a.score - b.score);
  loose.sort((a, b) => a.score - b.score);
  // 只在 strict / loose 全空时才动用（白球被球堆夹住，见 lastResort 的注释）
  const shove = (strict[0] || loose[0]) ? null : lastResort(cue, pool, cfg);
  return {
    best: strict[0] || loose[0] || shove || null,
    candidates: strict.slice(0, 3),
    fallback: loose[0] || shove || null,
    strictCount: strict.length,
  };
}

/**
 * 本地双人：这一杆"允许打"的球号。
 * ------------------------------------------------------------------
 * 交给引擎的球号集合必须和规则一致 —— 自动进球也要守规矩：
 *   · 台面还没分大小号：除了黑八都行（开球那杆进黑八会整局重来，自动打不能替玩家踩这个坑）
 *   · 已分组：只打自己那组剩下的；自己那组清完了 → 只打黑八（这就是"决胜球"）
 */
export function duoTargets(match, potted = []) {
  if (!match) return null;
  const done = new Set(potted.map(Number));
  const mine = match.groups?.[match.turn];
  if (!mine) {
    return [...(match.numbersOf('low')), ...(match.numbersOf('high'))].filter((n) => !done.has(n));
  }
  const left = match.numbersOf(mine).filter((n) => !done.has(n));
  return left.length ? left : [8];
}
