import * as THREE from 'three';
import { BALL_R, CAM, TABLE, TOP } from './constants.js';
import { aimVector } from './aimer.js';
import { applyTouchOrbit, IS_TOUCH } from './mobile.js';
import { isPortrait } from './stage.js';

export { isPortrait };

/** 「视角回归」按钮复位到此（自由模式默认机位，横屏用） */
const FREE_VIEW = {
  pos: new THREE.Vector3(0, 2.1, 3.0),
  target: new THREE.Vector3(0, 0.1, 0),
};

/**
 * 竖屏"整台占满屏幕"机位的距离反解（纯函数，浏览器与测试共用同一份）。
 * ------------------------------------------------------------------
 * 为什么需要它：球台是 2.82m × 1.55m 的横长条，竖屏屏幕却是竖长条 ——
 * 沿长轴"横着看"时台子横向会被裁掉、纵向只占十几个点（实测 148% 横向 / 24% 纵向，
 * 也就是两头出画）。把相机绕 Y 转 90°、挪到长轴那一端的斜上方后，长边顺着屏幕
 * 的长边摆，再沿这条射线反解距离，就能让整台刚好占满屏幕。
 *
 * 反解方式：从近到远二分，找"8 个外框角点投影后都落在 |ndc| ≤ margin 内"的最小距离。
 * 之所以不写解析式：分支太多（近端角 vs 远端角、横竖屏各不同），
 * 二分 40 次结果一样稳，而且以后改 fov / 边距 / 球台尺寸都不用重推公式。
 *
 * 观战机位（击球后拉远看全场）也复用它：传 azimuth = 本杆瞄准方向、anchor = 白球位置，
 * 就得到"从白球后方沿视线后退多远刚好装下整台"。
 *
 * @param aspect 视口宽高比
 * @param fovDeg 透视相机垂直 fov（度）
 * @param [opts] elevation 仰角(度) / margin 允许占屏比例 / halfL halfW 球台外框半尺寸
 *               azimuth 相机→注视点的水平方位角（同 aimAngle：向量 = (sin,0,cos)），
 *                       默认 π/2 = 看朝 +X，即相机站在 -X 侧（白球那端）
 *               anchor  相机射线的锚点 [x, y, z]（默认桌心正上方一点）
 * @returns {{ dist:number, useX:number, useY:number }} 距离、以及台外框实际占到屏幕的比例
 */
export function fitOverviewDist(aspect, fovDeg, opts = {}) {
  const a = (aspect > 0 && Number.isFinite(aspect)) ? aspect : 1;
  const elev = ((opts.elevation ?? CAM.portElev) * Math.PI) / 180;
  const margin = opts.margin ?? CAM.portMargin;
  const halfL = opts.halfL ?? TABLE.outerHalfL;
  const halfW = opts.halfW ?? TABLE.outerHalfW;
  const ty = 0.1;                                            // 注视点高度（略高于台面）
  const tanV = Math.tan(((fovDeg > 0 ? fovDeg : 48) * Math.PI) / 360);
  const tanH = tanV * a;
  const az = Number.isFinite(opts.azimuth) ? opts.azimuth : Math.PI / 2;
  const anchor = opts.anchor || [0, ty, 0];                  // 相机射线起点（默认桌心）
  const ce = Math.cos(elev), se = Math.sin(elev);
  const dirX = -Math.sin(az) * ce;                           // 相机在注视点的**后方**（默认 -X 侧）
  const dirZ = -Math.cos(az) * ce;
  const dirY = se;

  const corners = [];
  for (const x of [-halfL, halfL]) for (const z of [-halfW, halfW]) corners.push([x, 0, z], [x, 0.12, z]);

  const ndc = (p, R) => {
    const cam = [anchor[0] + dirX * R, anchor[1] + dirY * R, anchor[2] + dirZ * R];
    // backward = normalize(cam - target)
    let bx = cam[0], by = cam[1] - ty, bz = cam[2];
    const bl = Math.hypot(bx, by, bz) || 1;
    bx /= bl; by /= bl; bz /= bl;
    // right = normalize(cross(世界 up = (0,1,0), backward))；up = cross(backward, right)
    let rx = bz, rz = -bx;
    const rl = Math.hypot(rx, rz) || 1;
    rx /= rl; rz /= rl;
    const ux = by * rz, uy = bz * rx - bx * rz, uz = -by * rx;
    const vx = p[0] - cam[0], vy = p[1] - cam[1], vz = p[2] - cam[2];
    const dist = -(vx * bx + vy * by + vz * bz);             // 沿视线向前的距离
    if (!(dist > 1e-4)) return [Infinity, Infinity];
    return [
      (vx * rx + vz * rz) / dist / tanH,
      (vx * ux + vy * uy + vz * uz) / dist / tanV,
    ];
  };
  const fits = (R) => corners.every((p) => {
    const [x, y] = ndc(p, R);
    return Math.abs(x) <= margin && Math.abs(y) <= margin;
  });

  let lo = 1, hi = 40;
  if (fits(lo)) hi = lo; else for (let i = 0; i < 40; i++) {
    const mid = (lo + hi) / 2;
    if (fits(mid)) hi = mid; else lo = mid;
  }
  let useX = 0, useY = 0;
  for (const p of corners) {
    const [x, y] = ndc(p, hi);
    useX = Math.max(useX, Math.abs(x));
    useY = Math.max(useY, Math.abs(y));
  }
  return { dist: hi, useX, useY };
}

