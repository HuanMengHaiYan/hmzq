import { SCORE } from './constants.js';

/**
 * 玩法模式与计分规则
 * ------------------------------------------------------------------
 * 这个文件刻意**不碰 three、不碰 DOM**：无头测试可以直接 import 跑，
 * 计分口径（下面的 ScoreBoard）也因此能被断言，而不是靠肉眼看 HUD。
 *
 * 第三阶段（本阶段）已实现的单机模式：
 *   free  自由模式 —— 无计分、无胜负，清台也只记一笔"通关"
 *   score 计分模式 —— 按下面 ScoreBoard 的口径累加分数，清台结束
 *   limit 限次模式 —— 限定击球次数内清台算通关，次数用尽还没清完算失败
 *   timed 计时模式 —— 限定时间内清台算通关，时间到还没清完算失败
 * 娱乐模式（fun）下的第一套玩法：
 *   freeball 自由球模式 —— **每一杆开球前**都把白球摆到顺手的位置（等于真实的"手中球"，
 *            刻意做成开挂 / 纯练习的手感），之后的计分口径与计分模式完全一致（scored: true）
 *   duo     本地双人模式 —— 同一台设备轮流击球，1~7 小号 / 9~15 大号 / 8 号决胜；
 *            分组由实际打球结果决定，规则见 src/duo.js（纯逻辑，可被无头测试断言）
 * 人机（ai）与联机（online）是后续阶段，这里只预留 id，界面上仍是不可进入的占位。
 *
 * 「限次」与「计时」共用同一套难度档位（easy/normal/hard）：难度名一样，
 * 但一个折算成击球次数、一个折算成毫秒 —— 两套数值各自一张表（LIMIT_DIFFS / TIME_DIFFS）。
 */

/** 模式表（顺序即界面展示顺序） */
export const GAME_MODES = {
  free: {
    id: 'free',
    name: '自由模式',
    desc: '纯粹游玩：自由练习、无计分、无胜负判定',
    scored: false,     // 是否计分（决定 HUD 要不要显示得分）
    limited: false,    // 是否限次（决定 HUD 要不要显示剩余次数、会不会判负）
    live: true,
  },
  score: {
    id: 'score',
    name: '计分模式',
    desc: '按连击与一杆多进累加分数，把全部目标球打完即结算',
    scored: true,
    limited: false,
    live: true,
  },
  limit: {
    id: 'limit',
    name: '限次模式',
    desc: '限定击球次数内清台即通关，次数用尽还没清完则失败',
    scored: false,
    limited: true,
    live: true,
  },
  timed: {
    id: 'timed',
    name: '计时模式',
    desc: '限定时间内清台即通关，时间到还没清完则失败',
    scored: false,
    limited: false,
    timed: true,       // 是否限时（决定 HUD 要不要显示剩余时间、会不会判负）
    live: true,
  },
  freeball: {
    id: 'freeball',
    name: '自由球模式',
    desc: '每一杆开球前都把白球摆到顺手的位置，再开始击球；按计分模式的口径计分',
    scored: true,      // 计分口径与计分模式完全一致（进一颗 +1、连击 +1…）
    limited: false,
    placing: true,     // **每一杆**开球前都摆白球：拖动 → 确定 → 才进入瞄准阶段（见 main.js）
    live: true,
  },
  duo: {
    id: 'duo',
    name: '本地双人',
    desc: '同一台设备轮流击球：1~7 小号 / 9~15 大号，8 号为决胜球，先清完自己那组再打进 8 号者获胜',
    scored: false,     // 胜负不是"分数"，也不写进挑战历史（见 main.js 的 finishMatch）
    limited: false,
    live: true,
    duo: true,         // 走 DuoMatch 的回合 / 分组判定（src/duo.js）
  },
  ai: {
    id: 'ai',
    name: '人机对战',
    desc: '与电脑对手对局：中式黑八规则，电脑扮演玩家2，轮到它时自己瞄准出杆（四档难度）',
    scored: false,
    limited: false,
    live: true,
    duo: true,         // 与本地双人**同一套**回合 / 分组 / 胜负判定（src/duo.js）
    ai: true,          // 玩家2 由电脑接管（src/ai.js）；玩家1 永远是人类，永远人类先开球
  },
  online: {
    id: 'online',
    name: '在线联机',
    desc: '房间与回合同步，需要服务器支持（后续阶段开放）',
    scored: false,
    limited: false,
    live: false,
  },
};

