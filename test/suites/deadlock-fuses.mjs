/**
 * 8. 开球保护的两道死锁保险丝
 *
 * 确定性复现 2026-09-16 定位到的死锁（玩家原话："如果进了第二颗球，第二颗球就会一直在
 * 球洞上反复移动且进不了球，两颗以上时就更是变成了死锁无法继续游戏了"）。
 *
 * 根因不在"盖板"，而在"本杆进够了就把球抖回台面"的那段代码：它位于一个
 * **每个物理步都会执行**的循环里，只要球心沉到台面以下（y ≤ 0.9R）且位于喉口内，
 * 就给它一记"往外 0.8m/s + 往上 0.5m/s"的重投。球刚被弹起来、还没离开喉口，
 * 下一步又被重投 —— 既出不去也停不下来，state.shooting 永远为真 → 玩家永远无法出杆。
 * 场景 A 用最小场景把这个循环确定性地复现出来（对照组 = maxStrikes 无穷 = 修复前）。
 *
 * 场景 B 覆盖另一条路径：袋口被盖板封住时，停在盖板上的球会被 updatePocketReopen
 * 每 0.3s 轻推一次。这条路径在几何上多数情况能自己滚出去（所以对照组不一定卡死），
 * 保险丝属于"兜底"：即使球卡在袋口角落，也一定会在有限次内开袋。
 */
import { BALL_R, PHYS, RULES } from '../../src/constants.js';
import { throatRadiusOf } from '../../src/layout.js';
import { check, buildWorld, spawnBall } from '../lib/harness.mjs';

/** 场景 A：每个物理步重投同一颗球（死锁根因） */
function runRattle(maxStrikes, seconds = 20) {
  const { world, sensors } = buildWorld();
  const s = sensors.find((x) => x.name === '上中袋');
  const ball = spawnBall(world, 99, s.x, s.z);         // 从袋口正上方落下去
  const steps = Math.round(seconds / PHYS.timestep);
  let strikes = 0, potted = false, pottedAt = null, movingSteps = 0, redrops = 0;
  for (let step = 0; step < steps; step++) {
    world.step();
    const t = ball.body.translation();
    const lv = ball.body.linvel();
    if (Math.hypot(lv.x, lv.y, lv.z) >= PHYS.sleepSpeed) movingSteps++;
    if (potted) continue;
    if (t.y > BALL_R * 0.9) {
      // 球被抖回后飞出了喉口区：把它放回喉口顶上，模拟真实对局里"后续的动量把球
      // 一次次重新送进袋口"。0.8.0 起袋心外移、几何变了之后，靠"抖飞的球自己漂回"
      // 的旧场景不再成立（实测它会滚进对面的中袋、掉进桌腔在托盘上永远滚动，
      // 抖回次数变成混沌的路径依赖），补球让这个最小场景重新确定性化。
      if (Math.hypot(t.x - s.x, t.z - s.z) >= throatRadiusOf(s)) {
        redrops++;
        ball.body.setTranslation({ x: s.x, y: BALL_R * 2, z: s.z }, true);
        ball.body.setLinvel({ x: 0, y: 0, z: 0 }, true);
        ball.body.setAngvel({ x: 0, y: 0, z: 0 }, true);
      }
      continue;                                        // 球心还在台面高度
    }
    // 喉口归属判定（与游戏内 checkPockets 一致）
    if (Math.hypot(t.x - s.x, t.z - s.z) >= throatRadiusOf(s)) continue;
    if (strikes < maxStrikes) {
      strikes += 1;                                    // 抖回台面
      const dx = t.x - s.x, dz = t.z - s.z;
      const d = Math.hypot(dx, dz) || 1;
      ball.body.setLinvel({ x: (dx / d) * 0.8, y: 0.5, z: (dz / d) * 0.8 }, true);
    } else {
      potted = true;                                   // 保险丝烧断：正常判进袋
      pottedAt = step * PHYS.timestep;
    }
  }
  return { strikes, potted, pottedAt, movingSteps, steps, redrops };
}

/** 场景 B：球停在盖板上，被"轻推"多次后袋口一定会重开 */
function runReopen(maxNudges, seconds = 20) {
  const { world, sensors, lids } = buildWorld();
  const s = sensors.find((x) => x.name === '上中袋');
  const ball = spawnBall(world, 99, s.x, s.z);            // 球心正压喉口
  for (const l of lids) l.collider.setEnabled(true);      // 袋口全部封上（开球保护生效中）
  const steps = Math.round(seconds / PHYS.timestep);
  let closed = true, nudges = 0, openedAt = null;
  for (let step = 0; step < steps; step++) {
    world.step();
    const lv = ball.body.linvel();
    const moving = Math.hypot(lv.x, lv.y, lv.z) >= PHYS.sleepSpeed;
    if (!closed || moving) continue;                      // 只在"停稳"时处理
    const t = ball.body.translation();
    const stuck = Math.hypot(t.x - s.x, t.z - s.z) < throatRadiusOf(s) + BALL_R * 0.6;
    if (stuck) {
      nudges += 1;
      const dx = t.x - s.x, dz = t.z - s.z;
      const d = Math.hypot(dx, dz) || 1;
      ball.body.setLinvel({ x: (dx / d) * 0.2, y: 0, z: (dz / d) * 0.2 }, true);
    }
    if (!stuck || nudges >= maxNudges) {
      closed = false;
      openedAt = step * PHYS.timestep;
      for (const l of lids) l.collider.setEnabled(false);
    }
  }
  const lv = ball.body.linvel();
  return {
    nudges, lidsOpen: !closed, openedAt,
    stillMoving: Math.hypot(lv.x, lv.y, lv.z) >= PHYS.sleepSpeed,
  };
}

