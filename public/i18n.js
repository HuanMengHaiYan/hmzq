/**
 * 中英文切换 · 运行时（经典脚本，无打包器参与）
 * ------------------------------------------------------------------
 * 为什么放在 public/：启动器（launcher.html）与游戏页（index.html）都要用，
 * 而启动器不能 import src/ 的模块 —— 两份页面各 <script src="i18n.js"> 引一次，
 * 实现只有一份（同 history.js 的思路）。
 *
 * 设计：**按中文原文查表**，不搞 key 表
 * ------------------------------------------------------------------
 * 全项目有 400+ 条界面文案，散在 HTML 与十几个 JS 里。给每一处加 key
 * （`t('settings.minPower')`）意味着要改几百个调用点，改漏一处就漏一处中文；
 * 而「按原文查」只要维护一份 中文 → 英文 的对照表：
 *
 *   HMZQ_EN = { '开球': 'Break', '重开本局': 'Restart', ... };
 *
 * 运行时把 DOM 里的文本节点、标题/占位符属性逐个拿原文去查，
 * 含变量的（`玩家2 胜`、`余 3 次`）走 HMZQ_EN_RULES 里的正则规则。
 * JS 不用改：它照旧往 DOM 里写中文，翻译由这里统一接管。
 *
 * 三条硬约束（踩过才知道）：
 *   ① **不能靠 innerHTML 整块替换带交互的元素**：替换会丢掉已经绑好的事件监听。
 *      所以整块替换只对"纯排版标签"（b/i/kbd/span…）生效，遇到 button/input 就下沉到子节点。
 *   ② **译文必须能还原**：原文存在 nodes/attrs 两个 Map 里，切回中文时逐条写回；
 *      节点被 JS 改过（`data !== 记录值`）就不还原，别覆盖业务代码的新内容。
 *   ③ **自己写的译文不能再触发翻译**：靠"当前值 === 记录里的译文"判定，
 *      不用抑制标志 —— 标志在异步 MutationObserver 下有竞态。
 *
 * 语法保持 ES2019 以内：本文件原样下发，不经过 esbuild 降级。
 */
