/**
 * 🤖 人机对战：电脑对手的大脑（纯逻辑，不碰 three、不碰 DOM）
 * ------------------------------------------------------------------
 * 和 duo.js / auto-aim.js 一样刻意做成"无头可测"：`test/suites/ai.mjs` 直接 import 这里，
 * 用**真实物理**跑几百杆，把每一档的进球率量出来 —— 难度是测出来的，不是拍脑袋写的。
 *
 * 电脑的每一次击球只做三件事：
 *   ① 用 auto-aim.js 算出**完美方案**（挑最容易进的球 + 幽灵球几何 + 力度反解）；
 *   ② 按难度往这个方案里**掺噪声**（瞄准角抖一点、力度飘一点、偶尔不选最优的那颗）；
 *   ③ 把"思考多久"一并算出来，交给 main.js 播转杆动画。
 *
 * 为什么不改物理 / 不改 auto-aim：那样"难度"会连带把玩家的手感也改掉。
 * 让电脑用**同一套球桌、同一套出杆链路**打，只是自己手抖，才是公平的对手。
 *
 * ⚠️ 瞄准角的噪声量级极小（千分之几弧度）却足以决定进不进，原因见 constants.js 的 AI_LEVELS：
 *    白球走 1m 到幽灵球，0.001 rad 的偏差会让撞击法线转约 1°，球就擦着袋口过去了。
 */
import { AI, AI_LEVELS, SHOT, TABLE } from './constants.js';
import { planAutoShot } from './auto-aim.js';
import { clampCuePlace } from './layout.js';

/** 难度 id → 那一份配置（不认识 / 没传 → 中等） */
export function aiLevel(id) {
  return AI_LEVELS[id] || AI_LEVELS[AI.defaultLevel];
}

/** 四档难度的展示表（从易到难，启动器与结算窗都要用同一份） */
export function aiLevelList() {
  return [AI_LEVELS.easy, AI_LEVELS.normal, AI_LEVELS.hard, AI_LEVELS.extreme];
}

export function isAiLevel(id) {
  return Object.prototype.hasOwnProperty.call(AI_LEVELS, id);
}

/**
 * 固定种子的伪随机（mulberry32）。
 * ------------------------------------------------------------------
 * 测试要能复现：命中率断言跑的是**同一批球位、同一串随机抖动**，
 * 否则 200 杆的统计今天 82% 明天 88%，红了根本查不出是代码还是运气。
 * 不传种子时退化成 Math.random（正式游戏里每局都不一样，才不会看出规律）。
 */
