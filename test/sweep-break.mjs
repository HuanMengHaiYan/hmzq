/**
 * 开球参数扫描（维护工具）—— 调 RISK 开球参数前先跑这个，别凭感觉改。
 *
 * 用途：定位"同一颗球几乎每次都进"这类系统性偏差，以及扫出各旋钮的"好区"。
 * 背景：BREAK_SHOCK 的参数面非常陡 —— 例如 fanAngle 从 98 挪到 104、或
 *       RACK.shiftX 从 -0.17 挪到 -0.19，单颗球最高进袋率就会从 ~14% 跳到 45% 以上。
 *       所以 fanAngle / sideBias / RACK.shiftX / boost 任何一项改动后都必须重扫。
 *
 * 指标：进袋均值、0 进袋比例、单颗球最高进袋率（= 用户说的"每次都是那两颗球"）、
 *       末排内圈球（6/7）进袋率、单袋最高进袋率、末排占比、0.6s 内快进比例、
 *       收杆分布（头/中/脚）、半边空比例、平均行程、平均扩散、死锁数、白球进袋数。
 *
 * 用法：node test/sweep-break.mjs [每次数] ["配置1,配置2,..."]
 *   配置串格式：`平移;旋钮=值;旋钮=值`，不传则跑内置的对照表。例如
 *     node test/sweep-break.mjs 250 "-0.17"
 *     node test/sweep-break.mjs 250 "-0.17;sideBias=0.7;fan=100"
 *     node test/sweep-break.mjs 250 "-0.17;rackJit=4;rackRot=3"     # 球堆摆位微抖动
 *   可用旋钮：fan / boost / maxSpeed / scatter / sideBias / rackJit / rackRot
 *   环境变量 DETAIL=1 额外打印 球号 / 袋口 / 去向 明细。
 * 经验值：单档 250 次时，单颗球进袋率的标准误约 2%，够分辨"好区/坏区"这种量级的差别。
 */
import RAPIER from '@dimforge/rapier3d-compat';
import { BALL_R, BALL_MASS, PHYS, SHOT, RULES, TABLE, BREAK_SHOCK, RACK } from '../src/constants.js';
import { tableBoxes, pocketSensors, allBallSpawns, rackPositions, throatRadiusOf, FOOT_SPOT } from '../src/layout.js';
import { clampBallSpeeds, applyRollFriction, applyBreakShock, randomizeBallImpacts } from '../src/sim.js';

const RUNS = Number(process.argv[2] || 30);
let RACK_JIT = 0;   // 球堆摆位微抖动（毫米，每颗球独立）
let RACK_ROT = 0;   // 球堆整体微旋转（毫弧度）
await RAPIER.init();

const BACK_ROW = new Set([13, 6, 14, 7, 15]);

function build() {
  const world = new RAPIER.World(PHYS.gravity);
  world.timestep = PHYS.timestep;
  world.numSolverIterations = 8;
  const staticBody = world.createRigidBody(RAPIER.RigidBodyDesc.fixed());
  for (const b of tableBoxes()) {
    if (!b.phys) continue;
    const p = PHYS[b.phys]; const [sx, sy, sz] = b.size; const [px, py, pz] = b.pos;
    const desc = RAPIER.ColliderDesc.cuboid(sx / 2, sy / 2, sz / 2)
      .setTranslation(px, py, pz).setRestitution(p.restitution).setFriction(p.friction);
    if (b.rotY) desc.setRotation({ x: 0, y: Math.sin(b.rotY / 2), z: 0, w: Math.cos(b.rotY / 2) });
    world.createCollider(desc, staticBody);
  }
  const sensors = pocketSensors().map((p) => ({
    ...p,
    collider: world.createCollider(
      RAPIER.ColliderDesc.cylinder(p.halfHeight, p.radius).setTranslation(p.x, p.y, p.z)
        .setSensor(true).setActiveEvents(RAPIER.ActiveEvents.COLLISION_EVENTS), staticBody),
  }));
  return { world, sensors };
}
function spawn(world, number, x, z) {
  const body = world.createRigidBody(RAPIER.RigidBodyDesc.dynamic()
    .setTranslation(x, BALL_R, z).setLinearDamping(PHYS.ball.linearDamping)
    .setAngularDamping(PHYS.ball.angularDamping).setCcdEnabled(true));
  const collider = world.createCollider(RAPIER.ColliderDesc.ball(BALL_R)
    .setRestitution(PHYS.ball.restitution).setFriction(PHYS.ball.friction)
    .setMass(BALL_MASS).setActiveEvents(RAPIER.ActiveEvents.COLLISION_EVENTS), body);
  return { number, body, collider, potted: false, path: 0, last: null };
}
const SETTLE_MAX = 12 / PHYS.timestep;

