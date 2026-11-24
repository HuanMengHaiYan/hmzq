import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { check } from '../lib/harness.mjs';
import { SCORE, TABLE, BALL_R, POCKETS } from '../../src/constants.js';
import {
  ScoreBoard, shotLimit, shotsLeft, timeLimit, timeLeft, potRate, modeHasDiff,
  isPrematureEight, judgeAfterShot, makeRecord, withoutPotted, fmtTime,
  LIMIT_DIFFS, TIME_DIFFS, GAME_MODES,
} from '../../src/modes.js';
import { clampCuePlace } from '../../src/layout.js';
import { resultCopy, resultLines } from '../../src/result.js';

/**
 * public/history.js 是经典脚本（浏览器里挂到 window.HMZQHistory），项目根又是
 * "type": "module"，没法直接 require —— 所以在 vm 里跑一遍，拿 window 上挂的那个对象。
 * 好处是**跑的就是启动器与游戏页用的同一份实现**，不是测试里另写一份的复制品。
 */
function loadHistory() {
  const code = readFileSync(new URL('../../public/history.js', import.meta.url), 'utf8');
  const sandbox = { window: {}, console };
  vm.createContext(sandbox);
  vm.runInContext(code, sandbox);
  return sandbox.window.HMZQHistory;
}

/**
 * 第三阶段：单人模式规则 + 挑战历史
 * ------------------------------------------------------------------
 * 计分口径是用户逐条定的，改动代价高（老记录还躺在玩家的 localStorage 里），
 * 所以这里把每一条都钉死成断言：连击递增、一杆多进、白球与黑 8 的罚分。
 * 历史存储只测"性质"（按 tab 过滤、按 tab 清空、脏数据不炸），不测实现细节。
 */

/* ---------------- 计分：一杆一颗 ---------------- */
function tBasic() {
  console.log('\n[34] 计分模式 · 单颗与连击递增');
  const b = new ScoreBoard();
  b.onShotStart();
  check(b.onTarget() === 1, '进第 1 颗 +1', `实得 ${b.score}`);
  b.onShotEnd();

  // 连击跨杆累计：第二杆再进就是连进第 2 颗 → +2
  b.onShotStart();
  check(b.onTarget() === 2, '连进第 2 颗 +2（1 基础 + 1 连击）', `实得 ${b.score}`);
  check(b.score === 3, '两颗累计 3 分', `实得 ${b.score}`);
  b.onShotEnd();

  b.onShotStart();
  check(b.onTarget() === 3, '连进第 3 颗 +3', `实得 ${b.score}`);
  b.onShotEnd();
  check(b.score === 6, '三颗累计 6 分（1+2+3）', `实得 ${b.score}`);

  // 空杆：连击断掉，下一颗重新从 +1 起算
  b.onShotStart();
  b.onShotEnd();
  b.onShotStart();
  check(b.onTarget() === 1, '空杆后连击清零，重新 +1', `实得 ${b.score}`);
  check(b.best === 3, '最高连击记为 3', `实得 ${b.best}`);
}

/* ---------------- 计分：一杆多进 ---------------- */
function tMulti() {
  console.log('\n[35] 计分模式 · 一杆多进奖励');
  // 一杆进 2 颗：1 + 2 = 3，再 +3（多进奖励） = 6
  const b = new ScoreBoard();
  b.onShotStart();
  b.onTarget();
  b.onTarget();
  const bonus = b.onShotEnd();
  check(bonus === 3, '一杆进 2 颗：额外 +3', `实得奖励 ${bonus}`);
  check(b.score === 6, '一杆进 2 颗共 6 分（1+2+3）', `实得 ${b.score}`);

  // 一杆进 3 颗：1+2+3 = 6，再 +3*(3-1) = 6 → 12
  const c = new ScoreBoard();
  c.onShotStart();
  c.onTarget(); c.onTarget(); c.onTarget();
  check(c.onShotEnd() === 6, '一杆进 3 颗：额外 +6', `实得奖励 ${c.score - 6}`);
  check(c.score === 12, '一杆进 3 颗共 12 分', `实得 ${c.score}`);

  // 一杆只进 1 颗：没有多进奖励
  const d = new ScoreBoard();
  d.onShotStart();
  d.onTarget();
  check(d.onShotEnd() === 0, '一杆只进 1 颗：没有多进奖励', `实得奖励 ${d.score - 1}`);
}

