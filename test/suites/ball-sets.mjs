/**
 * 规则设置 · 球体设置：15 球 / 9 球 / 3 球
 * 只验证「桌上有哪些球、怎么摆」，不涉及任何计分规则（那些还没写）。
 * 用假刚体跑，不需要 Rapier，结果确定、跑得飞快。
 */
import { BALL_R, TABLE } from '../../src/constants.js';
import { rackLayoutFor, allBallSpawnsFor, HEAD_SPOT, FOOT_SPOT } from '../../src/layout.js';
import { BALL_SETS, ballSetList, getBallSet, isBallSet, activeNumbers } from '../../src/rules.js';
import { resetBalls } from '../../src/balls.js';
import { check } from '../lib/harness.mjs';

const ROW_DX = BALL_R * 2 * 1.004 * Math.cos(Math.PI / 6);

/** 最小可用的假刚体：只要 resetBalls / hideBall 用到的那几个方法 */
function mockBody() {
  const st = { x: 0, y: 0, z: 0, w: 1 };
  return {
    st,
    setTranslation(t) { st.x = t.x; st.y = t.y; st.z = t.z; },
    setRotation() { /* noop */ },
    setLinvel() { /* noop */ },
    setAngvel() { /* noop */ },
    wakeUp() { /* noop */ },
    setEnabled(v) { st.enabled = v; },
    isEnabled() { return st.enabled !== false; },
    translation() { return { x: st.x, y: st.y, z: st.z }; },
  };
}

/** 16 颗球的假集合（0 白球 + 1~15），顺序与 createBalls 一致 */
function mockBalls() {
  return Array.from({ length: 16 }, (_, n) => ({
    number: n, isCue: n === 0, potted: false, hidden: false,
    mesh: { visible: true },
    body: mockBody(),
  }));
}

export function testBallSets() {
  console.log('\n[12] 玩法规则：球组定义');
  const list = ballSetList();
  check(list.length === 1 && list[0].id === '15',
    '现在只有一套玩法：中式黑八（9 球 / 3 球已移除）', list.map((s) => s.name).join(' / '));
  check(list[0].name === '中式黑八', '15 球这一套的显示名是「中式黑八」', list[0].name);
  // 被移除的两套：即使有人在 URL / 存储里写了旧值，也要回落成中式黑八而不是崩掉
  check(!isBallSet('9') && !isBallSet('3'), '9 球与 3 球已不再是可选项');
  check(getBallSet('9').id === '15' && getBallSet('3').id === '15',
    '旧存档里的 9 球 / 3 球回落成中式黑八');
  check(isBallSet('15'), '中式黑八 id 可识别');
  check(!isBallSet('99'), '不认识的 id 判为无效（会被 sanitize 回落到中式黑八）');
  check(getBallSet('99').id === '15', 'getBallSet 对无效 id 回落到默认球组');
  // 启动器里那两个"未来开发"的占位不是真玩法，不该被当成合法 id
  check(!isBallSet('snooker') && !isBallSet('russian'),
    '斯诺克 / 俄式只是界面占位，不是已实现的玩法');

  for (const s of list) {
    const sum = s.rows.reduce((a, b) => a + b, 0);
    check(sum === s.order.length,
      `${s.name}：摆位行数与球号数量一致`, `rows 合计 ${sum} / order ${s.order.length}`);
    check(new Set(s.order).size === s.order.length,
      `${s.name}：球号无重复`, s.order.join(','));
    check(Math.max(...s.order) === s.order.length && Math.min(...s.order) === 1,
      `${s.name}：球号连续 1~${s.order.length}`, s.order.join(','));
  }

  check(activeNumbers('15').join(',') === '1,9,2,10,8,3,11,4,12,5,13,6,14,7,15',
    '中式黑八的球号顺序（8 号居中）', activeNumbers('15').join(','));
}

