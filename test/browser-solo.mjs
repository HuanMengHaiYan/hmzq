/**
 * 单人模式 + 挑战历史 · 端到端（真·无头 Chrome）
 * ------------------------------------------------------------------
 * `browser-smoke.mjs` 只证明"页面能跑起来"，证明不了"点进去真能玩"。
 * 这条覆盖第三阶段新增的那条交互链路：
 *   ① 启动器：挑战历史页的渲染 / tab 过滤 / 按 tab 清空 / 二次确认
 *   ② 单人模式：展开 → 选难度 → 带 game/diff 参数进游戏 → HUD 显示对应的那一行 → 打一杆扣次数
 *   ③ 计分模式：走完整结算链路（`?ending=win&record=1`）→ 弹窗有得分与用时 → 历史真落库 → 「再来一局」清零
 *
 * 跑法：node test/browser-solo.mjs   （先 npm run build；Chrome 路径可用 CHROME_PATH 覆盖）
 */
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { existsSync, mkdtempSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join, extname } from 'node:path';

const DIST = 'dist';
const CHROME = process.env.CHROME_PATH ||
  ['C:/Program Files/Google/Chrome/Application/chrome.exe',
   'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe'].find(existsSync);
const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.png': 'image/png', '.jpg': 'image/jpeg',
  '.glb': 'model/gltf-binary', '.mp3': 'audio/mpeg',
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
const CDP_PORT = 9431;
const profile = mkdtempSync(join(tmpdir(), 'hmzq-solo-'));
const chrome = spawn(CHROME, [
  '--headless=new', `--remote-debugging-port=${CDP_PORT}`, `--user-data-dir=${profile}`,
  '--window-size=1000,620', '--no-first-run', '--no-default-browser-check', '--disable-extensions',
  '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--disable-gpu-sandbox', '--disable-features=Translate', 'about:blank',
], { stdio: 'ignore' });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let ws, seq = 0;
const pending = new Map();
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

async function pageTarget() {
  for (let i = 0; i < 100; i++) {
    try {
      const list = await (await fetch(`http://127.0.0.1:${CDP_PORT}/json/list`)).json();
      const t = list.find((x) => x.type === 'page');
      if (t && t.webSocketDebuggerUrl) return t;
    } catch { /* wait */ }
    await sleep(150);
  }
  throw new Error('no page target');
}
const target = await pageTarget();
ws = new WebSocket(target.webSocketDebuggerUrl);
await new Promise((r, j) => { ws.onopen = r; ws.onerror = j; });
ws.onmessage = (ev) => {
  const m = JSON.parse(ev.data);
  if (m.id && pending.has(m.id)) {
    const { res, rej } = pending.get(m.id); pending.delete(m.id);
    if (m.error) rej(new Error(m.method + ': ' + m.error.message)); else res(m.result);
  }
};
await send('Runtime.enable');
await send('Page.enable');
/**
 * ⚠️ 环境校准：无头 Chrome 默认 `navigator.maxTouchPoints > 0`，
 * platform 会把它判成"触摸设备"（出杆改走右下角「开球」键、左键点击不蓄力），
 * 于是**整条测试跑的一直是移动端分支**，而用户报的问题（右键旋转 / 滚轮缩放）
 * 恰恰在桌面分支上。这里把环境钉成真正的桌面：maxTouchPoints = 0 且
 * `(pointer: coarse)` 不匹配。启动器自己那套窄屏媒体查询不受影响（[10] 段仍走竖屏）。
 */
const desktopSource = `
    try { Object.defineProperty(navigator, 'maxTouchPoints', { get: () => 0, configurable: true }); } catch (e) {}
    var __mm = window.matchMedia ? window.matchMedia.bind(window) : null;
    if (__mm) {
      window.matchMedia = function (q) {
        var r = __mm(q);
        if (/pointer:\\s*coarse/.test(q)) {
          return { matches: false, media: q, onchange: null,
            addListener: function(){}, removeListener: function(){},
            addEventListener: function(){}, removeEventListener: function(){} };
        }
        return r;
      };
    }
  `;
const desktopInject = (await send('Page.addScriptToEvaluateOnNewDocument', { source: desktopSource })).identifier;

let bad = 0;
const pass = (m) => console.log('  ✓ ' + m);
const fail = (m) => { bad++; console.log('  ✗ ' + m); };

// ---------- 1. 启动器：历史模块 + 渲染 ----------
console.log('\n[1] 启动器 · 挑战历史渲染');
await send('Page.navigate', { url: ORIGIN + '/launcher.html' });
await sleep(900);
const hasHist = await evaluate('typeof window.HMZQHistory');
hasHist === 'object' ? pass('history.js 已挂到 window.HMZQHistory') : fail('history.js 没加载（' + hasHist + '）');

// 塞三条用户示例里的数据，再渲染
await evaluate(`
  (function () {
    var H = window.HMZQHistory;
    H.clear('all');
    H.add({ mode: 'score', name: '玩家1', ms: 204000, shots: 18, score: 20, result: 'win', ts: Date.now() });
    H.add({ mode: 'limit', diff: 'hard', name: '玩家1', ms: 312000, shots: 17, result: 'win', ts: Date.now() });
    H.add({ mode: 'free', name: '玩家1', ms: 96000, shots: 11, result: 'win', ts: Date.now() });
  })();
`);
await evaluate(`document.querySelector('[data-go="history"]').click()`);
await sleep(300);
const rowsAll = await evaluate(`(function(){
  var out = [];
  var rs = document.querySelectorAll('#hist-list .hist-row');
  for (var i = 0; i < rs.length; i++) out.push(rs[i].textContent.replace(/\\s+/g, ' ').trim());
  return out;
})()`);
console.log('    ' + rowsAll.join('\n    '));
rowsAll.length === 3 ? pass('「所有」列出 3 条') : fail('「所有」条数不对：' + rowsAll.length);
(rowsAll.join('|').indexOf('限次模式(困难)') >= 0) ? pass('限次行显示「限次模式(困难)」') : fail('限次行文案不对');
(rowsAll.join('|').indexOf('20分') >= 0) ? pass('计分行显示「20分」') : fail('计分行没显示分数');

async function shot(name) {
  const r = await send('Page.captureScreenshot', { format: 'png' });
  const { writeFile } = await import('node:fs/promises');
  const dir = 'C:/Users/HY/AppData/Local/Temp/hmzq-solo';
  await (await import('node:fs/promises')).mkdir(dir, { recursive: true });
  await writeFile(join(dir, name + '.png'), Buffer.from(r.data, 'base64'));
  console.log('    截图 ' + name + '.png');
}
await shot('launcher-history');

// 切到「计分」tab
await evaluate(`document.querySelectorAll('#hist-tabs button')[1].click()`);
await sleep(200);
const scoreRows = await evaluate(`document.querySelectorAll('#hist-list .hist-row').length`);
scoreRows === 1 ? pass('切到「计分」只剩 1 条') : fail('「计分」条数不对：' + scoreRows);

// 清空（点两次）
await evaluate(`document.getElementById('hist-clear').click()`);
await sleep(150);
const armed = await evaluate(`document.getElementById('hist-clear').textContent`);
armed.indexOf('确认') >= 0 ? pass('第一次点「初始化」变成确认态') : fail('没有二次确认（' + armed + '）');
await evaluate(`document.getElementById('hist-clear').click()`);
await sleep(200);
const afterClear = await evaluate(`JSON.stringify({score: window.HMZQHistory.list('score').length, limit: window.HMZQHistory.list('limit').length})`);
const ac = JSON.parse(afterClear);
(ac.score === 0 && ac.limit === 1) ? pass('在「计分」里清空 = 只清计分，限次还在') : fail('清空范围不对：' + afterClear);

// ---------- 2. 单人模式进游戏（常规模式 → 单人模式 → 限次 → 困难） ----------
console.log('\n[2] 启动器 · 多级路由：常规 → 单人模式 → 限次(困难)');
await evaluate(`document.querySelector('[data-go="start"]').click()`);
await sleep(200);
// 每一层都是独立子路由：同一时刻只有一个 .page 是显示的
const visible = () => evaluate(`JSON.stringify((function(){
  var out = [];
  var ps = document.querySelectorAll('section.page');
  for (var i = 0; i < ps.length; i++) {
    if (getComputedStyle(ps[i]).display !== 'none') out.push(ps[i].getAttribute('data-page'));
  }
  return out;
})())`);
let vis = JSON.parse(await visible());
(JSON.stringify(vis) === '["start"]') ? pass('常规模式页独占一屏') : fail('同时显示了多个页面：' + vis.join(','));
await shot('launcher-start');

await evaluate(`document.querySelector('[data-go="start/solo"]').click()`);
await sleep(200);
await shot('launcher-solo');
vis = JSON.parse(await visible());
(JSON.stringify(vis) === '["start/solo"]') ? pass('进「单人模式」页后只显示这一页') : fail('切页不对：' + vis.join(','));
const menuOn = await evaluate(`document.querySelector('.mi.on').getAttribute('data-go')`);
(menuOn === 'start') ? pass('子路由仍然点亮它所属的一级菜单项「常规模式」') : fail('菜单高亮跑偏了：' + menuOn);
const backText = await evaluate(`document.getElementById('back-txt').textContent`);
(backText.indexOf('常规模式') >= 0) ? pass('返回键文案跟着层级走：' + backText) : fail('返回键文案不对：' + backText);

await evaluate(`document.querySelector('[data-go="start/solo/limit"]').click()`);
await sleep(200);
vis = JSON.parse(await visible());
(JSON.stringify(vis) === '["start/solo/limit"]') ? pass('再进一层到「限次 · 难度」页') : fail('第三层没切过去：' + vis.join(','));
// 返回：面包屑应该退回上一层，而不是直接弹回主菜单
await evaluate(`document.querySelector('section[data-page="start/solo/limit"] [data-up]').click()`);
await sleep(200);
vis = JSON.parse(await visible());
(JSON.stringify(vis) === '["start/solo"]') ? pass('面包屑「返回」逐级回退到「单人模式」') : fail('返回没回到父页：' + vis.join(','));

await evaluate(`document.querySelector('[data-go="start/solo/limit"]').click()`);
await sleep(200);
await evaluate(`document.querySelector('[data-enter-game="limit"][data-diff="hard"]').click()`);
await sleep(2500);

const url = await evaluate('location.search');
(url.indexOf('game=limit') >= 0 && url.indexOf('diff=hard') >= 0)
  ? pass('跳转带上了 game=limit&diff=hard（' + url + '）') : fail('URL 参数不对：' + url);

// 等游戏起来
let modeTxt = '';
for (let i = 0; i < 40; i++) {
  await sleep(500);
  modeTxt = await evaluate(`(document.getElementById('v-mode')||{}).textContent || ''`);
  if (modeTxt.indexOf('限次') >= 0) break;
}
modeTxt.indexOf('限次模式') >= 0 ? pass('HUD 标题显示「' + modeTxt + '」') : fail('HUD 标题不对：' + modeTxt);
const leftRow = await evaluate(`JSON.stringify({
  leftHidden: document.getElementById('row-left').hidden,
  scoreHidden: document.getElementById('row-score').hidden,
  left: (document.getElementById('v-left')||{}).textContent
})`);
const lr = JSON.parse(leftRow);
(!lr.leftHidden && lr.scoreHidden && lr.left === '20')
  ? pass('限次模式：显示「剩余次数 20」，得分行隐藏') : fail('HUD 两行不对：' + leftRow);

// 出杆：空格
await evaluate(`
  (function () {
    var ev = new KeyboardEvent('keydown', { code: 'Space', key: ' ', bubbles: true });
    window.dispatchEvent(ev); document.dispatchEvent(ev);
  })();
`);
await sleep(700);
await evaluate(`
  (function () {
    var ev = new KeyboardEvent('keyup', { code: 'Space', key: ' ', bubbles: true });
    window.dispatchEvent(ev); document.dispatchEvent(ev);
  })();
`);
await sleep(2000);
const after = await evaluate(`JSON.stringify({
  shots: (document.getElementById('v-shots')||{}).textContent,
  left: (document.getElementById('v-left')||{}).textContent,
  errs: window.__gameErrors || []
})`);
const af = JSON.parse(after);
console.log('    出杆后：' + after);
(!af.errs.length) ? pass('无运行期错误') : fail('有运行期错误：' + af.errs.join(' | '));
(af.left === '19') ? pass('打一杆后剩余次数 20 → 19') : fail('剩余次数没减：' + af.left);
await shot('game-limit-hard');

// ---------- 3. 计分模式 HUD + 完整结算链路（写历史）----------
console.log('\n[3] 计分模式 · HUD + 走完整结算链路');
await send('Page.navigate', { url: ORIGIN + '/launcher.html' });
await sleep(800);
await evaluate(`window.HMZQHistory.clear('all')`);
await send('Page.navigate', { url: ORIGIN + '/index.html?from=launcher&lock=1&balls=3&game=score&ending=win&record=1' });
await sleep(1200);

let scoreTxt = '';
for (let i = 0; i < 40; i++) {
  await sleep(500);
  scoreTxt = await evaluate(`(document.getElementById('v-mode')||{}).textContent || ''`);
  if (scoreTxt.indexOf('计分') >= 0) break;
}
scoreTxt.indexOf('计分模式') >= 0 ? pass('HUD 标题显示「' + scoreTxt + '」') : fail('HUD 标题不对：' + scoreTxt);
const hud2 = JSON.parse(await evaluate(`JSON.stringify({
  scoreHidden: document.getElementById('row-score').hidden,
  scoreBox: getComputedStyle(document.getElementById('row-score')).display,
  leftHidden: document.getElementById('row-left').hidden,
  score: (document.getElementById('v-score')||{}).textContent,
  modal: getComputedStyle(document.getElementById('result-modal')).display
})`));
(!hud2.scoreHidden && hud2.scoreBox !== 'none' && hud2.leftHidden && hud2.score === '0')
  ? pass('计分模式：得分行可见（0），剩余次数行隐藏') : fail('HUD 两行不对：' + JSON.stringify(hud2));
hud2.modal === 'flex' ? pass('结算弹窗已弹出（走的是完整结算链路）') : fail('结算弹窗没弹：' + hud2.modal);

const stats = (await evaluate(`(document.getElementById('result-stats')||{}).textContent || ''`)).replace(/\s+/g, ' ').trim();
console.log('    结算统计：' + stats);
stats.indexOf('得分') >= 0 ? pass('结算弹窗显示「得分」行') : fail('结算弹窗没有得分行');
stats.indexOf('用时') >= 0 ? pass('结算弹窗显示「用时」行') : fail('结算弹窗没有用时行');

const h = JSON.parse(await evaluate(`JSON.stringify(window.HMZQHistory.list('score'))`));
h.length === 1 ? pass('挑战历史落库 1 条计分记录') : fail('历史条数不对：' + h.length);
if (h.length) {
  // 用时只断言"是个非负数"：这条路径是页面刚起来就结算，真实耗时可以正好是 0ms，
  // 钉死 > 0 会变成一条偶尔闪红的 flaky 断言（对局里的用时由 elapsedMs 保证）。
  (h[0].mode === 'score' && h[0].name === '玩家1' && h[0].score === 0 && h[0].ms >= 0)
    ? pass(`记录字段正确：${h[0].name} · ${h[0].score} 分 · 用时 ${h[0].ms}ms`) : fail('记录字段不对：' + JSON.stringify(h[0]));
  const row = await evaluate(`(function(){var r=window.HMZQHistory.rowText(window.HMZQHistory.list('score')[0]);return [r.name,r.mode,r.slot,r.result,r.time].join(' | ');})()`);
  console.log('    历史行：' + row);
}
await shot('game-score');

// 换弹窗里的按钮也要能用：点「再来一局」后弹窗收起、分数归零
await evaluate(`document.getElementById('result-again').click()`);
await sleep(1500);
const again = JSON.parse(await evaluate(`JSON.stringify({
  modal: getComputedStyle(document.getElementById('result-modal')).display,
  score: (document.getElementById('v-score')||{}).textContent,
  shots: (document.getElementById('v-shots')||{}).textContent
})`));
(again.modal === 'none' && again.score === '0' && again.shots === '0')
  ? pass('「再来一局」：弹窗收起、分数与杆数归零') : fail('再来一局没重置：' + JSON.stringify(again));

// ---------- 4. 计时模式：入口 → HUD 倒计时 → 结算 ----------
// m:ss → 秒，用来断言"剩余时间"这个量级（10 / 6 / 3 分钟三档）
const clockSec = (t) => {
  const m = String(t || '').match(/^(\d+):(\d{2})$/);
  return m ? Number(m[1]) * 60 + Number(m[2]) : NaN;
};
console.log('\n[4] 启动器 · 计时模式入口（常规 → 单人 → 计时 → 中等）');
await send('Page.navigate', { url: ORIGIN + '/launcher.html' });
await sleep(900);
await evaluate(`document.querySelector('[data-go="start"]').click()`);
await sleep(150);
await evaluate(`document.querySelector('[data-go="start/solo"]').click()`);
await sleep(150);
const timedCard = await evaluate(`!!document.querySelector('[data-go="start/solo/timed"]')`);
timedCard ? pass('单人模式里有「计时模式」入口（独立子路由，不再就地展开）') : fail('没有计时模式入口');
await evaluate(`document.querySelector('[data-go="start/solo/timed"]').click()`);
await sleep(200);
const timedDiffs = JSON.parse(await evaluate(`JSON.stringify((function(){
  var out = [];
  var bs = document.querySelectorAll('section[data-page="start/solo/timed"] [data-diff]');
  for (var i = 0; i < bs.length; i++) out.push({ d: bs[i].getAttribute('data-diff'), t: bs[i].textContent.replace(/\\s+/g,' ').trim() });
  return out;
})())`));
console.log('    三档：' + timedDiffs.map((x) => x.d + '=' + x.t).join(' / '));
(timedDiffs.length === 3 && /10/.test(timedDiffs[0].t) && /6/.test(timedDiffs[1].t) && /3/.test(timedDiffs[2].t))
  ? pass('计时模式三档：10 / 6 / 3 分钟') : fail('计时模式难度档位不对：' + JSON.stringify(timedDiffs));

