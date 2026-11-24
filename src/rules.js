/**
 * 规则设置 · 玩法规则（现在只有「中式黑八」一套；斯诺克 / 俄式是占位，未开发）
 * ------------------------------------------------------------------
 * 职责边界：这里**只决定「桌面上有哪些球、怎么摆」**，
 * 不涉及任何计分、犯规、胜负判定 —— 那些在 modes.js（单人）与 duo.js（本地双人）里。
 *
 * rows  每行几颗球（自顶点起）。行数决定球堆的"形状"：
 *         中式黑八 → [1,2,3,4,5] 五排三角形
 * order 自顶点起、逐行从左到右的球号顺序。长度必须等于 rows 之和。
 *       摆位由 layout.js 的 rackLayoutFor() 按 rows + order 算出来，
 *       所以新增一种玩法只需要在这里加一条数据。
 *
 * ⚠️ 9 球 / 3 球两套已经在 2026-09-25 移除（用户要求：规则设置里只留中式黑八，
 *    斯诺克与俄式做成禁用按钮占位）。它们的 rows/order 没保留 —— 真要做的时候
 *    照着 git 历史或下面这个形状重新加一条即可，别留死数据。
 *
 * 注：所有玩法共用同一张球台与同一份物理参数（见 constants.js 的 TABLE/PHYS），
 * 只有「球号集合 + 摆位」不同。
 */

export const BALL_SETS = {
  15: {
    id: '15',
    name: '中式黑八',
    sub: '标准玩法',
    desc: '1~15 号全彩球摆成五排三角形，8 号居中。1~7 全色、9~15 半色，8 号决胜。',
    rows: [1, 2, 3, 4, 5],
    order: [1, 9, 2, 10, 8, 3, 11, 4, 12, 5, 13, 6, 14, 7, 15],
  },
};

export const DEFAULT_BALL_SET = '15';

/** 全部球组（顺序即界面展示顺序） */
export function ballSetList() {
  return Object.values(BALL_SETS);
}

/** 取球组；id 不认识时回落到默认组（存储/URL 参数被改坏也不会崩） */
export function getBallSet(id) {
  return BALL_SETS[id] || BALL_SETS[DEFAULT_BALL_SET];
}

export function isBallSet(id) {
  return Object.prototype.hasOwnProperty.call(BALL_SETS, id);
}

/** 该球组合法的球号（渲染 / 进袋 / 计数都用它） */
export function activeNumbers(id) {
  return getBallSet(id).order.slice();
}

/**
 * 把球组写进运行状态：游戏里所有"这颗球上不上桌""总共几颗"都读这里。
 * @returns 球组定义
 */
export function applyBallSetToState(state, id) {
  const set = getBallSet(id);
  state.ballSet = set.id;
  state.pottedTotal = set.order.length;
  return set;
}
