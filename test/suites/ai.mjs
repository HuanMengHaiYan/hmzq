/**
 * 🤖 人机对战（电脑对手）的测试
 * ------------------------------------------------------------------
 * 难度是**量出来的**：三档各自跑一批随机球位，让电脑自己选球、自己算力度，
 * 用与游戏完全一致的物理（test/lib/harness.mjs + src/shot.js 的出杆方式）真打出去，
 * 最后数它进了几颗。用户定的档位：
 *
 *   困难 ≥85% · 中等 60%~85% · 初级 30%~60%
 *
 * 档位只由 `constants.js` 的 AI_LEVELS 决定（瞄准抖动 / 力度抖动 / 选球水平），
 * 改了参数而这里的区间断言没红 → 说明改的那一项其实没起作用。
 *
 * 三档跑的是**同一批球位**（同一种子），只有抖动不同 —— 这样命中率的差异
 * 只来自"电脑的水平"，不是谁抽到的球型更好。
 */
import { BALL_R, BALL_MASS, PHYS, POCKETS, SHOT, TABLE } from '../../src/constants.js';
import { throatRadiusOf, clampCuePlace } from '../../src/layout.js';
import { clampBallSpeeds, applyRollFriction } from '../../src/sim.js';
import { planAiShot, aiPlaceCue, aiLevel, aiLevelList, isAiLevel, makeRnd } from '../../src/ai.js';
import { planAutoShot } from '../../src/auto-aim.js';
import { buildWorld, spawnBall, check } from '../lib/harness.mjs';
import { randomLayout } from './autoaim.mjs';

/**
 * 跑一杆：电脑规划 → 出杆 → 模拟到停稳 → 看它挑的那颗球进没进。
 * 出杆方式与 src/shot.js 的 shoot() 完全一致（冲量 + 前旋），否则测的不是游戏里的手感。
 */
export function runAiShot(pts, count, level, rnd, opts = {}) {
  const { world } = buildWorld();
  const balls = [spawnBall(world, 0, pts[0].x, pts[0].z)];
  const live = [];
  for (let i = 1; i <= count; i++) {
    balls.push(spawnBall(world, i, pts[i].x, pts[i].z));
    live.push({ number: i, x: pts[i].x, z: pts[i].z });
  }
  const cue = balls[0];
  const p = planAiShot({
    cue: { x: pts[0].x, z: pts[0].z },
    balls: live,
    targets: opts.targets ?? null,
    level,
    rnd,
    range: { min: SHOT.minImpulse, max: SHOT.maxImpulse },
  });
  if (!p) return null;

  const dir = { x: Math.sin(p.aimAngle), z: Math.cos(p.aimAngle) };
  const v0 = p.impulse / BALL_MASS;
  cue.body.applyImpulse({ x: dir.x * p.impulse, y: 0, z: dir.z * p.impulse }, true);
  cue.body.setAngvel({ x: (dir.z * v0 * 0.6) / BALL_R, y: 0, z: (-dir.x * v0 * 0.6) / BALL_R }, true);

  const bodies = balls.map((b) => b.body);
  let pottedTarget = false;
  let pottedAny = false;
  let cuePotted = false;

  for (let step = 0; step < 3600; step++) {
    world.step();
    clampBallSpeeds(bodies);
    applyRollFriction(bodies);   // 与游戏主循环一致（0.7.0 滚动摩擦）
    for (const b of balls) {
      if (b.potted) continue;
      const t = b.body.translation();
      if (t.y > BALL_R * 0.9) continue;                  // 进袋判定与 pockets.js 一致
      for (const k of POCKETS) {
        if (Math.hypot(t.x - k.x, t.z - k.z) < throatRadiusOf(k)) {
          b.potted = true;
          if (b.number === p.number) pottedTarget = true;
          else if (b.number === 0) cuePotted = true;
          else pottedAny = true;
          break;
        }
      }
    }
    let moving = 0;
    for (const b of balls) {
      if (b.potted) continue;
      const lv = b.body.linvel();
      const av = b.body.angvel();
      const sp = Math.hypot(lv.x, lv.y, lv.z);
      const sn = Math.hypot(av.x, av.y, av.z);
      if (sp < PHYS.sleepSpeed && sn < PHYS.sleepSpin) {
        if (sp > 0.0001 || sn > 0.0001) {
          b.body.setLinvel({ x: 0, y: 0, z: 0 }, true);
          b.body.setAngvel({ x: 0, y: 0, z: 0 }, true);
        }
      } else moving++;
    }
    if (moving === 0 && step > 40) break;
  }
  return { plan: p, pottedTarget, pottedAny: pottedAny || pottedTarget, cuePotted };
}