/* ---------------- 计分：罚分 ---------------- */
function tPenalty() {
  console.log('\n[36] 计分模式 · 白球与黑 8 罚分');
  const b = new ScoreBoard();
  b.onShotStart();
  b.onTarget();                 // +1，连击 = 1
  check(b.onCue() === -1, '白球落袋 -1', `实得变化 ${b.score - 1}`);
  check(b.score === 0, '白球落袋后回到 0 分', `实得 ${b.score}`);
  b.onShotEnd();
  b.onShotStart();
  check(b.onTarget() === 1, '白球落袋断连击：下一颗重新 +1', `实得 ${b.score}`);

  const c = new ScoreBoard();
  c.onShotStart();
  c.onTarget();
  check(c.onEarlyEight() === -3, '提前打进黑 8 -3', `实得变化 ${c.score - 1}`);
  check(c.score === -2, '黑 8 罚分后为 -2（+1 再 -3）', `实得 ${c.score}`);
  c.onShotEnd();
  c.onShotStart();
  check(c.onTarget() === 1, '黑 8 也断连击', `实得 ${c.score}`);

  check(SCORE.cuePenalty === 1 && SCORE.earlyEightPenalty === 3, '罚分常量与用户定的口径一致');
}

/* ---------------- 黑 8 提前判定 ---------------- */
function tPremature() {
  console.log('\n[37] 提前进黑 8 · 只在 15 球组成立');
  const st15 = { ballSet: '15', potted: [], pottedTotal: 15 };
  st15.potted = [8];
  check(isPrematureEight(st15, { number: 8 }) === true, '15 球组：还剩 14 颗时进 8 号 = 提前');
  st15.potted = Array.from({ length: 14 }, (_, i) => i + 1);
  check(isPrematureEight(st15, { number: 8 }) === false, '15 球组：只剩 8 号时不算提前');
  const st9 = { ballSet: '9', potted: [8], pottedTotal: 9 };
  check(isPrematureEight(st9, { number: 8 }) === false, '9 球组不套用黑 8 规则');
  check(isPrematureEight(st15, { number: 3 }) === false, '其它球号不算');
  check(isPrematureEight(st15, { isCue: true, number: 0 }) === false, '白球不算');

  // 犯规后黑 8 要回到桌上 → 必须从"已进袋"清单里摘掉，
  // 否则清台进度永远差一颗（把台面打空也判不了通关）
  const after = withoutPotted([1, 3, 8, 5], 8);
  check(after.length === 3 && after.indexOf(8) === -1, '黑 8 犯规后被摘出已进袋清单', after.join(','));
  check(withoutPotted([1, 2], 8).length === 2, '清单里本来没有它也不出错');
  check(withoutPotted(null, 8).length === 0, '清单为空时返回空数组（不炸）');
  // 摘掉之后"还剩几颗没进"要跟着变回 13 颗 —— 这正是重摆黑 8 的意义
  const live = { ballSet: '15', potted: withoutPotted([1, 3, 8, 5], 8), pottedTotal: 15 };
  check(isPrematureEight(live, { number: 8 }) === true,
    '重摆后同一杆再进黑 8 仍算提前（它又回到了桌上）');
}

