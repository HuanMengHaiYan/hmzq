/**
 * 开球玩法测试：
 *   4. 不同力度下的开球物理（不飞出台面 / 不异常弹跳 / 能收敛）
 *   6. 开球落袋与收敛（真实开球量级 + 球铺得开 + 状态机一定收敛）
 *   7. 可选的"开球保护"规则不会卡死游戏
 *   9. 开球结果不再镜像对称
 */
import { BALL_R, BALL_MASS, SHOT, RULES, BREAK_SHOCK } from '../../src/constants.js';
import { check } from '../lib/harness.mjs';
import { runBreak, runGuardedBreak } from '../lib/break-sim.mjs';

/** 4. 开球物理（多档力度，含超力度压力测试） */
export function testBreaks() {
  console.log('\n[4] 开球物理测试（力度区间 ' +
    `${SHOT.minImpulse}~${SHOT.maxImpulse} N·s → ` +
    `${(SHOT.minImpulse / BALL_MASS).toFixed(1)}~${(SHOT.maxImpulse / BALL_MASS).toFixed(1)} m/s）`);

  const cases = [
    SHOT.minImpulse,
    (SHOT.minImpulse + SHOT.maxImpulse) / 2,
    SHOT.maxImpulse,
    SHOT.maxImpulse * 1.6, // 超力度压力测试
  ];

  let allOK = true;
  for (const imp of cases) {
    // 固定小幅随机抖动（仅用于覆盖不同开球角；游戏逻辑已改为精确瞄准，不再随机）
    const jitter = (Math.random() - 0.5) * 0.04;
    const r = runBreak(imp, jitter);
    const label = `冲量 ${imp.toFixed(2)} N·s (出杆 ${r.v0.toFixed(1)} m/s)`;
    console.log(`  ── ${label}`);
    console.log(`     峰值速度 ${r.maxSpeed.toFixed(2)} m/s · 最高离台 ${(r.maxY * 1000).toFixed(1)}mm · ` +
      `平均扩散 ${(r.spread * 100).toFixed(1)}cm · 静止用时 ${r.settleSec ? `${r.settleSec.toFixed(2)}s` : '未收敛'}`);
    console.log(`     进袋 ${r.potted.length} 颗${r.potted.length ? '：' + r.potted.map((p) => `${p.number}号→${p.pocket}`).join('，') : ''}`);

    check(!r.escaped, `${label} 无球飞出台面`,
      r.escaped ? `${r.escaped.number}号 @ (${r.escaped.x.toFixed(2)}, ${r.escaped.z.toFixed(2)})` : '');
    check(r.maxY < BALL_R * 3, `${label} 无异常弹跳`, `最高 ${(r.maxY * 1000).toFixed(1)}mm`);
    // 力道已整体下调到 30%，轻柔小力本就炸不开球堆；仅对"满力及以上"断言能明显炸开
    if (imp >= SHOT.maxImpulse) {
      check(r.spread > 0.01, `${label} 满力开球能炸开球堆`, `平均位移 ${(r.spread * 100).toFixed(1)}cm`);
    }
    check(r.settleSec !== null, `${label} 能收敛静止`, r.settleSec ? `${r.settleSec.toFixed(2)}s` : '');
    if (r.escaped || r.settleSec === null) allOK = false;
  }
  return allOK;
}

/**
 * 6. 开球落袋与收敛（2026-09-16 重写）
 * 默认 RULES.breakMaxPots = 0 = 不限制开球进袋数：球堆整体后收（RACK.shiftX）之后，
 * 满力开球进袋已经落到真实量级，不需要再用"封袋"兜底。
 * 这里断言的是结果本身（进袋是否像真实开球、球是否铺得开、状态机是否一定收敛），
 * 而不是某个开关的效果。
 */
