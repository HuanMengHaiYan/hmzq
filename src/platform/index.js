/**
 * 平台适配层（第二阶段：为微信小游戏预留）
 * ------------------------------------------------------------------
 * 目标：游戏核心（layout / sim / table / balls / state / shot / pockets /
 * camera-rig / aimer / constants）**不引用任何宿主 API**，因此同一份核心可以跑在
 *   ① 浏览器 / Electron 渲染进程 —— 有 DOM、鼠标、键盘
 *   ② 微信小游戏 —— 无 DOM，只有 wx canvas + 触摸
 *
 * 外壳（stage / hud / input / settings / textures / main）一律通过 host 访问宿主，
 * 不直接写 document / window / wx。
 *
 * host 能力清单（任何实现都必须提供，缺失时返回空值让调用方降级）：
 *   env / hasDOM / desktop          环境标志
 *   canvas(w, h)                    离屏画布（程序化生成贴图用）
 *   mount(el)                       把渲染画布挂到页面（无 DOM 时为空操作）
 *   byId(id) / queryAll(sel)        取 UI 元素（无 DOM 返回 null / []）
 *   createElement(tag)              建元素（无 DOM 返回 null）
 *   viewport()                      { w, h, dpr }
 *   onResize(cb) / on(el, type, cb) 尺寸与事件
 *   bindPointer(el, h)              统一鼠标与触摸：down(x,y,button) / move(x,y) / up()
 *   bindKeys(h)                     语义按键：onDown(action) / onUp(action)
 *   createOrbit(cam, dom)           轨道控制器（不支持时返回 null）
 *   raf(cb)                         帧回调
 *   goto(page)                      页间跳转（游戏 ↔ 启动器）
 *   storage.get(k, d) / set(k, v)   本地存储
 *   toggleFullscreen() / quit()     桌面外壳专用
 *   expose(name, obj)               挂一个全局调试钩子（无 DOM 时为空操作）
 *
 * 按键 action 语义名：strike（出杆/空格）、reset（重摆/R）、debug（线框/D）、hud（面板/H）
 */
import { webHost } from './web.js';
import { wechatHost } from './wechat.js';

/** 微信小游戏：全局有 wx 且带 getSystemInfoSync */
function detectWechat() {
  const wx = globalThis.wx;
  return !!wx && typeof wx.getSystemInfoSync === 'function';
}

export const host = detectWechat() ? wechatHost() : webHost();

/** 是否具备 DOM UI（无 DOM 时 HUD / 设置面板需走降级实现） */
export const HAS_DOM = host.hasDOM;
