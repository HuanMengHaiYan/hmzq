/**
 * 🎱 杆法（击球点偏移 → 旋转球）的测试
 * ------------------------------------------------------------------
 * 杆法盘拖出来的 sx / sy 只是一对数，真正的手感全在 `SHOT.spin` 那几个增益上。
 * 这里分两层验：
 *
 *   ① 语文层（纯数学）：`spinAngular()` 把击球点换算成角速度 —— 中心击球必须**逐位等于**
 *      0.7.0 的老行为（长台手感、开球标定全靠它），高杆 / 低杆 / 侧塞只许改自己那一项。
 *   ② 手感层（真物理）：低杆撞完真的往回缩、高杆真的多送一段、侧塞撞库真的偏出去、
 *      强旋不会让球"原地转十几秒"导致出不了下一杆。
 *
 * ⚠️ 物理循环必须与主循环同口径：`world.step → clampBallSpeeds → applyRollFriction` 三步，
 *    少跑一步滚动摩擦就失真（见 MEMORY 里那条铁律）。
 * ⚠️ 这里**故意不调 randomizeBallImpacts**（±50% 随机传导）：它是随机的，断言会时红时绿。
 *    要验的东西是"杆法之间的差"，不是"这一杆准不准"。
 */
import { BALL_R, BALL_MASS, SHOT, PHYS } from '../../src/constants.js';
import RAPIER from '@dimforge/rapier3d-compat';
import {
  spinAngular, applyRollFriction, clampBallSpeeds, applyCushionEnglish,
  applyThrow, randomizeBallImpacts,
} from '../../src/sim.js';
import { buildWorld, spawnBall, check } from '../lib/harness.mjs';

const CFG = SHOT.spin;
const ROLL_OMEGA = (v) => v / BALL_R;          // 纯滚动角速度 v/R

/* ============ ① 击球点 → 角速度（纯数学） ============ */

