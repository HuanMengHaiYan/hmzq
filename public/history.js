/**
 * 挑战历史（经典脚本，无打包器参与）
 * ------------------------------------------------------------------
 * 为什么放在 public/ 而不是 src/：启动器（launcher.html）与游戏页（index.html）
 * 都要读写同一份记录，而启动器是 public/ 下的独立页面，import 不了 src/ 的模块。
 * 放在这里，两份页面各用 <script src="history.js"> 引一次，实现只有一份 ——
 * 不用像 prefs / rules 那样在两边各留一份镜像（那正是最容易改漏的地方）。
 *
 * ⚠️ 语法保持 ES5 水平：这个文件会**原样下发**给老内核（Android WebView 75+），
 *    不经过 esbuild 降级。不要用 let/const/箭头函数/模板字符串/可选链。
 *
 * 存储：默认 localStorage；桌面端（Electron）由启动器把 storage 换成 IPC 落盘。
 * 记录上限 MAX 条，超出丢最旧的 —— localStorage 只有 5MB，不能无限堆。
 */
(function () {
  'use strict';

  var KEY = 'hmzq.history.v1';
  var MAX = 200;

  /** tab 顺序即展示顺序；'all' 特殊：不过滤 */
  var TABS = [
    { id: 'all', name: '所有' },
    { id: 'score', name: '计分' },
    { id: 'limit', name: '限次' },
    { id: 'timed', name: '计时' },
    { id: 'free', name: '自由' },
    { id: 'fun', name: '娱乐' },
    { id: 'ai', name: '人机' },
    { id: 'duo', name: '双人' },
    { id: 'online', name: '联机' }
  ];

  var MODES = {
    free: '自由模式',
    score: '计分模式',
    limit: '限次模式',
    timed: '计时模式',
    freeball: '自由球模式',
    duo: '本地双人',
    ai: '人机对战',
    online: '在线联机'
  };

  /** 会记分数的模式（计分模式与自由球模式共用同一套计分口径） */
  var SCORED = { score: true, freeball: true };

  /**
   * 一个 tab 可以收多个模式：娱乐 tab 底下是所有娱乐玩法，
   * 以后娱乐模式再加玩法只要往这里塞一个 id，不用再往 TABS 里加一行。
   */
  var GROUPS = { fun: ['freeball'] };

  var DIFFS = { easy: '简单', normal: '中等', hard: '困难', extreme: '极难' };

  /** 操作视角模式（一局用的是哪种视角，记进历史供详情弹窗展示） */
  var VIEWS = { tracking: '追踪视角', free: '自由视角', top: '顶视' };

  /** 难度档位对哪些模式有意义（限次 / 计时都是 easy|normal|hard） */
  function hasDiff(mode) { return mode === 'limit' || mode === 'timed'; }

  /** 结果文案：计分模式显示分数，其余显示通关 / 失败 */
  var RESULTS = { clear: '通关', win: '通关', fail: '失败' };

  /* ---------------- 存储（可被外部替换，Electron 走 IPC） ---------------- */
  var storage = {
    get: function (key) {
      if (typeof window !== 'undefined') {
        try {
          var e = window.__electron;
          if (e && e.settings) {
            var s = e.settings.get(key);
            return s ? JSON.parse(s) : null;
          }
        } catch (err) { /* 落到 localStorage */ }
      }
      try { return JSON.parse(localStorage.getItem(key) || 'null'); } catch (err2) { return null; }
    },
    set: function (key, value) {
      if (typeof window !== 'undefined') {
        try {
          var e = window.__electron;
          if (e && e.settings) { e.settings.set(key, JSON.stringify(value)); return; }
        } catch (err) { /* 落到 localStorage */ }
      }
      try { localStorage.setItem(key, JSON.stringify(value)); } catch (err2) { /* 配额满 / 隐私模式：静默 */ }
    }
  };

  /** 换掉存储实现：Electron 走 IPC 落盘，Node 测试走内存 */
  function setStorage(impl) {
    if (impl && typeof impl.get === 'function' && typeof impl.set === 'function') storage = impl;
    return storage;
  }

  function num(v, d) {
    var n = Number(v);
    return isFinite(n) ? n : d;
  }

  /**
   * 把任意来源的一条记录收拾成合法结构；不合法（模式不认识）返回 null。
   * 存储被手改坏、或旧版本残留的脏数据都在这层被挡掉。
   */
  function sanitize(raw) {
    if (!raw || typeof raw !== 'object') return null;
    if (!Object.prototype.hasOwnProperty.call(MODES, raw.mode)) return null;
    var rec = {
      id: String(raw.id || ''),
      name: String(raw.name || '玩家1').slice(0, 12),
      mode: raw.mode,
      diff: Object.prototype.hasOwnProperty.call(DIFFS, raw.diff) ? raw.diff : null,
      score: raw.score == null ? null : Math.round(num(raw.score, 0)),
      shots: Math.max(0, Math.round(num(raw.shots, 0))),
      left: raw.left == null ? null : Math.max(0, Math.round(num(raw.left, 0))),
      // 过程数据（详情弹窗用）。老记录没有这些字段 → 0 / null，展示成"—"
      potted: Math.max(0, Math.round(num(raw.potted, 0))),
      total: Math.max(0, Math.round(num(raw.total, 0))),
      best: Math.max(0, Math.round(num(raw.best, 0))),
      timeLeft: raw.timeLeft == null ? null : Math.max(0, Math.round(num(raw.timeLeft, 0))),
      view: Object.prototype.hasOwnProperty.call(VIEWS, raw.view) ? raw.view : null,
      aimMs: raw.aimMs == null ? null : Math.max(0, Math.round(num(raw.aimMs, 0))),
      aimCount: Math.max(0, Math.round(num(raw.aimCount, 0))),
      result: Object.prototype.hasOwnProperty.call(RESULTS, raw.result) ? raw.result : 'clear',
      // 本地双人：获胜方 1 | 2（0.7.0 起双人对局也入史，见 main.js 的 finishMatch）
      winner: (raw.winner === 1 || raw.winner === 2) ? raw.winner : null,
      ms: Math.max(0, Math.round(num(raw.ms, 0))),
      ts: Math.max(0, Math.round(num(raw.ts, Date.now())))
    };
    // 计分模式与自由球模式必须有分；其余模式没有分
    if (SCORED[rec.mode] && rec.score == null) rec.score = 0;
    if (!SCORED[rec.mode]) rec.score = null;
    // 只有限次模式有"剩余次数"、只有计时模式有"剩余时间"，难度也只有这两个模式才有
    if (rec.mode !== 'limit') rec.left = null;
    if (rec.mode !== 'timed') rec.timeLeft = null;
    if (!hasDiff(rec.mode)) rec.diff = null;
    return rec;
  }

  /** 读全部（已过滤脏数据），最新的在前 */
  function read() {
    var arr = storage.get(KEY);
    if (!arr || typeof arr !== 'object' || typeof arr.length !== 'number') return [];
    var out = [];
    for (var i = 0; i < arr.length; i++) {
      var r = sanitize(arr[i]);
      if (r) out.push(r);
    }
    return out;
  }

  function write(arr) {
    storage.set(KEY, arr);
    return arr;
  }

  /** 追加一条（放最前）；超出上限丢最旧的。@returns 写入后的记录或 null */
  function add(rec) {
    var r = sanitize(rec);
    if (!r) return null;
    if (!r.id) r.id = 'r' + r.ts + '-' + Math.random().toString(36).slice(2, 7);
    var arr = read();
    arr.unshift(r);
    if (arr.length > MAX) arr = arr.slice(0, MAX);
    write(arr);
    return r;
  }

  /**
   * 列表
   * @param tab  TABS 里的 id；'all' 或空 = 不过滤；分组 tab（娱乐）按 GROUPS 收多个模式
   */
  function list(tab) {
    var arr = read();
    if (!tab || tab === 'all') return arr;
    var group = GROUPS[tab];
    if (group) return arr.filter(function (r) { return group.indexOf(r.mode) >= 0; });
    return arr.filter(function (r) { return r.mode === tab; });
  }

  /** 这条记录属不属于某个 tab（分组 tab 也算） */
  function inTab(r, tab) {
    var group = GROUPS[tab];
    return group ? group.indexOf(r.mode) >= 0 : r.mode === tab;
  }

  /**
   * 清空
   * @param tab  'all' = 全清；否则只清这个模式（"当前在哪个 tab 就清哪个"，分组 tab 清整组）
   * @returns 清掉了几条
   */
  function clear(tab) {
    if (!tab || tab === 'all') {
      var n = read().length;
      write([]);
      return n;
    }
    var arr = read();
    var kept = arr.filter(function (r) { return !inTab(r, tab); });
    write(kept);
    return arr.length - kept.length;
  }

  /* ---------------- 展示（纯函数，UI 与测试共用） ---------------- */

  /** 毫秒 → mm:ss（超过一小时显示 h:mm:ss） */
  function fmtTime(ms) {
    var s = Math.max(0, Math.round((Number(ms) || 0) / 1000));
    var h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), ss = s % 60;
    function pad(v) { return (v < 10 ? '0' : '') + v; }
    return h > 0 ? h + ':' + pad(m) + ':' + pad(ss) : pad(m) + ':' + pad(ss);
  }

  /** 时间戳 → MM-DD HH:mm */
  function fmtDate(ts) {
    var d = new Date(Number(ts) || Date.now());
    function pad(v) { return (v < 10 ? '0' : '') + v; }
    return pad(d.getMonth() + 1) + '-' + pad(d.getDate()) + ' ' + pad(d.getHours()) + ':' + pad(d.getMinutes());
  }

  /** 结果文案：计分模式显示分数；人机显示胜负；双人显示"玩家X 胜"；其余通关 / 失败 */
  function resultText(r) {
    if (SCORED[r.mode]) return String(r.score) + '分';
    if (r.mode === 'duo') return r.winner ? '玩家' + r.winner + ' 胜' : (RESULTS[r.result] || '通关');
    if (r.mode === 'ai') return r.result === 'fail' ? '失败' : '胜利';
    return RESULTS[r.result] || '通关';
  }

  /**
   * 一行记录要显示的内容（纯函数）
   * 列表上是六列：玩家 / 模式(难度) / 次数或时间槽 / 结果 / 用时 / 日期
   *   玩家1   计分模式         —       20分    03:24   09-20 15:22
   *   玩家1   限次模式(困难)   余3次    通关    05:12   09-20 15:22
   *   玩家1   计时模式(中等)   剩1:30   通关    04:30   09-20 15:22
   *   玩家1   自由模式         —       通关    01:36   09-20 15:22
   *   玩家1   人机对战         —       胜利    07:41   10-30 15:00
   *   玩家1   本地双人         —       玩家2 胜  06:03  10-30 15:30
   */
  function rowText(rec) {
    var r = sanitize(rec);
    if (!r) return null;
    var mode = MODES[r.mode] || r.mode;
    if (r.diff) mode += '(' + DIFFS[r.diff] + ')';
    // 中间那列：限次看剩余次数、计时看剩余时间、其余留空
    var slot = r.left == null ? '—' : '余' + r.left + '次';
    if (r.mode === 'timed') slot = '剩' + fmtTime(r.timeLeft == null ? 0 : r.timeLeft);
    return { name: r.name, mode: mode, slot: slot, result: resultText(r), time: fmtTime(r.ms), date: fmtDate(r.ts) };
  }

  /** 百分比；分母为 0 时返回 null（"没打过"和"一颗没进"不是一回事） */
  function rate(potted, shots) {
    var s = Math.max(0, Number(shots) || 0);
    if (!s) return null;
    return Math.max(0, Math.min(1, (Number(potted) || 0) / s));
  }

  /** 秒级精度（平均瞄准时间动不动就是 3.2 秒这种，fmtTime 的 mm:ss 太粗） */
  function fmtSec(ms) {
    return (Math.max(0, Number(ms) || 0) / 1000).toFixed(1) + ' 秒';
  }

  /**
   * 一条记录的完整详情（纯函数，点开历史记录时的弹窗读它）
   * ------------------------------------------------------------------
   * 一局的"过程"全在这里：打进几颗、打了几杆、准度如何、平均每杆瞄了多久。
   * 老记录缺字段时显示"—"而不是 0 —— 0 颗进球和"没记录"必须能分辨。
   */
  function detailRows(rec) {
    var r = sanitize(rec);
    if (!r) return null;
    var rows = [];
    var q = function (v) { return v == null ? '—' : v; };
    var mode = MODES[r.mode] || r.mode;
    if (r.diff) mode += ' · ' + DIFFS[r.diff];
    rows.push({ k: '玩法模式', v: mode });
    rows.push({ k: '玩家', v: r.name });
    rows.push({
      k: '结果',
      v: resultText(r),
      tone: r.result === 'fail' ? 'fail' : 'ok'
    });
    if (r.mode === 'duo' && r.winner) rows.push({ k: '获胜方', v: '玩家' + r.winner });
    rows.push({ k: '用时', v: fmtTime(r.ms) });
    if (r.mode === 'limit') rows.push({ k: '剩余次数', v: q(r.left == null ? null : r.left + ' 次') });
    if (r.mode === 'timed') rows.push({ k: '剩余时间', v: q(r.timeLeft == null ? null : fmtTime(r.timeLeft)) });
    rows.push({ k: '击球次数', v: r.shots + ' 杆' });
    if (r.total > 0) {
      rows.push({ k: '进球', v: r.potted + ' / ' + r.total + ' 颗' });
      var p = rate(r.potted, r.shots);
      rows.push({ k: '进球率', v: p == null ? '—' : Math.round(p * 100) + '%' });
    }
    rows.push({ k: '最高连击', v: r.best >= 2 ? r.best + ' 连' : '—' });
    // 平均瞄准：没统计到任何一杆（每杆都直接开球）就是"—"，不写 0.0 秒
    rows.push({
      k: '平均瞄准',
      v: r.aimMs == null ? '—' : fmtSec(r.aimMs) + (r.aimCount > 0 ? '（' + r.aimCount + ' 杆）' : '')
    });
    rows.push({ k: '视角模式', v: q(r.view ? VIEWS[r.view] : null) });
    rows.push({ k: '时间', v: fmtDate(r.ts) });
    return rows;
  }

  var api = {
    KEY: KEY,
    MAX: MAX,
    TABS: TABS,
    MODES: MODES,
    SCORED: SCORED,
    GROUPS: GROUPS,
    DIFFS: DIFFS,
    VIEWS: VIEWS,
    storage: storage,
    setStorage: setStorage,
    sanitize: sanitize,
    read: read,
    write: write,
    add: add,
    list: list,
    clear: clear,
    fmtTime: fmtTime,
    fmtSec: fmtSec,
    fmtDate: fmtDate,
    rate: rate,
    rowText: rowText,
    detailRows: detailRows
  };

  if (typeof window !== 'undefined') window.HMZQHistory = api;
  // Node 测试直接 require('public/history.js') 就能拿到（浏览器里没有 module，不会走到这行）
  if (typeof module === 'object' && module && module.exports) module.exports = api;
})();
