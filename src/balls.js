import * as THREE from 'three';
import { BALL_R, BALL_MASS, PHYS } from './constants.js';
import { HEAD_SPOT, rackLayoutFor } from './layout.js';
import { DEFAULT_BALL_SET } from './rules.js';
import { getBallTexture } from './textures.js';

function makeBallMesh(number) {
  const geo = new THREE.SphereGeometry(BALL_R, 32, 24);
  const mat = new THREE.MeshPhysicalMaterial({
    map: getBallTexture(number),
    roughness: 0.12,
    metalness: 0.0,
    clearcoat: 1,
    clearcoatRoughness: 0.06,
  });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  mesh.name = number === 0 ? 'cue-ball' : `ball-${number}`;
  return mesh;
}

/**
 * 创建全部 16 颗球（0 = 白球，1~15 = 目标球）
 * 每颗球：动态刚体 + 球形碰撞体 + CCD（防高速穿透库边）
 *
 * 为什么要一次性建满 16 颗：玩法规则（rules.js）将来可能从"中式黑八"换成别的玩法，
 * 若按球组动态增删刚体，就要处理贴图缓存、碰撞体索引、裁判表三者的一致性。
 * 现在改为「建满 + 上桌/收起」——换玩法只是把多余的球 hide 掉，物理世界不动。
 */
export function createBalls(scene, world, RAPIER) {
  const balls = [];

  const spawn = (number, x, z) => {
    const mesh = makeBallMesh(number);
    mesh.position.set(x, BALL_R, z);
    scene.add(mesh);

    const bodyDesc = RAPIER.RigidBodyDesc.dynamic()
      .setTranslation(x, BALL_R, z)
      .setLinearDamping(PHYS.ball.linearDamping)
      .setAngularDamping(PHYS.ball.angularDamping)
      .setCcdEnabled(true)
      .setCanSleep(true);
    const body = world.createRigidBody(bodyDesc);

    const colDesc = RAPIER.ColliderDesc.ball(BALL_R)
      .setRestitution(PHYS.ball.restitution)
      .setFriction(PHYS.ball.friction)
      .setMass(BALL_MASS)
      // 开启碰撞事件：用于「碰撞传导随机化」（球撞球时按随机系数补一份冲量）
      .setActiveEvents(RAPIER.ActiveEvents.COLLISION_EVENTS);
    const collider = world.createCollider(colDesc, body);

    const ball = {
      number, mesh, body, collider, isCue: number === 0,
      potted: false, hidden: false, home: { x, z },
    };
    balls.push(ball);
    return ball;
  };

  const cue = spawn(0, HEAD_SPOT.x, HEAD_SPOT.z);
  // 初始位置按默认球组摆好；真正的球组在 init 里由 resetBalls(balls, setId) 落到桌上
  for (const p of rackLayoutFor(DEFAULT_BALL_SET)) spawn(p.number, p.x, p.z);

  return { balls, cue };
}

/**
 * 「不是你的球」的半透明度（本地双人的定组提示）。
 * ------------------------------------------------------------------
 * 0.32 是"看得见但不抢眼"：还能看清号码与花色（走位还要参考它们），
 * 但一眼就能把"能打的"和"不能打的"分开。
 */
export const GHOST_OPACITY = 0.32;

/**
 * 把一颗球切成半透明 / 恢复实色（本地双人：定组之后不是自己那组的球淡下去）。
 * ------------------------------------------------------------------
 * ⚠️ 两个坑：
 *   ① `transparent` 一改，材质的着色器就要重编译，所以必须 `needsUpdate = true`，
 *      只改 `opacity` 是不生效的（半透明球会照样画成实心）。
 *   ② 半透明球要关掉 depthWrite，否则它自己的背面 / 互相遮挡会画出一团糊的色块。
 * 幂等：目标状态没变就直接返回（主循环每帧都会问一次，不能每帧重编译材质）。
 */
export function setBallGhost(b, on) {
  const m = b.mesh?.material;
  if (!m) return false;
  if (b.ghost === on) return false;
  b.ghost = on;
  if (on) {
    m.transparent = true;
    m.opacity = GHOST_OPACITY;
    m.depthWrite = false;
  } else {
    m.transparent = false;
    m.opacity = 1;
    m.depthWrite = true;
  }
  m.needsUpdate = true;
  return true;
}