/** 限次模式的难度 → 允许的击球次数（用户定的：简单 40 / 中等 30 / 困难 20） */
export const LIMIT_DIFFS = {
  easy: { id: 'easy', name: '简单', shots: 40 },
  normal: { id: 'normal', name: '中等', shots: 30 },
  hard: { id: 'hard', name: '困难', shots: 20 },
};

/** 计时模式的难度 → 允许的时间（用户定的：简单 10 / 中等 6 / 困难 3 分钟） */
export const TIME_DIFFS = {
  easy: { id: 'easy', name: '简单', ms: 10 * 60 * 1000 },
  normal: { id: 'normal', name: '中等', ms: 6 * 60 * 1000 },
  hard: { id: 'hard', name: '困难', ms: 3 * 60 * 1000 },
};

export const DEFAULT_DIFF = 'normal';

/** 取模式定义；id 不认识时回落到自由模式（URL 参数被改坏也不会崩） */
export function getGameMode(id) {
  return GAME_MODES[id] || GAME_MODES.free;
}

export function isGameMode(id) {
  return Object.prototype.hasOwnProperty.call(GAME_MODES, id);
}

/** 取难度定义；不认识时回落中等（限次 / 计时共用同一套难度名，数值各自查自己的表） */
export function getDiff(id) {
  return LIMIT_DIFFS[id] || LIMIT_DIFFS[DEFAULT_DIFF];
}

/** 取计时模式的难度定义（带毫秒数）；不认识时回落中等 */
export function getTimeDiff(id) {
  return TIME_DIFFS[id] || TIME_DIFFS[DEFAULT_DIFF];
}

export function isDiff(id) {
  return Object.prototype.hasOwnProperty.call(LIMIT_DIFFS, id);
}

/**
 * 限次模式：这一局总共能打几杆。
 * @param mode 模式 id（只有 limit 才有次数上限）
 * @param diff 难度 id
 * @returns 次数；非限次模式返回 null
 */
export function shotLimit(mode, diff) {
  if (mode !== 'limit') return null;
  return getDiff(diff).shots;
}

/** 剩余次数（限次模式）；非限次模式恒为 null */
export function shotsLeft(mode, diff, shots) {
  const lim = shotLimit(mode, diff);
  if (lim == null) return null;
  return Math.max(0, lim - shots);
}

/**
 * 计时模式：这一局总共给多少毫秒。非计时模式返回 null。
 * 与 shotLimit 对称 —— HUD / 结算 / 写历史都从这一个口子取，不再各算一遍。
 */
export function timeLimit(mode, diff) {
  if (mode !== 'timed') return null;
  return getTimeDiff(diff).ms;
}

/** 剩余时间（计时模式，毫秒）；非计时模式恒为 null，且不会变成负数 */
export function timeLeft(mode, diff, elapsedMs) {
  const lim = timeLimit(mode, diff);
  if (lim == null) return null;
  return Math.max(0, lim - Math.max(0, Number(elapsedMs) || 0));
}

/**
 * 黑 8 是不是"提前"落袋：还有其它目标球没进就算提前（8 号自己本该是最后一颗）。
 * 与 result.js 的 isEarlyEight 不同 —— 那条受 RULES.eightBallSelfDestruct 开关控制（默认关），
 * 这条是**计分模式自己的犯规判定**，只看球号，不看开关。
 */