/* ---------------- 限次模式 ---------------- */
function tLimit() {
  console.log('\n[38] 限次模式 · 难度次数与判负');
  check(LIMIT_DIFFS.easy.shots === 40, '简单 40 次', `实得 ${LIMIT_DIFFS.easy.shots}`);
  check(LIMIT_DIFFS.normal.shots === 30, '中等 30 次', `实得 ${LIMIT_DIFFS.normal.shots}`);
  check(LIMIT_DIFFS.hard.shots === 20, '困难 20 次', `实得 ${LIMIT_DIFFS.hard.shots}`);
  check(shotLimit('limit', 'hard') === 20, 'shotLimit(limit, hard) = 20');
  check(shotLimit('free', 'hard') === null, '自由模式没有次数上限');
  check(shotsLeft('limit', 'normal', 0) === 30, '开局剩 30 次');
  check(shotsLeft('limit', 'normal', 12) === 18, '打 12 杆剩 18 次');
  check(shotsLeft('limit', 'normal', 99) === 0, '超出次数也是 0（不会变负）');
  check(shotsLeft('score', 'normal', 3) === null, '计分模式不显示剩余次数');

  // 判定：清台优先于次数用尽（最后一杆清台算赢，不算输）
  const win = judgeAfterShot({ mode: 'limit', diff: 'hard', shots: 20, potted: 15, total: 15 });
  check(win === 'win', '最后一杆清台 = 通关（优先于次数用尽）', `实得 ${win}`);
  const fail = judgeAfterShot({ mode: 'limit', diff: 'hard', shots: 20, potted: 9, total: 15 });
  check(fail === 'fail', '次数用尽未清台 = 失败', `实得 ${fail}`);
  const go = judgeAfterShot({ mode: 'limit', diff: 'hard', shots: 19, potted: 9, total: 15 });
  check(go === null, '还没到次数上限：继续', `实得 ${go}`);
  const free = judgeAfterShot({ mode: 'free', diff: null, shots: 99, potted: 3, total: 15 });
  check(free === null, '自由模式永不判负', `实得 ${free}`);
}

/* ---------------- 结算文案 ---------------- */
function tResult() {
  console.log('\n[39] 结算弹窗 · 按模式出文案');
  check(resultCopy('win', 'limit').title.indexOf('通') >= 0, '限次通关：标题带「通关」');
  check(resultCopy('lose', 'limit').tag === 'OUT OF SHOTS', '限次失败：次数用尽');
  check(resultCopy('lose', 'free').tag === 'DEFEAT', '自由模式失败沿用通用文案');
  // 限次与计时都是"没打完"，但输的原因不同，文案必须能分辨
  check(resultCopy('win', 'timed').tag === 'CLEAR', '计时通关：CLEAR');
  check(resultCopy('lose', 'timed').tag === 'TIME UP' && resultCopy('lose', 'timed').title.indexOf('时间') >= 0,
    '计时失败：时间到', resultCopy('lose', 'timed').title);
  check(resultCopy('lose', 'timed').tag !== resultCopy('lose', 'limit').tag,
    '限次失败与计时失败的 tag 不重复');
  const rows = resultLines({ mode: 'score', shots: 12, potted: 15, total: 15, best: 3, score: 27, ms: 205000 });
  const joined = rows.map((r) => r.k).join(',');
  check(joined.indexOf('得分') === 0, '计分模式第一行是得分');
  check(joined.indexOf('用时') > 0, '结算里有用时');
  const lim = resultLines({ mode: 'limit', shots: 20, potted: 9, total: 15, best: 2, left: 0, ms: 61000 });
  check(lim.some((r) => r.k === '剩余次数'), '限次模式有剩余次数行');
  check(fmtTime(205000) === '03:25', 'fmtTime(205000) = 03:25', `实得 ${fmtTime(205000)}`);
  check(fmtTime(59000) === '00:59', 'fmtTime(59000) = 00:59', `实得 ${fmtTime(59000)}`);
}

/* ---------------- 挑战历史（public/history.js，与启动器共用同一份） ---------------- */
function memStore() {
  const box = {};
  return {
    get: (k) => (Object.prototype.hasOwnProperty.call(box, k) ? box[k] : null),
    set: (k, v) => { box[k] = v; },
  };
}

