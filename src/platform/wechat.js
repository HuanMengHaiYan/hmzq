/**
 * 微信小游戏宿主实现（第二阶段预留，尚未真机验证）
 * ------------------------------------------------------------------
 * 接入时需要做的事（都在这一层内，游戏核心不用改）：
 *   1. 入口：小游戏 game.js 里调用与 main.js 相同的装配流程，本 host 自动生效
 *      （探测依据是全局 wx + getSystemInfoSync）。
 *   2. 画布：wx.createCanvas() 首次调用返回上屏 canvas，Three.js 的 WebGLRenderer
 *      需传 { canvas } 而不是自己建；Stage 已改为 host.mount() 挂载。
 *   3. UI：小游戏没有 DOM，byId/queryAll/createElement 均返回空值，
 *      Hud 与 settings 会自动降级；真要做界面需另写 canvas 自绘版 HUD
 *      （接口与 Hud 类对齐即可，main.js 不用动）。
 *   4. 资源：贴图是程序化生成的（textures.js 用 host.canvas），无需网络加载，
 *      因此不受小游戏包体/资源限制影响；rapier 的 wasm 是内联 base64，可用。
 *   5. 触摸：只有 Touch，没有右键 —— 视角旋转需另给方案（如双指手势 / 顶视按钮）。
 *
 * ⚠️ keyCode 映射表为按 Android 键盘常见值填写，真机需校准。
 */

/** 小游戏键盘 keyCode → 语义动作（待真机校准） */
const KEYCODE_MAP = {
  32: 'strike',   // 空格
  82: 'reset',    // R
  68: 'debug',    // D
  72: 'hud',      // H
};

export function wechatHost() {
  const wx = globalThis.wx;
  const sys = wx.getSystemInfoSync();

  return {
    env: 'wechat',
    hasDOM: false,
    desktop: false,
    touch: true,              // 小游戏只有触摸

    canvas(w, h) {
      const c = wx.createCanvas();
      c.width = w;
      c.height = h;
      return c;
    },

    /** 小游戏主画布自动上屏，无需挂载 */
    mount() {
      return null;
    },

    byId() {
      return null;
    },

    queryAll() {
      return [];
    },

    createElement() {
      return null;
    },

    viewport() {
      return {
        w: sys.windowWidth || sys.screenWidth,
        h: sys.windowHeight || sys.screenHeight,
        dpr: Math.min(sys.pixelRatio || 2, 2),
      };
    },

    onResize(cb) {
      wx.onWindowResize?.((res) => {
        sys.windowWidth = res.windowWidth;
        sys.windowHeight = res.windowHeight;
        cb(res);
      });
    },

    on(_el, _type, _cb) {
      // 无 DOM：忽略（小游戏事件走 wx.onTouch* / wx.onKey*）
    },

    bindPointer(_el, h) {
      wx.onTouchStart((e) => {
        const t = e.touches[0] || e.changedTouches[0];
        if (t) h.down(t.clientX, t.clientY, 0);
      });
      wx.onTouchMove((e) => {
        const t = e.touches[0];
        // 第三参 = 当前触点数（1 = 单指拖球，2 = 双指转视角 / 缩放），见 web.js 的同名注释
        if (t) h.move(t.clientX, t.clientY, e.touches.length || 1);
      });
      wx.onTouchEnd(() => h.up());
    },

    bindKeys(h) {
      wx.onKeyDown?.((e) => {
        const a = KEYCODE_MAP[e.keyCode];
        if (a) h.onDown(a);
      });
      wx.onKeyUp?.((e) => {
        const a = KEYCODE_MAP[e.keyCode];
        if (a) h.onUp(a);
      });
    },

    /** 小游戏 canvas 没有完整 DOM 事件，OrbitControls 暂不可用 → 相机全部由脚本接管 */
    createOrbit() {
      return null;
    },

    raf(cb) {
      return globalThis.requestAnimationFrame(cb);
    },

    /** 小游戏是单页运行环境，没有"返回主菜单"这种跳转（菜单需自己做一层 canvas 界面） */
    goto() { /* 空实现 */ },

    storage: {
      get(k, d) {
        try {
          const v = wx.getStorageSync(k);
          return v === '' || v === undefined ? d : v;
        } catch {
          return d;
        }
      },
      set(k, v) {
        try {
          wx.setStorageSync(k, v);
        } catch { /* 超容量时忽略 */ }
      },
    },

    toggleFullscreen() { /* 小游戏恒为全屏 */ },

    quit() {
      wx.exitMiniProgram?.();
    },

    /** 小游戏没有全局可挂（真机调试用 wx.setEnableDebug），空实现 */
    expose() { /* noop */ },
  };
}
