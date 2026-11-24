/**
 * 开球模拟：完整复刻游戏主循环里的开球逻辑
 * （冲击波 + 传导随机化 + 静止判定 + 可选的"开球保护"封袋与两道死锁保险丝）。
 */
import RAPIER from '@dimforge/rapier3d-compat';
import { BALL_R, BALL_MASS, PHYS, SHOT, RULES } from '../../src/constants.js';
import { throatRadiusOf, allBallSpawns, rackPositions } from '../../src/layout.js';
import { clampBallSpeeds, applyRollFriction, applyBreakShock, randomizeBallImpacts } from '../../src/sim.js';
import { buildWorld, spawnBall, OUT_X, OUT_Z } from './harness.mjs';

/** 满力开球 sweep 用的模拟：只统计进袋 / 逃逸 / 弹跳 / 扩散 / 收敛 */
export function runBreak(impulse, jitter) {
  const { world, sensors } = buildWorld();
  const balls = allBallSpawns().map((s) => spawnBall(world, s.number, s.x, s.z));
  const cue = balls[0];
  const byHandle = new Map(balls.map((b) => [b.collider.handle, b]));

  // 沿 +X 方向击球（相机在白球后方的典型情形）
  const dir = { x: Math.cos(jitter), z: Math.sin(jitter) };
  cue.body.applyImpulse({ x: dir.x * impulse, y: 0, z: dir.z * impulse }, true);
  const v0 = impulse / BALL_MASS;
  const roll = 0.6;
  cue.body.setAngvel({ x: (dir.z * v0 * roll) / BALL_R, y: 0, z: (-dir.x * v0 * roll) / BALL_R }, true);

  let maxSpeed = 0;
  let escaped = null;
  let maxY = 0;
  let settleStep = -1;
  const potted = [];
  const totalSteps = Math.round(25 / PHYS.timestep);
  const bodies = balls.map((b) => b.body);

  for (let step = 0; step < totalSteps; step++) {
    world.step();
    clampBallSpeeds(bodies);
    applyRollFriction(bodies);   // 与游戏主循环一致（0.7.0 滚动摩擦）

    for (const s of sensors) {
      world.intersectionPairsWith(s.collider, (other) => {
        const b = byHandle.get(other.handle);
        if (b && !b.potted) {
          b.potted = true;
          potted.push({ number: b.number, pocket: s.name, step });
        }
      });
    }

    let moving = 0;
    for (const b of balls) {
      const t = b.body.translation();
      const lv = b.body.linvel();
      const sp = Math.hypot(lv.x, lv.y, lv.z);
      maxSpeed = Math.max(maxSpeed, sp);
      maxY = Math.max(maxY, t.y);

      if (!escaped && (Math.abs(t.x) > OUT_X || Math.abs(t.z) > OUT_Z)) {
        escaped = { number: b.number, x: t.x, z: t.z, y: t.y, step };
      }
      // 只统计还在台面上的球
      // ⚠️ 静止判据必须与游戏里的 updateRestState 一致：**速度与自转都要低于阈值**。
      //    只判线速度会把"球已停住、但还在原地自转"误判成静止（0.7.0 支点摩擦修的就是这个：
      //    竖直轴自转曾要 17.5s 才停，期间玩家出不了杆）。
      if (t.y > -0.15) {
        const av = b.body.angvel();
        const spin = Math.hypot(av.x, av.y, av.z);
        if (sp >= PHYS.sleepSpeed || spin >= PHYS.sleepSpin) moving++;
        else { b.body.setLinvel({ x: 0, y: 0, z: 0 }, true); b.body.setAngvel({ x: 0, y: 0, z: 0 }, true); }
      }
    }
    if (moving === 0 && settleStep < 0 && step > 30) settleStep = step;
  }

  // 扩散度：15 颗目标球相对初始位置的平均位移
  const spawns = allBallSpawns();
  let spread = 0;
  for (let i = 1; i < balls.length; i++) {
    const t = balls[i].body.translation();
    spread += Math.hypot(t.x - spawns[i].x, t.z - spawns[i].z);
  }
  spread /= 15;

  return {
    impulse, v0, maxSpeed, escaped, maxY, potted, spread,
    settleSec: settleStep < 0 ? null : settleStep * PHYS.timestep,
  };
}

