/**
 * 浏览器冒烟测试（真·端到端）
 * ------------------------------------------------------------------
 * 为什么需要它：`check:syntax` / `check:kernel` / `check:api` 都是**离线**校验
 * （读文件、模拟内核）。它们证明不了"页面在真浏览器里真的能跑起来"，
 * 也证明不了"打进 APK 之后不会弹那张内核卡"。
 *
 * 做法：起一个只读静态服务托管 dist/，用无头 Chrome 打开，检查三件事：
 *   1. **不弹「内核过旧」卡**（这是 2026-09-19 APK 装机实测的故障现象）
 *   2. 没有运行期错误（window.__gameErrors 为空）
 *   3. 游戏真的跑起来了（canvas 有 WebGL 上下文、HUD 帧率在跳）
 *
 * 关键：`--simulate-old-kernel` 会在页面脚本之前把 window.Function 换成一个
 * "不认识 ||= 的解析器" —— 精确复现 **Chrome 83 的 Android WebView**（红米 K30 Pro
 * 装机实测的内核）。本机拿不到老 Chromium 快照（chromiumdash 连不通），
 * 这是唯一能在 CI 里确定性复现老内核行为的手段。
 *
 * 用法:
 *   node test/browser-smoke.mjs                    # 正常内核
 *   node test/browser-smoke.mjs --simulate-old-kernel
 *   node test/browser-smoke.mjs --headful          # 想肉眼看时
 *
 * 注意：Chrome 路径可写环境变量 CHROME_PATH 覆盖。
 */
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { existsSync, mkdtempSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join, extname } from 'node:path';

const argv = process.argv.slice(2);
const SIM_OLD = argv.includes('--simulate-old-kernel');
const HEADFUL = argv.includes('--headful');

const DIST = 'dist';
if (!existsSync(join(DIST, 'index.html'))) {
  console.error('✗ 没有 dist/index.html —— 先 npm run build');
  process.exit(1);
}

const CHROME = process.env.CHROME_PATH ||
  ['C:/Program Files/Google/Chrome/Application/chrome.exe',
   'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe'].find(existsSync);
if (!CHROME) {
  console.error('✗ 找不到 Chrome，设环境变量 CHROME_PATH 指过去');
  process.exit(1);
}

/** Android WebView on 红米 K30 Pro 的实测 UA（Chrome 83） */
const UA = SIM_OLD
  ? 'Mozilla/5.0 (Linux; Android 10; Redmi K30 Pro Build/QKQ1.191117.002; wv) AppleWebKit/537.36 ' +
    '(KHTML, like Gecko) Version/4.0 Chrome/83.0.4103.101 Mobile Safari/537.36'
  : 'Mozilla/5.0 (Linux; Android 13; Pixel 7) AppleWebKit/537.36 ' +
    '(KHTML, like Gecko) Chrome/126.0.0.0 Mobile Safari/537.36';

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
  } catch {
    res.writeHead(404); res.end('404');
  }
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const ORIGIN = `http://127.0.0.1:${server.address().port}`;

const CDP_PORT = 9411 + (SIM_OLD ? 1 : 0);
const profile = mkdtempSync(join(tmpdir(), 'hmzq-smoke-'));
const chrome = spawn(CHROME, [
  ...(HEADFUL ? [] : ['--headless=new']),
  `--remote-debugging-port=${CDP_PORT}`,
  `--user-data-dir=${profile}`,
  `--user-agent=${UA}`,
  '--window-size=412,915',
  '--no-first-run', '--no-default-browser-check', '--disable-extensions',
  // 无头环境下 WebGL2 要走软件渲染，否则拿不到 webgl2 上下文。
  // ⚠️ 2026-10-29 起本机 GPU 沙箱化后 SwiftShader 起不来（报 "Sandboxed = yes"，
  //    WebGLRenderer 拿不到 context），必须再关掉 GPU 沙箱与硬件加速。
  '--disable-gpu', '--disable-gpu-sandbox',
  '--use-angle=swiftshader', '--enable-unsafe-swiftshader',
  '--disable-features=Translate', 'about:blank',
], { stdio: 'ignore' });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** 轮询 /json/list，挑出真正的 page target（browser target 上发 Page.enable 会报 -32601） */
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
    logs.push(`[${e.level}] ${e.text}${e.url ? ' <' + e.url + '>' : ''}`);
  }
};

await send('Runtime.enable');
await send('Page.enable');
await send('Log.enable');

if (SIM_OLD) {
  // 把 window.Function 换成"不认识逻辑赋值"的解析器 —— 内核自检就是靠 new Function(probe)
  // 问内核的，所以这一下等价于把内核降到 Chrome 83（||= 需 85+）。
  // 只拦截带 ||= / ??= 的源码，其余原样放行，避免影响游戏自身。
  await send('Page.addScriptToEvaluateOnNewDocument', {
    source: `
      (function () {
        var Real = window.Function;
        function Patched() {
          var src = arguments.length ? String(arguments[arguments.length - 1]) : '';
          if (/\\|\\|=|\\?\\?=|&&=/.test(src)) throw new SyntaxError('Unexpected token |=');
          return Real.apply(this, arguments);
        }
        Patched.prototype = Real.prototype;
        window.Function = Patched;
      })();
    `,
  });
}