(function (global) {
  'use strict';

  var KEY = 'hmzq.lang.v1';
  var CJK = /[\u3400-\u4dbf\u4e00-\u9fff]/;      // 汉字（含扩展 A）：没有就不必查表
  var WS = /[\s\u3000]+/g;                        // 归一化用（含全角空格）
  var LEAD_TRAIL = /^(\s*)([\s\S]*?)(\s*)$/;

  /* 允许整块替换的标签：纯排版、没有事件、没有 data-* 语义 */
  var SAFE_TAG = {
    B: 1, I: 1, EM: 1, STRONG: 1, KBD: 1, CODE: 1, BR: 1,
    SPAN: 1, SMALL: 1, SUP: 1, SUB: 1, WBR: 1, U: 1, S: 1,
  };
  var ATTRS = ['title', 'placeholder', 'alt', 'aria-label'];

  var dict = {};
  var rules = [];
  var lang = 'zh';

  /* 原始值台账：node → { zh, en } / element → { zh(innerHTML), en, attrs:{name:{zh,en}} } */
  var nodes = new Map();
  var docTitleZh = '';

  /* ---------------- 读表 ---------------- */

  function loadDict() {
    if (global.HMZQ_EN && typeof global.HMZQ_EN === 'object') dict = global.HMZQ_EN;
    if (Object.prototype.toString.call(global.HMZQ_EN_RULES) === '[object Array]') {
      rules = global.HMZQ_EN_RULES;
    }
  }

  function norm(s) {
    return String(s == null ? '' : s).replace(WS, ' ').trim();
  }

  /** 中文原文 → 英文；查不到返回 null（保持原样，不猜） */
  function lookup(raw) {
    var k = norm(raw);
    if (!k || !CJK.test(k)) return null;
    if (Object.prototype.hasOwnProperty.call(dict, k)) return dict[k];
    for (var i = 0; i < rules.length; i++) {
      if (rules[i][0].test(k)) return k.replace(rules[i][0], rules[i][1]);
    }
    return null;
  }

  /** 保留首尾空白（行内元素之间的换行/缩进参与排版，吃掉会贴在一起） */
  function keepSpace(src, en) {
    var m = LEAD_TRAIL.exec(src);
    if (!m) return en;
    return m[1] + en + m[3];
  }

  /* ---------------- 翻译单个节点 ---------------- */

  function translateText(node) {
    var cur = node.data;
    var rec = nodes.get(node);
    if (rec && rec.out === cur) return;             // 已经是我们写的译文
    var en = lookup(cur);
    if (en == null) { if (rec) nodes.delete(node); return; }
    /* out = 真正写进 DOM 的那串（首尾空白保留）—— 还原与"是不是我们写的"都拿它比，
       不能拿 en 比：带缩进的文本节点写回去时前面是空格+换行，永远不等于 en。 */
    var out = keepSpace(cur, en);
    nodes.set(node, { zh: cur, en: en, out: out });
    node.data = out;
  }

  function translateAttrs(el) {
    for (var i = 0; i < ATTRS.length; i++) {
      var a = ATTRS[i];
      if (!el.hasAttribute || !el.hasAttribute(a)) continue;
      var cur = el.getAttribute(a);
      var rec = nodes.get(el);
      var slot = rec && rec.attrs && rec.attrs[a];
      if (slot && slot.en === cur) continue;
      var en = lookup(cur);
      if (en == null) { if (slot) delete rec.attrs[a]; continue; }
      if (!rec) { rec = { zh: null, en: null, out: null, attrs: {} }; nodes.set(el, rec); }
      if (!rec.attrs) rec.attrs = {};
      rec.attrs[a] = { zh: cur, en: en, out: en };
      el.setAttribute(a, en);
    }
  }

  /** 子节点全是排版标签、且没有带属性（data-… / on… 之类）→ 允许整块换 innerHTML */
  function markupSafe(el) {
    var kids = el.querySelectorAll('*');
    for (var i = 0; i < kids.length; i++) {
      var k = kids[i];
      if (!SAFE_TAG[k.tagName]) return false;
      if (k.attributes.length) return false;
    }
    return true;
  }

  function translateElement(el) {
    if (!el.childElementCount) return false;        // 叶子：交给文本节点那条路
    if (!markupSafe(el)) return false;
    /* 两种 key 都认：
       ① 纯文本（HTML 里手写的整段，词表按"读起来的样子"记，最好写）
       ② 带标签的原文（JS 里 innerHTML 拼出来的整段，词表直接抄源码，最不会错） */
    var en = lookup(el.textContent);
    if (en == null) en = lookup(el.innerHTML);
    if (en == null) return false;
    var rec = nodes.get(el);
    if (rec && rec.out != null && el.innerHTML === rec.out) return true;  // 已是我们写的
    if (!rec) { rec = { zh: null, en: null, out: null, attrs: null }; nodes.set(el, rec); }
    rec.zh = el.innerHTML;                          // 业务代码改写过时以当前值为准
    rec.en = en;
    rec.out = en;                                   // 真正写进 DOM 的值 —— 还原时拿它比
    el.innerHTML = en;
    return true;
  }

  function skipped(el) {
    for (var n = el; n && n.nodeType === 1; n = n.parentElement) {
      if (n.hasAttribute('data-i18n-skip')) return true;
    }
    return false;
  }

  /**
   * 遍历一棵子树并翻译（幂等：连跑两次结果一样）
   * @param root 元素或文本节点
   */
  function walk(root) {
    if (!root) return;
    if (root.nodeType === 3) { translateText(root); return; }
    if (root.nodeType !== 1) return;
    if (skipped(root)) return;
    translateAttrs(root);
    if (translateElement(root)) return;             // 整块换掉了，子节点已是英文
    var kids = root.childNodes;
    for (var i = 0; i < kids.length; i++) {
      var k = kids[i];
      if (k.nodeType === 1 || k.nodeType === 3) walk(k);
    }
  }

  /* ---------------- 还原成中文 ---------------- */

  /** 只还原"还是我们那版译文"的节点，被业务代码改过的一律不动 */
  function restoreAll() {
    nodes.forEach(function (rec, node) {
      if (node.nodeType === 3) {
        if (rec.zh != null && node.data === rec.out) node.data = rec.zh;
        return;
      }
      if (!node.isConnected) return;
      if (rec.attrs) {
        Object.keys(rec.attrs).forEach(function (a) {
          var slot = rec.attrs[a];
          if (node.getAttribute(a) === slot.out) node.setAttribute(a, slot.zh);
        });
      }
      if (rec.zh != null && rec.out != null && node.innerHTML === rec.out) node.innerHTML = rec.zh;
    });
    nodes.clear();
  }

  /** 掉出文档的节点积在 Map 里会一直涨（历史列表每重建一次就多几十个） */
  function prune() {
    if (nodes.size < 400) return;
    var dead = [];
    nodes.forEach(function (rec, node) {
      var host = node.nodeType === 3 ? node.parentNode : node;
      if (!host || !host.isConnected) dead.push(node);
    });
    for (var i = 0; i < dead.length; i++) nodes.delete(dead[i]);
  }

  /* ---------------- 语言状态 ---------------- */

  function readLang() {
    try {
      var e = global.__electron;
      if (e && e.settings) {
        var s = e.settings.get(KEY);
        if (s) return s === 'en' ? 'en' : 'zh';      // Electron 落盘（file:// 下 localStorage 不可靠）
      }
    } catch (err) { /* 落到 localStorage */ }
    try {
      var v = global.localStorage.getItem(KEY);
      return v === 'en' ? 'en' : 'zh';
    } catch (err2) { return 'zh'; }
  }

  function saveLang(l) {
    try {
      var e = global.__electron;
      if (e && e.settings) { e.settings.set(KEY, l); return; }
    } catch (err) { /* 落到 localStorage */ }
    try { global.localStorage.setItem(KEY, l); } catch (err2) { /* 隐私模式：静默 */ }
  }

  function applyDocLang() {
    var el = global.document && global.document.documentElement;
    if (el) el.setAttribute('lang', lang === 'en' ? 'en' : 'zh-CN');
    if (global.document) {
      if (!docTitleZh) docTitleZh = global.document.title;
      global.document.title = lang === 'en' ? (lookup(docTitleZh) || docTitleZh) : docTitleZh;
    }
  }

  var listeners = [];
  function fire() {
    for (var i = 0; i < listeners.length; i++) {
      try { listeners[i](lang); } catch (e) { /* 订阅方自己的锅，别连累别人 */ }
    }
    try {
      global.dispatchEvent(new global.CustomEvent('hmzq:lang', { detail: { lang: lang } }));
    } catch (e2) { /* 老内核没有 CustomEvent 构造器 */ }
  }

  /**
   * 切换语言
   * @param {string} l 'zh' | 'en'
   * @param {boolean} [silent] 初始化用：不触发回调
   */
  function setLang(l, silent) {
    var next = l === 'en' ? 'en' : 'zh';
    var changed = next !== lang;
    lang = next;
    if (changed) saveLang(lang);
    if (!silent) {
      if (lang === 'zh') {
        restoreAll();
        /* 注意：这里绝不能再 walk —— translateText 不看当前语言，
           一 walk 就把刚还原的中文原样又翻回英文（中文模式下 DOM 本来就该是中文，
           没记录的节点从未被翻过，不需要处理）。 */
      } else {
        nodes.clear();                              // DOM 此刻是中文原文，重翻一遍
      }
      applyDocLang();
      prune();
      fire();
    }
    return lang;
  }

  function getLang() { return lang; }

  /** JS 侧偶尔需要（拼进 innerHTML 的那些），优先把中文写进 DOM 让 walk 接管 */
  function t(zh) {
    if (lang !== 'en') return zh;
    var en = lookup(zh);
    return en == null ? zh : en;
  }

  /* ---------------- 自动接管后续 DOM 变化 ---------------- */

  var mo = null;
  function startObserver() {
    if (typeof global.MutationObserver !== 'function' || !global.document) return;
    mo = new global.MutationObserver(function (records) {
      if (lang !== 'en') return;                     // 中文模式没有可做的
      for (var i = 0; i < records.length; i++) {
        var r = records[i];
        if (r.type === 'characterData') { translateText(r.target); continue; }
        if (r.type === 'attributes') { translateAttrs(r.target); continue; }
        var added = r.addedNodes;
        for (var j = 0; j < added.length; j++) walk(added[j]);
      }
    });
    mo.observe(global.document.documentElement, {
      childList: true, subtree: true, characterData: true,
      attributes: true, attributeFilter: ATTRS,
    });
  }

  function boot() {
    applyDocLang();
    if (lang === 'en') walk(global.document.body);
    startObserver();
  }

  loadDict();
  lang = readLang();
  if (global.document && global.document.documentElement) {
    global.document.documentElement.setAttribute('lang', lang === 'en' ? 'en' : 'zh-CN');
  }
  if (global.document) {
    if (global.document.readyState === 'loading') {
      global.document.addEventListener('DOMContentLoaded', boot);
    } else {
      boot();
    }
  }

  global.HMZQ_I18N = {
    KEY: KEY,
    getLang: getLang,
    setLang: setLang,
    /** 让外部（例如切换按钮）订阅语言变化 */
    onChange: function (fn) { if (typeof fn === 'function') listeners.push(fn); },
    t: t,
    /** 手动翻一棵子树（懒加载的弹窗内容用得上） */
    apply: function (root) { if (lang === 'en') walk(root || global.document.body); },
    /** 只查表，不改 DOM（测试与文案校对用） */
    lookup: lookup,
    dictCount: function () { return Object.keys(dict).length + rules.length; },
  };
}(typeof window !== 'undefined' ? window : globalThis));