function tHistory() {
  console.log('\n[40] 挑战历史 · 存储与按 tab 过滤 / 清空');
  const HIST = loadHistory();
  check(HIST && typeof HIST.add === 'function', 'history.js 挂上了 window.HMZQHistory');
  HIST.setStorage(memStore());

  check(HIST.list('all').length === 0, '初始为空');

  // 用户给的三条示例
  HIST.add(makeRecord({ mode: 'score', name: '玩家1', ms: 204000, shots: 18, score: 20, result: 'win' }));
  HIST.add(makeRecord({ mode: 'limit', diff: 'hard', name: '玩家1', ms: 312000, shots: 17, result: 'win' }));
  HIST.add(makeRecord({ mode: 'free', name: '玩家1', ms: 96000, shots: 11, result: 'win' }));
  HIST.add(makeRecord({ mode: 'limit', diff: 'easy', name: '玩家1', ms: 400000, shots: 40, result: 'fail' }));

  check(HIST.list('all').length === 4, '四条都在「所有」里', `实得 ${HIST.list('all').length}`);
  check(HIST.list('score').length === 1, '「计分」只有 1 条');
  check(HIST.list('limit').length === 2, '「限次」有 2 条');
  check(HIST.list('free').length === 1, '「自由」有 1 条');
  check(HIST.list('ai').length === 0 && HIST.list('online').length === 0, '人机 / 联机还没有记录');

  // 最新的在最前
  const all = HIST.list('all');
  check(all[0].mode === 'limit' && all[0].result === 'fail', '最新一条在最前面', `实得 ${all[0].mode}`);

  // 限次模式的剩余次数：困难 20 次，打了 17 杆 → 余 3（正是用户示例里那一行）
  const hard = HIST.list('limit').filter((r) => r.diff === 'hard')[0];
  check(hard.left === 3, '困难 20 次打 17 杆 → 余 3 次', `实得 ${hard.left}`);
  const easy = HIST.list('limit').filter((r) => r.diff === 'easy')[0];
  check(easy.left === 0, '简单 40 次打满 → 余 0 次');

  // 展示文案（用户给的示例行）
  const r1 = HIST.rowText(all.filter((x) => x.mode === 'score')[0]);
  check(r1.mode === '计分模式' && r1.result === '20分' && r1.slot === '—',
    '计分行：计分模式 / — / 20分', `实得 ${r1.mode} · ${r1.slot} · ${r1.result}`);
  const r2 = HIST.rowText(hard);
  check(r2.mode === '限次模式(困难)' && r2.slot === '余3次' && r2.result === '通关',
    '限次行：限次模式(困难) / 余3次 / 通关', `实得 ${r2.mode} · ${r2.slot} · ${r2.result}`);
  const r3 = HIST.rowText(all.filter((x) => x.mode === 'free')[0]);
  check(r3.mode === '自由模式' && r3.slot === '—' && r3.result === '通关',
    '自由行：自由模式 / — / 通关', `实得 ${r3.mode} · ${r3.slot} · ${r3.result}`);
  check(r1.time === '03:24', '用时格式化正确', `实得 ${r1.time}`);

  // 只清当前 tab
  const n = HIST.clear('limit');
  check(n === 2, '在「限次」里清空 = 清掉 2 条', `实得 ${n}`);
  check(HIST.list('score').length === 1, '计分记录没被误清');
  check(HIST.list('free').length === 1, '自由记录没被误清');
  check(HIST.list('all').length === 2, '剩下 2 条');

  HIST.clear('all');
  check(HIST.list('all').length === 0, '在「所有」里清空 = 全清');

  // 脏数据 / 越界
  check(HIST.add({ mode: 'nope' }) === null, '不认识的模式写不进去');
  check(HIST.add(null) === null, 'null 写不进去');
  HIST.add({ mode: 'score', score: 'abc', ms: -5, shots: 'x', ts: 1 });
  const dirty = HIST.list('score')[0];
  check(dirty && dirty.score === 0 && dirty.ms === 0 && dirty.shots === 0, '脏数据被收拾成合法值',
    `实得 ${JSON.stringify(dirty && { s: dirty.score, m: dirty.ms, sh: dirty.shots })}`);

  // 上限：超出 MAX 丢最旧的
  for (let i = 0; i < HIST.MAX + 20; i++) {
    HIST.add(makeRecord({ mode: 'free', name: 'x', ms: 1000, shots: 1, result: 'win' }));
  }
  check(HIST.list('free').length === HIST.MAX, `记录上限 ${HIST.MAX} 条`, `实得 ${HIST.list('free').length}`);
}