export function testSpinAngular() {
  console.log('\n[杆法·换算] 击球点 → 初始角速度');
  const V = 3.0;                                // 出杆后白球速度 3 m/s
  const dir = { x: 1, z: 0 };                   // 朝 +x 出杆
  const w = ROLL_OMEGA(V);

  // 1) 中心击球 = 0.7.0 的老行为（6 位小数逐位比，别宽到"看起来差不多"）
  const center = spinAngular(dir, V, { x: 0, y: 0 });
  check(
    Math.abs(center.x - 0) < 1e-12 &&
    Math.abs(center.y - 0) < 1e-12 &&
    Math.abs(center.z - (-w * CFG.baseRoll)) < 1e-12,
    '中心击球 = 旧行为（ω = (v/R)·0.6 前旋，无侧旋）',
    `ω = (${center.x.toFixed(3)}, ${center.y.toFixed(3)}, ${center.z.toFixed(3)}), v/R·baseRoll = ${(-w * CFG.baseRoll).toFixed(3)}`
  );

  // 2) 省略 spin（AI 与老调用点）必须与中心击球等价
  const none = spinAngular(dir, V);
  check(
    none.x === center.x && none.y === center.y && none.z === center.z,
    '不传 spin（电脑出杆 / 老调用点）= 中心击球',
    `ω = (${none.x.toFixed(3)}, ${none.y.toFixed(3)}, ${none.z.toFixed(3)})`
  );

  // 3) 方向对应纯滚动关系：ω = (v/R)·roll · (dz, 0, −dx)
  const rollOf = (spin) => {
    const a = spinAngular(dir, V, spin);
    return -a.z / w;                            // dir = +x 时 ω.z = −dir.x·w·roll
  };
  check(Math.abs(rollOf({ x: 0, y: 0 }) - CFG.baseRoll) < 1e-12,
    '滚动分量方向与出杆方向一致（不会打成倒转）',
    `dir=+x → ω.z = ${spinAngular(dir, V, {}).z.toFixed(3)}（负值 = 正向前旋）`);

  // 4) 高杆：0.6 → 0.8（多送一点，但不追过旋 —— 过旋台布不响应，白转）
  const high = rollOf({ x: 0, y: 1 });
  check(Math.abs(high - (CFG.baseRoll + CFG.rollGainUp)) < 1e-12 && high > CFG.baseRoll,
    '拖到最上 = 高杆（滚动倍数 0.6 → 0.8）',
    `roll = ${high.toFixed(3)}`);

  // 5) 低杆：必须变成负值（回旋），否则撞完不会往回缩
  const low = rollOf({ x: 0, y: -1 });
  check(low < 0 && Math.abs(low - (CFG.baseRoll - CFG.rollGainDown)) < 1e-12,
    '拖到最下 = 低杆（滚动倍数为负 = 回旋）',
    `roll = ${low.toFixed(3)}`);

  // 6) 侧塞：ω.y = sideGain·sx·(v/R)，且不许动滚动分量（滚/塞互相独立）
  const right = spinAngular(dir, V, { x: 1, y: 0 });
  const left = spinAngular(dir, V, { x: -1, y: 0 });
  const sideExpect = CFG.sideGain * w;
  check(
    Math.abs(right.y - sideExpect) < 1e-12 && Math.abs(left.y + sideExpect) < 1e-12,
    '左右塞等大反向（ω.y = sideGain·sx·v/R）',
    `右塞 ω.y = ${right.y.toFixed(3)} · 左塞 ω.y = ${left.y.toFixed(3)}`
  );
  check(Math.abs(right.z - center.z) < 1e-12 && Math.abs(right.x - center.x) < 1e-12,
    '加塞不改滚动分量（滚动与塞互不干扰）',
    `ω.z = ${right.z.toFixed(3)} vs 中心 ${center.z.toFixed(3)}`);

  // 7) 侧塞上限：力度拉满也不许超过 maxSideSpin（否则停转时间爆掉）
  const fast = spinAngular(dir, 7.06, { x: 1, y: 0 });
  check(Math.abs(fast.y - CFG.maxSideSpin) < 1e-9,
    `强杆侧塞钳在上限 ${CFG.maxSideSpin} rad/s`,
    `7 m/s 满塞 → ω.y = ${fast.y.toFixed(3)}（未钳会是 ${(CFG.sideGain * ROLL_OMEGA(7.06)).toFixed(1)}）`);

  // 8) 越界输入钳到 ±1（杆法盘已经钳过一次，这里再兜一层：脚本/AI 直接喂值也安全）
  const over = spinAngular(dir, V, { x: 3, y: 3 });
  const edge = spinAngular(dir, V, { x: 1, y: 1 });
  check(over.x === edge.x && over.y === edge.y && over.z === edge.z,
    '越界击球点（|s|>1）钳回边缘，不会打出夸张的旋转',
    `(3,3) 与 (1,1) 结果相同：ω.y = ${over.y.toFixed(3)}`);

  // 9) 脏输入不产 NaN（NaN 会直接让球消失，比打偏严重得多）
  const bad = spinAngular(dir, V, { x: NaN, y: undefined });
  const finite = Number.isFinite(bad.x) && Number.isFinite(bad.y) && Number.isFinite(bad.z);
  check(finite && bad.y === 0 && bad.z === center.z,
    'NaN / undefined 当中心击球处理（不产 NaN 角速度）',
    `ω = (${bad.x}, ${bad.y}, ${bad.z})`);
}

/* ============ ② 真物理：这一杆打出去到底怎么走 ============ */

/** 与 updateRestState 同口径的"静止"判据：速度与自转都低才算停 */
function atRest(bodies) {
  for (const b of bodies) {
    const lv = b.linvel(), av = b.angvel();
    if (Math.hypot(lv.x, lv.y, lv.z) >= PHYS.sleepSpeed) return false;
    if (Math.hypot(av.x, av.y, av.z) >= PHYS.sleepSpin) return false;
  }
  return true;
}

/**
 * 打一杆：白球在原点朝 +x 出杆，正前方 gap 处摆一颗目标球，跑到白球停稳。
 * 返回白球最终位置 / 目标球被撞时拿到的速度 / 用时。
 *
 * ⚠️ 目标球被撞飞后**立刻从物理世界里移除**：否则它撞到对面库边会弹回来再撞白球一次，
 *    白球会被顶到出发线后面（实测中杆能跑到 −0.42m），量出来的"高杆跟进"全是假的。
 *    移除只发生在撞完之后，所以"这一下怎么传力"完全不受影响。
 */
