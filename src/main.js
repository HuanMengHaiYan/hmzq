import * as THREE from 'three';
import RAPIER from '@dimforge/rapier3d-compat';

import { AI, AIM, BALL_R, CUE, PHYS, SHOT, RULES } from './constants.js';
import { buildTable } from './table.js';
import { mountTableModel, modelState, applyTextureSize } from './table-model.js';
import {
  createBalls, resetBalls, respawnBallToRack, respawnCue, syncBalls, hideBall, holdBall, releaseBall,
  setBallGhost,
} from './balls.js';
import { duoTargets } from './auto-aim.js';
import { planAiShot, aiPlaceCue, aiLevel, isAiLevel, makeRnd } from './ai.js';
import { rackLayoutFor, clampCuePlace } from './layout.js';
import { applyBallSetToState } from './rules.js';
import { clampBallSpeeds, randomizeBallImpacts, applyRollFriction } from './sim.js';
import { createState, resetMatch, applyGameMode } from './state.js';
import {
  ScoreBoard, getGameMode, getDiff, modeHasDiff, shotsLeft, timeLimit, timeLeft,
  isPrematureEight, judgeAfterShot, makeRecord, withoutPotted,
} from './modes.js';
import { DuoMatch, groupOf } from './duo.js';
import { createDuoUI } from './duo-ui.js';
import { pushRecord } from './history.js';
import { Stage } from './stage.js';
import { CameraRig } from './camera-rig.js';
import { Aimer, aimVector } from './aimer.js';
import { Hud } from './hud.js';
import { PocketReferee } from './pockets.js';
import {
  shoot, maybeBreakShock, updateRestState, snapshotVelocities, respawnCueIfIdle,
} from './shot.js';
import { bindInput, toggleHud, topAimAngle, chargePower } from './input.js';
import { wireGameUI } from './settings.js';
import { resolveLaunchConfig, applyPowerRange } from './prefs.js';
import { AudioEngine } from './audio.js';
import { Music } from './music.js';
import { ComboAnnouncer } from './combo.js';
import { createResultUI, createMatchEnd, isEarlyEight } from './result.js';
import { createConfirm } from './confirm.js';
import { Quality } from './quality.js';
import { mountQualityUI } from './quality-ui.js';
import { host } from './platform/index.js';
import { markMobileShell, bindShootButton } from './mobile.js';
import { initAndroidBack } from './android.js';

/**
 * 幻梦-星光桌球 · 入口
 * 只做三件事：建世界 → 把各子系统接起来 → 跑主循环。
 * 渲染看 stage.js，机位看 camera-rig.js，瞄准看 aimer.js，
 * 进袋规则看 pockets.js，出杆与静止判定看 shot.js，界面看 hud.js / settings.js，
 * 启动配置（力度区间 / 操作模式 / 球体设置）看 prefs.js 与 rules.js，
 * 声音看 audio.js（引擎）/ voices.js（合成音色）/ music.js（背景音乐）/
 * combo.js（连击播报），结算弹窗看 result.js。
 *
 * ── 本文件地图（963 行的胶水层，按下面的顺序排列，搜名字即可定位）──
 *   启动配置与 init()          —— 建世界、把各子系统接起来
 *   出杆链路                   —— applyMode / beginCharge / releaseCharge / fireShot
 *   摆球与重开                 —— requestRestart / enterPlacing / confirmPlacement /
 *                                dragCueBall / pinCueToPlace / rackEmUp
 *   落袋与计分                 —— isWrongBall / onPotted / scorePot / respawnBlackEight
 *   主循环                     —— animate / tickClock / tickAimStat / sceneDirty /
 *                                trackFps / stepPhysics / now / elapsedMs / playImpact
 *   本杆收尾                   —— ensureCueOnTable / onAllStopped
 *   本地双人                   —— applyDuoVerdict / respotBalls / syncDuo / refreshGhost
 *   人机回合状态机             —— tickAi / resetAi / aiStartThink / aiFire / aiPlaceStep
 *   杂项与结算                 —— liveBalls / wrapPi / showAutoTip / finishMatch
 *
 * ⚠️ 这个文件是全项目唯一"知道所有子系统"的地方，刻意不往下拆：
 *    拆成跨文件传参会让它从"一处能读完的状态机"变成"得来回跳才能看懂的调用图"，
 *    排查 bug 反而更难。第四阶段接联机时如果再涨，优先把**联机适配**单独成文件，
 *    这里只留一行 `net.on(...)` 的接线。
 */

// 启动配置：默认值 ← 本地存储 ← 启动器带来的 URL 参数（后者优先）
const launch = resolveLaunchConfig();
applyPowerRange(launch);

const audio = new AudioEngine();            // 实时合成的击球声（首次点击/按键后才能真正出声）
const music = new Music(audio);             // 背景音乐（曲目与音量存同一份设置）
const combo = new ComboAnnouncer(audio);    // 落袋欢呼 + 连击语音
audio.onUnlock = () => music.apply();       // 解锁那一刻才开始播 BGM

const state = createState();
state.modeLocked = launch.locked;
applyBallSetToState(state, launch.balls);    // 球体设置：决定桌上有哪些球
// 玩法模式（自由 / 计分 / 限次）：HUD 与结算都读它
const gameMode = getGameMode(launch.game);
const gameDiff = modeHasDiff(gameMode.id) ? getDiff(launch.diff) : null;
applyGameMode(state, gameMode.id, gameDiff?.id ?? null,
  shotsLeft(gameMode.id, gameDiff?.id, 0), timeLimit(gameMode.id, gameDiff?.id));
const board = new ScoreBoard();              // 计分模式的权威分数（自由 / 限次模式下不显示）
// 本地双人：规则引擎（可变规则从启动器的「规则设置」里带来，见 prefs.js）
// 非双人模式保持 null —— 下面所有 `duo &&` 的分支就是靠它整段不参与。
const duo = gameMode.duo
  ? new DuoMatch({
    breakAssign: launch.breakAssign,
    breakEight: launch.breakEight,
    cueFoul: launch.cueFoul,
    earlyEight: launch.earlyEight,
    // 犯规罚则（0.7.0，体检 G4）：默认全 'none'（只换人），在启动器「规则设置 → 双人规则」里开
    foulMiss: launch.foulMiss,
    foulWrongBall: launch.foulWrongBall,
    foulNoPot: launch.foulNoPot,
  })
  : null;