/* ---------------- 计时模式 ---------------- */
function tTimed() {
  console.log('\n[41] 计时模式 · 三档难度与判定');
  check(GAME_MODES.timed && GAME_MODES.timed.timed === true && GAME_MODES.timed.live === true,
    '计时模式已上线（timed 标记为真）');
  check(LIMIT_DIFFS.easy.shots === 40 && LIMIT_DIFFS.normal.shots === 30 && LIMIT_DIFFS.hard.shots === 20,
    '限次模式三档没被改动（40 / 30 / 20）');
  // 用户定的：简单 10 分钟 / 中等 6 分钟 / 困难 3 分钟
  check(TIME_DIFFS.easy.ms === 600000 && TIME_DIFFS.normal.ms === 360000 && TIME_DIFFS.hard.ms === 180000,
    '计时模式三档：10 / 6 / 3 分钟',
    `实得 ${TIME_DIFFS.easy.ms / 60000} / ${TIME_DIFFS.normal.ms / 60000} / ${TIME_DIFFS.hard.ms / 60000} 分钟`);

  check(timeLimit('timed', 'hard') === 180000, 'timeLimit(timed, hard) = 3 分钟');
  check(timeLimit('limit', 'hard') === null, '限次模式没有时限');
  check(timeLimit('free', 'hard') === null, '自由模式没有时限');
  check(timeLeft('timed', 'hard', 0) === 180000, '开局剩余 = 总时长');
  check(timeLeft('timed', 'hard', 60000) === 120000, '走过 1 分钟剩 2 分钟');
  check(timeLeft('timed', 'hard', 999999) === 0, '超时也是 0（不会变负）');
  check(timeLeft('limit', 'hard', 5) === null, '限次模式不显示剩余时间');
  check(modeHasDiff('limit') && modeHasDiff('timed') && !modeHasDiff('score') && !modeHasDiff('free'),
    '难度只属于限次与计时');

  // 判定：清台优先于超时（最后一杆正好到点但清台了 → 算通关）
  const w = judgeAfterShot({ mode: 'timed', diff: 'easy', shots: 9, potted: 15, total: 15, timeUp: true });
  check(w === 'win', '时间到但已清台 = 通关（优先）', `实得 ${w}`);
  const f = judgeAfterShot({ mode: 'timed', diff: 'easy', shots: 9, potted: 12, total: 15, timeUp: true });
  check(f === 'fail', '时间到没清台 = 失败', `实得 ${f}`);
  const go = judgeAfterShot({ mode: 'timed', diff: 'easy', shots: 9, potted: 12, total: 15, timeUp: false });
  check(go === null, '时间没到：继续', `实得 ${go}`);
  // 计时模式不吃"剩余次数"那套：打了 99 杆但没超时，不该判负
  const many = judgeAfterShot({ mode: 'timed', diff: 'easy', shots: 99, potted: 3, total: 15, timeUp: false });
  check(many === null, '计时模式不按杆数判负', `实得 ${many}`);
  const limTimed = judgeAfterShot({ mode: 'limit', diff: 'hard', shots: 20, potted: 3, total: 15, timeUp: true });
  check(limTimed === 'fail', '限次模式不受 timeUp 影响（各自只认自己的规则）', `实得 ${limTimed}`);

  check(potRate(6, 8) === 0.75, '进球率 6/8 = 75%');
  check(potRate(0, 0) === null, '一杆没打时进球率是 null（不是 0）');
  check(potRate(3, 0) === null, '没有击球记录时不给进球率');
}

