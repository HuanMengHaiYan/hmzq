/**
 * 启动器 · 画质设置面板
 * --------------------------------------------------------------------------
 * 与 src/quality.js 是同一份设置（同一个 storage key `hmzq.quality.v1`），
 * 游戏内「⚙ 设置」里改了，这里能看到；这里改了，进游戏立刻生效。
 *
 * ⚠️ 为什么又抄一份：启动器是 public/ 下的经典脚本，不能 import src/ 里的模块
 *    （两边共用 chunk 会破坏 Electron 的 IIFE 构建）。所以选项表、默认值、
 *    档位映射都与 src/quality.js 保持逐字一致 —— 改任意一边都要同步另一边。
 */
(function () {
  'use strict';

  var KEY = 'hmzq.quality.v1';
  var DEFAULTS = { preset: 'auto' };
  var SHADOW_SIZE = { off: 0, low: 512, mid: 1024, high: 2048 };
  var DPR_CAP = { '1': 1, '1.25': 1.25, '1.5': 1.5, '2': 2 };
  var ANISO_LEVEL = { low: 1, mid: 4, high: 8 };
  /* 台球桌贴图边长（0.8.0）：与 src/quality.js 的 TEX_EDGE 一致 */
  var TEX_EDGE = [256, 512, 1024, 2048];

  var PRESETS = {
    low:  { shadow: 'off',  dpr: '1',    aniso: 'low',  tex: '512'  },
    mid:  { shadow: 'mid',  dpr: '1.25', aniso: 'mid',  tex: '1024' },
    high: { shadow: 'high', dpr: '2',    aniso: 'high', tex: '2048' },
  };

  /* 老档位 id → 新档位 id（2026-09-20 之前是 自动/流畅/均衡/高清 + 三个单项微调） */
  var LEGACY = { smooth: 'low', balanced: 'mid', fancy: 'high' };

  var PRESET_IDS = ['auto', 'low', 'mid', 'high', 'custom'];
  var FINE = ['shadow', 'dpr', 'tex', 'aniso'];
  var SHADOW_IDS = Object.keys(SHADOW_SIZE);
  var DPR_IDS = Object.keys(DPR_CAP);
  var ANISO_IDS = Object.keys(ANISO_LEVEL);
  var TEX_IDS = TEX_EDGE.map(function (n) { return String(n); });

  /* customOnly 的三行只在档位 = 自定义 时露出（与 src/quality.js 的 ITEMS 逐字一致） */
  var ITEMS = [
    {
      id: 'preset', name: '画质档位',
      options: [{ id: 'auto', name: '自动' }, { id: 'low', name: '低' },
        { id: 'mid', name: '中' }, { id: 'high', name: '高' },
        { id: 'custom', name: '自定义' }],
      hints: {
        auto: '按设备挑一档：手机偏保守（中）、桌面放开（高）。下面那行会显示实际取值。',
        low: '关阴影 + 原分辨率 + 512 贴图 + 最低纹理过滤：最省电，适合老机型或发烫时用。',
        mid: '阴影 1024 + 125% 分辨率 + 1024 贴图 + 4× 过滤：手机上推荐，观感与性能的平衡点。',
        high: '阴影 2048 + 200% 分辨率 + 2048 贴图 + 8× 过滤：桌面观感最好，手机上偏烫。',
        custom: '自己定下面四项：阴影精度 / 渲染分辨率 / 贴图精度 / 纹理细节。改任意一项都会落到这里。',
      },
    },
    {
      id: 'shadow', name: '阴影精度', customOnly: true,
      options: [{ id: 'off', name: '关' }, { id: 'low', name: '512' },
        { id: 'mid', name: '1024' }, { id: 'high', name: '2048' }],
      hints: {
        off: '关掉阴影：最省，但球和杆没有投影，立体感弱一些。',
        low: '512² 阴影：能看到投影，边缘略糊。',
        mid: '1024² 阴影：手机上推荐的平衡点。',
        high: '2048² 阴影：边缘最干净，代价是每帧多画 4 倍阴影像素。',
      },
    },
    {
      id: 'dpr', name: '渲染分辨率', customOnly: true,
      options: [{ id: '1', name: '100%' }, { id: '1.25', name: '125%' },
        { id: '1.5', name: '150%' }, { id: '2', name: '200%' }],
      hints: {
        '1': '100%：一个 CSS 像素渲染一个物理像素，最省。',
        '1.25': '125%：略微超采样，锯齿更少。',
        '1.5': '150%：明显更清晰，开销约为 100% 的 2.25 倍。',
        '2': '200%：最锐利，开销约为 100% 的 4 倍。',
      },
    },
    {
      id: 'tex', name: '贴图精度', customOnly: true,
      options: [{ id: '256', name: '256' }, { id: '512', name: '512' },
        { id: '1024', name: '1024' }, { id: '2048', name: '2048' }],
      hints: {
        '256': '256²：几乎不占显存（两张 1 MB），近看台呢和木纹会糊，只在内存极紧张时用。',
        '512': '512²：显存约 3 MB，远景够用，凑近看木纹偏模糊 —— 低档位默认。',
        '1024': '1024²：显存约 11 MB，桌面与手机都清楚的平衡点 —— 中档位默认。',
        '2048': '2048²：显存约 45 MB，木纹与台呢最细腻 —— 高档位默认，老机型慎用。',
      },
    },
    {
      id: 'aniso', name: '纹理细节', customOnly: true,
      options: [{ id: 'low', name: '1×' }, { id: 'mid', name: '4×' }, { id: 'high', name: '8×' }],
      hints: {
        low: '1×：不过滤，斜着看台布会有糊斑。',
        mid: '4×：够用，斜视观感明显改善。',
        high: '8×：最清晰，采样成本最高。',
      },
    },
  ];

  function LauncherQuality(opts) {
    this.read = opts.read;
    this.write = opts.write;
    this.flash = opts.flash;
    this.touch = (!!window.matchMedia && window.matchMedia('(pointer: coarse)').matches)
      || (navigator.maxTouchPoints || 0) > 0;
    this.prefs = this.sanitize(this.read(KEY));
    this.rows = [];
    this.nowEl = null;
  }

  /**
   * 三项细分值什么时候都留着（与 src/quality.js 一致）：
   * 从「自定义」切走再切回来，上次调的三项还在；没有值就按设备默认起一套。
   */
  LauncherQuality.prototype.sanitize = function (raw) {
    var o = (raw && typeof raw === 'object') ? raw : {};
    var v = String(o.preset == null ? '' : o.preset);
    var preset = PRESET_IDS.indexOf(v) >= 0 ? v : (LEGACY[v] || DEFAULTS.preset);
    var d = this.auto();
    function pick(val, ids, fb) { return ids.indexOf(String(val)) >= 0 ? String(val) : fb; }
    return {
      preset: preset,
      shadow: pick(o.shadow, SHADOW_IDS, d.shadow),
      dpr: pick(o.dpr, DPR_IDS, d.dpr),
      tex: pick(o.tex, TEX_IDS, d.tex),
      aniso: pick(o.aniso, ANISO_IDS, d.aniso),
    };
  };

  /** 「自动」= 按设备挑一档（与 src/quality.js 的 autoQuality 一致） */
  LauncherQuality.prototype.auto = function () {
    return this.touch
      ? { shadow: 'mid', dpr: '1.25', aniso: 'mid', tex: '1024' }
      : { shadow: 'high', dpr: '2', aniso: 'high', tex: '2048' };
  };

  /** 某个档位对某一项的具体取值（auto → null，表示"按设备挑"） */
  LauncherQuality.prototype.presetValue = function (presetId, itemId) {
    var p = PRESETS[presetId];
    return p && p[itemId] != null ? p[itemId] : null;
  };

  /** 配置 → 具体数值 + 一行说明（custom → 用存的三项） */
  LauncherQuality.prototype.resolve = function () {
    var values = this.prefs.preset === 'custom'
      ? { shadow: this.prefs.shadow, dpr: this.prefs.dpr, aniso: this.prefs.aniso, tex: this.prefs.tex }
      : (PRESETS[this.prefs.preset] || this.auto());
    var shadow = values.shadow;
    var dpr = values.dpr;
    var aniso = values.aniso;
    var tex = values.tex;
    var cap = DPR_CAP[dpr] || 2;
    var pr = Math.min(window.devicePixelRatio || 1, cap);
    var w = Math.round(window.innerWidth * pr);
    var h = Math.round(window.innerHeight * pr);
    return {
      shadow: shadow, dpr: dpr, aniso: aniso, tex: tex,
      shadowSize: SHADOW_SIZE[shadow] || 0,
      dprCap: cap,
      anisoLevel: ANISO_LEVEL[aniso] || 4,
      texSize: Number(tex) || 2048,
      text: '当前：阴影 ' + (SHADOW_SIZE[shadow] ? SHADOW_SIZE[shadow] + '²' : '关')
        + ' · 渲染 ' + w + '×' + h
        + ' · 贴图 ' + (Number(tex) || 2048) + '²'
        + ' · 各向异性 ' + (ANISO_LEVEL[aniso] || 4) + '×',
    };
  };

  /** 建 DOM（容器 #p-quality）并首次刷新 */
  LauncherQuality.prototype.mount = function () {
    var box = document.getElementById('p-quality');
    this.nowEl = document.getElementById('p-quality-now');
    if (!box) return;
    var self = this;

    ITEMS.forEach(function (item) {
      var row = document.createElement('div');
      row.className = 'qrow';

      var fl = document.createElement('div');
      fl.className = 'fl';
      var lb = document.createElement('label');
      lb.textContent = item.name;
      fl.appendChild(lb);
      row.appendChild(fl);

      var segs = document.createElement('div');
      segs.className = 'segs auto';
      var btns = {};
      item.options.forEach(function (opt) {
        var b = document.createElement('button');
        b.type = 'button';
        b.dataset.qval = opt.id;
        b.textContent = opt.name;
        segs.appendChild(b);
        btns[opt.id] = b;
      });
      row.appendChild(segs);

      var hint = document.createElement('p');
      hint.className = 'hint';
      row.appendChild(hint);

      box.appendChild(row);
      self.rows.push({ item: item, row: row, btns: btns, hint: hint });

      segs.addEventListener('click', function (e) {
        var b = e.target.closest('button[data-qval]');
        if (!b) return;
        self.set(item.id, b.dataset.qval);
      });
    });

    this.sync();
  };

  /**
   * 改一项（与 src/quality.js 的 Quality.set 同口径）：
   * 动细分项 → 档位落到 custom；换档位 → 三项一起刷成这一档的值。
   */
  LauncherQuality.prototype.set = function (id, val) {
    if (FINE.indexOf(id) >= 0) this.prefs.preset = 'custom';
    else if (id === 'preset' && val !== 'custom') {
      var v = PRESETS[val] || this.auto();
      this.prefs.shadow = v.shadow;
      this.prefs.dpr = v.dpr;
      this.prefs.aniso = v.aniso;
      this.prefs.tex = v.tex;
    }
    this.prefs[id] = val;
    this.sync();
    this.save();
  };

  LauncherQuality.prototype.sync = function () {
    var self = this;
    this.rows.forEach(function (r) {
      // 细分项只在「自定义」档露出（.qrow 是块级，hidden 本身就够，但仍显式写 display:none 更稳）
      if (r.item.customOnly) r.row.hidden = self.prefs.preset !== 'custom';
      Object.keys(r.btns).forEach(function (id) {
        r.btns[id].classList.toggle('on', self.prefs[r.item.id] === id);
      });
      r.hint.textContent = r.item.hints[self.prefs[r.item.id]] || '';
    });
    if (this.nowEl) this.nowEl.textContent = this.resolve().text;
  };

  LauncherQuality.prototype.save = function () {
    this.write(this.prefs, KEY);
    if (this.flash) this.flash();
  };

  /** 「恢复默认」：连同画质一起回到出厂值 */
  LauncherQuality.prototype.reset = function () {
    this.prefs = this.sanitize(DEFAULTS);
    this.sync();
    this.write(this.prefs, KEY);
    return this.prefs;
  };

  window.LauncherQuality = LauncherQuality;
})();
