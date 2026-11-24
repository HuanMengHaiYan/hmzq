/**
 * 语法底线校验（回归护栏）
 * ------------------------------------------------------------------
 * 为什么需要它：手机自带浏览器（MIUI 浏览器 / 老 WebView）内核常停在 Chrome 70~79。
 * 一旦产出物里带上它们不认识的语法（`?.` 是 ES2020、`#私有成员` 是 ES2022），
 * 浏览器会**一行都不执行**，页面只留一个 `Uncaught SyntaxError: Unexpected token .`，
 * HUD 上还挂着 HTML 里的初始值 —— 从现象完全看不出是语法问题。
 *
 * 做法：用 acorn 从 ES2015 逐级往上试解析，报出每个文件**最低需要哪个版本**。
 *   ES2019 = Chrome 79 / Safari 13 可跑；`?.` 与 `??` 是 ES2020 开始才有的。
 *
 * 用法:
 *   node test/syntax-floor.mjs             # 校验 dist/ 与 public/（先 npm run build）
 *   node test/syntax-floor.mjs <文件...>    # 只看指定文件
 *
 * 无参运行时，另外校验 index.html 里 3 个 wasm 探针（内核支不支持 Rapier 用的 wasm 指令，
 * 页面就靠问它们；探针坏了会把好内核误判成过旧）。
 *
 * 注意：`dist-electron/` 不在校验范围内 —— 它跑在 Electron 自带的新版 Chromium 上，
 * 配置里刻意保持 `target: 'esnext'`（见 vite.electron.config.js）。
 */
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join } from 'node:path';

const acorn = createRequire(import.meta.url)('acorn');

/** 期望上限：产出物语法不得高于 ES2019（Chrome 63+ / Safari 12+ 可跑） */
const LIMIT = 2019;

const VERSIONS = [2015, 2016, 2017, 2018, 2019, 2020, 2021, 2022];
const FEATURE = {
  2020: '可选链 ?. / 空值合并 ??',
  2021: '逻辑赋值 ||= &&= ??=',
  2022: '类字段 / #私有成员 / static 块',
};

function parse(code, ecmaVersion, sourceType) {
  acorn.parse(code, { ecmaVersion, sourceType, allowHashBang: true });
}

/** 找出最低可解析的版本；模块与经典脚本两种模式取更低的那个 */
function floorOf(code) {
  let lastErr = null;
  for (const v of VERSIONS) {
    let okMode = null;
    for (const sourceType of ['module', 'script']) {
      try {
        parse(code, v, sourceType);
        okMode = sourceType;
        break;
      } catch (e) {
        lastErr = { v, sourceType, msg: e.message, pos: e.pos };
      }
    }
    if (okMode) return { ok: v, mode: okMode };
  }
  return { ok: null, err: lastErr };
}

/**
 * acorn 把 `import.meta` 归到 ES2020，但浏览器实际是 **Chrome 64+** 就支持
 * （`import.meta.resolve` 确实要 105+，不过 Vite 生成的用法都自带兜底：
 *  `import.meta.resolve ? ... : new URL(x, import.meta.url)`，老内核走后者）。
 * 而本作的真实门槛是 wasm 指令要求的 **Chrome 75+**（见下面的探针校验），远高于 64。
 * 所以只含 import.meta 的文件是**误判**，会把好产物判成超标。
 * 处理：把 import.meta 替换成一个语法等价的对象再测一次，能压到 ES2019 以内就放行。
 */
function stripImportMeta(code) {
  return code.replace(/import\.meta/g, '({url:"",resolve:0})');
}

/** 在指定版本下重新解析，拿到第一处出错的上下文，便于定位 */
function locate(code, v, mode) {
  try {
    parse(code, v, mode);
    return null;
  } catch (e) {
    const upto = code.slice(0, e.pos);
    const line = upto.split('\n').length;
    const col = e.pos - upto.lastIndexOf('\n');
    return { line, col, msg: e.message, src: (code.split('\n')[line - 1] || '').trim().slice(0, 120) };
  }
}

function targets() {
  const argv = process.argv.slice(2);
  if (argv.length) return argv;
  const out = [];
  const distAssets = 'dist/assets';
  if (existsSync(distAssets)) {
    for (const f of readdirSync(distAssets)) if (f.endsWith('.js')) out.push(join(distAssets, f));
  }
  if (existsSync('public')) {
    for (const f of readdirSync('public')) if (f.endsWith('.js')) out.push(join('public', f));
  }
  return out;
}

