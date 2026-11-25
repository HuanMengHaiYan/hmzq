/**
 * 中英文切换 · 端到端检查（`node test/browser-i18n.mjs`）
 * ------------------------------------------------------------------
 * 为什么静态审计（scripts/i18n-audit.mjs）还不够：
 * 它只能保证"能查到的中文都在词表里"。可**运行时**还有一大类文案是先拼再写的
 * （`玩家${n}打进黑八` / `余${n}次` / `当前：阴影 1024 · 渲染 100%…`），
 * 拼坏了、规则漏了、翻译发生在元素重建之前 —— 静态分析一个都看不出来。
 *
 * 所以这里做的是**性质断言**：切到英文之后，页面上不该再有任何汉字。
 * 做法是拿真 Chrome 打开两个页面（启动器 / 游戏），
 *   · 用 TreeWalker 扫全部文本节点（隐藏页也扫：它们在 DOM 里，也该被翻）
 *   · 跳过 <script>/<style> 与 [data-i18n-skip]（语言按钮自己就该显示「中文 / English」）
 * 再反过来验证一遍：点回「中文」，界面必须真的回到中文（译文能还原，不是单向的）。
 *
 * 用法:
 *   node test/browser-i18n.mjs              # 跑检查 + 留三张对照图
 *   node test/browser-i18n.mjs --headful    # 想肉眼看时
 * 前置：先 `npx vite build`（测的是 dist）。
 * 产物图：docs/i18n-shots/{launcher-en,game-settings-en,help-en}.png
 */
import { createServer } from 'node:http';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { existsSync, mkdtempSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join, extname } from 'node:path';

const HEADFUL = process.argv.includes('--headful');
const DIST = 'dist';
if (!existsSync(join(DIST, 'index.html'))) {
  console.error('✗ 没有 dist/index.html —— 先 npx vite build');
  process.exit(1);
}

const CHROME = process.env.CHROME_PATH ||
  ['C:/Program Files/Google/Chrome/Application/chrome.exe',
   'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe'].find(existsSync);
if (!CHROME) { console.error('✗ 找不到 Chrome，设 CHROME_PATH'); process.exit(1); }

const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json',
  '.jpg': 'image/jpeg', '.png': 'image/png', '.webp': 'image/webp',
  '.mp3': 'audio/mpeg', '.ogg': 'audio/ogg', '.wasm': 'application/wasm',
};
const server = createServer(async (req, res) => {
  let p = decodeURIComponent(req.url.split('?')[0]);
  if (p === '/') p = '/index.html';
  try {
    const buf = await readFile(join(DIST, p));
    res.writeHead(200, { 'Content-Type': MIME[extname(p)] || 'application/octet-stream' });
    res.end(buf);
  } catch { res.writeHead(404); res.end('404'); }
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const ORIGIN = `http://127.0.0.1:${server.address().port}`;

const CDP_PORT = 9413;
const profile = mkdtempSync(join(tmpdir(), 'hmzq-i18n-'));
const chrome = spawn(CHROME, [
  ...(HEADFUL ? [] : ['--headless=new']),
  `--remote-debugging-port=${CDP_PORT}`,
  `--user-data-dir=${profile}`,
  '--window-size=1440,900',
  '--no-first-run', '--no-default-browser-check', '--disable-extensions',
  '--disable-gpu', '--disable-gpu-sandbox',
  '--use-angle=swiftshader', '--enable-unsafe-swiftshader',
  '--disable-features=Translate', 'about:blank',
], { stdio: 'ignore' });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function pageTarget() {
  for (let i = 0; i < 100; i++) {
    try {
      const list = await (await fetch(`http://127.0.0.1:${CDP_PORT}/json/list`)).json();
      const t = list.find((x) => x.type === 'page');
      if (t && t.webSocketDebuggerUrl) return t;
    } catch { /* 还没起来 */ }
    await sleep(150);
  }
  throw new Error('等不到 page target');
}

let ws, seq = 0;
const pending = new Map();
const logs = [];
function send(method, params = {}) {
  const id = ++seq;
  ws.send(JSON.stringify({ id, method, params }));
  return new Promise((res, rej) => pending.set(id, { res, rej }));
}
async function evaluate(expr) {
  const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
  if (r.exceptionDetails) throw new Error(r.exceptionDetails.text + ' ' + (r.exceptionDetails.exception?.description || ''));
  return r.result.value;
}

const target = await pageTarget();
ws = new WebSocket(target.webSocketDebuggerUrl);
await new Promise((r, j) => { ws.onopen = r; ws.onerror = j; });
ws.onmessage = (ev) => {
  const m = JSON.parse(ev.data);
  if (m.id && pending.has(m.id)) {
    const { res, rej } = pending.get(m.id); pending.delete(m.id);
    if (m.error) rej(new Error(m.method + ': ' + m.error.message)); else res(m.result);
  } else if (m.method === 'Runtime.consoleAPICalled') {
    logs.push(m.params.args.map((a) => a.value ?? a.description ?? a.type).join(' '));
  } else if (m.method === 'Log.entryAdded') {
    const e = m.params.entry;
    logs.push(`[${e.level}] ${e.text}`);
  }
};
await send('Runtime.enable');
await send('Page.enable');
await send('Log.enable');

let bad = 0;
const fail = (msg) => { bad++; console.log(`✗ ${msg}`); };
const pass = (msg) => console.log(`✓ ${msg}`);

/** 页面上还剩下的汉字（跳过脚本样式与 [data-i18n-skip]） */
const SCAN = `(function(){
  var out = [], skip = { SCRIPT: 1, STYLE: 1, NOSCRIPT: 1, TEXTAREA: 1 };
  var w = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT, null);
  var re = /[\\u3400-\\u4dbf\\u4e00-\\u9fff]/;
  while (w.nextNode()) {
    var n = w.currentNode, t = (n.data || '').trim();
    if (!t || !re.test(t)) continue;
    var el = n.parentElement;
    if (!el || skip[el.tagName]) continue;
    if (el.closest('[data-i18n-skip]')) continue;
    var where = el.tagName.toLowerCase() + (el.id ? '#' + el.id : '') +
      (typeof el.className === 'string' && el.className ? '.' + el.className.trim().split(/\\s+/).join('.') : '');
    out.push(where + ' :: ' + t.slice(0, 90));
  }
  return JSON.stringify(out);
})()`;

async function scan(label) {
  const raw = await evaluate(SCAN);
  const list = JSON.parse(raw);
  if (!list.length) { pass(`${label}：没有残留中文`); return true; }
  fail(`${label}：还有 ${list.length} 处中文`);
  list.slice(0, 14).forEach((l) => console.log(`   ${l}`));
  return false;
}

async function visit(url, readyExpr, waitMs = 700) {
  logs.length = 0;
  await send('Page.navigate', { url });
  for (let i = 0; i < 70; i++) {
    await sleep(300);
    try { if (await evaluate(readyExpr)) break; } catch { /* 还在加载 */ }
  }
  await sleep(waitMs);
}

async function shot(name, fullPage = false) {
  await mkdir('docs/i18n-shots', { recursive: true });
  const r = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: fullPage });
  const buf = Buffer.from(r.data, 'base64');
  await writeFile(join('docs/i18n-shots', name), buf);
  console.log(`  → docs/i18n-shots/${name}`);
}

