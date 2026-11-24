/**
 * 浏览器 / Electron 渲染进程宿主实现：有完整 DOM。
 * Electron 下额外通过 preload 注入的 window.__electron 提供全屏、退出等桌面能力。
 */
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';

/** code → 语义动作 */
const KEY_MAP = {
  Space: 'strike',
  KeyR: 'reset',
  KeyD: 'debug',
  KeyH: 'hud',
};

/**
 * 本地存储：桌面端优先走主进程落盘（userData/settings.json），
 * 因为 file:// 页面在 Chromium 里属不透明源，localStorage 可能直接抛错；
 * 网页端则用 localStorage。两者对调用方是同一套 get/set 接口。
 */
function makeStorage(win) {
  const bridge = win.__electron?.settings;
  if (bridge) {
    return {
      get(k, d) {
        try {
          const s = bridge.get(k);
          return s ? JSON.parse(s) : d;
        } catch {
          return d;
        }
      },
      set(k, v) {
        try { bridge.set(k, JSON.stringify(v)); } catch { /* 落盘失败不该影响游戏 */ }
      },
    };
  }
  return {
    get(k, d) {
      try {
        const v = win.localStorage.getItem(k);
        return v === null ? d : JSON.parse(v);
      } catch {
        return d;
      }
    },
    set(k, v) {
      try { win.localStorage.setItem(k, JSON.stringify(v)); } catch { /* 隐私模式下可能抛错，忽略 */ }
    },
  };
}

export function webHost() {
  const win = globalThis;
  const doc = win.document;
  const desktop = !!win.__electron;

  return {
    env: desktop ? 'electron' : 'web',
    hasDOM: true,
    desktop,
    // 主输入设备是手指（手机 / 平板）：视角走手势、出杆走开球键。
    // 桌面 Electron 一律 false —— 触屏 Windows 笔记本不该被当成手机。
    touch: !desktop && (!!win.matchMedia?.('(pointer: coarse)').matches
      || (win.navigator?.maxTouchPoints || 0) > 0),

    canvas(w, h) {
      const c = doc.createElement('canvas');
      c.width = w;
      c.height = h;
      return c;
    },

    mount(el) {
      const app = doc.getElementById('app');
      if (app && el) app.appendChild(el);
      return app;
    },

    // ⚠️ 用 doc?. 兜底：能力清单里写的是"无 DOM 返回 null"，而 Node 下跑无头测试时
    // 拿到的就是 webHost（没有 document）。以前靠各个调用方自己判断环境挡着，
    // 一旦某个调用方少挡一层就崩在这（bindShootButton 就踩过一次）。
    byId(id) {
      return doc?.getElementById(id) ?? null;
    },

    queryAll(sel) {
      return doc ? Array.from(doc.querySelectorAll(sel)) : [];
    },

    createElement(tag) {
      return doc.createElement(tag);
    },

    viewport() {
      return {
        w: win.innerWidth,
        h: win.innerHeight,
        dpr: Math.min(win.devicePixelRatio || 1, 2),
      };
    },

    onResize(cb) {
      win.addEventListener('resize', cb);
    },

    on(el, type, cb, opts) {
      el?.addEventListener(type, cb, opts);
    },

    /**
     * 鼠标/触摸统一为 down(x, y, button) / move(x, y, pointers) / up()
     * ------------------------------------------------------------------
     * 第三个参数 = 当前还按着的指针数（1 = 单指或单键，2 = 双指）。
     * 自由球模式摆白球时要靠它分手势：单指/左键 = 拖球，双指 = 转视角 + 缩放
     * （只传 button 分不出来 —— 触摸的第二根手指 button 同样是 0）。
     */
    bindPointer(el, h) {
      if (!el) return;
      const active = new Set();
      el.addEventListener('pointerdown', (e) => {
        active.add(e.pointerId);
        h.down(e.clientX, e.clientY, e.button);
      });
      el.addEventListener('pointermove', (e) => {
        h.move(e.clientX, e.clientY, active.size || 1);
      });
      // 抬起挂在 window 上：拖到画布外松手也要能出杆
      const clear = (e) => { active.delete(e.pointerId); };
      win.addEventListener('pointerup', clear);
      win.addEventListener('pointercancel', clear);
      win.addEventListener('pointerup', () => h.up());
    },

    bindKeys(h) {
      win.addEventListener('keydown', (e) => {
        const a = KEY_MAP[e.code];
        if (!a) return;
        e.preventDefault();
        h.onDown(a);
      });
      win.addEventListener('keyup', (e) => {
        const a = KEY_MAP[e.code];
        if (a) h.onUp(a);
      });
    },

    createOrbit(cam, dom) {
      return new OrbitControls(cam, dom);
    },

    raf(cb) {
      return win.requestAnimationFrame(cb);
    },

    /** 页间跳转（游戏 ↔ 启动器）；小游戏无多页概念，那边是空实现 */
    goto(page) {
      win.location.href = page;
    },

    storage: makeStorage(win),

    toggleFullscreen() {
      win.__electron?.toggleFullscreen?.();
    },

    quit() {
      win.__electron?.quit?.();
    },

    /** 挂一个全局调试钩子（端到端测试 / 浏览器控制台排查用） */
    expose(name, obj) {
      try { win[name] = obj; } catch { /* 无 window 就算了 */ }
    },
  };
}
