/**
 * 输入绑定：三种模式的击球 / 瞄准 / 快捷键。
 * 只负责"把事件翻译成语义回调"，具体做什么由 main 决定。
 * 鼠标与触摸的差异由 platform 层消化（host.bindPointer / host.bindKeys）。
 *
 * @param handlers {
 *   canCharge()  能否开始蓄力
 *   onChargeStart() / onChargeEnd()
 *   onPointerMove(x, y)   指针移动（蓄力条跟随 / 顶视改杆向）
 *   onTopAim(x, y)        顶视模式下按指针位置改瞄准方向
 *   onPlaceMove(x, y)     自由球模式：拖动白球（只在摆球阶段、且是"单指/左键"时触发）
 *   onReset() R 键重摆 / onToggleDebug() D 键 / onToggleHud() H 键
 * }
 */
import { host } from './platform/index.js';
import { IS_TOUCH } from './mobile.js';

export function bindInput(dom, state, handlers) {
  // uiBlocked：帮助 / 设置弹窗打开期间，指针与按键一律不落到球台上
  const isBusy = () => state.uiBlocked || state.shooting || state.charging;
  // 当前按下的键（-1 = 没按）。摆球阶段靠它区分"左键拖球"与"右键转视角"。
  let dragBtn = -1;

  host.bindPointer(dom, {
    down(x, y, button) {
      dragBtn = button;
      handlers.onPointerMove(x, y);
      // 触摸设备：单指拖动是"旋转视角"，出杆走右下角「开球」键（见 mobile.js），
      // 否则手指一放下去就在蓄力，根本没法先绕着球看一圈。
      // （摆球阶段例外：单指改成拖白球，视角交给双指 —— 见 move 里的分支）
      if (IS_TOUCH) return;
      if (button !== 0 || state.uiBlocked) return;   // 非主键交给视角控制
      if (isBusy() || !handlers.canCharge()) return;
      handlers.onChargeStart();
    },
    move(x, y, pointers) {
      handlers.onPointerMove(x, y);
      if (state.uiBlocked) return;
      // 自由球模式的摆球阶段：只有"按住主键 + 单指针"才算拖白球。
      // 其余情况一律让给相机 —— 右键拖动 / 双指捏合仍然转视角与缩放，
      // 摆球时想绕着台面看一圈不会被抢走手势。
      if (state.placingCue) {
        if (dragBtn === 0 && (pointers ?? 1) === 1) handlers.onPlaceMove(x, y);
        return;
      }
      // 顶视模式：移动/拖拽即改变杆子方向（视图本身固定）；蓄力期间锁定杆向
      if (state.mode === 'top' && !state.charging) handlers.onTopAim(x, y);
    },
    up() {
      dragBtn = -1;
      if (state.charging) handlers.onChargeEnd();
    },
  });

  host.bindKeys({
    onDown(action) {
      if (state.uiBlocked) return;
      if (action === 'strike') {
        if (!isBusy() && handlers.canCharge()) handlers.onChargeStart();
      } else if (action === 'reset') {
        handlers.onReset();
      } else if (action === 'debug') {
        handlers.onToggleDebug();
      } else if (action === 'hud') {
        handlers.onToggleHud();
      }
    },
    onUp(action) {
      if (action === 'strike' && state.charging) handlers.onChargeEnd();
    },
  });
}

/** H 键：隐藏 / 显示所有 HUD 面板（无 DOM 环境为空操作） */
export function toggleHud() {
  for (const el of host.queryAll('.hud')) {
    el.style.display = el.style.display === 'none' ? '' : 'none';
  }
}

/** 顶视瞄准：把指针位置换算成"白球 → 指针"的方位角（无效点击返回 null） */
export function topAimAngle(stage, cue, clientX, clientY) {
  const pt = stage.screenToTable(clientX, clientY);
  if (!pt) return null;                    // 射线与台面平行：这一下不算瞄准
  const p = cue.body.translation();
  const dx = pt.x - p.x, dz = pt.z - p.z;
  return dx * dx + dz * dz > 1e-6 ? Math.atan2(dx, dz) : null;
}

/** 蓄力振荡：0→1→0 三角波 */
export function chargePower(state, dt, period) {
  state.chargeT += dt;
  const phase = ((state.chargeT % period) / period) * 2;
  return phase <= 1 ? phase : 2 - phase;
}