/* ---------------- 记录里的过程数据 + 详情弹窗 ---------------- */
function tRecordDetail() {
  console.log('\n[42] 挑战历史 · 过程数据与详情弹窗');
  const HIST = loadHistory();
  HIST.setStorage((() => {
    const box = {};
    return { get: (k) => (box[k] ?? null), set: (k, v) => { box[k] = v; } };
  })());

  // 一局计时模式：记下进球率要用的一切 + 视角模式 + 平均瞄准
  const rec = makeRecord({
    mode: 'timed', diff: 'hard', name: '玩家1', ms: 210000, shots: 18, potted: 15, total: 15,
    best: 4, timeLeft: 180000 - 210000, view: 'tracking', aimMs: 4200, aimCount: 15, result: 'win',
  });
  check(rec.potted === 15 && rec.total === 15 && rec.best === 4, '记下进球数 / 总球数 / 最高连击');
  check(rec.timeLeft === 0, '超时后剩余时间夹到 0（不会记负数）', `实得 ${rec.timeLeft}`);
  check(rec.view === 'tracking', '记下这一局用的视角模式');
  check(rec.aimMs === 4200 && rec.aimCount === 15, '记下平均瞄准时间与参与平均的杆数');
  check(rec.left === null, '计时模式没有"剩余次数"');

  const got = HIST.add(rec);
  check(got && got.id, '写进历史并自动补了 id');

  // 列表那一行的中间槽位：计时模式显示剩余时间，而不是空着
  const row = HIST.rowText(HIST.list('timed')[0]);
  check(row.mode === '计时模式(困难)', '计时行带难度', row.mode);
  check(/^剩\d+:\d\d$/.test(row.slot), '计时行的槽位是"剩 m:ss"', row.slot);
  check(row.result === '通关', '计时通关显示「通关」');
  check(HIST.list('timed').length === 1, '「计时」tab 能过滤出来');
  check(HIST.TABS.some((t) => t.id === 'timed'), 'tab 列表里有「计时」');

  // 详情弹窗读的就是 detailRows()：纯函数，能直接断言
  const rows = HIST.detailRows(rec);
  const val = (k) => (rows.find((r) => r.k === k) || {}).v;
  check(rows.length > 8, '详情行足够详细', `${rows.length} 行`);
  check(val('玩法模式') === '计时模式 · 困难', '详情显示模式与难度', val('玩法模式'));
  check(val('击球次数') === '18 杆', '详情显示击球次数', val('击球次数'));
  check(val('进球') === '15 / 15 颗', '详情显示进球数', val('进球'));
  check(val('进球率') === '83%', '详情显示进球率（15/18）', val('进球率'));
  check(val('平均瞄准') === '4.2 秒（15 杆）', '详情显示平均瞄准时间', val('平均瞄准'));
  check(val('视角模式') === '追踪视角', '详情显示视角模式', val('视角模式'));
  check(val('最高连击') === '4 连', '详情显示最高连击', val('最高连击'));
  check(val('剩余时间') === '00:00', '详情显示剩余时间', val('剩余时间'));
  check((rows.find((r) => r.k === '结果') || {}).tone === 'ok', '通关的"结果"行不标红');

  // 没瞄准过 / 没视角数据的老记录：显示"—"，不能显示成 0
  const bare = makeRecord({ mode: 'free', name: 'x', ms: 1000, shots: 2, result: 'win' });
  const bRows = HIST.detailRows(bare);
  const bVal = (k) => (bRows.find((r) => r.k === k) || {}).v;
  check(bVal('平均瞄准') === '—', '没瞄准过时显示破折号', bVal('平均瞄准'));
  check(bVal('视角模式') === '—', '没有视角数据时显示破折号', bVal('视角模式'));
  // 老记录（这个版本之前存的）没有过程数据，total 为 0 —— 此时不编造"进球 0/0"，
  // 与"真的打了 2 杆一颗没进"必须能分辨
  check(!bRows.some((r) => r.k === '进球') && !bRows.some((r) => r.k === '进球率'),
    '没有过程数据的老记录不显示进球行');
  const zeroRows = HIST.detailRows(makeRecord({ mode: 'free', shots: 2, potted: 0, total: 15, result: 'win' }));
  const zVal = (k) => (zeroRows.find((r) => r.k === k) || {}).v;
  check(zVal('进球率') === '0%' && zVal('进球') === '0 / 15 颗',
    '有过程数据时 0 进球显示 0%（不是破折号）', `${zVal('进球')} · ${zVal('进球率')}`);

  // 判负的记录：结果行标红（详情弹窗靠这个 tone 上色）
  const lost = HIST.detailRows(makeRecord({ mode: 'limit', diff: 'hard', shots: 20, result: 'fail' }));
  check((lost.find((r) => r.k === '结果') || {}).tone === 'fail', '判负的记录结果行标红');

  // 脏数据：不在白名单里的视角模式要被丢掉
  const junk = HIST.sanitize({ mode: 'free', view: 'nope', aimMs: -5, potted: 'x', total: null });
  check(junk.view === null, '不认识的视角模式被丢掉');
  check(junk.aimMs === 0 && junk.potted === 0, '负数 / 非数字被收拾成合法值');
  check(HIST.sanitize({ mode: 'score', diff: 'hard' }).diff === null, '计分模式不该带难度（脏数据被清）');
}