let bad = 0;
const fail = (msg) => { bad++; console.log(`✗ ${msg}`); };
const pass = (msg) => console.log(`✓ ${msg}`);

const GAME_URL = ORIGIN + '/index.html?mode=free&balls=15&lock=1&min=0.05&max=1.20&from=launcher';

/**
 * 打开一个地址并体检。
 * @param {string} url
 * @param {string} readyExpr 判定"页面就绪"的表达式，返回真值即认为加载完
 * @param {string} probe     取状态用的表达式（返回 JSON 字符串）
 */
async function visit(url, readyExpr, probe) {
  logs.length = 0;
  await send('Page.navigate', { url });
  for (let i = 0; i < 60; i++) {
    await sleep(400);
    try { if (await evaluate(readyExpr)) break; } catch { /* 还在加载 */ }
  }
  await sleep(600);
  const raw = await evaluate(probe).catch((e) => JSON.stringify({ evalError: String(e) }));
  const s = JSON.parse(raw);
  s.logs = logs.filter((l) => /error|uncaught|404|failed/i.test(l) && !/NotAllowedError|play\(\)|favicon/i.test(l));
  return s;
}

console.log(`\n===== 浏览器冒烟：${SIM_OLD ? '模拟老内核（Chrome 83）' : '正常内核'} =====`);

// ---- 第一阶段：启动器（用户看到的第一屏）----
console.log('\n[1/2] 启动器 launcher.html');
const L = await visit(ORIGIN + '/', `!!document.querySelector('[data-enter-game]')`, `JSON.stringify({
  blocked: !!window.__kernelBlocked, title: document.title,
  hasEnter: !!document.querySelector('[data-enter-game]'),
  mode: window.__runMode ? window.__runMode() : null
})`);
if (L.blocked) fail('弹了内核卡'); else pass('没有弹内核过旧卡');
if (!L.hasEnter) fail('启动器没有渲染出可进入的玩法卡片'); else pass('启动器界面已渲染');
if (L.logs.length) { fail('控制台有可疑输出：'); L.logs.slice(0, 6).forEach((l) => console.log(`   ${l.slice(0, 200)}`)); }
else pass('控制台干净');

// ---- 第二阶段：游戏本体（启动器传参进来的样子）----
console.log('\n[2/2] 游戏 index.html?…&from=launcher');
const G = await visit(GAME_URL, `parseFloat((document.getElementById('v-fps')||{}).textContent) > 0`, `JSON.stringify({
  blocked: !!window.__kernelBlocked,
  card: (function(){ var d=document.querySelectorAll('div'); for (var i=0;i<d.length;i++){ var s=d[i].getAttribute('style')||''; if (s.indexOf('z-index:99999')>=0) return (d[i].textContent||'').slice(0,200); } return null; })(),
  errors: window.__gameErrors || [],
  hasCanvas: !!document.querySelector('#app canvas'),
  webgl2: (function(){ var c=document.querySelector('#app canvas'); if(!c) return null; try { return !!c.getContext('webgl2'); } catch(e){ return 'err'; } })(),
  state: (document.getElementById('v-state')||{}).textContent,
  fps: (document.getElementById('v-fps')||{}).textContent
})`);
if (G.blocked || G.card) fail(`弹了内核卡：${(G.card || '').replace(/\s+/g, ' ').slice(0, 160)}`);
else pass('没有弹内核过旧卡');
if (G.errors && G.errors.length) fail(`运行期错误：${G.errors.join(' | ')}`);
else pass('无运行期错误');
if (!G.hasCanvas) fail('没有渲染出 canvas');
else pass('canvas 已创建');
if (G.webgl2 !== true) fail(`WebGL2 上下文不可用（${G.webgl2}）`);
else pass('WebGL2 可用');
if (!(parseFloat(G.fps) > 0)) fail(`帧率没有跑起来（v-fps = ${G.fps}）`);
else pass(`物理世界在跑（${G.fps} fps，状态「${G.state}」）`);
if (G.logs.length) { fail('控制台有可疑输出：'); G.logs.slice(0, 6).forEach((l) => console.log(`   ${l.slice(0, 200)}`)); }
else pass('控制台干净');

// 收尾：关无头 Chrome（**只按 PID**，绝不用 taskkill /IM chrome.exe —— 会连用户自己开的 Chrome 一起杀）
ws.close();
chrome.kill();
server.close();
await sleep(300);
if (bad) { console.log(`\n===== 浏览器冒烟：${bad} 项不合格 =====`); process.exit(1); }
console.log('\n===== 浏览器冒烟：全部通过 =====');
process.exit(0);
