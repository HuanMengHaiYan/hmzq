/**
 * 自动瞄准（「🎯 自动进球」）的测试
 * ------------------------------------------------------------------
 * 命中率是**量出来的**，不是靠肉眼看的：这里用与游戏完全一致的物理世界
 * （test/lib/harness.mjs 的 buildWorld / spawnBall）跑一批随机球位，
 * 让 auto-aim.js 自己决定打哪颗、朝哪个袋、用多大力度，然后把这一杆真的打出去，
 * 最后看那颗球有没有掉进袋里。
 *
 * 分三组：
 *   [几何] 幽灵球必须在目标球背向袋口的那一侧（写反会朝袋口的反方向打）
 *   [力度] 距离越远力度越大；力度永远落在玩家设置的区间里
 *   [实战] 随机球位 → 自动出杆 → 统计进球率（严格方案 ≥ 92%）
 */
import RAPIER from '@dimforge/rapier3d-compat';
import { BALL_R, BALL_MASS, PHYS, POCKETS, SHOT, TABLE, AUTO } from '../../src/constants.js';
import { throatRadiusOf } from '../../src/layout.js';
import { clampBallSpeeds, applyRollFriction } from '../../src/sim.js';
import { planAutoShot, duoTargets, angleOfDir, estimatePower } from '../../src/auto-aim.js';
import { DuoMatch } from '../../src/duo.js';
import { buildWorld, spawnBall, check } from '../lib/harness.mjs';

/** 固定种子的伪随机：同一份代码跑多少次结果都一样（不然测试会 flaky） */
function makeRnd(seed) {
  let s = seed & 0x7fffffff;
  return () => {
    s = (s * 1103515245 + 12345) & 0x7fffffff;
    return s / 0x7fffffff;
  };
}

/** 随机摆一桌球（白球 + count 颗目标球），互不重叠、不压袋口 */
export function randomLayout(count, rnd) {
  const limX = TABLE.halfL - BALL_R - 0.005;
  const limZ = TABLE.halfW - BALL_R - 0.005;
  const pts = [];
  let guard = 0;
  while (pts.length <= count && guard++ < 20000) {
    const p = { x: (rnd() * 2 - 1) * limX, z: (rnd() * 2 - 1) * limZ };
    let ok = true;
    for (const q of pts) if (Math.hypot(p.x - q.x, p.z - q.z) < BALL_R * 2.06) { ok = false; break; }
    if (ok) {
      for (const k of POCKETS) {
        if (Math.hypot(p.x - k.x, p.z - k.z) < throatRadiusOf(k) + BALL_R * 1.2) { ok = false; break; }
      }
    }
    if (ok) pts.push(p);
  }
  return pts;
}

/**
 * 跑一局：规划 → 出杆 → 模拟到停稳 → 看目标球进没进。
 * 出杆方式与 src/shot.js 的 shoot() 完全一致（冲量 + 前旋），
 * 否则测出来的命中率跟游戏里不是一回事。
 */
export function runAutoShot(pts, count, opts = {}) {
  const { world } = buildWorld();
  const balls = [spawnBall(world, 0, pts[0].x, pts[0].z)];
  const live = [];
  for (let i = 1; i <= count; i++) {
    balls.push(spawnBall(world, i, pts[i].x, pts[i].z));
    live.push({ number: i, x: pts[i].x, z: pts[i].z });
  }
  const cue = balls[0];
  const plan = planAutoShot({
    cue: { x: pts[0].x, z: pts[0].z },
    balls: live,
    targets: opts.targets ?? null,
    range: { min: SHOT.minImpulse, max: SHOT.maxImpulse },
  });
  if (!plan.best) return null;
  const p = plan.best;

  const dir = { x: Math.sin(p.aimAngle), z: Math.cos(p.aimAngle) };
  const v0 = p.impulse / BALL_MASS;
  cue.body.applyImpulse({ x: dir.x * p.impulse, y: 0, z: dir.z * p.impulse }, true);
  cue.body.setAngvel({ x: (dir.z * v0 * 0.6) / BALL_R, y: 0, z: (-dir.x * v0 * 0.6) / BALL_R }, true);

  const bodies = balls.map((b) => b.body);
  const target = balls.find((b) => b.number === p.number);
  let pottedTarget = false;
  let cuePotted = false;

  for (let step = 0; step < 3600; step++) {
    world.step();
    clampBallSpeeds(bodies);
    applyRollFriction(bodies);   // 与游戏主循环一致（0.7.0 滚动摩擦）
    for (const b of balls) {
      if (b.potted) continue;
      const t = b.body.translation();
      if (t.y > BALL_R * 0.9) continue;                    // 还在台面高度（进袋判定与 pockets.js 一致）
      for (const k of POCKETS) {
        if (Math.hypot(t.x - k.x, t.z - k.z) < throatRadiusOf(k)) {
          b.potted = true;
          if (b.number === p.number) pottedTarget = true;
          else if (b.number === 0) cuePotted = true;
          break;
        }
      }
    }
    let moving = 0;
    for (const b of balls) {
      if (b.potted) continue;
      const lv = b.body.linvel();
      const av = b.body.angvel();
      const sp = Math.hypot(lv.x, lv.y, lv.z);
      const sn = Math.hypot(av.x, av.y, av.z);
      if (sp < PHYS.sleepSpeed && sn < PHYS.sleepSpin) {
        if (sp > 0.0001 || sn > 0.0001) {
          b.body.setLinvel({ x: 0, y: 0, z: 0 }, true);
          b.body.setAngvel({ x: 0, y: 0, z: 0 }, true);
        }
      } else moving++;
    }
    if (moving === 0 && step > 40) break;
  }
  return { plan, best: p, pottedTarget, cuePotted };
}

