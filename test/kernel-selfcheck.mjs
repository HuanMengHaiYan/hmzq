/**
 * 内核自检卡行为校验（回归护栏）
 * ------------------------------------------------------------------
 * index.html 里那段 ES5 自检脚本负责回答一个问题："这台机器跑得动吗？"
 * 它答错的代价很大 —— 2026-09-19 实测：装了 APK 直接看到「浏览器内核过旧」，
 * 但那台机器（Android WebView **Chrome 83**）其实**完全跑得动**。
 * 原因是脚本把 ES2021 的 `||=`（需 Chrome 85）当成硬门槛，而产物里根本没有 `||=` ——
 * 它只存在于探针字符串本身，早被 esbuild 降级掉了。结果是"能跑的机器被自己挡在门外"，
 * 而且这张卡比白屏更难怀疑（它看起来非常"确定"）。
 *
 * 做法：把 index.html 里那段脚本原样抽出来，在 Node 的 vm 里跑，
 * 用一个**假的 Function 构造器**模拟"某个 Chrome 版本的内核能不能解析这段源码"。
 * 于是不用真机、不用旧 Chromium（本机也拿不到），就能确定性复现各种内核水位。
 *
 * 断言的**性质**（不是"某个开关有效"）：
 *   - 构建产物 + 内核满足真实门槛（Chrome 75）→ 绝不能弹卡（不管缺多少 dev 语法）
 *   - 缺真门槛（wasm 指令 / 基础语法）→ 必须弹卡，且原因说清楚
 *   - dev 模式 + 缺 ES2020 语法 → 必须弹卡（这是唯一该弹的软门槛场景）
 *
 * 用法: node test/kernel-selfcheck.mjs
 */
import { readFileSync } from 'node:fs';
import { createContext, runInContext } from 'node:vm';

const html = readFileSync('index.html', 'utf8');

// 抽出自检脚本：从 'var WASM_PROBES' 往上找到那个 <script> 的开头，往下找到它的结尾。
const sTag = html.lastIndexOf('<script>', html.indexOf('var WASM_PROBES'));
const sEnd = html.indexOf('</script>', html.indexOf('var WASM_PROBES'));
if (sTag < 0 || sEnd < 0) {
  console.error('✗ index.html 里找不到内核自检脚本（WASM_PROBES 标记没了？）');
  process.exit(1);
}
const SRC = html.slice(html.indexOf('>', sTag) + 1, sEnd);