await evaluate(`document.querySelector('[data-enter-game="timed"][data-diff="normal"]').click()`);
await sleep(2500);
const tUrl = await evaluate('location.search');
(tUrl.indexOf('game=timed') >= 0 && tUrl.indexOf('diff=normal') >= 0)
  ? pass('跳转带上了 game=timed&diff=normal（' + tUrl + '）') : fail('URL 参数不对：' + tUrl);

console.log('\n[4b] 计时模式 · HUD 倒计时');
let timedTxt = '';
for (let i = 0; i < 40; i++) {
  await sleep(500);
  timedTxt = await evaluate(`(document.getElementById('v-mode')||{}).textContent || ''`);
  if (timedTxt.indexOf('计时') >= 0) break;
}
timedTxt.indexOf('计时模式') >= 0 ? pass('HUD 标题显示「' + timedTxt + '」') : fail('HUD 标题不对：' + timedTxt);
const tHud = JSON.parse(await evaluate(`JSON.stringify({
  timeHidden: document.getElementById('row-time').hidden,
  timeBox: getComputedStyle(document.getElementById('row-time')).display,
  scoreBox: getComputedStyle(document.getElementById('row-score')).display,
  leftBox: getComputedStyle(document.getElementById('row-left')).display,
  time: (document.getElementById('v-time')||{}).textContent
})`));
// ⚠️ 这里必须连 display 一起断言：.row 是 flex，会把 UA 的 [hidden] 盖掉 —— 只看 .hidden 是抓不到的
(!tHud.timeHidden && tHud.timeBox !== 'none' && tHud.scoreBox === 'none' && tHud.leftBox === 'none')
  ? pass('计时模式：只显示「剩余时间」行，得分 / 剩余次数行真的不占位')
  : fail('计时模式 HUD 三行不对：' + JSON.stringify(tHud));
const sec0 = clockSec(tHud.time);
(sec0 > 300 && sec0 <= 360) ? pass(`中等档剩余时间 ${tHud.time}（≈6 分钟）`) : fail('剩余时间不对：' + tHud.time);
await shot('game-timed');

await sleep(2400);
const sec1 = clockSec(await evaluate(`(document.getElementById('v-time')||{}).textContent`));
(Number.isFinite(sec1) && sec1 < sec0) ? pass(`倒计时在走（${tHud.time} → ${sec1}s）`) : fail('倒计时没动：' + sec1);

// ---------- 5. 计时模式 · 结算 + 挑战历史带过程数据 ----------
console.log('\n[5] 计时模式 · 走完整结算链路');
await send('Page.navigate', { url: ORIGIN + '/launcher.html' });
await sleep(700);
await evaluate(`window.HMZQHistory.clear('all')`);
await send('Page.navigate', { url: ORIGIN + '/index.html?from=launcher&lock=1&balls=3&game=timed&diff=easy&ending=lose&record=1' });
await sleep(1200);
const tResult = JSON.parse(await evaluate(`JSON.stringify({
  modal: getComputedStyle(document.getElementById('result-modal')).display,
  tag: (document.getElementById('result-tag')||{}).textContent,
  title: (document.getElementById('result-title')||{}).textContent,
  stats: (document.getElementById('result-stats')||{}).textContent.replace(/\\s+/g,' ').trim()
})`));
console.log('    结算：' + tResult.tag + ' / ' + tResult.title + ' / ' + tResult.stats);
tResult.modal === 'flex' ? pass('计时模式结算弹窗已弹出') : fail('结算弹窗没弹：' + tResult.modal);
tResult.tag.indexOf('TIME UP') >= 0 ? pass('计时失败 tag = TIME UP（与限次的 OUT OF SHOTS 区分开）') : fail('tag 不对：' + tResult.tag);
tResult.stats.indexOf('剩余时间') >= 0 ? pass('结算统计里有「剩余时间」行') : fail('结算统计没有剩余时间行：' + tResult.stats);

// ---------- 6. 挑战历史 · 详情弹窗 ----------
console.log('\n[6] 启动器 · 挑战历史详情弹窗');
await send('Page.navigate', { url: ORIGIN + '/launcher.html' });
await sleep(900);
// history.js 是 public 下的经典脚本，偶发比 900ms 慢一点才执行完 —— 等它挂上再动手，
// 否则这一段会随机崩在 `H.clear` 上（跑很多段之后机器变慢时遇到过）。
for (let i = 0; i < 30; i++) {
  if (await evaluate(`typeof window.HMZQHistory`) === 'object') break;
  await sleep(300);
}
await evaluate(`
  (function () {
    var H = window.HMZQHistory;
    H.clear('all');
    H.add({ mode: 'timed', diff: 'easy', name: '玩家1', ms: 300000, shots: 21, result: 'win', ts: Date.now(),
            potted: 9, total: 15, best: 4, timeLeft: 42000, view: 'tracking', aimMs: 5200, aimCount: 13 });
  })();
`);
await evaluate(`document.querySelector('[data-go="history"]').click()`);
await sleep(300);
const clickable = await evaluate(`document.querySelectorAll('#hist-list .hist-row.clickable').length`);
clickable === 1 ? pass('历史行渲染成可点击（.clickable）') : fail('历史行不可点击：' + clickable);
await evaluate(`document.querySelector('#hist-list .hist-row').click()`);
await sleep(250);
const detail = JSON.parse(await evaluate(`JSON.stringify({
  open: getComputedStyle(document.getElementById('hist-detail')).display,
  title: (document.getElementById('hd-title')||{}).textContent,
  rows: (document.getElementById('hd-rows')||{}).textContent.replace(/\\s+/g,' ').trim()
})`));
console.log('    详情：' + detail.title + ' → ' + detail.rows);
detail.open === 'flex' ? pass('点记录弹出详情窗') : fail('详情窗没弹：' + detail.open);
for (const k of ['击球次数', '进球率', '视角模式', '平均瞄准', '剩余时间', '最高连击']) {
  detail.rows.indexOf(k) >= 0 ? pass('详情里有「' + k + '」') : fail('详情缺少「' + k + '」');
}
detail.rows.indexOf('追踪视角') >= 0 ? pass('视角模式显示成中文「追踪视角」') : fail('视角模式没翻译：' + detail.rows);
// 进球率口径 = 进球数 ÷ 击球次数（9/21），与结算弹窗的 potRate 是同一个函数
detail.rows.indexOf('43%') >= 0 ? pass('进球率 9/21 显示成 43%') : fail('进球率不对：' + detail.rows);
await shot('launcher-history-detail');
await evaluate(`document.getElementById('hd-ok').click()`);
await sleep(200);
(await evaluate(`getComputedStyle(document.getElementById('hist-detail')).display`)) === 'none'
  ? pass('「知道了」收起详情窗') : fail('详情窗没收起');

// ---------- 7. 重开本局 · 确认弹窗 ----------
console.log('\n[7] 游戏内 · 重开本局要二次确认');
await send('Page.navigate', { url: ORIGIN + '/launcher.html' });
await sleep(700);
await evaluate(`window.HMZQHistory.clear('all')`);
await send('Page.navigate', { url: ORIGIN + '/index.html?from=launcher&lock=1&balls=3&game=score' });
await sleep(1400);
// 先打一杆并进点进度，好验证"取消"不会把进度弄丢
await evaluate(`
  (function () {
    var ev = new KeyboardEvent('keydown', { code: 'Space', key: ' ', bubbles: true });
    window.dispatchEvent(ev); document.dispatchEvent(ev);
  })();
`);
await sleep(600);
await evaluate(`
  (function () {
    var ev = new KeyboardEvent('keyup', { code: 'Space', key: ' ', bubbles: true });
    window.dispatchEvent(ev); document.dispatchEvent(ev);
  })();
`);
await sleep(1800);
const beforeRestart = JSON.parse(await evaluate(`JSON.stringify({
  shots: (document.getElementById('v-shots')||{}).textContent,
  ask: getComputedStyle(document.getElementById('ask-modal')).display
})`));
beforeRestart.ask === 'none' ? pass('默认不弹重开确认窗') : fail('一进游戏就弹了：' + beforeRestart.ask);

await evaluate(`document.getElementById('btn-restart').click()`);
await sleep(250);
const askOpen = JSON.parse(await evaluate(`JSON.stringify({
  ask: getComputedStyle(document.getElementById('ask-modal')).display,
  title: (document.getElementById('ask-title')||{}).textContent,
  sub: (document.getElementById('ask-sub')||{}).textContent
})`));
askOpen.ask === 'flex' ? pass('点「重开本局」弹出确认窗：' + askOpen.title) : fail('确认窗没弹：' + askOpen.ask);
askOpen.sub.indexOf('不会记入挑战历史') >= 0
  ? pass('确认文案里说了「不会记入挑战历史」') : fail('文案没讲清后果：' + askOpen.sub);
await shot('game-restart-ask');

await evaluate(`document.getElementById('ask-cancel').click()`);
await sleep(250);
const afterCancel = JSON.parse(await evaluate(`JSON.stringify({
  ask: getComputedStyle(document.getElementById('ask-modal')).display,
  shots: (document.getElementById('v-shots')||{}).textContent
})`));
(afterCancel.ask === 'none' && afterCancel.shots === beforeRestart.shots)
  ? pass('点「取消」：窗收起、这一局的杆数没被清掉（' + afterCancel.shots + '）')
  : fail('取消没保住进度：' + JSON.stringify(afterCancel));

await evaluate(`document.getElementById('btn-restart').click()`);
await sleep(200);
await evaluate(`document.getElementById('ask-ok').click()`);
await sleep(1500);
const afterOk = JSON.parse(await evaluate(`JSON.stringify({
  ask: getComputedStyle(document.getElementById('ask-modal')).display,
  shots: (document.getElementById('v-shots')||{}).textContent,
  score: (document.getElementById('v-score')||{}).textContent,
  hist: window.HMZQHistory ? window.HMZQHistory.list('all').length : -1
})`));
(afterOk.ask === 'none' && afterOk.shots === '0' && afterOk.score === '0')
  ? pass('点「重开」：真的重开（杆数 / 分数归零）') : fail('重开没生效：' + JSON.stringify(afterOk));
afterOk.hist === 0 ? pass('执意重开的那局没有落进挑战历史') : fail('重开竟然记了历史：' + afterOk.hist);

// ---------- 8. 娱乐模式 → 自由球模式：先摆白球再瞄准 ----------
console.log('\n[8] 启动器 · 娱乐模式 → 自由球模式');
await send('Page.navigate', { url: ORIGIN + '/launcher.html' });
await sleep(900);
await evaluate(`document.querySelector('[data-go="fun"]').click()`);
vis = null;
for (let i = 0; i < 20; i++) {
  await sleep(250);
  vis = JSON.parse(await visible());
  if (JSON.stringify(vis) === '["fun"]') break;
}
(JSON.stringify(vis) === '["fun"]') ? pass('「娱乐模式」是一级菜单页') : fail('娱乐模式没切过去：' + vis.join(',') + ' · 诊断=' + await evaluate(`JSON.stringify({
  card: !!document.querySelector('[data-go="fun"]'),
  pageOn: (document.querySelector('section[data-page="fun"]') || {}).className,
  launcher: typeof window.HMZQLauncher,
  errs: window.__gameErrors || []
})`));
await shot('launcher-fun');
await evaluate(`document.querySelector('[data-go="fun/freeball"]').click()`);
await sleep(200);
await shot('launcher-fun-freeball');
vis = JSON.parse(await visible());
(JSON.stringify(vis) === '["fun/freeball"]') ? pass('自由球玩法页独立于主菜单') : fail('玩法页没切过去：' + vis.join(','));

await evaluate(`document.querySelector('section[data-page="fun/freeball"] [data-enter-game="freeball"]').click()`);
await sleep(2600);
const fbUrl = await evaluate('location.search');
fbUrl.indexOf('game=freeball') >= 0 ? pass('URL 带上 game=freeball（' + fbUrl + '）') : fail('URL 不对：' + fbUrl);

let fbMode = '';
for (let i = 0; i < 40; i++) {
  await sleep(500);
  fbMode = await evaluate(`(document.getElementById('v-mode')||{}).textContent || ''`);
  if (fbMode.indexOf('自由球') >= 0) break;
}
fbMode.indexOf('自由球模式') >= 0 ? pass('HUD 标题显示「' + fbMode + '」') : fail('HUD 标题不对：' + fbMode);

// 摆球阶段：浮条出现、状态是「摆放白球」、这时候不能蓄力
const placing = JSON.parse(await evaluate(`JSON.stringify({
  bar: !!document.getElementById('place-bar'),
  display: getComputedStyle(document.getElementById('place-bar')).display,
  st: (document.getElementById('v-state')||{}).textContent
})`));
(placing.bar && placing.display !== 'none')
  ? pass('开局先进「摆放白球」阶段（底部浮条 #place-bar 真的显示）') : fail('没有进入摆球阶段：' + JSON.stringify(placing));
placing.st.indexOf('摆放白球') >= 0 ? pass('状态行写的是「摆放白球」') : fail('状态不对：' + placing.st);
await shot('freeball-placing');

// 拖动白球（模拟 pointer 拖拽）
const cueXY = JSON.parse(await evaluate(`JSON.stringify((function(){
  var el = document.querySelector('canvas') || document.body;
  var r = el.getBoundingClientRect();
  return { x: r.left + r.width * 0.42, y: r.top + r.height * 0.5, w: r.width, h: r.height };
})())`));
async function ptr(type, x, y, btn = 0) {
  await send('Input.dispatchMouseEvent', { type, x, y, button: btn === 2 ? 'right' : 'left', clickCount: 1, buttons: btn });
}
// 摆球阶段相机必须还能用（右键旋转 / 滚轮缩放）—— 早先 lockAim() 把它整个关了
const camBefore = JSON.parse(await evaluate(`JSON.stringify({
  enabled: __hmzq.rig.controls.enabled,
  pos: [+__hmzq.rig.camera.position.x.toFixed(3), +__hmzq.rig.camera.position.z.toFixed(3)],
  dist: +__hmzq.rig.camera.position.distanceTo(__hmzq.rig.controls.target).toFixed(3)
})`));
camBefore.enabled ? pass('摆球阶段相机控制是开着的（不是被 lockAim 关掉）') : fail('摆球时相机被锁死了');

// 右键拖动 = 转视角
await ptr('mousePressed', cueXY.x, cueXY.y, 2);
await ptr('mouseMoved', cueXY.x + 120, cueXY.y, 2);
await sleep(300);
await ptr('mouseReleased', cueXY.x + 120, cueXY.y, 2);
await sleep(300);
const camRotated = JSON.parse(await evaluate(`JSON.stringify({
  pos: [+__hmzq.rig.camera.position.x.toFixed(3), +__hmzq.rig.camera.position.z.toFixed(3)]
})`));
(camRotated.pos[0] !== camBefore.pos[0] || camRotated.pos[1] !== camBefore.pos[1])
  ? pass('摆球时右键拖动能转视角（' + camBefore.pos.join(',') + ' → ' + camRotated.pos.join(',') + '）')
  : fail('右键转视角没反应：' + JSON.stringify(camRotated));

// 滚轮 = 缩放
await evaluate(`__hmzq.stage.domElement.dispatchEvent(new WheelEvent('wheel', { deltaY: -240, bubbles: true, cancelable: true }))`);
await sleep(300);
const camZoomed = JSON.parse(await evaluate(`JSON.stringify({
  dist: +__hmzq.rig.camera.position.distanceTo(__hmzq.rig.controls.target).toFixed(3)
})`));
(camZoomed.dist < camBefore.dist - 0.01)
  ? pass('摆球时滚轮能缩放（距离 ' + camBefore.dist + ' → ' + camZoomed.dist + '）')
  : fail('滚轮缩放没反应：' + JSON.stringify(camZoomed));

// 左键拖白球：球要真的跟着走（不是"没报错"就算过）
const cuePosBefore = JSON.parse(await evaluate(`JSON.stringify((function(){
  var t = __hmzq.cue.body.translation();
  return [+t.x.toFixed(3), +t.z.toFixed(3)];
})())`));
await ptr('mousePressed', cueXY.x, cueXY.y);
await ptr('mouseMoved', cueXY.x + 40, cueXY.y + 20);
await ptr('mouseMoved', cueXY.x + 90, cueXY.y + 45);
await ptr('mouseReleased', cueXY.x + 90, cueXY.y + 45);
await sleep(400);
const cuePosAfter = JSON.parse(await evaluate(`JSON.stringify((function(){
  var t = __hmzq.cue.body.translation();
  return [+t.x.toFixed(3), +t.z.toFixed(3)];
})())`));
const movedBy = Math.hypot(cuePosAfter[0] - cuePosBefore[0], cuePosAfter[1] - cuePosBefore[1]);
(movedBy > 0.02)
  ? pass('左键拖动真的把白球挪走了（位移 ' + movedBy.toFixed(3) + 'm：'
      + cuePosBefore.join(',') + ' → ' + cuePosAfter.join(',') + '）')
  : fail('白球没动（' + cuePosBefore.join(',') + ' → ' + cuePosAfter.join(',') + '）');