export function isPrematureEight(state, ball) {
  // 只有中式黑八才有"黑 8 要留到最后"这回事（别的玩法没有 8 号是决胜球的约定）
  if (state.ballSet !== '15') return false;
  if (!ball || ball.isCue || ball.number !== 8) return false;
  return state.potted.length < state.pottedTotal - 1;
}

/**
 * 计分板（纯逻辑，无渲染无 DOM）
 * ------------------------------------------------------------------
 * 口径（用户定的）：
 *   · 进一颗目标球  +1
 *   · 每连进一球再 +1   —— 连着进第 2 颗 +2、第 3 颗 +3…（streak 跨杆累计）
 *   · 一杆进 2 颗额外 +3，进 3 颗 +6…（每多一颗 +3，杆末结算）
 *   · 白球落袋     -1   并断连击
 *   · 提前打进黑 8 -3   并断连击（这一颗不再算进球分）
 * 空杆（一杆没进球）断连击。
 */
export class ScoreBoard {
  constructor(rules = SCORE) {
    this.rules = rules;
    this.score = 0;
    this.streak = 0;      // 跨杆连续进球数
    this.best = 0;        // 本局最高连击
    this.shotPots = 0;    // 本杆已进目标球数
    this.pots = 0;        // 本局总进球数
  }

  /** 每一杆开始 */
  onShotStart() {
    this.shotPots = 0;
  }

  /** 目标球落袋 @returns 本颗拿到多少分 */
  onTarget() {
    this.streak += 1;
    this.shotPots += 1;
    this.pots += 1;
    if (this.streak > this.best) this.best = this.streak;
    const gain = this.rules.perPot + this.rules.comboStep * (this.streak - 1);
    this.score += gain;
    return gain;
  }

  /** 白球落袋 @returns 变化量（负数） */
  onCue() {
    this.streak = 0;
    const d = -this.rules.cuePenalty;
    this.score += d;
    return d;
  }

  /** 提前打进黑 8 @returns 变化量（负数） */
  onEarlyEight() {
    this.streak = 0;
    const d = -this.rules.earlyEightPenalty;
    this.score += d;
    return d;
  }

  /** 一杆结束：结算"一杆多进"奖励 @returns 本杆奖励（0 表示没有） */
  onShotEnd() {
    let bonus = 0;
    if (this.shotPots >= 2) bonus = this.rules.multiBonus * (this.shotPots - 1);
    if (this.shotPots === 0) this.streak = 0;   // 空杆：连击断掉
    this.score += bonus;
    this.shotPots = 0;
    return bonus;
  }

  /** 重开一局 */
  reset() {
    this.score = 0;
    this.streak = 0;
    this.best = 0;
    this.shotPots = 0;
    this.pots = 0;
  }
}

/**
 * 结算判定：这一杆打完、球全停稳后该不该结束这一局。
 * @param timeUp 计时模式专用：限时是否已经耗尽（由主循环每帧标记，见 main.js）
 * @returns null（继续）| 'win'（清台 / 通关）| 'fail'（次数用尽 / 时间到）
 */
export function judgeAfterShot({ mode, diff, shots, potted, total, timeUp = false }) {
  // 本地双人：胜负只由"有没有合法打进黑八"决定（DuoMatch 判），
  // 这里不能按"进球数到了就赢"来判 —— 双人局里 15 颗球分属两方，清台数不是胜负条件。
  if (mode === 'duo') return null;
  // 顺序很重要：先看是否清台 —— 最后一杆刚好用完次数（或正好到点）但清台了，算通关不算失败
  if (potted >= total) return 'win';
  if (mode === 'limit') {
    const lim = shotLimit(mode, diff);
    if (lim != null && shots >= lim) return 'fail';
  }
  if (mode === 'timed' && timeUp) return 'fail';
  return null;
}

