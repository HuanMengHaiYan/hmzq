/**
 * Electron / 桌面产物的 file:// 可用性探针
 * ------------------------------------------------------------------
 * 为什么需要它：
 *   Electron 的窗口自检（HMZQ_SMOKE=1）依赖 GUI 会话，在某些沙箱环境里进程会**静默退出**
 *   （连 main.js 都没执行、exit code 还是 0，看不出任何异常 —— 只有落文件才能发现）。
 *   而 dist-electron 与 dist 是两份不同的产物（IIFE + 相对路径，专给 file:// 用），
 *   只测 dist/http 覆盖不到它。这条探针用无头 Chrome + CDP 以 file:// 打开页面，
 *   和 Electron 是同一条加载路径，不需要 GUI 会话。
 *
 * 用法：
 *   node test/browser-file.mjs                                    → 验启动器（默认）
 *   node test/browser-file.mjs dist-electron/index.html           → 验游戏页
 *   node test/browser-file.mjs "dist-electron/index.html?mode=free&from=launcher"
 *
 * 判据（都是"性质"而不是"有没有元素"）：
 *   · 启动器：launcher.js 跑完会把 HTML 里静态写的「· 桌面版」改写成「· 网页版」
 *     （它按有没有 Electron 运行时判断）。所以看到「网页版」= JS 真的执行完了；
 *     还是「桌面版」= 页面只是被打开了、脚本根本没跑 —— 白屏也能开，这个判据才咬得住。
 *   · 游戏页：必须有 ≥1 个 canvas 且无页面错误 —— 说明 three 与内联 wasm 都初始化了。
 *     注意 index.html 有"无参数就跳回 launcher.html"的守卫，拿它做目标时必须带查询参数。
 */
import { spawn } from 'node:child_process';
import { mkdtempSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const CHROME = process.env.CHROME_PATH ||
  ['C:/Program Files/Google/Chrome/Application/chrome.exe',
   'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe'].find(existsSync);
if (!CHROME) {
  console.error('✗ 找不到 Chrome，设环境变量 CHROME_PATH 指过去');
  process.exit(1);
}

const arg = process.argv[2] || 'dist-electron/launcher.html';
const [relPath, query] = arg.split('?');
const PAGE = resolve(relPath);
const URL = 'file:///' + PAGE.replace(/\\/g, '/') + (query ? '?' + query : '');
const isLauncher = /launcher\.html$/.test(PAGE);

const PORT = 9433;
const profile = mkdtempSync(join(tmpdir(), 'hmzq-file-'));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

console.log('探针目标：' + URL);
const chrome = spawn(CHROME, [
  '--headless=new',
  `--remote-debugging-port=${PORT}`,
  `--user-data-dir=${profile}`,
  '--no-first-run', '--no-default-browser-check', '--disable-extensions',
  // 无头环境下 WebGL2 要走软件渲染，否则拿不到 webgl2 上下文
  '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--disable-gpu-sandbox',
  'about:blank',
], { stdio: 'ignore' });

async function pageTarget() {
  for (let i = 0; i < 100; i++) {
    try {
      const list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
      const t = list.find((x) => x.type === 'page');
      if (t && t.webSocketDebuggerUrl) return t;
    } catch { /* 还没起来 */ }
    await sleep(200);
  }
  throw new Error('CDP 连不上（Chrome 没起来？）');
}

let ws;
try {
  const t = await pageTarget();
  ws = new WebSocket(t.webSocketDebuggerUrl);
  await new Promise((res, rej) => {
    ws.addEventListener('open', res);
    ws.addEventListener('error', rej);
  });

  let id = 0;
  const pending = new Map();
  const errs = [];
  ws.addEventListener('message', (ev) => {
    const m = JSON.parse(ev.data);
    if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); }
    if (m.method === 'Runtime.exceptionThrown') {
      const d = m.params.exceptionDetails;
      errs.push((d.exception && d.exception.description) || d.text || '未知异常');
    }
    if (m.method === 'Runtime.consoleAPICalled' && m.params.type === 'error') {
      errs.push(m.params.args.map((a) => a.value ?? a.description ?? '').join(' '));
    }
  });
  const send = (method, params) => new Promise((res) => {
    const i = ++id;
    pending.set(i, res);
    ws.send(JSON.stringify({ id: i, method, params }));
  });

  await send('Runtime.enable');
  await send('Page.enable');
  await send('Page.navigate', { url: URL });
  await sleep(isLauncher ? 4500 : 7000);   // 游戏页要等 three + 内联 wasm 初始化

  const r = await send('Runtime.evaluate', {
    expression: `JSON.stringify({
      about: (document.getElementById('about-ver') || {}).textContent || '',
      ver: (document.getElementById('ver') || {}).textContent || '',
      title: document.title,
      ready: document.readyState,
      canvases: document.querySelectorAll('canvas').length,
      here: location.pathname.split('/').pop()
    })`,
    returnByValue: true,
  });
  const got = JSON.parse(r.result?.result?.value || '{}');

  const jsRan = isLauncher ? /网页版/.test(got.about) : got.canvases >= 1;
  const clean = errs.length === 0;
  const ok = jsRan && clean;

  console.log('\n实际落在   ' + got.here);
  console.log('页面标题   ' + got.title);
  console.log('readyState ' + got.ready);
  console.log('版本号     ' + got.ver + '  /  ' + got.about);
  console.log('canvas     ' + got.canvases + ' 个');
  console.log('');
  console.log(isLauncher
    ? '脚本跑完   ' + (jsRan ? '✓ 是（HTML 里的「桌面版」已被改写成「网页版」）' : '✗ 否（还是 HTML 原文）')
    : '画面初始化 ' + (jsRan ? '✓ 有 canvas' : '✗ 一个 canvas 都没有'));
  console.log('页面错误   ' + (clean ? '✓ 无' : '✗ ' + errs.join(' | ')));
  console.log('\n===== file:// 探针：' + (ok ? '通过' : '不通过') + ' =====');
  process.exitCode = ok ? 0 : 1;
} finally {
  try { ws && ws.close(); } catch { /* ignore */ }
  // 只按自己的 PID 关，绝不按进程名杀（会连用户自己开的 Chrome 一起关）
  try { chrome.kill(); } catch { /* ignore */ }
}