function run(jitter, shiftX) {
  const { world, sensors } = build();
  // 球堆摆位微抖动：真实的球架不可能把 15 颗球摆到毫米级对称（球不完全圆、靠球时
  // 每颗球的接触点都不同）。这里给每颗球独立加一点位置偏差，并给整堆加一点微旋转。
  const spawns = allBallSpawns(shiftX).map((sp, i) => {
    if (i === 0) return sp;                       // 白球不抖
    const rot = RACK_ROT / 1000;
    const dx = sp.x - FOOT_SPOT.x, dz = sp.z;
    const rx = dx * Math.cos(rot) - dz * Math.sin(rot) + FOOT_SPOT.x;
    const rz = dx * Math.sin(rot) + dz * Math.cos(rot);
    const j = RACK_JIT / 1000;
    return {
      number: sp.number,
      x: rx + (Math.random() * 2 - 1) * j,
      z: rz + (Math.random() * 2 - 1) * j,
    };
  });
  const balls = spawns.map((s) => spawn(world, s.number, s.x, s.z));
  const cue = balls[0];
  const byHandle = new Map(balls.map((b) => [b.collider.handle, b]));
  const bodies = balls.map((b) => b.body);
  const eventQueue = new RAPIER.EventQueue(true);
  const prevVel = new Map();
  const anchors = rackPositions(shiftX);
  const dir = { x: Math.cos(jitter), z: Math.sin(jitter) };
  cue.body.applyImpulse({ x: dir.x * SHOT.maxImpulse, y: 0, z: dir.z * SHOT.maxImpulse }, true);
  const v0 = SHOT.maxImpulse / BALL_MASS;
  cue.body.setAngvel({ x: (dir.z * v0 * 0.6) / BALL_R, y: 0, z: (-dir.x * v0 * 0.6) / BALL_R }, true);
  let shockPending = true;
  const potted = [];
  let settleStep = -1;
  for (let step = 0; step < SETTLE_MAX; step++) {
    for (const b of balls) {
      if (b.potted) continue;
      const lv = b.body.linvel();
      let e = prevVel.get(b); if (!e) { e = { x: 0, z: 0 }; prevVel.set(b, e); }
      e.x = lv.x; e.z = lv.z;
    }
    world.step(eventQueue);
    clampBallSpeeds(bodies);
    applyRollFriction(bodies);   // 与游戏主循环一致（0.7.0 滚动摩擦）
    if (shockPending) {
      const ct = cue.body.translation();
      let near = Infinity;
      for (const a of anchors) near = Math.min(near, Math.hypot(ct.x - a.x, ct.z - a.z));
      if (near <= BALL_R * 2.05) { applyBreakShock(bodies, dir, anchors); shockPending = false; }
    }
    randomizeBallImpacts(eventQueue, byHandle, prevVel, {
      variance: RULES.collisionVariance, minSpeed: RULES.collisionVarianceMinSpeed,
    });
    for (const s of sensors) {
      world.intersectionPairsWith(s.collider, (other) => {
        const b = byHandle.get(other.handle);
        if (b && !b.potted) { b.potted = true; potted.push({ number: b.number, pocket: s.name, step }); }
      });
    }
    for (const b of balls) {
      if (b.potted) continue;
      const t = b.body.translation();
      if (t.y > BALL_R * 0.9) continue;
      let owner = null;
      for (const s of sensors) if (Math.hypot(t.x - s.x, t.z - s.z) < throatRadiusOf(s)) { owner = s; break; }
      if (!owner) continue;
      b.potted = true; potted.push({ number: b.number, pocket: owner.name, step });
    }
    let moving = 0;
    for (const b of balls) {
      if (b.potted) continue;
      const t = b.body.translation(); const lv = b.body.linvel();
      const sp = Math.hypot(lv.x, lv.y, lv.z);
      if (b.last) b.path += Math.hypot(t.x - b.last.x, t.z - b.last.z);
      b.last = { x: t.x, z: t.z };
      if (t.y > -0.15) {
        if (sp >= PHYS.sleepSpeed) moving++;
        else { b.body.setLinvel({ x: 0, y: 0, z: 0 }, true); b.body.setAngvel({ x: 0, y: 0, z: 0 }, true); }
      }
    }
    if (moving === 0 && step > 30) { settleStep = step; break; }
  }
  if (settleStep < 0) settleStep = SETTLE_MAX;
  const zones = { head: 0, mid: 0, foot: 0 };
  let pathSum = 0, pathN = 0, spread = 0;
  for (let i = 1; i < balls.length; i++) {
    const t = balls[i].body.translation();
    spread += Math.hypot(t.x - spawns[i].x, t.z - spawns[i].z);
    if (balls[i].potted) continue;
    if (t.x < 0) zones.head++; else if (t.x < 0.6) zones.mid++; else zones.foot++;
    pathSum += balls[i].path || 0; pathN++;
  }
  return {
    potted, zones, spread: spread / 15, meanPath: pathN ? pathSum / pathN : 0,
    settleSec: settleStep * PHYS.timestep,
  };
}