/** 探针源码 → 该写法最低需要的 Chrome 版本（模拟内核的"解析器"） */
const FEATURES = [
  [/class A \{/, 49, 'class'],
  [/=>/, 45, '箭头函数'],
  [/`t`/, 41, '模板字符串'],
  [/\{\.\.\.o\}/, 60, '对象展开'],
  [/var \[a\] = \[1\]/, 49, '解构'],
  [/for \(var x of/, 38, 'for...of'],
  [/await/, 55, 'async/await'],
  [/\?\./, 80, '可选链'],
  [/\?\?/, 80, '空值合并'],
  [/\|\|=/, 85, '逻辑赋值'],
  [/#x/, 74, '类私有成员'],
];

/**
 * 跑一遍自检脚本，返回它给出的结论。
 * @param {number} chrome   模拟的内核版本
 * @param {boolean} dev     true = 模拟 dev 模式（页面里有 /@vite/client）
 */
function selfCheck(chrome, dev) {
  const canParse = (src) => {
    for (const [re, min] of FEATURES) if (re.test(src) && chrome < min) return false;
    return true;
  };

  const boxes = [];
  const el = () => ({
    style: {},
    classList: { add() {} },
    textContent: '',
    setAttribute() {},
    appendChild() {},
    innerHTML: '',
  });
  const doc = {
    readyState: 'complete',
    body: { appendChild: (b) => boxes.push(b) },
    createElement: () => el(),
    getElementById: () => el(),
    getElementsByTagName: () =>
      dev
        ? [{ getAttribute: (k) => (k === 'src' ? '/@vite/client' : null) }]
        : [{ getAttribute: () => null }],
    addEventListener() {},
  };

  const win = {
    WebGL2RenderingContext: chrome >= 56 ? function () {} : undefined,
  };
  const sandbox = {
    window: win,
    document: doc,
    navigator: { userAgent: `Mozilla/5.0 (Linux; Android 10) Chrome/${chrome}.0.0.0 Mobile Safari/537.36` },
    // Rapier 的 wasm 要求 Chrome 75（i32.trunc_sat_* / memory.copy），模拟这个边界
    WebAssembly: chrome >= 57 ? { validate: () => chrome >= 75 } : undefined,
    Uint8Array,
    atob: (b64) => Buffer.from(b64, 'base64').toString('binary'),
    Function: function FakeFunction(src) {
      if (!canParse(src)) throw new SyntaxError('Unexpected token');
    },
  };
  sandbox.globalThis = sandbox;

  const ctx = createContext(sandbox);
  runInContext(SRC, ctx, { filename: 'index.html#kernel-selfcheck' });
  return {
    blocked: !!win.__kernelBlocked,
    text: boxes.map((b) => b.innerHTML).join('\n'),
    hardMiss: win.__kernelMissing || [],
    devMiss: win.__devMissing || [],
    wasmMiss: win.__wasmMissing || [],
  };
}

const CASES = [
  // [说明, 内核版本, dev?, 期望弹卡?, 卡片必须包含]
  ['chrome83 + 产物（本次踩坑：APK 实测机型，必须放行）', 83, false, false, []],
  ['chrome79 + 产物（只缺 ?. ?? ||=，产物用不上）', 79, false, false, []],
  ['chrome75 + 产物（真实门槛，边界）', 75, false, false, []],
  ['chrome104 + 产物', 104, false, false, []],
  ['chrome71 + 产物（wasm 指令不够 → 必须弹卡）', 71, false, true, ['WebAssembly', 'Chrome 71']],
  // 注意用 55：对象展开（{...o}）恰好是 Chrome 60 起支持，写 60 就"刚好能跑"，测不出硬门槛
  ['chrome55 + 产物（缺对象展开 → 必须弹卡）', 55, false, true, ['对象展开']],
  ['chrome79 + dev（缺 ?. ?? ||= → 必须弹卡）', 79, true, true, ['可选链', 'dev']],
  // Chrome 83 恰好卡在 `||=`（需 85）上：产物没事，dev 模式必然白屏 —— 拦得对
  ['chrome83 + dev（真缺 ||= → 必须弹卡）', 83, true, true, ['逻辑赋值', 'dev']],
  ['chrome86 + dev（ES2021 也够用 → 不该弹卡）', 86, true, false, []],
];

let bad = 0;
for (const [label, chrome, dev, expectBlocked, mustHave] of CASES) {
  const r = selfCheck(chrome, dev);
  const problems = [];

  if (r.blocked !== expectBlocked) {
    problems.push(expectBlocked ? '应该弹卡却放行了' : '**不该弹卡却弹了**');
  }
  for (const kw of mustHave) {
    if (r.text.indexOf(kw) < 0) problems.push(`卡片里没提「${kw}」`);
  }
  // 放行的场景不该残留任何"缺失"状态（否则后续逻辑会以为自己被拦）
  if (!expectBlocked && (r.hardMiss.length || r.devMiss.length || r.wasmMiss.length)) {
    problems.push(`残留缺失状态 hard=[${r.hardMiss}] dev=[${r.devMiss}] wasm=[${r.wasmMiss}]`);
  }
  // 弹卡的场景必须说明缺的是什么，不能是空壳卡
  if (expectBlocked && !r.hardMiss.length && !r.devMiss.length && !r.wasmMiss.length) {
    problems.push('弹了卡但没记录缺失项');
  }

  if (problems.length) {
    bad++;
    console.log(`✗ ${label}\n   ${problems.join('\n   ')}`);
  } else {
    console.log(`✓ ${label}`);
  }
}

console.log('');
if (bad) {
  console.log(`===== 内核自检卡：${bad} / ${CASES.length} 个场景不符合预期 =====`);
  console.log('常见原因：把 ES2020/ES2021 的语法探针（?. ?? ||= #）并进了硬门槛 miss。');
  console.log('那些语法在构建产物里已被 esbuild 降级，产物缺了它们照样能跑（见 index.html 注释）。');
  process.exit(1);
}
console.log(`===== 内核自检卡：${CASES.length} 个场景全部符合预期 =====`);
