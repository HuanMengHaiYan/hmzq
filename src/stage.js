import * as THREE from 'three';
import { BALL_R, TABLE, TOP } from './constants.js';
import { host } from './platform/index.js';

/**
 * 渲染舞台：渲染器 / 场景 / 双相机 / 轨道控制 / 灯光 / 环境 / 物理调试线框。
 * 只负责"把东西画出来"，不含任何玩法逻辑。
 */
export class Stage {
  constructor() {
    this.timer = new THREE.Timer();

    const vp0 = host.viewport();
    this.renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(vp0.dpr);
    this.renderer.setSize(vp0.w, vp0.h);
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFShadowMap;   // PCFSoftShadowMap 自 r185 起已废弃
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    // 亮度标定（0.8.0 换真实模型后调了三次）：以 docs/model-shots 固定机位图的**近白像素占比**为准，
    // 不看"感觉"。1.15 时俯视台呢 80% 像素亮度 > 200（整片发白）→ 0.94 → 0.82 仍偏白 → 0.68
    // 降到 57%。再配合下面四路光一起收（半球 / 环境 / 主光 / 补光），比例保持不动，只改总体亮度。
    this.renderer.toneMappingExposure = 0.68;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    host.mount(this.renderer.domElement);
    // 移除右键默认菜单：OrbitControls 仅在 enabled 时拦截 contextmenu，
    // 而顶视/蓄力时 enabled 为 false，需自行拦截
    host.on(this.renderer.domElement, 'contextmenu', (e) => e.preventDefault());

    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x0a0d12);
    this.scene.fog = new THREE.Fog(0x0a0d12, 4.5, 12);

