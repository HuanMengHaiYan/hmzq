/**
 * 杆法盘（击球点选择器）
 * ------------------------------------------------------------------
 * 按住开球键 → 左下角出现一个圆盘，盘里的红点就是**击球点**：拖到哪儿，杆就打在白球的那个位置。
 * 拖到边缘（最上 / 最下 / 最左 / 最右）就是极端杆法，打出去是旋转球。
 *
 * 归一化坐标（写进 state.spinX / state.spinY，由 shot.js 的 spinAngular 换算成角速度）：
 *   x = −1 左塞 · +1 右塞        y = −1 低杆（回旋）· +1 高杆
 *   拖出圆外自动按半径钳住（长度 ≤ 1），所以斜向拖到底也只是"最大塞 + 最大高低杆"。
 *
 * 三条操作路径，覆盖三种输入设备：
 *   ① 触摸 / 鼠标按住圆盘拖     —— 第二根手指也行（不抢开球键那一根，见 mobile.js 的 pointerId）
 *   ② 蓄力期间鼠标划过圆盘      —— 桌面"按住开球按钮、鼠标移过来"也能调（不用再按一下）
 *   ③ 蓄力期间按方向键          —— 键鼠党不想碰鼠标时的路（1 帧 0.06，长按连续）
 *
 * ⚠️ 为什么红点能在"球心以外"移动：真实球杆打到太靠边会滑杆（miscue，约 0.62R 之外），
 *    所以圆盘半径画成**可击范围**，拖到盘边 = 打到极限位置（增益里已经含了 0.62 这个系数）。
 * ⚠️ 红点位置是**粘住**的（下一杆沿用），双击圆盘回中、重开本局也会回中 ——
 *    这是 8 Ball Pool 那类游戏的习惯：连续用同一套杆法走位时不必每杆重拖。
 */
import { host } from './platform/index.js';

const KEY_STEP = 0.06;          // 方向键每一帧挪动的归一化距离
const RESET_DPR = 24;           // 双击判定（像素，两次 pointerup 的间隔与位移都要小于它）

export class SpinPad {
  /**
   * @param state 全局状态（写 state.spinX / state.spinY）
   * @param opts.touch 是否触摸设备（决定盘的大小，样式层面其实由 CSS 管）
   */
  constructor(state) {
    this.state = state;
    this.ready = false;
    if (!host.hasDOM) return;             // 无 DOM 环境（小游戏壳）整体不参与
    this.pad = host.byId('spin-pad');
    this.ring = host.byId('spin-ring');
    this.dot = host.byId('spin-dot');
    if (!this.pad || !this.ring || !this.dot) return;
    this.ready = true;
    this.dragId = null;                   // 正在拖盘的 pointerId（多指安全）
    this.lastTap = 0;
    this.lastTapX = 0;
    this.lastTapY = 0;
    this.#wire();
    this.render();
  }

  get x() { return this.state.spinX || 0; }
  get y() { return this.state.spinY || 0; }

  /* ---------------- 对外 ---------------- */

  /**
   * 开始蓄力：盘淡入。
   * @param cx/cy 按下点的屏幕坐标 —— 桌面在**鼠标位置**生成摇杆（按下哪里盘就出现在哪里，
   *              蓄力期间鼠标就在盘心，划一下就选定击球点，不用满屏找盘）。
   *              不传（触摸端 / 键盘蓄力）沿用 CSS 的固定位置：左下角，避开右下角开球键 ——
   *              触摸的手指正按在键上，盘盖在手指底下既看不见也拖不了。
   */
  show(cx, cy) {
    if (!this.ready) return;
    if (cx != null && cy != null) this.#placeAt(cx, cy);
    else this.#clearPlace();
    this.pad.classList.add('show');
    this.pad.setAttribute('aria-hidden', 'false');
    // 盘在隐藏时量不到尺寸（窄屏 / 旋转屏会换样式），露出来这一刻补画一次
    this.render();
  }

  /** 出杆 / 取消蓄力：盘淡出（红点位置留着，下一杆沿用） */
  hide() {
    if (!this.ready) return;
    this.pad.classList.remove('show');
    this.pad.setAttribute('aria-hidden', 'true');
    this.dragId = null;
  }

  /** 回中（双击盘 / 重开本局） */
  reset() {
    this.#write(0, 0);
  }

  /** 蓄力期间的方向键微调（由 main.js 每帧喂进来：dx / dy 为 −1 / 0 / 1） */
  nudge(dx, dy) {
    if (!dx && !dy) return;
    this.#write(this.x + dx * KEY_STEP, this.y + dy * KEY_STEP);
  }

  /**
   * 把红点画到当前偏移处（初始化与外部改 state 后调用）。
   * ⚠️ 用 **transform 的像素位移**而不是 left/top 百分比：圆盘有 2px 边框，
   *    百分比是相对 padding box 算的，换算容易差几个像素；而且 transform 不会触发重排。
   *    行程取盘半径的 0.76 —— 红点自己有直径（18+2×2），铺满半径会让它探出盘外。
   */
  render() {
    if (!this.ready) return;
    const w = this.ring.clientWidth || this.ring.getBoundingClientRect().width || 84;
    const rad = w / 2;
    const tx = this.x * rad * 0.76;
    const ty = -this.y * rad * 0.76;
    this.dot.style.transform = `translate(-50%, -50%) translate(${tx.toFixed(1)}px, ${ty.toFixed(1)}px)`;
  }

  /* ---------------- 内部 ---------------- */

