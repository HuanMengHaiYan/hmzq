import { AUDIO } from './constants.js';

/**
 * 连击播报：把"每次落袋"翻译成该放哪些声音。
 * ------------------------------------------------------------------
 * 规则（用户定的口径）：
 *   · 每进一颗 → 欢呼（cheer），连得越多现场越热
 *   · 累计 2 连起 → 播报语音，一路到 6 连
 *         2 非常好 · 3 太棒了 · 4 四连无双 · 5 五连绝世 · ≥6 超越神的球技
 *   · 同一杆同时（先后）进 2 颗及以上 → 改播"多响"专用音效，不再叠加连击语音
 *         2 双响炮 · 3 三响炮 · ≥4 满堂彩
 *
 * "连击"按连续进球计数、跨杆累计：只要有一杆空杆（或白球落袋）就清零。
 *
 * 这个文件刻意不 import audio.js —— audio.js 会经由 platform 拉进 three 与
 * DOM，那样无头测试就跑不了。这里只依赖一个鸭子类型的 engine.playClip(name, vol)。
 */

/** 连击语音：索引 = 连击数（0/1 不放语音），最高到 5 */
const STREAK_CLIPS = [null, null, 'streak2', 'streak3', 'streak4', 'streak5'];
const STREAK_TOP = 'streak6';            // 6 连及以上
/** 一杆多响：索引 = 本杆已进袋数（0/1 不用），4 及以上统一用最后一句 */
const MULTI_CLIPS = [null, null, 'multi2', 'multi3', 'multi4'];

export class ComboAnnouncer {
  /**
   * @param engine   只需实现 playClip(name, vol)
   * @param opts.delay    语音比欢呼晚多少毫秒出来（默认 420ms，免得两句糊在一起）
   * @param opts.schedule 调度函数，测试里可换成同步执行
   */
  constructor(engine, opts = {}) {
    this.engine = engine;
    this.delay = opts.delay ?? 420;
    this.schedule = opts.schedule ?? ((fn) => setTimeout(fn, this.delay));
    this.streak = 0;      // 累计连续进球数（跨杆）
    this.best = 0;        // 本局最高连击
    this.shotPots = 0;    // 本杆已进目标球数
    this.multi = 0;       // 本杆已播到的"多响"档位（每档只播一次）
  }

  /** 每一杆开始 */
  onShotStart() {
    this.shotPots = 0;
    this.multi = 0;
  }

  /** 每一杆结束：这一杆一颗没进 → 连击断掉 */
  onShotEnd() {
    if (this.shotPots === 0) this.streak = 0;
  }

  /**
   * 进错球（本地双人：本该打自己那组，却打进了对方的球）。
   * ------------------------------------------------------------------
   * ⚠️ 这一颗**不算进球**：不加 shotPots（"一杆多响"就不会把它算进去），
   * 连击立刻清零，而且不给欢呼 —— 打错了还在播"太棒了"，会让人以为自己打对了。
   * 给一声和白球落袋同样的尴尬音，作为"这一杆打错了"的听觉信号。
   */
  onWrongPot() {
    this.streak = 0;
    this.engine.sfx?.('awkward');
  }

  /** 重开一局 */
  reset() {
    this.streak = 0;
    this.shotPots = 0;
    this.multi = 0;
  }

  /**
   * 落袋播报
   * @param isCue true = 落袋的是白球（犯规：连击中断，改播"尴尬长号"，不喝彩）
   */
  onPot(isCue = false) {
    if (isCue) {
      this.streak = 0;
      // 白球进洞是"自己把自己送进去"，给一声尴尬的长号而不是欢呼。
      // 用可选调用：测试里的假引擎不用实现 sfx。
      this.engine.sfx?.('awkward');
      return;
    }
    this.shotPots += 1;
    this.streak += 1;
    if (this.streak > this.best) this.best = this.streak;
    const streak = this.streak;

    // 欢呼：每球必放，连得越多音量越高（上限 1.35 倍）
    this.engine.playClip('cheer', AUDIO.cheerGain * Math.min(1.35, 0.8 + 0.09 * streak));
    if (streak >= 3) this.engine.playClip('applause', AUDIO.applauseGain);

    // 一杆多响：优先于连击语音 —— 一下子收好几颗球是另一件事，不该念连击数
    if (this.shotPots >= 2) {
      const lv = Math.min(this.shotPots, MULTI_CLIPS.length - 1);
      if (lv > this.multi) {
        this.multi = lv;
        this.#say(MULTI_CLIPS[lv]);
      }
      return;
    }
    if (streak < 2) return;                            // 单颗：只有欢呼
    const clip = streak >= 6 ? STREAK_TOP : STREAK_CLIPS[Math.min(streak, 5)];
    if (clip) this.#say(clip);
  }

  #say(clip) {
    this.schedule(() => this.engine.playClip(clip, AUDIO.voiceGain));
  }
}