    const aspect = vp0.w / vp0.h;
    this.perspCam = new THREE.PerspectiveCamera(48, aspect, 0.02, 60);
    this.perspCam.fov = fovForAspect(aspect);   // 竖屏手机：fov 放宽，否则只看得到台面中间一条
    this.perspCam.position.set(0, 2.1, 3.0);          // 初始：全局俯瞰视野
    this.orthoCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.01, 20);
    this.orthoCam.position.set(0, TOP.camY, 0);
    this.orthoCam.lookAt(0, 0, 0);
    this.camera = this.perspCam;                       // 当前激活相机（按模式切换）

    // 无 DOM 环境（微信小游戏）没有 OrbitControls → 换成空壳，相机全部由 CameraRig 脚本接管
    this.controls = host.createOrbit(this.perspCam, this.renderer.domElement) || nullControls();
    this.controls.target.set(0, 0.1, 0);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.08;
    this.controls.enabled = false;                     // 默认进入追踪模式：相机由脚本接管
    this.controls.update();

    this.lampShades = [];
    this.lampWanted = true;            // 模式是否要求显示灯罩（顶视 / 竖屏会自动再藏掉）
    this.shadowLights = [];            // 会投影的灯（画质设置改阴影精度时要用）
    this.onDemandShadows = false;      // 是否"世界不动就不重画 shadow map"（Quality 打开）
    this.shadowHold = 0;               // 动过之后再保持重画几帧，避免停稳那一两帧漏画
    this.#setupLights();
    this.#setupRoom();
    this.#setupDebug();

    this.raycaster = new THREE.Raycaster();
    this._pointer = new THREE.Vector2();
    this._tablePlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), -BALL_R);

    this.updateOrthoFrustum();
    host.onResize(() => this.resize());
  }

  get domElement() { return this.renderer.domElement; }

  /** 当前视口宽高比（< 1 = 竖屏，机位与正交视锥都靠它切分支） */
  get aspect() { return this.perspCam.aspect; }

  /** 当前是不是竖屏（宽高比 < 1）—— 机位、正交视锥、灯罩可见性都用它 */
  get portrait() { return isPortrait(this.aspect); }

  /** 当前透视相机 fov（度）—— 竖屏机位要按它反解相机距离 */
  get fov() { return this.perspCam.fov; }

  /** 本帧时长（上限 50ms，避免切标签页回来后物理一次性追赶） */
  delta() {
    this.timer.update();
    return Math.min(this.timer.getDelta(), 0.05);
  }

  /** 切换激活相机：'persp'（自由/追踪）| 'ortho'（顶视）*/
  setActiveCamera(kind) {
    this.camera = kind === 'ortho' ? this.orthoCam : this.perspCam;
    return this.camera;
  }

  /** 顶视是正上方正交俯视，头顶灯罩会变成两个大黑块挡住台面 → 只在非顶视时显示 */
  setLampVisible(v) {
    this.lampWanted = !!v;
    this.#applyLamps();
  }

  /**
   * 灯罩的最终可见性 = 模式要求 ∧ 不是竖屏。
   * 竖屏的俯瞰机位是"从白球那端俯看整台"（见 camera-rig 的 overviewPose），
   * 灯罩正好悬在台面中央、变成一块黑饼压在球堆上 —— 和顶视是同一个问题，一并藏掉。
   * 灯本身（SpotLight）不受影响，台面亮度与阴影都不变。
   */
  #applyLamps() {
    const on = this.lampWanted && !this.portrait;
    for (const s of this.lampShades) s.visible = on;
  }

  /**
   * 把屏幕坐标投影到球心所在水平面，返回世界坐标点（顶视瞄准 / 自由球模式拖白球用）。
   * 射线与台面平行时返回 null —— 未命中时 pt 会保持 (0,0,0)，
   * 那种情况下让调用方当成"这一点不能放"比"把球摆到台面中心"正确得多。
   */
  screenToTable(clientX, clientY) {
    const { w, h } = host.viewport();
    this._pointer.x = (clientX / w) * 2 - 1;
    this._pointer.y = -(clientY / h) * 2 + 1;
    this.raycaster.setFromCamera(this._pointer, this.camera);
    const pt = new THREE.Vector3();
    return this.raycaster.ray.intersectPlane(this._tablePlane, pt) ? pt : null;
  }

  /** 调试线框开关（D 键）：同时显形 6 个袋口传感器 */
  toggleDebug(sensors) {
    const on = !this.debugLines.visible;
    this.debugLines.visible = on;
    for (const s of sensors) {
      s.ghost.material.visible = on;
      s.ghost.material.opacity = on ? 0.35 : 0;
      s.ghost.material.transparent = true;
    }
    return on;
  }

  updateDebug(world) {
    if (!this.debugLines.visible) return;
    const { vertices, colors } = world.debugRender();
    this.debugLines.geometry.setAttribute('position', new THREE.BufferAttribute(vertices, 3));
    this.debugLines.geometry.setAttribute('color', new THREE.BufferAttribute(colors, 4));
  }

  resize() {
    const { w, h } = host.viewport();
    this.perspCam.aspect = w / h;
    this.perspCam.fov = fovForAspect(this.perspCam.aspect);
    this.perspCam.updateProjectionMatrix();
    this.updateOrthoFrustum();
    this.#applyLamps();              // 转屏会改变"是不是竖屏"，灯罩跟着
    this.renderer.setSize(w, h);
    this.requestShadowUpdate();       // 尺寸变了：立刻重画一帧阴影，别留旧图
  }

  /**
   * 顶视正交视锥 + 相机朝向：任何宽高比下都保证**整张球台**（含木框、袋口收口环）完整在屏内。
   * 竖屏时整个视野绕 Y 轴转 90°（正交相机的 up 轴改为世界 X）—— 台长竖进屏幕才够大，
   * 具体算式在 orthoFrustum()（纯函数，浏览器与测试共用同一份）。
   */
  updateOrthoFrustum() {
    const { w, h } = host.viewport();
    const f = orthoFrustum(w / h);
    Object.assign(this.orthoCam, { left: -f.halfW, right: f.halfW, top: f.halfH, bottom: -f.halfH });
    // 相机在正上方俯视：屏幕的"上"由 up 轴决定。竖屏把 up 指到 +X，
    // 于是台长（世界 X）竖着排、摆球架那头朝上（白球在下、目标球在上，出杆自然向上）。
    if (f.portrait) this.orthoCam.up.set(1, 0, 0);
    else this.orthoCam.up.set(0, 1, 0);
    // 看向"自己正下方"，而不是世界原点 —— 顶视允许平移后相机会离开原点正上方，
    // 若仍 lookAt(0,0,0)，视线就斜了（转屏重算视锥那一刻会明显歪一下）。
    const p = this.orthoCam.position;
    this.orthoCam.lookAt(p.x, 0, p.z);
    this.orthoCam.updateProjectionMatrix();
  }

  /** 请求重画一次 shadow map（改画质 / 重开一局 / 尺寸变化时调用） */
  requestShadowUpdate(frames = 2) {
    this.shadowHold = Math.max(this.shadowHold, frames);
    this.renderer.shadowMap.needsUpdate = true;
  }

  /**
   * 阴影按需刷新（画质设置默认开）。
   * shadow map 只跟"灯 + 场景里会投影的物体"有关，跟相机无关 —— 所以球和球杆都不动时，
   * 每帧重画那 2048² × 2 盏灯（839 万像素）是纯浪费。由主循环告知"这一帧世界动了吗"。
   * @param dirty 球在动 / 杆在动 / 刚发生过变化
   */
  setOnDemandShadows(on) {
    this.onDemandShadows = !!on;
    this.renderer.shadowMap.autoUpdate = !on;
    this.requestShadowUpdate();
  }

  updateShadows(dirty) {
    if (!this.onDemandShadows) return;
    if (dirty) return this.requestShadowUpdate();
    if (this.shadowHold > 0) this.requestShadowUpdate(this.shadowHold - 1);
  }

  render() {
    this.renderer.render(this.scene, this.camera);
  }

  /**
   * 释放渲染资源（0.7.0，体检 B5）。
   * ------------------------------------------------------------------
   * 网页 / Electron 里"返回主菜单"是整页跳转，文档销毁时一切都跟着回收，本来无事；
   * 但 Capacitor 壳的 WebView 可能复用同一个渲染进程，反复"进游戏 → 返回 → 再进"
   * 会累积 WebGL 上下文与 GPU 资源。页面卸载（pagehide）时调一次：
   * 停轨道控制、释放几何体与材质、销毁渲染器。
   */
  dispose() {
    try { this.controls?.dispose?.(); } catch { /* 空壳 / 已释放 */ }
    this.scene.traverse((obj) => {
      const m = obj.material;
      if (Array.isArray(m)) m.forEach((x) => x?.dispose?.());
      else m?.dispose?.();
      obj.geometry?.dispose?.();
    });
    this.renderer.dispose();
  }

  #setupLights() {
    this.scene.add(new THREE.HemisphereLight(0x93a7c4, 0x141a20, 0.22));
    this.scene.add(new THREE.AmbientLight(0xffffff, 0.055));

    for (const x of [-0.72, 0.72]) {
      const spot = new THREE.SpotLight(0xfff2dc, 21, 7, 0.95, 0.55, 2);
      spot.position.set(x, 1.85, 0);
      spot.target.position.set(x * 0.5, 0, 0);
      spot.castShadow = true;
      spot.shadow.mapSize.set(2048, 2048);
      spot.shadow.bias = -0.0004;
      spot.shadow.camera.near = 0.3;
      spot.shadow.camera.far = 4;
      this.scene.add(spot, spot.target);
      this.shadowLights.push(spot);

      const shade = new THREE.Mesh(
        new THREE.ConeGeometry(0.17, 0.16, 24, 1, true),
        new THREE.MeshStandardMaterial({ color: 0x2a2f36, roughness: 0.6, side: THREE.DoubleSide })
      );
      shade.position.set(x, 1.9, 0);
      shade.name = 'lamp-shade';
      this.scene.add(shade);
      this.lampShades.push(shade);
    }

    const fill = new THREE.DirectionalLight(0xaecbff, 0.095);
    fill.position.set(-3, 2.5, -2.5);
    this.scene.add(fill);
  }

  #setupRoom() {
    const floor = new THREE.Mesh(
      new THREE.PlaneGeometry(24, 24),
      new THREE.MeshStandardMaterial({ color: 0x14181e, roughness: 1 })
    );
    floor.rotation.x = -Math.PI / 2;
    floor.position.y = TABLE.trayY;
    floor.receiveShadow = true;
    this.scene.add(floor);
    this.floor = floor;
  }

  /**
   * 把地面挪到指定高度（0.8.0：换成真实比例的 GLB 桌面后要用）。
   * 参数化桌面的桌腿只到 y = -0.62，地面正好压在那里；而真实 9 尺台的台面高 800mm，
   * 击球面还在 y = 0 的话桌腿会伸到 -0.75 —— 不下移地面就会看到六条腿插进地板里。
   * 只动可视地面，物理的落球盘（TABLE.trayY）保持不变。
   */
  setFloorY(y) {
    if (!this.floor || !Number.isFinite(y)) return;
    this.floor.position.y = y;
  }

  #setupDebug() {
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(0), 3));
    geo.setAttribute('color', new THREE.BufferAttribute(new Float32Array(0), 4));
    this.debugLines = new THREE.LineSegments(
      geo,
      new THREE.LineBasicMaterial({ vertexColors: true, transparent: true, opacity: 0.9 })
    );
    this.debugLines.visible = false;
    this.debugLines.frustumCulled = false;
    this.scene.add(this.debugLines);
  }
}