// ---------------------------------------------------------------- 几何

export function testAutoAimGeometry() {
  console.log('\n[自动瞄准 · 几何]');

  // ① 幽灵球必须在目标球**背向袋口**那一侧：
  //    写成 + 会让白球从袋口那头撞过去，目标球被推向反方向（早期真踩过这个坑）。
  //    判据：按 plan 给出的角度出杆，白球必须先接近目标球、且撞击点离袋口比目标球更远。
  const ball = { number: 3, x: 0.3, z: 0.2 };
  const pocket = POCKETS[4];                    // 右下角袋
  const cue = { x: -0.6, z: 0.5 };
  const plan = planAutoShot({ cue, balls: [ball], range: { min: 0.05, max: 1.2 } });
  const p = plan.best;
  check(!!p, '单颗球能给出方案');
  if (p) {
    const dir = { x: Math.sin(p.aimAngle), z: Math.cos(p.aimAngle) };
    // 幽灵球 = 白球沿出杆方向走 d1
    const gx = cue.x + dir.x * p.d1;
    const gz = cue.z + dir.z * p.d1;
    const dGhost = Math.hypot(gx - pocket.x, gz - pocket.z);
    const dBall = Math.hypot(ball.x - pocket.x, ball.z - pocket.z);
    check(Math.abs(Math.hypot(gx - ball.x, gz - ball.z) - BALL_R * 2) < 1e-6,
      '幽灵球到目标球正好是两球相切（2R）', `${Math.hypot(gx - ball.x, gz - ball.z).toFixed(4)}`);
    check(dGhost > dBall, '幽灵球在目标球背向袋口的一侧（不是袋口那头）',
      `幽灵球离袋 ${dGhost.toFixed(3)} > 目标球离袋 ${dBall.toFixed(3)}`);
    // 白球朝这个方向走，是"撞向"目标球而不是背向它
    check((ball.x - cue.x) * dir.x + (ball.z - cue.z) * dir.z > 0, '出杆方向朝向目标球');
  }

  // ② aimAngle 与 aimer.js 的 aimVector 口径一致：dir = (sinθ, 0, cosθ)
  const d = { x: Math.sin(angleOfDir({ x: 0.5, z: -0.5 })), z: Math.cos(angleOfDir({ x: 0.5, z: -0.5 })) };
  check(d.x > 0 && d.z < 0, 'aimAngle → 方向向量（与 aimer.js 同源）', `${d.x.toFixed(2)}, ${d.z.toFixed(2)}`);

  // ③ 目标球被别的球挡在袋口前 → 这个袋不算"能进"
  const blocked = planAutoShot({
    cue: { x: -0.6, z: 0.2 },
    balls: [
      { number: 3, x: 0.3, z: 0.2 },
      { number: 7, x: 0.779, z: -0.211 },    // 正好堵在 3 号 → 右下角袋的路上（路径中点）
    ],
    range: { min: 0.05, max: 1.2 },
  });
  const picksRightDown = (blocked.candidates || []).some((c) => c.pocket === 4 && c.number === 3);
  check(!picksRightDown, '路径被堵的袋口不会出现在候选里');
}

// ---------------------------------------------------------------- 力度