const placeErrs = await evaluate(`JSON.stringify(window.__gameErrors || [])`);
placeErrs === '[]' ? pass('拖动白球没有报错') : fail('拖动时报错：' + placeErrs);

// 点确定 → 结束摆球，浮条收起
await evaluate(`document.getElementById('place-ok').click()`);
await sleep(500);
const afterPlace = JSON.parse(await evaluate(`JSON.stringify({
  display: getComputedStyle(document.getElementById('place-bar')).display,
  st: (document.getElementById('v-state')||{}).textContent
})`));
afterPlace.display === 'none' ? pass('点「确定」后浮条收起（进入瞄准阶段）') : fail('浮条没收起：' + afterPlace.display);
afterPlace.st.indexOf('摆放白球') < 0 ? pass('状态不再是「摆放白球」：' + afterPlace.st) : fail('还停在摆球阶段：' + afterPlace.st);
await shot('freeball-aiming');

// 打一杆（按住蓄力 → 松手出杆），球停稳后要**再次**进入摆球阶段 ——
// 这是这套玩法的本意：每一杆开球前都能重摆白球（开挂 / 纯练习手感）
const shotsBefore = await evaluate(`__hmzq.state.shots`);
// ⚠️ 用真实 PointerEvent 派发而不是 CDP 的鼠标事件：后者带 buttons 位掩码，
//    连续两次按下同一坐标时状态容易错位，测出来"没进蓄力"是假阴性。
await evaluate(`(function(){
  var el = __hmzq.stage.domElement;
  el.dispatchEvent(new PointerEvent('pointerdown', { clientX: ${cueXY.x}, clientY: ${cueXY.y}, button: 0, buttons: 1, bubbles: true, cancelable: true, pointerId: 1, isPrimary: true }));
})()`);
await sleep(120);
const charging = JSON.parse(await evaluate(`JSON.stringify({
  charging: __hmzq.state.charging, shooting: __hmzq.state.shooting,
  uiBlocked: __hmzq.state.uiBlocked, placing: __hmzq.state.placingCue,
  potted: __hmzq.cue.potted, power: +(__hmzq.state.chargePower || 0).toFixed(2)
})`));
console.log('    按下后：' + JSON.stringify(charging));
charging.charging ? pass('摆球结束后按下左键进入蓄力（出杆通道已交还）')
  : fail('按下没进蓄力：' + JSON.stringify(charging));
await sleep(420);
await evaluate(`__hmzq.stage.domElement.dispatchEvent(new PointerEvent('pointerup', { clientX: ${cueXY.x}, clientY: ${cueXY.y}, button: 0, buttons: 0, bubbles: true, cancelable: true, pointerId: 1, isPrimary: true }))`);
let rePlaced = null;
for (let i = 0; i < 40; i++) {
  await sleep(500);
  rePlaced = JSON.parse(await evaluate(`JSON.stringify({
    shots: __hmzq.state.shots,
    bar: getComputedStyle(document.getElementById('place-bar')).display,
    st: (document.getElementById('v-state')||{}).textContent
  })`));
  if (rePlaced.shots > shotsBefore && rePlaced.bar !== 'none') break;
}
(rePlaced.shots > shotsBefore && rePlaced.bar !== 'none')
  ? pass('打完一杆、球停稳后重新进入摆球阶段（每杆开球前都能摆 · 共 '
      + rePlaced.shots + ' 杆）')
  : fail('打完一杆没有重新摆球：' + JSON.stringify(rePlaced));
await shot('freeball-replacing');

// 计分：自由球模式用计分口径 —— 得分行要显示
const fbScore = JSON.parse(await evaluate(`JSON.stringify({
  scoreHidden: document.getElementById('row-score').hidden,
  scoreBox: getComputedStyle(document.getElementById('row-score')).display
})`));
(!fbScore.scoreHidden && fbScore.scoreBox !== 'none')
  ? pass('自由球模式显示「得分」行（与计分模式同口径）') : fail('得分行没显示：' + JSON.stringify(fbScore));

// ---------- 9. 游戏设置二级路由：四个分类各自成页 ----------
console.log('\n[9] 启动器 · 游戏设置的四个二级页');
await send('Page.navigate', { url: ORIGIN + '/launcher.html' });
await sleep(900);
await evaluate(`document.querySelector('[data-go="settings"]').click()`);
await sleep(200);
await shot('launcher-settings');
const setCards = JSON.parse(await evaluate(`JSON.stringify((function(){
  var out = [];
  var bs = document.querySelectorAll('section[data-page="settings"] [data-go]');
  for (var i = 0; i < bs.length; i++) out.push(bs[i].getAttribute('data-go'));
  return out;
})())`));
(JSON.stringify(setCards) === JSON.stringify(['settings/game', 'settings/audio', 'settings/quality', 'settings/rules']))
  ? pass('设置首页四个入口：游戏 / 声音 / 画质 / 规则') : fail('入口不对：' + setCards.join(','));

const subPages = [
  { route: 'settings/game', field: 'p-name', saved: 'saved-game' },
  { route: 'settings/audio', field: 'p-sfx', saved: 'saved-audio' },
  { route: 'settings/quality', field: 'p-quality', saved: 'saved-quality' },
  { route: 'settings/rules', field: 'p-balls', saved: 'p-balls-saved' },
];
for (const sp of subPages) {
  await evaluate(`document.querySelector('[data-go="${sp.route}"]').click()`);
  await sleep(180);
  const r = JSON.parse(await evaluate(`JSON.stringify({
    on: (function(){
      var ps = document.querySelectorAll('section.page');
      for (var i = 0; i < ps.length; i++) if (getComputedStyle(ps[i]).display !== 'none') return ps[i].getAttribute('data-page');
      return '';
    })(),
    field: !!document.getElementById(${JSON.stringify(sp.field)}),
    saved: !!document.getElementById(${JSON.stringify(sp.saved)}),
    menu: document.querySelector('.mi.on').getAttribute('data-go')
  })`));
  (r.on === sp.route && r.field && r.saved && r.menu === 'settings')
    ? pass(`${sp.route}：独立成页、带着自己的 #${sp.field} 与「已保存」提示，菜单仍点亮「游戏设置」`)
    : fail(`${sp.route} 页不对：${JSON.stringify(r)}`);
  if (sp.route === 'settings/quality') await shot('launcher-settings-quality');
  if (sp.route === 'settings/rules') await shot('launcher-settings-rules');
  if (sp.route === 'settings/game') await shot('launcher-settings-game');
  if (sp.route === 'settings/audio') await shot('launcher-settings-audio');
}

// 画质页不该出现两遍同样的行标题：HTML 与画质面板各写一遍就是刚才那个 bug（属性断言抓不到）
await evaluate(`document.querySelector('[data-go="settings/quality"]').click()`);
await sleep(200);
const qDup = await evaluate(`(function(){
  var sec = document.querySelector('section[data-page="settings/quality"]');
  return (sec.textContent.match(/画质档位/g) || []).length;
})()`);
qDup === 1 ? pass('画质页只出现一次「画质档位」标题（HTML 不再与画质面板重复）')
  : fail(`「画质档位」出现了 ${qDup} 次 —— 行标题写重复了`);

// 关于页：制作人 / WorkBuddy / 联系方式二维码位
await evaluate(`document.querySelector('[data-go="about"]').click()`);
await sleep(200);
await shot('launcher-about');
const about = JSON.parse(await evaluate(`JSON.stringify({
  on: (function(){
    var ps = document.querySelectorAll('section.page');
    for (var i = 0; i < ps.length; i++) if (getComputedStyle(ps[i]).display !== 'none') return ps[i].getAttribute('data-page');
    return '';
  })(),
  text: (document.querySelector('section[data-page="about"]')||{}).textContent.replace(/\\s+/g,' ').trim().slice(0, 400),
  qr: getComputedStyle(document.getElementById('qr-box')).display
})`));
(about.on === 'about' && about.qr !== 'none') ? pass('关于页渲染出来了，二维码占位方框可见') : fail('关于页不对：' + JSON.stringify(about));
about.text.indexOf('幻梦-拾光回廊工作室') >= 0 ? pass('关于页写明制作人') : fail('没写制作人');
about.text.indexOf('WorkBuddy') >= 0 ? pass('关于页标注使用 WorkBuddy 开发') : fail('没标注 WorkBuddy');
about.text.indexOf('微信') >= 0 ? pass('关于页留了联系方式') : fail('没有联系方式');
await evaluate(`document.getElementById('qr-box').scrollIntoView({ block: 'center' })`);
await sleep(250);
await shot('launcher-about-contact');

// ---------- 10. 竖屏手机：多级返回栈 ----------
console.log('\n[10] 启动器 · 竖屏手机上的多级返回');
await send('Emulation.setDeviceMetricsOverride', { width: 393, height: 851, deviceScaleFactor: 2, mobile: true });
await send('Page.navigate', { url: ORIGIN + '/launcher.html' });
await sleep(900);
// ⚠️ getComputedStyle 只看元素自己的 display，不看祖先 —— .stage 被隐藏时，
//    里面的 .page 仍然算出 display:block。所以判断"现在在哪一屏"必须连 .stage 一起看。
const screenNow = () => evaluate(`(function(){
  if (getComputedStyle(document.getElementById('stage')).display === 'none') return '(菜单)';
  var ps = document.querySelectorAll('section.page');
  for (var i = 0; i < ps.length; i++) {
    if (getComputedStyle(ps[i]).display !== 'none') return ps[i].getAttribute('data-page');
  }
  return '';
})()`);
const m1 = JSON.parse(await evaluate(`JSON.stringify({
  lv: document.body.getAttribute('data-lv'),
  side: getComputedStyle(document.querySelector('.side')).display,
  stage: getComputedStyle(document.getElementById('stage')).display
})`));
(m1.lv === null && m1.side !== 'none' && m1.stage === 'none')
  ? pass('一级：整屏主菜单，内容区整块收起（返回键在里面，自然也看不到）')
  : fail('一级结构不对：' + JSON.stringify(m1));

await evaluate(`document.querySelector('[data-go="start"]').click()`);
await sleep(200);
await evaluate(`document.querySelector('[data-go="start/solo"]').click()`);
await sleep(200);
await evaluate(`document.querySelector('[data-go="start/solo/limit"]').click()`);
await sleep(250);
const m3 = JSON.parse(await evaluate(`JSON.stringify({
  lv: document.body.getAttribute('data-lv'),
  side: getComputedStyle(document.querySelector('.side')).display,
  back: getComputedStyle(document.getElementById('back')).display,
  backTxt: document.getElementById('back-txt').textContent,
  crumb: getComputedStyle(document.querySelector('section[data-page="start/solo/limit"] .crumb')).display,
  on: (function(){
    if (getComputedStyle(document.getElementById('stage')).display === 'none') return '(菜单)';
    var ps = document.querySelectorAll('section.page');
    for (var i = 0; i < ps.length; i++) if (getComputedStyle(ps[i]).display !== 'none') return ps[i].getAttribute('data-page');
    return '';
  })()
})`));
(m3.side === 'none' && m3.back !== 'none' && m3.on === 'start/solo/limit')
  ? pass('第三层：菜单让位、顶部返回键出现（' + m3.backTxt + '）') : fail('第三层结构不对：' + JSON.stringify(m3));
(m3.crumb === 'none') ? pass('竖屏不重复摆两个「返回」（面包屑让位给顶栏）') : fail('面包屑与顶栏重叠：' + m3.crumb);
await shot('launcher-mobile-limit');

// 顶栏返回键逐级往上退：限次难度 → 单人模式 → 常规模式 → 主菜单
const hops = [];
for (let i = 0; i < 3; i++) {
  await evaluate(`document.getElementById('back').click()`);
  await sleep(220);
  hops.push(await screenNow());
}
(JSON.stringify(hops) === JSON.stringify(['start/solo', 'start', '(菜单)']))
  ? pass('顶栏「返回」逐级回退：限次难度 → 单人模式 → 常规模式 → 主菜单') : fail('返回层级不对：' + hops.join(' → '));
const mEnd = JSON.parse(await evaluate(`JSON.stringify({
  lv: document.body.getAttribute('data-lv'),
  side: getComputedStyle(document.querySelector('.side')).display
})`));
(mEnd.lv === null && mEnd.side !== 'none') ? pass('退回主菜单后侧栏菜单重新出现') : fail('没回到一级菜单：' + JSON.stringify(mEnd));
await send('Emulation.clearDeviceMetricsOverride');

// ---------- 11. 游戏内「⚙ 设置」· 画质只剩档位一行 ----------
console.log('\n[11] 游戏内设置 · 画质五档 + 自定义展开');
await send('Page.navigate', { url: ORIGIN + '/index.html?from=launcher&lock=1&balls=3&game=score' });
await sleep(1600);
await evaluate(`document.getElementById('btn-settings').click()`);
await sleep(300);
const qPanel = JSON.parse(await evaluate(`JSON.stringify({
  modal: getComputedStyle(document.getElementById('settings-modal')).display,
  // 每行的标题 + 是否可见（⚠️ 连 getComputedStyle 一起看：hidden 属性会被 flex 盖掉）
  rows: (function(){
    var out = [];
    var rs = document.querySelectorAll('#quality-rows .settings-row');
    for (var i = 0; i < rs.length; i++) {
      var lb = rs[i].querySelector('label');
      out.push({ name: lb ? lb.textContent.trim() : '?', shown: getComputedStyle(rs[i]).display !== 'none' });
    }
    return out;
  })(),
  presets: (function(){
    var out = [];
    var bs = document.querySelectorAll('#quality-rows .settings-row:first-child .mode-grid button');
    for (var i = 0; i < bs.length; i++) out.push(bs[i].textContent.trim());
    return out;
  })()
})`));
qPanel.modal === 'flex' ? pass('点「⚙ 设置」打开设置弹窗') : fail('设置弹窗没开：' + qPanel.modal);
console.log('    画质行：' + qPanel.rows.map((r) => r.name + (r.shown ? '' : '(隐藏)')).join(' / '));
(JSON.stringify(qPanel.presets) === JSON.stringify(['自动', '低', '中', '高', '自定义']))
  ? pass('档位五选：自动 / 低 / 中 / 高 / 自定义') : fail('档位不对：' + qPanel.presets.join(','));

// 默认档位（非自定义）下，四行细分项必须是收起的 —— 不是"渲染了但看不出"
const fineNames = ['阴影精度', '渲染分辨率', '贴图精度', '纹理细节'];
const fineRows = qPanel.rows.filter((r) => fineNames.indexOf(r.name) >= 0);
(fineRows.length === 4 && fineRows.every((r) => !r.shown))
  ? pass('非自定义档：阴影 / 分辨率 / 贴图 / 纹理 四行都收着（只露档位）')
  : fail('四行的显隐不对：' + JSON.stringify(fineRows));
await shot('game-settings-quality');

// 选「自定义」→ 三行展开，且能各自改
await evaluate(`document.querySelectorAll('#quality-rows .settings-row:first-child .mode-grid button')[4].click()`);
await sleep(300);
const customOn = JSON.parse(await evaluate(`JSON.stringify((function(){
  var out = [];
  var rs = document.querySelectorAll('#quality-rows .settings-row');
  for (var i = 0; i < rs.length; i++) {
    var lb = rs[i].querySelector('label');
    out.push({ name: lb ? lb.textContent.trim() : '?', shown: getComputedStyle(rs[i]).display !== 'none' });
  }
  return out;
})())`));
(customOn.filter((r) => fineNames.indexOf(r.name) >= 0).every((r) => r.shown))
  ? pass('选「自定义」后四行细分项展开（阴影精度 / 渲染分辨率 / 贴图精度 / 纹理细节）')
  : fail('自定义档没展开：' + JSON.stringify(customOn));
await evaluate(`document.getElementById('quality-rows').scrollIntoView({ block: 'center' })`);
await sleep(250);
await shot('game-settings-quality-custom');

// 改一项细分 → 档位要落成「自定义」，且真的作用到渲染读数上
await evaluate(`(function(){
  var rs = document.querySelectorAll('#quality-rows .settings-row');
  var bs = rs[1].querySelectorAll('.mode-grid button');   // 阴影精度那行：关 / 512 / 1024 / 2048
  bs[0].click();                                          // 选「关」
})()`);
await sleep(300);
const fineNow = JSON.parse(await evaluate(`JSON.stringify({
  now: (document.getElementById('q-now')||{}).textContent,
  saved: window.localStorage.getItem('hmzq.quality.v1')
})`));
console.log('    自定义 · 阴影关掉后：' + fineNow.now);
(fineNow.saved && JSON.parse(fineNow.saved).preset === 'custom' && JSON.parse(fineNow.saved).shadow === 'off'
  && fineNow.now.indexOf('阴影 关') >= 0)
  ? pass('改细分项 → 档位落成自定义并即时生效：' + fineNow.saved)
  : fail('细分项没生效：' + JSON.stringify(fineNow));