// ---------------------------------------------------------------------------
// 附加校验：src/ 源码本身能不能被解析
// 上面那条底线校验只看 dist/ 与 public/ 的**产物**，而 src/ 里的渲染层
// （aimer.js / stage.js / hud.js ...）既不被 headless 也不被 scene 测试 import ——
// 也就是说源码被写坏时，`npm test` 与 `npm run check` **全绿**，只有
// `npm run dev`（源码直出、不转译）或 `npm run build` 才会炸。
// 2026-11-04 就踩过：aimer.js 首行被写进一个 diff 残留的 `-`，
// dev 一打开就是 `Uncaught SyntaxError: Unexpected token '*'`，而当时所有检查都是绿的。
// 这里只判「能不能解析」，不设版本上限（源码允许用 #私有成员等新语法）。
// ⚠️ 必须跑在 targets() 之前：产物缺失时那里会直接 exit(0)。
// ---------------------------------------------------------------------------
function checkSources() {
  if (process.argv.slice(2).length || !existsSync('src')) return;
  const srcFiles = [];
  (function walk(dir) {
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      const p = join(dir, e.name);
      if (e.isDirectory()) walk(p);
      else if (e.name.endsWith('.js')) srcFiles.push(p);
    }
  })('src');

  let bad = 0;
  for (const f of srcFiles) {
    const code = readFileSync(f, 'utf8');
    try {
      acorn.parse(code, { ecmaVersion: 'latest', sourceType: 'module', allowHashBang: true });
    } catch (e) {
      const upto = code.slice(0, e.pos);
      const line = upto.split('\n').length;
      const src = (code.split('\n')[line - 1] || '').trim().slice(0, 120);
      console.log(`✗ ${f} 第 ${line} 行解析失败：${e.message}`);
      console.log(`   ${src}`);
      bad++;
    }
  }
  if (bad) {
    console.log(`\n===== 源码解析校验：${bad}/${srcFiles.length} 个文件解析失败 =====`);
    console.log('源码写坏了：dev 模式（源码直出）会直接红框，构建也会失败。');
    process.exit(1);
  }
  console.log(`===== 源码解析校验：src/ 下 ${srcFiles.length} 个文件全部可解析 =====`);
}

checkSources();

const files = targets();
if (!files.length) {
  console.log('没找到要检查的文件（先 npm run build，或直接传入文件路径）');
  process.exit(0);
}

let failed = 0;
for (const file of files) {
  const name = file.split(/[\\/]/).pop();
  const code = readFileSync(file, 'utf8');
  const r = floorOf(code);

  if (r.ok === null) {
    console.log(`✗ ${name}  连 ES2022 都解析不了：${r.err.msg}`);
    failed++;
    continue;
  }

  if (r.ok > LIMIT) {
    // 先看是不是 only-import.meta 造成的误判（理由见 stripImportMeta 的注释）
    const stripped = floorOf(stripImportMeta(code));
    if (stripped.ok !== null && stripped.ok <= LIMIT) {
      console.log(`✓ ${name}  仅含 import.meta（Chrome 64+ 支持），其余部分 ES${stripped.ok}`);
      continue;
    }
  }

  if (r.ok <= LIMIT) {
    console.log(`✓ ${name}  底线 ES${r.ok}`);
    continue;
  }
  failed++;
  console.log(`✗ ${name}  底线 ES${r.ok} > ES${LIMIT}` +
    (FEATURE[r.ok] ? ` —— 含 ${FEATURE[r.ok]}` : ''));
  const at = locate(code, LIMIT, r.mode);
  if (at) console.log(`   第一处：第 ${at.line} 行第 ${at.col} 列 ${at.msg}\n   ${at.src}`);
}

if (failed) {
  console.log(`\n===== 语法底线校验：${failed} 个文件超标 =====`);
  console.log('把 vite.config.js 的 build.target 降下来（当前应为 es2019），或升级支持的内核要求。');
  process.exit(1);
}
console.log(`\n===== 语法底线校验：${files.length} 个文件全部 ≤ ES${LIMIT} =====`);

// ---------------------------------------------------------------------------
// 附加校验：index.html 里那 3 个 wasm 探针
// 语法降级只能把门槛压到 Chrome 73；Rapier 的 wasm 另外要求 Chrome 74/75 才有指令
// （i32.extend8_s / i32.trunc_sat_f32_s / memory.copy）。页面靠 3 个 36~46 字节的极小 wasm
// 模块去问内核"支不支持"，所以**探针本身必须是合法 wasm**，否则会把好内核误判成过旧。
// 只在无参全量校验时跑。
// ---------------------------------------------------------------------------
if (!process.argv.slice(2).length && existsSync('index.html')) {
  const html = readFileSync('index.html', 'utf8');
  const start = html.indexOf('var WASM_PROBES');
  const end = start >= 0 ? html.indexOf('];', start) : -1;
  const block = start >= 0 && end > start ? html.slice(start, end) : '';
  const found = [...block.matchAll(/'([A-Za-z0-9+/=]{30,})'/g)].map((m) => m[1]);

  console.log('');
  if (found.length !== 3) {
    console.log(`✗ index.html 的 WASM_PROBES 里找到 ${found.length} 个探针（应为 3 个）`);
    process.exit(1);
  }
  let probeBad = 0;
  const distHtml = existsSync('dist/index.html') ? readFileSync('dist/index.html', 'utf8') : null;
  for (const b64 of found) {
    const buf = Buffer.from(b64, 'base64');
    const isWasm = buf.length > 8 && buf.readUInt32LE(0) === 0x6d736100;
    const valid = isWasm && WebAssembly.validate(buf);
    const inDist = distHtml ? distHtml.includes(b64) : null;
    const flags = `${isWasm ? 'wasm 魔数✓' : 'wasm 魔数✗'} ${valid ? 'WebAssembly.validate✓' : 'validate✗'}` +
      (inDist === null ? '' : inDist ? ' 产物中✓' : ' 产物中✗');
    if (!valid || inDist === false) probeBad++;
    console.log(`${valid && inDist !== false ? '✓' : '✗'} wasm 探针 ${String(buf.length).padStart(3)} 字节  ${flags}`);
  }
  if (probeBad) {
    console.log(`\n===== wasm 探针校验：${probeBad} 个有问题 =====`);
    console.log('探针坏掉会让手机端误判内核（把支持的内核判成过旧）。重生成方法见 README「浏览器兼容性」。');
    process.exit(1);
  }
  console.log(`===== wasm 探针校验：3 个全部合法${distHtml ? '、且在 dist/index.html 中' : ''} =====`);
}