const BASE = { fan: BREAK_SHOCK.fanAngle, boost: BREAK_SHOCK.boost, maxSpeed: BREAK_SHOCK.maxSpeed };

// 配置串：`平移;knob=值;knob=值`，例如 `-0.16;fan=70` 或 `-0.16;fan=85;boost=1.8`
const CONFIGS = process.argv[3]
  ? process.argv[3].split(',').map((spec) => {
      const parts = spec.split(';');
      const shift = Number(parts[0]);
      const knobs = { ...BASE, shift, scatter: BREAK_SHOCK.scatter, sideExp: BREAK_SHOCK.sideExp, sideBias: BREAK_SHOCK.sideBias };
      const bits = [`平移${shift >= 0 ? '+' : ''}${shift.toFixed(2)}`];
      for (const p of parts.slice(1)) {
        const [k, v] = p.split('=');
        knobs[k] = Number(v);
        bits.push(`${k}${v}`);
      }
      return { name: bits.join(' '), ...knobs };
    })
  : [
      { name: '基准 fan118 boost1.6', ...BASE, shift: 0 },
      { name: '扇形 100°', fan: 100, boost: 1.6, maxSpeed: 7, shift: 0 },
      { name: '扇形 85°', fan: 85, boost: 1.6, maxSpeed: 7, shift: 0 },
      { name: '扇形 70°', fan: 70, boost: 1.6, maxSpeed: 7, shift: 0 },
      { name: 'boost 1.30', fan: 118, boost: 1.3, maxSpeed: 7, shift: 0 },
      { name: 'boost 1.10', fan: 118, boost: 1.1, maxSpeed: 7, shift: 0 },
      { name: '扇形 85 + boost 1.3', fan: 85, boost: 1.3, maxSpeed: 7, shift: 0 },
      { name: '基准 + 球堆后收 0.12', ...BASE, shift: -0.12 },
      { name: '扇形 85 + 后收 0.12', fan: 85, boost: 1.6, maxSpeed: 7, shift: -0.12 },
      { name: '限速 5.5', fan: 118, boost: 1.6, maxSpeed: 5.5, shift: 0 },
      { name: '扇形 85 + 限速 5.5', fan: 85, boost: 1.6, maxSpeed: 5.5, shift: 0 },
      { name: '扇形 100 + 限速 5.5', fan: 100, boost: 1.6, maxSpeed: 5.5, shift: 0 },
    ];

const CORNERS = [13, 15];     // 末排两个角球
const INNER = [6, 7];         // 末排两个"内圈"球（实测进脚区角袋的主力）

