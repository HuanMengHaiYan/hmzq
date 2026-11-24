/**
 * src/sim.js 的纯单元测试：
 *   3.7 碰撞传导随机化（用假刚体，不依赖 Rapier，结果确定、跑得飞快）
 *   3.8 开球扇形扩散（决定球能否铺满全场）
 */
import { BALL_R, BALL_MASS, PHYS, SHOT, RULES, BREAK_SHOCK } from '../../src/constants.js';
import { rackPositions, HEAD_SPOT } from '../../src/layout.js';
import { randomizeBallImpacts, applyBreakShock, applyRollFriction, clampBallSpeeds } from '../../src/sim.js';
import { check, buildWorld, spawnBall, mockBall, mockQueue } from '../lib/harness.mjs';

/* ============ 3.7：碰撞传导随机化（±50%） ============ */
export function testImpactVariance() {
  const variance = RULES.collisionVariance;
  console.log(`\n[3.7] 碰撞传导随机化（±${(variance * 100).toFixed(0)}%）`);
  const e = PHYS.ball.restitution;
  const CLOSING = 2.0;

  // 几何：两球沿 +x 相邻，球 1 以接近速度 2 m/s 撞向静止的球 2
  const setup = () => {
    const b1 = mockBall(0, 0, CLOSING, 0);
    const b2 = mockBall(BALL_R * 2, 0, 0, 0);
    return {
      b1, b2,
      prevVel: new Map([[b1, { x: CLOSING, z: 0 }], [b2, { x: 0, z: 0 }]]),
      byHandle: new Map([[11, b1], [22, b2]]),
    };
  };
  const J = ((1 + e) / 2) * BALL_MASS * CLOSING;   // 引擎本应传导的冲量

  // 1) 动量守恒：两颗球受到的冲量等大反向
  const s0 = setup();
  randomizeBallImpacts(mockQueue([[11, 22, true]]), s0.byHandle, s0.prevVel, { variance });
  check(Math.abs(s0.b1.st.jx + s0.b2.st.jx) < 1e-12 && Math.abs(s0.b1.st.jz + s0.b2.st.jz) < 1e-12,
    '球球碰撞补的冲量等大反向（总动量严格守恒）',
    `球1 (${s0.b1.st.jx.toFixed(4)}, ${s0.b1.st.jz.toFixed(4)}) 球2 (${s0.b2.st.jx.toFixed(4)}, ${s0.b2.st.jz.toFixed(4)})`);
  check(s0.b2.st.jx * s0.b1.st.jx < 0 && Math.abs(s0.b1.st.jz) < 1e-12 && Math.abs(s0.b2.st.jz) < 1e-12,
    '冲量严格沿接触法线方向（两球方向相反、垂直分量恰好为 0）',
    `球2 冲量 (${s0.b2.st.jx.toFixed(4)}, ${s0.b2.st.jz.toFixed(4)})`);

  // 2) 浮动区间：|ΔJ| ≤ variance·J，且确实用满了区间
  let maxAbs = 0, sum = 0;
  const N = 4000;
  for (let i = 0; i < N; i++) {
    const s = setup();
    randomizeBallImpacts(mockQueue([[11, 22, true]]), s.byHandle, s.prevVel, { variance });
    const d = Math.abs(s.b2.st.jx);
    maxAbs = Math.max(maxAbs, d);
    sum += d;
  }
  check(maxAbs <= variance * J + 1e-9,
    `单次浮动不超过 ±${(variance * 100).toFixed(0)}%·J（J=${J.toFixed(4)} N·s）`,
    `实测最大 ${((maxAbs / J) * 100).toFixed(1)}%·J`);
  check(maxAbs > variance * J * 0.9, '浮动确实用满了 ±50% 区间（不是只抖一点点）',
    `最大 ${((maxAbs / J) * 100).toFixed(1)}%·J · 平均 |ΔJ| ${((sum / N / J) * 100).toFixed(1)}%·J`);

  // 3) 无系统性偏向：加强 / 减弱各约一半
  let pos = 0, neg = 0;
  for (let i = 0; i < 4000; i++) {
    const s = setup();
    randomizeBallImpacts(mockQueue([[11, 22, true]]), s.byHandle, s.prevVel, { variance });
    if (s.b2.st.jx > 0) pos++; else neg++;
  }
  const ratio = pos / (pos + neg);
  check(Math.abs(ratio - 0.5) < 0.04, '浮动无系统性偏向（加强 / 减弱各约一半）',
    `加强占比 ${(ratio * 100).toFixed(1)}%`);

  // 4) 接近速度太小 → 不加噪（否则求解器会在轻微接触上抖动）
  const sb = mockBall(0, 0, 0.02, 0);
  const sb2 = mockBall(BALL_R * 2, 0, 0, 0);
  randomizeBallImpacts(mockQueue([[11, 22, true]]), new Map([[11, sb], [22, sb2]]),
    new Map([[sb, { x: 0.02, z: 0 }], [sb2, { x: 0, z: 0 }]]), { variance });
  check(sb.st.jx === 0 && sb2.st.jx === 0,
    `接近速度 < ${RULES.collisionVarianceMinSpeed} m/s 时不加噪`, '冲量为 0');

  // 5) 只处理球与球：撞库边 / 盖板（handle 不在表里）不参与
  const s5 = setup();
  const n5 = randomizeBallImpacts(mockQueue([[11, 999, true], [999, 888, true]]), s5.byHandle, s5.prevVel, { variance });
  check(n5 === 0 && s5.b2.st.jx === 0, '只对「球撞球」生效（撞库边 / 盖板不加噪）', `命中 ${n5} 次`);

  // 6) 已落袋的球不参与
  const s6 = setup();
  s6.b2.potted = true;
  randomizeBallImpacts(mockQueue([[11, 22, true]]), s6.byHandle, s6.prevVel, { variance });
  check(s6.b2.st.jx === 0, '已落袋的球不参与随机化');

  // 7) 普通击球（variance = 0）完全不加噪 —— 保证「瞄得准」不被随机化破坏
  const s7 = setup();
  randomizeBallImpacts(mockQueue([[11, 22, true]]), s7.byHandle, s7.prevVel, { variance: 0 });
  check(s7.b2.st.jx === 0 && s7.b1.st.jx === 0, '普通击球（variance=0）不加噪，手感可预测');

  // 8) 只统计 "started" 的新接触（持续接触不会反复注入冲量）
  const s8 = setup();
  const n8 = randomizeBallImpacts(mockQueue([[11, 22, true], [11, 22, false], [22, 11, false]]),
    s8.byHandle, s8.prevVel, { variance });
  check(n8 === 1, '只有「新发生的接触」计入（持续接触不重复加噪）', `命中 ${n8} 次`);
}