/** 毫秒 → mm:ss（超过一小时显示 h:mm:ss） */
export function fmtTime(ms) {
  const s = Math.max(0, Math.round((Number(ms) || 0) / 1000));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const ss = s % 60;
  const pad = (v) => (v < 10 ? '0' : '') + v;
  return h > 0 ? `${h}:${pad(m)}:${pad(ss)}` : `${pad(m)}:${pad(ss)}`;
}

/** 难度档位对哪些模式有意义（HUD / 历史展示都要看它） */
export function modeHasDiff(modeId) {
  return modeId === 'limit' || modeId === 'timed';
}

/**
 * 生成一条挑战历史（交给 public/history.js 落盘）。
 * ------------------------------------------------------------------
 * 除了"结果"，还记下一局的**过程数据**（击球次数 / 进球数 / 进球率 / 最高连击 /
 * 视角模式 / 平均瞄准时间）—— 启动器点开这条记录时的详情弹窗全部读它。
 * 这些字段都是**当场算好再存**，不在展示层重算：历史是"客观发生过的事"，
 * 以后改了计分口径也不该把老记录的数字算变。
 *
 * @param p.mode     玩法模式 id
 * @param p.diff     难度 id（限次 / 计时才有）
 * @param p.name     玩家名
 * @param p.ms       用时（毫秒）
 * @param p.shots    击球次数
 * @param p.potted   本局进球数（目标球，不含白球）
 * @param p.total    本局目标球总数（算进球率用）
 * @param p.best     本局最高连击
 * @param p.score    得分（仅计分模式）
 * @param p.timeLeft 剩余时间（仅计时模式，毫秒）
 * @param p.view     本局用的视角模式：'tracking' | 'free' | 'top'
 * @param p.aimMs    平均瞄准时间（毫秒）；没统计到任何一杆则为 null
 * @param p.aimCount 参与平均的杆数（"直接开球、没瞄准"的杆不计入）
 * @param p.result   'win' | 'fail' | 'clear'
 * @param p.winner   本地双人：获胜方 1 | 2（其它玩法恒为 null，见 history.js 的展示）
 */
export function makeRecord({
  mode, diff = null, name = '玩家1', ms = 0, shots = 0, potted = 0, total = 0,
  best = 0, score = null, timeLeft: leftMs = null, view = null,
  aimMs = null, aimCount = 0, result = 'win', winner = null,
}) {
  const m = getGameMode(mode);
  const withDiff = modeHasDiff(m.id);
  return {
    name: name,
    mode: m.id,
    diff: withDiff ? getDiff(diff).id : null,
    score: m.scored ? score : null,
    shots: shots,
    potted: Math.round(potted),
    total: Math.round(total),
    best: Math.round(best),
    left: shotsLeft(m.id, diff, shots),
    timeLeft: m.timed ? Math.max(0, Math.round(leftMs ?? timeLimit(m.id, diff) ?? 0)) : null,
    view: view,
    aimMs: aimMs == null ? null : Math.max(0, Math.round(aimMs)),
    aimCount: Math.max(0, Math.round(aimCount)),
    result: result,
    winner: winner === 1 || winner === 2 ? winner : null,
    ms: ms,
    ts: Date.now(),
  };
}

/**
 * 把某颗球从"已进袋"清单里摘掉（返回新数组，不动原数组 —— 便于断言）。
 * 目前唯一的用途：计分模式里提前打进黑 8，扣分之后黑 8 要**重新出现在初始位置**，
 * 那就不能再算它进过了 —— 不摘掉的话清台进度永远差一颗，
 * 玩家把台面打空也判不了通关（这是个会被玩出来的死局）。
 */
export function withoutPotted(potted, number) {
  return (potted || []).filter((n) => n !== number);
}

/**
 * 进球率（0~1）；没有击球记录时返回 null（而不是 0 —— "没打过"和"一颗没进"不是一回事）。
 */
export function potRate(potted, shots) {
  const s = Math.max(0, Number(shots) || 0);
  if (!s) return null;
  return Math.max(0, Math.min(1, (Number(potted) || 0) / s));
}