// ---------------------------------------------------------------- 难度表本身

export function testAiLevels() {
  console.log('\n[人机 · 难度表]');
  const list = aiLevelList();
  check(list.length === 4, '正好四档难度', list.map((l) => l.name).join('/'));
  check(list.every((l) => isAiLevel(l.id)), '四档 id 都能被认出来（URL 参数校验走这里）');
  // 展示顺序必须是"从易到难"：启动器那三个按钮照着这个顺序排，反了会把「极难」排在最前
  check(list[0].id === 'easy' && list[3].id === 'extreme', '列表按由易到难排（界面按钮顺序照它）',
    list.map((l) => l.id).join(' → '));
  // 越难 → 抖动越小、越肯挑最优解。这条反了的话，四档难度会变成"越难越菜"。
  const order = ['easy', 'normal', 'hard', 'extreme'];      // 由易到难
  const lv = order.map(aiLevel);
  const desc = (k) => lv.map((l) => l[k]).join(' > ');
  const strictDesc = (k) => lv.every((l, i) => i === 0 || lv[i - 1][k] > l[k]);
  check(strictDesc('aimErr'), '瞄准抖动：简单 > 中等 > 困难 > 极难', desc('aimErr'));
  check(strictDesc('powErr'), '力度抖动：简单 > 中等 > 困难 > 极难', desc('powErr'));
  check(strictDesc('rankP'), '不选最容易那颗的概率：简单 > 中等 > 困难 > 极难', desc('rankP'));
  check(aiLevel('瞎写').id === 'normal', '难度 id 写坏了回落中等（URL 被改也不崩）');
  check(aiLevel(null).id === 'normal', '没传难度也回落中等');
}

// ---------------------------------------------------------------- 方案本身

/**
 * 某一档"挑中最容易那颗"的比例（跑 40 个随机球位）。
 * 只在**确实有得挑**的局里统计（candidates ≥ 2），否则再准也是 100%，没有区分度。
 */
function pickOptimalRate(level) {
  let n = 0;
  let same = 0;
  for (let s = 0; s < 40; s++) {
    const pts = randomLayout(6, makeRnd(20260927 + s));
    if (pts.length <= 6) continue;
    const cue = pts[0];
    const balls = pts.slice(1).map((q, k) => ({ number: k + 1, x: q.x, z: q.z }));
    const perfect = planAutoShot({ cue, balls, range: { min: SHOT.minImpulse, max: SHOT.maxImpulse } });
    const ai = planAiShot({ cue, balls, level, rnd: makeRnd(1000 + s) });
    if (!perfect.best || !ai || !perfect.best.strict || !ai.strict) continue;
    if ((perfect.candidates || []).length < 2) continue;    // 没有次优可挑，跳过
    n++;
    if (ai.number === perfect.best.number) same++;
  }
  return same / Math.max(1, n);
}

