import { BALL_COLORS, isStriped } from './constants.js';
import { host } from './platform/index.js';
import { IS_TOUCH } from './mobile.js';
import { groupName } from './duo.js';

const POP_W = 152;   // 跟随鼠标的蓄力条尺寸（贴边翻转用）
const POP_H = 32;
const CLOCK_WARN_MS = 30_000;   // 计时模式：剩余时间低于这个就变红告警

/** 毫秒 → m:ss（计时模式的剩余时间，比 mm:ss 少一位、更像倒计时） */
function clock(ms) {
  const s = Math.max(0, Math.ceil((Number(ms) || 0) / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

/**
 * HUD：左上状态面板、右上进袋清单、跟随鼠标的蓄力条。
 * 无 DOM 环境（微信小游戏）下整体降级为空操作 —— 届时可另写一个 canvas 自绘版，
 * 只要方法签名一致，main.js 无需改动。
 */
export class Hud {
  constructor() {
    this.enabled = host.hasDOM;
    if (!this.enabled) {
      // 无 DOM：所有方法退化为空操作（覆盖实例属性优先于原型方法）
      this.el = {};
      for (const k of ['update', 'setCharging', 'setMoving', 'showCharge', 'hideCharge', 'moveCharge']) {
        this[k] = () => {};
      }
      return;
    }
    const id = (x) => host.byId(x);
    this.el = {
      state: id('v-state'),
      shots: id('v-shots'),
      power: id('v-power'),
      bar: id('bar-power'),
      moving: id('v-moving'),
      fps: id('v-fps'),
      potted: id('v-potted'),
      list: id('potted-list'),
      // 本地双人：两栏（各人自己打进的球）。与单人的一栏互斥显示。
      soloPot: id('potted-solo'),
      duoPot: id('potted-duo'),
      potted1: id('v-potted-1'),
      potted2: id('v-potted-2'),
      list1: id('potted-list-1'),
      list2: id('potted-list-2'),
      pop: id('charge-pop'),
      fill: id('charge-fill'),
      pct: id('charge-pct'),
      // 单人模式：模式名 + 得分 / 剩余次数 / 剩余时间（三者按模式互斥显示，自由模式全隐藏）
      mode: id('v-mode'),
      rowScore: id('row-score'),
      rowLeft: id('row-left'),
      rowTime: id('row-time'),
      score: id('v-score'),
      left: id('v-left'),
      time: id('v-time'),
      // 移动端：屏幕底部固定位置的大蓄力条（没有光标可跟随，样式见 mobile.css）
      mPop: id('charge-mobile'),
      mFill: id('charge-mobile-fill'),
      mPct: id('charge-mobile-pct'),
    };
    this.touch = IS_TOUCH;
    this.#wireFold();
  }

  /**
   * 面板收起 / 展开（左上角信息栏、右侧已进袋）。
   * ------------------------------------------------------------------
   * JS 只做两件事：切一个 `.folded`、把按钮文案换成「展开 / 收起」。
   * 折成什么样全交给 CSS —— "收起时只留最后一颗进球"用 `.chip:not(:last-child)` 判，
   * "一颗没进就顶个透明格"用 `:empty + .chip-empty` 判，都不必让 JS 重画列表，
   * 展开时自然原样回来。
   */
  #wireFold() {
    const bind = (panelId, btnId) => {
      const panel = host.byId(panelId);
      const btn = host.byId(btnId);
      if (!panel || !btn) return;
      host.on(btn, 'click', () => {
        const folded = panel.classList.toggle('folded');
        btn.textContent = folded ? '展开' : '收起';
        btn.title = folded ? '展开面板' : '收起面板';
      });
    };
    bind('panel-info', 'info-toggle');
    bind('panel-pot', 'pot-toggle');
  }

  /** 完整刷新（每杆开始 / 结束、进袋、重开本局时调用） */
  update(state, cuePotted) {
    const st = this.el.state;
    st.textContent = state.placingCue ? '摆放白球'
      : state.shooting ? '运动中' : cuePotted ? '白球待复位' : '就绪';
    st.className = 'v ' + (state.placingCue || state.shooting ? 'state-run' : 'state-ready');

    this.el.shots.textContent = String(state.shots);
    this.el.bar.style.width = `${Math.round(state.lastPower * 100)}%`;
    this.el.power.textContent = state.shots ? `${Math.round(state.lastPower * 100)}%` : '-';
    // 分母跟着玩法规则走（中式黑八 15 颗；将来加斯诺克 / 俄式时这里自动跟着变）
    this.el.potted.textContent = `${state.potted.length} / ${state.pottedTotal ?? 15}`;
    this.#renderPottedChips(state.potted);
    this.#renderDuoPots(state.duo);
    this.#renderMode(state);
  }

  /**
   * 面板标题 + 单人模式的三行（得分 / 剩余次数 / 剩余时间）。
   * 三个模式各占一行、互斥显示，自由模式全藏 —— 面板本来就小，不该为用不上的信息占位。
   * ⚠️ `.row[hidden]` 必须在 CSS 里显式写 display:none：`.row` 是 flex，
   *    会盖掉浏览器默认的 [hidden] 规则（表现是"限次模式多出一行得分"）。
   */
  #renderMode(state) {
    const rows = [
      // 得分行看的是"这个模式计不计分"（计分模式与自由球模式都是 scored），
      // 而不是写死 modeId —— 以后再加计分类玩法不用回来改这里
      [this.el.rowScore, !!state.scored],
      [this.el.rowLeft, state.modeId === 'limit'],
      [this.el.rowTime, state.modeId === 'timed'],
    ];
    for (const [row, show] of rows) {
      if (row && row.hidden !== !show) row.hidden = !show;
    }
    if (state.scored) this.el.score.textContent = String(state.score ?? 0);
    if (state.modeId === 'limit') {
      const n = state.shotsLeft;
      this.el.left.textContent = n == null ? '–' : String(n);
      this.el.left.className = 'v' + (n != null && n <= 3 ? ' state-run' : '');   // 最后几杆变红
    }
  }

  /**
   * 计时模式：每帧刷新剩余时间（由 main.js 的 tickClock 填好 state.timeLeftMs）。
   * 只在文本真的变了才写 DOM —— 这是唯一每帧调用的 HUD 写入，别让它碰到 layout。
   */
  setClock(state) {
    const el = this.el.time;
    if (!el || state.modeId !== 'timed') return;
    const ms = state.timeLeftMs;
    const txt = ms == null ? '–' : clock(ms);
    if (el.textContent !== txt) el.textContent = txt;
    // 最后 30 秒变红（与"剩余次数 ≤3"用的是同一个警示色）
    const warn = ms != null && ms <= CLOCK_WARN_MS;
    const cls = 'v' + (warn ? ' state-run' : '');
    if (el.className !== cls) el.className = cls;
  }

  /** 进游戏时把模式名写进面板标题（自由模式保留原来的 PHASE 标记） */
  setModeLabel(text) {
    if (this.el.mode && text) this.el.mode.textContent = text;
  }

  /** 蓄力中：力度条 + 跟随鼠标的浮条同步（移动端换成底部大条）；松手后由 update() 接管 */
  setCharging(power) {
    const pct = Math.round(power * 100);
    this.el.bar.style.width = `${pct}%`;
    this.el.power.textContent = `${pct}% · 蓄力中`;
    this.el.fill.style.width = `${pct}%`;
    this.el.pct.textContent = `${pct}%`;
    if (!this.touch) return;
    if (this.el.mFill) this.el.mFill.style.width = `${pct}%`;
    if (this.el.mPct) this.el.mPct.textContent = `${pct}%`;
  }

  setMoving(n) {
    this.el.moving.textContent = String(n);
  }

  /** 帧率（半秒平均，由 main.js 计算）：真机上报性能就看它 */
  setFps(fps) {
    if (this.el.fps) this.el.fps.textContent = String(Math.round(fps));
  }

  showCharge(x, y) {
    if (this.touch) { this.el.mPop?.classList.add('show'); return; }
    this.moveCharge(x, y);
    this.el.pop.classList.add('show');
  }

  hideCharge() {
    if (this.touch) { this.el.mPop?.classList.remove('show'); return; }
    this.el.pop.classList.remove('show');
  }

  /** 把蓄力条放到光标右侧（贴边时自动翻到左侧） */
  moveCharge(px, py) {
    const pop = this.el.pop;
    if (!pop) return;
    const { w, h } = host.viewport();
    let x = px + 20;
    if (x + POP_W > w - 8) x = px - POP_W - 20;
    const y = Math.min(Math.max(8, py - POP_H / 2), Math.max(8, h - POP_H - 8));
    pop.style.left = `${Math.round(x)}px`;
    pop.style.top = `${Math.round(y)}px`;
  }

  /**
   * 本地双人：已进袋换成**两栏**，各记"这个人自己打进的球"。
   * ------------------------------------------------------------------
   * 单人模式这两栏整个藏起来（`#potted-duo` 带 hidden），只留原来那一栏。
   * ⚠️ `.row[hidden]` 的老坑：容器是 flex 的话 UA 的 [hidden] 会被盖掉，
   *    所以 `#potted-duo[hidden]` 必须在 CSS 里显式写 display:none。
   * 两人各自那一行还要带组别（大号 / 小号 / 未分组），一眼能看出谁打哪一组。
   */
  #renderDuoPots(duo) {
    const box = this.el.duoPot;
    if (!box || !this.el.soloPot) return;
    const on = !!duo;
    box.hidden = !on;
    this.el.soloPot.hidden = on;
    if (!on) return;

    // 行首的"玩家1 已进袋"写在 HTML 里，这里只补组别与数量（别把玩家名也写上，会重复成
    // "玩家1 已进袋 玩家1·小号 2"，面板还会被撑到换行）
    const pots = duo.pots || { 1: [], 2: [] };
    for (const p of [1, 2]) {
      const g = duo.groups && duo.groups[p];
      const head = this.el[`potted${p}`];
      if (head) head.textContent = `${groupName(g)} ${pots[p].length}`;
      this.#renderChipsInto(this.el[`list${p}`], pots[p]);
    }
  }

  #renderPottedChips(potted) {
    this.#renderChipsInto(this.el.list, potted);
  }

  /** 把一串球号画成彩色小圆片（单人一栏与双人两栏共用这一段） */
  #renderChipsInto(list, potted) {
    if (!list) return;
    if (list.childElementCount === potted.length) return;   // 数量没变就不重建
    list.innerHTML = '';
    for (const n of potted) {
      const chip = host.createElement('div');
      chip.className = 'chip';
      chip.textContent = n;
      chip.style.background = isStriped(n)
        ? `linear-gradient(180deg,#f6f4ef 0 28%,${BALL_COLORS[n]} 28% 72%,#f6f4ef 72%)`
        : BALL_COLORS[n];
      chip.style.color = n === 8 ? '#fff' : '#111';
      list.appendChild(chip);
    }
  }
}