// 调试钩子与 HUD 都能读到这一局的双人状态（`__hmzq.duo` 看回合 / 分组 / 剩余）
if (duo) state.duo = duo;
// 人机对战：电脑扮演**玩家2**（默认中式黑八，与本地双人同一套规则）。
// 难度单独取（不走 gameDiff）—— 那一位是限次 / 计时模式的"关卡难度"，混用会把 HUD 搞乱。
const aiLevelId = gameMode.ai ? (isAiLevel(launch.diff) ? launch.diff : AI.defaultLevel) : null;
// 电脑的大脑：非人机模式为 null，下面所有 `aiBrain &&` 的分支整段不参与。
// ⚠️ rnd 不给种子 → 每局抖动都不一样（给种子的话电脑会逐渐露出规律，玩家能背下来）。
const aiBrain = aiLevelId ? { level: aiLevelId, rnd: makeRnd() } : null;
// 「非己方球半透明」开关（游戏设置里可改）：只在双人 / 人机里用得上，见 refreshGhost。
// 默认开 —— 这是帮玩家一眼分清"该打哪颗"的辅助，关掉的人多半是嫌它挡视线。
state.ghostOn = launch.ghost !== 'off';
// 结算：播音效 + 弹窗（win 自动触发；lose / foul8 备用，见 result.js）
const endMatch = createMatchEnd({
  state, audio, combo, getResult: () => result, getElapsed: () => elapsedMs(),
});
const prevVel = new Map();       // 碰撞传导随机化：每步的撞前速度
const pointer = { x: 0, y: 0 };
const _ballPos = new THREE.Vector3();
const _dir = new THREE.Vector3();

let world, eventQueue;
let stage, rig, hud, aimer, referee, result, quality, confirmUI;
let balls = [], cue = null, sensors = [], ballBodies = [];
let colliderToBall = new Map();
let cushionHandles = new Set();   // 库边碰撞体句柄：区分"撞库"和"球撞球"
let rackAnchors = [];
let accumulator = 0;             // 跨帧持久的物理时间累加器（关键：不能每帧重置）
let shootBtn = { sync() {} };    // 移动端「开球」键（桌面为空实现）
let placeBar = null;             // 自由球模式：底部「拖动白球 → 确定」浮条
let duoUI = null;                // 本地双人：回合横幅 + 左右两个开球键
// 🤖 人机对战：电脑回合的小状态机（非人机模式这几个量整段不参与）
let aiPhase = 'idle';            // 'idle' 待命 | 'think' 思考 | 'aim' 转杆 | 'place' 摆手中球
let aiPlan = null;               // 电脑这一杆的方案（目标角 / 力度 / 思考时长 / 提示文案）
let aiT = 0;                     // 计时（ms）：思考、转杆、摆球各用一次
let aiFrom = 0;                  // 转杆起始角（转到 aiPlan.aimAngle 为止）
let aiDelta = 0;                 // 转杆要扫过的角度（已归一化到最短一侧）
let aiDur = 0;                   // 这一次的转杆时长（ms）
let shadowAim = 0;               // 上一帧杆向：判断"杆有没有动"（阴影按需刷新用）
let fpsT = 0;                    // 帧率统计窗口
let fpsN = 0;
let matchT0 = 0;                 // 本局开始时刻（挑战历史要记用时）

init();

/**
 * 是否用 GLB 桌面模型（0.8.0 起**默认启用**）。
 * 参数化桌面仍然保留，作为"模型加载失败"时的兜底（不会变成看不见的桌子）。
 * 想回到 0.7.0 的方块桌面：地址后加 `?model=0`（调试 / 对照用）。
 */
function wantTableModel() {
  try {
    const q = new URLSearchParams(globalThis.location?.search || '');
    return q.get('model') !== '0';
  } catch {
    return true;
  }
}