/**
 * 竖屏手机（aspect < 1）时放宽垂直 fov。
 * 桌面 16:9 下是 48°，手机竖屏的 aspect 只有 0.45 左右 —— 不补偿的话水平视野
 * 会窄到只看得见台面中间一条。这里保持"16:9 时的水平视野"不变，
 * 上限 70° 是为了不让它变成鱼眼（竖屏本来就装不下横向的球台，够看即可）。
 */
const BASE_FOV = 48;
const BASE_ASPECT = 16 / 9;

/**
 * 竖屏判定：视口宽高比 < 1 就当竖屏。
 * 竖屏不是"缩小版的横屏"—— 球台是横长条，竖屏里必须转 90° 摆（长边顺着屏幕长边），
 * 所以机位（camera-rig）、正交视锥（orthoFrustum）、灯罩可见性都按它切分支。
 */
export function isPortrait(aspect) {
  return Number.isFinite(aspect) && aspect > 0 && aspect < 1;
}

/** 导出供测试用：给定宽高比返回应该用的垂直 fov（度） */
export function fovForAspect(aspect) {
  if (!(aspect > 0) || aspect >= BASE_ASPECT) return BASE_FOV;
  const half = Math.tan((BASE_FOV * Math.PI) / 360) * (BASE_ASPECT / aspect);
  return Math.min(2 * Math.atan(half) * (180 / Math.PI), 70);
}

