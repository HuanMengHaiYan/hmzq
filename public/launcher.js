/**
 * 幻梦-星光桌球 · 启动器（经典脚本，无打包器参与）
 * 职责：多级路由 · 设置读写与持久化 · 带参数进游戏 · 规则设置 · 声音设置 · 退出。
 * Electron 走 preload 的 IPC 落盘，浏览器走 localStorage。
 *
 * --------------------------------------------------------------------------
 * 路由 = 一级菜单项 + 树状的 section[data-page="a/b"]（父子关系写在 data-parent 上）：
 *   start                   常规模式（一级菜单）
 *     start/solo            选玩法
 *       start/solo/limit    选难度 → 进球台
 *       start/solo/timed    选难度 → 进球台
 *     start/ai              人机难度（四档）→ 进球台
 *   fun                     娱乐模式（一级菜单）
 *     fun/freeball          自由球玩法页
 *   settings                游戏设置（一级菜单，四个分类入口）
 *     settings/game | audio | quality | rules（二级）
 *   history / help / about / quit 是平铺的一级页。
 *
 * 为什么"选模式"与"选难度"要各自独立成一页：这两层以后还会继续加项（人机、联机、
 * 更多娱乐玩法），摊在同一屏里会越叠越高。独立子路由每屏只做一件事，加新项也不重排版面。
 *
 * ⚠️ 设置项的 key、默认值与球组列表必须和 src/prefs.js / src/rules.js / src/audio.js
 *    保持一致（两边各留一份，因为启动器是 public/ 下的独立页面，不能 import 源码）。
 */