function runShot({ spin, power = 0.5, gap = 0.30, maxSteps = 4800 } = {}) {
  const { world } = buildWorld();
  const cue = spawnBall(world, 0, 0, 0);
  const target = spawnBall(world, 1, gap, 0);
  let bodies = [cue.body, target.body];
  const dir = { x: 1, z: 0 };
  const impulse = SHOT.minImpulse + (SHOT.maxImpulse - SHOT.minImpulse) * power;
  const v = impulse / BALL_MASS;

  cue.body.applyImpulse({ x: dir.x * impulse, y: 0, z: dir.z * impulse }, true);
  cue.body.setAngvel(spinAngular(dir, v, spin), true);

  let step = 0;
  let hit = false;
  let targetV = 0;                     // 目标球被撞后拿到的速度（杆法不该改这个）
  for (; step < maxSteps; step++) {
    world.step();
    clampBallSpeeds(bodies);
    applyRollFriction(bodies);
    if (!hit) {
      const tv = target.body.linvel();
      const s = Math.hypot(tv.x, tv.z);
      if (s > 0.05) {
        hit = true;
        targetV = s;
        world.removeRigidBody(target.body);
        bodies = [cue.body];
      }
    } else if (atRest(bodies)) break;
  }
  const cp = cue.body.translation();
  return {
    cueX: cp ? cp.x : NaN,
    targetV,
    seconds: step * PHYS.timestep,
    settled: hit && step < maxSteps,
  };
}

export function testSpinPhysics() {
  console.log('\n[杆法·物理] 低杆拉回 / 高杆跟进 / 侧塞偏库 / 停转时间（power 0.5，正撞 0.30m 外的目标球）');

  // 同一套球位只改杆法：三杆的差就是杆法本身带来的
  const center = runShot({ spin: null });
  const high = runShot({ spin: { x: 0, y: 1 } });
  const low = runShot({ spin: { x: 0, y: -1 } });
  const detail = `中杆 ${center.cueX.toFixed(3)}m ｜ 高杆 ${high.cueX.toFixed(3)}m ｜ 低杆 ${low.cueX.toFixed(3)}m`;

  check(center.settled && high.settled && low.settled, '三杆都停稳了（没滚出台 / 卡死）', detail);

  // 接触点：白球球心能走到的最远处（两球相切时）
  const CONTACT_X = 0.30 - 2 * BALL_R;

  // 1) 高杆跟进：撞完白球还要往前多送一段。
  //    ⚠️ 门槛只有 8cm 是因为**高杆已经接近饱和**：中杆 0.6 的滚动倍数本身就跟进得很凶，
  //       0.6 → 0.8 只多送 ≈12cm（实测）。想让它再多只能靠过旋，而台布摩擦不响应过旋
  //       （0.8 / 1.0 / 2.15 打出来一模一样），所以阈值按量出来的值定，不按想象定。
  check(high.cueX - center.cueX > 0.08,
    '高杆：撞完继续跟进（比中杆多送 >8cm）',
    `Δ = ${((high.cueX - center.cueX) * 100).toFixed(0)}cm`);

  // 2) 低杆拉回：撞完往回收，落点明显比中杆靠后
  check(center.cueX - low.cueX > 0.4,
    '低杆：撞完往回缩（比中杆退 >40cm）',
    `Δ = ${((center.cueX - low.cueX) * 100).toFixed(0)}cm`);

  // 3) 拉杆必须是"真回缩"：落点跑到接触点之前，而不是"只是少走一点"
  check(low.cueX < CONTACT_X - 0.15,
    '低杆的落点在接触点之前（真回缩，不是"少走一点"）',
    `低杆 ${low.cueX.toFixed(3)}m < 接触点 ${CONTACT_X.toFixed(3)}m`);

  // 4) 三杆顺序必须严格：低杆 < 中杆 < 高杆（谁都不能串位）
  check(low.cueX < center.cueX && center.cueX < high.cueX,
    '杆法单调：低杆 < 中杆 < 高杆（不会互相串位）', detail);

  // 5) 目标球该拿到的速度三杆都差不多（杆法只改白球，不该改传球）
  const spread = Math.max(high.targetV, center.targetV, low.targetV) -
    Math.min(high.targetV, center.targetV, low.targetV);
  check(spread < 0.15,
    '杆法不改变目标球的受力（三杆传球速度差 < 0.15 m/s）',
    `目标球 ${low.targetV.toFixed(2)} / ${center.targetV.toFixed(2)} / ${high.targetV.toFixed(2)} m/s`);

  // 6) 空 spin 与 (0,0) 必须逐位一致（保证老标定一点都没被碰到）
  const zero = runShot({ spin: { x: 0, y: 0 } });
  check(zero.cueX === center.cueX && zero.seconds === center.seconds,
    '空杆法与 (0,0) 完全等价（中心击球的老手感没被带动）',
    `cueX ${zero.cueX.toFixed(6)} vs ${center.cueX.toFixed(6)}`);
}

