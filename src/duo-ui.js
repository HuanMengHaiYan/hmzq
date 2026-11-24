import { host } from './platform/index.js';
import { IS_TOUCH } from './mobile.js';
import { groupName, groupRange } from './duo.js';

/**
 * 本地双人模式的界面：顶部回合横幅 + 左右两个开球键。
 * ------------------------------------------------------------------
 * 只做三件事，判定一行都不写（那些在 duo.js 里，能被无头测试断言）：
 *   ① 顶部横幅：左右是双方的球组与剩余球数，中间大字"轮到谁"；
 *   ② 两个开球键：玩家2 在左、玩家1 在右，只有当前回合那一个可按；
 *   ③ hidden 的收放（非双人模式这些元素整个不出现）。
 *
 * ⚠️ 回合提示必须**够醒目**：两个人共用一台设备，最容易出的状况就是
 *    "上一个人打完没换手，另一个人接着按" —— 横幅放在屏幕顶部正中，中间那行是大字。
 */
export function createDuoUI({ state, match, canCharge, onStart, onEnd, bindShoot, ai = false }) {
  if (!host.hasDOM) return { sync() {}, render() {}, show() {} };

  const banner = host.byId('turn-banner');
  const dock = host.byId('duo-dock');
  const soloBtn = host.byId('btn-shoot');
  const whoEl = host.byId('turn-who');
  const goEl = host.byId('turn-go');
  const noteEl = host.byId('turn-note');
  const btns = [host.byId('btn-shoot-2'), host.byId('btn-shoot-1')].filter(Boolean);
  const side = {
    1: { box: host.byId('duo-side-1'), group: host.byId('duo-group-1'), left: host.byId('duo-left-1'), name: host.byId('duo-name-1') },
    2: { box: host.byId('duo-side-2'), group: host.byId('duo-group-2'), left: host.byId('duo-left-2'), name: host.byId('duo-name-2') },
  };

  // 人机对战：玩家2 那个键改成「电脑 / 自动出杆」—— 它永远置灰（canUse 里已挡掉），
  // 但字面还写"玩家2 开球"会让人以为还有第二个人在按。
  if (ai) {
    const b2 = host.byId('btn-shoot-2');
    if (b2) {
      const t = b2.querySelector('b');
      const s = b2.querySelector('small');
      if (t) t.textContent = '电脑';
      if (s) s.textContent = '自动出杆';
    }
  }

  /**
   * 进 / 出双人模式：两套开球键互斥（单人的那个要收起来，免得屏幕上两个"开球"）。
   * ------------------------------------------------------------------
   * ⚠️ 只藏**按钮**、不藏整个 #shoot-dock：移动端那条底部大蓄力条（#charge-mobile）
   *    就住在这个 dock 里，双人模式照样要用（按住蓄力时得看得见力度）。
   *    两个孩子都 hidden 时 dock 自身宽高为 0，不会挡住任何操作。
   */
  const show = (on) => {
    if (dock) dock.hidden = !on;
    if (banner) banner.hidden = !on;
    if (soloBtn) soloBtn.hidden = !!on;
    // CSS 也要跟着切：`body.placing` 那条隐藏规则对两个 dock 都生效，
    // 但 #duo-dock 的显示由这里说了算。
    host.byId('app')?.ownerDocument?.body.classList.toggle('duo', !!on);
  };

  const shoot = bindShoot({
    state,
    canCharge,
    onStart,
    onEnd,
    btns,
    // 只有当前回合那一方的键能按下 —— 另一个置灰，两个人不会抢。
    // ⚠️ 人机对战：玩家2 是电脑，那颗键**永远**置灰（它自己会打，见 main.js 的 tickAi）；
    //    但人类（玩家1）那颗照常 —— 写成 `!ai && ...` 会把人类的键一起废掉，开球都按不动。
    canUse: (b) => {
      const p = Number(b.dataset.player);
      if (ai && p === 2) return false;
      return p === (match?.turn ?? 1);
    },
  });

  /** 每帧：按钮可用态（轮到谁、能不能出杆） */
  const sync = () => shoot.sync();

  /** 局面变化时重画横幅（换人 / 定组 / 进球 / 判罚之后调用一次） */
  const render = (snap) => {
    if (!snap) return;
    // 人机对战：玩家2 那一栏写「电脑」（它的名字不是"玩家"，写"玩家2"会让人以为有人在等）
    if (whoEl) whoEl.textContent = ai && snap.turn === 2 ? '电脑' : `玩家${snap.turn}`;
    // "轮到你击球"里的"你"＝人类操作者。轮到电脑时对着屏幕说"你"会让人以为是自己的回合，
    // 所以那一句要换成"电脑正在瞄准"（它这一会儿确实在思考 / 转杆，见 main.js 的 tickAi）。
    if (goEl) goEl.textContent = ai && snap.turn === 2 ? '电脑正在瞄准' : '轮到你击球';
    // 上一杆的说明（duo.js 是纯逻辑，文案里写的是"玩家N"）——显示层把玩家2 换成「电脑」，
    // 不然横幅上大字写着"电脑"、下面小字又说"玩家2"，像两个人。
    if (noteEl) noteEl.textContent = ai ? String(snap.note || '').replace(/玩家2/g, '电脑') : (snap.note || '');
    for (const p of [1, 2]) {
      const s = side[p];
      if (!s.box) continue;
      if (ai && s.name) s.name.textContent = p === 2 ? '电脑' : '玩家1';
      const g = snap.groups[p];
      if (s.group) s.group.textContent = g ? `${groupName(g)}（${groupRange(g)}）` : '未分组';
      if (s.left) s.left.textContent = `剩 ${snap.remaining[p]}`;
      // 当前回合那一侧高亮
      s.box.classList.toggle('on', snap.turn === p && !snap.over);
      // 拿到手中球的一方（白球落袋后对方可以自由摆球）额外标一下
      s.box.classList.toggle('inhand', snap.ballInHand === p);
    }
    if (banner) {
      banner.classList.toggle('over', !!snap.over);
      banner.classList.toggle('touch', IS_TOUCH);
    }
  };

  return { sync, render, show };
}