/** 落袋的球：从画面与物理里一起收掉（否则会一直躺在桌下的落球盘里） */
export function hideBall(b) {
  b.hidden = true;
  b.mesh.visible = false;
  b.body.setLinvel({ x: 0, y: 0, z: 0 }, true);
  b.body.setAngvel({ x: 0, y: 0, z: 0 }, true);
  if (typeof b.body.setEnabled === 'function') b.body.setEnabled(false);
}

/**
 * 把球"拿在手里"：关掉物理（网格照常显示，不再参与碰撞求解）。
 * ------------------------------------------------------------------
 * 自由球模式拖白球时用。不关的话白球仍是动态刚体，每帧被 setTranslation 强行钉到
 * 手指位置 → 求解器把它和压着的球互相顶开 → 拖一下就把球堆推散、还会响碰撞声。
 * 玩家的心智模型是"这颗球此刻在我手里"，它就不该有物理。
 */
export function holdBall(b) {
  if (typeof b.body.setEnabled === 'function') b.body.setEnabled(false);
}

/** 交还物理（"手里"的球放回台上）；与 hideBall / showBall 的区别是不碰显隐 */
export function releaseBall(b) {
  if (typeof b.body.setEnabled === 'function') b.body.setEnabled(true);
  b.body.wakeUp();
}

/** 把收起来的球重新放回物理世界（复位 / 白球回位时用） */
function showBall(b) {
  b.hidden = false;
  b.mesh.visible = true;
  if (typeof b.body.setEnabled === 'function') b.body.setEnabled(true);
}

/** 把球按当前球组摆好：白球回开球点，本组的目标球归位，非本组的球收起 */
export function resetBalls(balls, setId = DEFAULT_BALL_SET) {
  const rack = rackLayoutFor(setId);
  const byNumber = new Map(rack.map((r) => [r.number, r]));

  for (const b of balls) {
    b.potted = false;
    const target = b.isCue ? HEAD_SPOT : byNumber.get(b.number);
    if (!target) {
      hideBall(b);              // 这套玩法不含这颗球（将来玩法球数变少时走这条）
      continue;
    }
    showBall(b);
    b.body.setTranslation({ x: target.x, y: BALL_R, z: target.z }, true);
    b.body.setRotation({ x: 0, y: 0, z: 0, w: 1 }, true);
    b.body.setLinvel({ x: 0, y: 0, z: 0 }, true);
    b.body.setAngvel({ x: 0, y: 0, z: 0 }, true);
    b.body.wakeUp();
  }
}

/**
 * 把一颗刚落袋的球放回它的**摆球位**（"重新出现在初始位置"）。
 * 目前只有一种用法：中式黑八里提前打进黑 8，扣分之后黑 8 要重新回到三角中心 ——
 * 所以调用方必须同时把它从 state.potted 里摘掉，否则清台进度会永远差一颗。
 *
 * 位置取自**当前球组**的摆位表（不是建球时那份默认球组），换球组后也对得上。
 * @param lift 额外抬高多少米再落下。摆球位可能正被别的球占着（这一杆刚把球堆炸开），
 *             从稍高处落下来比直接塞进去更不容易互相弹飞。
 * @returns 是否放回去了（该球组里没有这颗球时返回 false）
 */
export function respawnBallToRack(ball, setId = DEFAULT_BALL_SET, lift = 0) {
  const home = rackLayoutFor(setId).find((r) => r.number === ball.number);
  if (!home) return false;
  ball.potted = false;
  showBall(ball);
  ball.body.setTranslation({ x: home.x, y: BALL_R + lift, z: home.z }, true);
  ball.body.setRotation({ x: 0, y: 0, z: 0, w: 1 }, true);
  ball.body.setLinvel({ x: 0, y: 0, z: 0 }, true);
  ball.body.setAngvel({ x: 0, y: 0, z: 0 }, true);
  ball.body.wakeUp();
  return true;
}

/** 白球被打进袋后放回开球点 */
export function respawnCue(cue) {
  cue.potted = false;
  showBall(cue);
  cue.body.setTranslation({ x: HEAD_SPOT.x, y: BALL_R, z: HEAD_SPOT.z }, true);
  cue.body.setLinvel({ x: 0, y: 0, z: 0 }, true);
  cue.body.setAngvel({ x: 0, y: 0, z: 0 }, true);
  cue.body.wakeUp();
}

/** 同步物理位姿到渲染网格 */
export function syncBalls(balls) {
  for (const b of balls) {
    if (b.hidden) continue;
    const t = b.body.translation();
    const r = b.body.rotation();
    b.mesh.position.set(t.x, t.y, t.z);
    b.mesh.quaternion.set(r.x, r.y, r.z, r.w);
  }
}