export function testSpinCushion() {
  console.log('\n[杆法·库边] 侧塞把出射方向带偏（applyCushionEnglish）');

  /** 造一颗假球：线速度 + 侧旋（可选滚动自转），够 applyCushionEnglish 用 */
  const mob = (vx, vz, wy, wx = 0, wz = 0) => {
    const st = { x: vx, z: vz, wx, wy, wz };
    return {
      st,
      body: {
        angvel: () => ({ x: st.wx, y: st.wy, z: st.wz }),
        linvel: () => ({ x: st.x, y: 0, z: st.z }),
        setLinvel: (l) => { st.x = l.x; st.z = l.z; },
        setAngvel: (a) => { st.wx = a.x; st.wy = a.y; st.wz = a.z; },
      },
    };
  };
  const degOf = (vx, vz) => (Math.atan2(vz, vx) * 180) / Math.PI;

  // 1) 无塞：函数完全不参与（老路径逐位不动）
  const plain = mob(1.2, 0, 0);
  const acted = applyCushionEnglish(plain);
  check(acted === false && plain.st.x === 1.2 && plain.st.z === 0,
    '中心击球（ω.y = 0）不补塞 —— 老手感完全不动',
    `返回值 ${acted}，速度 (${plain.st.x}, ${plain.st.z})`);

  // 2) 轻塞残量不补（阈值 englishMinSpin）
  const tiny = mob(1.2, 0, CFG.englishMinSpin - 0.5);
  check(applyCushionEnglish(tiny) === false && tiny.st.z === 0,
    `小于 ${CFG.englishMinSpin} rad/s 的残塞不补（收球阶段不会被轻塞拖着走）`,
    `ω.y = ${(CFG.englishMinSpin - 0.5).toFixed(1)} rad/s`);

  // 3) 满塞偏角 = englishDeg·maxSideSpin，且不超过 maxEnglishDeg
  const right = mob(1.2, 0, CFG.maxSideSpin);
  applyCushionEnglish(right);
  const ang = degOf(right.st.x, right.st.z);
  const expect = Math.min(CFG.englishDeg * CFG.maxSideSpin, CFG.maxEnglishDeg);
  check(Math.abs(Math.abs(ang) - expect) < 0.3 && Math.abs(ang) > 3,
    `满塞撞库偏 ${expect.toFixed(1)}°（>3°，肉眼能看出球拐了）`,
    `实测 ${ang.toFixed(2)}°`);

  // 4) 左右塞偏反向
  const left = mob(1.2, 0, -CFG.maxSideSpin);
  applyCushionEnglish(left);
  check(degOf(left.st.x, left.st.z) * ang < 0,
    '左右塞把球带向相反的两侧（不是一起往同一边拐）',
    `右塞 ${ang.toFixed(2)}° · 左塞 ${degOf(left.st.x, left.st.z).toFixed(2)}°`);

  // 5) 只转方向、不改速率（加横向速度会被台布摩擦 0.2 秒抹平，所以刻意不这么做）
  const spd = Math.hypot(right.st.x, right.st.z);
  check(Math.abs(spd - 1.2) < 1e-9,
    '只旋转出射速度、不改速率（球不会突然加速）',
    `|v| = ${spd.toFixed(6)} m/s（出射前 1.200000）`);

  // 6) 钳位：塞再大也只到 maxEnglishDeg
  const huge = mob(1.2, 0, 200);
  applyCushionEnglish(huge);
  check(Math.abs(Math.abs(degOf(huge.st.x, huge.st.z)) - CFG.maxEnglishDeg) < 0.3,
    `塞量超上限时偏角钳在 ${CFG.maxEnglishDeg}°`,
    `ω.y = 200 → ${degOf(huge.st.x, huge.st.z).toFixed(2)}°`);

  // 6.5) 滚动自转必须跟着转（否则球打滑，4cm 内被台布摩擦拽回原方向）
  //      纯滚动条件 ω.x = v.z/R、ω.z = −v.x/R 在转向后必须依然成立
  const roll = mob(1.2, 0, CFG.maxSideSpin, 0, -1.2 / BALL_R);
  applyCushionEnglish(roll);
  const pureOk =
    Math.abs(roll.st.wx - roll.st.z / BALL_R) < 1e-9 &&
    Math.abs(roll.st.wz + roll.st.x / BALL_R) < 1e-9 &&
    Math.abs(roll.st.wy - CFG.maxSideSpin) < 1e-9;
  check(pureOk,
    '滚动自转跟着出射方向一起转（转向后仍是纯滚动，球不打滑）',
    `ω = (${roll.st.wx.toFixed(2)}, ${roll.st.wy.toFixed(2)}, ${roll.st.wz.toFixed(2)})，` +
    `纯滚动应为 (${(roll.st.z / BALL_R).toFixed(2)}, …, ${(-roll.st.x / BALL_R).toFixed(2)})`);

  // 7) 真物理穿一遍：带塞撞库后，白球真的往侧面跑了（不是只在函数里转了个数）
  //    ⚠️ 补塞只该在"撞库那一瞬"发生一次 —— 游戏里由碰撞事件触发；
  //       测试里盯着 linvel.x 由正转负的那一步手工调一次，每帧都调会把球转成风车。
  const runInto = (wy) => {
    const { world } = buildWorld();
    const cue = spawnBall(world, 0, 0, 0);
    const bodies = [cue.body];
    const v = 0.35 / BALL_MASS;
    cue.body.applyImpulse({ x: 0.35, y: 0, z: 0 }, true);   // 朝 +x 侧库推过去
    // ⚠️ 侧旋之外**必须给滚动自转**：只给 ω.y 的球是在台布上纯滑动的，
    //    摩擦 0.9m 就把它磨停了（根本到不了 1.27m 外的库边），测出来"没跑偏"是假象。
    const w = spinAngular({ x: 1, z: 0 }, v, { x: 0, y: 0 });
    w.y = wy;
    cue.body.setAngvel(w, true);
    let bounced = false;
    let prevVx = null;
    let maxAbsZ = 0;
    for (let i = 0; i < 2400; i++) {
      world.step();
      clampBallSpeeds(bodies);
      applyRollFriction(bodies);
      const lv = cue.body.linvel();
      // 必须在"真的弹回来了"（vx 已经明显反号）那一刻补 —— 接触过程跨好几步，
      // 刚过零点时速度还接近 0，那时候补会被 englishMinSpin 之外的速度门限直接跳过。
      if (!bounced && prevVx !== null && prevVx > 0.05 && lv.x < -0.1) {
        if (applyCushionEnglish(cue)) bounced = true;
      }
      prevVx = lv.x;
      const tt = cue.body.translation();
      if (tt) maxAbsZ = Math.max(maxAbsZ, Math.abs(tt.z));
      if (bounced && atRest(bodies)) break;
    }
    const t = cue.body.translation();
    return { z: t ? t.z : 0, maxAbsZ };
  };
  const sideRun = runInto(CFG.maxSideSpin);
  const straightRun = runInto(0);
  check(Math.abs(sideRun.z - straightRun.z) > 0.02,
    '满塞撞库后白球真的跑偏了（终点横向差 >2cm）',
    `带塞 z = ${sideRun.z.toFixed(3)}m ｜ 无塞 z = ${straightRun.z.toFixed(3)}m`);
  check(sideRun.maxAbsZ > 0.05 && straightRun.maxAbsZ < 0.01,
    '跑偏只发生在带塞那一杆（无塞那杆全程直线）',
    `带塞最大 |z| = ${(sideRun.maxAbsZ * 100).toFixed(1)}cm ｜ 无塞 ${(straightRun.maxAbsZ * 1000).toFixed(1)}mm`);

  // 8) 方向必须对（2026-11-25 用户实测踩过的坑：偏是偏了，方向反了看不出来 ——
  //    右塞（ω.y>0）撞库后要往**玩家右侧**弹（真实台球：摩擦把球往塞的那一侧推）。
  //    之前写成 −englishDeg·ω.y，右塞往左弹，横向差照样有、上面的断言照样绿。）
  check(sideRun.z > 0.02,
    '右塞（ω.y > 0）撞库往玩家右侧弹（真实方向，不是只要"偏了"就行）',
    `终点 z = ${(sideRun.z * 100).toFixed(1)}cm（+z = 玩家右手边）`);
  const leftRun = runInto(-CFG.maxSideSpin);
  check(leftRun.z < -0.02,
    '左塞（ω.y < 0）撞库往玩家左侧弹（与右塞镜像）',
    `终点 z = ${(leftRun.z * 100).toFixed(1)}cm`);
}