(function () {
  'use strict';

  var VERSION = '0.8.0-test';           // 与 package.json 的 version 保持一致
  var PREFS_KEY = 'hmzq.prefs.v1';
  var AUDIO_KEY = 'hmzq.audio.v1'; // 游戏里的 AudioEngine 也用它（src/audio.js）
  var QUALITY_KEY = 'hmzq.quality.v1';  // 游戏里的 Quality 也用它（src/quality.js）
  var DEFAULTS = {
    min: 0.05, max: 1.20, mode: 'tracking', balls: '15',
    name: '玩家1',     // 玩家名：显示在挑战历史里
    game: 'free', diff: 'normal',   // 玩法模式只在"点进游戏"那一刻随 URL 带过去，不落盘
    ghost: 'on',       // 镜像 src/prefs.js：轮到自己时把不该打的球半透明化（'on' | 'off'）
    // 本地双人的规则（镜像 src/duo.js 的 DUO_RULE_DEFAULTS，改一边必须同步另一边）
    breakAssign: 'never', breakEight: 'rerack', cueFoul: 'ballInHand', earlyEight: 'lose',
    // 犯规罚则（0.7.0，镜像 src/duo.js 的 DUO_FOUL_PENALTY；默认全关 = 只换人）
    foulMiss: 'none', foulWrongBall: 'none', foulNoPot: 'none'
  };

  /* 本地双人 · 可改的规则（镜像 src/duo.js 的 DUO_RULE_TABLES）
     只在「本地双人模式」里生效；改完立刻存盘，进球台时由 src/prefs.js 读出来交给 DuoMatch。
     ⚠️ 顺序与选项文案要和 duo.js 保持一致 —— 加规则 / 改默认值时两边必须一起动。 */
  var DUO_RULES = [
    { key: 'breakAssign', label: '开局进球判定', note: '开球那一杆只进 1 颗球时，算不算定下大小号', opts: [
      { id: 'never', name: '第一杆进洞不分组', desc: '开球进 1 颗只算进球、由开球方继续打；进 2 颗及以上才判定分组。' },
      { id: 'always', name: '第一杆进洞就分组', desc: '开球只要进 1 颗球，就按这颗球的号定下双方的大小号。' }
    ] },
    { key: 'breakEight', label: '未分组时进黑八', note: '开球那一杆，或还没人进过球就打进了 8 号', opts: [
      { id: 'rerack', name: '本局重来', desc: '整局重新开球，球全部摆回、分组清零，由原来开球的人重新开球。' },
      { id: 'respot', name: '黑八归位，换人继续', desc: '这次进黑八不算数，黑八摆回初始位置，换对手接着打，本局继续。' },
      { id: 'lose', name: '击球者直接判负', desc: '打进黑八的人直接输掉这一局，本局结束。' }
    ] },
    { key: 'cueFoul', label: '白球落袋', note: '白球掉袋之后接手的那一方怎么摆白球（每一杆都适用，含开球）', opts: [
      { id: 'ballInHand', name: '对方自由摆球', desc: '换人，接手的一方可以在台面任意位置摆白球（手中球）。' },
      { id: 'headSpot', name: '白球回开球点', desc: '换人，白球放回开球点，接手的一方从开球点打。' }
    ] },
    { key: 'earlyEight', label: '已分组后提前进黑八', note: '已经定了大小号，自己的球还没清完就打进了 8 号', opts: [
      { id: 'lose', name: '直接判输', desc: '自己的球没清完就打进黑八 → 直接判负，本局结束。' },
      { id: 'penalty', name: '罚一颗 + 黑八回位', desc: '罚一颗已经打进的球重新摆回台面，黑八也摆回初始位置，然后换人。一颗都还没进就直接打进黑八 → 判负。' }
    ] },
    /* ---- 犯规罚则（0.7.0，体检 G4）：默认全关，与 0.6.x 行为一致 ---- */
    { key: 'foulWrongBall', label: '打错球组犯规', note: '第一下碰到的不是自己组的球（没清完时先碰黑八也算）', opts: [
      { id: 'none', name: '不罚，只换人', desc: '保持宽松：犯规的那一杆只换人，对方从白球现在的位置接着打。' },
      { id: 'ballInHand', name: '判罚手中球', desc: '犯规 → 换人，接手的一方可以把白球摆到台面任意位置（真实规则的自由球）。' }
    ] },
    { key: 'foulMiss', label: '空杆犯规', note: '出杆后白球没碰到任何球', opts: [
      { id: 'none', name: '不罚，只换人', desc: '保持宽松：空杆只换人，对方从白球现在的位置接着打。' },
      { id: 'ballInHand', name: '判罚手中球', desc: '空杆 → 换人，接手的一方可以把白球摆到台面任意位置。' }
    ] },
    { key: 'foulNoPot', label: '击球后没进袋', note: '这一杆一颗球都没打进（真实中式规则没有这条，可选的严格玩法）', opts: [
      { id: 'none', name: '不罚，只换人', desc: '默认：没进球就正常换人，不加别的判罚。' },
      { id: 'ballInHand', name: '判罚手中球', desc: '没进球也算犯规 → 换人，接手的一方可以把白球摆到台面任意位置。' }
    ] }
  ];
  var DUO_RULE_IDS = {};   // key → [合法值]
  DUO_RULES.forEach(function (r) {
    DUO_RULE_IDS[r.key] = r.opts.map(function (o) { return o.id; });
  });
  var AUDIO_DEFAULTS = { sfx: 0.85, music: 0.4, bgm: 'lounge' };
  var MIN_GAP = 0.05;              // 最小/最大力度之间至少留的空隙
  var MODE_HINT = {
    free: '自由：右键拖拽旋转视角（相机即方向），中键平移、滚轮缩放，斜俯视角。',
    tracking: '追踪：视角自动对焦到白球后方，瞄准方向跟随相机，最接近真人站位。',
    top: '顶视：正交俯视、视角固定，移动鼠标改变杆向，适合看清走位与角度。',
  };
  var BGM_HINT = {
    lounge: '舒缓的爵士三重奏，适合慢慢打。（Bar Bugz - Backbay Lounge，CC BY 3.0）',
    park: '轻快的 Swing 小曲，节奏更明快。（Jazz at the park，CC0 公有领域）',
    off: '不播放背景音乐，球台内的音效照常。',
  };

  /* 玩法规则表（镜像 src/rules.js 的 BALL_SETS，改一边必须同步另一边）
     9 球 / 3 球两套已移除（2026-09-25）；斯诺克与俄式是**占位**，还没开发。 */
  var BALL_SETS = [
    { id: '15', name: '中式黑八', sub: '标准玩法', count: 15, shape: '五排三角形（1/2/3/4/5）',
      desc: '1~15 号全彩球摆成五排三角形，8 号居中。1~7 全色、9~15 半色，8 号决胜。' },
  ];
  /* 未来开发、现阶段不做的玩法：渲染成禁用按钮，点了只会提示"敬请期待"。
     做成数据而不是写死进 HTML，是为了将来真开发时只改这一处就能点亮。 */
  var BALL_SET_SOON = [
    { id: 'snooker', name: '斯诺克规则', sub: '未来开发' },
    { id: 'russian', name: '俄式规则', sub: '未来开发' },
  ];
  var BALL_SET_IDS = BALL_SETS.map(function (s) { return s.id; });

  var electron = window.__electron;

  /* ---------------- 设置读写 ---------------- */
  function clampNum(v, lo, hi, d) {
    v = parseFloat(v);
    if (!isFinite(v)) return d;
    return Math.min(hi, Math.max(lo, v));
  }

  function sanitize(raw) {
    var o = Object.assign({}, DEFAULTS, raw || {});
    o.min = clampNum(o.min, 0.05, 1.00, DEFAULTS.min);
    o.max = clampNum(o.max, 0.10, 1.50, DEFAULTS.max);
    if (o.max < o.min + MIN_GAP) o.max = Math.min(1.5, o.min + MIN_GAP);
    if (!MODE_HINT[o.mode]) o.mode = DEFAULTS.mode;
    if (BALL_SET_IDS.indexOf(o.balls) < 0) o.balls = DEFAULTS.balls;
    o.name = String(o.name == null ? '' : o.name).trim().slice(0, 12) || DEFAULTS.name;
    if (o.ghost !== 'off') o.ghost = 'on';       // 镜像 src/prefs.js：只有 'off' 是关
    // 双人规则：只认表里有的值，写坏了回落默认
    Object.keys(DUO_RULE_IDS).forEach(function (k) {
      if (DUO_RULE_IDS[k].indexOf(o[k]) < 0) o[k] = DEFAULTS[k];
    });
    return o;
  }

  function readStore(key) {
    key = key || PREFS_KEY;
    // Electron：主进程落盘到 userData/settings.json（file:// 下 localStorage 不可靠）
    if (electron && electron.settings) {
      try {
        var s = electron.settings.get(key);
        return s ? JSON.parse(s) : {};
      } catch (e) { /* 落到下面 */ }
    }
    try { return JSON.parse(localStorage.getItem(key) || '{}'); } catch (e) { return {}; }
  }

  function writeStore(value, key) {
    key = key || PREFS_KEY;
    var json = JSON.stringify(value);
    if (electron && electron.settings) {
      try { electron.settings.set(key, json); return; } catch (e) { /* 落到下面 */ }
    }
    try { localStorage.setItem(key, json); } catch (e) { /* 忽略 */ }
  }

  var prefs = sanitize(readStore());

  var saveTimer = 0;
  function savePrefs() {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(function () {
      writeStore(prefs);
      flashSaved();
    }, 220);
  }

  /* ---------------- 元素 ---------------- */
  var stage = document.getElementById('stage');
  var menuItems = Array.prototype.slice.call(document.querySelectorAll('.mi'));
  var pages = Array.prototype.slice.call(document.querySelectorAll('.page'));
  var backBtn = document.getElementById('back');
  var toastEl = document.getElementById('toast');
  var savedEl = document.getElementById('p-saved');
  var ballsSavedEl = document.getElementById('p-balls-saved');
  var backTxt = document.getElementById('back-txt');
  var sel = 0;

  /* 「已保存」提示：四个设置二级页各有自己的一枚，改动谁就闪谁（比隔着一页闪直观） */
  var SAVED_OF = {
    'settings/game': 'saved-game',
    'settings/audio': 'saved-audio',
    'settings/quality': 'saved-quality',
    'settings/rules/solo': 'p-balls-saved',
    'settings/rules/duo': 'p-duo-saved',
  };

  document.getElementById('ver').textContent = '自由练习版 v' + VERSION;
  document.getElementById('about-ver').textContent = 'v' + VERSION + (electron ? ' · 桌面版' : ' · 网页版');

  /* ---------------- 路由 ----------------
     每个 section[data-page] 就是一个路由。层级关系全部由 data-parent 推导 ——
     加一个新子页只要写对 data-page / data-parent 这两个属性，
     菜单高亮、返回、面包屑都会自动跟上，不用回来改代码。
  */
  var HOME = 'start';
  var cur = HOME;

  function pageOf(route) {
    for (var i = 0; i < pages.length; i++) {
      if (pages[i].dataset.page === route) return pages[i];
    }
    return null;
  }
  function parentOf(route) {
    var p = pageOf(route);
    return (p && p.dataset.parent) || '';
  }
  function rootOf(route) {
    var i = route.indexOf('/');
    return i < 0 ? route : route.slice(0, i);
  }
  function titleOf(route) {
    var p = pageOf(route);
    var h = p && p.querySelector('.ph h2');
    return h ? h.textContent : route;
  }

  /**
   * 竖屏手机走二级页面：一级 = 整屏竖向主菜单，二级 = 内容页 + 返回键。
   * 靠 <body data-lv="2"> 切换，样式在 launcher.css 的同一条媒体查询里
   * （⚠️ 两边必须一致：横屏的顶部标签栏本来就摆得下，桌面更是左右两栏同屏，都不走这条路）。
   */
  var TWO_LEVEL = '(max-width: 980px) and (orientation: portrait)';

  function isNarrow() {
    return window.matchMedia(TWO_LEVEL).matches;
  }

  function setLv(n) {
    if (n === 2) document.body.dataset.lv = '2';
    else document.body.removeAttribute('data-lv');
    stage.scrollTop = 0;
  }

  /**
   * 返回键 / 浏览器后退：只要停在内容页里，就一定保留"一条多余的 history 记录"，
   * 于是手机（微信里点返回会整页离开）与 Android 实体返回键都先被我们接住，
   * 每一层"往上退"之后再把它补回来 —— 退回动作可以一层层走，不会一步跨出启动器。
   * 启动器是 public/ 下的独立页面、拿不到 Capacitor 插件，只能靠 history。
   */
  function ensureEntry() {
    if (!window.history || !window.history.pushState) return;
    var st = window.history.state;
    if (st && st.hmzq === 1) return;
    window.history.pushState({ hmzq: 1 }, '');
  }

  function go(route) {
    var page = pageOf(route);
    if (!page) return;
    closeDetail();                 // 切页先收弹窗（详情是模态的，跨页留着会挡住新页面）
    cur = route;
    pages.forEach(function (p) { p.classList.toggle('on', p === page); });
    var r = rootOf(route);
    menuItems.forEach(function (b, i) {
      var on = b.dataset.go === r;   // 子路由点亮它所属的那个一级菜单项
      b.classList.toggle('on', on);
      if (on) sel = i;
    });
    stage.scrollTop = 0;
    // 一律标成"已进内容页"：属性本身没副作用（样式只在竖屏窄屏生效），
    // 好处是横屏看设置时把手机转成竖屏，不会把当前页甩回一级菜单。
    setLv(2);
    ensureEntry();                 // 让"下一次返回"始终有东西可 pop
    syncBack();
    if (route === 'history') renderHistory();   // 每次进挑战历史都重读一遍（可能刚打完一局）
  }

  /** 返回上一级：有父页就回父页，已是一级页就退回主菜单（手机） */
  function backOne() {
    var up = parentOf(cur);
    if (up) go(up);
    else setLv(1);
  }

  /** 顶上的返回键文案跟着层级走（主菜单 / 常规模式 / 单人模式 …） */
  function syncBack() {
    if (!backTxt) return;
    var up = parentOf(cur);
    backTxt.textContent = up ? titleOf(up) : '主菜单';
  }

  Array.prototype.forEach.call(document.querySelectorAll('[data-go]'), function (b) {
    b.addEventListener('click', function () {
      var i = menuItems.indexOf(b);
      if (i >= 0) sel = i;
      go(b.dataset.go);
      b.blur();
    });
  });

  /* 子页面包屑按钮：不写死目标，一律"回到我这一层的父级" */
  Array.prototype.forEach.call(document.querySelectorAll('[data-up]'), function (b) {
    b.addEventListener('click', function () { backOne(); b.blur(); });
  });

  if (backBtn) backBtn.addEventListener('click', function () { backOne(); backBtn.blur(); });

  window.addEventListener('popstate', function () {
    if (document.body.dataset.lv !== '2') return;
    closeDetail();                 // 从内容页返回时把单局详情也收掉，别让它挂在别的页上
    var up = parentOf(cur);
    if (up) go(up);                // 逐层往上退（go 里的 ensureEntry 会把记录补回来）
    else setLv(1);                 // 已经是一级页：这一步真的退出内容页
  });

  function moveSel(step) {
    sel = (sel + step + menuItems.length) % menuItems.length;
    menuItems[sel].focus();
    go(menuItems[sel].dataset.go);
  }

  /* ---------------- 提示条 ---------------- */
  var toastTimer = 0;
  function toast(msg) {
    toastEl.textContent = msg;
    toastEl.classList.add('on');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { toastEl.classList.remove('on'); }, 2000);
  }

  function flash(el) {
    if (!el) return;
    el.classList.add('on');
    setTimeout(function () { el.classList.remove('on'); }, 1400);
  }
  /**
   * 「已保存」：谁改动就闪谁 —— 优先闪当前所在的那个设置二级页，
   * 落不到具体的（比如刚从主菜单恢复默认）就闪设置首页那枚。
   */
  function flashSaved() {
    var id = SAVED_OF[cur] || 'p-saved';
    flash(document.getElementById(id));
  }
  function flashBallsSaved() { flash(ballsSavedEl); }

  /* ---------------- 未开放的模式 ---------------- */
  Array.prototype.forEach.call(document.querySelectorAll('[data-soon]'), function (btn) {
    btn.addEventListener('click', function () {
      toast((btn.dataset.soon || '该模式') + '：后续阶段开发中');
    });
  });

  /* ---------------- 进入游戏 ---------------- */
  /**
   * @param game 玩法模式 id（free / score / limit / timed）；不传就是自由模式
   * @param diff 难度（easy / normal / hard / extreme）—— 限次与计时是关卡难度，人机是电脑的水平
   * 玩法模式只在 URL 里带过去、不写进存储：下次从"自由模式"卡片进来时仍是自由模式，
   * 不会因为上次打过计分就莫名其妙变计分。
   */
  function enterGame(game, diff) {
    // 用查询参数把设置带过去：即便存储不可用，游戏也一定拿到正确的启动配置
    var q = [
      'mode=' + encodeURIComponent(prefs.mode),
      'balls=' + encodeURIComponent(prefs.balls),
      'lock=1',
      'min=' + prefs.min.toFixed(2),
      'max=' + prefs.max.toFixed(2),
      'from=launcher',
      'game=' + encodeURIComponent(game || 'free'),
    ];
    // 限次 / 计时带的是"关卡难度"；人机对战带的是"电脑的水平"（easy / normal / hard / extreme）
    if (game === 'limit' || game === 'timed' || game === 'ai') {
      q.push('diff=' + encodeURIComponent(diff || DEFAULTS.diff));
    }
    document.body.classList.add('leaving');
    setTimeout(function () { location.href = 'index.html?' + q.join('&'); }, 240);
  }

  /* 单人模式（计分 / 限次 / 计时）与自由 / 自由球 —— 难度只有限次与计时带着 */
  Array.prototype.forEach.call(document.querySelectorAll('[data-enter-game]'), function (btn) {
    btn.addEventListener('click', function () {
      enterGame(btn.dataset.enterGame, btn.dataset.diff);
    });
  });

  /* ---------------- 游戏设置 ---------------- */
  var minEl = document.getElementById('p-min');
  var maxEl = document.getElementById('p-max');
  var minV = document.getElementById('p-min-v');
  var maxV = document.getElementById('p-max-v');
  var modeBox = document.getElementById('p-mode');
  var modeHint = document.getElementById('p-mode-hint');
  var nameEl = document.getElementById('p-name');

  /* 玩家名：挑战历史里显示的那一项 */
  if (nameEl) {
    nameEl.addEventListener('input', function () {
      prefs.name = String(nameEl.value).trim().slice(0, 12) || DEFAULTS.name;
      savePrefs();
    });
    nameEl.addEventListener('blur', function () {
      prefs = sanitize(prefs);
      nameEl.value = prefs.name;      // 空输入回落成"玩家1"
      savePrefs();
    });
  }

  function syncSettings() {
    minEl.value = prefs.min.toFixed(2);
    maxEl.value = prefs.max.toFixed(2);
    minV.textContent = prefs.min.toFixed(2);
    maxV.textContent = prefs.max.toFixed(2);
    if (nameEl && document.activeElement !== nameEl) nameEl.value = prefs.name;
    Array.prototype.forEach.call(modeBox.children, function (b) {
      b.classList.toggle('on', b.dataset.mode === prefs.mode);
    });
    modeHint.textContent = MODE_HINT[prefs.mode];
  }

  function onSlide() {
    prefs.min = clampNum(minEl.value, 0.05, 1.00, DEFAULTS.min);
    prefs.max = clampNum(maxEl.value, 0.10, 1.50, DEFAULTS.max);
    // 两者不能贴太近，否则"力度区间"被压成一条线
    if (prefs.max < prefs.min + MIN_GAP) prefs.max = Math.min(1.5, prefs.min + MIN_GAP);
    if (prefs.min > prefs.max - MIN_GAP) prefs.min = Math.max(0.05, prefs.max - MIN_GAP);
    syncSettings();
    savePrefs();
  }

  minEl.addEventListener('input', onSlide);
  maxEl.addEventListener('input', onSlide);

  /* ---------------- 声音设置（实现在 public/launcher-audio.js） ---------------- */
  var audioPanel = new LauncherAudio({
    key: AUDIO_KEY, defaults: AUDIO_DEFAULTS, hints: BGM_HINT,
    read: readStore, write: writeStore, flash: flashSaved,
  });
  audioPanel.mount();

  /* ---------------- 画质（实现在 public/launcher-quality.js） ---------------- */
  var qualityPanel = new LauncherQuality({
    read: readStore, write: writeStore, flash: flashSaved,
  });
  qualityPanel.mount();

  modeBox.addEventListener('click', function (e) {
    var b = e.target.closest('button[data-mode]');
    if (!b) return;
    prefs.mode = b.dataset.mode;
    syncSettings();
    savePrefs();
  });

  document.getElementById('p-reset').addEventListener('click', function () {
    prefs = sanitize(DEFAULTS);
    syncSettings();
    syncBallSets();
    writeStore(prefs);
    audioPanel.reset();                 // 声音设置也恢复默认（自己负责写盘）
    qualityPanel.reset();               // 画质同理
    flashSaved();
    toast('已恢复默认设置');
  });

  syncSettings();

  /* ---------------- 规则设置：球体设置 ---------------- */
  var ballsBox = document.getElementById('p-balls');
  var ballsHint = document.getElementById('p-balls-hint');
  var ballsMeta = document.getElementById('p-balls-meta');

  BALL_SETS.forEach(function (s) {
    var b = document.createElement('button');
    b.type = 'button';
    b.dataset.balls = s.id;
    b.textContent = s.name;
    ballsBox.appendChild(b);
  });
  // 未开发的玩法：禁用按钮，带一个"敬请期待"的角标。
  // dataset.balls 也写上，这样 syncBallSets 遍历时不会误把当前项的高亮加给它。
  BALL_SET_SOON.forEach(function (s) {
    var b = document.createElement('button');
    b.type = 'button';
    b.disabled = true;
    b.dataset.balls = s.id;
    b.dataset.soon = '1';
    b.className = 'soon';
    b.innerHTML = '<span></span><i>敬请期待</i>';
    b.querySelector('span').textContent = s.name;
    ballsBox.appendChild(b);
  });

  function syncBallSets() {
    Array.prototype.forEach.call(ballsBox.children, function (b) {
      b.classList.toggle('on', !b.dataset.soon && b.dataset.balls === prefs.balls);
    });
    var cur = BALL_SETS.filter(function (s) { return s.id === prefs.balls; })[0] || BALL_SETS[0];
    ballsHint.textContent = cur.desc;
    // 值各自包一层 <span>：拆成独立文本节点，英文模式下 i18n 才能逐段查表
    // （整句一条规则会连变量一起留下中文）。
    ballsMeta.innerHTML = [
      '<li><b>球数</b>：<span>' + cur.count + ' 颗目标球（另加白球）</span></li>',
      '<li><b>摆法</b>：<span>' + cur.shape + '</span></li>',
      '<li><b>说明</b>：<span>' + cur.sub + '</span> · <span>' + cur.desc + '</span></li>',
    ].join('');
  }

  ballsBox.addEventListener('click', function (e) {
    var b = e.target.closest('button[data-balls]');
    if (!b || b.disabled) return;              // 未开发的玩法只做展示，点了不生效
    prefs.balls = b.dataset.balls;
    syncBallSets();
    savePrefs();
    flashBallsSaved();
    toast('玩法规则已改为 ' + (BALL_SETS.filter(function (s) { return s.id === prefs.balls; })[0] || {}).name);
  });

  syncBallSets();

  /* ---------------- 规则设置：本地双人 + 犯规罚则 ----------------
     选项按 DUO_RULES 表生成（与 src/duo.js 同源），改完立刻存盘 ——
     游戏页启动时由 src/prefs.js 读出来交给 DuoMatch，所以不用走 URL 参数。
     0.7.0 起分两个容器：分组 / 判罚四项进 #p-duo-rules，犯规罚则三项进 #p-foul-rules。 */
  var duoBox = document.getElementById('p-duo-rules');
  var foulBox = document.getElementById('p-foul-rules');
  var duoSavedEl = document.getElementById('p-duo-saved');
  var FOUL_KEYS = { foulMiss: 1, foulWrongBall: 1, foulNoPot: 1 };

  if (duoBox) {
    DUO_RULES.forEach(function (rule) {
      var box = FOUL_KEYS[rule.key] ? foulBox : duoBox;
      if (!box) return;
      var field = document.createElement('div');
      field.className = 'field';
      var head = document.createElement('div');
      head.className = 'fl';
      head.innerHTML = '<label></label><span class="lock"></span>';
      head.querySelector('label').textContent = rule.label;
      head.querySelector('.lock').textContent = rule.note;
      var segs = document.createElement('div');
      segs.className = 'segs auto';      // 只有两个选项，别撑成三列
      segs.dataset.rule = rule.key;
      var hint = document.createElement('p');
      hint.className = 'hint';
      hint.dataset.hint = rule.key;
      rule.opts.forEach(function (o) {
        var b = document.createElement('button');
        b.type = 'button';
        b.dataset.ruleVal = o.id;
        b.textContent = o.name;
        segs.appendChild(b);
      });
      field.appendChild(head);
      field.appendChild(segs);
      field.appendChild(hint);
      box.appendChild(field);
    });

    function syncDuoRules() {
      DUO_RULES.forEach(function (rule) {
        var segs = document.querySelector('.segs[data-rule="' + rule.key + '"]');
        var hint = document.querySelector('.hint[data-hint="' + rule.key + '"]');
        if (!segs) return;
        Array.prototype.forEach.call(segs.children, function (b) {
          b.classList.toggle('on', b.dataset.ruleVal === prefs[rule.key]);
        });
        var cur = rule.opts.filter(function (o) { return o.id === prefs[rule.key]; })[0] || rule.opts[0];
        if (hint) hint.textContent = cur.desc;
      });
    }

    function onRuleClick(e) {
      var b = e.target.closest('button[data-rule-val]');
      if (!b) return;
      var segs = b.parentNode;
      var rule = DUO_RULES.filter(function (r) { return r.key === segs.dataset.rule; })[0];
      if (!rule || prefs[rule.key] === b.dataset.ruleVal) return;
      prefs[rule.key] = b.dataset.ruleVal;
      syncDuoRules();
      savePrefs();
      flash(duoSavedEl);
      toast(rule.label + '已改为「' + b.textContent + '」');
    }
    duoBox.addEventListener('click', onRuleClick);
    if (foulBox) foulBox.addEventListener('click', onRuleClick);

    syncDuoRules();
  }

  /* ---------------- 挑战历史 ----------------
     存储与格式化都在 public/history.js（游戏页用的是同一份实现），这里只负责渲染。
  */
  var HIST = window.HMZQHistory;
  var histTabs = document.getElementById('hist-tabs');
  var histList = document.getElementById('hist-list');
  var histClear = document.getElementById('hist-clear');
  var histSaved = document.getElementById('hist-saved');
  var histTab = 'all';

  /** 玩家名是自由输入，拼进 innerHTML 前必须转义 */
  function esc(s) {
    return String(s).replace(/[&<>"]/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c];
    });
  }

  function renderHistory() {
    if (!HIST || !histList) return;
    Array.prototype.forEach.call(histTabs.children, function (b) {
      b.classList.toggle('on', b.dataset.tab === histTab);
    });
    var arr = HIST.list(histTab);
    histList.innerHTML = '';
    if (!arr.length) {
      var empty = document.createElement('div');
      empty.className = 'hist-empty';
      // 0.7.0 起人机与双人的对局都会入史（见 main.js 的 finishMatch），
      // 空态就是真的"还没打过"，文案可以一视同仁。
      empty.textContent = (histTab === 'ai' || histTab === 'duo')
        ? (histTab === 'ai'
          ? '还没有人机对局记录 —— 去「常规模式 → 人机对战」打一局吧'
          : '还没有本地双人记录 —— 去「常规模式」开一局吧')
        : '还没有记录 —— 去「常规模式」打一局吧';
      histList.appendChild(empty);
      return;
    }
    arr.forEach(function (rec) {
      var r = HIST.rowText(rec);
      var row = document.createElement('div');
      // 整行可点：点开看这一局的完整数据（进袋 / 进球率 / 平均瞄准 / 视角模式…）
      row.className = 'hist-row clickable' + (rec.result === 'fail' ? ' fail' : '');
      row.setAttribute('role', 'button');
      row.tabIndex = 0;
      row.innerHTML =
        '<span class="h-name">' + esc(r.name) + '</span>' +
        '<span class="h-mode">' + esc(r.mode) + '</span>' +
        '<span class="h-slot' + (r.slot === '—' ? ' muted' : '') + '">' + esc(r.slot) + '</span>' +
        '<span class="h-res">' + esc(r.result) + '</span>' +
        '<span class="h-time">' + esc(r.time) + '</span>' +
        '<span class="h-date">' + esc(r.date) + '</span>';
      row.addEventListener('click', function () { openDetail(rec); });
      row.addEventListener('keydown', function (e) {
        if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openDetail(rec); }
      });
      histList.appendChild(row);
    });
  }

  /* ---------------- 单局详情弹窗 ----------------
     显示哪几行完全由 public/history.js 的 detailRows() 决定（纯函数），
     这里只负责把数据摆上 DOM —— 这样"记录了什么"和"显示了什么"不会各说各话。
  */
  var hdModal = document.getElementById('hist-detail');
  var hdTitle = document.getElementById('hd-title');
  var hdRows = document.getElementById('hd-rows');

  function openDetail(rec) {
    if (!HIST || !hdModal || !hdRows) return;
    var rows = HIST.detailRows(rec);
    if (!rows) return;
    var r = HIST.rowText(rec);
    hdTitle.textContent = r ? r.mode + ' · ' + r.result : '本局详情';
    hdRows.innerHTML = rows.map(function (item) {
      return '<div class="hd-row' + (item.tone === 'fail' ? ' fail' : '') + '">' +
        '<span class="k">' + esc(item.k) + '</span>' +
        '<span class="v">' + esc(item.v) + '</span></div>';
    }).join('');
    hdModal.classList.add('on');
  }

  function closeDetail() { if (hdModal) hdModal.classList.remove('on'); }

  if (hdModal) {
    document.getElementById('hd-close').addEventListener('click', closeDetail);
    document.getElementById('hd-ok').addEventListener('click', closeDetail);
    hdModal.addEventListener('click', function (e) { if (e.target === hdModal) closeDetail(); });
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape') closeDetail();
    });
  }

  if (HIST && histList && histTabs) {
    // 换成本页的存储实现：Electron 走 IPC 落盘，和其余设置是同一条路
    HIST.setStorage({
      get: function (key) { return readStore(key); },
      set: function (key, value) { writeStore(value, key); }
    });

    HIST.TABS.forEach(function (t) {
      var b = document.createElement('button');
      b.type = 'button';
      b.dataset.tab = t.id;
      b.textContent = t.name;
      b.addEventListener('click', function () { histTab = t.id; renderHistory(); });
      histTabs.appendChild(b);
    });

    // 清空是破坏性操作，要"点两次"：第一次变成确认态，4 秒内不再点就自动复原
    var clearArmed = 0;
    var clearTimer = 0;
    histClear.addEventListener('click', function () {
      var t = Date.now();
      if (t - clearArmed > 4000) {
        clearArmed = t;
        histClear.textContent = '再点一次确认';
        histClear.classList.add('armed');
        clearTimeout(clearTimer);
        clearTimer = setTimeout(function () {
          if (Date.now() - clearArmed >= 4000) {
            histClear.textContent = '初始化';
            histClear.classList.remove('armed');
          }
        }, 4100);
        return;
      }
      clearArmed = 0;
      histClear.textContent = '初始化';
      histClear.classList.remove('armed');
      var n = HIST.clear(histTab);
      renderHistory();
      flash(histSaved);
      toast('已清空 ' + n + ' 条记录');
    });
  }

  /* ---------------- 退出 ---------------- */
  var quitNote = document.getElementById('quit-note');
  document.getElementById('quit-yes').addEventListener('click', function () {
    if (electron && electron.quit) { electron.quit(); return; }
    window.close();
    setTimeout(function () {
      quitNote.textContent = '网页版无法自动关闭窗口，请直接关闭浏览器标签页。';
    }, 320);
  });
  document.getElementById('quit-no').addEventListener('click', function () {
    go('start');
    setLv(1);                      // 手机上"取消"直接回一级菜单，而不是进常规模式页
  });

  /* ---------------- 关于：联系方式二维码 ----------------
     默认只画占位方框 —— **不发起任何图片请求**（没有图还去请求会白白吃一个 404，
     控制台还留一条红）。以后有二维码了：把图放到 public/bg/contact-qr.png，
     再给 #qr-box 加个 data-qr-src="bg/contact-qr.png" 就行，其余不用动。
  */
  (function mountQr() {
    var box = document.getElementById('qr-box');
    if (!box) return;
    var src = box.getAttribute('data-qr-src');
    if (!src) return;                       // 还没配图：保持占位
    var img = new Image();
    img.className = 'qr-img';
    img.alt = '联系方式二维码';
    img.draggable = false;
    img.addEventListener('load', function () {
      var ph = box.querySelector('.qr-ph');
      if (ph) ph.remove();
      box.appendChild(img);
    });
    img.src = src;
  })();

  syncBack();

  /* ---------------- 语言切换 ----------------
     按钮只做一件事：把选择交给 HMZQ_I18N —— 翻译 DOM、记住选择、通知订阅方都由它负责。
     按钮自己带 data-i18n-skip，所以「中文 / English」在两种语言下都显示本名。 */
  var langBtns = Array.prototype.slice.call(document.querySelectorAll('#lang-sw button'));

  function syncLang() {
    if (!window.HMZQ_I18N) return;
    var cur = window.HMZQ_I18N.getLang();
    langBtns.forEach(function (b) {
      var on = b.getAttribute('data-lang') === cur;
      b.classList.toggle('on', on);
      b.setAttribute('aria-pressed', on ? 'true' : 'false');
    });
    syncBack();                     // 返回键文案取自当前页标题，语言变了要重新取一次
  }

  if (window.HMZQ_I18N) {
    langBtns.forEach(function (b) {
      b.addEventListener('click', function () {
        window.HMZQ_I18N.setLang(b.getAttribute('data-lang'));
        b.blur();
      });
    });
    window.HMZQ_I18N.onChange(syncLang);
    syncLang();
  }

  /* ---------------- 键盘导航 ---------------- */
  window.addEventListener('keydown', function (e) {
    var t = e.target;
    if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA')) return;   // 滑块自己吃方向键
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      moveSel(e.key === 'ArrowDown' ? 1 : -1);
    } else if (e.key === 'Enter') {
      e.preventDefault();
      menuItems[sel].click();
    } else if (e.key === 'Escape') {
      e.preventDefault();
      // 子路由：先往上退一层；已是一级页再谈"回主菜单"
      if (parentOf(cur)) backOne();
      else if (isNarrow() && document.body.dataset.lv === '2') setLv(1);
      else go(HOME);
    }
  });
})();
