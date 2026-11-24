/** 球台几何：摆球、袋口传感器、台面承载、圆形喉口、正常落袋 */
import { BALL_R, TABLE, RACK } from '../../src/constants.js';
import {
  POCKET_THROAT, POCKET_HOLE, allBallSpawns, rackApex, HEAD_SPOT,
} from '../../src/layout.js';
import { check, buildWorld, spawnBall } from '../lib/harness.mjs';

/** 1. 初始摆球间距 / 位置合理性 */
export function testRackSpacing() {
  console.log('\n[1] 初始摆球检查');
  const spawns = allBallSpawns();
  check(spawns.length === 16, '球总数 = 16', `实际 ${spawns.length}`);

  const nums = new Set(spawns.map((s) => s.number));
  check(nums.size === 16 && nums.has(0) && nums.has(8) && nums.has(15),
    '球号 0~15 无重复', `${[...nums].sort((a, b) => a - b).join(',')}`);

  let minDist = Infinity;
  let worst = '';
  for (let i = 0; i < spawns.length; i++) {
    for (let j = i + 1; j < spawns.length; j++) {
      const d = Math.hypot(spawns[i].x - spawns[j].x, spawns[i].z - spawns[j].z);
      if (d < minDist) { minDist = d; worst = `${spawns[i].number}-${spawns[j].number}`; }
    }
  }
  check(minDist >= BALL_R * 2, '无初始穿模（最小球心距 ≥ 直径）',
    `最小 ${(minDist * 1000).toFixed(2)}mm (${worst})，直径 ${(BALL_R * 2000).toFixed(2)}mm`);

  const inside = spawns.every((s) =>
    Math.abs(s.x) < TABLE.halfL - BALL_R && Math.abs(s.z) < TABLE.halfW - BALL_R);
  check(inside, '全部球位于台面内');

  // 摆球整体偏移（RACK.shiftX，2026-09-16 起为 -0.17m）：位置必须仍然合理 ——
  // 顶点球在 rackApex() 上、离白球留够助跑距离、末排离脚库别贴太近。
  const apex = spawns.find((s) => s.number === 1);
  const backRowX = Math.max(...spawns.map((s) => s.x));
  check(Math.abs(apex.x - rackApex().x) < 1e-9,
    `顶点球在 rackApex() 上（= 脚点 + RACK.shiftX ${RACK.shiftX}m）`,
    `顶点 x=${apex.x.toFixed(3)}`);
  check(apex.x - HEAD_SPOT.x > 0.6,
    '顶点球与白球之间留够助跑距离（>60cm）',
    `${((apex.x - HEAD_SPOT.x) * 100).toFixed(0)}cm`);
  check(TABLE.halfL - backRowX > 0.45,
    '末排离脚库 >45cm（真实球台约 44cm，不能把球堆顶到袋口上）',
    `${((TABLE.halfL - backRowX) * 100).toFixed(0)}cm`);
  check(Math.abs(RACK.shiftX) <= 0.3,
    '摆球偏移量在合理调参范围内（|shiftX| ≤ 30cm）', `${RACK.shiftX}m`);
}

/** 2. 6 个袋口传感器都能判定进袋 */
export function testPocketSensors() {
  console.log('\n[2] 袋口传感器逐个验证（球从袋口正上方落下）');
  const { world, sensors } = buildWorld();

  const results = sensors.map((s) => {
    const ball = spawnBall(world, 99, s.x, s.z, 0.03);
    let detected = false;
    for (let i = 0; i < 240 && !detected; i++) {
      world.step();
      world.intersectionPairsWith(s.collider, (other) => {
        if (other.handle === ball.collider.handle) detected = true;
      });
    }
    const t = ball.body.translation();
    world.removeRigidBody(ball.body);
    return { name: s.name, detected, y: t.y };
  });

  for (const r of results) {
    check(r.detected, `${r.name} 判定进袋`, `落到 y=${r.y.toFixed(3)}m`);
  }
  check(results.every((r) => r.detected), '6 个袋口全部可判定',
    `${results.filter((r) => r.detected).length}/6`);
}

/** 3. 台面不漏球（球停在袋口之外时不应掉落） */
export function testSurfaceHoldsBalls() {
  console.log('\n[3] 台面承载检查（非袋口位置的球不应穿透台布）');
  const { world } = buildWorld();
  const probes = [
    ['台面中心', 0, 0],
    ['开球点', HEAD_SPOT.x, 0],
    ['长库边中段', 0.5, TABLE.halfW - BALL_R - 0.005],
    ['短库边附近', TABLE.halfL - BALL_R - 0.005, 0],
    ['中袋旁 4cm', 0.11, TABLE.halfW - BALL_R - 0.005],
  ];
  const balls = probes.map(([, x, z]) => spawnBall(world, 99, x, z));
  for (let i = 0; i < 360; i++) world.step();

  probes.forEach(([label], i) => {
    const t = balls[i].body.translation();
    check(t.y > BALL_R * 0.6, `${label} 稳稳停在台面`, `y=${(t.y * 1000).toFixed(1)}mm`);
  });
}

