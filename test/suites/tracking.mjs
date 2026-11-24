import * as THREE from 'three';
import { check } from '../lib/harness.mjs';
import { BALL_R, CAM, TABLE } from '../../src/constants.js';
import { HEAD_SPOT } from '../../src/layout.js';
import { fovForAspect, isPortrait } from '../../src/stage.js';
import { CameraRig, watchOverview, fitOverviewDist } from '../../src/camera-rig.js';

/**
 * 追踪模式「击球后拉远看全场」机位（纯逻辑，不需要浏览器）
 * ------------------------------------------------------------------
 * 用户反馈：开球后想看到整张台，但镜头没退到位 / 退回来看不清球位。
 * 定位到两个真问题，这里各守一条：
 *   ① 观战距离原本是写死的（白球后 2.5m + 高 2.4m），16:9 下整台只占屏 35%×73%，
 *      台子小得看不清 —— 现在按视锥反解，任何屏幕比例 / 任何击球方向都贴边占满。
 *   ② 更要命的一条：追踪模式 OrbitControls 的 maxDistance 是瞄准用的 1.7m，
 *      观战机位却在桌心外 3~4m —— 补间一结束 controls.update() 就把相机**吸回 1.7m**，
 *      整张台瞬间被裁掉。观战阶段必须临时放开这个上限。
 */

const ASPECTS = [0.46, 0.56, 1.0, 1.333, 1.778, 2.4];
/** 各种击球方向：朝 +X（开球）、斜向、横向、朝 -X（白球在另一端回打） */
const AIMS = [Math.PI / 2, Math.PI / 4, 0, -Math.PI / 2, 2.6];

/** 把球台外框 8 个角投到 NDC（与 fitOverviewDist 内部同一套公式，独立写一遍做交叉验证） */
function projectCorners(aspect, fovDeg, cam, target = [0, 0.1, 0]) {
  let bx = cam[0] - target[0], by = cam[1] - target[1], bz = cam[2] - target[2];
  const bl = Math.hypot(bx, by, bz);
  bx /= bl; by /= bl; bz /= bl;
  let rx = bz, rz = -bx;
  const rl = Math.hypot(rx, rz) || 1;
  rx /= rl; rz /= rl;
  const ux = by * rz, uy = bz * rx - bx * rz, uz = -by * rx;
  const tanV = Math.tan((fovDeg * Math.PI) / 360);
  const tanH = tanV * aspect;
  let wx = 0, wy = 0;
  for (const x of [-TABLE.outerHalfL, TABLE.outerHalfL]) {
    for (const z of [-TABLE.outerHalfW, TABLE.outerHalfW]) {
      for (const y of [0, 0.12]) {
        const vx = x - cam[0], vy = y - cam[1], vz = z - cam[2];
        const d = -(vx * bx + vy * by + vz * bz);
        if (!(d > 1e-4)) return { wx: Infinity, wy: Infinity };
        wx = Math.max(wx, Math.abs((vx * rx + vz * rz) / d / tanH));
        wy = Math.max(wy, Math.abs((vx * ux + vy * uy + vz * uz) / d / tanV));
      }
    }
  }
  return { wx, wy, worst: Math.max(wx, wy) };
}

/** 造一个够 CameraRig 跑机位计算的最小假环境（不碰渲染，也不碰真实 OrbitControls） */
function fakeRig(aspect, aimAngle, ball = HEAD_SPOT) {
  const stage = {
    aspect,
    fov: fovForAspect(aspect),
    controls: {
      target: new THREE.Vector3(0, 0.1, 0),
      minDistance: 0,
      maxDistance: Infinity,
      enabled: true,
      update() {},          // 真实现里是 OrbitControls.update()；补间结束后会被调到
    },
    camera: { position: new THREE.Vector3(0, 1, 2), lookAt() {} },
  };
  const state = {
    aimAngle, camTween: null, trackPhase: 'aiming',
    autoFocusArmed: false, autoFocusTimer: 0,
    shooting: false, charging: false, mode: 'tracking', camBack: CAM.aimDist,
  };
  const cue = { body: { translation: () => ({ x: ball.x, y: BALL_R, z: ball.z }) } };
  return { rig: new CameraRig(stage, state, cue), stage, state };
}

