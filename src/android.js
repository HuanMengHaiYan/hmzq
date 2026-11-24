import { App } from '@capacitor/app';
import { host } from './platform/index.js';

/**
 * Android（Capacitor 壳）里 web 自己做不到的那部分
 * ------------------------------------------------------------------
 * 界面完全沿用移动端那套（触摸判定 → 竖屏二级页 / 开球键 / 手势），原生只补三件：
 *   ① 亮屏与全屏 —— 在 MainActivity.java 里（FLAG_KEEP_SCREEN_ON 不需要权限）
 *   ② 返回键 —— 这里：先关面板，再按一次才退出
 *   ③ 给页面打原生标记 —— 帮助页据此隐掉"浏览器要求 / 调试地址"这类 APP 里没意义的条目
 *
 * 浏览器 / Electron 里 `Capacitor.isNativePlatform()` 为 false，下面全部不执行，
 * 所以这个文件对 web 与桌面零影响。
 */

/** 是不是跑在真正的 APP 里（而不是手机浏览器） */
export function isNativeApp() {
  const C = globalThis.Capacitor;
  return !!(C && typeof C.isNativePlatform === 'function' && C.isNativePlatform());
}

/** 面板从上往下逐层关（与 PC 上 Esc 的顺序一致） */
function defaultClosePanel() {
  for (const [modalId, closeId] of [['settings-modal', 'settings-close'], ['help-modal', 'help-close']]) {
    const modal = host.byId(modalId);
    if (!modal || modal.style.display !== 'flex') continue;
    const btn = host.byId(closeId);
    if (btn && btn.click) btn.click();
    return true;
  }
  return false;
}

/** 轻量 toast：没有现成组件，就自己挂一个（同一条复用，不堆 DOM） */
function makeToast() {
  let el = null;
  let timer = 0;
  return function toast(msg) {
    if (!el) {
      el = host.createElement('div');
      if (!el) return;
      el.setAttribute('style', [
        'position:fixed', 'left:50%', 'bottom:96px', 'transform:translateX(-50%)',
        'z-index:99998', 'padding:10px 18px', 'border-radius:999px',
        'background:rgba(12,16,20,.88)', 'color:#e8eef5', 'font-size:14px',
        'line-height:1.4', 'pointer-events:none', 'transition:opacity .2s',
      ].join(';'));
      const doc = globalThis.document;
      if (doc && doc.body) doc.body.appendChild(el);
      else return;
    }
    el.textContent = msg;
    el.style.opacity = '1';
    clearTimeout(timer);
    timer = setTimeout(() => { el.style.opacity = '0'; }, 1600);
  };
}

/**
 * 返回键：先关面板，再按一次才退出（避免误触直接退出游戏）。
 * @param {object} [opts]
 *   closePanel() -> boolean  有面板 / 弹窗打开时关掉它并返回 true（消费掉这次返回）
 *   toast(msg)               提示"再按一次退出"
 */
export function initAndroidBack(opts = {}) {
  if (!isNativeApp()) return () => {};
  const closePanel = opts.closePanel || defaultClosePanel;
  const toast = opts.toast || makeToast();
  let armedAt = 0;

  const handle = () => {
    if (closePanel()) return;                       // 先把面板收起来
    const now = Date.now();
    if (now - armedAt < 2000) {                     // 2 秒内再按一次 → 退出
      App.exitApp();
      return;
    }
    armedAt = now;
    toast('再按一次返回键退出');
  };

  let un = null;
  App.addListener('backButton', handle).then((h) => { un = () => h.remove(); });
  return () => { if (un) un(); };
}
