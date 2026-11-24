import { readFileSync } from 'node:fs';
import { check } from '../lib/harness.mjs';
import { fovForAspect } from '../../src/stage.js';

/**
 * 移动端适配的回归测试（纯逻辑 / 静态资源，不需要真机）
 * ------------------------------------------------------------------
 * 真机相关的部分（触摸手势、开球键、蓄力条）只能靠手机实测，
 * 这里守住三件容易被改坏的事：
 *   ① 桌面端必须完全不受影响（IS_TOUCH 为 false 时全部降级）
 *   ② 竖屏 fov 补偿不能算出 NaN / 鱼眼
 *   ③ index.html / mobile.css 里的移动端 DOM 与规则不能被误删
 */

/** Node 里没有触摸：先打一个最小 DOM 桩，再动态载入，确保走的是"桌面"分支 */
function withStubbedDom(fn) {
  globalThis.document = { getElementById: () => null, createElement: () => ({ style: {} }) };
  return fn();
}

export async function testMobileFallback() {
  console.log('\n[24] 移动端：桌面端必须完全不受影响');
  const mobile = await withStubbedDom(() => import('../../src/mobile.js'));

  check(mobile.IS_TOUCH === false, '非触摸环境 IS_TOUCH 为 false', String(mobile.IS_TOUCH));
  check(mobile.markMobileShell() === false, '不会给 <html> 打移动端标记');

  const stub = mobile.bindShootButton({
    state: { uiBlocked: false, shooting: false, charging: false },
    canCharge: () => true,
    onStart() { throw new Error('桌面端不该触发蓄力'); },
    onEnd() { throw new Error('桌面端不该触发出杆'); },
  });
  check(typeof stub?.sync === 'function', '开球键返回可用的空实现');
  stub.sync();                                    // 不该抛
  check(true, '空实现的 sync() 不报错');

  // 手势配置：桌面传 null / 空壳也不该抛
  mobile.applyTouchOrbit(null, null);
  mobile.applyTouchOrbit({ touches: {} }, null);
  check(true, 'applyTouchOrbit 对空输入安全');
}

export function testMobileFov() {
  console.log('\n[25] 移动端：竖屏 fov 补偿');
  const wide = fovForAspect(16 / 9);
  check(Math.abs(wide - 48) < 1e-6, '16:9 保持基准 48°', `${wide.toFixed(2)}°`);
  check(fovForAspect(2.4) === 48, '更宽的屏不放大 fov', `${fovForAspect(2.4)}°`);

  const portrait = fovForAspect(393 / 873);        // 红米 K30 竖屏
  check(portrait > 48 && portrait <= 70, '竖屏放宽但有上限（不鱼眼）', `${portrait.toFixed(1)}°`);

  for (const bad of [0, -1, NaN]) {
    const v = fovForAspect(bad);
    check(v === 48, `异常宽高比 ${bad} 回落 48°`, `${v}°`);
  }
}

