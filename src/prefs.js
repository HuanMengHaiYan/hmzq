/**
 * 启动配置：力度区间 / 操作模式 / 是否锁定模式
 * ------------------------------------------------------------------
 * 三个来源，优先级从低到高：
 *   ① DEFAULT_PREFS        写死的默认值
 *   ② 本地存储（hmzq.prefs.v1）  上次在启动器或游戏内改过的值
 *   ③ URL 查询参数          从启动器跳转过来时携带（最权威，且不依赖存储可用性）
 *
 * 只有「游戏内 / 启动器里主动修改」才会写回存储；URL 参数本身不落盘，
 * 免得一次带参启动就把用户之前的设置覆盖掉。
 *
 * ⚠️ KEY 与 DEFAULT_PREFS 必须与 public/launcher.js 保持一致（启动器是独立页面，
 *    没法 import 这里）。改任意一边都要同步另一边。
 */
import { SHOT } from './constants.js';
import { isBallSet, DEFAULT_BALL_SET } from './rules.js';
import { isGameMode, isDiff, DEFAULT_DIFF } from './modes.js';
import { DUO_RULE_DEFAULTS, DUO_RULE_TABLES } from './duo.js';
import { host } from './platform/index.js';

const KEY = 'hmzq.prefs.v1';
const MIN_GAP = 0.05;                      // 最小力度与最大力度之间至少留的空隙
// 落盘去抖句柄。0.7.0 修：这个变量以前**根本没有声明**，`clearTimeout(saveTimer)` 在
// ESM 严格模式下直接抛 ReferenceError —— 表现是拖力度滑块 / 切操作模式时设置不落盘
// （模式按钮的高亮也不刷新，因为 sync() 排在抛错之后）。public/launcher.js 里一直有
// `var saveTimer = 0`，src 侧漏了。
let saveTimer = 0;

export const DEFAULT_PREFS = {
  min: 0.05, max: 1.20, mode: 'tracking', balls: DEFAULT_BALL_SET,
  name: '玩家1', game: 'free', diff: DEFAULT_DIFF,
  // 本地双人 / 人机：轮到自己时把"不该打的球"画成半透明（'on' | 'off'）。
  // ⚠️ key 与默认值必须与 public/launcher.js 的 DEFAULTS 保持一致（那边是独立页面）。
  ghost: 'on',
  // 本地双人模式的规则（只在双人模式里生效，见 duo.js）。
  // ⚠️ 这些 key / 默认值 / 合法值必须与 public/launcher.js 的镜像保持一致。
  ...DUO_RULE_DEFAULTS,
};

/** 玩家名：写进挑战历史的那一项（设置里可改，最长 12 字） */
export function sanitizeName(v) {
  const s = String(v == null ? '' : v).trim().slice(0, 12);
  return s || DEFAULT_PREFS.name;
}

const LIMITS = {
  min: [0.05, 1.00],
  max: [0.10, 1.50],
};
const MODES = ['free', 'tracking', 'top'];

function clampNum(v, [lo, hi], d) {
  const n = parseFloat(v);
  if (!Number.isFinite(n)) return d;
  return Math.min(hi, Math.max(lo, n));
}

/** 把任意来源的值收拾成合法配置（越界、NaN、模式名写错一律回落到默认） */
export function sanitizePrefs(raw) {
  const o = Object.assign({}, DEFAULT_PREFS, raw || {});
  const out = {
    min: clampNum(o.min, LIMITS.min, DEFAULT_PREFS.min),
    max: clampNum(o.max, LIMITS.max, DEFAULT_PREFS.max),
    mode: MODES.includes(o.mode) ? o.mode : DEFAULT_PREFS.mode,
    balls: isBallSet(o.balls) ? String(o.balls) : DEFAULT_PREFS.balls,
    name: sanitizeName(o.name),
    game: isGameMode(o.game) ? o.game : DEFAULT_PREFS.game,
    diff: isDiff(o.diff) ? o.diff : DEFAULT_PREFS.diff,
    // 只有 'off' 是关，其它一切（含写坏的）都按开处理 —— 半透明是"默认就该有"的辅助
    ghost: o.ghost === 'off' ? 'off' : 'on',
  };
  // 双人规则：只认 DUO_RULE_TABLES 里有的值，写坏了回落到默认
  for (const [key, table] of Object.entries(DUO_RULE_TABLES)) {
    out[key] = table[o[key]] ? o[key] : DUO_RULE_DEFAULTS[key];
  }
  if (out.max < out.min + MIN_GAP) out.max = Math.min(LIMITS.max[1], out.min + MIN_GAP);
  return out;
}