const setLang = (l) => evaluate(`localStorage.setItem('hmzq.lang.v1','${l}'); 1`);

console.log(`\n===== 中英文切换 · 端到端（${HEADFUL ? '有头' : '无头'} Chrome）=====`);

/* ---------------- ① 启动器 · 英文 ---------------- */
console.log('\n[1/6] 启动器 · English');
await send('Page.navigate', { url: ORIGIN + '/launcher.html' });
await sleep(400);
await setLang('en');
await visit(ORIGIN + '/launcher.html', `!!document.querySelector('[data-enter-game]')`);

const L = JSON.parse(await evaluate(`JSON.stringify({
  lang: document.documentElement.lang,
  title: document.title,
  brand: (document.querySelector('.brand h1')||{}).textContent,
  menu: Array.prototype.map.call(document.querySelectorAll('.mi span'), function(b){return b.textContent;}),
  onBtn: (document.querySelector('#lang-sw button.on')||{}).getAttribute && document.querySelector('#lang-sw button.on').getAttribute('data-lang')
})`));
if (L.lang !== 'en') fail(`<html lang> 没换成 en（${L.lang}）`); else pass('<html lang="en">');
if (!/^[\x00-\x7F]+$/.test(L.title)) fail(`标题没翻：${L.title}`); else pass(`标题：${L.title}`);
if (L.onBtn !== 'en') fail(`语言按钮高亮不对：${L.onBtn}`); else pass('语言按钮高亮在 English');
console.log(`   菜单：${L.menu.join(' / ')}`);
await scan('启动器静态页');
if (logs.some((l) => /error|failed/i.test(l))) { fail('控制台有错误：'); logs.slice(0, 5).forEach((l) => console.log('   ' + l.slice(0, 160))); }
await shot('launcher-en.png');

/* 一级 / 二级页各点一遍（隐藏页也在 DOM 里，但切页会重建历史列表等动态内容） */
for (const route of ['start/solo', 'start/ai', 'fun', 'history', 'settings', 'settings/game', 'settings/quality', 'settings/rules/duo', 'help', 'about']) {
  await evaluate(`(function(){ var b = document.querySelector('[data-go="${route}"]'); if (b) b.click(); return 1; })()`);
  await sleep(120);
}
await scan('启动器 · 逛完全部子页');