export function testMobileAssets() {
  console.log('\n[26] 移动端：DOM 与样式资源在位');  const html = readFileSync(new URL('../../index.html', import.meta.url), 'utf8');
  const css = readFileSync(new URL('../../src/mobile.css', import.meta.url), 'utf8');

  for (const id of ['btn-shoot', 'charge-mobile', 'charge-mobile-fill', 'charge-mobile-pct', 'shoot-dock']) {
    check(html.includes(`id="${id}"`), `index.html 有 #${id}`);
  }
  check(html.includes('viewport-fit=cover'), 'viewport 开了 viewport-fit=cover（安全区生效的前提）');
  check(html.includes('src/mobile.css'), 'index.html 引了 mobile.css');

  // 移动端规则必须全部挂在 data-mobile 下，否则会污染桌面布局
  const leaked = css.split('\n').filter((l) => /^\s*#(btn-shoot|charge-mobile|shoot-dock)\s*\{/.test(l));
  check(leaked.every((l) => !l.includes('display: flex')), '开球键默认不显示（靠 data-mobile 打开）');
  check(css.includes('html[data-mobile="1"] #shoot-dock'), '移动端才展开 #shoot-dock');
  check(css.includes('env(safe-area-inset-bottom'), '底部按钮避开手势条（safe-area-inset）');
  check(/min-height:\s*4[04]px/.test(css), '触摸目标不小于 40px');
}

/**
 * 三种模式的手势/视角管辖范围必须与 PC 一致：
 *   自由   —— 可旋转 + 可平移 + 可缩放（PC：右键 / 中键 / 滚轮；手机：单指 / 双指 / 捏合）
 *   追踪   —— 可旋转 + 可缩放，**不可平移**（PC 的中键平移本来就是 null；
 *             手机双指加平移也会被"追踪白球"的每帧 target 覆盖，看着像拖了又弹回去）
 *   顶视   —— 相机全交给脚本，轨道控制器整个关掉（正交俯视，不动）
 * 用假 controls / stage 跑，不需要浏览器。
 */
export async function testModePanRules() {
  console.log('\n[27] 模式管辖：只有自由模式能平移（追踪模式与 PC 一致）');
  const THREE = await import('three');
  const { CameraRig } = await import('../../src/camera-rig.js');
  const { BALL_R } = await import('../../src/constants.js');

  const controls = {
    enabled: false, enablePan: true, enableZoom: false,
    minDistance: 0, maxDistance: 0, maxPolarAngle: Math.PI, minPolarAngle: 0,
    mouseButtons: {}, touches: { ONE: null, TWO: null },
    target: new THREE.Vector3(0, 0.1, 0),
    update() {},
  };
  const stage = {
    controls,
    camera: { position: new THREE.Vector3(0, 2.1, 3) },
    perspCam: { position: new THREE.Vector3(0, 2.1, 3) },
    orthoCam: { position: new THREE.Vector3(0, 4, 0), zoom: 1, updateProjectionMatrix() {} },
    setActiveCamera() {},
  };
  const cue = { potted: false, body: { translation: () => ({ x: 0, y: BALL_R, z: 0 }) } };
  const state = {
    mode: 'free', shooting: false, charging: false, aimAngle: 0,
    camBack: 0.95, camTween: null, trackPhase: 'aiming', modeLocked: true,
  };
  const rig = new CameraRig(stage, state, cue);

  rig.setMode('free');
  check(controls.enablePan === true && controls.enableZoom === true,
    '自由模式：旋转 + 平移 + 缩放全开');
  check(controls.mouseButtons.MIDDLE !== null && controls.mouseButtons.RIGHT !== null,
    '自由模式：右键旋转 / 中键平移（PC 那一套没被改坏）');

  rig.setMode('tracking');
  check(controls.enablePan === false, '追踪模式：禁平移（双指不平移，与 PC 一致）');
  check(controls.enableZoom === true, '追踪模式：保留缩放（PC 滚轮 / 双指捏合）');
  check(controls.mouseButtons.MIDDLE === null, '追踪模式：PC 中键平移同样关闭');
  check(controls.touches.ONE === null && controls.touches.TWO === null,
    '桌面端完全不碰 touches 配置（触摸手势只在触摸设备上生效）');

  rig.setMode('top');
  check(controls.enabled === false, '桌面端顶视：轨道控制器整个关掉');
  check(controls.object === stage.perspCam,
    '桌面端顶视：控制对象仍是透视相机（正交相机不被接管，也就无从缩放/平移）');
}

/**
 * 顶视的"放大 + 有限平移"（仅触摸设备）
 * ------------------------------------------------------------------
 * 2026-09-18 需求：手机顶视下想放大看走位、也允许拖动，但不能把台子拖出屏幕。
 * 这里守住边界本身（纯函数），以及"最极端平移时桌心仍在屏内"这条性质 ——
 * 平移上限是外框半尺寸 × TOP.panFrac，横竖屏两个方向都要成立。
 */
export async function testTopPanBounds() {
  console.log('\n[32] 顶视手势：可放大、可平移，但台子拖不出屏幕');
  const { CameraRig, clampTopPan } = await import('../../src/camera-rig.js');
  const { orthoFrustum } = await import('../../src/stage.js');
  const { TABLE, TOP } = await import('../../src/constants.js');
  void CameraRig;

  check(TOP.zoomMin === 1, '缩放下限 = 1（整台在屏内的那套视锥，不能再缩小）');
  check(TOP.zoomMax > 1 && TOP.zoomMax <= 10, `缩放上限 ${TOP.zoomMax} 倍（合理范围）`);

  const lim = clampTopPan(1e6, 1e6);
  check(lim.x < TABLE.outerHalfL && lim.z < TABLE.outerHalfW,
    '平移上限小于球台外框半尺寸（只能推到台内，推不到台外）');
  check(clampTopPan(0, 0).x === 0 && clampTopPan(0, 0).z === 0, '中心位置不被夹动');
  check(clampTopPan(-1e6, -1e6).x === -lim.x, '反方向同样被夹住（对称）');

  // 极端平移时桌心仍在屏内：竖屏屏幕横向 = 世界 Z、纵向 = 世界 X；横屏相反
  for (const a of [0.46, 0.56, 1.0, 1.78]) {
    const f = orthoFrustum(a);
    const spanW = f.portrait ? lim.z : lim.x;
    const spanH = f.portrait ? lim.x : lim.z;
    check(Math.abs(spanW) < f.halfW && Math.abs(spanH) < f.halfH,
      `aspect ${a}（${f.portrait ? '竖' : '横'}屏）：平移到极限时桌心仍在屏内`);
  }
}

/**
 * 长按「开球」键蓄力时不得触发"选择文字 / 弹出选择菜单"
 * ------------------------------------------------------------------
 * 2026-09-18 微信内置浏览器实测：按住开球键蓄力到 30% 左右，浏览器弹出
 * 「选择 / 复制 / 搜索」菜单，同时蓄力被打断。
 *
 * 两道防线，缺一不可 —— 这个用例就是守着它们不被改回去：
 *   ① CSS：微信的 X5 / XWeb 只认带前缀的 -webkit-user-select，无前缀版本会被整个忽略；
 *      -webkit-touch-callout 负责关掉长按菜单。
 *   ② JS：长按计时是**从 touchstart 开始**的，等 pointerdown 再 preventDefault 已经晚了。
 *      而且触摸事件的 passive 默认是 true，不显式写 { passive: false }，
 *      这次 preventDefault 会被浏览器静默丢弃 —— 代码看着没问题，实际完全不生效。
 * （这里只做静态断言：Node 里没有真实触摸栈，行为验证靠无头 Chrome 的 Input.dispatchTouchEvent。）
 */
export function testShootLongPressGuard() {
  console.log('\n[31] 移动端：长按蓄力不得触发选字 / 选择菜单');
  const css = readFileSync(new URL('../../src/mobile.css', import.meta.url), 'utf8');
  const js = readFileSync(new URL('../../src/mobile.js', import.meta.url), 'utf8');

  // 只看 html[data-mobile="1"] 那条根规则内部，确认规则没被挪到别处（挪了就只对部分元素生效）
  const rootRule = css.match(/html\[data-mobile="1"\],\s*html\[data-mobile="1"\]\s*body\s*\{([\s\S]*?)\}/);
  const rootBody = rootRule ? rootRule[1] : '';
  check(!!rootRule, '找得到 html[data-mobile="1"] 的根规则');
  check(/-webkit-user-select:\s*none/.test(rootBody),
    '根规则带 -webkit-user-select:none（微信 X5/XWeb 只认带前缀的）');
  check(/[^-\w]user-select:\s*none/.test(rootBody),
    '根规则同时带无前缀 user-select:none（其它内核）');
  check(/-webkit-touch-callout:\s*none/.test(rootBody),
    '根规则带 -webkit-touch-callout:none（关掉长按菜单）');
  check(/-webkit-user-select:\s*text/.test(css), '输入类元素恢复了可选中（不会误伤输入框）');

  const btnRule = css.match(/#btn-shoot\s*\{([\s\S]*?)\}/);
  check(/-webkit-user-select:\s*none/.test(btnRule ? btnRule[1] : ''),
    '#btn-shoot 自己也带 -webkit-user-select:none');

  // passive: false 是这里最容易漏、且漏了完全看不出来的一个开关
  check(/host\.on\([^,]+,\s*'touchstart'[\s\S]{0,240}?passive:\s*false/.test(js),
    "touchstart 监听带 { passive: false }（否则 preventDefault 被静默忽略）");
  check(/'selectstart'/.test(js), '同时拦了 selectstart');
  check(/'contextmenu'/.test(js), '同时拦了 contextmenu');
  check(/'touchend'/.test(js) && /'touchcancel'/.test(js),
    'touchend / touchcancel 兜底（某些内核在 touchstart 被拦后不再派发 pointerup）');
}

