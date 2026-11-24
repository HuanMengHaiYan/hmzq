import { BALL_R, RULES } from './constants.js';
import { throatRadiusOf } from './layout.js';

/**
 * 进袋裁判：传感器判定 + 喉口几何判定 + 袋口盖板（可选的开球保护规则）+ 两道死锁保险丝。
 *
 * 关于死锁（2026-09-16 定位到的根因）：
 *   "本杆进够了就把球抖回台面"这段逻辑位于**每个物理步都会执行**的循环里。
 *   球只要沉进喉口就会被重投一次（往外 0.8m/s + 往上 0.5m/s）。旧代码没有次数上限，
 *   球被连续重投 → 永远出不去、也永远停不下来 → state.shooting 恒为真 → 玩家无法出杆。
 *   现在由 RULES.rattleMaxStrikes（逐球计数）兜底。
 */
export class PocketReferee {
  /**
   * @param onPot 落袋回调 (ball, sensor) —— 由外部负责隐藏球 / 记分 / 刷新 HUD
   */
  constructor({ state, balls, sensors, lids, world, byHandle, onPot }) {
    this.state = state;
    this.balls = balls;
    this.sensors = sensors;
    this.lids = lids;
    this.world = world;
    this.byHandle = byHandle;
    this.onPot = onPot;
  }

  openLids() {
    for (const l of this.lids) l.collider.setEnabled?.(false);
    this.state.pocketsClosed = false;
    this.state.pocketReopenTimer = 0;
    this.state.pocketReopenTries = 0;
    this.state.rattleStrikes.clear();
  }

  closeLids() {
    for (const l of this.lids) l.collider.setEnabled?.(true);
    this.state.pocketsClosed = true;
    // 与"开袋"一样重置计数：本杆的抖回/轻推次数从这里重新开始累计
    this.state.pocketReopenTimer = 0;
    this.state.pocketReopenTries = 0;
    this.state.rattleStrikes.clear();
  }

  /** 每帧：本杆停稳后重新打开袋口；若还有球悬在袋口上，先把它轻轻顶回台面 */
  update(dt) {
    const { state } = this;
    if (!state.pocketsClosed || state.shooting) return;
    state.pocketReopenTimer -= dt;
    if (state.pocketReopenTimer > 0) return;

    let stuck = false;
    for (const l of this.lids) {
      const b = this.#occupantOf(l);
      if (!b) continue;
      stuck = true;
      state.pocketReopenTries += 1;
      this.#pushAway(b, l.x, l.z, 0.2);
    }

    // 死锁保险丝：球卡在袋口角落时会"推出→滚回→再推出"无限循环，游戏永远停在"运动中"。
    // 推够 pocketReopenMaxNudges 次就无条件开袋：宁可让这颗球掉进去，也不能把游戏卡住。
    if (stuck && state.pocketReopenTries < RULES.pocketReopenMaxNudges) {
      state.pocketReopenTimer = 0.3;
      return;
    }
    this.openLids();
  }

  /**
   * 进袋判定（每个物理步后调用一次）—— 0.7.0 单通道化（体检 P4）：
   *   主通道：球心进喉口且已开始下沉（y 低于 0.9 倍球半径）。
   *   兜底：袋筒传感器相交，但**只认已经明显沉到台面以下**（y < 0.5 倍球半径）的球。
   * 以前两套判据同时开跑：传感器半径 65mm > 喉口 57/60mm，球还在袋口边缘弹的时候
   * 就可能先被传感器判进 —— 两套门槛不一致，边界行为靠运气。
   * 现在统一口径：两个通道都要求"球在下沉"，传感器只兜"球心没进喉口圆、
   * 但确实顺着袋筒内壁掉下去"的极端几何（例如贴着喉口边缘翻落）。
   */
  check() {
    const { state } = this;
    // ---- 主通道：球心进喉口 ----
    for (const b of this.balls) {
      if (b.potted || b.hidden) continue;
      const t = b.body.translation();
      if (t.y > BALL_R * 0.9) continue;                 // 还在台面高度（或压在盖板上）
      // 喉口半径按袋型取（角袋 57mm / 中袋 60mm，见 layout.js 的 throatRadiusOf）
      const owner = this.sensors.find((s) => Math.hypot(t.x - s.x, t.z - s.z) < throatRadiusOf(s));
      if (!owner) continue;
      // 本杆进够了：抖回台面。抖够 rattleMaxStrikes 次就烧断保险丝、让这颗球正常落袋。
      if (this.#potsFull() && !this.#fuseBlown(b)) {
        state.rattleStrikes.set(b, (state.rattleStrikes.get(b) || 0) + 1);
        this.#pushAway(b, owner.x, owner.z, 0.8, 0.5);
      } else {
        this.#pot(b, owner);
      }
    }
    // ---- 兜底通道：已经沉进袋筒、但主通道没抓到的球 ----
    if (state.pocketsClosed || this.#potsFull()) return;
    for (const s of this.sensors) {
      let hit = null;
      this.world.intersectionPairsWith?.(s.collider, (other) => {
        if (hit) return;
        const b = this.byHandle.get(other.handle);
        if (!b || b.potted || b.hidden) return;
        if (b.body.translation().y > BALL_R * 0.5) return;   // 还在袋口边缘弹：不算
        hit = b;
      });
      if (hit) this.#pot(hit, s);
    }
  }

  #pot(ball, sensor) {
    if (ball.potted) return;
    ball.potted = true;
    this.state.pottedThisShot += 1;

    // 开球保护（可选规则，RULES.breakMaxPots ≥ 1 才生效）：本杆落袋达到上限后，
    // 其余袋口临时关闭，直到本杆全部停稳。默认 breakMaxPots = 0，此分支不参与。
    if (this.#potsFull()) this.closeLids();

    this.onPot?.(ball, sensor);
  }

  /** 开球保护是否已到达落袋上限（默认 breakMaxPots = 0 = 不限制，恒为 false） */
  #potsFull() {
    const { state } = this;
    return RULES.breakMaxPots > 0 && state.breakShot && state.pottedThisShot >= RULES.breakMaxPots;
  }

  #fuseBlown(b) {
    return (this.state.rattleStrikes.get(b) || 0) >= RULES.rattleMaxStrikes;
  }

  /** 某袋的喉口上是否正停着一颗球（盖板一撤它就会"隔空掉下去"） */
  #occupantOf(c) {
    return this.balls.find((b) => {
      if (b.potted || b.hidden) return false;
      const t = b.body.translation();
      return Math.hypot(t.x - c.x, t.z - c.z) < throatRadiusOf(c) + BALL_R * 0.6;
    }) || null;
  }

  /** 把球从袋心往外推（speed m/s，up 为同时给的向上速度） */
  #pushAway(b, cx, cz, speed, up = 0) {
    const t = b.body.translation();
    const dx = t.x - cx, dz = t.z - cz;
    const d = Math.hypot(dx, dz) || 1;
    b.body.setLinvel({ x: (dx / d) * speed, y: up, z: (dz / d) * speed }, true);
  }
}