export function testAiPlanBasics() {
  console.log('\n[人机 · 方案]');
  const rnd = makeRnd(4242);
  // 同一份球位，完美方案与电脑方案的可比性：电脑至少要"朝同一颗球打"
  const cue = { x: -0.6, z: 0.2 };
  const balls = [
    { number: 3, x: 0.3, z: 0.2 },
    { number: 7, x: -0.2, z: -0.3 },
  ];
  const perfect = planAutoShot({ cue, balls, range: { min: SHOT.minImpulse, max: SHOT.maxImpulse } });
  check(!!perfect.best, '完美方案给得出来');
  check(!!planAiShot({ cue, balls, level: 'extreme', rnd: makeRnd(7) }), '电脑方案给得出来');

  // 挑球水平：极难档绝大多数时候挑最容易那颗，简单档常常"抓着次优的就打"。
  // ⚠️ 用**统计**而不是单局断言 —— 挑不挑次优本身是掷骰子的（rankP），
  //    拿一个种子去断言"这一局必须挑最优"，早晚会有一次掷到次优而误报。
  const optimal = pickOptimalRate('extreme');
  const sloppy = pickOptimalRate('easy');
  console.log(`  挑最容易那颗的比例：极难 ${(optimal * 100).toFixed(0)}% · 简单 ${(sloppy * 100).toFixed(0)}%`);
  check(optimal >= 0.85, '极难档几乎总是挑最容易那颗（≥85%）', `${(optimal * 100).toFixed(0)}%`);
  check(optimal - sloppy > 0.15, '简单档明显更常挑次优解（"不看全局"）',
    `困难 ${(optimal * 100).toFixed(0)}% vs 简单 ${(sloppy * 100).toFixed(0)}%`);

  // 力度与冲量必须是一回事（只改 power 不改 impulse 的话，显示的力度和打出去的对不上）
  const p = planAiShot({ cue, balls, level: 'normal', rnd: makeRnd(99) });
  const wantImpulse = SHOT.minImpulse + (SHOT.maxImpulse - SHOT.minImpulse) * p.power;
  check(Math.abs(p.impulse - wantImpulse) < 1e-9, 'power 与 impulse 同步（力度抖动改了两个）',
    `${p.impulse.toFixed(3)} vs ${wantImpulse.toFixed(3)}`);
  check(p.power >= 0 && p.power <= 1, '力度在 0~100% 之间', `${Math.round(p.power * 100)}%`);
  check(p.thinkMs >= 0 && p.thinkMs <= 2000, '思考时长合理（0~2 秒）', `${p.thinkMs}ms`);
  check(/^电脑/.test(p.tip), '提示条文案以「电脑」开头（玩家看得懂是谁在打）', p.tip);

  // 台面没球 → 不炸
  check(planAiShot({ cue: { x: 0, z: 0 }, balls: [], level: 'extreme' }) === null, '台面空了返回空方案');
  check(planAiShot({ cue: null, balls, level: 'extreme' }) === null, '没有白球位置也返回空方案');
}

// ---------------------------------------------------------------- 手中球摆位

export function testAiPlaceCue() {
  console.log('\n[人机 · 手中球摆位]');
  const balls = [
    { number: 3, x: 0.3, z: 0.2 },
    { number: 7, x: -0.2, z: -0.3 },
    { number: 11, x: 0.9, z: 0.1 },
  ];
  const spot = aiPlaceCue({ balls, rnd: makeRnd(20260927) });
  check(!!spot, '给得出摆球位');
  // 摆位必须先过 clampCuePlace：不能压进库边、也不能悬在袋口上
  const c = clampCuePlace(spot.x, spot.z);
  check(Math.hypot(c.x - spot.x, c.z - spot.z) < 1e-6, '摆位本身是合法的（不用再夹一次）',
    `${spot.x.toFixed(3)}, ${spot.z.toFixed(3)}`);
  check(Math.abs(spot.x) < TABLE.halfL && Math.abs(spot.z) < TABLE.halfW, '摆位在台面内');
  for (const k of POCKETS) {
    check(Math.hypot(spot.x - k.x, spot.z - k.z) > throatRadiusOf(k), '摆位不会悬在袋口上',
      `离袋 ${Math.hypot(spot.x - k.x, spot.z - k.z).toFixed(3)}`);
  }
  // 摆到那个位置上，确实比"随手一放"更容易进球
  const plan = planAutoShot({ cue: spot, balls, range: { min: SHOT.minImpulse, max: SHOT.maxImpulse } });
  check(!!(plan.best && plan.best.strict), '摆完之后有球能进（不然白摆了）',
    plan.best ? `${plan.best.number} 号 → ${plan.best.pocketName}` : '无方案');
  // 换个种子也不会崩（抖动不让它跑出台面）
  const s2 = aiPlaceCue({ balls, rnd: makeRnd(1) });
  const c2 = clampCuePlace(s2.x, s2.z);
  check(Math.hypot(c2.x - s2.x, c2.z - s2.z) < 1e-6, '换种子加抖动后依然合法');
}