export function testAutoAimPower() {
  console.log('\n[自动瞄准 · 力度]');
  const cfg = { ...AUTO, min: SHOT.minImpulse, max: SHOT.maxImpulse };
  const near = estimatePower(0.2, 0.25, 0.1, cfg);
  const far = estimatePower(1.1, 1.3, 0.1, cfg);
  check(far.power > near.power, '球越远力度越大',
    `近 ${(near.power * 100).toFixed(0)}% < 远 ${(far.power * 100).toFixed(0)}%`);
  check(estimatePower(0.5, 0.6, 0.7, cfg).power > estimatePower(0.5, 0.6, 0.1, cfg).power,
    '切得越薄力度越大（传过去的速度只剩 cos(cut)）');
  check(near.power >= 0 && near.power <= 1 && far.power >= 0 && far.power <= 1,
    '力度落在 0~100% 的蓄力区间内');
  check(far.impulse <= SHOT.maxImpulse + 1e-9 && near.impulse >= SHOT.minImpulse - 1e-9,
    '冲量不超过玩家设置的力度上下限');

  // 玩家把最大力度调小之后，自动进球也得跟着收敛（不然会突破设置）
  const tight = estimatePower(1.1, 1.3, 0.1, { ...cfg, max: 0.4 });
  check(tight.impulse <= 0.4 + 1e-9, '力度上限调小后自动进球不会超', tight.impulse.toFixed(3));
  // 出杆速度还有一道自己的上限（maxSpeed）：再远也不会硬到失控
  check(estimatePower(2.4, 2.4, 0.1, cfg).v0 <= AUTO.maxSpeed + 1e-9, '出杆速度有硬上限',
    `${estimatePower(2.4, 2.4, 0.1, cfg).v0.toFixed(2)} m/s`);

  // 一颗球都没有 / 台面空 → 不炸，返回空
  const none = planAutoShot({ cue: { x: 0, z: 0 }, balls: [], range: { min: 0.05, max: 1.2 } });
  check(none.best === null, '台面没有目标球时返回空方案');
}

// ---------------------------------------------------------------- 双人目标集合

export function testAutoAimDuoTargets() {
  console.log('\n[自动瞄准 · 双人目标]');
  const m = new DuoMatch();
  const open = duoTargets(m, []);
  check(open.length === 14 && !open.includes(8), '未分组：除了黑八都能打（不会替你把黑八打进去）',
    `${open.length} 颗`);

  m.groups = { 1: 'low', 2: 'high' };
  m.turn = 1;
  const mine = duoTargets(m, [1, 3]);
  check(mine.length === 5 && mine.every((n) => n <= 7), '已分组：只打自己那组剩下的', mine.join(','));

  m.turn = 1;
  const eight = duoTargets(m, [1, 2, 3, 4, 5, 6, 7]);
  check(eight.length === 1 && eight[0] === 8, '自己那组清完了 → 只打黑八');
}

// ---------------------------------------------------------------- 最后兜底

/**
 * 白球被挡死时也必须给个方案（早期版本会返回 null → 玩家点了按钮什么都没发生）。
 * 真机里最常见的触发场景是**弱开球后球堆没散开、白球贴在堆上**：
 * 通往任何一颗球的幽灵球的直线都被邻球挡住，strict 与 loose 全是空的。
 */
export function testAutoAimLastResort() {
  console.log('\n[自动瞄准 · 白球被挡死时的最后兜底]');
  // 一堵"球墙"横在白球与目标球之间（墙上的球都不在合法目标里，所以不会被考虑去打）
  const wall = [9, 10, 11, 12, 13, 14, 15].map((n, i) => ({ number: n, x: -0.3, z: (i - 3) * 0.06 }));
  const target = { number: 3, x: 0.5, z: 0 };
  const r = planAutoShot({
    cue: { x: -0.9, z: 0 },
    balls: [...wall, target],
    targets: [3],                  // 只准打 3 号，墙上的球不许碰
  });
  check(r.strictCount === 0, '这一局确实一个"能进的球"都没有（球墙挡死了）', `${r.strictCount}`);
  check(!!r.best, '被挡死时也返回方案（不是 null —— 否则点了按钮没反应）');
  check(!!(r.best && r.best.lastResort), '这个方案标记为"最后兜底"', String(r.best && r.best.number));
  check(!!(r.best && r.best.number === 3), '兜底打的仍是合法目标球（不会去撞不该碰的球）',
    String(r.best && r.best.number));
  const want = angleOfDir({ x: target.x - (-0.9), z: target.z - 0 });
  check(!!(r.best && Math.abs(r.best.aimAngle - want) < 1e-9), '兜底方向 = 直接朝那颗球推过去');
  check(!!(r.best && r.best.power >= 0 && r.best.power <= 1), '兜底力度也在 0~100% 之间',
    `${r.best && Math.round(r.best.power * 100)}%`);

  // 正常局面下不该动用兜底（否则每次都变成"随便撞一下"，命中率就没意义了）
  const rnd = makeRnd(20260927);
  let used = 0;
  for (let i = 0; i < 12; i++) {
    const pts = randomLayout(6, rnd);
    const p = planAutoShot({
      cue: pts[0],
      balls: pts.slice(1).map((q, k) => ({ number: k + 1, x: q.x, z: q.z })),
    });
    if (p.best && p.best.lastResort) used++;
  }
  check(used === 0, `正常球型下不会退化成兜底（12 局里 ${used} 局）`);
}