export function testBallSetRacks() {
  console.log('\n[13] 玩法规则：摆位的几何');
  const BALL_SETS_ARR = Object.values(BALL_SETS);

  for (const s of BALL_SETS_ARR) {
    const rack = rackLayoutFor(s.id);

    check(rack.length === s.order.length,
      `${s.name}：摆位球数 = ${s.order.length}`, `实际 ${rack.length}`);

    // 行距与行内间距：同一球组内任意两球都不能穿模
    let minDist = Infinity;
    for (let i = 0; i < rack.length; i++) {
      for (let j = i + 1; j < rack.length; j++) {
        const d = Math.hypot(rack[i].x - rack[j].x, rack[i].z - rack[j].z);
        if (d < minDist) minDist = d;
      }
    }
    check(minDist >= BALL_R * 2,
      `${s.name}：无初始穿模`, `最小球心距 ${(minDist * 1000).toFixed(2)}mm`);

    const inside = rack.every((p) =>
      Math.abs(p.x) < TABLE.halfL - BALL_R && Math.abs(p.z) < TABLE.halfW - BALL_R);
    check(inside, `${s.name}：全部球位于台面内`);

    // 每行沿 Z 居中（球堆对称于中轴线）
    const rowXs = [...new Set(rack.map((p) => Number(p.x.toFixed(6))))].sort((a, b) => a - b);
    const symmetric = rowXs.every((x) => {
      const row = rack.filter((p) => Number(p.x.toFixed(6)) === x);
      return Math.abs(row.reduce((a, p) => a + p.z, 0)) < 1e-9;
    });
    check(symmetric, `${s.name}：每一行都沿中轴线对称`);

    // 形状：rows 里最宽的那一行决定球堆的最大横向半宽
    const maxHalf = Math.max(...s.rows.map((n) => (n - 1) / 2)) * BALL_R * 2 * 1.004;
    const realHalf = Math.max(...rack.map((p) => Math.abs(p.z)));
    check(Math.abs(realHalf - maxHalf) < 1e-9,
      `${s.name}：横向半宽符合摆法`,
      `${(realHalf * 1000).toFixed(1)}mm（最宽一行 ${Math.max(...s.rows)} 颗）`);

    // 纵深：行数决定球堆长度
    const realDepth = Math.max(...rack.map((p) => p.x)) - Math.min(...rack.map((p) => p.x));
    check(Math.abs(realDepth - (s.rows.length - 1) * ROW_DX) < 1e-9,
      `${s.name}：纵深 = (${s.rows.length} 行 - 1) × 行距`,
      `${(realDepth * 1000).toFixed(1)}mm`);
  }

  // 顶点球与中心球：中式黑八的"标志位"
  const r15 = rackLayoutFor('15');
  const apex15 = r15.find((p) => p.number === 1);
  const center15 = r15.find((p) => p.number === 8);
  check(Math.abs(apex15.z) < 1e-9 && apex15.x === Math.min(...r15.map((p) => p.x)),
    '中式黑八：1 号在顶点（最靠头区、z=0）', `x=${apex15.x.toFixed(3)}`);
  check(Math.abs(center15.z) < 1e-9 && Math.abs(center15.x - (apex15.x + 2 * ROW_DX)) < 1e-9,
    '中式黑八：8 号在第三行正中');
  // 摆位起点 = 脚点 + 玩法位移（将来加斯诺克 / 俄式时，顶点仍应落在同一处附近）
  check(apex15.x > FOOT_SPOT.x - TABLE.halfL * 0.5 && apex15.x <= FOOT_SPOT.x,
    '顶点在脚点附近、不越过脚点', `顶点 x=${apex15.x.toFixed(3)} / 脚点 x=${FOOT_SPOT.x.toFixed(3)}`);
}

export function testBallSetReset() {
  console.log('\n[14] 玩法规则：重置逻辑与旧值的回落');
  const balls = mockBalls();

  // 中式黑八：白球 + 15 颗目标球全在桌上
  resetBalls(balls, '15');
  const on15 = balls.filter((b) => !b.hidden).map((b) => b.number).sort((a, b) => a - b);
  check(on15.length === 16 && on15[15] === 15, '中式黑八：16 颗球全部在桌上');
  check(on15.join(',') === '0,1,2,3,4,5,6,7,8,9,10,11,12,13,14,15',
    '中式黑八：球号正好是白球 + 1~15', on15.join(','));

  // 位置必须与 rackLayoutFor 完全一致
  const r15 = new Map(rackLayoutFor('15').map((p) => [p.number, p]));
  let err = 0;
  for (const b of balls) {
    if (b.hidden || b.isCue) continue;
    const t = b.body.translation();
    const p = r15.get(b.number);
    err = Math.max(err, Math.abs(t.x - p.x), Math.abs(t.z - p.z), Math.abs(t.y - BALL_R));
  }
  check(err < 1e-9, '中式黑八：每颗球的落位与 rackLayoutFor 一致', `最大偏差 ${err}`);

  const cue = balls[0].body.translation();
  check(Math.abs(cue.x - HEAD_SPOT.x) < 1e-9 && Math.abs(cue.z) < 1e-9,
    '白球始终在开球点');

  // 旧存档 / 被改坏的 URL 写了 9 球或 3 球：必须回落成中式黑八，而不是摆出一个半成品
  resetBalls(balls, '9');
  const onLegacy = balls.filter((b) => !b.hidden).map((b) => b.number).sort((a, b) => a - b);
  check(onLegacy.length === 16 && onLegacy[15] === 15,
    '旧值 9 球回落成中式黑八：16 颗球照常在桌上', `实际 ${onLegacy.length} 颗`);

  // 重开一局：被收起的球必须重新上桌且状态干净
  for (const b of balls) { b.potted = true; }
  resetBalls(balls, '15');
  const back = balls.filter((b) => !b.hidden);
  check(back.length === 16, '重开：16 颗球重新上桌', `实际 ${back.length}`);
  check(back.every((b) => b.potted === false), '重开：potted 标记已清空（视为全新一局）');
  check(back.every((b) => b.body.isEnabled() === true),
    '切回 15 球：刚体全部重新启用（曾经收起的 10~15 号也能再打）');

  // 摆位与 allBallSpawnsFor 对齐（按球号比对：allBallSpawnsFor 的数组顺序是摆球顺序，
  // 与本用例里按球号排列的假球集合不同）
  const spawns = new Map(allBallSpawnsFor('15').map((s) => [s.number, s]));
  const spawnErr = Math.max(...balls.map((b) => {
    const s = spawns.get(b.number);
    const t = b.body.translation();
    return Math.max(Math.abs(t.x - s.x), Math.abs(t.z - s.z));
  }));
  check(spawnErr < 1e-9, '15 球组的落位与 allBallSpawnsFor 一致', `最大偏差 ${spawnErr}`);
}