async function init() {
  markMobileShell();             // 触摸设备上给 <html> 打标记，CSS 切到移动端布局
  // APP 里的返回键（浏览器 / Electron 里是空操作）。返回注销函数交给 shutdown：
  // 页面卸载时要把原生监听一并摘掉（体检 B5）。
  const disposeAndroidBack = initAndroidBack();

  /**
   * 页面卸载：网页 / Electron 整页跳转本来会连文档一起回收，
   * 但 Capacitor 壳可能复用 WebView —— 统一在这里收掉原生监听与渲染资源。
   */
  const shutdown = () => {
    disposeAndroidBack?.();
    stage?.dispose?.();
  };
  host.on(globalThis, 'pagehide', shutdown);

  // ---------- 物理世界 ----------
  await RAPIER.init();
  world = new RAPIER.World(PHYS.gravity);
  world.timestep = PHYS.timestep;
  try {
    world.numSolverIterations = 8;
  } catch { /* 版本差异，忽略 */ }
  eventQueue = new RAPIER.EventQueue(true);

  // ---------- 场景 / 球桌 / 球 ----------
  stage = new Stage();

  // 画质要在建台之前拿到 —— 模型的贴图档位是"加载时就按当前画质选"，不是加载完再改
  // （先建成 2048 再缩到 512 会白白解一次 45 MB 的图）。
  quality = new Quality(stage, {
    onTextureSize: (n) => {
      if (modelState.status === 'ready') applyTextureSize(n);
    },
  });

  // ---------- 0.8.0：真实台球桌模型（纯外观）----------
  // 加载失败会返回 null，下面就会走回原来的参数化桌面 ——
  // 也就是说"模型坏了"最坏是看到旧桌子，不会变成看不见的桌子。
  const model = await mountTableModel(stage.scene, {
    enabled: wantTableModel(),
    texSize: quality.resolved.texSize,
  });
  if (model) {
    // 真实 9 尺台的台面高 800mm，比参数化桌面（600mm）高 150mm：地面跟着往下挪，
    // 否则六条桌腿会插进地板里（参数化桌面的腿高就是照着旧地面定的）。
    stage.setFloorY(modelState.bottom);
    console.info('[table] 使用 GLB 桌面模型',
      modelState.size, modelState.triangles + ' tris',
      '贴图 ' + modelState.texSize + '²/' + modelState.texMs + 'ms');
  }
  const table = buildTable(stage.scene, world, RAPIER, {
    hideVisual: !!model,
    // 外框碰撞围墙按**模型实测外沿**给：模型的木框比参数化桌面（1.41 / 0.775）宽出
    // 4~6cm，围墙留在旧位置的话，飞出台面的球会先撞在一圈比视觉木框还小的隐形墙上。
    railHalfL: modelState.size ? modelState.size.x / 2 : undefined,
    railHalfW: modelState.size ? modelState.size.z / 2 : undefined,
  });
  sensors = table.sensors;
  cushionHandles = table.cushionHandles;

  const created = createBalls(stage.scene, world, RAPIER);
  balls = created.balls;
  cue = created.cue;
  ballBodies = balls.map((b) => b.body);
  colliderToBall = new Map(balls.map((b) => [b.collider.handle, b]));
  resetBalls(balls, state.ballSet);            // 按球体设置上桌（非本组的球收起）
  rackAnchors = rackLayoutFor(state.ballSet);  // 开球冲击波用的摆位

  // ---------- 画质（阴影精度 / 渲染分辨率 / 贴图精度 / 纹理过滤）----------
  quality.apply();

  // ---------- 子系统 ----------
  hud = new Hud();
  confirmUI = createConfirm({ state });   // 会丢进度的操作（重开本局）先问一句
  aimer = new Aimer(stage.scene);
  rig = new CameraRig(stage, state, cue);
  referee = new PocketReferee({
    state, balls, sensors,
    lids: table.lids,
    world,
    byHandle: colliderToBall,
    onPot: onPotted,
  });

  // ---------- 输入 / 界面 ----------
  const vp = host.viewport();
  pointer.x = vp.w / 2;
  pointer.y = vp.h / 2;
  // 能不能出杆（键鼠与开球键共用一条判据）。双人模式多一条：分出胜负之后谁都按不动。
  const canShoot = () => !cue.potted && !state.placingCue && !(duo && duo.over);
  bindInput(stage.domElement, state, {
    canCharge: canShoot,               // 摆球阶段不给蓄力（先点「确定」）
    onChargeStart: beginCharge,
    onChargeEnd: releaseCharge,
    onPointerMove: (x, y) => {
      pointer.x = x;
      pointer.y = y;
      if (state.charging) hud.moveCharge(x, y);
    },
    onPlaceMove: dragCueBall,        // 自由球模式：拖动白球（见下面的 enterPlacing）
    onTopAim: (x, y) => {
      const a = topAimAngle(stage, cue, x, y);
      if (a !== null) state.aimAngle = a;
    },
    onReset: requestRestart,
    onToggleDebug: () => stage.toggleDebug(sensors),
    onToggleHud: toggleHud,
  });
  // 出杆键：PC / web / 移动端都有（见 mobile.js 的 bindShootButton）。
  // 双人模式换成左右两个键（玩家2 在左、玩家1 在右），只有当前回合那一个可按。
  if (duo) {
    duoUI = createDuoUI({
      state,
      match: duo,
      canCharge: canShoot,
      onStart: beginCharge,
      onEnd: releaseCharge,
      ai: !!aiBrain,                      // 人机对战：玩家2 那个键永远置灰（电脑自己会打）
      bindShoot: bindShootButton,
    });
    duoUI.show(true);
    shootBtn = { sync() {} };          // 双人模式的键由 duoUI 自己每帧同步
  } else {
    shootBtn = bindShootButton({
      state,
      canCharge: canShoot,
      onStart: beginCharge,
      onEnd: releaseCharge,
    });
  }
  result = createResultUI({
    state,
    onRestart: rackEmUp,
    onBackToMenu: () => host.goto('launcher.html'),
  });
  wireGameUI({
    state,
    audio,
    onMode: applyMode,
    onResetView: () => rig.resetView(),
    onRestart: requestRestart,
    onBackToMenu: () => host.goto('launcher.html'),
  });
  music.apply(audio.settings);   // 先把播放器建好；出声要等用户手势
  // 画质面板：选项表在 quality.js，DOM 由 quality-ui.js 生成（启动器里也有一份同样的设置）
  const qualityUI = mountQualityUI(quality);
  host.on(host.byId('btn-settings'), 'click', () => qualityUI?.sync());
  host.byId('loading')?.classList.add('hide');
  // 面板标题换成玩法模式（自由模式保留 PHASE 标记）。
  // 人机对战的难度是"电脑的水平"，不是关卡难度（gameDiff 是限次 / 计时那一档），两者别混。
  const diffName = gameDiff?.name || (aiLevelId ? aiLevel(aiLevelId).name : '');
  if (gameMode.id !== 'free') hud.setModeLabel(gameMode.name + (diffName ? ' · ' + diffName : ''));
  matchT0 = now();
  hud.update(state, cue.potted);
  applyMode(launch.mode);   // 启动器指定的模式（默认追踪：相机自动对焦到白球后方）
  // 开局这一次 aimAngle 是 setMode 自己摆的（相机对焦方向），不算"用户动过准星"
  state.aimSeen = state.aimAngle;
  state.aimMark = 0;
  // 自由球模式（娱乐模式的第一套玩法）：开局先进"摆白球"阶段 ——
  // 拖动白球 → 点「确定」→ 才进入瞄准（用户定的流程）
  placeBar = host.byId('place-bar');
  host.on(host.byId('place-ok'), 'click', confirmPlacement);
  if (gameMode.placing) enterPlacing();
  syncDuo();                 // 本地双人：开局先把横幅画出来（轮到玩家1）
  // 调试 / 预览：?ending=win|lose|foul8 直接把结算弹窗端出来。
  // 加 &record=1 则走完整结算链路（含写挑战历史），用来端到端验证"打完一局"这条路径。
  if (launch.ending) {
    if (launch.record) finishMatch(launch.ending === 'win' ? 'win' : 'lose');
    else endMatch(launch.ending);
  }
  // 调试钩子：端到端测试与真机排查都靠它读内部状态（单机游戏，无敏感数据）。
  // 例：控制台里 `__hmzq.state.placeAt` 看自由球当前摆到哪、`__hmzq.rig.controls.enabled`
  // 看相机手势是不是被关掉了。
  // `duoApply` 也交出去：本地双人的判决分支（罚球回位 / 白球落袋后自由摆球）只能由
  // "打进黑八""白球掉袋"这类事件触发，端到端测试没法稳定复现，所以留一个直接调用判决的钩子
  // （判定逻辑本身仍全在 duo.js 里，这里只是"把判决落地"的那一层）。
  // `aiPeek`：人机对战的电脑回合进度（端到端靠它断言"电脑真的在转杆 / 真的打出去了"，
  // 光看"没报错"证明不了 —— 早期 onPlaceMove 就是死代码也没人发现）。
  host.expose?.('__hmzq', {
    state, cue, balls, rig, stage, quality, hud, duo, duoUI, duoApply: applyDuoVerdict,
    model: modelState,
    aiPeek: () => ({
      level: aiBrain?.level ?? null,
      phase: aiPhase,
      aimAngle: aiPlan?.aimAngle ?? null,
      number: aiPlan?.number ?? null,
      power: aiPlan?.power ?? null,
    }),
  });
  animate();
}

/* ---------------------------------------------------------
 * 模式切换（相机 + 舞台一起换）
 * 操作模式由启动器决定，游戏内不可切换，所以没有"循环切换"的入口了。
 * ------------------------------------------------------- */
function applyMode(mode) {
  rig.setMode(mode);
  stage.setLampVisible(mode !== 'top');   // 顶视：灯罩会挡住俯视画面，隐藏
  // 3D 定位只给球撞球：顶视固定音量（俯视全景没有左右方位概念），
  // 自由 / 追踪模式才按"相机 → 事件点"做左右声道与距离衰减。
  // 撞库 / 出杆 / 落袋 / 结算音一律固定音量，不做衰减。
  audio.setSpatial(mode !== 'top');
}

/* ---------------------------------------------------------
 * 蓄力 & 出杆
 * ------------------------------------------------------- */
function beginCharge() {
  if (state.shooting || cue.potted || state.charging) return;
  state.charging = true;
  state.chargeT = 0;
  state.chargePower = 0;
  // 出杆方向在"按下的这一刻"就定死 —— 蓄力期间无论手指怎么动、相机怎么补间、
  // 有没有残留的惯性滑动，打出去的都是玩家按下时瞄准的那个方向（见 fireShot）。
  state.lockedAim = state.aimAngle;
  rig.lockAim();                    // 冻结机位（取消补间 + 吃掉阻尼惯性 + 关手势）
  hud.showCharge(pointer.x, pointer.y);
}