/* ============ ③ 真物理：甩球（spin-induced throw） ============ */

export function testSpinThrow() {
  console.log('\n[杆法·甩球] 带塞直打目标球，目标球要被"甩"偏（打目标球时侧旋的唯一效果）');

  // —— 纯函数层 ——
  const mob = (vx, vz, wy) => {
    const st = { x: vx, z: vz, wy };
    return {
      st,
      body: {
        angvel: () => ({ x: 0, y: st.wy, z: 0 }),
        linvel: () => ({ x: st.x, y: 0, z: st.z }),
        setLinvel: (l) => { st.x = l.x; st.z = l.z; },
      },
    };
  };
  // 1) 无塞不参与（中心击球零效果 = 老手感）
  const plain = mob(1.2, 0, 0);
  check(applyThrow(plain, mob(0.9, 0, 0)) === false,
    '无塞（ω.y = 0）不甩球 —— 中心击球的老路径逐位不动', '');
  // 2) 残塞低于阈值不甩
  const tiny = mob(1.2, 0, CFG.englishMinSpin - 0.5);
  check(applyThrow(tiny, mob(0.9, 0, 0)) === false,
    `低于 ${CFG.englishMinSpin} rad/s 的残塞不甩（收球阶段的轻碰不搅局）`, '');
  // 3) 右塞把目标球往左甩、只转方向不改速率
  const cue = mob(1.5, 0, CFG.maxSideSpin);
  const obj = mob(0.9, 0, 0);
  check(applyThrow(cue, obj) === true, '满塞甩球生效', '');
  const deg = (Math.atan2(obj.st.z, obj.st.x) * 180) / Math.PI;
  const expect = Math.min(CFG.throwDeg * CFG.maxSideSpin, CFG.maxThrowDeg);
  check(Math.abs(obj.st.z) > 0 && deg < 0,
    '右塞（ω.y > 0）把目标球往**左**甩（真实台球方向：摩擦把目标球往塞的反侧拽）',
    `出射偏角 ${deg.toFixed(2)}°（负 = 左）`);
  check(Math.abs(Math.abs(deg) - expect) < 0.3,
    `满塞甩角 = throwDeg·maxSideSpin = ${expect.toFixed(2)}°（真实 2~4°，游戏给到 5° 是为了看得见）`,
    `实测 ${Math.abs(deg).toFixed(2)}°`);
  const spd = Math.hypot(obj.st.x, obj.st.z);
  check(Math.abs(spd - 0.9) < 1e-9, '甩球只旋转目标球方向、不改速率', `|v| = ${spd.toFixed(6)}`);
  check(Math.abs(obj.st.z / obj.st.x + Math.tan((expect * Math.PI) / 180)) < 1e-9,
    '甩角方向与符号推导一致（θ = +throwDeg·ω.y）', `z/x = ${obj.st.z.toFixed(4)}`);

  // —— 真物理层（事件驱动路径 = 游戏同款：world.step → clamp → 摩擦 → randomizeBallImpacts）——
  // 带塞直打 0.30m 外的目标球，量目标球**撞后第一段**的出射偏角。
  const runStraight = (sx) => {
    const { world } = buildWorld();
    const cueB = spawnBall(world, 0, 0, 0);
    const target = spawnBall(world, 1, 0.30, 0);
    const eventQueue = new RAPIER.EventQueue(true);
    const byHandle = new Map();
    for (const b of [cueB, target]) byHandle.set(b.body.collider(0).handle, b);
    const bodies = [cueB.body, target.body];
    const impulse = SHOT.minImpulse + (SHOT.maxImpulse - SHOT.minImpulse) * 0.5;
    const v = impulse / BALL_MASS;
    cueB.body.applyImpulse({ x: impulse, y: 0, z: 0 }, true);
    cueB.body.setAngvel(spinAngular({ x: 1, z: 0 }, v, { x: sx, y: 0 }), true);
    const prevVel = new Map();
    let tAng = null;
    for (let i = 0; i < 4800; i++) {
      prevVel.clear();
      for (const b of [cueB, target]) {
        const lv = b.body.linvel();
        prevVel.set(b, { x: lv.x, z: lv.z });
      }
      world.step(eventQueue);
      clampBallSpeeds(bodies);
      applyRollFriction(bodies);
      randomizeBallImpacts(eventQueue, byHandle, prevVel, { variance: 0, minSpeed: 0.1 });
      if (tAng === null) {
        const tv = target.body.linvel();
        const s = Math.hypot(tv.x, tv.z);
        if (s > 0.05) tAng = (Math.atan2(tv.z, tv.x) * 180) / Math.PI;
      }
      if (tAng !== null && Math.hypot(cueB.body.linvel().x, cueB.body.linvel().z) < PHYS.sleepSpeed) break;
    }
    return tAng;
  };
  const rightRun = runStraight(1);
  const leftRun = runStraight(-1);
  const noneRun = runStraight(0);
  check(rightRun !== null && rightRun < -1,
    '真物理：右塞直打，目标球被甩向左（|偏角| > 1°）',
    `右塞 ${rightRun?.toFixed(2)}° · 左塞 ${leftRun?.toFixed(2)}° · 无塞 ${noneRun?.toFixed(2)}°`);
  check(leftRun !== null && leftRun > 1,
    '真物理：左塞直打，目标球被甩向右（与右塞镜像）', '');
  check(Math.abs(noneRun ?? 0) < 0.3,
    '真物理：无塞直打几乎零偏角（甩球没有污染中心击球）',
    `无塞偏角 ${(noneRun ?? 0).toFixed(3)}°`);
}