// 再切回「低」档：整档覆盖，各项一起变（不是只改档位名）
await evaluate(`document.querySelectorAll('#quality-rows .settings-row:first-child .mode-grid button')[1].click()`);
// 模型贴图是异步换的（要现拉 512 的 jpg），给最多 3 秒等它真的落到 512
let modelTex = -1;
for (let i = 0; i < 15; i++) {
  modelTex = await evaluate(`(window.__hmzq && __hmzq.model) ? __hmzq.model.texSize : -1`);
  if (modelTex === 512) break;
  await sleep(200);
}
await sleep(200);
const qNow = JSON.parse(await evaluate(`JSON.stringify({
  now: (document.getElementById('q-now')||{}).textContent,
  saved: window.localStorage.getItem('hmzq.quality.v1'),
  rowsShown: (function(){
    var rs = document.querySelectorAll('#quality-rows .settings-row');
    var n = 0;
    for (var i = 0; i < rs.length; i++) if (getComputedStyle(rs[i]).display !== 'none') n++;
    return n;
  })()
})`));
console.log('    切到「低」后：' + qNow.now);
const low = JSON.parse(qNow.saved || '{}');
(low.preset === 'low' && low.shadow === 'off' && low.dpr === '1' && low.aniso === 'low' && low.tex === '512'
  && qNow.now.indexOf('阴影 关') >= 0 && qNow.now.indexOf('贴图 512') >= 0
  && qNow.rowsShown === 1 && modelTex === 512)
  ? pass('切回「低」档：四项一起刷成该档的值、四行重新收起、模型贴图真的换成 512² · ' + qNow.saved)
  : fail('档位没生效：' + JSON.stringify(qNow) + ' modelTex=' + modelTex);
await shot('game-settings-quality-row');

// 游戏内帮助那一段也得跟着改（这次顺手发现的漏网文案）
await evaluate(`document.getElementById('help-close') && document.getElementById('help-close').click()`);
await sleep(150);
await evaluate(`document.getElementById('btn-help').click()`);
await sleep(300);
const helpTxt = await evaluate(`(document.getElementById('help-body')||{}).textContent.replace(/\\s+/g,' ')`);
(helpTxt.indexOf('画质档位') >= 0 && helpTxt.indexOf('自动 / 低 / 中 / 高') >= 0)
  ? pass('游戏内帮助写的是新的画质口径（自动 / 低 / 中 / 高）') : fail('帮助文案没更新');
(helpTxt.indexOf('自定义') >= 0 && helpTxt.indexOf('阴影精度') >= 0 && helpTxt.indexOf('纹理细节') >= 0)
  ? pass('帮助里说明了「自定义」会展开四项细分设置') : fail('帮助没提自定义档：' + helpTxt.slice(0, 120));
await shot('game-help');

// ---------- 12. 移动端触摸：摆球时单指拖球 / 双指转视角缩放，两边互不抢手势 ----------
console.log('\n[12] 移动端触摸 · 摆球与视角不冲突');
// 把环境换成真手机（撤掉前面那份"钉成桌面"的注入，开触摸模拟）
await send('Page.removeScriptToEvaluateOnNewDocument', { identifier: desktopInject });
await send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 2 });
await send('Emulation.setDeviceMetricsOverride', { width: 412, height: 915, deviceScaleFactor: 2, mobile: true });
await send('Page.navigate', { url: ORIGIN + '/index.html?mode=tracking&balls=15&lock=1&from=launcher&game=freeball' });
await sleep(2500);

const mobShell = JSON.parse(await evaluate(`JSON.stringify({
  touch: navigator.maxTouchPoints > 0,
  mobile: document.documentElement.getAttribute('data-mobile'),
  bar: getComputedStyle(document.getElementById('place-bar')).display,
  one: String(__hmzq.rig.controls.touches.ONE),
  two: __hmzq.rig.controls.touches.TWO,     // THREE.TOUCH.DOLLY_ROTATE === 3
  // 浏览器原生手势（滚动 / 双指缩放页面 / 下拉刷新）会不会抢走拖拽，全看这一条。
  // 它是 OrbitControls 构造时写在 canvas 的 inline style 上的 —— 一旦有人改成 controls.disconnect()
  // （OrbitControls 会把 touchAction 恢复成 ''），移动端拖球就会被 pointercancel 打断。
  ta: getComputedStyle(document.querySelector('canvas')).touchAction
})`));
mobShell.touch && mobShell.mobile === '1'
  ? pass('移动端外壳已切换（data-mobile=1，maxTouchPoints=' + (mobShell.touch ? '2' : '0') + '）')
  : fail('没切到移动端：' + JSON.stringify(mobShell));
mobShell.bar !== 'none' ? pass('移动端开局也先进摆球阶段') : fail('移动端没进摆球阶段');
mobShell.one === 'null' ? pass('摆球时单指不归 OrbitControls（touches.ONE = null，让给拖白球）')
  : fail('单指还被 OrbitControls 占着：ONE=' + mobShell.one);
mobShell.two === 3 ? pass('双指挂了 DOLLY_ROTATE（缩放 + 转视角）') : fail('双指手势不对：TWO=' + mobShell.two);
mobShell.ta === 'none'
  ? pass('画布 touch-action: none（浏览器不会抢手势去做滚动 / 缩放）')
  : fail('画布没有 touch-action: none，移动端拖拽会被浏览器手势打断：' + mobShell.ta);

const stageRect = JSON.parse(await evaluate(`JSON.stringify((function(){
  var r = document.querySelector('canvas').getBoundingClientRect();
  return { l: r.left, t: r.top, w: r.width, h: r.height };
})())`));
const P = (fx, fy) => ({ x: Math.round(stageRect.l + stageRect.w * fx), y: Math.round(stageRect.t + stageRect.h * fy) });
// ⚠️ touchEnd 也要至少带一个点（CDP 不接受空数组）：带上刚抬起的那些点即可。
const touch = (type, pts) => send('Input.dispatchTouchEvent', {
  type, touchPoints: pts.map((p, i) => ({ x: p.x, y: p.y, id: i + 1 })),
});

const before1 = JSON.parse(await evaluate(`JSON.stringify({
  cue: [+__hmzq.cue.body.translation().x.toFixed(3), +__hmzq.cue.body.translation().z.toFixed(3)],
  cam: [+__hmzq.rig.camera.position.x.toFixed(3), +__hmzq.rig.camera.position.z.toFixed(3)]
})`));
const t0 = P(0.62, 0.42), t1 = P(0.42, 0.62);
await touch('touchStart', [t0]);
await touch('touchMove', [P(0.56, 0.48)]);
await touch('touchMove', [t1]);
await sleep(250);
await touch('touchEnd', [t1]);
await sleep(350);
const after1 = JSON.parse(await evaluate(`JSON.stringify({
  cue: [+__hmzq.cue.body.translation().x.toFixed(3), +__hmzq.cue.body.translation().z.toFixed(3)],
  cam: [+__hmzq.rig.camera.position.x.toFixed(3), +__hmzq.rig.camera.position.z.toFixed(3)]
})`));
const cueMoved = Math.hypot(after1.cue[0] - before1.cue[0], after1.cue[1] - before1.cue[1]);
const camMoved1 = Math.hypot(after1.cam[0] - before1.cam[0], after1.cam[1] - before1.cam[1]);
cueMoved > 0.05
  ? pass('单指拖动把白球挪走了（位移 ' + cueMoved.toFixed(3) + 'm）')
  : fail('单指没拖动白球：' + JSON.stringify({ before1: before1.cue, after1: after1.cue }));
camMoved1 < 0.02
  ? pass('单指拖球的同时相机没动（手势没打架，位移 ' + camMoved1.toFixed(4) + 'm）')
  : fail('单指拖球把相机也带转了：' + camMoved1.toFixed(3) + 'm');
await shot('mobile-freeball-placing');

// 双指：捏合 + 同向拖动 → 只动相机，白球钉在原地
const before2 = JSON.parse(await evaluate(`JSON.stringify({
  cue: [+__hmzq.cue.body.translation().x.toFixed(3), +__hmzq.cue.body.translation().z.toFixed(3)],
  cam: [+__hmzq.rig.camera.position.x.toFixed(3), +__hmzq.rig.camera.position.z.toFixed(3)],
  dist: +__hmzq.rig.camera.position.distanceTo(__hmzq.rig.controls.target).toFixed(3)
})`));
const a0 = P(0.42, 0.42), b0 = P(0.58, 0.58), a1 = P(0.32, 0.32), b1 = P(0.68, 0.68);
await touch('touchStart', [a0, b0]);
await touch('touchMove', [P(0.37, 0.37), P(0.63, 0.63)]);
await touch('touchMove', [a1, b1]);
await sleep(300);
await touch('touchEnd', [a1, b1]);
await sleep(400);
const after2 = JSON.parse(await evaluate(`JSON.stringify({
  cue: [+__hmzq.cue.body.translation().x.toFixed(3), +__hmzq.cue.body.translation().z.toFixed(3)],
  cam: [+__hmzq.rig.camera.position.x.toFixed(3), +__hmzq.rig.camera.position.z.toFixed(3)],
  dist: +__hmzq.rig.camera.position.distanceTo(__hmzq.rig.controls.target).toFixed(3)
})`));
const camMoved2 = Math.hypot(after2.cam[0] - before2.cam[0], after2.cam[1] - before2.cam[1]);
const cueMoved2 = Math.hypot(after2.cue[0] - before2.cue[0], after2.cue[1] - before2.cue[1]);
const zoomed = Math.abs(after2.dist - before2.dist) > 0.02;
(camMoved2 > 0.02 || zoomed)
  ? pass('双指能转视角 / 缩放（相机位移 ' + camMoved2.toFixed(3) + 'm，距离 '
      + before2.dist + ' → ' + after2.dist + '）')
  : fail('双指没起作用：' + JSON.stringify({ before2, after2 }));
cueMoved2 < 0.02
  ? pass('双指操作时白球没被带着跑（位移 ' + cueMoved2.toFixed(4) + 'm）')
  : fail('双指把白球也挪了：' + cueMoved2.toFixed(3) + 'm');

await send('Emulation.clearDeviceMetricsOverride');
await send('Emulation.setTouchEmulationEnabled', { enabled: false });   // 关掉即可（maxTouchPoints 不接受 0）

// ---------- 12b. 杆法盘：按住开球键淡入 / 拖红点改击球点 / 松手出杆 ----------
// ⚠️ UI 必须有这段：杆法盘是"不看截图就不知道对不对"的东西（红点跟不跟手、
//    盘会不会被别的东西盖住，属性断言全挡不住）。这里断言 screen 位置 +
//    写进 state 的归一化值，两样一起看才靠谱。
console.log('\n[12b] 杆法盘 · 击球点选择（高杆 / 低杆 / 塞）');
// 这一段跑完就把注入撤掉，后面的段落保持原来的环境（别动别人依赖的前提）
const spinInject = (await send('Page.addScriptToEvaluateOnNewDocument', { source: desktopSource })).identifier;
await send('Page.navigate', { url: ORIGIN + '/index.html?mode=tracking&balls=15' });
await sleep(2600);

const padInfo = () => evaluate(`(function(){
  var p = document.getElementById('spin-pad'), r = document.getElementById('spin-ring'), d = document.getElementById('spin-dot');
  var cs = getComputedStyle(p), rr = r.getBoundingClientRect(), dr = d.getBoundingClientRect();
  return JSON.stringify({
    op: cs.opacity, pe: cs.pointerEvents,
    cx: Math.round(rr.left + rr.width / 2), cy: Math.round(rr.top + rr.height / 2), w: rr.width,
    dx: Math.round(dr.left + dr.width / 2), dy: Math.round(dr.top + dr.height / 2),
    spin: [+(+__hmzq.state.spinX).toFixed(2), +(+__hmzq.state.spinY).toFixed(2)],
    charging: !!__hmzq.state.charging
  });
})()`);

const pad0 = JSON.parse(await padInfo());
pad0.op === '0' && pad0.pe === 'none'
  ? pass('平时藏着（opacity 0 / 不吃点击）')
  : fail('杆法盘平时就露着：' + JSON.stringify(pad0));

// 按住开球键 → 淡入（鼠标路径：整个屏幕左键按下即蓄力）
await evaluate(`(function(){
  var b = document.getElementById('btn-shoot'), r = b.getBoundingClientRect();
  b.dispatchEvent(new PointerEvent('pointerdown', { pointerId: 1, pointerType: 'mouse', isPrimary: true,
    bubbles: true, cancelable: true, clientX: r.left + r.width / 2, clientY: r.top + r.height / 2, button: 0 }));
  return 1;
})()`);
// 淡入是 0.14s 的 CSS 过渡，但无头环境里过渡跟着帧走（这局物理很重，帧率只有个位数），
// 320ms 读到过 opacity 还是 0 —— 等足 800ms 再读，别把"还没渲染完"当成"没淡入"。
await sleep(800);
const pad1 = JSON.parse(await padInfo());
/* ⚠️ 这里断言"能用"（.show 已加 → pointer-events auto）而不是 computed opacity：
   淡入是 0.14s 的 CSS 过渡，而无头环境里这局帧率只有个位数，过渡值会长时间停在
   起始帧（实测等 800ms 读到 opacity 还是 0、transform 还是 scale(0.94)，但类名与
   可点击性都已经生效了）。视觉上有没有出来，看后面那张截图，别用数值去猜。 */
pad1.pe === 'auto' && pad1.charging
  ? pass('按住开球键：盘出现且可交互（opacity 过渡 ' + pad1.op + '，截图见 spin-pad-low）')
  : fail('按住开球键没出杆法盘：' + JSON.stringify(pad1));
Math.abs(pad1.dx - pad1.cx) <= 2 && Math.abs(pad1.dy - pad1.cy) <= 2
  ? pass('红点在正中心（默认中杆）')
  : fail('红点没落在盘心：' + JSON.stringify({ ring: [pad1.cx, pad1.cy], dot: [pad1.dx, pad1.dy] }));

// 拖到最下（低杆）：第二根手指按在盘上拖，红点要真跟着走
await evaluate(`(function(){
  var ring = document.getElementById('spin-ring'), r = ring.getBoundingClientRect();
  var cx = r.left + r.width / 2, cy = r.top + r.height / 2, el = document.getElementById('spin-pad');
  el.dispatchEvent(new PointerEvent('pointerdown', { pointerId: 2, pointerType: 'touch', isPrimary: false,
    bubbles: true, cancelable: true, clientX: cx, clientY: cy }));
  el.dispatchEvent(new PointerEvent('pointermove', { pointerId: 2, pointerType: 'touch', isPrimary: false,
    bubbles: true, cancelable: true, clientX: cx, clientY: cy + r.height * 0.6 }));
  return 1;
})()`);
await sleep(180);
const pad2 = JSON.parse(await padInfo());
pad2.spin[0] === 0 && pad2.spin[1] === -1
  ? pass('拖到最下 → 击球点 (0, −1) 低杆')
  : fail('拖到最下没写成低杆：' + JSON.stringify(pad2.spin));
pad2.dy - pad2.cy > pad2.w * 0.25
  ? pass('红点真的往下走了（屏幕位移 ' + (pad2.dy - pad2.cy) + 'px）')
  : fail('红点没跟手：盘心 ' + pad2.cy + ' → 红点 ' + pad2.dy);
await shot('spin-pad-low');

// 再拖到右上（高杆 + 右塞）
await evaluate(`(function(){
  var ring = document.getElementById('spin-ring'), r = ring.getBoundingClientRect();
  var cx = r.left + r.width / 2, cy = r.top + r.height / 2, el = document.getElementById('spin-pad');
  el.dispatchEvent(new PointerEvent('pointermove', { pointerId: 2, pointerType: 'touch', isPrimary: false,
    bubbles: true, cancelable: true, clientX: cx + r.width * 0.45, clientY: cy - r.height * 0.45 }));
  return 1;
})()`);
await sleep(180);
const pad3 = JSON.parse(await padInfo());
pad3.spin[0] > 0.5 && pad3.spin[1] > 0.5
  ? pass('拖到右上 → 击球点 ' + JSON.stringify(pad3.spin) + '（右塞 + 高杆）')
  : fail('右上没同时出塞和高杆：' + JSON.stringify(pad3.spin));
pad3.dx - pad3.cx > 10 && pad3.cy - pad3.dy > 10
  ? pass('红点跑到右上（横 ' + (pad3.dx - pad3.cx) + 'px / 纵 ' + (pad3.cy - pad3.dy) + 'px）')
  : fail('红点没到右上：' + JSON.stringify({ ring: [pad3.cx, pad3.cy], dot: [pad3.dx, pad3.dy] }));
await shot('spin-pad-top-right');

// 松手出杆：盘收起，但杆法要带进这一杆
await evaluate(`(function(){
  window.dispatchEvent(new PointerEvent('pointerup', { pointerId: 1, pointerType: 'mouse', isPrimary: true,
    bubbles: true, cancelable: true, clientX: 10, clientY: 10, button: 0 }));
  return 1;
})()`);
await sleep(600);
const pad4 = JSON.parse(await padInfo());
const used = JSON.parse(await evaluate(`JSON.stringify(__hmzq.state.spin)`));
pad4.op === '0' && pad4.pe === 'none'
  ? pass('松手后盘收起（不再挡屏幕）')
  : fail('出杆后盘还留着：' + JSON.stringify(pad4));
