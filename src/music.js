/**
 * 背景音乐：两首可以放心用的爵士曲，循环播放 + 换曲淡入淡出。
 * ------------------------------------------------------------------
 * 为什么用 <audio> 而不是 Web Audio：见 src/audio.js 的开头注释 ——
 * Electron 是 file:// 页面，fetch 会被拦，媒体元素不会。
 *
 * 素材与授权见 README「音频素材来源」一节（一首 CC BY 3.0 需要署名，一首 CC0）。
 */
import { host } from './platform/index.js';

export const TRACKS = [
  { id: 'lounge', name: '爵士酒廊', src: 'audio/bgm/lounge.mp3' },
  { id: 'park', name: '公园爵士', src: 'audio/bgm/park.ogg' },
];

export class Music {
  /** @param engine AudioEngine：曲目与音量都存在它的 settings 里 */
  constructor(engine) {
    this.engine = engine;
    this.el = null;
    this.id = null;
    this.timer = 0;
    engine.onSettings = (s) => this.apply(s);
  }

  /** 设置变化或首次解锁后调用：把曲目与音量同步到播放器 */
  apply(s = this.engine.settings) {
    if (!host.hasDOM) return;
    if (!this.el) {
      this.el = host.createElement('audio');
      if (!this.el) return;
      this.el.loop = true;
      this.el.preload = 'auto';
      this.el.volume = 0;
    }
    if (s.bgm === 'off') {
      this.#fade(0, 320);
      this.id = null;
      return;
    }
    const t = TRACKS.find((x) => x.id === s.bgm) || TRACKS[0];
    if (this.id !== t.id) {
      this.id = t.id;
      this.el.src = t.src;
      this.el.currentTime = 0;
      this.el.volume = 0;
      this.#play();
      this.#fade(s.music, 1600);      // 换曲慢一点淡入，不抢戏
    } else {
      this.#play();                   // 自动播放被拦时，下一次手势还会再试
      this.#fade(s.music, 260);
    }
  }

  /**
   * 播放（幂等）。
   * ⚠️ play() 返回 Promise：自动播放被策略拦下时是 "rejected" 而不是 throw，
   *    不接住就会冒到 unhandledrejection —— 游戏页注册了全局错误浮层，
   *    玩家看到的就是进游戏那一下弹一个红框（"play() failed because the user
   *    didn't interact with the document first"）。所以这里必须 .catch 掉。
   *    真正的解锁时机是第一次指针/按键，由 audio.onUnlock 再调一次 apply()。
   */
  #play() {
    try {
      const p = this.el.play();
      if (p && typeof p.catch === 'function') p.catch(() => { /* 等下一次用户手势 */ });
    } catch { /* 老浏览器可能同步抛：同样忽略 */ }
  }

  /** 音量渐变（毫秒）：换曲淡入、关掉淡出后暂停 */
  #fade(to, ms = 260) {
    if (!this.el) return;
    clearInterval(this.timer);
    const el = this.el;
    const from = el.volume;
    const step = 60;
    const n = Math.max(1, Math.round(ms / step));
    let k = 0;
    this.timer = setInterval(() => {
      k += 1;
      el.volume = Math.min(1, Math.max(0, from + (to - from) * (k / n)));
      if (k >= n) {
        clearInterval(this.timer);
        if (to === 0) el.pause();
      }
    }, step);
  }
}