/**
 * 顶视正交相机的视锥半宽 / 半高（纯函数：浏览器与测试共用同一份）。
 * ------------------------------------------------------------------
 * 关键点：
 *   ① 用**外框**尺寸（台面 + 库边 + 9cm 木框）而不是台面尺寸 —— 只按 1.27m 半长
 *      去算，长边方向的木框与袋口收口环会被裁到画面外。
 *   ② 横屏：屏幕水平方向 = 球台长边（世界 X），垂直方向 = 短边（世界 Z）。
 *      **竖屏：整个视野转 90°** —— 水平方向 = 短边，垂直方向 = 长边，
 *      长边顺着屏幕的长边摆，台子才占得满（相机 up 轴由 Stage#updateOrthoFrustum 同步）。
 *   ③ 两个方向都取 max：宽高比再极端（超宽屏 / 竖屏手机），谁不够撑谁，
 *      宁可多留边距，也绝不让台角出画。
 * @param aspect 视口宽高比
 * @param pad    四周额外边距（米）
 * @returns {{ halfW:number, halfH:number, portrait:boolean }} 半宽 / 半高，以及是否已转过 90°
 */
export function orthoFrustum(aspect, pad = TOP.margin) {
  const a = (aspect > 0 && Number.isFinite(aspect)) ? aspect : 1;
  const needLong = TABLE.outerHalfL + pad;    // 长边半宽（世界 X）
  const needShort = TABLE.outerHalfW + pad;   // 短边半宽（世界 Z）
  if (a < 1) {
    // 竖屏：halfW 对应短边、halfH 对应长边
    const halfW = Math.max(needShort, needLong * a);
    return { halfW, halfH: halfW / a, portrait: true };
  }
  const halfH = Math.max(needShort, needLong / a);
  return { halfW: halfH * a, halfH, portrait: false };
}

/**
 * 无轨道控制器时的空壳：保持接口一致，让 CameraRig / main 不必到处判空。
 * target 必须是真的 Vector3（CameraRig 会对它 clone / copy / set）。
 */
function nullControls() {
  return {
    enabled: false,
    enableDamping: false,
    dampingFactor: 0,
    target: new THREE.Vector3(0, 0.1, 0),
    update() {},
    dispose() {},
  };
}