/**
 * 击球后的观战机位（纯函数，浏览器与测试共用同一份）。
 * ------------------------------------------------------------------
 * 相机站在**白球后方**（沿本杆瞄准方向的反向）、抬起 elev，距离按视锥反解到
 * "整张台（含木框）刚好在屏内"。整台入画是硬要求，所以距离随屏幕比例、击球方向
 * 变化；反过来也保证相机不会退得比需要更远（台子就不会白占一小块）。
 *
 * @param aspect 视口宽高比
 * @param fovDeg 透视相机垂直 fov（度）
 * @param aimAngle 本杆瞄准方向（弧度，向量 = (sin,0,cos)）
 * @param ball 白球位置 {x, z}
 * @param portrait 是否竖屏（竖屏用更高的仰角，长边才竖得进屏幕）
 * @returns {{ dist:number, pos:number[], target:number[] }}
 */
export function watchOverview(aspect, fovDeg, aimAngle, ball, portrait) {
  const elev = portrait ? CAM.portElev : CAM.watchElev;
  const margin = portrait ? CAM.portMargin : CAM.watchMargin;
  const { dist } = fitOverviewDist(aspect, fovDeg, {
    elevation: elev,
    margin,
    azimuth: aimAngle,
    anchor: [ball.x, BALL_R, ball.z],
  });
  const e = (elev * Math.PI) / 180;
  return {
    dist,
    pos: [
      ball.x - Math.sin(aimAngle) * dist * Math.cos(e),
      BALL_R + dist * Math.sin(e),
      ball.z - Math.cos(aimAngle) * dist * Math.cos(e),
    ],
    target: [0, 0.1, 0],
  };
}

/**
 * 顶视平移的边界（纯函数，浏览器与测试共用同一份）。
 * 把注视点夹在球台外框半尺寸 × TOP.panFrac 之内 —— 可以把台面任意一处
 * 推到屏幕中心附近，但台子整体仍被拴在屏幕里。
 */
export function clampTopPan(x, z) {
  const lx = TABLE.outerHalfL * TOP.panFrac;
  const lz = TABLE.outerHalfW * TOP.panFrac;
  return { x: Math.max(-lx, Math.min(lx, x)), z: Math.max(-lz, Math.min(lz, z)) };
}

/**
 * 相机机位管理：三种模式的位姿、补间动画、以及"瞄准方向跟随相机"的联动。
 * 只改相机与 state.aimAngle / state.trackPhase，不碰玩法与 DOM。
 */
export class CameraRig {
  constructor(stage, state, cue) {
    this.stage = stage;
    this.state = state;
    this.cue = cue;
    this._portrait = isPortrait(stage.aspect);   // 供 update 检测横竖屏切换
  }

