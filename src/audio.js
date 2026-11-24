import { AUDIO } from './constants.js';
import { host } from './platform/index.js';
import { VOICES } from './voices.js';

/**
 * 音效引擎
 * ------------------------------------------------------------------
 * 两类声音走了两条不同的路子，都是为了让 file:// 的桌面版也能出声：
 *
 *   ① 实时合成（撞球 / 撞库 / 出杆 / 落袋 / 尴尬 / 结算号角 / 自爆）
 *      纯 Web Audio：不要素材、零加载延迟，能按"撞得多重"实时改音量音色。
 *      配方在 src/voices.js，这里只提供 tone() 这一个发声原语。
 *
 *   ② 素材播放（欢呼 / 连击语音 / 背景音乐）
 *      用 <audio> 元素。为什么不用 fetch + decodeAudioData：
 *      Electron 是 file:// 页面，Chromium 会拦掉 file:// 的 fetch（CORS），
 *      而媒体元素加载本地文件不受影响。
 *
 * 3D 定位：**只有球撞球**用，而且只在自由 / 追踪模式（顶视固定音量）。
 * 总线末尾挂了压缩器：开球、进球+欢呼+语音叠在一起时不至于爆音，
 * 整体听感也更"实"—— 这是"声音太小"的另一半成因（见 constants.js 的 AUDIO）。
 */
const KEY = 'hmzq.audio.v1';

/** 素材表：名字 → public/audio 下的相对路径（public/ 会被原样拷进两个构建产物） */
export const CLIP_FILES = {
  cheer: 'audio/cheer.ogg',
  applause: 'audio/applause.ogg',
  streak2: 'audio/voice/streak2.mp3',
  streak3: 'audio/voice/streak3.mp3',
  streak4: 'audio/voice/streak4.mp3',
  streak5: 'audio/voice/streak5.mp3',
  streak6: 'audio/voice/streak6.mp3',
  multi2: 'audio/voice/multi2.mp3',
  multi3: 'audio/voice/multi3.mp3',
  multi4: 'audio/voice/multi4.mp3',
};

const clamp01 = (v) => Math.min(1, Math.max(0, v));

/**
 * 播媒体元素并吞掉自动播放策略的 Promise 拒绝。
 * play() 被拦时是 rejected 而非 throw，不接住会冒到 unhandledrejection，
 * 游戏页的全局错误浮层就会弹红框（"play() failed because the user didn't
 * interact with the document first"）。这是浏览器策略、不是故障，静默即可。
 */
export function safePlay(el) {
  try {
    const p = el.play();
    if (p && typeof p.catch === 'function') p.catch(() => { /* 等用户手势 */ });
  } catch { /* 老浏览器同步抛：同样忽略 */ }
}

/** 读音量设置（没有 / 写坏了就回落到 AUDIO 里的默认值） */
export function loadAudioPrefs() {
  const s = (host.storage?.get(KEY, null)) || {};
  return {
    sfx: Number.isFinite(+s.sfx) ? clamp01(+s.sfx) : AUDIO.sfx,
    music: Number.isFinite(+s.music) ? clamp01(+s.music) : AUDIO.music,
    bgm: ['lounge', 'park', 'off'].includes(s.bgm) ? s.bgm : AUDIO.bgm,
  };
}

export class AudioEngine {
  constructor() {
    this.ok = host.hasDOM && !!(globalThis.AudioContext || globalThis.webkitAudioContext);
    this.settings = loadAudioPrefs();
    this.spatial = true;                  // 顶视模式会关掉
    this.cam = { x: 0, y: 2, z: 3, rx: 1, rz: 0 };   // 相机位置 + 右方向（水平分量）
    this.ctx = null;
    this.bus = null;
    this.comp = null;
    this.noise = null;
    this.pools = new Map();
    this.budget = { t: -1, n: 0 };
    this.onSettings = null;               // 背景音乐订阅它
    this.onUnlock = null;
    if (!this.ok) return;

    // 浏览器 / Chromium 要求先有用户手势才允许出声：任何一次点击或按键都算
    const go = () => this.unlock();
    host.on(globalThis, 'pointerdown', go);
    host.on(globalThis, 'keydown', go);
  }