export function testSpinSettle() {
  console.log('\n[杆法·停转] 强旋不能把出杆卡住（自转不停 = 判"还在动" = 出不了下一杆）');

  const side = runShot({ spin: { x: 1, y: 1 }, maxSteps: 7200 });
  const low = runShot({ spin: { x: -1, y: -1 }, maxSteps: 7200 });
  const budget = 4.6;                 // 用户能忍受的上限（含走位 + 停转）
  check(side.settled && side.seconds <= budget,
    `最大侧塞一杆 ${budget}s 内停稳（spinDecel ${PHYS.ball.spinDecel} rad/s² 兜着）`,
    `实测 ${side.seconds.toFixed(2)}s`);
  check(low.settled && low.seconds <= budget,
    `最大回旋一杆 ${budget}s 内停稳`,
    `实测 ${low.seconds.toFixed(2)}s`);

  // 侧塞上限 × 衰减率 = 理论归零时间；超了就会出现"球看着不动、却一直出不了杆"
  const zeroTime = SHOT.spin.maxSideSpin / PHYS.ball.spinDecel;
  check(zeroTime <= 3.0,
    '侧塞上限与 spinDecel 匹配（纯自转归零 ≤ 3s）',
    `${SHOT.spin.maxSideSpin} / ${PHYS.ball.spinDecel} = ${zeroTime.toFixed(2)}s`);
}
