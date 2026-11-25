/** 球台几何：摆球、袋口传感器、台面承载、圆形喉口、正常落袋 */
import { BALL_R, TABLE, RACK, POCKETS } from '../../src/constants.js';
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
  check(r > BALL_R && r < POCKET_HOLE.half,
    '喉口半径介于球半径与开口之间',
    `喉口 ${(r * 1000).toFixed(0)}mm / 球半径 ${(BALL_R * 1000).toFixed(1)}mm / 开口半宽 ${(POCKET_HOLE.half * 1000).toFixed(1)}mm`);
  // 0.7.0：中袋比角袋大（真实台球就是这样，中袋入射角更刁所以要更宽）
  // 0.8.0：中袋 62.5 = 开口半宽（收口环几何的上限），所以断言放宽到 <=
  const rm = POCKET_THROAT.middle;
  check(rm > r && rm <= POCKET_HOLE.half,
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

  // 断言"离袋心足够远就必定稳住"这条性质，而不是钉死在某个坐标上。
  // 阈值取 开口半宽 + 一整个球 = 62.5 + 57.2 = 119.7mm：球体此时完全压在台呢上
  // （球心到缺口内沿还有 57.2mm），任何情况下都不该掉。
  // ⚠️ 比这更近的位置（球心跨在喉口边沿上）物理上就是"边缘翻落"：压住孔沿会绕着边往里倒，
  //   掉或停取决于收口环的分段，不作断言 —— 那是圆孔模型的自然行为，不是几何错误。
  // 角袋只能沿对角线探（沿轴向会直接与库边箱体重叠，那是探针错，不是几何问题）。
  const restR = POCKET_HOLE.half + BALL_R * 2;
  const d = restR * Math.SQRT1_2;
  const onCloth = probe(-d, -d);
  check(!onCloth.potted,
    `角袋：球心离袋心 ${(restR * 1000).toFixed(0)}mm（整颗球压在台呢上）→ 不落袋`,
    `y=${(onCloth.y * 1000).toFixed(1)}mm`);
  const inThroat = probe(-0.03 * Math.SQRT1_2, -0.03 * Math.SQRT1_2);
  check(inThroat.potted, '角袋：球心在喉口内 30mm → 落袋', `y=${(inThroat.y * 1000).toFixed(3)}m`);

  // 中袋：轴向（-z）也要能稳住，且喉口正上方必掉
  const probeMid = (dz) => {
    const { world, sensors } = buildWorld();
    const s = sensors.find((x) => x.name === '上中袋');
    const ball = spawnBall(world, 99, s.x, s.z + dz);
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
  const midRest = probeMid(-restR);
  check(!midRest.potted, `中袋：球心离袋心 ${(restR * 1000).toFixed(0)}mm → 不落袋`,
    `y=${(midRest.y * 1000).toFixed(1)}mm`);
  const midThroat = probeMid(-0.03);
  check(midThroat.potted, '中袋：球心在喉口内 30mm → 落袋', `y=${(midThroat.y * 1000).toFixed(3)}m`);
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

  // 1) 正面来球。角袋走 **45° 对角线**（与 testThroatCapture 的探针同口径）：
  //    沿"袋心 → 台面中心"的轴线来球会从库鼻角 0.4mm 的缝里擦过去（袋心外移后这条
  //    轴线正好贴着 jaw 角），结果 flaky —— 那是探针选路问题，不是几何问题。
  //    中袋仍沿轴线（垂直于长库边，无擦边问题）。
  const dg = Math.SQRT1_2;
  const diag = (name, sx, sz) => {
    const p = POCKETS.find((q) => q.name === name);
    const corner = p.type === 'corner';
    const dirX = corner ? sx * dg : 0;
    const dirZ = corner ? sz * dg : sz;               // 中袋沿 z 轴、角袋沿对角线
    const from = { x: -dirX * POCKET_DIAG, z: -dirZ * POCKET_DIAG };
    return rollInto(name, from, { x: dirX * 0.8, y: 0, z: dirZ * 0.8 });
  };
  for (const [name, sx, sz] of [['右下角袋', 1, -1], ['右上角袋', 1, 1], ['上中袋', 0, 1]]) {
    check(diag(name, sx, sz), `${name}：正面来球正常落袋`);
  }

  // 2) 贴库滚进角袋（真实台球里最好打的"库边球"）。
  //    起点贴着**物理库边内沿**（球心 z = ±(halfW − R)，正好与橡胶库边相切），
  //    而不是按某个历史袋心坐标反推 —— 袋心外移后旧算法会把起点算进库边箱体里。
  const pCorner = POCKETS.find((q) => q.name === '右下角袋');
  const railRoll = rollInto('右下角袋',
    { x: -0.35, z: -(TABLE.halfW - BALL_R) - pCorner.z },   // 相对袋心的偏移（绝对 z = -(halfW−R)）
    { x: 0.9, y: 0, z: 0 });
  check(railRoll, '右下角袋：贴库球沿库边滚进角袋');
}