export function makeRnd(seed) {
  if (seed == null) return Math.random;
  let a = seed >>> 0;
  return function rnd() {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** 标准正态（Box-Muller）：抖动取"小偏差多、大偏差少"，而不是均匀分布那样一律同概率 */
function gauss(rnd) {
  let u = 0;
  let v = 0;
  while (u === 0) u = rnd();
  while (v === 0) v = rnd();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

function clamp(v, lo, hi) {
  return v < lo ? lo : v > hi ? hi : v;
}

/**
 * 电脑的击球方案。
 *
 * @param cue     {x, z} 白球位置
 * @param balls   场上所有球（不含白球）
 * @param targets 允许打的球号（人机模式下就是"电脑那一组剩下的"，见 auto-aim.js 的 duoTargets）
 * @param level   'easy' | 'normal' | 'hard'
 * @param rnd     随机源（测试里传固定种子）
 * @param range   力度区间 {min, max}
 * @returns 完美方案 + 噪声；null 表示连兜底都打不了（台面空了）
 */
export function planAiShot(input = {}) {
  const {
    cue,
    balls = [],
    targets = null,
    level = AI.defaultLevel,
    rnd = Math.random,
    range = { min: SHOT.minImpulse, max: SHOT.maxImpulse },
  } = input;
  if (!cue) return null;

  const L = aiLevel(level);
  const plan = planAutoShot({ cue, balls, targets, range });
  if (!plan.best) return null;

  // ---- ① 选球：越笨越可能不看全局，抓着次优的那颗就打 ----
  // candidates 是"能进的球"里最容易的三颗（已按 score 排好）。
  // ⚠️ 只在 strict 方案里挑：兜底 / lastResort 本来就没什么可选，
  //    再让电脑挑次优的，会出现"明明能碰一下却故意推歪"的傻样。
  let pick = plan.best;
  const cands = (plan.candidates || []).filter(Boolean);
  if (pick.strict && cands.length > 1 && rnd() < L.rankP) {
    pick = cands[1 + Math.floor(rnd() * (cands.length - 1))] || pick;
  }

  // ---- ② 手抖：瞄准角 + 力度 ----
  const aimErr = gauss(rnd) * L.aimErr;
  const powErr = 1 + gauss(rnd) * L.powErr;
  const power = clamp(pick.power * powErr, 0, 1);
  const thinkMs = L.thinkMs[0] + rnd() * (L.thinkMs[1] - L.thinkMs[0]);
  // ⚠️ power 改了，impulse 必须跟着改 —— 两者是同一件事的两种写法
  //    （shot.js 里 `impulse = min + (max − min) × power`），只改一个的话
  //    屏幕上显示的力度和真正打出去的力度会对不上。
  const lo = range.min ?? SHOT.minImpulse;
  const hi = range.max ?? SHOT.maxImpulse;
  const impulse = clamp(lo + (hi - lo) * power, Math.min(lo, hi), Math.max(lo, hi));

  return {
    ...pick,
    aimAngle: pick.aimAngle + aimErr,     // ⚠️ 噪声加在**最后**：几何已经在上面算完了
    aimErr,
    power,
    impulse,
    level: L.id,
    levelName: L.name,
    thinkMs: Math.round(thinkMs),
    // 给提示条用的文案（"电脑打算打哪颗球"）：兜底与撞开那两种说法不一样
    tip: pick.strict
      ? `电脑瞄准：${pick.number} 号 → ${pick.pocketName}（力度 ${Math.round(power * 100)}%）`
      : pick.lastResort
        ? `电脑先撞开 ${pick.number} 号`
        : `电脑碰一下 ${pick.number} 号`,
  };
}

/**
 * 电脑拿到手中球（对手白球落袋）时，自己挑一个摆球位。
 * ------------------------------------------------------------------
 * 为什么不让电脑随手一放：手中球是很大的优势，摆得越好越像"会打的人"；
 * 摆得越差，难度档位就被摆位这一下抹平了（四档都会变得一样菜）。
 *
 * 做法：在台面上撒一张 placeGrid × placeGrid 的网格，每个点跑一次 planAutoShot，
 * 挑"最容易进的那颗球得分最低"的点。计算量 = 25 × (球数 × 6 个袋)，几毫秒的事。
 * ⚠️ 网格点必须先过 clampCuePlace：白球不能压在库边里、也不能悬在袋口上。
 */
export function aiPlaceCue(input = {}) {
  const {
    balls = [],
    targets = null,
    level = AI.defaultLevel,
    rnd = Math.random,
    range = { min: SHOT.minImpulse, max: SHOT.maxImpulse },
  } = input;

  const n = Math.max(2, AI.placeGrid | 0);
  const jitter = AI.placeJitter;
  let best = null;
  let bestScore = Infinity;
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < n; j++) {
      // 网格取格心（(i + 0.5) / n），避免正好压在库边内沿上
      const gx = (-(TABLE.halfL) + (2 * TABLE.halfL) * (i + 0.5) / n);
      const gz = (-(TABLE.halfW) + (2 * TABLE.halfW) * (j + 0.5) / n);
      const p = clampCuePlace(gx, gz);
      if (!p) continue;
      const spot = {
        x: p.x + (rnd() - 0.5) * 2 * jitter,
        z: p.z + (rnd() - 0.5) * 2 * jitter,
      };
      const c = clampCuePlace(spot.x, spot.z);
      if (!c) continue;
      const plan = planAutoShot({ cue: { x: c.x, z: c.z }, balls, targets, range });
      // 只认 strict 方案（"摆到这个位置上有球能进"）；没有就按"离最近那颗球多近"兜底
      const score = plan.best ? plan.best.score : Infinity;
      if (score < bestScore) {
        bestScore = score;
        best = { x: c.x, z: c.z };
      }
    }
  }
  // 一格都评不出来（台面上没球了）→ 退回开球点
  return best || { x: -TABLE.halfL * 0.5, z: 0 };
}
// （B2 已修，2026-10-30）aiBreak 已删除：唯一的调用点是 main.js 里一条走不到的死分支。
// 哪天"谁开球"改成可配置，在这里重新写一个真正的开球策略（参考 git 历史 —— 没有 git，
// 那就参考体检报告 B2 条目：power 用 AI.breakPower、aimAngle 抖动 ±0.03）。