export function testBreakPots(runs) {
  const N = runs;
  console.log(`\n[6] 开球落袋与收敛（${N} 次满力开球，进袋上限 ${RULES.breakMaxPots > 0 ? RULES.breakMaxPots : '不限制'}）`);
  const hist = {};
  const ballHist = {};
  let spreadSum = 0, headSum = 0, midSum = 0, footSum = 0, pathSum = 0;
  let leftSum = 0, rightSum = 0, emptyHalf = 0;
  let potSum = 0, maxPots = 0, unsettled = 0, hoverSum = 0, movingSum = 0;

  for (let i = 0; i < N; i++) {
    const jitter = (Math.random() - 0.5) * 0.05;
    // 与游戏主循环保持一致：开球那一杆启用"碰撞传导随机化"（RULES.collisionVarianceBreakOnly）
    const r = runGuardedBreak(jitter, SHOT.maxImpulse, RULES.collisionVariance);
    const n = r.potted.length;
    hist[n] = (hist[n] || 0) + 1;
    potSum += n;
    maxPots = Math.max(maxPots, n);
    for (const p of r.potted) ballHist[p.number] = (ballHist[p.number] || 0) + 1;
    spreadSum += r.spread;
    headSum += r.zones.head; midSum += r.zones.mid; footSum += r.zones.foot;
    leftSum += r.zones.left; rightSum += r.zones.right;
    if (Math.min(r.zones.head, r.zones.foot) <= 1 || Math.min(r.zones.left, r.zones.right) <= 1) emptyHalf++;
    pathSum += r.meanPath;
    if (r.settleSec === null) unsettled++;
    hoverSum += r.hovering;
    movingSum += r.movingAtEnd;
  }
  console.log(`  收杆分布：头区 ${(headSum / N).toFixed(1)} · 中区 ${(midSum / N).toFixed(1)} · ` +
    `脚区 ${(footSum / N).toFixed(1)} 颗 · 平均总行程 ${((pathSum / N) * 100).toFixed(0)}cm`);
  console.log(`  左右分布：左半 ${(leftSum / N).toFixed(1)} · 右半 ${(rightSum / N).toFixed(1)} 颗`);
  for (const k of Object.keys(hist).sort((a, b) => a - b)) {
    console.log(`  进 ${k} 颗: ${hist[k]} 次 (${((hist[k] / N) * 100).toFixed(0)}%)`);
  }
  const topBall = Object.entries(ballHist).sort((a, b) => b[1] - a[1])[0];
  console.log(`  单颗球最高进袋率：${topBall ? `${topBall[0]} 号 ${((topBall[1] / N) * 100).toFixed(0)}%` : '无球进袋'} · ` +
    `平均进袋 ${(potSum / N).toFixed(2)} 颗/次（最多 ${maxPots} 颗）`);
  console.log(`  平均扩散 ${((spreadSum / N) * 100).toFixed(1)}cm（炸球效果保持）`);

  check(unsettled === 0, '每一次开球都能收敛静止（不会卡在"运动中"导致无法出杆）',
    `未收敛 ${unsettled}/${N}`);
  check(hoverSum === 0 && movingSum === 0, '没有球停在袋口喉口上方 / 没有球在袋口反复游荡',
    `悬停球 ${hoverSum} 颗次，收杆时仍在动的球 ${movingSum} 颗次`);
  // 0.7.0 两次改动把基线推高了：袋口放大（0.63 → 0.76 颗/杆）+ 开球参数重扫
  // （0.60/104/-0.19，N=200 实测 0.96 颗/杆）。N=24 的抽样标准差约 0.2~0.3，
  // 原来的 1.2 只剩 1σ 余量，实际跑会偶发红（实测 1.29）。
  // 放宽到 1.35（≈ +1.5σ 上沿，仍远低于"异常爆杆"的 2 颗以上），拦得住真回归、
  // 不再被一次正常波动误伤。
  check((potSum / N) <= 1.35, '满力开球平均进袋 ≤1.35 颗（真实开球量级）',
    `平均 ${(potSum / N).toFixed(2)} 颗`);
  // 0.7.0 袋口放大（角袋 96→114mm、中袋 96→120mm）后，开球平均进袋从 0.63 升到 0.76 颗/次，
  // "一杆 4 颗"的长尾会偶尔出现（泊松 λ≈0.76 时约 0.7%/杆，24 杆里约 1 次）——
  // 所以判据从"最多 3 颗"改成"4 颗封顶 + 出现比例受控"：
  // 仍然拦得住当年那种"一杆进 5~6 颗"的异常，又不会因为一次正常波动就红。
  const tail4 = Object.entries(hist)
    .filter(([k]) => Number(k) >= 4)
    .reduce((a, [, v]) => a + v, 0);
  check(maxPots <= 4 && tail4 / N <= 0.15,
    '单次开球最多 4 颗，且进 ≥4 颗的场次 ≤15%（不再是一杆进 5~6 颗）',
    `最多 ${maxPots} 颗 · ≥4 颗 ${tail4}/${N} 次`);
  check(!topBall || topBall[1] / N <= 0.4,
    '没有任何一颗球"几乎每次都进"（单颗最高进袋率 ≤40%）',
    topBall ? `${topBall[0]} 号 ${((topBall[1] / N) * 100).toFixed(0)}%` : '无球进袋');
  check((spreadSum / N) > 0.25, '满力开球仍然炸得开（球平均位移 >25cm）',
    `平均 ${((spreadSum / N) * 100).toFixed(1)}cm`);
  check((midSum + headSum) / N >= 1.5,
    '球铺得开（平均至少 1.5 颗落到中区/头区，而不是全堆在脚区库边）',
    `中区+头区 平均 ${((midSum + headSum) / N).toFixed(1)} 颗`);
  check(headSum / N >= 1.0,
    '开球后头区（台面另一半）平均至少 1 颗球 —— 不再出现「半边一颗球都没有」',
    `头区平均 ${(headSum / N).toFixed(1)} 颗`);
  check(emptyHalf <= N * 0.3,
    '至少 70% 的开球两侧/两半都有球',
    `${N - emptyHalf}/${N} 次两半都有球`);
  check(footSum / N < 13, '不再出现「15 颗球全挤在脚区」', `脚区平均 ${(footSum / N).toFixed(1)} 颗`);
  check((pathSum / N) > 0.7, '每颗球平均总行程 >70cm（接近真实开球）',
    `平均 ${((pathSum / N) * 100).toFixed(0)}cm`);
}