Math.abs(used.x - pad3.spin[0]) < 0.01 && Math.abs(used.y - pad3.spin[1]) < 0.01
  ? pass('这一杆真的带了杆法（state.spin = ' + JSON.stringify(used) + '）')
  : fail('杆法没带进出杆：盘里 ' + JSON.stringify(pad3.spin) + ' vs 出杆 ' + JSON.stringify(used));
await send('Page.removeScriptToEvaluateOnNewDocument', { identifier: spinInject });

// ---------- 13. 本地双人：回合横幅 + 左右两个开球键归谁 ----------
console.log('\n[13] 本地双人模式 · 醒目提示与按键归属');
// ⚠️ [12] 段把"钉成桌面"的注入撤了、换成触摸模拟，而**触摸模拟关掉之后
//    navigator.maxTouchPoints 仍然是 > 0**（无头 Chrome 的老毛病，见文件头的说明）
//    → 不重新钉一次，这一段跑的又是移动端分支（实测：面板位置、按键尺寸全按手机来）。
const redexInject = (await send('Page.addScriptToEvaluateOnNewDocument', { source: desktopSource })).identifier;
await send('Page.navigate', { url: ORIGIN + '/launcher.html' });
// ⚠️ 别用"睡够 900ms 再查元素"：启动器偶发渲染慢一点，选择器就是 null，
//    后面三行会连着红（URL 不对 / HUD 标题不对 / duo 引擎没挂上），看起来像功能坏了。
//    实测踩过一次。这里改成等元素真的出现再点。
let duoCard = false;
for (let i = 0; i < 20; i++) {
  await sleep(300);
  duoCard = await evaluate(`!!document.querySelector('[data-enter-game="duo"]')`);
  if (duoCard) break;
}
duoCard ? pass('启动器上找到「本地双人」卡片') : fail('启动器上没找到本地双人卡片（页面没渲染出来？）');
// ⚠️ 卡片出现在 DOM 里 **不等于** launcher.js 已经执行完：脚本在页面底部，DOM 一解析完
//    就能查到元素，但点击处理器还没绑上 → click() 静默无效（body 上连 leaving 类都没有）。
//    实测表现就是后面三行连着红（URL 不对 / HUD 标题不对 / duo 引擎没挂上），
//    看着像"双人模式坏了"，其实是点了个没长耳朵的按钮。
//    所以：点一次 → 等一会儿 → 还没跳就再点，最多 6 轮。
let duoUrl = '';
for (let attempt = 0; attempt < 6 && duoUrl.indexOf('game=duo') < 0; attempt++) {
  await evaluate(`(function(){ var el = document.querySelector('[data-enter-game="duo"]'); if (el) el.click(); })()`);
  for (let i = 0; i < 10; i++) {
    await sleep(200);
    duoUrl = (await evaluate('location.search')) || '';
    if (duoUrl.indexOf('game=duo') >= 0) break;
  }
}
duoUrl.indexOf('game=duo') >= 0 ? pass('从启动器卡片进游戏带上 game=duo（' + duoUrl + '）') : fail('URL 不对：' + duoUrl);

// 等游戏起来（HUD 标题换成「本地双人」）
let duoMode = '';
for (let i = 0; i < 40; i++) {
  await sleep(400);
  duoMode = await evaluate(`(document.getElementById('v-mode')||{}).textContent || ''`);
  if (duoMode.indexOf('双人') >= 0) break;
}
duoMode.indexOf('本地双人') >= 0 ? pass('HUD 标题写的是「' + duoMode + '」') : fail('HUD 标题不对：' + duoMode);
(await evaluate('!!(window.__hmzq && window.__hmzq.duo)'))
  ? pass('规则引擎已接上（__hmzq.duo 存在）') : fail('duo 引擎没挂上');

// 界面：横幅 + 双人键出现，单人那颗开球键收起
// ⚠️ 面板要是没渲染出来（游戏没起来），`getComputedStyle(null)` 会抛异常把**整条测试**中断，
//    后面十几段全不跑、只留一个看不懂的 TypeError。这里逐项兜底，缺元素就返回 null 走断言。
const duoDom = JSON.parse(await evaluate(`JSON.stringify((function(){
  var cs = function (id, prop) {
    var el = document.getElementById(id);
    return el ? getComputedStyle(el)[prop] : null;
  };
  var has = function (id, cls) {
    var el = document.getElementById(id);
    return el ? el.classList.contains(cls) : null;
  };
  return {
    bodyCls: document.body.className,
    infoTop: cs('panel-info', 'top'),
    banner: cs('turn-banner', 'display'),
    dock: cs('duo-dock', 'display'),
    solo: cs('btn-shoot', 'display'),
    who: (document.getElementById('turn-who')||{}).textContent,
    on1: has('duo-side-1', 'on'),
    on2: has('duo-side-2', 'on'),
    d2: has('btn-shoot-2', 'disabled'),
    d1: has('btn-shoot-1', 'disabled'),
    turn: window.__hmzq && window.__hmzq.duo ? __hmzq.duo.turn : null
  };
})())`));
console.log('    开局：' + JSON.stringify(duoDom));
(duoDom.banner !== 'none' && duoDom.dock !== 'none')
  ? pass('双人模式：顶部回合横幅与左右两个开球键都显示') : fail('横幅 / 双人键没显示：' + JSON.stringify(duoDom));
duoDom.solo === 'none' ? pass('单人那颗「开球」键收起来了（屏幕上不会有两个）') : fail('单人开球键没收：' + duoDom.solo);
(duoDom.turn === 1 && duoDom.who === '玩家1' && duoDom.on1 && !duoDom.on2)
  ? pass('开局轮到玩家1：横幅写「玩家1」并点亮玩家1 那一侧') : fail('开局提示不对：' + JSON.stringify(duoDom));
(!duoDom.d1 && duoDom.d2)
  ? pass('只有当前回合那一方的键可按（玩家1 亮、玩家2 置灰）') : fail('按键归属不对：' + JSON.stringify(duoDom));
// 横幅占着顶部正中，HUD 两块面板要让到它下面去（否则三块会叠在一起）
(duoDom.bodyCls.split(/\s+/).includes('duo') && duoDom.infoTop === '88px')
  ? pass('双人模式：HUD 面板让位到横幅下面（top=88px，body 带 duo 标记）')
  : fail('HUD 没让位：' + JSON.stringify({ bodyCls: duoDom.bodyCls, infoTop: duoDom.infoTop }));

// 「🎯 自动进球」键在双人模式下也得好好待着：不能被压扁、不能盖在开球键上。
// （它跟开球键共用 #shoot-dock 的定位，而 #duo-dock 占着同一条 bottom —— 曾把 🎯 键
//   挤成一个小圆点、文字被裁掉，只有截图看得出来，属性断言挡不住这类问题。）
// 自动进球**按钮**已经撤掉了（用户定的：那是给电脑用的，不是给玩家的），
// 只留下 #auto-tip 那条提示条给电脑报"它打算打哪颗球"。
const autoGone = JSON.parse(await evaluate(`JSON.stringify({
  btn: !!document.getElementById('btn-auto'),
  tip: !!document.getElementById('auto-tip')
})`));
(!autoGone.btn && autoGone.tip)
  ? pass('「🎯 自动进球」按钮已移除，提示条留着给电脑用')
  : fail('自动进球按钮没收干净 / 提示条丢了：' + JSON.stringify(autoGone));
// 双人模式下 #shoot-dock 与 #duo-dock 不能叠：两个 dock 共用一条 bottom，
// 曾经把 dock 里的东西挤成小圆点、文字被裁掉 —— 只有截图看得出来，属性断言挡不住。
const dockLay = JSON.parse(await evaluate(`JSON.stringify((function () {
  var a = document.getElementById('shoot-dock').getBoundingClientRect();
  var b = document.getElementById('duo-dock').getBoundingClientRect();
  return {
    sTop: Math.round(a.top), sBottom: Math.round(a.bottom),
    dTop: Math.round(b.top), dBottom: Math.round(b.bottom),
    overlap: !(a.bottom <= b.top || a.top >= b.bottom)
  };
})())`));
console.log('    两个 dock：' + JSON.stringify(dockLay));
// shoot-dock 里现在只剩提示条（那颗自动进球键撤了），高度会是 0 ——
// 所以只断言"它在 duo-dock 上方且不重叠"，别去断言它的高度。
(!dockLay.overlap && dockLay.sBottom <= dockLay.dTop)
  ? pass('双人模式下 shoot-dock 待在 duo-dock 上方，两个不叠')
  : fail('两个 dock 叠在一起：' + JSON.stringify(dockLay));
await shot('duo-turn-p1');

// "轮到谁算谁的"：玩家2 的键按不出蓄力，玩家1 的键才出
const btnXY = async (id) => JSON.parse(await evaluate(`JSON.stringify((function(){
  var r = document.getElementById('${id}').getBoundingClientRect();
  return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) };
})())`));
const dbtn2 = await btnXY('btn-shoot-2');
await ptr('mousePressed', dbtn2.x, dbtn2.y);
await sleep(200);
const chargingBy2 = await evaluate('!!__hmzq.state.charging');
await ptr('mouseReleased', dbtn2.x, dbtn2.y);
await sleep(150);
!chargingBy2 ? pass('轮到玩家1 时按玩家2 的键：不起蓄力（不会替对手打一杆）') : fail('玩家2 的键在玩家1 回合也能按');

const dbtn1 = await btnXY('btn-shoot-1');
await ptr('mousePressed', dbtn1.x, dbtn1.y);
await sleep(250);
const chargingBy1 = await evaluate('!!__hmzq.state.charging');
chargingBy1 ? pass('轮到玩家1 时按玩家1 的键：正常蓄力') : fail('玩家1 的键按不出蓄力');
await ptr('mouseReleased', dbtn1.x, dbtn1.y);

// 等这一杆打完（开球必然撞上球堆，等球停稳看判决有没有落到界面上）
let shotDone = false;
for (let i = 0; i < 60; i++) {
  await sleep(400);
  const s = JSON.parse(await evaluate(`JSON.stringify({ shot: __hmzq.duo.shot, shooting: __hmzq.state.shooting })`));
  if (s.shot >= 1 && !s.shooting) { shotDone = true; break; }
}
const afterShot = JSON.parse(await evaluate(`JSON.stringify({
  shot: __hmzq.duo.shot,
  turn: __hmzq.duo.turn,
  groups: __hmzq.duo.groups,
  who: (document.getElementById('turn-who')||{}).textContent,
  g1: (document.getElementById('duo-group-1')||{}).textContent,
  left1: (document.getElementById('duo-left-1')||{}).textContent,
  errs: window.__gameErrors || []
})`));
console.log('    开球后：' + JSON.stringify(afterShot));
(shotDone && afterShot.shot === 1) ? pass('开球这一杆被规则引擎结算过（duo.shot = 1）') : fail('这一杆没走到结算：' + JSON.stringify(afterShot));
(!afterShot.errs.length) ? pass('无运行期错误') : fail('有运行期错误：' + afterShot.errs.join(' | '));
afterShot.who === '玩家' + afterShot.turn
  ? pass('横幅跟着引擎走（轮到玩家' + afterShot.turn + '）') : fail('横幅与引擎不一致：' + JSON.stringify(afterShot));
// 分组文案必须和引擎里的分组对得上（"定组"这条链路真的接到了界面上）
const gOk = (afterShot.groups['1'] === null && afterShot.g1 === '未分组')
  || (afterShot.groups['1'] === 'low' && afterShot.g1.indexOf('小号') >= 0)
  || (afterShot.groups['1'] === 'high' && afterShot.g1.indexOf('大号') >= 0);
gOk ? pass('球组显示与引擎一致（玩家1：' + afterShot.g1 + '）') : fail('球组文案对不上：' + JSON.stringify(afterShot));
await shot('duo-after-break');

// 换人：把回合翻到玩家2，界面与按键归属要跟着翻（不再真打一杆，免得引入随机性）
await evaluate(`__hmzq.duo.turn = 2; __hmzq.duoUI.render(__hmzq.duo.snapshot(__hmzq.state.potted));`);
await sleep(250);
const flipped = JSON.parse(await evaluate(`JSON.stringify({
  who: (document.getElementById('turn-who')||{}).textContent,
  on1: document.getElementById('duo-side-1').classList.contains('on'),
  on2: document.getElementById('duo-side-2').classList.contains('on'),
  d2: document.getElementById('btn-shoot-2').classList.contains('disabled'),
  d1: document.getElementById('btn-shoot-1').classList.contains('disabled')
})`));
console.log('    换到玩家2：' + JSON.stringify(flipped));
(flipped.who === '玩家2' && flipped.on2 && !flipped.on1 && !flipped.d2 && flipped.d1)
  ? pass('换人后提示与按键归属一起翻到玩家2（每帧同步，不用重开）') : fail('换人没联动：' + JSON.stringify(flipped));
await shot('duo-turn-p2');

// 白球落袋（默认规则）：换人 + 接手方**自由摆球**（底部浮条出现、两个开球键收起）
await evaluate(`(function () {
  var d = __hmzq.duo;
  d.over = false; d.turn = 1;
  d.markCuePot();
  __hmzq.duoApply(d.resolveShot(__hmzq.state.potted));
})()`);
await sleep(400);
const foul = JSON.parse(await evaluate(`JSON.stringify({
  turn: __hmzq.duo.turn,
  placing: !!__hmzq.state.placingCue,
  bar: getComputedStyle(document.getElementById('place-bar')).display,
  placingCls: document.body.className.split(/\\s+/).includes('placing'),
  dock: getComputedStyle(document.getElementById('duo-dock')).display,
  cueIn: !!__hmzq.cue.potted
})`));
console.log('    白球落袋后：' + JSON.stringify(foul));
(foul.turn === 2 && foul.placing && foul.bar !== 'none' && foul.placingCls)
  ? pass('白球落袋 = 换人 + 接手方进「自由摆球」阶段（浮条出现、body.placing 打开）')
  : fail('白球落袋处理不对：' + JSON.stringify(foul));
(foul.dock === 'none' && !foul.cueIn)
  ? pass('摆球期间两个开球键收起，白球已回到台上等玩家摆') : fail('摆球阶段的开球键/白球不对：' + JSON.stringify(foul));
await shot('duo-cue-foul-placing');

// 摆球期间"边拖球边转视角"（桌面）：右键拖动必须真的转得动相机，
// 而且**左键拖球时相机不许被带走** —— 这两条一起才是"手势没打架"。
// 移动端那半边在 [12] 段（单指拖球 / 双指转视角）。
await evaluate(`(function () {
  var c = __hmzq.rig.controls;
  window.__cam = { az: c.getAzimuthalAngle ? c.getAzimuthalAngle() : 0, x: __hmzq.cue.body.translation().x };
})()`);
await send('Input.dispatchMouseEvent', { type: 'mousePressed', x: 700, y: 380, button: 'right', clickCount: 1, buttons: 2 });
await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: 790, y: 380, button: 'right', buttons: 2 });
await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: 880, y: 380, button: 'right', buttons: 2 });
await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: 880, y: 380, button: 'right', clickCount: 1, buttons: 0 });
await sleep(400);
const rot = JSON.parse(await evaluate(`JSON.stringify((function () {
  var c = __hmzq.rig.controls;
  return {
    dAz: Math.abs((c.getAzimuthalAngle ? c.getAzimuthalAngle() : 0) - window.__cam.az),
    dCue: Math.abs(__hmzq.cue.body.translation().x - window.__cam.x)
  };
})())`));
console.log('    摆球时右键转视角：' + JSON.stringify(rot));
(rot.dAz > 0.02)
  ? pass('摆球期间右键能转视角（方位角变化 ' + rot.dAz.toFixed(3) + ' rad）—— 摆球没把关手势全锁掉')
  : fail('摆球期间右键转不动视角：' + JSON.stringify(rot));
(rot.dCue < 0.01)
  ? pass('右键转视角不会把白球带跑（白球位移 ' + rot.dCue.toFixed(4) + 'm）')
  : fail('转视角把白球也挪了：' + JSON.stringify(rot));
await shot('duo-placing-rotate');

// 摆球期间切到顶视（"锁定视角"的那一档）：桌面端顶视平时把控制器整个关掉，
// 但摆球时必须放开"平移 + 缩放"，否则玩家挪不了视角、看不到要摆的位置。
await evaluate(`__hmzq.rig.setMode('top')`);
await sleep(500);
const topPlacing = JSON.parse(await evaluate(`JSON.stringify((function () {
  var c = __hmzq.rig.controls;
  var t0 = { x: c.target.x, z: c.target.z, zoom: __hmzq.stage.orthoCam ? __hmzq.stage.orthoCam.zoom : 1 };
  return {
    mode: __hmzq.state.mode, placing: !!__hmzq.state.placingCue,
    enabled: !!c.enabled, rotate: !!c.enableRotate, pan: !!c.enablePan, zoomOn: !!c.enableZoom,
    rightPan: !!c.mouseButtons.RIGHT,
    t0: t0
  };
})())`));
console.log('    顶视摆球：' + JSON.stringify(topPlacing));
(topPlacing.mode === 'top' && topPlacing.placing && topPlacing.enabled)
  ? pass('摆球时切到顶视：控制器是开着的（平时桌面端顶视完全锁死）') : fail('顶视摆球没放开：' + JSON.stringify(topPlacing));
