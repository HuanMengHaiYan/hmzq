/**
 * i18n 覆盖率审计（开发工具，`node scripts/i18n-audit.mjs`）
 * ------------------------------------------------------------------
 * 干两件事，对应两类文案来源：
 *   ① **HTML**：用与 public/i18n.js 完全相同的遍历规则（叶子文本 / 整块替换）
 *      把 index.html 与 launcher.html 里所有"会被查表的中文单元"列出来，查不到就报缺失。
 *   ② **JS**：用 acorn 解析 src/ 与 public/ 下所有脚本，取出含汉字的字符串字面量
 *      （注释天然被忽略），同样查一遍表。
 *
 * 输出缺失清单（key 就是最终要写进 public/i18n-en.js 的中文原文），
 * 全绿时打印统计。CI / 收尾时的门槛：退出码非 0 即代表还有中文没翻。
 *
 * 为什么要复刻运行时算法而不是"扫一遍中文"：整个项目的中文绝大多数是**注释**，
 * 粗糙扫描会淹没重点；而 HTML 里带 <b> 的整段必须按"整块元素"算一个单元，
 * 按文本节点拆开会得到 "、" 这种碎片，既翻不了也没法查表。
 */
import { readFileSync } from 'node:fs';
import { parse } from 'acorn';

/* ---------------- 与 public/i18n.js 保持一致的查表逻辑 ---------------- */

const code = readFileSync(new URL('../public/i18n-en.js', import.meta.url), 'utf8');
new Function(code)();                                   // 经典脚本：会把自己挂到 globalThis
const DICT = globalThis.HMZQ_EN || {};
const RULES = globalThis.HMZQ_EN_RULES || [];

const CJK = /[\u3400-\u4dbf\u4e00-\u9fff]/;
const norm = (s) => String(s == null ? '' : s).replace(/[\s\u3000]+/g, ' ').trim();

function lookup(raw) {
  const k = norm(raw);
  if (!k || !CJK.test(k)) return null;
  if (Object.prototype.hasOwnProperty.call(DICT, k)) return DICT[k];
  for (const [re, en] of RULES) if (re.test(k)) return k.replace(re, en);
  return null;
}

/* ---------------- 迷你 HTML 解析（本项目自己写的页面，结构规整够用） ---------------- */

const VOID = new Set(['meta', 'link', 'br', 'img', 'input', 'hr', 'source', 'area', 'base', 'col', 'embed', 'param', 'track', 'wbr']);
const SAFE_TAG = new Set(['B', 'I', 'EM', 'STRONG', 'KBD', 'CODE', 'BR', 'SPAN', 'SMALL', 'SUP', 'SUB', 'WBR', 'U', 'S']);