/** 3.5 收口环把方形开口收成圆形喉口：只有球心真的进圆孔才落袋 */
export function testThroatCapture() {
  console.log('\n[3.5] 收口环把方形开口收成圆形喉口');
  const r = POCKET_THROAT.corner;
  check(r > BALL_R && r < TABLE.pocketCut + TABLE.cushionW,
    '喉口半径介于球半径与开口之间',
    `喉口 ${(r * 1000).toFixed(0)}mm / 球半径 ${(BALL_R * 1000).toFixed(1)}mm / 开口半宽 ${(((TABLE.pocketCut + TABLE.cushionW) / 2) * 1000).toFixed(1)}mm`);
  // 0.7.0：中袋比角袋大（真实台球就是这样，中袋入射角更刁所以要更宽）
  const rm = POCKET_THROAT.middle;
  check(rm > r && rm < POCKET_HOLE.half,
    '中袋喉口比角袋大、且仍在方形开口内',
    `中袋 ${(rm * 1000).toFixed(0)}mm / 角袋 ${(r * 1000).toFixed(0)}mm / 开口半宽 ${(POCKET_HOLE.half * 1000).toFixed(1)}mm`);

  // 逐点位发射：球心正对袋心（应落袋）vs 偏离 6.5cm（在旧方形开口内、现在应停在边缘平台上）
  const probe = (offsetX, offsetZ) => {
    const { world, sensors } = buildWorld();
    const s = sensors.find((x) => x.name === '右上角袋');
    const ball = spawnBall(world, 99, s.x + offsetX, s.z + offsetZ);
    let potted = false;
    for (let i = 0; i < 240 && !potted; i++) {
      world.step();
      for (const sen of sensors) {
        world.intersectionPairsWith(sen.collider, (other) => {
          if (other.handle === ball.collider.handle) potted = true;
        });
      }
    }
    return { potted, y: ball.body.translation().y };
  };

  const centered = probe(0, 0);
  check(centered.potted, '球心正对袋心 → 落袋', `落到 y=${centered.y.toFixed(3)}m`);

  // 注意：偏移必须朝台面内侧（右下角袋的内侧是 −x/−z 方向），
  // 朝外侧会直接与木质外框重叠，那是探针本身的错误而不是几何问题。
  const sweep = [-0.050, -0.056, -0.062, -0.068];
  const lineX = sweep.map((dx) => (probe(dx, 0).potted ? '掉' : '停')).join(' ');
  const lineDiag = sweep.map((dx) => (probe(dx * 0.7071, dx * 0.7071).potted ? '掉' : '停')).join(' ');
  console.log(`     收口后各半径是否落袋（5.0/5.6/6.2/6.8cm）: 轴向 ${lineX} · 斜向 ${lineDiag}`);

  // 断言"越靠近方口边界越不容易落袋"这条性质，而不是钉死在某个坐标上：
  // 0.7.0 把角袋喉口从 48mm 放大到 57mm 之后，平台只剩 5.5mm 宽，
  // 球心偏到 6cm 仍会被"边缘翻落"带进洞（球体压住孔沿会绕着边往里倒）——
  // 这是圆孔模型的固有行为，也正是"袋口变大了"的直观体现。
  // 所以"停在平台上"的判据取到方口角落（对角线 8.2cm）与方口之外（7.0cm）：
  // 那两处的球心已经在收口环 / 台布上，任何情况下都不该掉下去。
  const far = sweep.map((dx) => probe(dx * 0.7071, dx * 0.7071).potted);
  check(far[far.length - 1] === false, '球心偏 6.8cm（方口之外）→ 不落袋',
    `实际 ${far[far.length - 1] ? '掉' : '停'}`);
  for (const [dx, dz, label] of [
    [-0.058, -0.058, '对角线外侧（方口角落附近）'],
    [-0.070, 0, '沿 X 偏 7cm（方口之外）'],
    [0, -0.070, '沿 Z 偏 7cm（方口之外）'],
  ]) {
    const r2 = probe(dx, dz);
    check(!r2.potted, `${label} → 停在台面/边缘平台上不落袋`, `y=${(r2.y * 1000).toFixed(1)}mm`);
  }
}

/** 3.6 正常落袋仍然顺畅（收口不能把袋口"封死"） */
export function testNormalPotting() {
  console.log('\n[3.6] 正常落袋（正面进袋 / 贴库进角袋）');
  const POCKET_DIAG = 0.25;   // 起球点距袋心 25cm

  const rollInto = (pocketName, from, vel) => {
    const { world, sensors } = buildWorld();
    const s = sensors.find((x) => x.name === pocketName);
    const ball = spawnBall(world, 99, s.x + from.x, s.z + from.z);
    ball.body.setLinvel({ x: vel.x, y: 0, z: vel.z }, true);
    let potted = false;
    for (let i = 0; i < 480 && !potted; i++) {
      world.step();
      for (const sen of sensors) {
        world.intersectionPairsWith(sen.collider, (other) => {
          if (other.handle === ball.collider.handle) potted = true;
        });
      }
    }
    return potted;
  };

  // 1) 正对袋心（沿袋口轴线）
  const L = Math.hypot(1.2575, 0.6225);
  const ax = 1.2575 / L, az = 0.6225 / L;         // 由袋心指向台外的单位向量
  for (const [name, sx, sz] of [['右下角袋', 1, -1], ['右上角袋', 1, 1], ['上中袋', 0, 1]]) {
    const from = { x: -sx * ax * POCKET_DIAG, z: -sz * az * POCKET_DIAG };
    const ok = rollInto(name, from, { x: sx * ax * 0.8, y: 0, z: sz * az * 0.8 });
    check(ok, `${name}：正面来球正常落袋`);
  }

  // 2) 贴库滚进角袋（真实台球里最好打的"库边球"）
  const railRoll = rollInto('右下角袋',
    { x: -0.35, z: -(0.6225 - (0.635 - BALL_R)) },   // 起球点在长库边内侧、贴着库
    { x: 0.9, y: 0, z: 0 });
  check(railRoll, '右下角袋：贴库球沿库边滚进角袋');
}