export function testPocketLidFuse() {
  console.log('\n[8] 开球保护的死锁保险丝（"第 2 颗球一直在袋口反复移动、进不了球"）');

  const noFuse = runRattle(Number.POSITIVE_INFINITY);            // 对照组 = 修复前的行为
  const fuse = runRattle(RULES.rattleMaxStrikes);                // 实验组 = 现在的行为
  console.log(`  对照组（无保险丝）：被抖回 ${noFuse.strikes} 次（补球 ${noFuse.redrops} 次） · 20s 后` +
    `${noFuse.potted ? `已进袋（第 ${noFuse.pottedAt.toFixed(1)}s）` : '仍未进袋'} · ` +
    `其中 ${(noFuse.movingSteps * PHYS.timestep).toFixed(1)}s 处于"运动中"`);
  console.log(`  实验组（上限 ${RULES.rattleMaxStrikes} 次）：被抖回 ${fuse.strikes} 次（补球 ${fuse.redrops} 次） · ` +
    `${fuse.potted ? `第 ${fuse.pottedAt.toFixed(1)}s 正常进袋` : '仍未进袋'}`);

  check(noFuse.strikes > RULES.rattleMaxStrikes && !noFuse.potted,
    '对照组能确定性地复现死锁：没有保险丝时球被无限次重投，20s 都进不了袋',
    `被抖回 ${noFuse.strikes} 次、${noFuse.potted ? '竟然进袋了' : '始终没进袋'}`);
  check(fuse.strikes === RULES.rattleMaxStrikes && fuse.potted,
    `有保险丝时抖回次数恰好封顶在 ${RULES.rattleMaxStrikes} 次，之后球正常落袋（不再无限重投）`,
    `被抖回 ${fuse.strikes} 次，${fuse.potted ? `第 ${fuse.pottedAt.toFixed(1)}s 进袋` : '仍未进袋'}`);
  check(fuse.potted && fuse.pottedAt < 3,
    '保险丝生效后 3 秒内球就正常落袋（玩家不会看到球在袋口反复游荡）',
    fuse.potted ? `第 ${fuse.pottedAt.toFixed(2)}s` : '始终未进袋');

  const noFuseB = runReopen(Number.POSITIVE_INFINITY);     // 无保险丝
  const fuseB = runReopen(RULES.pocketReopenMaxNudges);    // 有保险丝
  console.log(`  对照组（无保险丝）：被推 ${noFuseB.nudges} 次 · 20s 后袋口${noFuseB.lidsOpen ? '已开' : '仍未开'} · ` +
    `球${noFuseB.stillMoving ? '仍在动' : '已停'}`);
  console.log(`  实验组（上限 ${RULES.pocketReopenMaxNudges} 次）：被推 ${fuseB.nudges} 次 · ` +
    `袋口在第 ${fuseB.openedAt ? `${fuseB.openedAt.toFixed(1)}` : '—'}s 打开 · 球${fuseB.stillMoving ? '仍在动' : '已停'}`);

  check(fuseB.lidsOpen, '袋口最终一定会重新打开（游戏不会永远停在"运动中"）',
    fuseB.openedAt ? `第 ${fuseB.openedAt.toFixed(1)}s` : '始终未开');
  check(fuseB.nudges <= RULES.pocketReopenMaxNudges,
    `有保险丝时轻推次数不超过 ${RULES.pocketReopenMaxNudges} 次`,
    `实际 ${fuseB.nudges} 次`);

  /* ---- 顺带验证：袋口敞开时，压在喉口上的球会正常落袋（不会被误判成"悬停"） ---- */
  const { world, sensors } = buildWorld();
  const s2 = sensors.find((x) => x.name === '上中袋');
  const ball = spawnBall(world, 99, s2.x, s2.z);
  let potted = false;
  for (let i = 0; i < 240 && !potted; i++) {
    world.step();
    world.intersectionPairsWith(s2.collider, (other) => {
      if (other.handle === ball.collider.handle) potted = true;
    });
  }
  check(potted, '袋口敞开时，压在喉口上的球会正常落袋（不会被判成"悬停"）');
}