  get controls() { return this.stage.controls; }
  get camera() { return this.stage.camera; }

  /** 当前视口是不是竖屏 */
  get portrait() { return isPortrait(this.stage.aspect); }

  /**
   * 竖屏专用的"整台占满屏幕"俯瞰机位；横屏返回 null（用原来那套调好的机位）。
   * 相机（白球那端斜上方）→ 桌心：屏幕上长边竖着排、白球在下方、目标球在上方，
   * 出杆方向自然朝屏幕上方。
   */
  overviewPose() {
    if (!this.portrait) return null;
    const { dist } = fitOverviewDist(this.stage.aspect, this.stage.fov);
    const elev = (CAM.portElev * Math.PI) / 180;
    return {
      pos: new THREE.Vector3(-dist * Math.cos(elev), 0.1 + dist * Math.sin(elev), 0),
      target: new THREE.Vector3(0, 0.1, 0),
    };
  }

  /** 自由模式默认机位（「视角回归」复位到此）：竖屏用占满屏幕的那套 */
  freePose() {
    return this.overviewPose() || { pos: FREE_VIEW.pos.clone(), target: FREE_VIEW.target.clone() };
  }

  /** 相机指向白球的水平方向（自由模式 / 追踪模式都用它反推瞄准角） */
  camToBallDir() {
    const p = this.cue.body.translation();
    const d = new THREE.Vector3(
      p.x - this.camera.position.x, 0,
      p.z - this.camera.position.z,
    );
    if (d.lengthSq() < 1e-8) d.set(0, 0, 1);
    return d.normalize();
  }

  /** 从白球指向目标点的方位角 */
  aimAngleTo(tx, tz) {
    const p = this.cue.body.translation();
    return Math.atan2(tx - p.x, tz - p.z);
  }

  /** 追踪模式瞄准位姿：白球正后方 camBack 处、抬高 aimHeight */
  aimingPose() {
    const p = this.cue.body.translation();
    const dir = aimVector(this.state.aimAngle);
    return {
      pos: new THREE.Vector3(p.x, BALL_R, p.z)
        .addScaledVector(dir, -this.state.camBack)
        .add(new THREE.Vector3(0, CAM.aimHeight, 0)),
      target: new THREE.Vector3(p.x, BALL_R * 0.6, p.z),
    };
  }

  /**
   * 追踪模式观站位姿：**从白球后方沿本杆视线往后退**，退到整张台刚好在屏内的距离。
   * ------------------------------------------------------------------
   * 距离按当前视锥反解（fitOverviewDist），不写死 —— 写死的那版在 16:9 下只占屏
   * 35%×73%（台子小得看不清球位），竖屏更要按宽高比重算。
   * 锚点取白球而不是桌心，相机的运动才是纯粹的"向后退"：从瞄准机位（白球后 0.95m）
   * 一路退到全场机位，中间不会横跳。
   */
  watchingPose() {
    const p = this.cue.body.translation();
    const w = watchOverview(this.stage.aspect, this.stage.fov, this.state.aimAngle, p, this.portrait);
    return {
      pos: new THREE.Vector3(w.pos[0], w.pos[1], w.pos[2]),
      target: new THREE.Vector3(w.target[0], w.target[1], w.target[2]),
    };
  }

