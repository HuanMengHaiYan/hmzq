import { AUDIO, RULES } from './constants.js';
import { host } from './platform/index.js';
import { fmtTime, getGameMode, potRate } from './modes.js';

/**
 * 结算弹窗：胜利 / 失败 / 黑 8 提前落袋（特殊失败）
 * ------------------------------------------------------------------
 * 目前自动触发的只有「胜利」—— 全部目标球进袋、球停稳后弹出。
 * 「失败」与「黑 8 自爆」是**备用**：弹窗、文案、音效都写好了，
 * 但胜负规则还没做完，所以默认不触发（黑 8 那条由 RULES.eightBallSelfDestruct 开关控制）。
 * 想预览任意一种结算，给游戏页加 ?ending=win|lose|foul8 即可。
 *
 * 文案与统计行是纯函数（resultCopy / resultLines），无头测试可以直接跑。
 */

export const RESULT_KINDS = {
  win: {
    tag: 'VICTORY', title: '清 台 ！', tone: 'win',
    sub: '全部目标球入袋，这一局打得漂亮。',
  },
  lose: {
    tag: 'DEFEAT', title: '惜 败', tone: 'lose',
    sub: '这一局没能清台，再来一杆说不定就成了。',
  },
  foul8: {
    tag: 'FOUL', title: '黑 8 提前落袋', tone: 'boom',
    sub: '目标球还没清完就把黑 8 打进袋 —— 自爆，本局判负。',
  },
};

/** 结算音：与 RESULT_KINDS 一一对应，交给 audio.sfx() 播放 */
export const RESULT_VOICE = { win: 'fanfare', lose: 'defeat', foul8: 'boom' };

/**
 * @returns 弹窗要显示的一切（纯函数，不含 DOM）
 * @param mode   玩法模式 id：限次模式的胜负文案与自由 / 计分不同（"次数用尽" / "通关"）
 * @param stats  同一份统计（本地双人要读里面的 winner 才能写出"玩家X 获胜"）
 */
export function resultCopy(kind, mode, stats = {}) {
  const def = RESULT_KINDS[kind];
  if (!def) return null;
  if (mode === 'duo' || mode === 'ai') {
    const w = stats.winner;                       // 1 | 2
    // 人机：赢的那方是"你"或"电脑"（写"玩家2"会让人以为还有个人在等）
    const who = mode === 'ai' ? (w === 2 ? '电脑' : '你') : (w ? `玩家${w}` : '无人');
    if (kind === 'win') {
      return {
        tag: 'WINNER', title: `${who} 获 胜`, tone: 'win',
        sub: mode === 'ai'
          ? '清完自己那组球再打进黑八 —— 这一局赢下电脑了。'
          : '清完自己那组球之后打进黑八 —— 这一局归你。',
      };
    }
    return {
      tag: mode === 'ai' ? 'DEFEAT' : 'FOUL', title: `${who} 获 胜`, tone: mode === 'ai' ? 'lose' : 'boom',
      // 人机输掉的原因有两种（电脑先清完台 / 自己提前打进黑八），文案一并盖住，
      // 不写死某一种 —— 写死了会有"明明是它先清完，怎么说我犯规"的疑惑
      sub: mode === 'ai'
        ? '这一局没能赢下电脑 —— 换档难度或再来一局试试。'
        : `对手在自己的球清完之前就打进了黑八，判负。`,
    };
  }
  if (kind === 'win' && mode === 'limit') {
    return { ...def, tag: 'CLEAR', title: '通 关 ！', sub: '在限定次数内清台 —— 这一局打得漂亮。' };
  }
  if (kind === 'lose' && mode === 'limit') {
    // 限次失败与限时失败是两回事，tag 不能都用 TIME UP，否则一眼分不出是怎么输的
    return { ...def, tag: 'OUT OF SHOTS', title: '次数用尽', sub: '限定次数内没能清台，下次试试先规划走位。' };
  }
  if (kind === 'win' && mode === 'timed') {
    return { ...def, tag: 'CLEAR', title: '通 关 ！', sub: '在限定时间内清台 —— 这一局打得漂亮。' };
  }
  if (kind === 'lose' && mode === 'timed') {
    return { ...def, tag: 'TIME UP', title: '时间到', sub: '限定时间内没能清台，下次试试打得更果断些。' };
  }
  if (kind === 'win' && getGameMode(mode).scored) {
    // 计分模式与自由球模式共用这套文案（都按同一份 ScoreBoard 计分）
    return { ...def, sub: '全部目标球入袋 —— 看看这一局拿了多少分。' };
  }
  return def;
}