/* ============ 3.8：开球扇形扩散 ============ */
export function testBreakFan() {
  console.log('\n[3.8] 开球扇形扩散：末排角球必须带「向后」分量 —— 这是球能回到头区的唯一途径');
  const anchors = rackPositions();
  const dir = { x: 1, z: 0 };
  const { world } = buildWorld();
  const cue = spawnBall(world, 0, HEAD_SPOT.x, HEAD_SPOT.z);
  const balls = anchors.map((a) => spawnBall(world, a.number, a.x, a.z));
  const bodies = [cue.body, ...balls.map((b) => b.body)];

  const v0 = SHOT.maxImpulse / BALL_MASS;
  cue.body.setLinvel({ x: v0, y: 0, z: 0 }, true);
  check(applyBreakShock(bodies, dir, anchors), '开球冲击波成功施加');

  const perp = { x: -dir.z, z: dir.x };
  const vel = balls.map((b) => {
    const lv = b.body.linvel();
    return {
      n: b.number,
      f: lv.x * dir.x + lv.z * dir.z,
      t: lv.x * perp.x + lv.z * perp.z,
      sp: Math.hypot(lv.x, lv.z),
    };
  });
  const angOf = (v) => (Math.atan2(v.t, v.f) * 180) / Math.PI;

  // 1) 安全保险丝：最快球不超过 BREAK_SHOCK.maxSpeed
  const fastest = Math.max(...vel.map((v) => v.sp));
  check(fastest <= BREAK_SHOCK.maxSpeed + 1e-6,
    `最快球不超过保险丝 ${BREAK_SHOCK.maxSpeed} m/s（扇形角调大也不会失控）`,
    `实测最快 ${fastest.toFixed(2)} m/s`);

  // 2) 净横向动量严格为 0（扇形左右对称，不会把球堆整体推向某一侧）
  const latSum = BALL_MASS * vel.reduce((a, v) => a + v.t, 0);
  check(Math.abs(latSum) < 1e-9, '净横向动量严格为 0（左右完全对称）', `${latSum.toExponential(1)} N·s`);

  // 3) 顶点球向前、末排角球带向后分量
  const sProj = anchors.map((a) => a.x * dir.x + a.z * dir.z);
  const tProj = anchors.map((a) => Math.abs(a.x * perp.x + a.z * perp.z));
  const sMin = Math.min(...sProj), sMax = Math.max(...sProj), tMax = Math.max(...tProj);
  const apexK = sProj.indexOf(sMin);
  const cornerK = sProj.reduce((best, s, k) => {
    const score = ((s - sMin) / (sMax - sMin)) * (tProj[k] / tMax);
    return score > best.score ? { k, score } : best;
  }, { k: 0, score: -1 }).k;

  check(vel[apexK].f > 0, '顶点球朝前（被白球正面撞击，方向不变）',
    `${vel[apexK].n} 号 前向 ${vel[apexK].f.toFixed(2)} m/s`);
  check(vel[cornerK].f < 0, '末排角球带「向后」分量（真实球堆的楔形扩散，球因此能回到头区）',
    `${vel[cornerK].n} 号 前向 ${vel[cornerK].f.toFixed(2)} m/s`);

  // 4) 扇形角符合配置
  const cornerAng = Math.abs(angOf(vel[cornerK]));
  check(Math.abs(cornerAng - BREAK_SHOCK.fanAngle) < 6,
    `最外侧末排球的偏转角 ≈ 配置的扇形角 ${BREAK_SHOCK.fanAngle}°`, `实测 ${cornerAng.toFixed(1)}°`);

  // 5) 扇形分层的两条单调性：同一横向偏移下越靠后越大；同一纵深下越靠边越大。
  //    注意：这里**不再**断言"偏转角随 纵深×横向 单调递增" —— 新的 sideBias 横向压缩
  //    有意打破了这个性质：末排内圈球（6/7 号）被主动抬到更大的出射角，好让它们
  //    离开 40~65° 那段"死亡角"（那段角度会让球顺着库边滚进脚区角袋）。
  const keys = anchors.map((a, k) => ({
    k, sn: (sProj[k] - sMin) / (sMax - sMin), tn: tProj[k] / tMax,
  }));
  let monoDepth = true, monoSide = true;
  for (const A of keys) {
    for (const B of keys) {
      if (Math.abs(A.tn - B.tn) < 1e-6 && A.sn > B.sn + 1e-6
        && Math.abs(angOf(vel[A.k])) < Math.abs(angOf(vel[B.k])) - 1e-6) monoDepth = false;
      if (Math.abs(A.sn - B.sn) < 1e-6 && A.tn > B.tn + 1e-6
        && Math.abs(angOf(vel[A.k])) < Math.abs(angOf(vel[B.k])) - 1e-6) monoSide = false;
    }
  }
  check(monoDepth, '同一横向偏移下，越靠后的球偏转角越大（纵深分层）');
  check(monoSide, '同一纵深下，越靠边的球偏转角越大（横向分层）');

  // 6) 末排的"横向球"必须离开 40~65° 的死亡角 —— 这是"几乎每次都那两颗球进"的根因防护
  const lateralBack = keys.filter((x) => x.sn > 0.99 && x.tn > 0.4);
  const minAng = Math.min(...lateralBack.map((x) => Math.abs(angOf(vel[x.k]))));
  check(minAng > 75,
    '末排横向球的出射角全部离开 40~65° 的"死亡角"（改成撞长边库弹回，不再贴库滚进角袋）',
    `最低 ${minAng.toFixed(1)}°（共 ${lateralBack.length} 颗）`);

  // 7) 白球基本停在球堆附近（不抢球堆的能量）
  const cv = cue.body.linvel();
  const cueSpeed = Math.hypot(cv.x, cv.z);
  check(cueSpeed < v0 * 0.15,
    `白球撞后大幅减速（只保留 ${(BREAK_SHOCK.cueShare * 100).toFixed(0)}% 动量）`,
    `${v0.toFixed(2)} → ${cueSpeed.toFixed(2)} m/s`);
}