(topPlacing.rotate === false && topPlacing.pan && topPlacing.zoomOn && topPlacing.rightPan)
  ? pass('只放开平移 + 缩放（右键拖 / 滚轮），旋转仍关死 —— 俯视图不会歪')
  : fail('顶视放开的手势不对：' + JSON.stringify(topPlacing));

// 真的拖一下：右键平移必须让 target 动起来（不是只把开关拨亮了）
await evaluate(`(function () {
  window.__t0 = { x: __hmzq.rig.controls.target.x, z: __hmzq.rig.controls.target.z };
})()`);
await send('Input.dispatchMouseEvent', { type: 'mousePressed', x: 500, y: 300, button: 'right', clickCount: 1, buttons: 2 });
await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: 560, y: 340, button: 'right', buttons: 2 });
await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: 620, y: 380, button: 'right', buttons: 2 });
await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: 620, y: 380, button: 'right', clickCount: 1, buttons: 0 });
await sleep(400);
const panned = JSON.parse(await evaluate(`JSON.stringify((function () {
  var c = __hmzq.rig.controls;
  return { moved: Math.abs(c.target.x - window.__t0.x) + Math.abs(c.target.z - window.__t0.z), x: c.target.x, z: c.target.z };
})())`));
console.log('    右键平移后 target 位移：' + panned.moved.toFixed(3));
panned.moved > 0.01
  ? pass('顶视摆球时右键拖动真的挪动了视角（位移 ' + panned.moved.toFixed(3) + 'm）')
  : fail('右键没挪动视角：' + JSON.stringify(panned));
await shot('duo-placing-top');

// 摆完球：顶视要收回锁死，并且视角复位（顶视平时没有别的手段把视角调回来）
await evaluate(`document.getElementById('place-ok').click()`);
await sleep(500);
const topAfter = JSON.parse(await evaluate(`JSON.stringify((function () {
  var c = __hmzq.rig.controls;
  return {
    enabled: !!c.enabled, rightPan: !!c.mouseButtons.RIGHT, placing: !!__hmzq.state.placingCue,
    tx: c.target.x, tz: c.target.z,
    zoom: __hmzq.stage.orthoCam ? __hmzq.stage.orthoCam.zoom : 1
  };
})())`));
console.log('    摆完球（顶视）：' + JSON.stringify(topAfter));
(!topAfter.placing && !topAfter.enabled && !topAfter.rightPan)
  ? pass('摆完球：顶视重新锁死控制器（桌面端回到"只有瞄准"的状态）')
  : fail('顶视没收回去：' + JSON.stringify(topAfter));
(Math.abs(topAfter.tx) < 1e-6 && Math.abs(topAfter.tz) < 1e-6 && Math.abs(topAfter.zoom - 1) < 1e-6)
  ? pass('摆完球：顶视视角复位到正上方 · 整台在屏内（不会留下一个调不回来的偏移视角）')
  : fail('顶视视角没复位：' + JSON.stringify(topAfter));
await evaluate(`__hmzq.rig.setMode('tracking')`);
await sleep(300);

// 「已进袋」在双人模式下要分成**两栏**：玩家1 / 玩家2 各记自己打进的球
await evaluate(`(function () {
  var d = __hmzq.duo;
  d.over = false; d.turn = 1; d.groups = { 1: 'low', 2: 'high' };
  d.pots = { 1: [1, 2], 2: [9] };
  __hmzq.state.potted = [1, 2, 9];
  __hmzq.duoUI.render(d.snapshot(__hmzq.state.potted));
  __hmzq.hud.update(__hmzq.state, false);
})()`);
await sleep(300);
const twoCol = JSON.parse(await evaluate(`JSON.stringify({
  solo: getComputedStyle(document.getElementById('potted-solo')).display,
  duo: getComputedStyle(document.getElementById('potted-duo')).display,
  n1: document.getElementById('potted-list-1').childElementCount,
  n2: document.getElementById('potted-list-2').childElementCount,
  t1: (document.getElementById('v-potted-1') || {}).textContent,
  t2: (document.getElementById('v-potted-2') || {}).textContent
})`));
console.log('    两栏已进袋：' + JSON.stringify(twoCol));
(twoCol.duo !== 'none' && twoCol.solo === 'none')
  ? pass('双人模式：已进袋换成两栏，单人那一栏收起（display ' + twoCol.solo + '）')
  : fail('两栏没切换：' + JSON.stringify(twoCol));
(twoCol.n1 === 2 && twoCol.n2 === 1)
  ? pass('两栏各自画出自己那几颗球（玩家1 ' + twoCol.n1 + ' 颗 / 玩家2 ' + twoCol.n2 + ' 颗）')
  : fail('两栏球数不对：' + JSON.stringify(twoCol));
(/小号/.test(twoCol.t1) && /大号/.test(twoCol.t2))
  ? pass('两栏标题带上各人的组别（' + twoCol.t1 + ' / ' + twoCol.t2 + '）')
  : fail('两栏标题没带组别：' + JSON.stringify(twoCol));
await shot('duo-potted-two-cols');

// 定组之后的半透明：不是自己的球要"淡下去"（"本地双人收尾"的那一半）
// ⚠️ 断言**材质属性**而不只是 b.ghost 标记：transparent 改了不置 needsUpdate 的话着色器不会
//    重编译，画面上还是实心的；depthWrite 不关的话半透明球会自遮挡糊成一团。
const ghostOf = async () => JSON.parse(await evaluate(`JSON.stringify((function () {
  var out = { low: [], high: [], eight: null, cue: null };
  __hmzq.balls.forEach(function (b) {
    var m = b.mesh && b.mesh.material;
    if (!m) return;
    var rec = { n: b.number, ghost: !!b.ghost, tr: !!m.transparent, op: +m.opacity.toFixed(3), dw: !!m.depthWrite };
    if (b.isCue) { out.cue = rec; return; }
    if (b.hidden) return;
    if (b.number === 8) out.eight = rec;
    else if (b.number < 8) out.low.push(rec);
    else out.high.push(rec);
  });
  return out;
})())`));
const solid = (r) => !!r && !r.ghost && !r.tr && r.op === 1 && r.dw;
const faint = (r) => !!r && r.ghost && r.tr && r.op < 1 && !r.dw;

const g1 = await ghostOf();
console.log('    玩家1（小号）回合：' + JSON.stringify({
  low: g1.low.map((r) => r.n + (r.ghost ? '淡' : '实')).join(','),
  high: g1.high.map((r) => r.n + (r.ghost ? '淡' : '实')).join(','),
  eight: g1.eight && (g1.eight.ghost ? '淡' : '实'),
  cue: g1.cue && (g1.cue.ghost ? '淡' : '实'),
}));
(g1.low.length && g1.low.every(solid))
  ? pass('玩家1（小号）回合：自己这组的球是实色（opacity=1、depthWrite 开着）')
  : fail('自己的球不该半透明：' + JSON.stringify(g1.low));
(g1.high.length && g1.high.every(faint))
  ? pass('对手（大号）那组全半透明（transparent + opacity ' + (g1.high[0] || {}).op + ' + depthWrite 关）')
  : fail('对手的球没半透明：' + JSON.stringify(g1.high));
faint(g1.eight)
  ? pass('自己那组还没清完时黑 8 也半透明（现在打它是犯规）') : fail('黑 8 没淡：' + JSON.stringify(g1.eight));
solid(g1.cue)
  ? pass('白球永远实色（双方共用，不属于任何一方）') : fail('白球被弄成半透明了：' + JSON.stringify(g1.cue));
// 再换俯视全景拍一张：材质属性对 ≠ 画面真的变淡（transparent 忘记 needsUpdate 时
// 属性就是对的但看上去一点没变），所以留一张俯视图给人看。
await evaluate(`__hmzq.rig.setMode('top');`);
await sleep(700);
await shot('duo-ghost-top');
await evaluate(`__hmzq.rig.setMode('tracking');`);
await sleep(400);

// 换到玩家2：淡的那一边要跟着翻过来
await evaluate(`__hmzq.duo.turn = 2;`);
await sleep(400);
const g2 = await ghostOf();
(g2.low.length && g2.low.every(faint) && g2.high.every(solid))
  ? pass('换到玩家2：半透明跟着翻到大号那一组（每帧刷新，不用重开）')
  : fail('换人后半透明没翻：' + JSON.stringify({ low: g2.low, high: g2.high }));

// 自己那组清完 → 黑 8 变实色（该打了）
await evaluate(`__hmzq.state.potted = [9,10,11,12,13,14,15];`);
await sleep(400);
const g3 = await ghostOf();
solid(g3.eight)
  ? pass('自己那组清完后黑 8 变实色（轮到打它了）') : fail('清完后黑 8 还是淡的：' + JSON.stringify(g3.eight));
await evaluate(`__hmzq.duo.turn = 1; __hmzq.state.potted = [1,2,9];`);
await sleep(300);

// 提前打进黑八（罚球规则：罚一颗已进的球 + 黑八一起回初始位置，然后换人）
// ⚠️ 这条规则的**默认已经改成"直接判负"**了，所以这一段要显式切成 penalty 才测得到罚球。
await evaluate(`(function () {
  var d = __hmzq.duo;
  d.setRules({ earlyEight: 'penalty' });
  d.over = false; d.turn = 1; d.groups = { 1: 'low', 2: 'high' };
  __hmzq.state.potted = [1, 2, 9];      // 1、2 是玩家1（小号）已进的球
  d.beginShot();
  d.onPot(8);
  __hmzq.duoApply(d.resolveShot(__hmzq.state.potted));
})()`);
await sleep(300);
const penal = JSON.parse(await evaluate(`JSON.stringify({
  potted: __hmzq.state.potted,
  p8: !!__hmzq.balls.find(function (b) { return b.number === 8; }).potted,
  p2: !!__hmzq.balls.find(function (b) { return b.number === 2; }).potted,
  turn: __hmzq.duo.turn,
  over: __hmzq.duo.over
})`));
console.log('    提前进黑八后：' + JSON.stringify(penal));
(penal.turn === 2 && !penal.over && JSON.stringify(penal.potted) === '[1,9]')
  ? pass('提前打进黑八：罚一颗 + 黑八从进度里摘掉，换人继续（potted ' + JSON.stringify(penal.potted) + '）')
  : fail('罚球规则落地不对：' + JSON.stringify(penal));
(!penal.p8 && !penal.p2) ? pass('黑八与被罚的那颗球都重新回到台面') : fail('球没摆回台面：' + JSON.stringify(penal));
await shot('duo-early-eight-penalty');
await evaluate(`__hmzq.duo.reset(); __hmzq.state.potted = []; __hmzq.duoUI.render(__hmzq.duo.snapshot(__hmzq.state.potted));`);

// ---------- 13b. 本地双人（手机竖屏）：横幅 / 按键 / 蓄力条互不叠 ----------
console.log('\n[13b] 本地双人 · 手机竖屏排布');
await send('Page.removeScriptToEvaluateOnNewDocument', { identifier: redexInject });
await send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 2 });
await send('Emulation.setDeviceMetricsOverride', { width: 412, height: 915, deviceScaleFactor: 2, mobile: true });
await send('Page.navigate', { url: ORIGIN + '/index.html?mode=tracking&balls=15&lock=1&from=launcher&game=duo' });
await sleep(2500);
const mobDuo = JSON.parse(await evaluate(`JSON.stringify({
  mobile: document.documentElement.getAttribute('data-mobile'),
  banner: getComputedStyle(document.getElementById('turn-banner')).display,
  dock: getComputedStyle(document.getElementById('duo-dock')).display,
  solo: getComputedStyle(document.getElementById('btn-shoot')).display,
  infoTop: getComputedStyle(document.getElementById('panel-info')).top,
  btnW: Math.round(document.getElementById('btn-shoot-1').getBoundingClientRect().width),
  d1: document.getElementById('btn-shoot-1').classList.contains('disabled'),
  errs: window.__gameErrors || []
})`));
console.log('    手机：' + JSON.stringify(mobDuo));
(mobDuo.mobile === '1' && mobDuo.banner !== 'none' && mobDuo.dock !== 'none' && mobDuo.solo === 'none')
  ? pass('手机竖屏：双人横幅与两个开球键都显示，单人的那颗收起')
  : fail('手机上的双人界面不对：' + JSON.stringify(mobDuo));
mobDuo.infoTop === '66px'
  ? pass('手机竖屏：HUD 面板让到横幅下面（top=66px）') : fail('手机上 HUD 没让位：' + mobDuo.infoTop);
mobDuo.btnW >= 70 ? pass('手机上的开球键放大到 ' + mobDuo.btnW + 'px（手指点得准）') : fail('手机按键太小：' + mobDuo.btnW);
!mobDuo.d1 ? pass('手机竖屏开局：玩家1 的键可按下') : fail('玩家1 的键被置灰了');
await shot('duo-mobile-p1');

// 按住玩家1 的键蓄力：底部大蓄力条要出现在两个键**上方**，不许叠在一起。
// ------------------------------------------------------------------
// ⚠️ 这一步用**鼠标事件**而不是触摸注入，原因是 CDP 的限制（实测过一上午）：
//    同一个浏览器会话里一旦发过一次**双指** touchEnd（[12] 段末尾那两个手指），
//    后面的 Input.dispatchTouchEvent({type:'touchStart'}) 就再也不生效了 ——
//    连 pointerdown 都不派发（elementFromPoint 明明命中按键、换 touch id、
//    touchCancel、重开触摸模拟都救不回来；鼠标事件照常）。
//    按钮响应的是 pointerdown，鼠标与手指走同一条链路，所以这里的"能不能按住蓄力"
//    照样被验到；真正的触摸手势路径由 [12] 段覆盖（那里是导航后第一次用触摸，没受影响）。
const mdown = (x, y) => send('Input.dispatchMouseEvent', {
  type: 'mousePressed', x, y, button: 'left', clickCount: 1, buttons: 1,
});
const mup = (x, y) => send('Input.dispatchMouseEvent', {
  type: 'mouseReleased', x, y, button: 'left', clickCount: 1, buttons: 0,
});
const mb = JSON.parse(await evaluate(`JSON.stringify((function(){
  var r = document.getElementById('btn-shoot-1').getBoundingClientRect();
  return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) };
})())`));
await mdown(mb.x, mb.y);
await sleep(300);
const mobCharge = JSON.parse(await evaluate(`JSON.stringify({
  charging: !!__hmzq.state.charging,
  barShown: getComputedStyle(document.getElementById('charge-mobile')).display,
  barBottom: Math.round(document.getElementById('charge-mobile').getBoundingClientRect().bottom),
  b1Top: Math.round(document.getElementById('btn-shoot-1').getBoundingClientRect().top),
  b2Top: Math.round(document.getElementById('btn-shoot-2').getBoundingClientRect().top)
})`));
console.log('    蓄力中：' + JSON.stringify(mobCharge));
(mobCharge.charging && mobCharge.barShown !== 'none')
  ? pass('手机上按住开球键能蓄力，底部大蓄力条跟着出现') : fail('手机蓄力没起来：' + JSON.stringify(mobCharge));
(mobCharge.barBottom <= mobCharge.b1Top - 4 && mobCharge.barBottom <= mobCharge.b2Top - 4)
  ? pass('蓄力条在两个开球键上方（相差 ' + (mobCharge.b1Top - mobCharge.barBottom) + 'px，不叠）')
  : fail('蓄力条压住开球键了：' + JSON.stringify(mobCharge));
await shot('duo-mobile-charging');
await mup(mb.x, mb.y);
await sleep(400);

// ---------- 14. 规则设置：只剩中式黑八，斯诺克 / 俄式是禁用占位 ----------
console.log('\n[14] 规则设置 · 玩法规则');
await send('Emulation.clearDeviceMetricsOverride');
await send('Emulation.setTouchEmulationEnabled', { enabled: false });
const dex14 = (await send('Page.addScriptToEvaluateOnNewDocument', { source: desktopSource })).identifier;
await send('Page.navigate', { url: ORIGIN + '/launcher.html' });
await sleep(900);
await evaluate(`(function () {
  var r = document.querySelector('[data-go="settings/rules"]');
  if (r) r.click();
})()`);
await sleep(600);
// 0.7.0（G4）：规则设置拆成三级 —— hub 两张卡 → 单人 / 双人各自一个子页
const ruleHub = JSON.parse(await evaluate(`JSON.stringify({
  solo: !!document.querySelector('[data-go="settings/rules/solo"]'),
  duo: !!document.querySelector('[data-go="settings/rules/duo"]'),
  ballsHere: !!document.querySelector('section[data-page="settings/rules"] #p-balls')
})`));
(ruleHub.solo && ruleHub.duo)
  ? pass('规则设置拆成「单人模式规则」与「双人对战规则」两张卡') : fail('规则设置 hub 卡片不对：' + JSON.stringify(ruleHub));