function releaseCharge() {
  if (!state.charging) return;
  // 力度就是蓄力条读数：power = 0 出杆即"最小力度"，所以设置里那一项是精确可达的。
  // （以前这里写了 Math.max(chargePower, 0.06)，等于给了一个隐藏下限，
  //   滑块下半段怎么调都没感觉 —— 现在最大值/最小值就是力度区间的两个端点。）
  state.charging = false;
  hud.hideCharge();
  rig.enableControls();
  fireShot(state.chargePower);
}

function fireShot(power) {
  // ⚠️ 只用蓄力瞬间锁定的方向（state.lockedAim），不读"此刻"的 aimAngle。
  // 这是"松开开球后白球方向突然变了"的根治点：出杆方向不再受蓄力期间的任何
  // 指针移动 / 相机旋转 / 惯性滑动影响。
  const angle = state.lockedAim;
  if (!shoot({ state, cue, power, aimAngle: angle })) return;
  duo?.beginShot();                            // 本地双人：本杆的落袋登记清零（见 duo.js）
  state.aimAngle = angle;                      // 与出杆方向对齐（观战/顶视期间可能已被改到别处）
  referee.openLids();                          // 每一杆开局：袋口恢复敞开
  audio.cueStrike(power);                      // 出杆声：力度决定亮度与响度
  combo.onShotStart();                         // 本杆的进球计数清零
  board.onShotStart();                         // 计分：本杆进球数清零
  state.shotsLeft = shotsLeft(state.modeId, state.diff, state.shots);
  // 瞄准统计：按下开球前动过准星才算这一杆的瞄准时长（直接开球的不计入）
  if (state.aimMark) {
    state.aimAcc += Math.max(0, Math.round(now() - state.aimMark));
    state.aimCount += 1;
  }
  state.aimMark = 0;
  state.aimSeen = state.aimAngle;
  if (state.mode === 'tracking') rig.onShotFired();
  hud.update(state, cue.potted);
}

/**
 * R 键 / 「⟳ 重开本局」的入口：先问一句，确认了才真的重开。
 * ------------------------------------------------------------------
 * 为什么必须问：重开会把这一局的进度全丢掉，而它是**不写进挑战历史**的
 * （只记打完的局）—— 误触一次就等于白打，且列表里连痕迹都没有。
 * 所以弹窗里要把这件事说清楚，而不是只说"确定重开吗"。
 * 已经判完胜负（结算弹窗开着）时不用问：那一局早已落库，重开是"再来一局"。
 */
function requestRestart() {
  if (state.matchOver) { rackEmUp(); return; }
  confirmUI.ask({
    title: '重开本局？',
    sub: '这一局的进度会全部清空，并且不会记入挑战历史。',
    ok: '重开',
    onOk: rackEmUp,
  });
}

/* ---------------------------------------------------------
 * 自由球模式（娱乐模式第一套玩法）：摆白球 → 确定 → 瞄准
 * -------------------------------------------------------
 * **每一杆**开球前都先把白球摆到顺手的位置（等于真实台球的"手中球"，
 * 刻意做成开挂 / 纯练习的手感）：玩家拖动白球 → 点「确定」→ 才进入瞄准阶段。
 *
 * ⚠️ 相机不能锁死（早先用 rig.lockAim()，结果右键转视角与滚轮缩放一起废了）：
 *    摆球时玩家还得绕着台面看、缩放找落点。真正要停的是"相机自动跟随白球"——
 *    那一半在 CameraRig.update() 里（摆球时跳过），见 rig.setPlacing() 的注释。
 */
function enterPlacing(silent = false) {
  if (state.matchOver || state.placingCue) return;
  state.placingCue = true;
  state.placeAt = null;              // 白球就在台上（开局在开球点 / 落袋后已复位）
  holdBall(cue);                     // 拿在手里：拖动时不再推挤别的球（见 balls.js）
  rig.setPlacing(true);
  // silent = 电脑在摆自己的手中球：那条「拖动白球 → 确定」浮条是人类专用的，别弹给它
  if (placeBar) {
    placeBar.hidden = !!silent;
    placeBar.ownerDocument.body.classList.toggle('placing', !silent);
  }
  hud.update(state, cue.potted);
}

/** 点「确定」：收摊、交还控制，进入正常瞄准 */
function confirmPlacement() {
  if (!state.placingCue) return;
  state.placingCue = false;
  state.placeAt = null;
  releaseBall(cue);                  // 交还物理：接下来它要被打、也要撞别的球
  if (placeBar) {
    placeBar.hidden = true;
    placeBar.ownerDocument.body.classList.remove('placing');
  }
  rig.setPlacing(false);
  rig.enableControls();
  if (state.mode === 'tracking') rig.enterAiming();
  state.aimSeen = state.aimAngle;    // 摆球这一下不算"动过准星"
  state.aimMark = 0;
  hud.update(state, cue.potted);
}

/** 拖动白球：屏幕点 → 台面坐标 → 收进合法范围（库边内沿以内 + 避开袋口） */
function dragCueBall(clientX, clientY) {
  if (!state.placingCue) return;
  const pt = stage.screenToTable(clientX, clientY);
  if (!pt) return;
  const p = clampCuePlace(pt.x, pt.z);
  state.placeAt = { x: p.x, z: p.z };
  pinCueToPlace();
}

/**
 * 把白球钉在 placeAt（每次拖动 + 每帧各来一次）。
 * 为什么要"每帧一次"：拖动时白球可能正压着别的球，物理求解器每步都想把它推开；
 * 只靠 pointermove 回设的话，手指停住的那几帧球会被顶歪。每帧回设 = 位置伺服，
 * 表现就是"被顶开的是别的球，白球稳稳待在手指选的位置上"。
 */
function pinCueToPlace() {
  const a = state.placeAt;
  if (!a) return;
  const t = cue.body.translation();
  const moved = Math.abs(t.x - a.x) > 1e-4 || Math.abs(t.z - a.z) > 1e-4;
  cue.body.setTranslation({ x: a.x, y: BALL_R, z: a.z }, true);
  cue.body.setLinvel({ x: 0, y: 0, z: 0 }, true);
  cue.body.setAngvel({ x: 0, y: 0, z: 0 }, true);
  if (moved) stage.requestShadowUpdate();
}

/** 完全重开一盘（球位、击球次数、已进袋全部归零） */
function rackEmUp() {
  if (state.charging) { state.charging = false; hud.hideCharge(); rig.enableControls(); }
  result?.close();                    // 结算弹窗开着时先收掉
  resetBalls(balls, state.ballSet);   // 按当前球体设置重新摆球
  resetMatch(state);
  applyGameMode(state, gameMode.id, gameDiff?.id ?? null,
    shotsLeft(gameMode.id, gameDiff?.id, 0), timeLimit(gameMode.id, gameDiff?.id));
  board.reset();                      // 分数归零
  duo?.reset();                       // 本地双人：回合 / 分组 / 罚球状态一起回到开局
  matchT0 = now();                    // 用时重新计（挑战历史记的是"这一局"）
  combo.reset();                      // 连击从零开始
  referee.openLids();
  stage.requestShadowUpdate();        // 球位全变了：shadow map 必须重画
  if (state.mode === 'tracking') rig.enterAiming();
  // 自由球模式：重开也回到"先摆白球"那一步（否则重开一次就白少一次摆球机会）
  if (gameMode.placing) enterPlacing();
  hud.update(state, cue.potted);
}