/**
 * 7. 回归测试：RULES.breakMaxPots ≥ 1 时，进袋达到上限会关闭其余袋口、并把继续下沉的球抖回台面。
 * 修复前（2026-09-16 之前）这个机制有个致命 bug：抖回台面这段逻辑藏在"每个物理步都跑"的
 * checkPockets 里，同一颗球会被连续重投（往外 0.8m/s + 往上 0.5m/s）—— 既出不去也停不下来。
 * 表现就是玩家说的"第 2 颗球一直在袋口反复移动、怎么都进不了"，两颗以上时整个游戏锁死。
 * 现在有 rattleMaxStrikes / pocketReopenMaxNudges 两道保险丝兜底。
 */
export function testGuardNoDeadlock(runs) {
  const saved = RULES.breakMaxPots;
  RULES.breakMaxPots = 1;
  const N = Math.min(runs, 16);
  console.log(`\n[7] 开球保护（可选规则：上限 ${RULES.breakMaxPots} 颗）不死锁（${N} 次满力开球）`);

  let over = 0, stuckClosed = 0, tooManyNudges = 0, unsettled = 0, maxNudges = 0, potSum = 0;
  let maxStrikes = 0, overStrikes = 0, stillMoving = 0, maxPots = 0;
  for (let i = 0; i < N; i++) {
    const r = runGuardedBreak((Math.random() - 0.5) * 0.05, SHOT.maxImpulse, 0, RULES.breakMaxPots);
    if (r.potted.length > RULES.breakMaxPots) over++;
    if (!r.lidsOpen) stuckClosed++;
    if (r.nudges > RULES.pocketReopenMaxNudges) tooManyNudges++;
    if (r.settleSec === null) unsettled++;
    if (r.rattleStrikes > RULES.rattleMaxStrikes) overStrikes++;
    maxNudges = Math.max(maxNudges, r.nudges);
    maxStrikes = Math.max(maxStrikes, r.rattleStrikes);
    maxPots = Math.max(maxPots, r.potted.length);
    potSum += r.potted.length;
    if (r.movingAtEnd > 0) stillMoving++;
  }
  console.log(`  平均进袋 ${(potSum / N).toFixed(2)} 颗（最多 ${maxPots} 颗）· ` +
    `轻推悬停球最多 ${maxNudges} 次 / 上限 ${RULES.pocketReopenMaxNudges} · ` +
    `抖回台面最多 ${maxStrikes} 次 / 上限 ${RULES.rattleMaxStrikes}`);

  // 保险丝是刻意的取舍：宁可让超过上限的那一颗正常落袋，也不能把游戏卡住。
  // 所以这里断言的是"不会失控 + 不会卡死"，而不是"一颗都不会多进"。
  check(stuckClosed === 0, '本杆结束后袋口一定会重新打开（不会永远封着）',
    `${stuckClosed}/${N} 次袋口没开`);
  // ⚠️ nudges 是"跨袋口累计"的计数器：同一个重开检查步里，几个袋口各推一次就 +几
  // （pockets.js 的 state.pocketReopenTries 同理）。所以最大值允许越过上限本身，
  // 上界是"上限 + 最多 6 个袋口同时卡住"—— 真正要守的是"不会无限推出→滚回"，
  // 即远小于上限的几倍。实测偶发 9（上限 8），属于单步多袋，不是失控。
  check(maxNudges <= RULES.pocketReopenMaxNudges + 5,
    '悬停球的轻推次数不会失控（上限 + 同一步多袋口的跳跃量）',
    `超限 ${tooManyNudges}/${N} 次，实测最多 ${maxNudges} 次 / 上限 ${RULES.pocketReopenMaxNudges}`);
  check(overStrikes === 0, '抖回台面的次数不超过保险丝上限（不会无限重投同一颗球）',
    `超限 ${overStrikes}/${N} 次，实测最多 ${maxStrikes} 次`);
  check(unsettled === 0 && stillMoving === 0, '启用开球保护时每一次开球也能收敛静止（玩家始终能继续出杆）',
    `未收敛 ${unsettled}/${N} 次，收杆时仍有球在动 ${stillMoving}/${N} 次`);
  check(maxPots <= RULES.breakMaxPots + 2,
    `即使保险丝放行了卡死的球，单次开球进袋数也不会失控（≤ 上限+2 = ${RULES.breakMaxPots + 2} 颗）`,
    `最多 ${maxPots} 颗`);
  console.log(`  （保险丝放行：${N} 次里有 ${over} 次多进了球 —— 这是刻意取舍，不是 bug）`);

  RULES.breakMaxPots = saved;
}