ruleHub.ballsHere ? fail('球体设置还留在规则设置 hub 页（应搬到单人子页）') : pass('hub 页不再直接放球体设置');
await evaluate(`document.querySelector('[data-go="settings/rules/solo"]').click()`);
await sleep(600);
const rules = JSON.parse(await evaluate(`JSON.stringify((function () {
  var box = document.getElementById('p-balls');
  return {
    label: (document.querySelector('section[data-page="settings/rules/solo"] .field .fl label') || {}).textContent,
    btns: Array.prototype.map.call(box.children, function (b) {
      return { t: b.textContent, id: b.dataset.balls, off: !!b.disabled, on: b.classList.contains('on') };
    }),
    hint: (document.getElementById('p-balls-hint') || {}).textContent
  };
})())`));
rules.label === '玩法规则' ? pass('这一栏的标题改成「玩法规则」') : fail('标题没改：' + rules.label);
console.log('    玩法规则：' + JSON.stringify(rules));
const names = rules.btns.map((b) => b.t);
(names.indexOf('中式黑八') >= 0) ? pass('15 球那一档改名为「中式黑八」') : fail('没找到中式黑八：' + names.join('/'));
!names.some((t) => /9 球|3 球/.test(t))
  ? pass('9 球与 3 球已经移除（可选项里只剩 ' + names.filter((t) => !/敬请期待/.test(t)).join('/') + '）')
  : fail('9 球 / 3 球没移除：' + names.join('/'));
const soon = rules.btns.filter((b) => b.off);
(soon.length === 2 && soon[0].t.indexOf('斯诺克') >= 0 && soon[1].t.indexOf('俄式') >= 0)
  ? pass('斯诺克规则 / 俄式规则是禁用按钮（未来开发）', soon.map((b) => b.t).join(' / '))
  : fail('两个"未来开发"的占位不对：' + JSON.stringify(soon));
(rules.btns.filter((b) => b.on).length === 1 && rules.btns.filter((b) => b.on)[0].id === '15')
  ? pass('当前选中的是中式黑八（只有它亮着）') : fail('选中项不对：' + JSON.stringify(rules.btns));
await shot('rules-settings');

// 点禁用的那个：不应该改掉当前选择
await evaluate(`(function () {
  var b = document.querySelector('#p-balls button[data-balls="snooker"]');
  if (b) b.click();
})()`);
await sleep(300);
const afterSoon = JSON.parse(await evaluate(`JSON.stringify({
  on: Array.prototype.filter.call(document.getElementById('p-balls').children, function (b) { return b.classList.contains('on'); }).map(function (b) { return b.dataset.balls; })
})`));
afterSoon.on.join() === '15' ? pass('点「斯诺克」不生效，选择仍留在中式黑八') : fail('禁用的按钮被选中了：' + JSON.stringify(afterSoon));

// 双人对战规则（三级页，G4）：四项分组 / 判罚 + 三项犯规罚则（默认全关）
await evaluate(`(function () {
  var b = document.querySelector('[data-page="settings/rules/solo"] [data-up]');
  if (b) b.click();
})()`);
await sleep(500);
await evaluate(`(function () {
  var c = document.querySelector('[data-go="settings/rules/duo"]');
  if (c) c.click();
})()`);
await sleep(600);
const duoRules = JSON.parse(await evaluate(`JSON.stringify((function () {
  var out = { duoKeys: [], foulKeys: [], foulVals: [] };
  var segs = document.querySelectorAll('#p-duo-rules .segs[data-rule]');
  for (var i = 0; i < segs.length; i++) out.duoKeys.push(segs[i].dataset.rule);
  var f = document.querySelectorAll('#p-foul-rules .segs[data-rule]');
  for (var j = 0; j < f.length; j++) {
    var btns = f[j].querySelectorAll('button[data-rule-val]');
    var on = [];
    for (var k = 0; k < btns.length; k++) if (btns[k].classList.contains('on')) on.push(btns[k].dataset.ruleVal);
    out.foulKeys.push(f[j].dataset.rule);
    out.foulVals.push({ key: f[j].dataset.rule, on: on.join(',') });
  }
  return out;
})())`));
console.log('    双人规则：' + JSON.stringify(duoRules));
duoRules.duoKeys.join() === 'breakAssign,breakEight,cueFoul,earlyEight'
  ? pass('四项分组 / 判罚在「双人对战规则」页的 #p-duo-rules') : fail('分组判罚项不对：' + JSON.stringify(duoRules.duoKeys));
duoRules.foulKeys.join() === 'foulWrongBall,foulMiss,foulNoPot'
  ? pass('三项犯规罚则（打错球组 / 空杆 / 没进袋）在 #p-foul-rules') : fail('犯规罚则项不对：' + JSON.stringify(duoRules.foulKeys));
duoRules.foulVals.every(function (x) { return x.on === 'none'; })
  ? pass('犯规罚则默认全部「不罚球」（与 0.6.x 行为一致）') : fail('犯规罚则默认值不对：' + JSON.stringify(duoRules.foulVals));
await shot('rules-duo');
await send('Page.removeScriptToEvaluateOnNewDocument', { identifier: dex14 });

// ---------- 15. 🤖 人机对战：电脑自己思考 → 转杆 → 出杆 ----------
// 电脑的**准度**在无头套件里验（test/suites/ai.mjs 三档各跑几百杆，命中率必须落在档位区间）；
// 这一段只验**接线**：进得去、轮到电脑时它真的自己打、打之前有转杆动画、打的是合法球。
console.log('\n[15] 🤖 人机对战 · 电脑自动出杆');
const dex15 = (await send('Page.addScriptToEvaluateOnNewDocument', { source: desktopSource })).identifier;

// 先走**真实入口**：启动器 → 常规模式 →「人机对战」卡片 → 难度页 → 点「困难」。
// 直接跳 ?game=ai 也能进，但那样验不到"卡片与难度按钮接没接上"
// （卡片一直是 data-soon 的占位，很容易忘了把占位换成真入口）。
await send('Page.navigate', { url: ORIGIN + '/launcher.html' });
await sleep(1000);
const aiCard = JSON.parse(await evaluate(`JSON.stringify((function () {
  var c = document.querySelector('[data-go="start/ai"]');
  if (!c) return { found: false };
  return {
    found: true, soon: c.classList.contains('soon'), live: c.classList.contains('live'),
    tag: (c.querySelector('.tag') || {}).textContent || ''
  };
})())`));
console.log('    人机卡片：' + JSON.stringify(aiCard));
(aiCard.found && aiCard.live && !aiCard.soon)
  ? pass('启动器上「人机对战」卡片已变成可进入（不再是"后续开发"占位）')
  : fail('人机卡片还是占位：' + JSON.stringify(aiCard));
await evaluate(`document.querySelector('[data-go="start/ai"]').click()`);
await sleep(500);
const aiPage = JSON.parse(await evaluate(`JSON.stringify({
  on: (document.querySelector('[data-page="start/ai"]') || {}).className,
  btns: Array.prototype.map.call(document.querySelectorAll('[data-page="start/ai"] [data-enter-game]'), function (b) {
    return { g: b.dataset.enterGame, d: b.dataset.diff, t: (b.querySelector('b') || {}).textContent };
  })
})`));
console.log('    难度页：' + JSON.stringify(aiPage));
(aiPage.btns.length === 4 && aiPage.btns.every((b) => b.g === 'ai') &&
  aiPage.btns.map((b) => b.d).join() === 'easy,normal,hard,extreme')
  ? pass('四个难度按钮都是真入口（easy / normal / hard / extreme，不再是"敬请期待"）')
  : fail('难度按钮没接上：' + JSON.stringify(aiPage.btns));
await evaluate(`document.querySelector('[data-page="start/ai"] [data-diff="hard"]').click()`);
await sleep(2600);
const aiUrl = await evaluate('location.search');
(/game=ai/.test(aiUrl) && /diff=hard/.test(aiUrl))
  ? pass('点「困难」真的带着 ?game=ai&diff=hard 进了球台（' + aiUrl + '）')
  : fail('没跳对：' + aiUrl);

// 等球真的摆好（物理世界起来之后才有 balls）
for (let i = 0; i < 40; i++) {
  await sleep(400);
  if (await evaluate(`!!(window.__hmzq && __hmzq.balls && __hmzq.balls.length === 16)`)) break;
}

const xyOf = async (id) => JSON.parse(await evaluate(`JSON.stringify((function(){
  var r = document.getElementById('${id}').getBoundingClientRect();
  return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) };
})())`));
const waitStill = async (maxMs = 30000) => {
  const t0 = Date.now();
  while (Date.now() - t0 < maxMs) {
    await sleep(400);
    if (!(await evaluate('!!__hmzq.state.shooting'))) return true;
  }
  return false;
};

const aiDom0 = JSON.parse(await evaluate(`JSON.stringify({
  level: __hmzq.aiPeek().level,
  mode: (document.getElementById('v-mode') || {}).textContent,
  banner: getComputedStyle(document.getElementById('turn-banner')).display,
  who: document.getElementById('turn-who').textContent,
  name2: document.getElementById('duo-name-2').textContent,
  btn2: (document.getElementById('btn-shoot-2').querySelector('b') || {}).textContent,
  off2: document.getElementById('btn-shoot-2').classList.contains('disabled'),
  off1: document.getElementById('btn-shoot-1').classList.contains('disabled'),
  duo: !!(window.__hmzq && __hmzq.duo),
  turn: __hmzq.duo && __hmzq.duo.turn,
  tip: getComputedStyle(document.getElementById('auto-tip')).display,
  errs: window.__gameErrors || []
})`));
console.log('    开局：' + JSON.stringify(aiDom0));
(aiDom0.level === 'hard' && aiDom0.duo)
  ? pass('带 ?game=ai&diff=hard 进得去，电脑是困难档（走的是双人那套规则引擎）')
  : fail('人机模式没起来：' + JSON.stringify(aiDom0));
(/困难/.test(aiDom0.mode || '')) ? pass('HUD 面板标题写了「困难」') : fail('面板标题没写难度：' + aiDom0.mode);
(aiDom0.banner !== 'none' && aiDom0.turn === 1)
  ? pass('开局是人类（玩家1）先开球，回合横幅在') : fail('开局回合不对：' + JSON.stringify(aiDom0));
(aiDom0.name2 === '电脑' && /电脑/.test(aiDom0.btn2 || ''))
  ? pass('玩家2 那一栏与开球键都写成「电脑」（不是一个不存在的第二个人）')
  : fail('电脑的称呼没改：' + JSON.stringify(aiDom0));
(aiDom0.off2 && !aiDom0.off1)
  ? pass('电脑那颗键永远置灰、人类的键可按（轮不到人类按的那颗它自己会打）')
  : fail('按键归属不对：' + JSON.stringify(aiDom0));
aiDom0.tip === 'none' ? pass('提示条平时收着（不会一直挂在屏幕上）') : fail('提示条没收：' + aiDom0.tip);
await shot('ai-idle');

// 先手动开一杆（真的按住开球键炸球堆）—— 开球永远是人类的事。
// 蓄力按住 900ms（约 45% 力度）：只按 260ms 的话球堆根本炸不开，
// 电脑接手时所有球都挤在一堆，它只能"碰一下"，验不到真正的瞄准。
const shootXY = await xyOf('btn-shoot-1');
await ptr('mousePressed', shootXY.x, shootXY.y);
await sleep(900);
await ptr('mouseReleased', shootXY.x, shootXY.y);
await waitStill();
const afterBreak = JSON.parse(await evaluate(`JSON.stringify({
  shots: __hmzq.state.shots, errs: window.__gameErrors || []
})`));
console.log('    开球后：' + JSON.stringify(afterBreak));
(afterBreak.shots === 1) ? pass('人类开球这一杆打出去了') : fail('开球没打出去：' + JSON.stringify(afterBreak));
!afterBreak.errs.length ? pass('无运行期错误') : fail('有运行期错误：' + afterBreak.errs.join(' | '));

/**
 * 让电脑连打若干杆，收集每一杆的"它打算干什么"。
 * ------------------------------------------------------------------
 * 为什么是好几杆：开球之后白球常常就压在没散开的球堆上，这时候通往任何一颗球的
 * 幽灵球都被邻球挡着，电脑只能走兜底（"碰一下"）—— 那是**正确行为**，不是 bug。
 * 等它自己把球型撞开一两杆之后，才轮得到真正的瞄准方案（"电脑瞄准 N 号 → 袋名"）。
 * 只测一杆的话，验到的永远是兜底那一路。
 */
const aiShots = [];
for (let k = 0; k < 4; k++) {
  // ① 先等一个"电脑真的可以开打"的窗口：轮到它、球已停、没在摆球。
  //    ⚠️ 不能"睡 600ms 然后强设 turn=2 就开测"：电脑进了自己的球会**连续续杆**，
  //    上一轮刚打完的那一杆可能已经把 shots 推前了，再用 before.shots 判"这一杆打没打"
  //    就会错位（0.7.0 袋口放大后电脑更容易续杆，这个错位被放大成了必现）。
  for (let i = 0; i < 120; i++) {
    const st = JSON.parse(await evaluate(`JSON.stringify({
      turn: __hmzq.duo.turn,
      shooting: !!__hmzq.state.shooting,
      placing: !!__hmzq.state.placingCue,
      over: !!__hmzq.duo.over || !!__hmzq.state.matchOver
    })`));
    if (st.over) break;
    if (st.shooting || st.placing) { await sleep(120); continue; }
    if (st.turn !== 2) { await evaluate(`__hmzq.duo.turn = 2`); await sleep(120); continue; }
    break;
  }
  const before = JSON.parse(await evaluate(`JSON.stringify({ shots: __hmzq.state.shots })`));
  // ⚠️ 结算随时可能把回合换回玩家1（电脑空杆就换人），所以每一轮都要**重新夺回** turn=2，
  //    不能只在开头设一次 —— 那是这一段的第一个假阴性来源。
  // 每 60ms 采一次：转杆动画必须**看得见**（aimAngle 一帧帧变过去，不是瞬间跳到位）。
  const track = [];
  let tipMax = { txt: '', shown: 'none', w: 0, h: 0 };
  // ⚠️ 采样窗口别按"以前够用"定死：无头 Chrome 是 SwiftShader 软渲染，帧率**直接跟模型面数挂钩**。
  //    0.8.0 换真实模型后（38k 面）电脑从"转杆动画跑完"到"真的出杆"要十几秒，
  //    90 次 × 60 ms ≈ 5.4 s 的窗口会让它在 aim 阶段就超时 —— 看起来像"电脑有杆没打出去"，
  //    其实只是慢。窗口给到 220 次（≈13 s）。真 bug 照样会红，只是不再被性能误判。
  for (let i = 0; i < 220; i++) {
    const s = JSON.parse(await evaluate(`JSON.stringify({
      turn: __hmzq.duo.turn,
      a: +(__hmzq.state.aimAngle || 0).toFixed(4),
      p: __hmzq.aiPeek().phase,
      n: __hmzq.aiPeek().number,
      // 相机相对白球的方位角：追踪模式下镜头应该始终待在**杆的正后方**（= aimAngle + π）。
      // 电脑没有手去转相机，不特殊处理的话它转杆时镜头纹丝不动 —— 只有球杆在转，看不出在瞄哪颗。
      c: (function () {
        var c = __hmzq.rig.camera.position, b = __hmzq.cue.body.translation();
        return +Math.atan2(c.x - b.x, c.z - b.z).toFixed(4);
      })(),
      shots: __hmzq.state.shots,
      shooting: !!__hmzq.state.shooting,
      cueIn: !!__hmzq.cue.potted,
      placing: !!__hmzq.state.placingCue,
      // 这一杆当下的合法目标球（分组会随局面变，所以必须**当场**记，不能最后算一次）
      allow: (function () {
        var d = __hmzq.duo, done = __hmzq.state.potted, g = d.groups[2];
        var all = [1,2,3,4,5,6,7,9,10,11,12,13,14,15];
        var a = g ? (g === 'low' ? [1,2,3,4,5,6,7] : [9,10,11,12,13,14,15])
                  .filter(function (n) { return done.indexOf(n) < 0; })
                  : all.filter(function (n) { return done.indexOf(n) < 0; });
        return (g && !a.length) ? [8] : a;
      })(),
      tip: (function () {
        var el = document.getElementById('auto-tip');
        var r = el.getBoundingClientRect();
        return {
          txt: el.textContent, shown: getComputedStyle(el).display,
          w: Math.round(r.width), h: Math.round(r.height)
        };
      })()
    })`));
    track.push(s);
    // 提示条只亮 2.4 秒 —— 事后读经常已经收掉了，读到的 0×0 是"已经隐藏"，不是"竖排"。
    // 所以取采样期间见过的**最大**那一帧（横排 254×38，竖排约 43×147，比例完全不同）。
    if (s.tip.shown !== 'none' && s.tip.w * s.tip.h > tipMax.w * tipMax.h) tipMax = s.tip;
    if (s.shots > before.shots) break;
    // 只在"球已停"时夺回合：球还在滚的时候改 turn 等于插队，会打乱这一杆的结算
    if (!s.shooting && s.turn !== 2) await evaluate(`__hmzq.duo.turn = 2`);
    await sleep(60);
  }
  await sleep(250);
  // ⚠️ 提示条光看 textContent / display 不够：双人 / 人机模式下两颗开球键在 #duo-dock 里，
  //    #shoot-dock 宽高塌成 0 → 绝对定位的提示条会被算成 **0 宽**，文字每个字一行竖着排，
  //    而 textContent 与 display 全对、断言照样绿（只有截图能看出来）。所以连尺寸一起量。
  const tipAfter = JSON.parse(await evaluate(`JSON.stringify((function () {
    var el = document.getElementById('auto-tip');
    var r = el.getBoundingClientRect();
    return {
      txt: el.textContent,
      shown: getComputedStyle(el).display,
      w: Math.round(r.width), h: Math.round(r.height)
    };
  })())`));
  const tip = (tipAfter.shown !== 'none' && tipAfter.w * tipAfter.h > tipMax.w * tipMax.h)
    ? tipAfter : tipMax;
  const last = track[track.length - 1];
  aiShots.push({
    fired: last.shots - before.shots,
    phases: [...new Set(track.map((t) => t.p))],
    // 只数"转杆阶段"里出现过的不同角度：一帧帧转过去才有 3 个以上中间值。
    // 把 idle / think 的采样也混进来会让计数假性变大（那时角度还没开始变）。
    angles: [...new Set(track.filter((t) => t.p === 'aim').map((t) => t.a))].length,
    // 目标球必须在**它选球那一刻**是合法的：采样里第一次出现这个球号时的合法集合
    picks: track.filter((t) => t.n != null).map((t) => ({ n: t.n, ok: t.allow.includes(t.n) })),
    tip: tip.txt,
    tipShown: tip.shown,
    tipW: tip.w,
    tipH: tip.h,
    // 转杆期间的相机：跟了几个不同的角度，以及"离杆的正后方"差多少（弧度）
    // 只取**后半段**采样：转杆刚起步时镜头可能还在从上一杆的全场机位往回赶，
    // 那 0.15 秒的追赶误差不算 bug；要断的是"镜头有没有追上"。
    camMoves: [...new Set(track.filter((t) => t.p === 'aim').map((t) => t.c))].length,
    camOff: (function () {
      var a = track.filter(function (t) { return t.p === 'aim'; });
      var late = a.slice(Math.floor(a.length / 2));
      if (!late.length) return 9;
      return Math.max.apply(null, late.map(function (t) {
        return Math.abs(Math.atan2(Math.sin(t.c - t.a - Math.PI), Math.cos(t.c - t.a - Math.PI)));
      }));
    })(),
    why: last,
  });
  if (k === 0) await shot('ai-fired');
}
console.log('    电脑连打 4 杆：' + JSON.stringify(aiShots.map((s) => ({
  fired: s.fired, p: s.phases.join('>'), a: s.angles, tip: s.tip,
}))));
const missed = aiShots.filter((s) => s.fired !== 1);
!missed.length
  ? pass('轮到电脑，它自己打出了 4 杆（不用人按）')
  : fail('电脑有杆没打出去：' + JSON.stringify(missed.map((s) => s.why)));
