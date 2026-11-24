import { CAM } from './constants.js';
import { getGameMode } from './modes.js';

/**
 * 全局运行状态。
 * 这是整个游戏唯一的可变状态树：各模块（相机 / 瞄准 / 进袋判定 / HUD）都只读它、只改自己那一块，
 * 不再各自持有互相看不见的模块级变量。
 */
export function createState() {
  return {
    shooting: false,          // 是否有球还在运动（决定能否出杆）
    shots: 0,                 // 已击球次数
    lastPower: 0,             // 上一杆的力度 0~1
    potted: [],               // 本局已进袋的目标球号码
    pottedTotal: 15,          // 本局球组的目标球总数（由 rules.js 的球体设置决定）
    ballSet: '15',            // 当前球组 id（见 rules.js）
    cueNeedsRespawn: false,   // 白球被打进袋，停稳后放回开球点
    matchOver: false,         // 本局是否已结算（结算弹窗开着，或已判胜负）
    uiBlocked: false,         // 有模态弹窗开着（帮助 / 设置 / 结算 / 确认）：挡住球台的一切输入
    ghostOn: true,            // 「非己方球半透明」开关（双人 / 人机用，见 main.js 的 refreshGhost）

    // ---- 玩法模式（见 modes.js）----
    modeId: 'free',           // 'free' | 'score' | 'limit' | 'timed' | 'freeball' | 'duo'（人机 / 联机是后续阶段）
    duoWinner: null,          // 本地双人：获胜方 1 | 2（结算弹窗要写"玩家X 获胜"）
    duo: null,                // 本地双人：DuoMatch 的快照（回合 / 分组 / 剩余，见 duo.js）
    scored: false,            // 本模式是否计分（由 applyGameMode 从模式表写入，HUD / 结算只看它）
    placingCue: false,        // 自由球模式：正在摆白球（期间不能蓄力、准星也不给动）
    placeAt: null,            // 摆放阶段白球被钉住的位置 {x,z}（每帧回设，见 main.js）
    diff: null,               // 限次 / 计时模式的难度：'easy' | 'normal' | 'hard'
    score: 0,                 // 计分模式得分（HUD 显示用，权威在 ScoreBoard）
    shotsLeft: null,          // 限次模式剩余次数（非限次模式为 null）
    timeLeftMs: null,         // 计时模式剩余时间（主循环每帧刷新）
    timeUp: false,            // 计时模式：时间已耗尽（等球停稳后判负）

    // ---- 瞄准统计（挑战历史的"平均瞄准时间"）----
    // 口径：用户开始动准星（或转视角，两者都体现为 aimAngle 变化）那一刻算"开始瞄准"，
    // 点开球那一刻算结束；两次出杆之间**一次都没动过**的（直接开球）不计入平均。
    lockedAim: 0,             // 蓄力瞬间锁定的出杆方向（出杆只认它，见 main.js 的 fireShot）
    aimMark: 0,               // 本杆瞄准开始的时刻（0 = 还没开始）
    aimSeen: 0,               // 上一帧的 aimAngle（检测"准星动了没有"）
    aimAcc: 0,                // 本局累计瞄准时长（毫秒）
    aimCount: 0,              // 本局参与平均的杆数

    mode: 'tracking',         // 'free' | 'tracking' | 'top'（这是"操作模式"，别和 modeId 混）
    modeLocked: false,        // 从启动器进入时为 true：操作模式由启动器决定，游戏内不可切换
    breakShot: false,         // 本杆是不是开球（决定要不要走"开球保护"）
    breakShockPending: false, // 开球冲击波：等白球贴到球堆的那一刻触发
    breakDir: { x: 1, z: 0 }, // 本杆开球方向（冲击波按它分配动量）
    pottedThisShot: 0,        // 本杆已落袋数（仅在启用开球保护时用于限流）
    pocketsClosed: false,     // 袋口是否被盖板封住（true = 球滚过去不会掉）
    pocketReopenTimer: 0,     // 本杆停稳后重新开袋前的缓冲（把停在袋口上的球顶回台面）
    pocketReopenTries: 0,     // 重新开袋时"轻推悬在袋口的球"的次数（死锁保险丝）
    rattleStrikes: new Map(), // 球 → 本杆被"抖回台面"的次数（死锁保险丝，见 pockets.js）
    trackPhase: 'aiming',     // 追踪模式：'aiming'（瞄白球）| 'watching'（击球后拉远看全局）
    autoFocusArmed: false,    // 击球后：等球停稳自动把视角拉回白球后方
    autoFocusTimer: 0,
    aiAiming: false,          // 🤖 电脑正在转杆：追踪模式下改成"瞄准角决定相机"（见 camera-rig.js）
    charging: false,
    chargeT: 0,
    chargePower: 0,           // 0~1 当前蓄力值
    aimAngle: 0,              // 击球方向方位角（弧度），方向向量 = (sin,0,cos)
    camBack: CAM.aimDist,     // 追踪模式瞄准时相机水平距离
    cueAnim: 0,               // 击球动画进度 0~1
    camTween: null,           // {fromPos,toPos,fromTgt,toTgt,t,dur}
  };
}

/** 每一杆开始：清掉上一杆的临时计数，并登记本杆的开球信息 */
export function beginShot(state, dir) {
  state.pottedThisShot = 0;
  state.breakShot = state.shots === 1;      // 第一杆 = 开球（按 R 重摆后重新计数）
  // 开球冲击波：等白球贴到球堆的那一瞬间再触发（若打空就永远不会触发）
  state.breakShockPending = state.breakShot;
  state.breakDir = { x: dir.x, z: dir.z };
}

/** 每一杆结束（球全部停稳） */
export function endShot(state) {
  state.pottedThisShot = 0;
  state.breakShockPending = false;   // 本杆没撞上球堆：冲击波作废
  state.breakShot = false;           // 开球这一杆结束：传导随机化随之关闭
}

/** 重摆一局（R 键）：只清"这一局的进度"，模式本身（modeId / diff）保持不变 */
export function resetMatch(state) {
  state.potted = [];
  state.shots = 0;
  state.lastPower = 0;
  state.duoWinner = null;
  state.shooting = false;
  state.cueNeedsRespawn = false;
  state.autoFocusArmed = false;
  state.matchOver = false;
  state.pottedThisShot = 0;
  state.breakShot = false;
  state.breakShockPending = false;
  state.score = 0;
  state.shotsLeft = null;
  state.timeUp = false;
  state.placeAt = null;
  state.placingCue = false;
  state.aimMark = 0;
  state.aimSeen = state.aimAngle;
  state.aimAcc = 0;
  state.aimCount = 0;
}

/**
 * 把玩法模式写进状态（限次模式顺便算出剩余次数、计时模式顺便记下剩余时间）
 * @param shotsLeft 剩余次数（非限次模式传 null）
 * @param limitMs   本局总时长（非计时模式传 null，只用于算 timeLeftMs）
 */
export function applyGameMode(state, modeId, diff, shotsLeft, limitMs = null) {
  const m = getGameMode(modeId);
  state.modeId = m.id;
  state.scored = !!m.scored;        // HUD 的得分行 / 结算的得分行都只看这一个标志
  state.diff = diff ?? null;
  state.shotsLeft = shotsLeft ?? null;
  state.timeLeftMs = limitMs ?? null;
  state.timeUp = false;
}