// ---------------------------------------------------------------- 三档命中率

/**
 * 四档各跑一批：同一批球位（同种子），只有抖动不同。
 * 统计口径与 auto-aim 的实战命中率一致 —— 只算"电脑自己认为能进"的 strict 方案，
 * 兜底 / 撞开那两类本来就不承诺进球。
 */
export function testAiHitRates(runs = 100, seeds = [20260927, 4242]) {
  console.log(`\n[人机 · 四档命中率] 每档 ${runs} × ${seeds.length} 批随机球位`);
  // 区间取用户定的档位（2026-09-29 重新排档）：极难 ≈91% · 困难 ≈70% · 中等 ≈45% · 简单 ≈30%，
  // 两边各留一点统计余量（一批球位的标准误约 ±4%，卡死在目标值上换个种子就红了）。
  const levels = [
    { id: 'extreme', name: '极难', lo: 0.85, hi: 1.01 },
    { id: 'hard', name: '困难', lo: 0.62, hi: 0.78 },
    { id: 'normal', name: '中等', lo: 0.38, hi: 0.52 },
    { id: 'easy', name: '简单', lo: 0.24, hi: 0.38 },
  ];
  const results = {};
  for (const L of levels) {
    let n = 0;
    let hit = 0;
    let any = 0;
    let cuePot = 0;
    seeds.forEach((seed, si) => {
      const rnd = makeRnd(1013 + 7 * si);     // 抖动流与球位流分开，三档共用同一串
      for (let i = 0; i < runs; i++) {
        const layout = makeRnd(seed + i);     // 三档共用同一批球位，公平比较
        const count = [1, 2, 3, 5, 8, 12][i % 6];
        const pts = randomLayout(count, layout);
        if (pts.length <= count) continue;
        const r = runAiShot(pts, count, L.id, rnd);
        if (!r || !r.plan.strict) continue;   // 只统计"它认为能进"的那些杆
        n++;
        if (r.pottedTarget) hit++;
        if (r.pottedAny) any++;
        if (r.cuePotted) cuePot++;
      }
    });
    const rate = hit / Math.max(1, n);
    results[L.id] = rate;
    console.log(`  ${L.name}：${hit}/${n} = ${(rate * 100).toFixed(1)}%` +
      `（进了任意球 ${(any / Math.max(1, n) * 100).toFixed(1)}% · 白球掉袋 ${cuePot}）`);
    check(n > 80, `${L.name}：样本量够（≥ 80 杆）`, `${n}`);
    check(rate >= L.lo && rate <= L.hi,
      `${L.name}：命中率落在 ${(L.lo * 100).toFixed(0)}%~${Math.min(100, L.hi * 100).toFixed(0)}%`,
      `${(rate * 100).toFixed(1)}%`);
  }
  // 四档必须真的拉开差距：一样准的话，选难度就只是换个名字
  const chain = ['extreme', 'hard', 'normal', 'easy'];
  for (let i = 0; i + 1 < chain.length; i++) {
    const a = results[chain[i]];
    const b = results[chain[i + 1]];
    check(a > b + 0.05, `${aiLevel(chain[i]).name}明显强于${aiLevel(chain[i + 1]).name}`,
      `${(a * 100).toFixed(1)}% vs ${(b * 100).toFixed(1)}%`);
  }
}