/* ============ 3.9：支点摩擦（竖直轴自转的停转时间） ============ */
/**
 * 回归背景（2026-11-04）：体检 P1 把 angularDamping 从 0.9 降到 0.15 后，
 * **绕竖直轴**的自转没人管了 —— 这类自转的接触点瞬时速度为 0（v = ω×r 且 r 竖直），
 * 台布 Coulomb 摩擦给不出力矩，实测 ω=20 要 17.5 秒才停，期间 updateRestState
 * 一直判"还在动"，玩家出不了杆。修法是 applyRollFriction 里补一个支点摩擦角减速度。
 *
 * 断言守三件事：
 *   ① 竖直轴自转必须几秒内停（≤2.5s；修之前 17.5s）
 *   ② 水平轴（滚动）自转**不许**被误伤（否则长台手感回退，即 P1 的根因）
 *   ③ 正在落袋下坠的球（y<0）不施加
 */
export function testSpinFriction() {
  console.log('\n[3.9] 支点摩擦：竖直轴自转要几秒内停，且不误伤滚动自转');
  const DT = PHYS.timestep;

  /** 跑一段物理，返回自转降到 0.5 rad/s 的时间（axis: 'y' 竖直 / 'z' 水平） */
  const sim = (v0, w0, axis, maxSec = 8) => {
    const { world } = buildWorld();
    const b = spawnBall(world, 0, 0, 0);
    b.body.setLinvel({ x: v0, y: 0, z: 0 }, true);
    b.body.setAngvel(axis === 'y' ? { x: 0, y: w0, z: 0 } : { x: 0, y: 0, z: -w0 }, true);
    let t = 0, stopAt = null;
    for (let i = 0; i < 120 * maxSec; i++) {
      world.step();
      clampBallSpeeds([b.body]);
      applyRollFriction([b.body]);
      t += DT;
      const av = b.body.angvel();
      const w = axis === 'y' ? Math.abs(av.y) : Math.hypot(av.x, av.z);
      if (w < 0.5) { stopAt = t; break; }
    }
    return { stopAt, ball: b, world };
  };

  // ① 快侧旋
  const fast = sim(0, 20, 'y');
  check(fast.stopAt !== null && fast.stopAt <= 2.5,
    '竖直轴自转 ω=20 在 2.5s 内停住（修前 17.5s，转太久还锁着出杆）',
    fast.stopAt === null ? '8s 内没停' : `${fast.stopAt.toFixed(2)}s`);

  // ② 中等侧旋
  const mid = sim(0, 8, 'y');
  check(mid.stopAt !== null && mid.stopAt <= 1.5,
    '竖直轴自转 ω=8 在 1.5s 内停住',
    mid.stopAt === null ? '8s 内没停' : `${mid.stopAt.toFixed(2)}s`);

  // ③ 滚动自转不许被误伤。注意不能拿"ω/(v/R)"或解析减速当基准：
  //    滚动时 ω 被接触约束锁死，砍它只会让线速度多掉（表现是长台变重）；
  //    而 Rapier 自身的滚动损耗本来就比 rollDecel 模型大，解析值对不上。
  //    所以这里比的是**同一场景开关支点摩擦的差异** —— 语义就是"不碰滚动"。
  {
    const rollOnce = (spinDecel) => {
      const saved = PHYS.ball.spinDecel;
      PHYS.ball.spinDecel = spinDecel;
      const { world } = buildWorld();
      const b = spawnBall(world, 0, 0, 0);
      const v0 = 2.0;
      b.body.setLinvel({ x: v0, y: 0, z: 0 }, true);
      b.body.setAngvel({ x: 0, y: 0, z: -v0 / BALL_R }, true);
      for (let i = 0; i < 120; i++) {          // 1s
        world.step();
        clampBallSpeeds([b.body]);
        applyRollFriction([b.body]);
      }
      PHYS.ball.spinDecel = saved;
      const lv = b.body.linvel();
      const t = b.body.translation();
      return { v: Math.hypot(lv.x, lv.z), x: t.x };
    };
    const on = rollOnce(PHYS.ball.spinDecel);
    const off = rollOnce(0);
    const dv = Math.abs(on.v - off.v) / off.v;
    const dx = Math.abs(on.x - off.x);
    check(dv < 0.005 && dx < 0.005,
      '滚动自转没被支点摩擦误伤（开关它时滚动轨迹必须一致，长台手感不回退）',
      `Δv ${(dv * 100).toFixed(2)}% · Δx ${(dx * 1000).toFixed(1)}mm（v=${off.v.toFixed(2)} m/s）`);
  }

  // ④ 下坠中的球不施加
  {
    const { world } = buildWorld();
    const b = spawnBall(world, 0, 0, 0, BALL_R);
    b.body.setTranslation({ x: 0, y: -0.5, z: 0 }, true);
    b.body.setAngvel({ x: 0, y: 20, z: 0 }, true);
    for (let i = 0; i < 36; i++) {           // 0.3s
      world.step();
      clampBallSpeeds([b.body]);
      applyRollFriction([b.body]);
    }
    const wy = Math.abs(b.body.angvel().y);
    check(wy > 18.5, '正在落袋下坠的球不施加支点摩擦', `ω.y = ${wy.toFixed(1)} rad/s`);
  }
}
