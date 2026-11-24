import { AUDIO } from './constants.js';

/**
 * 音色库：所有"实时合成"的声音配方都在这里。
 * ------------------------------------------------------------------
 * 为什么单独一个文件：audio.js 只负责引擎（总线、定位、素材池、限流），
 * 音色配方独立出来后，加一种声音不用碰引擎，两边都不会顶到 300 行。
 *
 * 每个配方签名都是 (engine, ...args)，engine 只需提供 tone(spec)。
 * spec 字段见 audio.js 的 tone()：
 *   type/f0/f1/dur/gain —— 振荡器；noise/nf/nq/ndur —— 叠一段带通噪声；
 *   delay —— 相对现在的秒数（用来排旋律）；x/z/spatial —— 只有 spatial 为真才做 3D 定位。
 *
 * 3D 定位只给"球撞球"（spatial: true），其余一律固定音量 —— 顶视模式本来就没有
 * 左右方位概念，而撞库/出杆/落袋做衰减只会让声音忽远忽近、听不清。
 */
const clamp01 = (v) => Math.min(1, Math.max(0, v));

export const VOICES = {
  /** 球撞球：接近速度越大 → 越响、越脆（音高与亮度一起抬）· 唯一走 3D 定位的音 */
  ballHit(e, closing, x, z) {
    const s = clamp01((closing - AUDIO.ballMin) / (AUDIO.ballFull - AUDIO.ballMin));
    if (s <= 0) return;
    const g = AUDIO.ballGain * (0.22 + 0.78 * s);
    e.tone({
      f0: 1150 + 2400 * s, f1: 820 + 1500 * s, dur: 0.055, gain: g, x, z,
      noise: 0.5, nf: 3200 + 3800 * s, spatial: true,
    });
    e.tone({ f0: 2400 + 4200 * s, dur: 0.03, gain: g * 0.5, x, z, spatial: true, delay: 0.002 });
  },

  /** 撞库：橡胶库边是闷响，比球撞球低沉、尾巴略长 */
  cushion(e, speed) {
    const s = clamp01(speed / AUDIO.ballFull);
    if (s <= 0.05) return;
    e.tone({
      type: 'sine', f0: 300, f1: 150, dur: 0.14,
      gain: AUDIO.cushionGain * (0.3 + 0.7 * s), noise: 0.25, nf: 900, nq: 0.7,
    });
  },

  /** 出杆：力度决定亮度与响度（轻推是"嗒"，重击是"啪"） */
  cueStrike(e, power) {
    const s = clamp01(power);
    e.tone({
      f0: 700 + 1500 * s, f1: 380, dur: 0.075,
      gain: AUDIO.cueGain * (0.35 + 0.65 * s), noise: 0.7, nf: 2400 + 2600 * s,
    });
  },

  /** 落袋：先"咚"一声闷响，随即往下掉 */
  pocketDrop(e) {
    e.tone({
      type: 'sine', f0: 260, f1: 90, dur: 0.28,
      gain: AUDIO.dropGain, noise: 0.4, nf: 700, nq: 0.6,
    });
  },

  /** 白球进洞：经典"悲鸣长号" —— 三声下行滑音，表示尴尬 */
  awkward(e) {
    const g = AUDIO.awkwardGain * 0.42;
    e.tone({ type: 'sawtooth', f0: 233, f1: 196, dur: 0.30, gain: g });
    e.tone({ type: 'sawtooth', f0: 196, f1: 175, dur: 0.30, gain: g, delay: 0.32 });
    e.tone({ type: 'sawtooth', f0: 175, f1: 104, dur: 0.95, gain: g, delay: 0.64 });
  },

  /** 胜利结算：上行号角 + 收尾大三和弦 + 一记镲片 */
  fanfare(e) {
    const g = AUDIO.fanfareGain * 0.3;
    [523.25, 659.25, 783.99, 1046.5].forEach((f, i) => {
      e.tone({ type: 'square', f0: f, dur: 0.16, gain: g, delay: i * 0.13 });
    });
    const t = 0.54;                                        // 收尾和弦的起点
    e.tone({ type: 'square', f0: 1046.5, dur: 0.9, gain: g, delay: t });
    e.tone({ type: 'square', f0: 1318.5, dur: 0.9, gain: g * 0.7, delay: t });
    e.tone({ type: 'triangle', f0: 130.8, dur: 1.0, gain: g * 1.2, delay: t });
    e.tone({ osc: false, dur: 0.6, gain: g * 0.9, noise: 1, nf: 7000, nq: 0.4, ndur: 0.6, delay: t });
  },

  /** 失败结算：小调下行，最后一声拖长下滑 */
  defeat(e) {
    const g = AUDIO.defeatGain * 0.32;
    [440, 415.3, 392, 349.23].forEach((f, i) => {
      e.tone({ type: 'sawtooth', f0: f, dur: 0.34, gain: g, delay: i * 0.2 });
    });
    e.tone({ type: 'sawtooth', f0: 261.6, f1: 196, dur: 1.1, gain: g * 1.1, delay: 0.82 });
  },

  /** 黑 8 提前落袋：自爆 —— 低频轰鸣 + 两记噪声爆响 */
  boom(e) {
    const g = AUDIO.boomGain;
    e.tone({ osc: false, dur: 0.25, gain: g * 0.9, noise: 1, nf: 6000, nq: 0.5, ndur: 0.25 });
    e.tone({ type: 'sine', f0: 110, f1: 32, dur: 1.1, gain: g * 0.9 });
    e.tone({ type: 'triangle', f0: 180, f1: 60, dur: 0.4, gain: g * 0.5, delay: 0.02 });
    e.tone({ osc: false, dur: 0.7, gain: g * 0.7, noise: 1, nf: 1600, nq: 0.35, ndur: 0.7 });
  },
};
