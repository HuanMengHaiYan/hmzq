/**
 * 移动端外壳（触摸设备：手机 / 平板）
 * ------------------------------------------------------------------
 * 桌面端的操作分工是「左键按住蓄力、右键拖动转视角」—— 两套输入互不干扰。
 * 手机上只有一根手指时没法同时干这两件事，所以重新分工：
 *
 *   · 单指拖动  → 旋转视角        （OrbitControls touches.ONE = ROTATE）
 *   · 双指拖动  → 平移            （touches.TWO = DOLLY_PAN，自由模式可用）
 *   · 双指捏合  → 缩放            （同上，随 DOLLY_PAN 一起生效）
 *   · 出杆      → 右下角「开球」键：按住蓄力，屏幕底部大蓄力条，松手出杆
 *
 * 追踪模式的相机由脚本跟随白球（每帧重设 controls.target），所以那边的双指只保留
 * 缩放、不保留平移 —— 平移会被跟球逻辑立刻覆盖掉，看着像"拖了又弹回去"。
 * 这也正好和 PC 一致：桌面的追踪模式本来就是 MIDDLE: null（只有右键旋转 + 滚轮缩放），
 * 三条管辖规则见 camera-rig.js 的 #applyOrbit（测试在 test/suites/mobile.mjs [27]）。
 *
 * 桌面 / Electron 下 IS_TOUCH 为 false，本模块全部是空操作，不走任何移动端分支。
 */
import { host } from './platform/index.js';

/** 主输入是手指（由 platform 层判定，Electron 恒为 false） */
export const IS_TOUCH = !!host.touch;

/**
 * 给 <html> 打上 data-mobile="1"，CSS 靠它切到移动端布局（大按钮、安全区、窄屏面板）。
 * @returns 是否真的切成了移动端外壳
 */
export function markMobileShell() {
  if (!IS_TOUCH || !host.hasDOM) return false;
  const root = host.byId('app')?.ownerDocument?.documentElement;
  if (!root) return false;
  root.dataset.mobile = '1';
  return true;
}

/**
 * 触摸手势：交给 OrbitControls 自己处理（它内建单指旋转 / 双指缩放+平移），
 * 这里只把默认配置写死，免得以后被别处改动带偏。
 * @param controls OrbitControls（顶视模式下为 null 壳，直接返回）
 * @param TOUCH    THREE.TOUCH 常量（由调用方传入，免得本文件 import three）
 */
export function applyTouchOrbit(controls, TOUCH) {
  if (!IS_TOUCH || !controls || !TOUCH) return;
  controls.touches = {
    ONE: TOUCH.ROTATE,        // 单指拖动 = 旋转
    TWO: TOUCH.DOLLY_PAN,     // 双指 = 捏合缩放 + 同向拖动平移
  };
  // 手指行程比鼠标短，稍微放慢一点更好瞄；是否可平移仍由各模式的 pan 参数决定
  controls.rotateSpeed = 0.85;
  controls.panSpeed = 0.8;
  controls.zoomSpeed = 0.9;
}

/**
 * 「开球」键：按住开始蓄力，松手出杆（等价于桌面的空格 / 左键按住）。
 * ------------------------------------------------------------------
 * ⚠️ **桌面 / web 也要这个键**（2026-09-24 改）：以前只在触摸设备上接线
 * （`IS_TOUCH` 直接返回空实现 + CSS `display:none`），键鼠用户想出杆只能按住鼠标左键。
 * 现在两端都有：桌面是个 64px 的小圆键，移动端放大到 78px（样式见 mobile.css）。
 *
 * 长按防护（两层，缺一不可）：CSS 禁选择（mobile.css 的 -webkit-user-select）+ 这里的
 * touchstart preventDefault。原因见下面 noDefault 处的注释 —— 只做 pointerdown 那层挡不住。
 *
 * @param state     全局状态
 * @param canCharge()  当前能不能出杆（白球没进洞、没在运动、弹窗没打开）
 * @param onStart()    开始蓄力
 * @param onEnd()      松手 → 出杆
 * @param btns      要接线的按钮（默认 #btn-shoot；本地双人模式传两个，见 duo-ui.js）
 * @param canUse(btn) 可选的"这个键此刻归谁"判定（双人模式：不是当前回合就按不动）
 * @returns {{ sync() }} 每帧同步按钮可用态（置灰）
 */