  /**
   * 追踪模式的缩放区间随阶段切换（关键，不然观战机位会被夹回去）。
   * ------------------------------------------------------------------
   * OrbitControls 每帧把相机到注视点的距离夹进 [minDistance, maxDistance]。
   * 瞄准阶段是 0.5~1.7m；而观战机位在桌心外 3~4m —— 沿用瞄准的 1.7m 上限，
   * 补间一结束相机就会被**吸回 1.7m**，整张台瞬间被裁掉（台子只露中间一块）。
   */
  #orbitRange(phase, slack = 0) {
    const c = this.controls;
    c.minDistance = CAM.minDist;
    c.maxDistance = phase === 'watching'
      ? Math.max(CAM.maxDist, slack + CAM.watchSlack)
      : CAM.maxDist;
  }

  /**
   * @param ease 'inOut'（默认，慢进慢出）| 'out'（起步最快，用于击球后"唰"地拉远）
   */
  startTween(pos, target, dur, ease = 'inOut') {
    this.state.camTween = {
      fromPos: this.camera.position.clone(),
      toPos: pos.clone(),
      fromTgt: this.controls.target.clone(),
      toTgt: target.clone(),
      t: 0,
      dur,
      ease,
    };
  }

  /**
   * 追踪模式：相机对焦到白球后方（不需要任何按钮）
   * @param keepAngle true = 沿用当前瞄准方向（连打时视角不会突然甩回桌心）
   */
  enterAiming(keepAngle = false) {
    this.state.trackPhase = 'aiming';
    this.#orbitRange('aiming');
    if (!keepAngle) this.state.aimAngle = this.aimAngleTo(0, 0);
    const pose = this.aimingPose();
    this.startTween(pose.pos, pose.target, 0.9);
  }

  /**
   * 击球瞬间（追踪模式）：镜头**快速**向后拉到能看清整张台的距离，球停稳后自动拉回。
   * 拉远用 0.4s + easeOutCubic（起步最快），比瞄准回归的 0.9s 慢镜快一倍多 ——
   * 球一出去就得看见全场，慢了会错过走位。
   */
  onShotFired() {
    this.state.trackPhase = 'watching';
    // 出杆瞬间把阻尼惯性吃掉：蓄力期间相机是冻结的，这份惯性会一直攒着，
    // 等补间跑完一解锁就"补放"成一次莫名的旋转（"松开开球后视角突然转了"）。
    this.#settleOrbit();
    const pose = this.watchingPose();
    this.#orbitRange('watching', pose.pos.distanceTo(pose.target));
    this.startTween(pose.pos, pose.target, CAM.watchTween, 'out');
    this.state.autoFocusArmed = true;
    this.state.autoFocusTimer = 0.6;
  }

  /**
   * 蓄力开始：把瞄准视角**锁死**。
   * ------------------------------------------------------------------
   * 三件事，缺一不可：
   *   ① 停掉机位补间 —— 否则蓄力期间相机还在被补间推着走（update 里补间分支在蓄力判断之前），
   *      玩家看到"视角自己在转"，而瞄准方向是冻结的，看到的和打出去的就不是一回事了；
   *   ② 吃掉阻尼惯性 —— 见 #settleOrbit；
   *   ③ 关掉手势控制 —— 蓄力时手指还按在屏幕上，不能让相机跟着动。
   * 出杆方向另有一份快照（state.lockedAim），见 main.js 的 beginCharge / fireShot。
   */
  lockAim() {
    this.state.camTween = null;
    this.#settleOrbit();
    this.controls.enabled = false;
  }

  /** 蓄力结束后交还用户手势控制（顶视只有触摸设备才开着缩放 / 平移） */
  enableControls() {
    // 蓄力期间一律不解锁：不然蓄力中途（补间跑完 / 球停稳）相机会被重新打开，手指一动就转视角
    if (this.state.charging) return;
    this.controls.enabled = this.state.mode !== 'top' || IS_TOUCH;
  }

  /**
   * 自由球模式的「摆白球」阶段：视角照常用，但别抢走单指 / 左键。
   * ------------------------------------------------------------------
   * ⚠️ 这里**不能**用 lockAim()：那套是给"瞄准 / 蓄力"用的（连相机补间一起冻住），
   *    摆球阶段玩家还得右键转视角、滚轮缩放、手机上双指捏合 —— 全关掉就成了"视角动不了"。
   * 真正要改的只有手势分配：
   *   · 触摸：单指让给"拖白球"（ONE: null），双指改 DOLLY_ROTATE（既能缩放也能转视角）
   *   · 鼠标：左键本来就不归 OrbitControls（留给击球），右键旋转与滚轮缩放照旧，无需改动
   * 另外摆球期间 update() 会跳过自动跟随（见那里），否则拖球时相机追着白球跑，屏幕点
   * 对应的台面坐标一直在变，球会跟着手指"打滑"。
   *
   * ⚠️ 顶视（mode === 'top'）是单独一套：桌面端平时把 OrbitControls **整个关掉**
   * （鼠标一动就是瞄准，再叠平移会打架），所以摆球阶段要临时把它打开 —— 否则
   * 玩家在顶视下摆白球时既看不到台面另一端，也没法把视角挪过去。
   * 只放开"平移 + 缩放"，旋转仍然关死（正交投影一歪就不是俯视图了）。摆完球收回。
   */
  setPlacing(on) {
    const c = this.controls;
    if (!c) return;
    if (on) {
      if (this.state.mode === 'top') { this.#setTopGesture(true); return; }
      this.enableControls();                      // 保证开着（顶视除外）
      c.enablePan = false;                       // 摆球时别平移：容易把要摆的位置推出视野
      if (IS_TOUCH) c.touches = { ONE: null, TWO: THREE.TOUCH.DOLLY_ROTATE };
    } else {
      if (this.state.mode === 'top') { this.#setTopGesture(false); return; }
      // 交还：中键平移回到"仅自由模式"，触摸手势回到 applyTouchOrbit 的默认分配
      c.enablePan = this.state.mode === 'free';
      applyTouchOrbit(c, THREE.TOUCH);
    }
  }

  /**
   * 顶视下临时放开 / 收回"平移 + 缩放"（只有摆白球那一段用得上）。
   * ------------------------------------------------------------------
   * 与 #applyTopOrbit 的区别：那个是**切进顶视模式**时跑的（还会把视角复位），
   * 这个只改手势开关，不动相机位置 —— 摆球时把玩家调好的视角重置掉会很烦人。
   *
   * 收回时桌面端要**复位并重新锁死**：顶视下玩家平时没有别的手段把视角调回来，
   * 留着一个偏移的锁定视角会让下一杆莫名其妙看不全台面。触摸端一直开着双指，
   * 那是它的常规操作，不复位。
   */
  #setTopGesture(on) {
    const c = this.controls;
    if (this.stage.orthoCam) c.object = this.stage.orthoCam;
    if (on) {
      c.enableRotate = false;                    // 顶视不能歪
      c.enableZoom = true;
      c.enablePan = true;
      // 左键留给拖白球；桌面用右键平移 + 滚轮缩放，触摸用双指捏合 / 拖动
      c.mouseButtons = { LEFT: null, MIDDLE: null, RIGHT: THREE.MOUSE.PAN };
      c.touches = { ONE: null, TWO: THREE.TOUCH.DOLLY_PAN };
      c.enabled = true;
    } else {
      c.mouseButtons = { LEFT: null, MIDDLE: null, RIGHT: null };
      c.touches = { ONE: null, TWO: THREE.TOUCH.DOLLY_PAN };
      c.enabled = !!IS_TOUCH;                    // 桌面收回锁死；触摸保持常规双指
      if (!IS_TOUCH) this.#resetTopView();
    }
  }

  /**
   * 吃掉 OrbitControls 的阻尼惯性。
   * ------------------------------------------------------------------
   * enableDamping 为真时手指松开后相机还会沿原方向滑十几帧（每帧把 _sphericalDelta 乘 0.92）。
   * 这份惯性在"相机被冻结"的时段（蓄力 / 补间）不会衰减，于是解冻那一帧集中放出来 ——
   * 表现就是"松开开球后视角突然旋转、白球方向跟着变"。
   * 私有字段名带下划线，换 three 版本可能改 —— 检测不到就安静跳过，不砸主流程。
   */
  #settleOrbit() {
    const c = this.controls;
    if (!c) return;
    for (const k of ['_sphericalDelta', '_panOffset']) {
      const v = c[k];
      if (v && typeof v.set === 'function') v.set(0, 0, 0);
    }
    if (typeof c._scale === 'number') c._scale = 1;
  }

  setMode(mode) {
    const { state } = this;
    state.mode = mode;

    if (mode === 'free') {
      this.stage.setActiveCamera('persp');
      state.camTween = null;
      this.#applyOrbit({ zoom: true, min: 0.55, max: 6, polarMax: Math.PI * 0.495, pan: true });
      // 竖屏：直接摆成"整台占满屏幕"的机位（横屏保持原样 —— 从追踪切过来时沿用当前视角）
      if (this.portrait) {
        const p = this.freePose();
        this.camera.position.copy(p.pos);
        this.controls.target.copy(p.target);
        this.camera.lookAt(p.target);
        this.controls.update();
      }
      const d = this.camToBallDir();
      state.aimAngle = Math.atan2(d.x, d.z);
    } else if (mode === 'tracking') {
      this.stage.setActiveCamera('persp');
      state.camTween = null;
      this.#applyOrbit({
        zoom: true, min: CAM.minDist, max: CAM.maxDist,
        polarMax: Math.PI * 0.49, polarMin: 0.08, pan: false,
      });
      if (state.shooting) {
        // 球还在动：先停在全局俯瞰，等停稳后由 update 自动对焦
        this.onShotFired();
      } else {
        state.autoFocusArmed = false;
        this.enterAiming();
      }
    } else {   // top 顶视
      this.stage.setActiveCamera('ortho');
      state.camTween = null;
      state.aimAngle = this.aimAngleTo(0, 0);   // 顶视初始瞄准：白球指向桌心
      // 触摸设备：顶视放开"双指捏合放大 + 双指拖动平移"（单指仍然是瞄准）。
      // 桌面端保持完全固定 —— 鼠标移动在顶视下就是瞄准，再叠一层平移会打架。
      if (IS_TOUCH) this.#applyTopOrbit();
      else this.controls.enabled = false;
      // ⚠️ 摆球途中切到顶视：上面那行会把控制器又关掉，玩家正拖着的球就成了"视角动不了"。
      //    摆球期间切模式本来就要复位视角（这里刚换了正交相机），复位完再放开那一套手势。
      if (state.placingCue) {
        this.#applyTopOrbit();
        this.#setTopGesture(true);
      }
    }
  }

  /**
   * 顶视手势（仅触摸设备）：双指捏合放大、双指拖动平移，单指照旧交给瞄准。
   * ------------------------------------------------------------------
   * 相机要换成**正交相机**：OrbitControls 认得 isOrthographicCamera，
   * 缩放到正交相机上改的是 `camera.zoom`、平移改的是 `target`，正合用。
   * 只放开这两样 —— 旋转会破坏"正上方俯视"，必须关掉。
   */
  #applyTopOrbit() {
    const c = this.controls;
    if (this.stage.orthoCam) c.object = this.stage.orthoCam;
    c.enableRotate = false;                     // 顶视不能歪，否则正交投影就斜了
    c.enableZoom = true;
    c.enablePan = true;
    c.minZoom = TOP.zoomMin;                    // 不能缩小到 1 以下：1 = 整台在屏内
    c.maxZoom = TOP.zoomMax;
    c.zoomSpeed = 0.9;
    c.panSpeed = 0.8;
    // 俯视的极角（0 或 π/2，取决于 up 轴）不能被上一个模式的限制卡住，否则相机会歪
    c.minPolarAngle = 0;
    c.maxPolarAngle = Math.PI;
    c.mouseButtons = { LEFT: null, MIDDLE: null, RIGHT: null };   // 桌面鼠标不参与顶视
    c.touches = { ONE: null, TWO: THREE.TOUCH.DOLLY_PAN };
    c.enabled = true;
    this.#resetTopView();
  }

  /** 顶视复位：相机回正上方、缩放回到"整台在屏内"、注视点回桌心（「视角回归」也走这里） */
  #resetTopView() {
    const cam = this.stage.orthoCam;
    if (cam) {
      cam.position.set(0, TOP.camY, 0);
      cam.zoom = 1;
      cam.updateProjectionMatrix();
    }
    // ⚠️ 顺序不能反：OrbitControls 开了阻尼，拖完松开手指还会剩一份没放完的平移量
    // （_panOffset）。若先落 target 再 update()，那点残留会在同一帧被加回去 ——
    // 表现是"摆完球视角没真的回正"，留下 0.01m 量级的偏移再也退不掉。
    // 所以先吃掉惯性（_panOffset / _sphericalDelta / _scale 归零），再复位注视点。
    this.#settleOrbit();
    this.controls.target.set(0, 0, 0);
    this.controls.update();
  }

  /**
   * 顶视平移上限：注视点拴在球台范围内（外框半尺寸 × panFrac）。
   * 效果是可以把台面任意一处推到屏幕中心附近，但台子整体拖不出画面。
   */
  #clampTopPan() {
    const t = this.controls.target;
    const c = clampTopPan(t.x, t.z);
    const cx = c.x, cz = c.z;
    if (cx === t.x && cz === t.z) return;
    // 相机跟着一起挪，保持"正上方 camY"的俯视姿态（只改水平位置，不碰高度）
    const cam = this.stage.orthoCam;
    if (cam) { cam.position.x += cx - t.x; cam.position.z += cz - t.z; }
    t.x = cx;
    t.z = cz;
  }

  /** 「视角回归」：自由模式平滑复位；追踪模式重新对焦白球；顶视回到整台俯视 */
  resetView() {
    if (this.state.mode === 'top') {
      if (IS_TOUCH) this.#resetTopView();      // 放大 / 平移玩乱了，一键回中
      return;
    }
    if (this.state.mode === 'free') {
      const p = this.freePose();
      this.startTween(p.pos, p.target, 0.6);
    } else if (this.state.mode === 'tracking') {
      this.enterAiming();
    }
  }

  /**
   * 横竖屏切换（手机转屏）：全局俯瞰机位是按宽高比算的，方向一变就得重摆一次。
   * 只在自由模式做 —— 追踪模式的机位由瞄准方向决定、顶视的正交视锥由 resize 直接更新。
   */
  #watchPortraitFlip() {
    const p = this.portrait;
    if (p === this._portrait) return;
    this._portrait = p;
    const { state } = this;
    if (state.mode === 'free' && !state.charging && !state.shooting) this.resetView();
  }

  /** 每帧更新：自动对焦 → 补间 → 跟随控制。蓄力期间全部冻结（瞄准方向锁定） */
  update(dt) {
    const { state } = this;
    this.#watchPortraitFlip();

    // 摆白球阶段：相机只听手势的（旋转 / 缩放），不做任何自动跟随。
    // 追踪模式的 target 每帧追白球，拖球时白球在动 → 相机在动 → "屏幕点→台面"的射线
    // 一直在变，手指不动球也会漂。这里直接跳过，拖球就稳了。
    if (state.placingCue) {
      if (this.controls.enabled) {
        this.controls.update();
        // 顶视摆球临时放开平移（见 setPlacing），这里照样要拴住上限，
        // 不然一拖就把整张台子推出画面了。
        if (state.mode === 'top') this.#clampTopPan();
      }
      return;
    }

    if (state.mode === 'tracking' && state.autoFocusArmed && !state.shooting && !state.charging) {
      state.autoFocusTimer -= dt;
      if (state.autoFocusTimer <= 0) {
        state.autoFocusArmed = false;
        this.enterAiming(true);      // 沿用本杆瞄准方向，视角不会突然甩回桌心
      }
    }

    if (state.mode === 'top') {
      // 顶视相机不做补间；触摸设备上把双指手势跑一遍，再夹住平移范围
      if (IS_TOUCH && !state.charging) { this.controls.update(); this.#clampTopPan(); }
      return;
    }
    // 蓄力期间相机完全冻结 —— 这一行必须在补间之前：
    // 否则蓄力时补间还在推进，瞄准方向却是冻结的，看到的朝向和打出去的方向会脱钩
    if (state.charging) return;
    // 电脑转杆时补间可能还在跑（球停稳 → 自动对焦的 0.9 秒补间）。补间的终点是
    // **转杆之前**那个杆向的机位，不处理的话镜头会先慢悠悠回到旧机位、再被杆向拽过去 ——
    // 玩家看到的是"镜头跟不上杆"。所以把终点每帧钉成当前杆向的后方，并把剩余时间压到
    // 0.15 秒：镜头快速追上杆子，既不瞬移，也不会落在后面。
    if (state.camTween && state.aiAiming && state.trackPhase === 'aiming') {
      const pose = this.aimingPose();
      state.camTween.toPos.copy(pose.pos);
      state.camTween.toTgt.copy(pose.target);
      state.camTween.t = Math.max(state.camTween.t, state.camTween.dur - 0.15);
    }
    if (state.camTween) return this.#updateTween(dt);

    // 自由 / 追踪：瞄准方向跟随相机（白球为旋转支点）
    if (state.mode === 'tracking') {
      if (state.trackPhase === 'aiming' && !state.shooting) {
        // 🤖 电脑在转杆：**反过来**，由瞄准方向决定相机。
        // 平时是"相机决定瞄准方向"（玩家转视角 = 改杆向），电脑没有手去转相机，
        // 不改这一句的话它转杆时镜头纹丝不动 —— 只有球杆在转，玩家根本看不出它在瞄哪颗球。
        // 改成相机每帧挪到"白球后方、按当前杆向"的机位，镜头就跟着它一起扫过去。
        if (state.aiAiming) this.camera.position.copy(this.aimingPose().pos);
        else {
          const d = this.camToBallDir();
          state.aimAngle = Math.atan2(d.x, d.z);
        }
      }
      const p = this.cue.body.translation();
      // 瞄准阶段围绕白球、观战阶段看向桌心
      if (state.trackPhase === 'aiming') this.controls.target.set(p.x, BALL_R * 0.6, p.z);
      else this.controls.target.set(0, 0.1, 0);
    } else {
      const d = this.camToBallDir();
      state.aimAngle = Math.atan2(d.x, d.z);
    }
    this.controls.update();
  }

  #updateTween(dt) {
    const tw = this.state.camTween;
    tw.t += dt;
    const k = Math.min(tw.t / tw.dur, 1);
    // 'out' = easeOutCubic：一开始就冲出去，末尾减速停住（"唰"地拉远）
    // 'inOut' = easeInOutQuad：慢进慢出（补间回瞄准机位时用，不晃眼）
    const e = tw.ease === 'out'
      ? 1 - Math.pow(1 - k, 3)
      : (k < 0.5 ? 2 * k * k : 1 - Math.pow(-2 * k + 2, 2) / 2);
    this.camera.position.lerpVectors(tw.fromPos, tw.toPos, e);
    const tgt = new THREE.Vector3().lerpVectors(tw.fromTgt, tw.toTgt, e);
    this.camera.lookAt(tgt);
    this.controls.target.copy(tgt);
    if (k >= 1) {
      this.state.camTween = null;
      this.enableControls();        // 补间结束 → 交还用户旋转控制（顶视除外；蓄力期间会拒绝）
    }
  }

  #applyOrbit({ zoom, min, max, polarMax, polarMin, pan }) {
    const c = this.controls;
    c.object = this.stage.perspCam || this.camera;   // 从顶视切回来：控制对象换回透视相机
    c.enableRotate = true;                           // 顶视关过，这里要开回来
    c.enablePan = !!pan;            // 仅自由模式允许中键平移
    c.enableZoom = zoom;
    c.minDistance = min;
    c.maxDistance = max;
    if (polarMax != null) c.maxPolarAngle = polarMax;
    if (polarMin != null) c.minPolarAngle = polarMin;
    // 左键留给蓄力击球；右键旋转视角；自由模式额外允许中键平移
    c.mouseButtons = { LEFT: null, MIDDLE: pan ? THREE.MOUSE.PAN : null, RIGHT: THREE.MOUSE.ROTATE };
    c.enabled = true;
    // 触摸设备：单指旋转 / 双指缩放+平移（桌面无影响）
    applyTouchOrbit(c, THREE.TOUCH);
  }
}