/** 全量入口 */
export function testSoloModes() {
  tBasic();
  tMulti();
  tPenalty();
  tPremature();
  tLimit();
  tResult();
  tHistory();
  tTimed();
  tRecordDetail();
  tFreeball();
}

/* ---------------- 自由球模式（娱乐模式第一套玩法） ---------------- */
function tFreeball() {
  console.log('\n[44] 自由球模式 · 摆球开局与计分口径');

  const m = GAME_MODES.freeball;
  check(!!m && m.live === true, '自由球模式已上线', JSON.stringify(m));
  check(m.scored === true, '按常规计分模式的口径计分（scored = true）');
  check(m.placing === true, '开局要先摆白球（placing = true）');
  check(modeHasDiff('freeball') === false, '自由球模式没有难度档位');

  // 计分口径与计分模式完全一致（同一份 ScoreBoard）
  const b = new ScoreBoard();
  b.onShotStart();
  b.onTarget(); b.onTarget();          // 一杆进 2 颗：1 + 2
  const bonus = b.onShotEnd();
  check(bonus === 3 && b.score === 6, '一杆进 2 颗 = 1+2+3 = 6 分（与计分模式同口径）', `${b.score} 分`);

  // 记录：带分数、不带难度 / 剩余次数 / 剩余时间
  const rec = makeRecord({
    mode: 'freeball', name: '玩家1', ms: 12000, shots: 10, potted: 15, total: 15, score: 21, result: 'win',
  });
  check(rec.mode === 'freeball' && rec.score === 21 && rec.diff === null
    && rec.left === null && rec.timeLeft === null,
    '记录带分数，不带难度 / 剩余次数 / 剩余时间', JSON.stringify(rec));

  // 判定：自由球模式没有次数与时限，只有"清台"会结束这一局
  check(judgeAfterShot({ mode: 'freeball', shots: 30, potted: 15, total: 15 }) === 'win', '清台判通关');
  check(judgeAfterShot({ mode: 'freeball', shots: 30, potted: 9, total: 15 }) === null,
    '没清台就一直打（自由球模式不判负）');

  /* ---- 摆球位置：clampCuePlace（拖动白球时每个 move 都过一遍） ---- */
  const limX = TABLE.halfL - BALL_R;
  const limZ = TABLE.halfW - BALL_R;
  // 与 layout.js 的 CUE_PLACE.pocketGap 对齐：按**最大**喉口（中袋）留余量
  const gap = TABLE.pocketThroatMid + BALL_R * 1.6;

  const inside = clampCuePlace(0.3, -0.2);
  check(Math.abs(inside.x - 0.3) < 1e-9 && Math.abs(inside.z + 0.2) < 1e-9 && inside.moved === false,
    '台面中间的点原样保留');

  // 每条规则单独挑一个"只触发它自己"的点来验（对角线那种会同时触发两条，结果混在一起看不出对错）
  const outX = clampCuePlace(9, 0);             // 只越出长边，且落在两个角袋中间
  check(Math.abs(outX.x - limX) < 1e-9 && Math.abs(outX.z) < 1e-9 && outX.moved === true,
    '越出长边：被夹回库边内沿并留出一个球半径', `(${outX.x.toFixed(3)}, ${outX.z.toFixed(3)})`);

  const outZ = clampCuePlace(0.5, 9);           // 只越出短边，横向拉开躲开中袋
  check(Math.abs(outZ.x - 0.5) < 1e-9 && Math.abs(outZ.z - limZ) < 1e-9 && outZ.moved === true,
    '越出短边：同样留出一个球半径', `(${outZ.x.toFixed(3)}, ${outZ.z.toFixed(3)})`);

  // 拖到袋口正上方必须被推出来 —— 不然手指一松白球就落袋了
  const pk = POCKETS[4];
  const atPocket = clampCuePlace(pk.x, pk.z);
  const dp = Math.hypot(atPocket.x - pk.x, atPocket.z - pk.z);
  check(dp >= gap - 1e-9, '拖到袋口中心会被推到洞外（不然一松手球就落袋）',
    `距袋心 ${dp.toFixed(3)}m ≥ ${gap.toFixed(3)}m`);

  // 性质断言：随便撒 400 个点（含大量界外与袋口），收进来的结果必须**总是**合法
  let seed = 12345;
  const rnd = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
  let bad = 0, moved = 0;
  for (let i = 0; i < 400; i++) {
    const x = (rnd() * 2 - 1) * (TABLE.halfL + 0.3);
    const z = (rnd() * 2 - 1) * (TABLE.halfW + 0.3);
    const p = clampCuePlace(x, z);
    if (p.moved) moved++;
    if (Math.abs(p.x) > limX + 1e-9 || Math.abs(p.z) > limZ + 1e-9) bad++;
    for (const q of POCKETS) {
      if (Math.hypot(p.x - q.x, p.z - q.z) < gap - 1e-9) bad++;
    }
  }
  check(bad === 0, '任意拖动落点都合法（400 次随机采样：全在台内且避开 6 个袋口）', `非法 ${bad} 次`);
  check(moved > 100, '采样里确实有大量点被修正（护栏不是恒真的装饰）', `${moved}/400 次被挪动`);

  /* ---- 历史：娱乐 tab 用分组收（以后再加娱乐玩法不用往 TABS 里加行） ---- */
  const HIST = loadHistory();
  HIST.setStorage(memStore());
  HIST.add(makeRecord({
    mode: 'freeball', name: '玩家1', ms: 30000, shots: 12, potted: 8, total: 15, score: 15, result: 'win',
  }));
  HIST.add(makeRecord({ mode: 'score', name: '玩家1', ms: 20000, shots: 9, score: 9, result: 'win' }));
  check(HIST.list('fun').length === 1 && HIST.list('fun')[0].mode === 'freeball',
    '「娱乐」tab 能过滤出自由球模式的记录');
  check(HIST.list('score').length === 1, '娱乐分组不影响其它 tab（计分仍然只有 1 条）');
  check(HIST.rowText(HIST.list('fun')[0]).result === '15分',
    '自由球模式的行显示分数，而不是"通关"', HIST.rowText(HIST.list('fun')[0]).result);
  const n = HIST.clear('fun');
  check(n === 1 && HIST.list('score').length === 1, '「娱乐」tab 的清空只清娱乐玩法', `清掉 ${n} 条`);
}
