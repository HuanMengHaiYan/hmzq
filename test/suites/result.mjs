import { check } from '../lib/harness.mjs';
import { RESULT_KINDS, RESULT_VOICE, resultCopy, resultLines } from '../../src/result.js';
import { RULES } from '../../src/constants.js';

/**
 * 结算弹窗的纯逻辑测试（result.js 里与 DOM 无关的那部分）。
 * 弹窗本体要 DOM，交给 electron/smoke.cjs 的端到端自检去验。
 */

export function testResultCopy() {
  console.log('\n[21] 结算：三种结局的文案与音效');
  const kinds = ['win', 'lose', 'foul8'];
  for (const k of kinds) {
    const c = resultCopy(k);
    check(!!c && !!c.title && !!c.tag && !!c.sub, `${k}：文案齐全`, c ? c.title : '缺');
    check(!!RESULT_VOICE[k], `${k}：配了结算音`, RESULT_VOICE[k]);
  }
  check(resultCopy('nope') === null, '未知结局不弹窗');
  check(new Set(Object.values(RESULT_KINDS).map((x) => x.tone)).size === 3,
    '三种结局各有配色', Object.values(RESULT_KINDS).map((x) => x.tone).join('/'));
}

export function testResultStats() {
  console.log('\n[22] 结算：统计行');
  const val = (rows, k) => (rows.find((r) => r.k === k) || {}).v;
  const rows = resultLines({ shots: 12, potted: 15, total: 15, best: 4 });
  check(val(rows, '击球次数') === '12' && val(rows, '清台进度') === '15 / 15'
    && val(rows, '最高连击') === '4 连', '统计数值正确',
  rows.map((r) => `${r.k}=${r.v}`).join(' | '));
  // 15 颗 / 12 杆 > 100%：进球率要夹在 100% 以内（一杆多进很正常）
  check(val(rows, '进球率') === '100%', '进球率封顶 100%', val(rows, '进球率'));

  const empty = resultLines();
  check(val(empty, '最高连击') === '—', '没有连击时显示破折号', val(empty, '最高连击'));
  check(val(empty, '进球率') === undefined, '没打过球时不显示进球率', String(val(empty, '进球率')));

  const one = resultLines({ best: 1 });
  check(val(one, '最高连击') === '—', '单颗不算连击', val(one, '最高连击'));

  // 计时模式：多一行"剩余时间"，限次模式多一行"剩余次数"，两者互不串门
  const timed = resultLines({ shots: 8, potted: 9, total: 15, timeLeft: 92_000 });
  check(val(timed, '剩余时间') === '01:32' && val(timed, '剩余次数') === undefined,
    '计时模式显示剩余时间', `${val(timed, '剩余时间')} / 次数=${val(timed, '剩余次数')}`);
  const limited = resultLines({ shots: 8, potted: 9, total: 15, left: 3 });
  check(val(limited, '剩余次数') === '3 次' && val(limited, '剩余时间') === undefined,
    '限次模式显示剩余次数', `${val(limited, '剩余次数')} / 时间=${val(limited, '剩余时间')}`);
  check(val(resultLines({ potted: 6, shots: 8, total: 15 }), '进球率') === '75%',
    '进球率按 进球数 / 击球次数 算', val(resultLines({ potted: 6, shots: 8, total: 15 }), '进球率'));
}

/**
 * 人机对战的胜负文案（2026-09-29：打赢电脑记一次胜利，输了只弹提示）
 * ------------------------------------------------------------------
 * 与本地双人共用 resultCopy 里那一段分支，所以顺便把双人的文案也钉住 ——
 * 改人机时最容易顺手把「玩家X」改成别的，双人那头跟着错。
 */
export function testResultAi() {
  console.log('\n[24] 结算：人机对战的胜负文案');
  const win = resultCopy('win', 'ai', { winner: 1 });
  const lost = resultCopy('lose', 'ai', { winner: 2 });
  check(/你/.test(win?.title || '') && !/玩家/.test(win?.title || ''),
    '赢了电脑：写「你 获 胜」而不是「玩家1」', win?.title || '缺');
  check(/电脑/.test(lost?.title || ''),
    '输给电脑：写「电脑 获 胜」', lost?.title || '缺');
  check(win?.tone === 'win' && lost?.tone === 'lose',
    '人机胜负各用各的配色（赢=金色 / 输=红色）', `${win?.tone} / ${lost?.tone}`);
  const duo = resultCopy('win', 'duo', { winner: 2 });
  check(/玩家2/.test(duo?.title || ''), '本地双人仍然是「玩家X 获 胜」', duo?.title || '缺');
}

export function testResultRules() {
  console.log('\n[23] 结算：备用规则的开关状态');
  // 黑 8 自爆是"预备"功能：代码齐全但默认不参与，免得规则没写完就乱判负
  check(RULES.eightBallSelfDestruct === false,
    '黑 8 自爆默认关闭（备用）', String(RULES.eightBallSelfDestruct));
}