export function bindShootButton({ state, canCharge, onStart, onEnd, btns, canUse }) {
  if (!host.hasDOM) return { sync() {} };
  const list = (btns || [host.byId('btn-shoot')]).filter(Boolean);
  if (!list.length) return { sync() {} };
  // 事件挂在 dock 上而不是只管按钮：手指从按钮滑到蓄力条上继续按住时也归我们管。
  // 双人模式的键带 data-player，事件根要换成 #duo-dock（挂在被藏起来的 #shoot-dock 上
  // 就等于没挂 —— 那上面现在只剩一条蓄力条）。
  const duoDock = list.some((b) => b.dataset && b.dataset.player) ? host.byId('duo-dock') : null;
  const dock = duoDock || host.byId('shoot-dock') || list[0];
  const usable = (b) => !canUse || canUse(b);

  let cached = null;
  const setEnabled = (ok) => {
    // 每个键的可用态是"全局可出杆"和"这个键归谁"两者的交集 ——
    // 所以缓存键要把逐键的结果一起算进去，否则换人时（全局 ok 没变）按钮不会刷新。
    const key = ok + '|' + list.map((b) => (ok && usable(b))).join(',');
    if (key === cached) return;
    cached = key;
    for (const b of list) b.classList.toggle('disabled', !(ok && usable(b)));
  };

  const down = (e) => {
    if (e.cancelable) e.preventDefault();      // 挡掉鼠标兼容事件 / 双指缩放
    if (state.uiBlocked || state.charging || !canCharge()) return;
    if (!usable(e.currentTarget)) return;      // 双人模式：不是你的回合，按了没反应
    for (const b of list) b.classList.add('pressed');
    onStart();
  };
  // 抬手挂在 window 上：按住后手指滑出按钮再松开，也要能正常出杆
  const up = () => {
    if (!state.charging) return;
    for (const b of list) b.classList.remove('pressed');
    onEnd();
  };
  // ⚠️ 带 data-allow-click 的元素要放行：preventDefault 会把 touchstart 之后的 click
  // 一起吞掉（浏览器不再补发鼠标事件），「🎯 自动进球」这类**点一下就走**的普通按钮
  // 放在 dock 里就再也点不动了（它跟开球键共用 dock 的响应式定位，所以只能留在这里）。
  const noDefault = (e) => {
    const t = e.target;
    if (t && t.closest && t.closest('[data-allow-click]')) return;
    if (e.cancelable) e.preventDefault();
  };

  // 长按选字必须在 touchstart 阶段就掐掉：浏览器的长按计时是**从这里**开始的，
  // 等 pointerdown 再 preventDefault 已经晚了 —— 微信里的表现就是蓄力到 30% 左右
  // 突然弹出「选择 / 复制 / 搜索」菜单，同时蓄力被打断（2026-09-18 用户实测）。
  // 必须 passive:false，否则浏览器会忽略这次 preventDefault。
  // CSS 那层 -webkit-user-select / -webkit-touch-callout 是双保险（见 mobile.css）。
  host.on(dock, 'touchstart', noDefault, { passive: false });
  host.on(dock, 'selectstart', noDefault);
  for (const b of list) host.on(b, 'pointerdown', down);
  host.on(dock, 'contextmenu', (e) => e.preventDefault());
  host.on(globalThis, 'pointerup', up);
  host.on(globalThis, 'pointercancel', up);
  // 某些内核（微信 X5）在 touchstart 被拦后不再派发 pointerup，用 touchend 兜底。
  // up() 内部靠 state.charging 幂等，重复调用没有副作用。
  host.on(globalThis, 'touchend', up);
  host.on(globalThis, 'touchcancel', up);

  return {
    sync() {
      setEnabled(!state.uiBlocked && !state.shooting && !state.charging && canCharge());
    },
  };
}