/**
 * 9. 球堆本身是左右镜像对称的，白球又正中撞击 → 修复前的结果几乎完美镜像。
 * 断言的是"结果本身不镜像"这个性质，而不是某个开关的效果 —— 因为实测表明：
 * 传导随机化（±50%）对镜像度几乎没有影响，真正起作用的是开球冲击波的扇形扩散。
 */
export function testBreakAsymmetry(runs) {
  const N = Math.min(runs, 24);
  console.log(`\n[9] 开球结果对称性（${N} 次满力开球）`);

  // 对称度量：每颗球到"它关于长轴的镜像位置"最近的球的距离（越小越对称）；外加"有镜伴的球"占比
  const measure = (finals) => {
    let sum = 0, paired = 0;
    for (const f of finals) {
      let best = Infinity;
      for (const g of finals) best = Math.min(best, Math.hypot(g.x - f.x, g.z + f.z));
      sum += best;
      if (best < 0.06) paired++;
    }
    return {
      mirror: finals.length ? sum / finals.length : 0,
      pairRatio: finals.length ? paired / finals.length : 0,
    };
  };

  // 对照组：关掉扇形扩散（等于"直推球堆"的旧行为，结果必然镜像）
  const runSet = (fanAngle) => {
    const saved = BREAK_SHOCK.fanAngle;
    BREAK_SHOCK.fanAngle = fanAngle;
    let mirror = 0, pair = 0, n = 0;
    for (let i = 0; i < N; i++) {
      const r = runGuardedBreak((Math.random() - 0.5) * 0.05, SHOT.maxImpulse, 0);
      const m = measure(r.finals);
      mirror += m.mirror; pair += m.pairRatio; n++;
    }
    BREAK_SHOCK.fanAngle = saved;
    return { mirror: mirror / n, pair: pair / n };
  };

  const flat = runSet(0);                       // 对照组：球堆当"一块板"直推
  const fan = runSet(BREAK_SHOCK.fanAngle);     // 现状：扇形扩散
  console.log(`  对照（直推球堆）：镜像偏差 ${(flat.mirror * 100).toFixed(1)}cm · 有镜伴的球 ${(flat.pair * 100).toFixed(0)}%`);
  console.log(`  现状（扇形扩散）：镜像偏差 ${(fan.mirror * 100).toFixed(1)}cm · 有镜伴的球 ${(fan.pair * 100).toFixed(0)}%`);

  check(fan.mirror > flat.mirror * 1.5,
    '开球结果不再是镜像对称（镜像偏差比"直推球堆"大 ≥50%）',
    `${(flat.mirror * 100).toFixed(1)}cm → ${(fan.mirror * 100).toFixed(1)}cm`);
  check(fan.mirror > 0.15, '镜像偏差达到"看上去就是随机散开"的量级（>15cm）',
    `${(fan.mirror * 100).toFixed(1)}cm`);
  check(fan.pair < 0.45, '「有镜像伙伴的球」占比 < 45%（球位不再成对镜像重合）',
    `${(fan.pair * 100).toFixed(0)}%`);
}