/**
 * 带"开球保护"的完整开球模拟。
 * @param guardMax 0 = 不限制（默认，与线上一致）；≥1 = 启用封袋 + 抖回台面
 */
export function runGuardedBreak(jitter, impulse = SHOT.maxImpulse, variance = 0, guardMax = RULES.breakMaxPots) {
  const { world, sensors, lids } = buildWorld();
  const balls = allBallSpawns().map((s) => spawnBall(world, s.number, s.x, s.z));
  const cue = balls[0];
  const byHandle = new Map(balls.map((b) => [b.collider.handle, b]));
  const bodies = balls.map((b) => b.body);
  const eventQueue = new RAPIER.EventQueue(true);
  const prevVel = new Map();     // 碰撞传导随机化：撞前速度

  const dir = { x: Math.cos(jitter), z: Math.sin(jitter) };
  cue.body.applyImpulse({ x: dir.x * impulse, y: 0, z: dir.z * impulse }, true);
  const v0 = impulse / BALL_MASS;
  const roll = 0.6;
  cue.body.setAngvel({ x: (dir.z * v0 * roll) / BALL_R, y: 0, z: (-dir.x * v0 * roll) / BALL_R }, true);

  let pocketsClosed = false;
  let shockPending = true;
  let nudges = 0;               // "悬在袋口的球"被轻推的次数（用于验证死锁保险丝）
  const rattleStrikes = new Map(); // 逐球的"抖回台面"次数（验证 rattleMaxStrikes 保险丝）
  const potted = [];
  const totalSteps = Math.round(25 / PHYS.timestep);
  let settleStep = -1;

  // 直接返回盖板对象（带 type / throat）：喉口半径按袋型不同，只剩 {x,z} 就判不出来
  const centerOf = (i) => lids[i];

  const anchors = rackPositions();
  for (let step = 0; step < totalSteps; step++) {
    for (const b of balls) {
      if (b.potted) continue;
      const lv = b.body.linvel();
      let e = prevVel.get(b);
      if (!e) { e = { x: 0, z: 0 }; prevVel.set(b, e); }
      e.x = lv.x; e.z = lv.z;
    }
    world.step(eventQueue);
    clampBallSpeeds(bodies);
    applyRollFriction(bodies);   // 与游戏主循环一致（0.7.0 滚动摩擦）

    // 开球冲击波：白球贴到球堆的瞬间触发（与游戏主循环完全一致）
    if (shockPending) {
      const ct = cue.body.translation();
      let near = Infinity;
      for (const a of anchors) near = Math.min(near, Math.hypot(ct.x - a.x, ct.z - a.z));
      if (near <= BALL_R * 2.05) { applyBreakShock(bodies, dir, anchors); shockPending = false; }
    }
    // 碰撞传导随机化（与游戏主循环完全一致）
    randomizeBallImpacts(eventQueue, byHandle, prevVel, {
      variance, minSpeed: RULES.collisionVarianceMinSpeed,
    });

    // 进袋判定：guardMax = 0 → 不限制（默认），整段封袋逻辑不参与
    if (!pocketsClosed) {
      const closeLids = () => {
        pocketsClosed = true;
        for (const l of lids) l.collider.setEnabled(true);
      };
      for (const s of sensors) {
        world.intersectionPairsWith(s.collider, (other) => {
          const b = byHandle.get(other.handle);
          if (b && !b.potted) {
            b.potted = true;
            potted.push({ number: b.number, pocket: s.name, step });
            if (guardMax > 0 && potted.length >= guardMax) closeLids();
          }
        });
        if (pocketsClosed) break;
      }
      // 球心进喉口并开始下沉 = 落袋（与游戏内 checkPockets 完全一致）
      for (const b of balls) {
        if (b.potted) continue;
        const t = b.body.translation();
        if (t.y > BALL_R * 0.9) continue;
        let owner = null;
        for (const s of sensors) {
          if (Math.hypot(t.x - s.x, t.z - s.z) < throatRadiusOf(s)) { owner = s; break; }
        }
        if (!owner) continue;
        // 本杆进够了：抖回台面。抖够 rattleMaxStrikes 次就烧断保险丝让它正常落袋 ——
        // 这段逻辑每个物理步都会跑，没有保险丝就会无限重投同一颗球（2026-09-16 定位的死锁根因）。
        const strikes = rattleStrikes.get(b) || 0;
        if (guardMax > 0 && potted.length >= guardMax && strikes < RULES.rattleMaxStrikes) {
          rattleStrikes.set(b, strikes + 1);
          const dx = t.x - owner.x, dz = t.z - owner.z;
          const d = Math.hypot(dx, dz) || 1;
          b.body.setLinvel({ x: (dx / d) * 0.8, y: 0.5, z: (dz / d) * 0.8 }, true);
          continue;
        }
        b.potted = true;
        potted.push({ number: b.number, pocket: owner.name, step });
        if (guardMax > 0 && potted.length >= guardMax) closeLids();
      }
    }

    // 静止判定（同时累计每颗球的行程）
    let moving = 0;
    for (const b of balls) {
      if (b.potted) continue;
      const t = b.body.translation();
      const lv = b.body.linvel();
      const sp = Math.hypot(lv.x, lv.y, lv.z);
      if (b.last) b.path += Math.hypot(t.x - b.last.x, t.z - b.last.z);
      b.last = { x: t.x, z: t.z };
      if (t.y > -0.15) {
        const av = b.body.angvel();
        const spin = Math.hypot(av.x, av.y, av.z);
        if (sp >= PHYS.sleepSpeed || spin >= PHYS.sleepSpin) moving++;
        else { b.body.setLinvel({ x: 0, y: 0, z: 0 }, true); b.body.setAngvel({ x: 0, y: 0, z: 0 }, true); }
      }
    }
    if (moving === 0 && settleStep < 0 && step > 30) settleStep = step;

    // 停稳后重新开袋（与游戏内 updatePocketReopen 完全一致，含死锁保险丝）
    if (pocketsClosed && moving === 0 && step > 30) {
      let stuck = false;
      for (let i = 0; i < lids.length; i++) {
        const c = centerOf(i);
        for (const b of balls) {
          if (b.potted) continue;
          const t = b.body.translation();
          if (Math.hypot(t.x - c.x, t.z - c.z) < throatRadiusOf(c) + BALL_R * 0.6) {
            stuck = true;
            nudges += 1;
            const dx = t.x - c.x, dz = t.z - c.z;
            const d = Math.hypot(dx, dz) || 1;
            b.body.setLinvel({ x: (dx / d) * 0.2, y: 0, z: (dz / d) * 0.2 }, true);
            break;
          }
        }
      }
      // 推够 pocketReopenMaxNudges 次就无条件开袋（宁可让它掉进去，也不能把游戏卡住）
      if (!stuck || nudges >= RULES.pocketReopenMaxNudges) {
        pocketsClosed = false;
        for (const l of lids) l.collider.setEnabled(false);
      }
    }
  }

  // 扩散度 + 收杆分区 + 平均行程 + 死锁/悬停检查
  const spawns = allBallSpawns();
  let spread = 0;
  const zones = { head: 0, mid: 0, foot: 0, left: 0, right: 0 };
  const finals = [];
  let pathSum = 0, pathN = 0, movingAtEnd = 0, hovering = 0;
  for (let i = 1; i < balls.length; i++) {
    const t = balls[i].body.translation();
    spread += Math.hypot(t.x - spawns[i].x, t.z - spawns[i].z);
    if (balls[i].potted) continue;
    finals.push({ n: balls[i].number, x: t.x, z: t.z });
    if (t.x < 0) zones.head++;
    else if (t.x < 0.6) zones.mid++;
    else zones.foot++;
    if (t.z < 0) zones.left++; else zones.right++;
    pathSum += balls[i].path || 0;
    pathN++;
    // 悬停：球心停在袋口喉口正上方（球没能正常落袋，也没能滚开）
    for (const s of sensors) {
      if (Math.hypot(t.x - s.x, t.z - s.z) < throatRadiusOf(s) * 0.9) hovering++;
    }
    const lv = balls[i].body.linvel();
    if (Math.hypot(lv.x, lv.y, lv.z) >= PHYS.sleepSpeed) movingAtEnd++;
  }
  spread /= 15;

  return {
    potted, spread, zones, finals, hovering, movingAtEnd, nudges,
    rattleStrikes: Math.max(0, ...rattleStrikes.values()),
    lidsOpen: !pocketsClosed,
    meanPath: pathN ? pathSum / pathN : 0,
    settleSec: settleStep < 0 ? null : settleStep * PHYS.timestep,
  };
}
