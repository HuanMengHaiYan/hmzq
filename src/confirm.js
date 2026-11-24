import { host } from './platform/index.js';

/**
 * 通用确认弹窗
 * ------------------------------------------------------------------
 * 只解决一件事：**会丢进度的操作必须问一句**。目前的唯一使用者是「⟳ 重开本局」
 * 与 R 键 —— 重开等于把这一局作废，而作废的局不进挑战历史列表，
 * 误触一次连"我打过一局"的痕迹都没有，所以这里必须拦一下。
 *
 * 与 result.js 的区别：结算弹窗是"一局结束了，给你看结果"，
 * 这个弹窗是"你确定要开始一个不可逆的动作吗"，两者互不相关，也不共用 DOM。
 *
 * 打开期间置 state.uiBlocked —— input.js 看到它会挡住所有指针与按键，
 * 于是弹窗下面的球台不会偷偷接住点击（不然点"取消"的同时就出杆了）。
 */
export function createConfirm({ state }) {
  const noop = { ask() {}, close() {}, isOpen: () => false };
  if (!host.hasDOM) return noop;
  // ⚠️ id 用 ask-* 前缀：index.html 里已有一个 confirm-* 系的弹窗（返回主菜单确认，
  //    叠在设置面板之上），两套不能共用 id，否则 byId 会拿到错的那个
  const modal = host.byId('ask-modal');
  const titleEl = host.byId('ask-title');
  const subEl = host.byId('ask-sub');
  const okEl = host.byId('ask-ok');
  const cancelEl = host.byId('ask-cancel');
  if (!modal || !okEl || !cancelEl) return noop;

  let pending = null;
  let open = false;

  const close = () => {
    modal.style.display = 'none';
    open = false;
    pending = null;
    state.uiBlocked = false;
  };

  /**
   * @param p.title 标题
   * @param p.sub   说明（要说清"会丢什么"，别只说"确定吗"）
   * @param p.ok    确认按钮文案
   * @param p.onOk  确认后执行
   */
  const ask = (p = {}) => {
    if (open) return;
    titleEl.textContent = p.title || '确定继续？';
    subEl.textContent = p.sub || '';
    subEl.hidden = !p.sub;
    okEl.textContent = p.ok || '确定';
    cancelEl.textContent = p.cancel || '取消';
    pending = typeof p.onOk === 'function' ? p.onOk : null;
    modal.style.display = 'flex';
    open = true;
    state.uiBlocked = true;
  };

  const accept = () => {
    const cb = pending;
    close();
    cb?.();
  };

  host.on(okEl, 'click', accept);
  host.on(cancelEl, 'click', close);
  host.on(modal, 'click', (e) => { if (e.target === modal) close(); });
  host.on(globalThis, 'keydown', (e) => {
    if (!open) return;
    // 键盘上 Enter = 确认、Esc = 取消：桌面上按 R 弹出后不用去够鼠标
    if (e.key === 'Enter') { e.preventDefault(); accept(); }
    else if (e.key === 'Escape') { e.preventDefault(); close(); }
  });

  return { ask, close, isOpen: () => open };
}