/** @returns 统计行 [{k, v}]（纯函数） */
export function resultLines(stats = {}) {
  const {
    shots = 0, potted = 0, total = 0, best = 0, score = null, ms = 0,
    left = null, timeLeft: leftMs = null,
  } = stats;
  const rows = [];
  if (score != null) rows.push({ k: '得分', v: `${score} 分` });
  rows.push({ k: '击球次数', v: String(shots) });
  rows.push({ k: '清台进度', v: `${potted} / ${total}` });
  if (left != null) rows.push({ k: '剩余次数', v: `${left} 次` });
  if (leftMs != null) rows.push({ k: '剩余时间', v: fmtTime(leftMs) });
  rows.push({ k: '最高连击', v: best >= 2 ? `${best} 连` : '—' });
  const rate = potRate(potted, shots);
  if (rate != null) rows.push({ k: '进球率', v: `${Math.round(rate * 100)}%` });
  if (ms > 0) rows.push({ k: '用时', v: fmtTime(ms) });
  return rows;
}

/**
 * 黑 8 是不是"提前"落袋：还有其它目标球没进就算提前（8 号自己是最后一颗）。
 * 备用规则的判定，默认因为 RULES.eightBallSelfDestruct = false 而永不成立。
 */
export function isEarlyEight(state, ball) {
  if (!RULES.eightBallSelfDestruct || ball.isCue || ball.number !== 8) return false;
  return state.potted.length < state.pottedTotal - 1;
}

/**
 * 结算入口：播结算音 + 弹窗。
 *   win   —— 全部目标球进袋（球停稳后由 main.js 触发）
 *   lose  —— 备用，等胜负规则上线
 *   foul8 —— 黑 8 提前落袋（备用）
 * @returns endMatch(kind)
 */
export function createMatchEnd({ state, audio, combo, getResult, getElapsed }) {
  return function endMatch(kind) {
    const result = getResult?.();
    if (!RESULT_VOICE[kind] || result?.isOpen?.()) return;
    state.matchOver = true;
    audio.sfx(RESULT_VOICE[kind]);
    if (kind === 'win') {
      audio.playClip('cheer', AUDIO.cheerGain);
      setTimeout(() => audio.playClip('applause', AUDIO.applauseGain), 700);
    }
    const ms = getElapsed?.() ?? 0;
    result?.show(kind, {
      mode: state.modeId,
      winner: state.duoWinner ?? null,      // 本地双人：写出"玩家X 获胜"
      shots: state.shots,
      potted: state.potted.length,
      total: state.pottedTotal,
      best: combo.best,
      score: state.scored ? state.score : null,
      left: state.modeId === 'limit' ? state.shotsLeft : null,
      timeLeft: state.modeId === 'timed' ? state.timeLeftMs : null,
      ms,
    });
  };
}

/**
 * 接线结算弹窗
 * @param state          全局状态（弹窗打开期间置 uiBlocked）
 * @param onRestart()    再来一局
 * @param onBackToMenu() 返回启动器
 */
export function createResultUI({ state, onRestart, onBackToMenu }) {
  if (!host.hasDOM) return { show() {}, close() {}, isOpen: () => false };

  const modal = host.byId('result-modal');
  const tagEl = host.byId('result-tag');
  const titleEl = host.byId('result-title');
  const subEl = host.byId('result-sub');
  const statsEl = host.byId('result-stats');
  if (!modal) return { show() {}, close() {}, isOpen: () => false };

  let open = false;

  const close = () => {
    modal.style.display = 'none';
    open = false;
    state.uiBlocked = false;
  };

  const show = (kind, stats) => {
    const def = resultCopy(kind, stats?.mode, stats);
    if (!def) return;
    modal.dataset.tone = def.tone;
    tagEl.textContent = def.tag;
    titleEl.textContent = def.title;
    subEl.textContent = def.sub;
    statsEl.innerHTML = resultLines(stats)
      .map((r) => `<div class="row"><span class="k">${r.k}</span><span class="v">${r.v}</span></div>`)
      .join('');
    modal.style.display = 'flex';
    open = true;
    state.uiBlocked = true;
  };

  host.on(host.byId('result-again'), 'click', () => { close(); onRestart?.(); });
  host.on(host.byId('result-menu'), 'click', () => { close(); onBackToMenu?.(); });
  host.on(modal, 'click', (e) => { if (e.target === modal) close(); });
  host.on(globalThis, 'keydown', (e) => { if (e.key === 'Escape' && open) close(); });

  return { show, close, isOpen: () => open };
}