// ⚠️ 只硬性要求"每杆都有转杆（aim）"。思考（think）不做逐杆要求：
//    等球停 + 等结算的这段时间里，电脑那一杆的 think 可能已经跑完了，采样起点落在 aim 上很正常，
//    那是**采样时序**不是 bug；逐杆断言 think 会让这一段随机红。
const noAim = aiShots.filter((s) => !s.phases.includes('aim'));
!noAim.length
  ? pass('每一杆都经过转杆阶段（aim）')
  : fail('有杆没进转杆阶段：' + JSON.stringify(noAim.map((s) => s.phases)));
// 但思考环节必须真实存在：4 杆里至少有一杆被完整采到"思考 → 转杆"
const full = aiShots.filter((s) => s.phases.join('>').includes('think>aim'));
full.length
  ? pass('至少一杆完整走完"思考 → 转杆"（' + full.length + '/4）')
  : fail('没有一杆被采到 think→aim：' + JSON.stringify(aiShots.map((s) => s.phases)));
// 转杆动画：aimAngle 至少经过 3 个不同的值（一帧帧转过去），而不是直接跳到目标角
aiShots.every((s) => s.angles >= 3)
  ? pass('每一杆出杆前都有转杆动画（中间值 ' + aiShots.map((s) => s.angles).join('/') + '）')
  : fail('aimAngle 是瞬间跳过去的，没有转杆动画：' + JSON.stringify(aiShots.map((s) => s.angles)));
const noTip = aiShots.filter((s) => !(s.tipShown !== 'none' && /^电脑/.test(s.tip)));
!noTip.length
  ? pass('每一杆都把"打哪颗球"写在提示条上')
  : fail('提示条没出来 / 文案不对：' + JSON.stringify(noTip.map((s) => s.tip)));
// 提示条必须**横着排开**：正常一行约 120×38px（宽高比 ≈3）；被挤成竖排会变成约 40×170px（比 ≈0.25）。
// 判宽高比而不是判死字数：文案长短会变，比例不会。
const tipFlat = (s) => s.tipW >= 100 && s.tipW >= 2.2 * s.tipH;
const flatTip = aiShots.filter(tipFlat);
flatTip.length === aiShots.length
  ? pass('提示条横着排开、没被挤成竖排（' +
      aiShots.map((s) => s.tipW + '×' + s.tipH).join(' ') + '）')
  : fail('提示条被挤成竖排了：' + JSON.stringify(aiShots.filter((s) => !tipFlat(s))
      .map((s) => ({ w: s.tipW, h: s.tipH, txt: s.tip }))));
// 追踪模式：电脑转杆时**镜头必须跟着转**（相机始终在杆的正后方 = aimAngle + π）。
// 不跟的话，玩家只能看见球杆在转、画面不动，根本不知道电脑在瞄哪颗球。
const camBad = aiShots.filter((s) => !(s.camMoves >= 2 && s.camOff < 0.3));
!camBad.length
  ? pass('电脑转杆时镜头跟着一起转（转杆期间相机一直待在杆的正后方，偏差 ' +
      aiShots.map((s) => s.camOff.toFixed(3)).join('/') + ' rad）')
  : fail('镜头没跟着电脑转：' + JSON.stringify(camBad.map((s) => ({ moves: s.camMoves, off: s.camOff }))));
// 至少有一杆是真正的瞄准方案（写明"哪颗球 → 哪个袋 → 多大力度"），
// 说明它算得出幽灵球与力度 —— 不是永远只会"碰一下"。
const aimed = aiShots.filter((s) => /^电脑瞄准：\d+ 号 → .+（力度 \d+%）$/.test(s.tip));
aimed.length >= 1
  ? pass('至少有一杆是真的瞄准（' + aimed.length + '/4 杆写明球号、袋名与力度：' +
      (aimed[0] ? aimed[0].tip : '') + '）')
  : fail('4 杆没一杆在瞄准：' + JSON.stringify(aiShots.map((s) => s.tip)));
// 电脑只能打自己该打的球（未分组 = 除了黑八；已分组 = 自己那组剩下的；清完了才打黑八）。
// ⚠️ 用**选球那一刻**的合法集合判定：分组是随局面变的，拿最后的状态去校验前面几杆会误判。
const allPicks = aiShots.flatMap((s) => s.picks);
const badPicks = allPicks.filter((p) => !p.ok);
(allPicks.length > 0 && !badPicks.length)
  ? pass('电脑挑的每一颗都是当时该打的球（' + [...new Set(allPicks.map((p) => p.n))].join(',') + ' 号）')
  : fail('电脑挑了不该打的球：' + JSON.stringify(badPicks));

// 打完等球停稳：状态机要跟着回合走。
// ⚠️ 不能一律断言"必须回到 idle" —— 电脑这一杆进球了就会**续杆**，那时候它正在
//    think 才是对的（不然它打进一颗就罢工，剩下全得人类替它打）。
//    真正要防的是"轮到人类了电脑还在转杆"（那会把人类的杆抢走）。
await waitStill();
await sleep(400);
const aiRest = JSON.parse(await evaluate(`JSON.stringify({
  phase: __hmzq.aiPeek().phase, shooting: !!__hmzq.state.shooting,
  turn: __hmzq.duo.turn, over: !!__hmzq.duo.over,
  errs: window.__gameErrors || []
})`));
console.log('    收尾：' + JSON.stringify(aiRest));
const restOk = aiRest.over ? true
  : (aiRest.turn === 2 ? /think|aim/.test(aiRest.phase) : aiRest.phase === 'idle');
(!aiRest.shooting && restOk)
  ? pass(aiRest.turn === 2
    ? '电脑进球续杆 → 它继续思考下一杆（没罢工）'
    : '轮到人类了，电脑回到待命（不会抢人类的杆）')
  : fail('电脑状态机没收干净：' + JSON.stringify(aiRest));
!aiRest.errs.length ? pass('整段无运行期错误') : fail('有运行期错误：' + aiRest.errs.join(' | '));
await shot('ai-after');

// ---- 电脑的称呼：横幅上不该再出现"玩家2"，轮到它时也不能对着屏幕说"你" ----
// 直接重画一次横幅（render 是显示层的幂等函数，不碰任何规则状态）。
// 不这么做的话，这一段只能等"恰好轮到电脑"的瞬间才能验，靠运气。
await evaluate(`__hmzq.duo.turn = 2;
                __hmzq.duo.lastNote = '玩家2只进了对方的球，换人';
                __hmzq.duoUI.render(__hmzq.duo.snapshot(__hmzq.state.potted));`);
const aiBanner = JSON.parse(await evaluate(`JSON.stringify({
  who: document.getElementById('turn-who').textContent,
  go: document.getElementById('turn-go').textContent,
  note: document.getElementById('turn-note').textContent,
  all: document.getElementById('turn-banner').textContent,
  n1: document.getElementById('duo-name-1').textContent,
  n2: document.getElementById('duo-name-2').textContent
})`));
console.log('    电脑回合的横幅：' + JSON.stringify(aiBanner));
(aiBanner.who === '电脑' && aiBanner.n2 === '电脑' && aiBanner.n1 === '玩家1')
  ? pass('电脑回合：左边那栏写「电脑」，玩家1 那栏照旧')
  : fail('电脑回合的称呼不对：' + JSON.stringify(aiBanner));
(aiBanner.go === '电脑正在瞄准' && !/玩家2/.test(aiBanner.all))
  ? pass('电脑回合：中间写「电脑正在瞄准」（不是对着屏幕说"轮到你击球"），整条横幅没有"玩家2"')
  : fail('电脑回合还在说"你" / 还在写"玩家2"：' + JSON.stringify(aiBanner));
(aiBanner.note === '电脑只进了对方的球，换人')
  ? pass('上一杆的说明也把"玩家2"换成了「电脑」')
  : fail('说明文案里的称呼没换：' + aiBanner.note);
// ---- 面板收起 / 展开（左上角信息栏、右侧已进袋）----
// 只切一个 class，具体折成什么样由 CSS 负责 —— 所以这里断的是**看得见的结果**：
// 信息栏折掉后只剩标题行；进袋栏折掉后只留最后一颗，一颗没进时顶一个透明占位格。
const fold = JSON.parse(await evaluate(`JSON.stringify((function () {
  var info = document.getElementById('panel-info');
  var h0 = Math.round(info.getBoundingClientRect().height);
  var btn = document.getElementById('info-toggle');
  btn.click();
  var rows = [].slice.call(info.querySelectorAll('.row, .bar'));
  var folded = {
    h: Math.round(info.getBoundingClientRect().height),
    hidden: rows.every(function (r) { return getComputedStyle(r).display === 'none'; }),
    label: btn.textContent
  };
  btn.click();
  var back = { h: Math.round(info.getBoundingClientRect().height), label: btn.textContent };
  return { h0: h0, folded: folded, back: back };
})())`));
console.log('    信息栏折叠：' + JSON.stringify(fold));
(fold.folded.hidden && fold.folded.h < fold.h0 * 0.7 && fold.folded.label === '展开')
  ? pass('信息栏收起后只剩标题行（' + fold.h0 + 'px → ' + fold.folded.h + 'px，按钮变「展开」）')
  : fail('信息栏没收起来：' + JSON.stringify(fold));
(fold.back.label === '收起' && Math.abs(fold.back.h - fold.h0) <= 2)
  ? pass('再点一次原样展开回来')
  : fail('展开没恢复到原样：' + JSON.stringify(fold.back));
// 收起态留图：尺寸断言挡不住"按钮位置怪 / 标题挤成一团"，只有截图看得出来
await evaluate(`document.getElementById('info-toggle').click()`);
await shot('hud-info-folded');
await evaluate(`document.getElementById('info-toggle').click()`);   // 还原成展开

const pot = JSON.parse(await evaluate(`JSON.stringify((function () {
  var btn = document.getElementById('pot-toggle');
  btn.click();
  var box = document.getElementById('panel-pot');
  // 人机 / 双人模式下是两栏，各看各的：有球的那栏只留最后一颗，空的那栏顶占位格
  var side = [1, 2].map(function (i) {
    var list = document.getElementById('potted-list-' + i);
    var chips = [].slice.call(list.querySelectorAll('.chip'));
    var vis = chips.filter(function (c) { return getComputedStyle(c).display !== 'none'; });
    var ph = list.parentElement.querySelector('.chip-empty');
    var pr = ph.getBoundingClientRect();
    return {
      n: chips.length, vis: vis.length,
      phShown: getComputedStyle(ph).display !== 'none',
      phW: Math.round(pr.width), phH: Math.round(pr.height)
    };
  });
  var soloList = document.getElementById('potted-list');
  var soloChips = [].slice.call(soloList.querySelectorAll('.chip'));
  return { side: side, solo: soloChips.length, label: btn.textContent };
})())`));
console.log('    进袋栏折叠：' + JSON.stringify(pot));
const fullSides = pot.side.filter((s) => s.n >= 2);
const emptySides = pot.side.filter((s) => s.n === 0);
(pot.label === '展开' && fullSides.every((s) => s.vis === 1))
  ? pass('已进袋收起后每栏只留最后一颗进球（' + pot.side.map((s) => s.n + '→' + s.vis).join(' ') + '）')
  : fail('收起后不是"只留最后一颗"：' + JSON.stringify(pot.side));
(!emptySides.length || emptySides.every((s) => s.phShown && s.phW >= 18 && s.phH >= 18))
  ? pass('一格球都没进的那栏顶出透明占位格（' + (emptySides.length
      ? emptySides.map((s) => s.phW + '×' + s.phH).join(' ') : '本局两栏都进了球，无空格可验') + '）')
  : fail('空格没顶出占位格：' + JSON.stringify(emptySides));
await shot('hud-pot-folded');   // 收起态留图：占位格的位置与观感只有截图看得出来
await evaluate(`document.getElementById('pot-toggle').click()`);   // 还原成展开

// ---- 设置：击球时是否让「不是自己的球」半透明 ----
const ghost = JSON.parse(await evaluate(`JSON.stringify((function () {
  var btns = [].slice.call(document.querySelectorAll('#set-ghost [data-ghost]'));
  var opa = function () {
    return __hmzq.balls.filter(function (b) { return !b.isCue && !b.hidden; })
      .map(function (b) { return +b.mesh.material.opacity.toFixed(2); });
  };
  var out = { n: btns.length, ids: btns.map(function (b) { return b.getAttribute('data-ghost'); }) };
  out.before = { on: __hmzq.state.ghostOn, opa: opa() };
  btns.filter(function (b) { return b.getAttribute('data-ghost') === 'off'; })[0].click();
  out.off = { on: __hmzq.state.ghostOn, active: btns.map(function (b) { return b.classList.contains('active'); }) };
  return out;
})())`));
// refreshGhost 在主循环里每帧刷一次。⚠️ 别用"睡 200ms = 等两帧"：无头 Chrome 是软渲染，
// 帧间隔随模型面数走（0.8.0 真实模型 38k 面时 200ms 可能连一帧都没走完），
// 读到的还是上一帧的半透明值 —— 看起来像"设置没生效"。改成轮询到真的恢复。
let ghostOpa = [];
for (let i = 0; i < 25; i++) {
  await sleep(200);
  ghostOpa = JSON.parse(await evaluate(`JSON.stringify(
    __hmzq.balls.filter(function (b) { return !b.isCue && !b.hidden; })
      .map(function (b) { return +b.mesh.material.opacity.toFixed(2); }))`));
  if (ghostOpa.length && ghostOpa.every((o) => o === 1)) break;
}
console.log('    半透明开关：' + JSON.stringify(ghost) + ' → ' + JSON.stringify(ghostOpa));
(ghost.n === 2 && ghost.ids.join() === 'on,off')
  ? pass('设置里有「非己方球半透明」这一项（开 / 关两档）')
  : fail('设置里没找到半透明开关：' + JSON.stringify(ghost.ids));
(ghost.off.on === false && ghostOpa.every((o) => o === 1))
  ? pass('关掉之后所有球恢复实色（不是只写在设置里）')
  : fail('关掉之后球还是半透明的：' + JSON.stringify(ghostOpa));
await shot('settings-ghost-off');   // 关掉半透明后留图：确认球真的变实色了，不是只有数字对
// 还原成开：定组之后不是自己那组的球会重新淡下去（这里不强求当场就有淡的球，
// 只验证开关本身能来回切 —— 半透明的判据在 [14] 双人段已经验过）
await evaluate(`document.querySelector('#set-ghost [data-ghost="on"]').click()`);
const ghostBack = JSON.parse(await evaluate(`JSON.stringify({ on: __hmzq.state.ghostOn })`));
ghostBack.on === true ? pass('能再切回「开启」') : fail('切不回开启：' + JSON.stringify(ghostBack));

await send('Page.removeScriptToEvaluateOnNewDocument', { identifier: dex15 });

ws.close();
chrome.kill();
server.close();
await sleep(300);
console.log(bad ? `\n===== ${bad} 项不合格 =====` : '\n===== 全部通过 =====');
process.exit(bad ? 1 : 0);
