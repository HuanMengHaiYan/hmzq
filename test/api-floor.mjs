/**
 * 运行时 API 底线校验（回归护栏）
 * ------------------------------------------------------------------
 * 为什么需要它：`check:syntax` 只管**语法**（能不能解析），管不了**运行时要用的 API**。
 * 产物的语法底线是 ES2019（Chrome 73+），但本作的真实门槛是 Rapier 的 wasm 要求
 * Chrome 75+；而手机自带的 Android WebView 实测停在 **Chrome 83**（红米 K30 Pro，
 * 2026-09-19 实测）。语法过关但调用了 Chrome 85+ 才有的 `String.replaceAll`，
 * 现象是页面能加载、跑到某处才抛 TypeError —— 比语法错误更难定位。
 *
 * 做法：在产物里搜索一组"按 Chrome 版本分档"的 API 名字，报出高于门槛的命中项。
 * 只是**字符串命中**，会有误报（注释、属性名撞名、polyfill 自带实现），
 * 所以命中后会打印上下文片段供人工确认；真正的判定仍以真机/无头浏览器为准。
 *
 * 用法:
 *   node test/api-floor.mjs              # 校验 dist/assets/*.js（先 npm run build）
 *   node test/api-floor.mjs --max 83     # 指定允许的最高 Chrome 版本（默认 83）
 *   node test/api-floor.mjs --strict     # 有命中就退出码 1（默认只提示，因为可能误报）
 *
 * 已知的两处**长期误报**（2026-09-19 复核过，别再当成新问题）：
 *   - `.at(`：命中的是 three.js `Ray.at()` / 自定义方法，不是 `Array.prototype.at`
 *   - `FinalizationRegistry`：Rapier 自带 `typeof FinalizationRegistry > 'u' ? 空实现 : new …`
 *     的特性探测，老内核走空实现，安全
 * 这也是默认不 --strict 的原因：它给**线索**，最终判定以真机 / 无头浏览器为准。
 */
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const argv = process.argv.slice(2);
const maxIdx = argv.indexOf('--max');
const LIMIT = maxIdx >= 0 ? Number(argv[maxIdx + 1]) : 83;

/** 名称 -> 该 API 最低 Chrome 版本。只列**容易被无意用到**的那些。 */
const APIs = [
  ['String.replaceAll', 85, 'replaceAll'],
  ['Promise.any', 85, 'Promise\\.any'],
  ['AggregateError', 85, 'AggregateError'],
  ['Object.hasOwn', 93, 'Object\\.hasOwn'],
  ['Array.prototype.at', 92, '\\.at\\('],
  ['Array.prototype.findLast', 97, 'findLast'],
  ['Array.prototype.toSorted/toReversed', 110, 'toSorted|toReversed'],
  ['Array.prototype.group/groupBy', 117, 'groupBy|\\.group\\('],
  ['structuredClone', 98, 'structuredClone'],
  ['crypto.randomUUID', 92, 'randomUUID'],
  ['WeakRef / FinalizationRegistry', 84, 'WeakRef|FinalizationRegistry'],
  ['Intl.Segmenter', 87, 'Intl\\.Segmenter'],
  ['Intl.DisplayNames', 81, 'Intl\\.DisplayNames'],
  ['Array.flatMap', 69, 'flatMap'],
  ['Promise.allSettled', 76, 'Promise\\.allSettled'],
  ['globalThis', 71, 'globalThis'],
  ['BigInt', 67, 'BigInt'],
  ['ResizeObserver', 64, 'ResizeObserver'],
  ['queueMicrotask', 71, 'queueMicrotask'],
  ['WebGL2 查询 API', 53, 'WebGL2RenderingContext'],
];

function targets() {
  const dir = 'dist/assets';
  if (!existsSync(dir)) return [];
  return readdirSync(dir).filter((f) => f.endsWith('.js')).map((f) => join(dir, f));
}

const files = targets();
if (!files.length) {
  console.log('没找到产物（先 npm run build）');
  process.exit(0);
}

let suspect = 0;
for (const file of files) {
  const name = file.split(/[\\/]/).pop();
  const code = readFileSync(file, 'utf8');
  const hits = [];
  for (const [label, ver, re] of APIs) {
    const m = code.match(new RegExp(re, 'g'));
    if (m && ver > LIMIT) hits.push({ label, ver, n: m.length, re });
  }
  if (!hits.length) {
    console.log(`✓ ${name}  未命中任何 > Chrome ${LIMIT} 的运行时 API`);
    continue;
  }
  suspect += hits.length;
  for (const h of hits) {
    console.log(`? ${name}  ${h.label}（Chrome ${h.ver}+ 才有）命中 ${h.n} 处`);
    const m = new RegExp(h.re).exec(code);
    if (m) {
      const ctx = code.slice(Math.max(0, m.index - 70), m.index + 70).replace(/\n/g, ' ');
      console.log(`   …${ctx}…`);
    }
  }
}

console.log(`\n===== 运行时 API 底线：允许上限 Chrome ${LIMIT}，疑似命中 ${suspect} 处 =====`);
if (suspect) {
  console.log('对照上面两条"已知长期误报"先排除；确认是真调用就改代码或提高门槛。');
  console.log('提示：单靠字符串匹配判不准，用无头浏览器打断点 / 真机复现才是准的。');
}
if (suspect && argv.includes('--strict')) process.exit(1);