/** 落袋回调（由 PocketReferee 调用）：收起球 + 记分 + 刷新 HUD + 播音效 */
/**
 * 本地双人：这颗球是不是"进错了"（本该打自己那组，却打进了对方的球）。
 * ------------------------------------------------------------------
 * 只有**已经分好组**才有"进错"这回事 —— 开局台面开放，进任何一颗都只是"进了球"。
 * 黑 8 不算进错球（它有自己那一套判定，见 duo.js）。
 * 判断必须在落袋这一刻做：连击欢呼是即时播放的，等球停稳再判就晚了。
 */
function isWrongBall(ball) {
  if (!duo || ball.isCue || duo.open) return false;
  const owner = duo.ownerOf(ball.number);
  return owner !== null && owner !== duo.turn;
}

function onPotted(ball) {
  // 提前打进黑 8 在计分模式里是"犯规但不结束"：扣分 + 黑 8 摆回球堆中心
  // （判定必须在 push 之前算，否则 state.potted 里已经有它了）
  const earlyEight = gameMode.scored && isPrematureEight(state, ball);
  audio.pocketDrop();                 // 先"咚"一声，再往下掉
  if (earlyEight) audio.sfx('boom');  // 黑 8 犯规：一记爆炸，而不是进球欢呼
  else if (isWrongBall(ball)) combo.onWrongPot();   // 双人：打进了对方的球 → 连击当场断掉
  else combo.onPot(ball.isCue);       // 欢呼 / 连击语音 / 一杆多响；白球改播尴尬音
  // 进袋即从场上消失（否则会留在桌下的落球盘里）
  hideBall(ball);
  if (ball.isCue) state.cueNeedsRespawn = true;
  else state.potted.push(ball.number);
  // 本地双人：按落袋顺序登记（分组判"本杆第一颗"，顺序不能乱）；
  // 黑 8 的处置（获胜 / 罚球 / 判输）等球停稳由 duo.resolveShot 决定。
  if (duo) {
    if (ball.isCue) duo.markCuePot();
    else duo.onPot(ball.number);
  }
  if (gameMode.scored) scorePot(ball, earlyEight);   // 计分模式：加分 / 扣分
  if (earlyEight) respawnBlackEight(ball);
  hud.update(state, cue.potted);
  if (ball.isCue) return;

  // 黑 8 提前落袋 = 自爆判负（备用规则，默认关，见 RULES.eightBallSelfDestruct）
  // 双人模式不走这条：黑 8 怎么办由规则设置决定（罚球 / 判输，见 duo.js）。
  if (!duo && isEarlyEight(state, ball)) endMatch('foul8');
}

/** 计分模式的一次落袋：目标球加分、白球 -1、提前打进黑 8 -3 */
function scorePot(ball, earlyEight = false) {
  if (ball.isCue) board.onCue();
  else if (earlyEight || isPrematureEight(state, ball)) board.onEarlyEight();
  else board.onTarget();
  state.score = board.score;
}

/**
 * 犯规的黑 8 重新出现在初始位置（用户定的规则）。
 * ------------------------------------------------------------------
 * 两件事必须一起做，少一件就出 bug：
 *   ① 物理上把它摆回摆球位（balls.js 的 respawnBallToRack）—— 抬 6cm 落下，
 *      摆球位可能正被别的球占着（这一杆刚把球堆炸开）；
 *   ② 把它从 state.potted 里摘掉 —— 否则"清台进度"永远差这颗 8 号，
 *      玩家把台面打空也判不了通关。
 * 时间轴上它发生在 onPotted 里（进袋判定那一刻，球还在往下沉），
 * 所以 respawn 会同时把隐藏的球显示回来。
 */
function respawnBlackEight(ball) {
  state.potted = withoutPotted(state.potted, ball.number);
  if (!respawnBallToRack(ball, state.ballSet, AIM.earlyEightLift)) return;
  state.pottedThisShot = Math.max(0, state.pottedThisShot - 1);   // 它没真的进
  stage.requestShadowUpdate();
}

/* ---------------------------------------------------------
 * 主循环
 * ------------------------------------------------------- */
function animate() {
  host.raf(animate);

  const dt = stage.delta();

  // 蓄力振荡：0→1→0 三角波（HUD 力度条 + 跟随鼠标的蓄力条同步）
  if (state.charging) {
    state.chargePower = chargePower(state, dt, SHOT.chargePeriod);
    hud.setCharging(state.chargePower);
    hud.moveCharge(pointer.x, pointer.y);
  }

  tickClock();        // 计时模式：刷新剩余时间，时间到就标记"该判负了"
  tickAimStat();      // 瞄准统计：准星动了就开始计时（出杆时结算，见 fireShot）
  if (state.placingCue) pinCueToPlace();   // 自由球模式：每帧把白球钉在选定的位置

  stepPhysics(dt);
  syncBalls(balls);
  referee.check();
  referee.update(dt);
  const moving = updateRestState({ state, balls, cue, onSettled: onAllStopped });
  ensureCueOnTable();     // 白球掉进袋就得回来（每帧幂等，见 shot.js 的 respawnCueIfIdle）

  const p = cue.body.translation();
  _ballPos.set(p.x, BALL_R, p.z);
  aimer.update(!state.shooting && !cue.potted && !state.placingCue,
    _ballPos, aimVector(state.aimAngle, _dir), state.cueAnim);
  stage.updateDebug(world);

  // 击球动画推进
  if (state.cueAnim > 0) {
    state.cueAnim += dt / CUE.strikeTime;
    if (state.cueAnim >= 1) state.cueAnim = 0;
  }

  rig.update(dt);
  audio.setCamera(stage.camera);     // 3D 音效：每帧把机位交过去算方位与衰减
  stage.updateShadows(sceneDirty(moving));   // 阴影按需刷新：世界不动就不重画
  trackFps();
  shootBtn.sync();                   // 开球键：不能出杆时置灰
  duoUI?.sync();                     // 本地双人：只让当前回合那一方的键可按
  tickAi(dt);                        // 🤖 人机对战：轮到电脑时自己思考 → 转杆 → 出杆
  refreshGhost();                    // 本地双人：定组后把不是自己的球画成半透明（幂等）
  hud.setMoving(moving);
  hud.setClock(state);
  stage.render();
}

/**
 * 计时模式的时钟（每帧）。
 * ------------------------------------------------------------------
 * 时间到不立刻弹窗，而是先标记 state.timeUp：球还在滚的时候把结算弹窗糊上来很突兀，
 * 而且那一杆的进球本该算数 —— 所以等球停稳由 onAllStopped 判。球早就停着的情况
 * （球停着时间才走到零）在这里当场判，不然会一直干等。
 */