/* ---------------- ② 启动器 · 切回中文 ---------------- */
console.log('\n[2/6] 启动器 · 点回中文');
await evaluate(`document.querySelector('#lang-sw [data-lang="zh"]').click(); 1`);
await sleep(500);
const Z = JSON.parse(await evaluate(`JSON.stringify({
  lang: document.documentElement.lang,
  menu: Array.prototype.map.call(document.querySelectorAll('.mi span'), function(b){return b.textContent;}),
  saved: localStorage.getItem('hmzq.lang.v1')
})`));
if (Z.lang !== 'zh-CN') fail(`<html lang> 没回 zh-CN（${Z.lang}）`); else pass('<html lang="zh-CN">');
if (Z.menu[0] !== '常规模式') fail(`菜单没还原成中文：${Z.menu.join(' / ')}`); else pass(`菜单已还原：${Z.menu.join(' / ')}`);
if (Z.saved !== 'zh') fail(`语言选择没落盘（${Z.saved}）`); else pass('语言选择已落盘');

/* ---------------- ③ 启动器 · 实时切英文（不刷新页面） ---------------- */
/* ⚠️ 这一步是补的护栏：以前 setLang('en') 只清台账、不重新翻译，界面会一直停在中文
   直到刷新 —— 而上面两步都靠 reload，所以这个 bug 一直没被测出来
   （暴露它的是杆法盘标题：切英文后仍写着「击球点」）。
   这里**不刷新**，直接点按钮，然后扫全页汉字。 */
console.log('\n[3/6] 启动器 · 点击实时切英文（不重新加载）');
await evaluate(`document.querySelector('#lang-sw [data-lang="en"]').click(); 1`);
await sleep(600);
const LE = JSON.parse(await evaluate(`JSON.stringify({
  lang: document.documentElement.lang,
  menu: Array.prototype.map.call(document.querySelectorAll('.mi span'), function(b){return b.textContent;}),
  saved: localStorage.getItem('hmzq.lang.v1')
})`));
if (LE.lang !== 'en') fail(`实时切换后 <html lang> 没变成 en（${LE.lang}）`); else pass('实时切换：<html lang="en">');
if (/[\u4e00-\u9fff]/.test(LE.menu.join(''))) fail(`实时切换后菜单还是中文：${LE.menu.join(' / ')}`); else pass(`实时切换后菜单已变英文：${LE.menu.slice(0, 3).join(' / ')}`);
await scan('启动器 · 实时切换后');
await evaluate(`document.querySelector('#lang-sw [data-lang="zh"]').click(); 1`);
await sleep(500);
const LB = JSON.parse(await evaluate(`JSON.stringify({
  menu: Array.prototype.map.call(document.querySelectorAll('.mi span'), function(b){return b.textContent;})
})`));
if (LB.menu[0] !== '常规模式') fail(`实时切回中文失败（台账被抹了？）：${LB.menu.join(' / ')}`); else pass('实时切回中文：菜单还原正常');

/* ---------------- ④ 游戏 · 英文 ---------------- */
console.log('\n[4/6] 游戏 · English');
await setLang('en');
const GAME = ORIGIN + '/index.html?mode=free&balls=15&lock=1&min=0.05&max=1.20&from=launcher';
await visit(GAME, `parseFloat((document.getElementById('v-fps')||{}).textContent) > 0`, 900);

const st = JSON.parse(await evaluate(`JSON.stringify({
  state: (document.getElementById('v-state')||{}).textContent,
  dock: Array.prototype.map.call(document.querySelectorAll('.dock-btn'), function(b){return b.textContent.trim();}),
  shoot: (document.getElementById('btn-shoot')||{}).textContent,
  errors: window.__gameErrors || []
})`));
console.log(`   状态 / 按钮：${st.state} · ${st.dock.join(' | ')} · ${st.shoot}`);
if (st.errors.length) fail(`运行期错误：${st.errors.join(' | ')}`); else pass('无运行期错误');
await scan('游戏主界面');

/* 设置面板（含画质四行 + 语言行） */
await evaluate(`document.getElementById('btn-settings').click(); 1`);
await sleep(260);
await scan('游戏 · 设置面板');
await shot('game-settings-en.png');

/* 帮助弹窗（最长的文案，整块替换那条路） */
await evaluate(`document.getElementById('settings-close').click(); document.getElementById('btn-help').click(); 1`);
await sleep(420);
await scan('游戏 · 帮助弹窗');
/* 帮助弹窗不能有横向溢出：它以前是多列（columns）布局，内容装不下时浏览器会往右边
   继续排「溢出列」，后几段直接跑到屏幕外、只能拖横向滚动条看到（英文更长更容易触发）。
   现在换成 grid，这条断言把「装不下就往右长」这种回归挡住。 */