export function testTrackingWatchCamera() {
  console.log('\n[33] 追踪模式：击球后拉远到「整台入画」，球停稳再回追踪视角');

  // ---- ① 反解出来的机位真的装得下整张台（含木框），且贴边不浪费 ----
  let allFit = true;
  let tight = true;
  for (const a of ASPECTS) {
    const fov = fovForAspect(a);
    const portrait = isPortrait(a);
    const margin = portrait ? CAM.portMargin : CAM.watchMargin;
    for (const aim of AIMS) {
      const w = watchOverview(a, fov, aim, HEAD_SPOT, portrait);
      const p = projectCorners(a, fov, w.pos);
      if (p.worst > margin + 0.02) { allFit = false; console.log(`      aspect ${a} aim ${aim.toFixed(2)} 溢出 ${(p.worst * 100).toFixed(0)}%`); }
      if (Math.max(p.wx, p.wy) < margin - 0.02) { tight = false; console.log(`      aspect ${a} aim ${aim.toFixed(2)} 只占 ${(Math.max(p.wx, p.wy) * 100).toFixed(0)}%`); }
    }
  }
  check(allFit, '任何屏幕比例 / 任何击球方向：整张台（含木框）都在屏内');
  check(tight, '至少一个方向贴到边距（没白留空，台子看得清）');

  // ---- ② 相机确实在**白球后方**，而且比瞄准机位远得多（"向后退"）----
  let behind = true;
  let farther = true;
  let minDist = Infinity;
  for (const a of ASPECTS) {
    const fov = fovForAspect(a);
    for (const aim of AIMS) {
      const w = watchOverview(a, fov, aim, HEAD_SPOT, isPortrait(a));
      const toCam = [w.pos[0] - HEAD_SPOT.x, w.pos[2] - HEAD_SPOT.z];
      const dot = toCam[0] * Math.sin(aim) + toCam[1] * Math.cos(aim);   // 与击球方向同向为正
      if (dot >= -1e-6) behind = false;
      if (w.dist <= CAM.aimDist * 1.5) farther = false;
      minDist = Math.min(minDist, w.dist);
    }
  }
  check(behind, '观战机位在白球**后方**（沿本杆视线往后退，不是横跳到别的方向）');
  check(farther, `退得比瞄准机位远得多（瞄准 ${CAM.aimDist}m，观战最近 ${minDist.toFixed(2)}m）`);

  // ---- ③ 关键回归：观战阶段必须放开 OrbitControls 的距离上限 ----
  //     不放开的话 controls.update() 会把相机夹回瞄准用的 1.7m，整台被裁。
  let rangeOk = true;
  let detail = '';
  for (const a of ASPECTS) {
    const { rig, stage, state } = fakeRig(a, Math.PI / 2);
    rig.onShotFired();
    const to = state.camTween.toPos;
    const need = to.distanceTo(state.camTween.toTgt);
    if (!(stage.controls.maxDistance >= need)) { rangeOk = false; detail = `aspect ${a}: 上限 ${stage.controls.maxDistance.toFixed(2)}m < 需要 ${need.toFixed(2)}m`; }
    if (!(stage.controls.minDistance <= need)) rangeOk = false;
  }
  check(rangeOk, '观战阶段放开了缩放上限（相机不会被吸回瞄准距离）', detail);

  // 对照：证明"不放开就一定会裁" —— 沿用瞄准的 1.7m 上限时台子溢出屏幕
  const a16 = 1.778;
  const fov16 = fovForAspect(a16);
  const w16 = watchOverview(a16, fov16, Math.PI / 2, HEAD_SPOT, false);
  const clamped = (() => {
    const tgt = [0, 0.1, 0];
    const v = [w16.pos[0] - tgt[0], w16.pos[1] - tgt[1], w16.pos[2] - tgt[2]];
    const len = Math.hypot(...v);
    const k = CAM.maxDist / len;
    return [tgt[0] + v[0] * k, tgt[1] + v[1] * k, tgt[2] + v[2] * k];
  })();
  const worstClamped = projectCorners(a16, fov16, clamped).worst;
  check(worstClamped > 1.05,
    '对照：若沿用瞄准的 1.7m 上限，整台会被裁到屏外（这就是"看不清全场"的根因）',
    `被夹后最外侧角占屏 ${(worstClamped * 100).toFixed(0)}%`);

  // ---- ④ 回瞄准机位时缩放上限要收回去（否则瞄准视角能被拉到天上去）----
  {
    const { rig, stage } = fakeRig(a16, Math.PI / 2);
    rig.onShotFired();
    rig.enterAiming(true);
    check(stage.controls.maxDistance === CAM.maxDist && stage.controls.minDistance === CAM.minDist,
      '回到瞄准阶段：缩放区间收回瞄准用的范围',
      `${stage.controls.minDistance}~${stage.controls.maxDistance}m`);
  }

  // ---- ⑤ 拉远要"快"，且起步最快（easeOut）----
  {
    const { rig, state } = fakeRig(a16, Math.PI / 2);
    rig.onShotFired();
    check(state.camTween.dur === CAM.watchTween && CAM.watchTween <= 0.5,
      `拉远动画够快（${CAM.watchTween}s，球一出去就得看全场）`);
    check(state.camTween.ease === 'out', '拉远用 easeOutCubic（起步最快，不是慢进慢出）');
    rig.enterAiming(true);
    check(state.camTween.ease !== 'out' && state.camTween.dur > CAM.watchTween,
      '回瞄准仍然慢一点（不晃眼）', `${state.camTween.dur}s`);
  }

  // ---- ⑥ 球停稳后才回追踪视角（autoFocus 在球停之后才开始倒计时）----
  {
    const { rig, state } = fakeRig(a16, Math.PI / 2);
    rig.onShotFired();
    state.shooting = true;
    state.autoFocusTimer = 0.6;
    rig.update(0.5);
    check(state.trackPhase === 'watching' && state.autoFocusTimer === 0.6,
      '球还在动：镜头停在全场视角，回焦倒计时不启动');
    state.shooting = false;
    rig.update(0.61);
    check(state.trackPhase === 'aiming', '球停稳：自动回到追踪（白球后方）视角');
  }

  // ---- ⑦ 竖屏行为不被这次改动带偏（仍是长边竖进屏幕、占满）----
  {
    const a = 0.46;
    const fov = fovForAspect(a);
    const w = watchOverview(a, fov, Math.PI / 2, HEAD_SPOT, true);
    const p = projectCorners(a, fov, w.pos);
    check(p.wx > 0.85 && w.pos[0] < -0.5 && w.pos[1] > 1.5,
      '竖屏开球：相机在白球那端斜上方，长边竖进屏幕且横向占满',
      `横向占屏 ${(p.wx * 100).toFixed(0)}% · camera(${w.pos[0].toFixed(2)}, ${w.pos[1].toFixed(2)})`);
    // 锚点从桌心改成白球后，竖屏机位只应是小幅微调，不能翻天覆地
    const old = fitOverviewDist(a, fov);
    check(Math.abs(w.dist - old.dist) < 0.35,
      '竖屏观战机位与原来的"整台占满"机位基本一致（锚点改白球只是微调）',
      `${old.dist.toFixed(2)}m → ${w.dist.toFixed(2)}m`);
  }

  // ---- ⑧ 同一条件下反复调用必须稳定（机位不能每帧抖）----
  {
    const a = 1.333;
    const fov = fovForAspect(a);
    const w1 = watchOverview(a, fov, Math.PI / 3, HEAD_SPOT, false);
    const w2 = watchOverview(a, fov, Math.PI / 3, HEAD_SPOT, false);
    check(w1.dist === w2.dist, '反解结果可复现（不会每帧抖）', `${w1.dist.toFixed(3)}m`);
  }
}

