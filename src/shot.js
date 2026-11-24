import { BALL_R, SHOT, PHYS } from './constants.js';
import { applyBreakShock } from './sim.js';
import { respawnCue } from './balls.js';
import { beginShot, endShot } from './state.js';
import { aimVector } from './aimer.js';

/**
 * 出杆：把蓄力值变成冲量，并把这一杆的状态登记好。
 * @returns 是否真的出杆了（球还在动 / 白球进袋时出不了杆）
 */
export function shoot({ state, cue, power, aimAngle }) {
  if (state.shooting || cue.potted) return false;

  const dir = aimVector(aimAngle);
  const impulse = SHOT.minImpulse + (SHOT.maxImpulse - SHOT.minImpulse) * power;

  cue.body.wakeUp();
  cue.body.applyImpulse({ x: dir.x * impulse, y: 0, z: dir.z * impulse }, true);

  // 前旋：让球更快从"滑动"过渡到"滚动"。
  // 纯滚动条件（接触点瞬时速度为零）：ω = (v·dz/R, 0, −v·dx/R)。
  // 之前符号写反了 —— 白球拿到的是"倒转"，一路上被台布摩擦死死拖住（实测 0.2 秒就掉 46% 速度）。
  const v = impulse / cue.body.mass();
  const roll = 0.6;
  cue.body.setAngvel({ x: (dir.z * v * roll) / BALL_R, y: 0, z: (-dir.x * v * roll) / BALL_R }, true);

  state.shooting = true;
  state.shots += 1;
  state.lastPower = power;
  state.cueAnim = 0.0001;          // 触发球杆击球动画
  beginShot(state, dir);
  return true;
}

/**
 * 开球冲击波触发检测：白球贴到球堆的那一瞬间，把动量按真实开球的方式重新分配。
 * 没打中球堆（打空）就永远不会触发，球堆不会被凭空炸开。
 */
export function maybeBreakShock({ state, cue, ballBodies, rackAnchors }) {
  if (!state.breakShockPending) return;
  const t = cue.body.translation();
  let near = Infinity;
  for (const a of rackAnchors) near = Math.min(near, Math.hypot(t.x - a.x, t.z - a.z));
  if (near > BALL_R * 2.05) return;
  state.breakShockPending = false;
  applyBreakShock(ballBodies, state.breakDir, rackAnchors);
}

/**
 * 静止检测：清掉已经慢下来的球的残余速度，返回还在运动的球数。
 * 球全部停稳的那一帧会触发一次"本杆结束"（白球复位、计数清零、开袋）。
 */
export function updateRestState({ state, balls, cue, onSettled }) {
  let moving = 0;

  for (const b of balls) {
    if (b.potted || b.hidden) continue;        // 已落袋的球不再参与"是否还在动"的判断
    const t = b.body.translation();
    if (t.y <= -0.15) continue;                // 已经掉到台面以下（正在落袋）

    const lv = b.body.linvel();
    const av = b.body.angvel();
    const speed = Math.hypot(lv.x, lv.y, lv.z);
    const spin = Math.hypot(av.x, av.y, av.z);

    if (speed < PHYS.sleepSpeed && spin < PHYS.sleepSpin) {
      if (speed > 0.0001 || spin > 0.0001) {
        b.body.setLinvel({ x: 0, y: 0, z: 0 }, true);
        b.body.setAngvel({ x: 0, y: 0, z: 0 }, true);
      }
    } else {
      moving++;
    }
  }

  const wasShooting = state.shooting;
  state.shooting = moving > 0;

  if (wasShooting && !state.shooting) {
    if (state.cueNeedsRespawn) {
      respawnCue(cue);
      state.cueNeedsRespawn = false;
    }
    endShot(state);
    onSettled?.();
  }
  return moving;
}

/**
 * 白球复位（**每一帧都问一次**，而不是只在"刚停稳那一帧"问）。
 * ------------------------------------------------------------------
 * 老写法把复位挂在 `wasShooting && !state.shooting` 这个**边沿**上，于是有个低概率死局：
 *   白球停在袋口，其余球先停稳 → 边沿触发（此时白球还没落袋，不复位）→
 *   下一帧白球慢慢沉进喉口 → `cue.potted = true`、`cueNeedsRespawn = true` →
 *   但"停稳"这个边沿已经过去了，永远不会有第二次 → 白球回不来。
 * 表现：出杆键一直灰着（`canCharge` 看 `cue.potted`）、相机的注视点追着袋子里那颗
 * 看不见的白球跑（视角像是卡在袋口）、白球也摆不回开球点。
 *
 * 改成"只要白球不在台上、且场上没有球在动，就把它放回去"——幂等，任何时候都能自愈。
 * @returns 是否真的复位了
 */
export function respawnCueIfIdle({ state, cue }) {
  if (!cue.potted || state.shooting) return false;
  respawnCue(cue);
  state.cueNeedsRespawn = false;
  return true;
}

/** 每个物理步开始前记录各球速度（撞前速度），供"碰撞传导随机化"算接近速度 */
export function snapshotVelocities(balls, prevVel) {
  for (const b of balls) {
    if (b.hidden) continue;
    const lv = b.body.linvel();
    let e = prevVel.get(b);
    if (!e) { e = { x: 0, z: 0 }; prevVel.set(b, e); }   // 复用对象，避免每步 new（120 次/秒的 GC）
    e.x = lv.x; e.z = lv.z;
  }
}