const HB = JSON.parse(await evaluate(`(function(){
  var b = document.getElementById('help-body');
  var secs = b.querySelectorAll('.help-sec');
  var off = [];
  for (var i = 0; i < secs.length; i++) {
    var r = secs[i].getBoundingClientRect();
    if (r.right > b.getBoundingClientRect().right + 1) off.push(Math.round(r.right));
  }
  return JSON.stringify({ sw: b.scrollWidth, cw: b.clientWidth, secs: secs.length, off: off });
})()`));
if (HB.sw > HB.cw + 1 || HB.off.length) {
  fail(`帮助弹窗横向溢出：scrollWidth ${HB.sw} > clientWidth ${HB.cw}（跑到右边界外的段落 ${HB.off.length} 个）`);
} else {
  pass(`帮助弹窗没有横向溢出（${HB.secs} 段都排进 ${HB.cw}px 内）`);
}
await shot('help-en.png');

/* 按一下开球（蓄力条 / 状态文案是每帧重写的，最容易漏） */
await evaluate(`document.getElementById('help-close').click(); 1`);
await sleep(200);
await evaluate(`(function(){
  var b = document.getElementById('btn-shoot');
  b.dispatchEvent(new PointerEvent('pointerdown', {bubbles:true, pointerId:1, pointerType:'mouse', button:0}));
  return 1;
})()`);
await sleep(420);
await scan('游戏 · 蓄力中（每帧重写的文案）');
await evaluate(`(function(){
  var b = document.getElementById('btn-shoot');
  b.dispatchEvent(new PointerEvent('pointerup', {bubbles:true, pointerId:1, pointerType:'mouse', button:0}));
  return 1;
})()`);
await sleep(1600);
await scan('游戏 · 出杆后');

/* ---------------- ④ 游戏 · 切回中文 ---------------- */
console.log('\n[5/6] 游戏 · 设置里点回中文');
await evaluate(`document.getElementById('btn-settings').click(); 1`);
await sleep(220);
await evaluate(`document.querySelector('#set-lang [data-lang="zh"]').click(); 1`);
await sleep(420);
const GZ = JSON.parse(await evaluate(`JSON.stringify({
  state: (document.getElementById('v-state')||{}).textContent,
  shoot: (document.getElementById('btn-shoot')||{}).textContent,
  helpBtn: document.getElementById('btn-help').title,
  saved: localStorage.getItem('hmzq.lang.v1')
})`));
// 状态栏还原成任何中文文案都算过（出杆后球还在滚的话这里是「运动中」，
// 不一定是「就绪」—— 还原失败的标志是残留英文，不是非得回到哪个词）。
if (!/[\u4e00-\u9fff]/.test(GZ.state) || /[A-Za-z]{2,}/.test(GZ.state)) {
  fail(`状态没还原成中文：${GZ.state}`);
} else {
  pass(`游戏内已还原中文（状态「${GZ.state}」，开球键「${GZ.shoot}」）`);
}
if (GZ.saved !== 'zh') fail(`语言选择没落盘（${GZ.saved}）`); else pass('游戏内切换也落盘了');

/* ---------------- ⑥ 游戏 · 实时切英文（不刷新页面） ---------------- */
console.log('\n[6/6] 游戏 · 点击实时切英文（不重新加载）');
await evaluate(`document.querySelector('#set-lang [data-lang="en"]').click(); 1`);
await sleep(700);
const GE = JSON.parse(await evaluate(`JSON.stringify({
  lang: document.documentElement.lang,
  shoot: (document.getElementById('btn-shoot')||{}).textContent,
  cap: (document.getElementById('spin-cap')||{}).textContent,
  saved: localStorage.getItem('hmzq.lang.v1')
})`));
if (GE.lang !== 'en') fail(`实时切换后 <html lang> 没变成 en（${GE.lang}）`); else pass('实时切换：<html lang="en">');
if (GE.shoot !== 'Break') fail(`开球键没跟着翻（${GE.shoot}）`); else pass(`开球键已变英文（${GE.shoot}）`);
// 杆法盘那行小字（它就在一开始的 DOM 里，最先暴露"没重翻"这个问题）
if (!/^[\x00-\x7F]+$/.test(GE.cap || '')) fail(`杆法盘标题没翻：${GE.cap}`); else pass(`杆法盘标题已变英文（${GE.cap}）`);
await scan('游戏 · 实时切换后');
await evaluate(`document.querySelector('#set-lang [data-lang="zh"]').click(); 1`);
await sleep(500);

/* ---------------- 收尾 ---------------- */
ws.close();
chrome.kill();
server.close();
await sleep(300);
if (bad) { console.log(`\n===== 中英文切换：${bad} 项不合格 =====`); process.exit(1); }
console.log('\n===== 中英文切换：全部通过 =====');
process.exit(0);