console.log(`满力开球参数扫描：每档 ${RUNS} 次\n`);
console.log('配置'.padEnd(22) + '进袋均值  0进%  单球最高%  内圈67%  单袋最高%  末排%  快进%  头/中/脚          半边空%  行程cm  扩散cm  死锁  白球进');
for (const c of CONFIGS) {
  const saved = { fan: BREAK_SHOCK.fanAngle, boost: BREAK_SHOCK.boost, maxSpeed: BREAK_SHOCK.maxSpeed, scatter: BREAK_SHOCK.scatter, sideExp: BREAK_SHOCK.sideExp, sideBias: BREAK_SHOCK.sideBias };
  BREAK_SHOCK.fanAngle = c.fan; BREAK_SHOCK.boost = c.boost; BREAK_SHOCK.maxSpeed = c.maxSpeed;
  BREAK_SHOCK.scatter = c.scatter ?? 0;
  BREAK_SHOCK.sideExp = c.sideExp ?? 1;
  BREAK_SHOCK.sideBias = c.sideBias ?? 0;
  RACK_JIT = c.rackJit ?? 0;
  RACK_ROT = c.rackRot ?? 0;
  const ballHist = {}, pocketHist = {}, hist = {}, pairHist = {};
  let potSum = 0, backRow = 0, scratch = 0, notSettled = 0, fastRun = 0;
  let headSum = 0, midSum = 0, footSum = 0, pathSum = 0, emptyHalf = 0, spreadSum = 0;
  for (let i = 0; i < RUNS; i++) {
    const r = run((Math.random() - 0.5) * 0.04, c.shift);
    const pots = r.potted.filter((p) => p.number !== 0);
    hist[pots.length] = (hist[pots.length] || 0) + 1;
    potSum += pots.length;
    let fast = false;
    for (const p of pots) {
      ballHist[p.number] = (ballHist[p.number] || 0) + 1;
      pocketHist[p.pocket] = (pocketHist[p.pocket] || 0) + 1;
      pairHist[`${p.number}→${p.pocket}`] = (pairHist[`${p.number}→${p.pocket}`] || 0) + 1;
      if (BACK_ROW.has(p.number)) backRow++;
      if (p.step * PHYS.timestep <= 0.6) fast = true;
    }
    if (fast) fastRun++;
    if (r.potted.some((p) => p.number === 0)) scratch++;
    if (r.settleSec >= 12) notSettled++;
    headSum += r.zones.head; midSum += r.zones.mid; footSum += r.zones.foot;
    pathSum += r.meanPath; spreadSum += r.spread;
    if (r.zones.head === 0 || r.zones.foot === 0) emptyHalf++;
  }
  const ballVals = Object.values(ballHist);
  const pocketVals = Object.values(pocketHist);
  const cornerMax = Math.max(0, ...CORNERS.map((n) => ballHist[n] || 0));
  const innerMax = Math.max(0, ...INNER.map((n) => ballHist[n] || 0));
  console.log(
    c.name.padEnd(22) +
    `${(potSum / RUNS).toFixed(2)}      ` +
    `${((hist[0] || 0) / RUNS * 100).toFixed(0)}%    ` +
    `${(Math.max(0, ...ballVals) / RUNS * 100).toFixed(0)}%       ` +
    `${(innerMax / RUNS * 100).toFixed(0)}%       ` +
    `${(Math.max(0, ...pocketVals) / RUNS * 100).toFixed(0)}%       ` +
    `${(backRow / Math.max(1, potSum) * 100).toFixed(0)}%    ` +
    `${(fastRun / RUNS * 100).toFixed(0)}%   ` +
    `${(headSum / RUNS).toFixed(1)}/${(midSum / RUNS).toFixed(1)}/${(footSum / RUNS).toFixed(1)}        ` +
    `${(emptyHalf / RUNS * 100).toFixed(0)}%      ` +
    `${(pathSum / RUNS * 100).toFixed(0)}    ` +
    `${(spreadSum / RUNS * 100).toFixed(0)}    ` +
    `${notSettled}     ${scratch}`);
  if (process.env.DETAIL === '1') {
    console.log(`    球号 ${JSON.stringify(Object.entries(ballHist).sort((a, b) => b[1] - a[1]))}`);
    console.log(`    袋口 ${JSON.stringify(Object.entries(pocketHist).sort((a, b) => b[1] - a[1]))}`);
    console.log(`    角球% ${(cornerMax / RUNS * 100).toFixed(0)} 去向 ${JSON.stringify(Object.entries(pairHist).sort((a, b) => b[1] - a[1]).slice(0, 6))}`);
  }
  BREAK_SHOCK.fanAngle = saved.fan; BREAK_SHOCK.boost = saved.boost; BREAK_SHOCK.maxSpeed = saved.maxSpeed;
  BREAK_SHOCK.scatter = saved.scatter; BREAK_SHOCK.sideExp = saved.sideExp; BREAK_SHOCK.sideBias = saved.sideBias;
}