  /** 把盘挪到按下点（居中对齐；钳在屏幕内，别让盘探出窗口）。不碰 transform —— 淡入动画在用它。 */
  #placeAt(cx, cy) {
    const pad = this.pad;
    const w = pad.offsetWidth || 84;
    const h = pad.offsetHeight || 110;                 // 圆盘 + 下面那行「击球点」小字
    const m = 8;                                       // 屏幕边缘留白
    const vw = globalThis.innerWidth || 1280;
    const vh = globalThis.innerHeight || 800;
    const x = Math.min(Math.max(cx, w / 2 + m), vw - w / 2 - m);
    const y = Math.min(Math.max(cy, h / 2 + m), vh - h / 2 - m);
    pad.style.left = `${(x - w / 2).toFixed(0)}px`;
    pad.style.top = `${(y - h / 2).toFixed(0)}px`;
    pad.style.bottom = 'auto';
  }

  /** 清掉位置覆盖，回到 CSS 的固定位置（触摸端路径） */
  #clearPlace() {
    const pad = this.pad;
    pad.style.left = '';
    pad.style.top = '';
    pad.style.bottom = '';
  }

  #wire() {
    const pad = this.pad;
    // 手指拖盘不能让浏览器抢去滚动 / 选中（微信长按还会弹选择菜单）
    host.on(pad, 'touchstart', (e) => { if (e.cancelable) e.preventDefault(); }, { passive: false });
    host.on(pad, 'contextmenu', (e) => e.preventDefault());

    host.on(pad, 'pointerdown', (e) => {
      if (e.cancelable) e.preventDefault();
      this.dragId = e.pointerId;
      // 指针捕获只是为了"手指拖出圆盘后仍然归我管"；某些内核（老 WebView / 合成事件）
      // 会因为没有活动指针而抛 NotFoundError，包一层别让它打断后面的定位。
      try { pad.setPointerCapture?.(e.pointerId); } catch { /* 捕获失败就退化成普通拖拽 */ }
      this.#fromPointer(e.clientX, e.clientY);
    });

    host.on(pad, 'pointermove', (e) => {
      if (this.dragId === null) return;      // 没按着就不跟（鼠标划过的那条路在 window 上）
      if (e.pointerId !== this.dragId) return;
      this.#fromPointer(e.clientX, e.clientY);
    });

    const end = (e) => {
      if (this.dragId === null || (e.pointerId != null && e.pointerId !== this.dragId)) return;
      this.dragId = null;
      try { pad.releasePointerCapture?.(e.pointerId); } catch { /* 同上 */ }
      // 双击回中：两次抬手间隔 < 280ms、位移 < 24px
      const now = Date.now();
      if (now - this.lastTap < 280 &&
        Math.abs(e.clientX - this.lastTapX) < RESET_DPR &&
        Math.abs(e.clientY - this.lastTapY) < RESET_DPR) {
        this.reset();
        this.lastTap = 0;
      } else {
        this.lastTap = now;
        this.lastTapX = e.clientX;
        this.lastTapY = e.clientY;
      }
    };
    host.on(pad, 'pointerup', end);
    host.on(pad, 'pointercancel', end);

    // ③ 蓄力期间方向键微调（键鼠党不用碰鼠标；按住不放由系统的按键重复驱动）
    host.on(globalThis, 'keydown', (e) => {
      if (!this.state.charging) return;
      const k = e.key;
      let dx = 0, dy = 0;
      if (k === 'ArrowUp') dy = 1;
      else if (k === 'ArrowDown') dy = -1;
      else if (k === 'ArrowLeft') dx = -1;
      else if (k === 'ArrowRight') dx = 1;
      else return;
      if (e.cancelable) e.preventDefault();     // 别让方向键去滚页面
      this.nudge(dx, dy);
    });

    // ② 蓄力期间鼠标划过圆盘就跟着走（桌面按住「开球」按钮时，鼠标没法再按一下盘）
    host.on(globalThis, 'pointermove', (e) => {
      if (this.dragId !== null) return;
      if (!this.state.charging) return;
      if (e.pointerType !== 'mouse') return;      // 触摸必须按下才算，否则手指路过就改杆法
      if (!this.#inside(e.clientX, e.clientY)) return;
      this.#fromPointer(e.clientX, e.clientY);
    });
  }

  #inside(cx, cy) {
    const r = this.ring.getBoundingClientRect();
    const dx = cx - (r.left + r.width / 2);
    const dy = cy - (r.top + r.height / 2);
    return Math.hypot(dx, dy) <= r.width / 2;
  }

  /** 屏幕坐标 → 归一化击球点（长度钳到 1；屏幕 y 向下，所以取反） */
  #fromPointer(clientX, clientY) {
    const r = this.ring.getBoundingClientRect();
    const rad = r.width / 2 || 1;
    let nx = (clientX - (r.left + rad)) / rad;
    let ny = -(clientY - (r.top + rad)) / rad;
    const len = Math.hypot(nx, ny);
    if (len > 1) { nx /= len; ny /= len; }
    this.#write(nx, ny);
  }

  #write(x, y) {
    const len = Math.hypot(x, y);
    if (len > 1) { x /= len; y /= len; }        // 拖出圆外按半径钳住
    // 浮点抖动会让"回中"判不出 0，这里按 0.02 一格吸附
    const snap = (v) => Math.round(v / 0.02) * 0.02;
    this.state.spinX = Math.max(-1, Math.min(1, snap(x)));
    this.state.spinY = Math.max(-1, Math.min(1, snap(y)));
    this.render();
  }
}
