/**
 * 文档配图：真实桌面模型 · 固定机位组图
 * ------------------------------------------------------------------
 * `docs/model-shots/*.png` 就是本脚本出的。**改了模型资产、袋口挖洞、光照之后重跑一次**，
 * 否则文档里那张图还停在旧版本（旧模型袋口是假的、亮度也不一样），看图验收会骗自己。
 *
 * 跑法：npm run shots:model       （先 npx vite build；Chrome 路径可用 CHROME_PATH 覆盖）
 * 产物：docs/model-shots/{overview,top,corner-pocket,mid-pocket,legs-low}.png
 *
 * 为什么不用 test/scene.mjs 那套：那是 headless-gl 的离屏渲染，**出来的不是最终画面**
 * （没有 tone mapping 后的真实观感、也没有阴影）。这里走真 Chrome，跟玩家看到的一致。
 */
import { createServer } from 'node:http';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { existsSync, mkdtempSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join, extname } from 'node:path';

const DIST = 'dist';
const OUT = 'docs/model-shots';
const CHROME = process.env.CHROME_PATH ||
  ['C:/Program Files/Google/Chrome/Application/chrome.exe',
   'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe'].find(existsSync);
if (!CHROME) throw new Error('找不到 Chrome，设 CHROME_PATH 指过去');
if (!existsSync(join(DIST, 'index.html'))) throw new Error('没有 dist/，先 npx vite build');

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

const W = 1280, H = 760;
const CDP_PORT = 9451;
const profile = mkdtempSync(join(tmpdir(), 'hmzq-shots-'));
const chrome = spawn(CHROME, [
  '--headless=new', `--remote-debugging-port=${CDP_PORT}`, `--user-data-dir=${profile}`,
  `--window-size=${W},${H}`, '--no-first-run', '--no-default-browser-check', '--disable-extensions',
  '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--disable-gpu-sandbox',
  '--disable-features=Translate', '--hide-scrollbars', 'about:blank',
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
    } catch { /* 等 Chrome 起来 */ }
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
await send('Emulation.setDeviceMetricsOverride', { width: W, height: H, deviceScaleFactor: 1, mobile: false });
// 桌面环境（无头 Chrome 默认 maxTouchPoints>0 会被判成手机 → 走竖屏 UI，图就不能用了）
await send('Page.addScriptToEvaluateOnNewDocument', {
  source: `try { Object.defineProperty(navigator, 'maxTouchPoints', { get: () => 0, configurable: true }); } catch (e) {}`,
});

await send('Page.navigate', { url: ORIGIN + '/index.html?mode=free&from=launcher' });
// 等模型加载完（没开模型时会回落，等状态不再是 loading 就行）
let st = '';
for (let i = 0; i < 60; i++) {
  await sleep(300);
  st = await evaluate(`(window.__hmzq && window.__hmzq.model) ? window.__hmzq.model.status : 'boot'`);
  if (st === 'ready' || st === 'failed' || st === 'disabled') break;
}
console.log('模型状态：' + st);
await sleep(1200);   // 阴影第一帧 + 机位稳定

/** 摆机位：直接改相机与 orbit target，再手动渲一帧（animate 循环只在有输入时才动相机） */
async function pose(px, py, pz, tx, ty, tz) {
  await evaluate(`(function(){
    var rig = __hmzq.rig, ctl = rig.controls;
    rig.setMode('free');
    __hmzq.stage.setLampVisible(true);   // ⚠️ rig.setMode 不走 main.js 那层包装，灯罩得自己开回来
    // ⚠️ 相机必须在 setMode **之后**取：顶视用的是 orthoCam，setMode 才把 stage.camera 切回 perspCam。
    //    先取再切，摆的是正交相机，透视相机纹丝不动 → 出来的图还是上一张的机位（踩过）。
    var cam = rig.camera;
    ctl.target.set(${tx}, ${ty}, ${tz});
    cam.position.set(${px}, ${py}, ${pz});
    cam.lookAt(${tx}, ${ty}, ${tz});
    ctl.update();
    __hmzq.stage.render();
  })()`);
  await sleep(320);
}
async function shot(name) {
  // 打图前把机位读回来打一行：机位没生效的话图是错的，但肉眼看图不一定看得出来
  const cam = await evaluate(`(function(){
    var c = __hmzq.rig.camera;
    return [+c.position.x.toFixed(2), +c.position.y.toFixed(2), +c.position.z.toFixed(2)].join(',');
  })()`);
  const r = await send('Page.captureScreenshot', { format: 'png' });
  await writeFile(join(OUT, name + '.png'), Buffer.from(r.data, 'base64'));
  console.log('  → ' + name + '.png  (camera ' + cam + ')');
}

await mkdir(OUT, { recursive: true });

// 全景：斜上方 45°，整台 + 桌腿都在画面里
await pose(1.9, 2.35, 2.5, 0, 0.05, 0);
await shot('overview');

// 正俯视：看比例与 6 个洞（袋口挖没挖通一眼就看得出来）
// ⚠️ 别用"相机摆到正上方再 lookAt 原点"：视线与 up 向量几乎平行，lookAt 会退化出一个怪 roll。
// 直接借游戏自己的顶视正交机位；**并且要照 main.js 那样把灯罩藏掉** ——
// 头顶那两盏 0.19m 半径的灯罩在正俯视下就是两块大黑饼，会盖在台面上。
await evaluate(`(function(){
  __hmzq.rig.setMode('top');
  __hmzq.stage.setLampVisible(false);
  __hmzq.stage.render();
})()`);
await sleep(500);
await shot('top');

// 角袋特写：从台内往外俯看，看口沿环有没有盖住切口阶梯
await pose(0.86, 0.42, 0.28, 1.21, 0, 0.60);
await shot('corner-pocket');

// 中袋特写
await pose(0.14, 0.36, 0.98, 0.0, 0, 0.635);
await shot('mid-pocket');

// 低角度：贴着地面往上看，查"框顶悬空方块"与桌腿落地
await pose(2.6, 0.22, 2.9, 0.2, 0.45, 0.2);
await shot('legs-low');

const errs = await evaluate(`(window.__gameErrors || []).length`);
console.log('运行期错误：' + errs + ' 项');

ws.close();
chrome.kill();
server.close();
if (errs) process.exit(1);