// ---------------------------------------------------------------- 实战命中率

/**
 * 随机球位 → 自动出杆 → 统计进球率。
 * 只统计"它自己认为能进"的那一类方案（strict）—— 一颗球都被堵死时它走兜底方案，
 * 那是"至少别犯规"，本来就不承诺进球。
 */
export function testAutoAimHitRate(runs = 160, seed = 20260927) {
  console.log(`\n[自动瞄准 · 实战命中率] ${runs} 个随机球位（种子 ${seed}）`);
  const rnd = makeRnd(seed);
  let strictN = 0, strictHit = 0, fbN = 0, fbHit = 0, cuePot = 0, none = 0;

  for (let i = 0; i < runs; i++) {
    const count = [1, 2, 3, 5, 8, 12][i % 6];
    const pts = randomLayout(count, rnd);
    if (pts.length <= count) continue;
    const r = runAutoShot(pts, count);
    if (!r) { none++; continue; }
    if (r.best.strict) {
      strictN++;
      if (r.pottedTarget) strictHit++;
    } else {
      fbN++;
      if (r.pottedTarget) fbHit++;
    }
    if (r.cuePotted) cuePot++;
  }

  const rate = strictHit / Math.max(1, strictN);
  console.log(`  严格方案 ${strictHit}/${strictN} = ${(rate * 100).toFixed(1)}%` +
    ` · 兜底 ${fbHit}/${fbN} · 无方案 ${none} · 白球掉袋 ${cuePot}`);
  return { strictN, strictHit, fbN, fbHit, cuePot, none, runs };
}

/**
 * 0.7.0 改为 3 种子聚合断言：
 * 实测同一参数、同一种子跨进程运行时命中率会在 ±2 颗内波动（约 ±0.7 个百分点，
 * 推测来自 Rapier 求解器的跨进程非确定性），单种子 160 局的断言会因此在门槛上抖红。
 * 三个种子合计约 425 局"严格方案"，把抽样波动压到门槛以下；门槛本身（≥92%）不变。
 */
export function testAutoAimHitRateAggregated(runs = 160, seeds = [20260927, 77, 123456]) {
  console.log(`\n[自动瞄准 · 实战命中率（${seeds.length} 种子聚合）] 每种子 ${runs} 个随机球位`);
  let strictN = 0, strictHit = 0, fbN = 0, fbHit = 0, cuePot = 0, none = 0;
  for (const seed of seeds) {
    const r = testAutoAimHitRate(runs, seed);
    strictN += r.strictN; strictHit += r.strictHit;
    fbN += r.fbN; fbHit += r.fbHit; cuePot += r.cuePot; none += r.none;
  }
  const rate = strictHit / Math.max(1, strictN);
  console.log(`  聚合：严格方案 ${strictHit}/${strictN} = ${(rate * 100).toFixed(1)}% · ` +
    `兜底 ${fbHit}/${fbN} · 无方案 ${none} · 白球掉袋 ${cuePot}`);
  check(strictN > 120, '样本量够（聚合严格方案 ≥ 120 次）', `${strictN}`);
  check(rate >= 0.92, '它说能进的球，进球率 ≥ 92%（3 种子聚合，消除单次抽样波动）', `${(rate * 100).toFixed(1)}%`);
  check(cuePot / Math.max(1, strictN + fbN) <= 0.06, '自动出杆很少把白球打进袋', `${cuePot} 次`);
  check(none / (runs * seeds.length) <= 0.06, '几乎不会"连个方案都给不出来"', `${none}/${runs * seeds.length}`);
}