function parseHtml(src) {
  const root = { tag: '#root', attrs: '', children: [], parent: null };
  let cur = root;
  const stack = [root];
  const re = /<!--[\s\S]*?-->|<\/([a-zA-Z][\w-]*)\s*>|<([a-zA-Z][\w-]*)((?:"[^"]*"|'[^']*'|[^>"'])*?)(\/?)>|([^<]+)/g;
  let m;
  while ((m = re.exec(src))) {
    if (m[0].startsWith('<!--')) continue;
    if (m[1]) {                                            // 闭合标签
      const tag = m[1].toLowerCase();
      for (let i = stack.length - 1; i > 0; i--) {
        if (stack[i].tag === tag) { stack.length = i; break; }
      }
      cur = stack[stack.length - 1];
      continue;
    }
    if (m[2]) {                                            // 开标签
      const tag = m[2].toLowerCase();
      const node = { tag, attrs: m[3] || '', children: [], parent: cur, selfClose: m[4] === '/' };
      cur.children.push(node);
      if (!VOID.has(tag) && !node.selfClose) { stack.push(node); cur = node; }
      continue;
    }
    if (m[5]) cur.children.push({ tag: '#text', text: m[5], parent: cur, children: [] });
  }
  return root;
}

const tagOf = (n) => n.tag.toUpperCase();

function textContent(n) {
  if (n.tag === '#text') return n.text;
  if (n.tag === 'script' || n.tag === 'style') return '';
  return n.children.map(textContent).join('');
}

function innerHtml(n) {
  // 只用于展示，不参与判定：把子节点原样拼回去
  return n.children.map((c) => {
    if (c.tag === '#text') return c.text;
    const selfClose = VOID.has(c.tag) ? ' /' : '';
    return `<${c.tag}${c.attrs ? ' ' + c.attrs.trim() : ''}${selfClose}>` +
      innerHtml(c) + (VOID.has(c.tag) ? '' : `</${c.tag}>`);
  }).join('');
}

function childElements(n) { return n.children.filter((c) => c.tag !== '#text').length; }

function markupSafe(n) {
  for (const c of n.children) {
    if (c.tag === '#text') continue;
    if (!SAFE_TAG.has(tagOf(c))) return false;
    if (c.attrs.trim()) return false;
    if (!markupSafe(c)) return false;
  }
  return true;
}

function skipped(n) {
  for (let p = n; p; p = p.parent) if (/\sdata-i18n-skip/.test(' ' + p.attrs)) return true;
  return false;
}

/** 复刻 runtime 的 walk()，收集"应当被查到"的单元 */
function collect(node, out) {
  if (skipped(node)) return;
  if (childElements(node) > 0 && markupSafe(node)) {
    const t = norm(textContent(node));
    const h = norm(innerHtml(node));
    const hit = lookup(t) != null || lookup(h) != null;
    if (CJK.test(t)) out.push({ kind: 'EL', key: t, html: h, tag: node.tag, covered: hit });
    if (hit) return;                                       // 整块替换：不再下沉
  }
  for (const c of node.children) {
    if (c.tag === '#text') {
      const key = norm(c.text);
      if (CJK.test(key)) out.push({ kind: 'TXT', key, tag: node.tag });
      continue;
    }
    collect(c, out);
  }
}

/* ---------------- ① HTML ---------------- */

const HTML_FILES = ['index.html', 'public/launcher.html'];
const htmlMissing = [];
const htmlTotal = new Set();

for (const rel of HTML_FILES) {
  const src = readFileSync(new URL('../' + rel, import.meta.url), 'utf8');
  const tree = parseHtml(src);
  const body = (function find(n) {
    if (n.tag === 'body') return n;
    for (const c of n.children) { const r = find(c); if (r) return r; }
    return null;
  })(tree);
  if (!body) { console.log(`!! ${rel} 里没找到 <body>`); continue; }
  const units = [];
  collect(body, units);
  for (const u of units) {
    htmlTotal.add(u.key);
    if (!u.covered && lookup(u.key) == null) htmlMissing.push({ file: rel, ...u });
  }
}

/* ---------------- ② JS 字符串字面量 ---------------- */

const JS_FILES = [
  'src/hud.js', 'src/settings.js', 'src/result.js', 'src/duo-ui.js', 'src/help.js',
  'src/confirm.js', 'src/quality.js', 'src/quality-ui.js', 'src/modes.js', 'src/rules.js',
  'src/duo.js', 'src/mobile.js', 'src/combo.js', 'src/ai.js', 'src/main.js', 'src/prefs.js',
  'public/launcher.js', 'public/launcher-quality.js', 'public/launcher-audio.js', 'public/history.js',
];
const jsMissing = [];
const jsTotal = new Set();
const tplFragments = new Set();          // 模板字符串的碎片：靠规则在运行时拼，不进硬门槛

for (const rel of JS_FILES) {
  const src = readFileSync(new URL('../' + rel, import.meta.url), 'utf8');
  let ast;
  try { ast = parse(src, { ecmaVersion: 'latest', sourceType: 'module', allowHashBang: true }); }
  catch (e) { console.log(`!! ${rel} 解析失败：${e.message}`); continue; }
  const found = new Set();
  const tpl = new Set();
  const frag = new WeakSet();            // 被 + 号或 ${} 拼起来的字面量：天然不是完整句子
  (function markFrag(n, inFrag) {
    if (!n || typeof n.type !== 'string') return;
    if (n.type === 'BinaryExpression' && n.operator === '+') { markFrag(n.left, true); markFrag(n.right, true); return; }
    if (n.type === 'TemplateLiteral') {
      n.quasis.forEach((q) => markFrag(q, true));
      n.expressions.forEach((e) => markFrag(e, true));
      return;
    }
    if (n.type === 'Literal' || n.type === 'TemplateElement') { if (inFrag) frag.add(n); return; }
    for (const k of Object.keys(n)) {
      const v = n[k];
      if (Array.isArray(v)) v.forEach((c) => markFrag(c, inFrag));
      else if (v && typeof v.type === 'string') markFrag(v, inFrag);
    }
  })(ast, false);
  (function visit(n) {
    if (!n || typeof n.type !== 'string') return;
    if (n.type === 'Literal' && typeof n.value === 'string' && CJK.test(n.value)) {
      (frag.has(n) ? tpl : found).add(n.value);
    }
    if (n.type === 'TemplateElement' && CJK.test(n.value.cooked || n.value.raw)) {
      tpl.add(n.value.cooked || n.value.raw);
      found.add(n.value.cooked || n.value.raw);
    }
    for (const k of Object.keys(n)) {
      const v = n[k];
      if (Array.isArray(v)) v.forEach(visit);
      else if (v && typeof v.type === 'string') visit(v);
    }
  })(ast);
  for (const s of found) {
    /* ① 含 < 的是 innerHTML 片段：里面的文本节点会被逐个翻，整串不需要进词表
       ② 模板字符串的碎片（`玩家${n}打进黑八` 这类）只可能被正则规则接住，
          单独列出来供人工核对；运行时到底翻没翻，由 test/browser-i18n.mjs 扫真页面兜底 */
    if (s.indexOf('<') >= 0) { tplFragments.add(s); continue; }
    if (tpl.has(s)) { tplFragments.add(s); continue; }   // 模板碎片：天然不是完整句子
    jsTotal.add(s);
    if (lookup(s) == null) jsMissing.push({ file: rel, key: s });
  }
}

/* ---------------- 报告 ---------------- */

const show = (title, list) => {
  if (!list.length) return;
  const seen = new Set();
  const uniq = list.filter((x) => (seen.has(x.key) ? false : seen.add(x.key)));
  console.log(`\n===== ${title}（唯一的 ${uniq.length} 条）=====`);
  for (const x of uniq) {
    console.log(`--- ${x.file} [${x.kind || 'JS'}] ${x.kind === 'TXT' ? '<' + x.tag + '>' : ''}`);
    console.log(x.key);
    if (x.html && x.html !== x.key) console.log('  html: ' + x.html.replace(/\s+/g, ' ').slice(0, 160));
  }
};

console.log(`词表：${Object.keys(DICT).length} 条精确 + ${RULES.length} 条规则`);
console.log(`HTML：${htmlTotal.size} 个单元，缺 ${htmlMissing.length}`);
console.log(`JS  ：${jsTotal.size} 条字面量，缺 ${jsMissing.length}` +
  `（另有 ${tplFragments.size} 条 innerHTML / 模板碎片，由运行时规则接住，见 browser-i18n）`);

show('HTML 缺失', htmlMissing);
show('JS 缺失', jsMissing);

if (htmlMissing.length || jsMissing.length) process.exitCode = 1;