function tickClock() {
  if (state.modeId !== 'timed' || state.matchOver) return;
  const left = timeLeft(state.modeId, state.diff, elapsedMs());
  state.timeLeftMs = left;
  if (left > 0) return;
  if (state.potted.length >= state.pottedTotal) return;   // 刚好清台：算通关，交给正常结算
  state.timeUp = true;
  if (!state.shooting) finishMatch('lose');
}

/**
 * 瞄准统计（每帧）：准星动了就开始计时。
 * ------------------------------------------------------------------
 * "用户有任意操作"落到可测的量上就是 **aimAngle 变了** —— 顶视是手指拖动改的，
 * 自由 / 追踪是"相机绕白球转"反推出来的，两种操作都会改它。
 * 阈值见 constants.js 的 AIM.moveEps（相机反推有极小浮点抖动，不能拿"绝对相等"当判据）。
 * 球在滚的时候不统计（那会儿准星本来就不给动）。
 */
function tickAimStat() {
  if (state.shooting || state.matchOver) { state.aimSeen = state.aimAngle; return; }
  if (Math.abs(state.aimAngle - state.aimSeen) > AIM.moveEps && !state.aimMark) {
    state.aimMark = now();
  }
  state.aimSeen = state.aimAngle;
}

/**
 * 这一帧世界动了吗（决定要不要重画 shadow map）。
 * 球在动 / 球杆动画 / 蓄力（杆会前后推）都算；杆向转动超过约 1.2° 也算 ——
 * 低于这个阈值肉眼看不出来，于是"手停住"的那几帧就能省掉整张阴影贴图。
 */
function sceneDirty(moving) {
  if (moving > 0 || state.shooting || state.cueAnim > 0 || state.charging) return true;
  if (Math.abs(state.aimAngle - shadowAim) < 0.021) return false;
  shadowAim = state.aimAngle;
  return true;
}

/** 帧率：半秒窗口平均，显示在左上角面板（真机上报性能就看它） */
function trackFps() {
  const now = globalThis.performance?.now?.() ?? Date.now();
  fpsN += 1;
  if (now - fpsT < 500) return;
  if (fpsT > 0) hud.setFps((fpsN * 1000) / (now - fpsT));
  fpsT = now;
  fpsN = 0;
}

function stepPhysics(dt) {
  // 碰撞传导随机化强度：默认只在开球那一杆开启（普通击球保持可预测，免得瞄得准却随机打丢）
  const impactVariance = (RULES.collisionVarianceBreakOnly ? state.breakShot : true)
    ? RULES.collisionVariance : 0;

  accumulator += dt;
  let steps = 0;
  while (accumulator >= PHYS.timestep && steps < PHYS.maxSubSteps) {
    snapshotVelocities(balls, prevVel);       // 记录撞前速度（随机化要靠它算接近速度）
    world.step(eventQueue);
    clampBallSpeeds(ballBodies);
    applyRollFriction(ballBodies);            // 滚动摩擦（0.7.0，见 sim.js；与测试套件共用同一份）
    maybeBreakShock({ state, cue, ballBodies, rackAnchors });
    randomizeBallImpacts(eventQueue, colliderToBall, prevVel, {
      variance: impactVariance,
      minSpeed: RULES.collisionVarianceMinSpeed,
      cushions: cushionHandles,
      onImpact: playImpact,
      // 白球首次触球登记（本地双人 / 人机的犯规判定："打错球组 / 空杆"，见 duo.js）
      onCueHit: (n) => duo?.markCueContact(n),
    });
    accumulator -= PHYS.timestep;
    steps++;
  }
}

/** 把一次物理碰撞翻译成声音：球撞球按接近速度、撞库按事前速度 */
/** 单调时钟：优先 performance.now（帧率统计也在用它） */
function now() {
  return globalThis.performance?.now?.() ?? Date.now();
}

/** 本局已用时（毫秒） */
function elapsedMs() {
  return matchT0 ? Math.max(0, Math.round(now() - matchT0)) : 0;
}

function playImpact(info) {
  // 只有球撞球走 3D 定位（且只在自由 / 追踪模式）；撞库固定音量
  if (info.kind === 'ball') audio.ballHit(info.closing, info.x, info.z);
  else audio.cushion(info.speed);
}

/**
 * 白球不在台上就把它放回去（每帧都问）。
 * ------------------------------------------------------------------
 * 不能只靠 updateRestState 里"停稳那一帧"的复位 —— 白球可能在球都停稳之后才慢慢
 * 沉进袋口（低概率但真的会发生），那次复位机会已经过去了，白球就再也回不来：
 * 出杆键一直灰着、相机追着袋口里那颗看不见的球、也摆不回初始位置。
 * 放在 updateRestState 之后、rig.update 之前：这样同一帧内相机拿到的已经是复位后的球位。
 */
function ensureCueOnTable() {
  if (!respawnCueIfIdle({ state, cue })) return;
  // 摆球阶段：复位完继续"拿在手里"（不然又会去顶别的球，见 holdBall）
  if (state.placingCue) holdBall(cue);
  stage.requestShadowUpdate();
  hud.update(state, cue.potted);
}

/** 球全部停稳：本杆结束，若袋口还封着就准备开袋 */
function onAllStopped() {
  combo.onShotEnd();                 // 这一杆空杆的话，连击在这里断掉
  board.onShotEnd();                 // 一杆多进奖励 / 空杆断连击
  state.score = board.score;
  if (state.pocketsClosed) state.pocketReopenTimer = 0.05;
  hud.update(state, cue.potted);
  if (state.matchOver) return;
  // 本地双人：分组 / 换人 / 罚球 / 胜负全部由规则引擎在这一下定下来（见 duo.js）。
  // 它跟"清台判胜负"那套不是一路 —— judgeAfterShot 在双人模式里直接返回 null。
  if (duo && !duo.over) {
    applyDuoVerdict(duo.resolveShot(state.potted));
    return;
  }
  // 清台 / 次数用尽 / 时间到都等球停稳再判（免得球还在滚就弹窗）
  const verdict = judgeAfterShot({
    mode: state.modeId,
    diff: state.diff,
    shots: state.shots,
    potted: state.potted.length,
    total: state.pottedTotal,
    timeUp: state.timeUp,
  });
  if (verdict) {
    finishMatch(verdict === 'win' ? 'win' : 'lose');
    return;
  }
  // 自由球模式：**每一杆开球前**都重新摆一次白球 —— 这是这套玩法的本意：
  // 开挂 / 纯练习的手感，想打哪就先把白球摆到哪，不用被上一杆的走位结果绑住。
  // （白球落袋的话上面已经复位到开球点了，这里一并重新摆。）
  if (gameMode.placing) enterPlacing();
  syncDuo();
}

/* ---------------------------------------------------------
 * 本地双人：把规则引擎的判决落到台面与界面上
 * -------------------------------------------------------
 * 判定一行都不在这里写（那些在 duo.js 里，无头测试能直接断言）。
 * 这里只负责"判决之后该做什么动作"：重摆、罚球回位、换人摆白球、结算。
 */
