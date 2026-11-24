/**
 * 开球轨迹探针（维护工具）—— 需要"眼见为实"地看某颗球是怎么进的袋，就用它。
 *
 * 用法：node test/trace-break.mjs [次数]
 *   每次开球打印末排 4 颗球（6/7/13/15）每 0.05s 的位置与速度，以及最终进袋的袋口与时刻。
 *
 * 历史价值：正是这个探针把"几乎每次都是那两颗球进"定位到了具体机制 ——
 *   6/7 号（末排内圈，横向偏移只有角球的一半）拿到约 59° 出射角 → 擦过长边库与脚库
 *   的夹角 → 顺着库边低速滚进脚区角袋（各约 20%）。所有出射角落在 40~65° 的球都会
 *   走这条线路，所以只要把横向球的出射角抬出这段"死亡角"就能根治（见 BREAK_SHOCK.sideBias）。
 */
import RAPIER from '@dimforge/rapier3d-compat';
import { BALL_R, BALL_MASS, PHYS, SHOT, RULES, TABLE, BREAK_SHOCK, RACK } from '../src/constants.js';
import { tableBoxes, pocketSensors, allBallSpawns, rackPositions, throatRadiusOf } from '../src/layout.js';
import { clampBallSpeeds, applyRollFriction, applyBreakShock, randomizeBallImpacts } from '../src/sim.js';

await RAPIER.init();
const TRACE = new Set([6, 7, 13, 15]);
const RUNS = Number(process.argv[2] || 6);

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

function run(jitter) {
  const { world, sensors } = build();
  const spawns = allBallSpawns();
  const balls = spawns.map((s) => {
    const body = world.createRigidBody(RAPIER.RigidBodyDesc.dynamic()
      .setTranslation(s.x, BALL_R, s.z).setLinearDamping(PHYS.ball.linearDamping)
      .setAngularDamping(PHYS.ball.angularDamping).setCcdEnabled(true));
    const collider = world.createCollider(RAPIER.ColliderDesc.ball(BALL_R)
      .setRestitution(PHYS.ball.restitution).setFriction(PHYS.ball.friction)
      .setMass(BALL_MASS).setActiveEvents(RAPIER.ActiveEvents.COLLISION_EVENTS), body);
    return { number: s.number, body, collider, potted: false, trail: [] };
  });
  const cue = balls[0];
  const byHandle = new Map(balls.map((b) => [b.collider.handle, b]));
  const bodies = balls.map((b) => b.body);
  const eventQueue = new RAPIER.EventQueue(true);
  const prevVel = new Map();
  const anchors = rackPositions();
  const dir = { x: Math.cos(jitter), z: Math.sin(jitter) };
  cue.body.applyImpulse({ x: dir.x * SHOT.maxImpulse, y: 0, z: dir.z * SHOT.maxImpulse }, true);
  const v0 = SHOT.maxImpulse / BALL_MASS;
  cue.body.setAngvel({ x: (dir.z * v0 * 0.6) / BALL_R, y: 0, z: (-dir.x * v0 * 0.6) / BALL_R }, true);
  let shockPending = true;
  const potted = [];
  for (let step = 0; step < Math.round(6 / PHYS.timestep); step++) {
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
    if (step % 6 === 0) {
      for (const b of balls) {
        if (b.potted || !TRACE.has(b.number)) continue;
        const t = b.body.translation();
        const lv = b.body.linvel();
        const sp = Math.hypot(lv.x, lv.z);
        b.trail.push({ t: step * PHYS.timestep, x: +t.x.toFixed(3), z: +t.z.toFixed(3), v: +sp.toFixed(2) });
      }
    }
    for (const b of balls) {
      if (b.potted) continue;
      const t = b.body.translation();
      if (t.y > BALL_R * 0.9) continue;
      let owner = null;
      for (const s of sensors) if (Math.hypot(t.x - s.x, t.z - s.z) < throatRadiusOf(s)) { owner = s; break; }
      if (!owner) continue;
      b.potted = true;
      potted.push({ number: b.number, pocket: owner.name, t: step * PHYS.timestep, x: +t.x.toFixed(3), z: +t.z.toFixed(3) });
    }
  }
  return { potted, balls };
}

console.log(`台面 halfL=${TABLE.halfL} halfW=${TABLE.halfW} 袋口切角=${TABLE.pocketCut} 中袋口=${TABLE.pocketGapMid}`);
console.log(`球堆 apex=${(TABLE.halfL / 2 + RACK.shiftX).toFixed(3)}  末排 x=${(TABLE.halfL / 2 + RACK.shiftX + 4 * BALL_R * 2 * 1.004 * Math.cos(Math.PI / 6)).toFixed(3)}`);
console.log(`扇形角 ${BREAK_SHOCK.fanAngle}°  抖动 ${BREAK_SHOCK.scatter}°\n`);

for (let i = 0; i < RUNS; i++) {
  const jitter = (Math.random() - 0.5) * 0.04;
  const { potted, balls } = run(jitter);
  console.log(`-- 第 ${i + 1} 次（jitter ${(jitter * 1000).toFixed(1)}mrad）：` +
    potted.map((p) => `${p.number}→${p.pocket}@${p.t.toFixed(2)}s`).join(' ') || '无球进袋');
  for (const b of balls) {
    if (!TRACE.has(b.number)) continue;
    const hit = potted.find((p) => p.number === b.number);
    const trail = b.trail.slice(0, 14).map((p) => `${p.t.toFixed(2)}:(${p.x},${p.z})v${p.v}`).join(' ');
    console.log(`   ${String(b.number).padStart(2)}号 ${hit ? `→${hit.pocket}@${hit.t.toFixed(2)}s` : '未进袋'}`);
    console.log(`       ${trail}`);
  }
}