/** 读存储里的设置 */
export function readPrefs() {
  return sanitizePrefs(host.storage.get(KEY, null));
}

/** 写回存储（启动器下次打开时能看到游戏内的改动） */
export function writePrefs(p) {
  const s = sanitizePrefs(p);
  host.storage.set(KEY, s);
  return s;
}

/**
 * **局部**改动：只覆盖传进来的那几项，其余沿用存储里已有的值。
 * ------------------------------------------------------------------
 * ⚠️ 不能直接用 writePrefs({min, max, mode}) —— sanitizePrefs 会把没传的字段
 *    填回默认值，等于玩家在游戏里拖一下力度滑块，刚在启动器里设好的双人规则
 *    就被悄悄冲掉了（这类"改 A 丢 B"最难联想到原因）。
 */
export function patchPrefs(patch) {
  return writePrefs(Object.assign({}, readPrefs(), patch));
}

/** 解析启动器带来的查询参数（没有则全为 null） */
export function readLaunchParams() {
  const q = new URLSearchParams(host.env === 'web' || host.env === 'electron'
    ? globalThis.location?.search || ''
    : '');
  const mode = q.get('mode');
  const balls = q.get('balls');
  return {
    mode: MODES.includes(mode) ? mode : null,
    balls: isBallSet(balls) ? balls : null,
    min: q.has('min') ? clampNum(q.get('min'), LIMITS.min, null) : null,
    max: q.has('max') ? clampNum(q.get('max'), LIMITS.max, null) : null,
    locked: q.get('lock') === '1',          // 启动器进来的：游戏内不允许切换模式
    fromLauncher: q.get('from') === 'launcher',
    // 玩法模式（单人模式二选一）+ 限次模式难度：由启动器带过来
    game: isGameMode(q.get('game')) ? q.get('game') : null,
    diff: isDiff(q.get('diff')) ? q.get('diff') : null,
    // 直接端出结算弹窗（调试 / 预览用）：?ending=win|lose|foul8
    ending: ['win', 'lose', 'foul8'].includes(q.get('ending')) ? q.get('ending') : null,
    // 配 &record=1 时走**完整结算链路**（含写挑战历史），用来验证"打完一局"这条路径。
    // 默认不开：预览结算不该把假数据写进玩家的历史。
    record: q.get('record') === '1',
  };
}

/**
 * 最终生效的启动配置。
 * @returns {{min:number, max:number, mode:string, balls:string, locked:boolean,
 *            fromLauncher:boolean, ending:string|null}}
 */
export function resolveLaunchConfig() {
  const stored = readPrefs();
  const q = readLaunchParams();
  return {
    min: q.min ?? stored.min,
    max: q.max ?? stored.max,
    mode: q.mode ?? stored.mode,
    balls: q.balls ?? stored.balls,
    name: stored.name,
    game: q.game ?? stored.game,
    diff: q.diff ?? stored.diff,
    ghost: stored.ghost,
    // 本地双人的规则（不走 URL：它们是"设置"不是"玩法"，改一次就一直生效）
    breakAssign: stored.breakAssign,
    breakEight: stored.breakEight,
    cueFoul: stored.cueFoul,
    earlyEight: stored.earlyEight,
    // 犯规罚则（0.7.0，体检 G4）：与双人规则同一条路（DUO_RULE_DEFAULTS 已并入 DEFAULT_PREFS）
    foulMiss: stored.foulMiss,
    foulWrongBall: stored.foulWrongBall,
    foulNoPot: stored.foulNoPot,
    locked: q.locked,
    fromLauncher: q.fromLauncher,
    ending: q.ending,
    record: q.record,
  };
}

/** 把力度区间灌进 SHOT（游戏内所有力度换算都读这两个字段） */
export function applyPowerRange(cfg) {
  SHOT.minImpulse = cfg.min;
  SHOT.maxImpulse = cfg.max;
}

/**
 * 把当前 SHOT 与模式存回设置（游戏内改动 → 启动器可见）。
 * 走 patchPrefs：只改这四项，别把玩家在启动器里设的其它规则冲掉。
 */
export function persistFromGame(mode, balls) {
  const patch = { min: SHOT.minImpulse, max: SHOT.maxImpulse, mode, balls };
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => patchPrefs(patch), 260);
}