function applyDuoVerdict(r) {
  if (!r) return;
  switch (r.outcome) {
    // 没分大小号就打进黑八、规则选了"本局重来" → 整局重摆重开
    // （引擎内部已经 reset 过，rackEmUp 再 reset 一次也不影响）
    case 'rerack':
      rackEmUp();
      break;
    // 还没分大小号就打进黑八（"黑八归位，换人继续"）：黑八摆回去，本局接着打
    // 已分组后提前打进黑八（罚球规则）：罚的那颗 + 黑八一起回初始位置，然后换人
    case 'respot':
    case 'penalty':
      respotBalls(r.respot);
      audio.sfx('boom');
      break;
    // 白球落袋 → 换人。摆法由规则设置决定：自由摆球 / 放回开球点。
    case 'cueFoul':
      respawnCue(cue);                  // 两种摆法都要它先在台上（落袋后它还在袋里）
      // 手中球：接手的人自己拖到想打的位置。
      // ⚠️ 接手的是电脑时**不弹那条浮条**（它自己会摆，见 aiPlaceStep）—— duo.turn 此刻已经是接手方。
      if (!r.cueToHead) enterPlacing(!!(aiBrain && duo.turn === 2));
      break;
    // 犯规判罚（0.7.0，规则设置里开启后才出现）：换人 + 对方手中球。
    // 白球没有落袋、还停在犯规那一刻的位置上，不用复位 —— 直接进摆球阶段。
    case 'foul':
      if (r.ballInHand) enterPlacing(!!(aiBrain && duo.turn === 2));
      break;
    case 'win':
    case 'lose':
      state.duoWinner = r.winner;       // 结算弹窗写"玩家X 获胜"（见 result.js）
      syncDuo();
      finishMatch(r.outcome);
      return;
    default:
      break;                            // continue（续杆）/ switch（换人）：只更新横幅
  }
  syncDuo();
}

/**
 * 把若干颗球重新摆回初始位置。
 * 两种判决会用到它：未分组进黑八（只摆黑八）、已分组提前进黑八（罚一颗 + 黑八）。
 */
function respotBalls(numbers) {
  if (!numbers || !numbers.length) return;
  for (const n of numbers) {
    const b = balls.find((x) => x.number === n);
    if (!b) continue;
    // 与黑 8 犯规同一个坑：只摆回不摘进度，台面就永远差这几颗（见 respawnBlackEight）
    state.potted = withoutPotted(state.potted, n);
    respawnBallToRack(b, state.ballSet, AIM.earlyEightLift);
  }
  // 双人：HUD 那两栏也要摘掉，否则那里挂着一颗已经回到台面上的球
  duo?.removePots(numbers);
  stage.requestShadowUpdate();
  hud.update(state, cue.potted);
}

/** 双人横幅刷新（换人 / 定组 / 进球 / 判罚之后都要重画一次） */
function syncDuo() {
  if (!duo) return;
  duoUI?.render(duo.snapshot(state.potted));
}

/**
 * 定组之后，把"不是当前这一方该打的球"画成半透明（本地双人）。
 * ------------------------------------------------------------------
 * 每帧问一次是刻意的：换人、进球、罚球回位、重开本局……都会改变"哪些球归谁"，
 * 与其在每个分支里各刷一次，不如让这一帧的事实说了算（setBallGhost 自己是幂等的，
 * 状态没变就不会去动材质，不会每帧重编译着色器）。
 *
 * 判据：
 *   · 没分组（台面开放）→ 全部实色（这时候进谁的球都算数，不该有"淡"的暗示）
 *   · 已分组 → 自己那组实色，对方那组半透明
 *   · 黑 8：自己那组还没清完 → 半透明（现在打它就是犯规）；清完了 → 实色（该打了）
 *
 * ⚠️ 游戏设置里的「非己方球半透明」关掉时要**逐颗恢复实色**再返回：
 *    只 `return` 的话，上一杆已经淡下去的那些球会一直淡着，开关看着像坏了。
 */
function refreshGhost() {
  if (!duo) return;
  if (!state.ghostOn) {
    for (const b of balls) {
      if (!b.isCue && !b.hidden) setBallGhost(b, false);
    }
    return;
  }
  const myGroup = duo.open ? null : duo.groups[duo.turn];
  const eightReady = myGroup && duo.cleared(duo.turn, state.potted);
  for (const b of balls) {
    if (b.isCue || b.hidden) continue;                 // 白球永远实色（它是双方共用的）
    if (!myGroup) { setBallGhost(b, false); continue; }
    const g = groupOf(b.number);
    setBallGhost(b, g === 'eight' ? !eightReady : g !== myGroup);
  }
}

/* ---------------------------------------------------------
 * 🤖 人机对战：电脑回合
 * -------------------------------------------------------
 * 电脑扮演**玩家2**，与人类走**同一套**中式黑八规则（duo.js）与**同一条**出杆链路。
 * 它唯一多出来的东西是"自己会打"：轮到它时，这里替它把三步走完 ——
 *
 *   think（思考一会儿，让玩家看清它在看哪儿）
 *     → aim（把球杆**转**向算好的方向，这是用户要的"先用动画切换出杆方向"）
 *     → fireShot(力度)（和玩家手动出杆完全一样：音效 / 计分 / 换人 / 判负照常发生）
 *
 * 选球与力度本身不在这一层：`src/ai.js` 调 auto-aim.js 算出完美方案，再按难度掺手抖。
 * 难度档位的手感全在那边调（改 `constants.js` 的 AI_LEVELS），这里只管播。
 */
function tickAi(dt) {
  if (!aiBrain) return;
  // 不是电脑的回合（人类在打 / 已经分出胜负 / 还没开局）→ 状态机归零，别攒着
  if (!duo || duo.over || state.matchOver || duo.turn !== 2) { resetAi(); return; }
  // 球还在滚 / 人类正在蓄力 / 白球还没复位 → 一律等着，绝不抢杆
  if (state.shooting || state.charging || cue.potted) return;

  if (state.placingCue) { aiPlaceStep(dt); return; }   // 手里拿着白球：先自己摆好

  if (aiPhase === 'idle') { aiStartThink(); return; }
  if (aiPhase === 'think') {
    aiT -= dt * 1000;
    if (aiT > 0) return;
    // 进入转杆：先量好"从哪儿转到哪儿、转多久"，之后每帧只是按进度插值。
    // 时长 = 差角 ÷ 角速度，但不短于 minAimMs —— 差角只有两三度时也得看得见它在转。
    aiFrom = state.aimAngle;
    aiDelta = wrapPi(aiPlan.aimAngle - aiFrom);
    aiDur = Math.min(AI.maxAimMs, Math.max(AI.minAimMs, Math.abs(aiDelta) / AI.turnSpeed * 1000));
    aiPhase = 'aim';
    aiT = 0;
    // 追踪模式下让相机跟着杆一起转（见 camera-rig.js：平时是相机决定杆向，这里反过来）
    state.aiAiming = true;
    return;
  }
  if (aiPhase === 'aim') {
    aiT += dt * 1000;
    const k = Math.min(1, aiT / aiDur);       // 0 → 1 的转杆进度
    state.aimAngle = aiFrom + aiDelta * k;
    if (k >= 1) { state.aimAngle = aiPlan.aimAngle; aiFire(); }
  }
}

