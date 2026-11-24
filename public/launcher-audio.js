/**
 * 启动器 · 声音设置面板
 * --------------------------------------------------------------------------
 * 为什么单独一个文件：launcher.js 是 public/ 下的经典脚本，不能用打包器合并，
 * 把这块塞进去会把它顶到 350 行以上。抽成一个小类后，launcher.js 只负责 new + mount，
 * 所有宿主能力（读写存储、提示闪现）都从外面注入，两边不互相依赖具体实现。
 *
 * 与游戏内的音频面板是同一份设置（同一个 storage key），两边改动互相同步。
 */
(function () {
  'use strict';

  function num(v, lo, hi, dflt) {
    v = parseFloat(v);
    if (!isFinite(v)) return dflt;
    return Math.min(hi, Math.max(lo, v));
  }

  /**
   * @param opts.key        存储键（与 src/audio.js 的 KEY 一致）
   * @param opts.defaults   { sfx, music, bgm }
   * @param opts.hints      { bgmId: 曲目说明 }
   * @param opts.read(k)    读存储（返回已解析对象）
   * @param opts.write(v,k) 写存储
   * @param opts.flash()    「已保存」提示
   */
  function LauncherAudio(opts) {
    this.key = opts.key;
    this.defaults = opts.defaults;
    this.hints = opts.hints;
    this.read = opts.read;
    this.write = opts.write;
    this.flash = opts.flash;
    this.prefs = this.sanitize(this.read(opts.key));
    this.els = {};
  }

  LauncherAudio.prototype.sanitize = function (raw) {
    var d = this.defaults;
    var o = Object.assign({}, d, raw || {});
    o.sfx = num(o.sfx, 0, 1, d.sfx);
    o.music = num(o.music, 0, 1, d.music);
    if (!this.hints[o.bgm]) o.bgm = d.bgm;
    return o;
  };

  /** 绑 DOM（#p-sfx / #p-music / #p-bgm 三个元素在 launcher.html 里）并首次刷新 */
  LauncherAudio.prototype.mount = function () {
    var e = this.els;
    e.sfx = document.getElementById('p-sfx');
    e.music = document.getElementById('p-music');
    e.sfxV = document.getElementById('p-sfx-v');
    e.musicV = document.getElementById('p-music-v');
    e.bgm = document.getElementById('p-bgm');
    e.hint = document.getElementById('p-bgm-hint');
    if (!e.sfx || !e.bgm) return;

    var self = this;
    this.bindVol(e.sfx, 'sfx');
    this.bindVol(e.music, 'music');
    e.bgm.addEventListener('click', function (ev) {
      var b = ev.target.closest('button[data-bgm]');
      if (!b) return;
      self.prefs.bgm = b.dataset.bgm;
      // 选了曲目却把音乐拖到 0：替用户拉回默认值，否则"选了没声音"像个 bug
      if (self.prefs.bgm !== 'off' && self.prefs.music < 0.01) self.prefs.music = self.defaults.music;
      self.sync();
      self.save();
    });
    this.sync();
  };

  /** 音量滑块：0~100 → 0~1 */
  LauncherAudio.prototype.bindVol = function (el, field) {
    var self = this;
    el.addEventListener('input', function () {
      self.prefs[field] = num(el.value, 0, 100, 0) / 100;
      self.sync();
      self.save();
    });
  };

  LauncherAudio.prototype.sync = function () {
    var p = this.prefs;
    var e = this.els;
    var sf = Math.round(p.sfx * 100);
    var mu = Math.round(p.music * 100);
    e.sfx.value = sf;
    e.music.value = mu;
    e.sfxV.textContent = sf;
    e.musicV.textContent = mu;
    e.hint.textContent = this.hints[p.bgm];
    Array.prototype.forEach.call(e.bgm.children, function (b) {
      b.classList.toggle('on', b.dataset.bgm === p.bgm);
    });
  };

  LauncherAudio.prototype.save = function () {
    this.write(this.prefs, this.key);
    this.flash();
  };

  /** 「恢复默认」：连同声音设置一起回到出厂值 */
  LauncherAudio.prototype.reset = function () {
    this.prefs = this.sanitize(this.defaults);
    this.sync();
    this.write(this.prefs, this.key);
    return this.prefs;
  };

  window.LauncherAudio = LauncherAudio;
})();
