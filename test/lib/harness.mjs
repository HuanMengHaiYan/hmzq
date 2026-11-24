/**
 * 无头测试公共工具：断言计数 + 与游戏完全一致的物理世界搭建。
 * 复用 src/layout.js 的同一份几何定义，保证"看到的"和"测到的"完全一致。
 */
import RAPIER from '@dimforge/rapier3d-compat';
import { BALL_R, BALL_MASS, PHYS, TABLE } from '../../src/constants.js';
import { tableBoxes, pocketSensors, pocketLids } from '../../src/layout.js';

/** 球飞出台面外的判定边界（台面外框再放 3cm） */
export const OUT_X = TABLE.outerHalfL + 0.03;
export const OUT_Z = TABLE.outerHalfW + 0.03;

let pass = 0;
let fail = 0;

export function check(ok, label, detail = '') {
  if (ok) { pass++; console.log(`  [PASS] ${label} ${detail}`); }
  else { fail++; console.log(`  [FAIL] ${label} ${detail}`); }
}

export function passed() { return pass; }
export function failed() { return fail; }

export function summary() {
  console.log(`\n===== 结果：${pass} 项通过，${fail} 项失败 =====`);
  return fail;
}

/** 建立与游戏中完全一致的物理世界 */
export function buildWorld() {
  const world = new RAPIER.World(PHYS.gravity);
  world.timestep = PHYS.timestep;
  world.numSolverIterations = 8;

  const staticBody = world.createRigidBody(RAPIER.RigidBodyDesc.fixed());

  for (const b of tableBoxes()) {
    if (!b.phys) continue;
    const p = PHYS[b.phys];
    const [sx, sy, sz] = b.size;
    const [px, py, pz] = b.pos;
    const desc = RAPIER.ColliderDesc.cuboid(sx / 2, sy / 2, sz / 2)
      .setTranslation(px, py, pz)
      .setRestitution(p.restitution)
      .setFriction(p.friction);
    if (b.rotY) desc.setRotation({ x: 0, y: Math.sin(b.rotY / 2), z: 0, w: Math.cos(b.rotY / 2) });
    world.createCollider(desc, staticBody);
  }

  // 袋口盖板（默认停用 = 袋口敞开）；与游戏里的 buildTable 完全一致
  const lids = pocketLids().map((l) => {
    const p = PHYS.clothSurface;
    const collider = world.createCollider(
      RAPIER.ColliderDesc.cuboid(l.half, l.thickness / 2, l.half)
        .setTranslation(l.x, -l.thickness / 2, l.z)
        .setRestitution(p.restitution)
        .setFriction(p.friction),
      staticBody
    );
    collider.setEnabled(false);
    return { collider, index: l.index, name: l.name, x: l.x, z: l.z };
  });

  const sensors = pocketSensors().map((p) => ({
    ...p,
    collider: world.createCollider(
      RAPIER.ColliderDesc.cylinder(p.halfHeight, p.radius)
        .setTranslation(p.x, p.y, p.z)
        .setSensor(true)
        .setActiveEvents(RAPIER.ActiveEvents.COLLISION_EVENTS),
      staticBody
    ),
  }));

  return { world, sensors, lids };
}

export function spawnBall(world, number, x, z, y = BALL_R) {
  const body = world.createRigidBody(
    RAPIER.RigidBodyDesc.dynamic()
      .setTranslation(x, y, z)
      .setLinearDamping(PHYS.ball.linearDamping)
      .setAngularDamping(PHYS.ball.angularDamping)
      .setCcdEnabled(true)
  );
  const collider = world.createCollider(
    RAPIER.ColliderDesc.ball(BALL_R)
      .setRestitution(PHYS.ball.restitution)
      .setFriction(PHYS.ball.friction)
      .setMass(BALL_MASS)
      // 开启碰撞事件：与游戏一致，供「碰撞传导随机化」使用
      .setActiveEvents(RAPIER.ActiveEvents.COLLISION_EVENTS),
    body
  );
  return { number, body, collider, potted: false, path: 0, last: null };
}

/** 假刚体：用于不依赖 Rapier 的纯单元测试（结果确定、跑得飞快） */
export function mockBall(x, z, vx, vz, mass = BALL_MASS) {
  const st = { x, z, jx: 0, jz: 0 };
  return {
    potted: false, hidden: false, st,
    body: {
      mass: () => mass,
      translation: () => ({ x: st.x, y: BALL_R, z: st.z }),
      linvel: () => ({ x: vx, y: 0, z: vz }),
      applyImpulse: (imp) => { st.jx += imp.x; st.jz += imp.z; },
    },
  };
}

/** 假事件队列：按给定的碰撞对依次回调 */
export const mockQueue = (pairs) => ({
  drainCollisionEvents: (cb) => { for (const [h1, h2, started] of pairs) cb(h1, h2, started); },
});