  /** 建 AudioContext（幂等）。手势之后第一次调用才算真正解锁 */
  unlock() {
    if (!this.ok) return;
    if (!this.ctx) {
      try {
        const AC = globalThis.AudioContext || globalThis.webkitAudioContext;
        this.ctx = new AC();
        this.bus = this.ctx.createGain();
        this.bus.gain.value = this.settings.sfx;
        this.comp = this.ctx.createDynamicsCompressor();
        this.comp.threshold.value = AUDIO.compThreshold;
        this.comp.ratio.value = AUDIO.compRatio;
        this.comp.knee.value = AUDIO.compKnee;
        this.comp.attack.value = 0.003;
        this.comp.release.value = 0.18;
        this.bus.connect(this.comp);
        this.comp.connect(this.ctx.destination);
        this.noise = this.#makeNoise();
        this.onUnlock?.();
      } catch {
        this.ok = false;                  // 环境不支持：后面所有发声都静默跳过
        return;
      }
    }
    try {
      if (this.ctx.state === 'suspended') this.ctx.resume();
    } catch { /* 忽略 */ }
  }

  /** 改音量 / 曲目并落盘 */
  set(patch) {
    Object.assign(this.settings, patch);
    try { host.storage?.set(KEY, this.settings); } catch { /* 无存储也能玩 */ }
    if (this.bus) this.bus.gain.value = this.settings.sfx;
    this.onSettings?.(this.settings);
  }

  /** 每帧把相机位姿交给引擎，用来算左右声道与距离衰减（只给球撞球用） */
  setCamera(cam) {
    this.cam.x = cam.position.x;
    this.cam.y = cam.position.y;
    this.cam.z = cam.position.z;
    const e = cam.matrixWorld.elements;    // 矩阵第 0 列 = 相机的右方向
    this.cam.rx = e[0];
    this.cam.rz = e[2];
  }

  setSpatial(on) { this.spatial = !!on; }

  /* ---------------- 对外发声接口 ---------------- */

  /** 通用入口：sfx('fanfare') / sfx('ballHit', closing, x, z) */
  sfx(name, ...args) { VOICES[name]?.(this, ...args); }

  ballHit(closing, x, z) { this.sfx('ballHit', closing, x, z); }
  cushion(speed) { this.sfx('cushion', speed); }
  cueStrike(power) { this.sfx('cueStrike', power); }
  pocketDrop() { this.sfx('pocketDrop'); }

  /**
   * 播素材（欢呼 / 连击语音）。
   * 媒体元素的音量上限是 1，素材本身又偏轻（欢呼的 RMS 只有 0.06），
   * 所以目标音量超过 1 时拆成几层叠着放，层间错开十几毫秒避免完全同相刺耳。
   */
  playClip(name, vol = 1) {
    if (!this.ok) return;
    const src = CLIP_FILES[name];
    if (!src) return;
    const want = clamp01(vol) * this.settings.sfx * AUDIO.clipBoost;
    if (want <= 0.02) return;
    const layers = Math.min(3, Math.ceil(want));
    const per = Math.min(1, want / layers);
    const pool = this.#pool(name, src, layers);
    if (!pool) return;

    const free = pool.els.filter((e) => e.paused || e.ended);
    for (let i = 0; i < layers; i++) {
      const el = free[i] || pool.els[pool.i++ % pool.els.length];
      el.volume = per;
      try {
        el.currentTime = 0;
        if (i === 0) safePlay(el);
        else setTimeout(() => safePlay(el), i * 14);
      } catch { /* 自动播放被拦：等下一次手势 */ }
    }
  }