function resetAi() {
  aiPhase = 'idle';
  aiPlan = null;
  aiT = 0;
  aiFrom = 0;
  aiDelta = 0;
  aiDur = 0;
  // 交还"相机决定杆向"的常规关系（不置回去的话，玩家转不动视角 —— 镜头会一直被杆向拽着）
  state.aiAiming = false;
}

/** 电脑开始想这一杆（方案算不出来就原地待命，下一步物理会把它推到别的分支） */
function aiStartThink() {
  // （B2 已修，2026-10-30）原先这里留着一个"开球那一杆不瞄准、直接 aiBreak"的分支，
  // 但 duo.js 里开球方固定是玩家 1，这段永远走不到 —— 是假代码。已连同 ai.js 的
  // aiBreak 一起删除；哪天"谁开球"改成可配置（如输家开球）时，再在这里写真正的开球策略。
  const t = cue.body.translation();
  aiPlan = planAiShot({
    cue: { x: t.x, z: t.z },
    balls: liveBalls(),
    // 与人类同一条规矩：只打自己那组剩下的球，清完了才打黑八（见 auto-aim.js 的 duoTargets）
    targets: duoTargets(duo, state.potted),
    level: aiBrain.level,
    rnd: aiBrain.rnd,
    range: { min: SHOT.minImpulse, max: SHOT.maxImpulse },
  });
  if (!aiPlan) return;
  aiPhase = 'think';
  aiT = aiPlan.thinkMs;
}

/** 转到位了 —— 按算好的力度打出去 */
function aiFire() {
  const p = aiPlan;
  resetAi();
  // 出杆只认 state.lockedAim（见 fireShot 的注释），所以先把方向写进去，
  // 再走**和玩家手动出杆完全相同**的那一条链路。
  state.lockedAim = p.aimAngle;
  state.aimAngle = p.aimAngle;
  const shotsBefore = state.shots;
  fireShot(p.power);
  if (state.shots === shotsBefore) return;      // 没打出去（极少见），就别报了
  showAutoTip(p.tip);
}

/**
 * 电脑拿到手中球（人类白球落袋）时自己摆球位。
 * ------------------------------------------------------------------
 * 走的是人类那条 enterPlacing → placeAt → confirmPlacement 的链路，
 * 只是"拖"的那一步由 aiPlaceCue() 代劳（网格搜索一个最容易进球的位置）。
 * ⚠️ 浮条（「拖动白球 → 确定」）是给人类看的，电脑摆球时不该冒出来 —— 所以
 *    applyDuoVerdict 里 cueFoul 那一支要按"接手的是不是电脑"决定要不要弹浮条。
 */
function aiPlaceStep(dt) {
  if (aiPhase !== 'place') {
    const spot = aiPlaceCue({
      balls: liveBalls(),
      targets: duoTargets(duo, state.potted),
      level: aiBrain.level,
      rnd: aiBrain.rnd,
    });
    state.placeAt = { x: spot.x, z: spot.z };
    pinCueToPlace();
    aiPhase = 'place';
    aiT = 700;                                  // 停一下，让玩家看清它摆在哪儿
    return;
  }
  pinCueToPlace();                              // 每帧钉住（物理求解器会想把它推开）
  aiT -= dt * 1000;
  if (aiT <= 0) { confirmPlacement(); resetAi(); }
}

/** 台面上还活着的球（喂给 auto-aim / ai 的纯数据快照） */
function liveBalls() {
  return balls
    .filter((b) => !b.isCue && !b.potted && !b.hidden)
    .map((b) => ({ number: b.number, x: b.body.translation().x, z: b.body.translation().z }));
}

/** 把角度差归一化到 (−π, π]：转杆要走**最短**那一侧，不能绕一大圈 */
function wrapPi(a) {
  const T = Math.PI * 2;
  let v = a % T;
  if (v > Math.PI) v -= T;
  if (v <= -Math.PI) v += T;
  return v;
}

/** 自动进球的提示条（2.4 秒后自己收掉） */
let autoTipTimer = 0;
function showAutoTip(text) {
  const el = host.byId('auto-tip');
  if (!el) return;
  el.textContent = text;
  el.hidden = false;
  clearTimeout(autoTipTimer);
  autoTipTimer = setTimeout(() => { el.hidden = true; }, 2400);
}

/**
 * 一局结束：先把这一局记进挑战历史，再弹结算窗。
 * 只记"打完的局"—— 中途重开或退出返回主菜单的不算，免得列表里堆满半截记录。
 *
 * 0.7.0（体检 G7）：**所有对局都入史** ——
 *   · 单人玩法照旧（赢也记、没清台也记）
 *   · 人机对战：赢了记 'win'、输给电脑记 'fail'（以前输了不留痕，看不到胜率）
 *   · 本地双人：也记，`winner` 字段记下是哪位赢的（历史列表显示"玩家X 胜"）
 *
 * ⚠️ 人机模式的 kind 要先**换算成玩家的视角**：duo.js 给的是"最后击球那人的结局"
 *    （'win' = 击球者赢），电脑打完最后一杆时它返回 'win' 可赢的人是电脑。
 *    所以这里看 `state.duoWinner`：1 = 玩家赢。
 */
function finishMatch(kind) {
  if (state.matchOver) return;
  const m = getGameMode(state.modeId);
  const ms = elapsedMs();
  const mine = m.id === 'ai' ? state.duoWinner === 1 : kind !== 'lose';
  const outcome = mine ? 'win' : 'lose';
  pushRecord(makeRecord({
    mode: m.id,
    diff: state.diff,
    name: launch.name,
    ms: ms,
    shots: state.shots,
    potted: state.potted.length,
    total: state.pottedTotal,
    best: combo.best,
    score: m.scored ? board.score : null,
    timeLeft: m.timed ? timeLeft(m.id, state.diff, ms) : null,
    view: state.mode,                     // 这一局用的视角模式（追踪 / 自由 / 顶视）
    aimMs: state.aimCount ? state.aimAcc / state.aimCount : null,   // 没瞄准过就是 null
    aimCount: state.aimCount,
    // 双人局没有"输家"：总有赢的一方，result 恒为 'win'（列表里显示"玩家X 胜"），
    // red 样式只给人机的 'fail' 用。人机：赢了 'win'、输了 'fail'。
    result: m.id === 'duo' ? 'win' : (outcome === 'lose' ? 'fail' : 'win'),
    // 本地双人：谁赢的（1 | 2）。人机 / 单人没有这个概念，恒为 null
    winner: m.id === 'duo' ? (state.duoWinner ?? null) : null,
  }));
  endMatch(outcome);
}