/**
 * 蓄力期间"瞄准方向必须锁死"
 * ------------------------------------------------------------------
 * 用户实测报告（手机，概率性）：松开开球后视角突然旋转，白球飞出去的方向完全变了。
 * 追下来是两件事叠在一起：
 *   ① rig.update 里"推进补间"的判断排在"蓄力就冻结"之前 —— 蓄力时相机还在被补间
 *      推着走，玩家看到的朝向和冻结的 aimAngle 脱钩；
 *   ② OrbitControls 的阻尼惯性（松开手指后相机还会滑十几帧）在蓄力期间不衰减，
 *      出杆后一解锁集中放出来，就是"视角突然旋转"。
 * 所以这里守三条不变量：蓄力时相机一动不动、解锁在蓄力期间必须无效、惯性必须被吃掉。
 */
export function testAimLock() {
  console.log('\n[43] 蓄力期间的瞄准冻结（视角突然旋转的护栏）');
  const { rig, stage, state } = fakeRig(1.333, Math.PI / 2);
  // 假的 OrbitControls 也带上三份"惯性"字段（真实现的私有字段，名字带下划线）
  stage.controls._sphericalDelta = { theta: 0.4, phi: -0.2, set(a, b) { this.theta = a; this.phi = b; } };
  stage.controls._panOffset = { x: 0.3, z: -0.1, set(a, b, c) { this.x = a; this.z = b; void c; } };
  stage.controls._scale = 1.4;

  // 假装正在补间（0.9s 回瞄准位）—— 旧代码里蓄力期间它还会继续推进
  rig.startTween(new THREE.Vector3(1, 2, 3), new THREE.Vector3(0, 0.1, 0), 0.9);
  check(!!state.camTween, '先进入"机位补间中"这个状态');

  state.charging = true;
  state.lockedAim = state.aimAngle;   // main.js 的 beginCharge 做的就是这两步
  rig.lockAim();

  check(state.camTween === null, '蓄力开始：补间被取消（相机不会再自己走）');
  check(stage.controls.enabled === false, '蓄力开始：手势控制被关掉');
  check(stage.controls._sphericalDelta.theta === 0 && stage.controls._panOffset.x === 0
    && stage.controls._scale === 1, '蓄力开始：阻尼惯性被吃掉（松开后不会补放）');

  // 蓄力期间 update 必须什么都不做（相机位置逐帧不变）
  const before = stage.camera.position.clone();
  for (let i = 0; i < 10; i++) rig.update(0.016);
  check(stage.camera.position.equals(before), '蓄力期间 update 不移动相机', JSON.stringify(stage.camera.position));

  // 补间结束时的"交还控制"在蓄力期间必须无效
  rig.enableControls();
  check(stage.controls.enabled === false, '蓄力期间补间结束/解锁调用不会把控制打开');

  // 松手出杆：出杆瞬间再吃一次惯性（onShotFired 里那一下）
  stage.controls._sphericalDelta.theta = 0.5;
  state.charging = false;
  rig.onShotFired();
  check(stage.controls._sphericalDelta.theta === 0, '出杆瞬间：残留惯性被吃掉');
  check(state.camTween && state.trackPhase === 'watching', '出杆后进入观战补间');

  // 补间跑完（观战补间 0.4s）→ 这次才真的交还控制。
  // 只跑到补间结束就停：再往后 autoFocus 还会开一次 0.9s 的"回瞄准位"补间（另一条逻辑）
  let guard = 0;
  while (state.camTween && guard++ < 40) rig.update(0.016);
  check(state.camTween === null && stage.controls.enabled === true,
    '补间结束后正常交还控制', `tween=${state.camTween} enabled=${stage.controls.enabled} 帧数=${guard}`);
  // 蓄力中再按一次开球键（或补间结束回调）都不会把控制打开 —— 上面已断言，这里守一个边界：
  // 蓄力时新来的补间也不许推进（相机位置必须是"按下那一刻"的样子）
  state.charging = true;
  rig.startTween(new THREE.Vector3(9, 9, 9), new THREE.Vector3(0, 0, 0), 0.05);
  const held = stage.camera.position.clone();
  for (let i = 0; i < 5; i++) rig.update(0.05);
  check(stage.camera.position.equals(held), '蓄力期间新开的补间同样不推进相机');
  state.charging = false;
}