  /**
   * 发声原语：一个带包络的短音（+ 可选的一段带通噪声）。
   * @param spec.delay   相对现在的秒数（排旋律用）
   * @param spec.spatial 是否做 3D 定位（只有球撞球传 true）
   * @param spec.osc     false = 只要噪声（爆炸、镲片）
   * @param spec.ndur    噪声的衰减时长，默认 min(dur, 0.05)
   */
  tone({
    type = 'triangle', f0 = 440, f1 = 0, dur = 0.2, gain = 0.5,
    x = 0, z = 0, noise = 0, nf = 3000, nq = 1, ndur = 0,
    delay = 0, spatial = false, osc = true,
  } = {}) {
    if (!this.#ready()) return;
    const ctx = this.ctx;
    const t = ctx.currentTime + delay;
    const dest = this.#place(x, z, spatial);

    if (osc) {
      const o = ctx.createOscillator();
      o.type = type;
      o.frequency.setValueAtTime(f0, t);
      if (f1 && f1 !== f0) o.frequency.exponentialRampToValueAtTime(Math.max(30, f1), t + dur);
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.0001, t);
      g.gain.linearRampToValueAtTime(gain, t + 0.0018);                 // 1.8ms 起音：硬物碰撞
      g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
      o.connect(g); g.connect(dest);
      o.start(t); o.stop(t + dur + 0.03);
    }

    if (noise > 0 && this.noise) {
      const n = ctx.createBufferSource();
      n.buffer = this.noise;
      const bp = ctx.createBiquadFilter();
      bp.type = 'bandpass'; bp.frequency.value = nf; bp.Q.value = nq;
      const ng = ctx.createGain();
      ng.gain.setValueAtTime(gain * noise, t);
      ng.gain.exponentialRampToValueAtTime(0.0001, t + (ndur || Math.min(dur, 0.05)));
      n.connect(bp); bp.connect(ng); ng.connect(dest);
      n.start(t, Math.random() * 0.4); n.stop(t + Math.max(ndur, 0.09) + 0.02);
    }
  }

  /* ---------------- 内部实现 ---------------- */

  /** 能不能发声：同时兼做"同一瞬间最多响几声"的限流（开球时几十次碰撞一起到） */
  #ready() {
    if (!this.ok || !this.ctx || this.ctx.state !== 'running') return false;
    const t = this.ctx.currentTime;
    if (t - this.budget.t > AUDIO.burstWindow) { this.budget.t = t; this.budget.n = 0; }
    return this.budget.n++ < AUDIO.burstMax;
  }

  /**
   * 事件点 → 一个已经接好总线的节点。
   * 只有 spatial 为真（= 球撞球）且当前模式开了 3D，才做左右声道与距离衰减；
   * 其余一律固定音量直连总线。
   */
  #place(x, z, spatial) {
    const g = this.ctx.createGain();
    if (!spatial || !this.spatial) {
      g.gain.value = 1;
      g.connect(this.bus);
      return g;
    }
    const dx = x - this.cam.x, dz = z - this.cam.z;
    const d = Math.hypot(dx, dz) || 1e-6;
    const pan = this.ctx.createStereoPanner();
    const dot = (dx / d) * this.cam.rx + (dz / d) * this.cam.rz;      // 事件点在相机右方为正
    pan.pan.value = Math.max(-1, Math.min(1, dot)) * AUDIO.maxPan;
    g.gain.value = Math.min(1, Math.max(AUDIO.minAtten, 1 / (1 + (d / AUDIO.refDist) ** 1.5)));
    g.connect(pan);
    pan.connect(this.bus);
    return g;
  }

  #pool(name, src, n) {
    let pool = this.pools.get(name);
    if (!pool) { pool = { els: [], i: 0 }; this.pools.set(name, pool); }
    while (pool.els.length < n) {
      const el = host.createElement('audio');
      if (!el) return null;
      el.src = src;
      el.preload = 'auto';
      pool.els.push(el);
    }
    return pool;
  }

  /** 半秒白噪声，所有打击音共用（每次播放随机取一段，避免听着像循环） */
  #makeNoise() {
    const ctx = this.ctx;
    const buf = ctx.createBuffer(1, Math.floor(ctx.sampleRate * 0.5), ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    return buf;
  }
}
