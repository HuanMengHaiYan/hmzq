/**
 * 启动器路由结构（静态分析 · 不需要浏览器）
 * ------------------------------------------------------------------
 * 启动器是 public/ 下的经典脚本页面，拼的是 HTML + 手写路由，没有任何打包器或框架
 * 帮我们校验 —— "data-go 指向的页面不存在"、"三层路由忘了写 data-parent 导致返回键失效"
 * 这类错误在页面上表现为"点了没反应"，肉眼很难看清。
 *
 * 所以这里直接读 HTML 文本，把路由树抽出来做断言：
 *   · 每一条 data-go / data-parent 都指向真实存在的页面（无死链）
 *   · 父链不成环，且每个子页最终都能回到某个一级页
 *   · 每一张页面都能从一级菜单走到（没有孤页面）
 *   · JS 里 getElementById 用到的 id，HTML 里都得有（搬界面最容易漏的那类）
 *   · id 全局唯一（把设置项拆成四个二级页时，最容易手滑复制出重复 id）
 *
 * 它不覆盖"点下去真的会切页"，那部分交给 test/browser-solo.mjs 在真浏览器里走一遍。
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { check } from '../lib/harness.mjs';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const HTML_PATH = ROOT + 'public/launcher.html';

/** 取标签里某个属性的值（没写就返回 ''） */
function attr(tag, name) {
  const m = tag.match(new RegExp(name + '="([^"]*)"'));
  return m ? m[1] : '';
}

/** 把一段 HTML 里的所有 <button ...> 开标签抽出来 */
function buttonsIn(src) {
  const out = [];
  const re = /<button\b[^>]*>/g;
  let m;
  while ((m = re.exec(src))) out.push(m[0]);
  return out;
}

export function testLauncherRoutes() {
  console.log('\n[45] 启动器 · 多级子路由与页面树');

  const html = readFileSync(HTML_PATH, 'utf8');

  /* ---- 抽出来：一级菜单项 / 所有页面 / 页面里的按钮 ---- */
  const mainStart = html.indexOf('<main');
  const menuStart = html.indexOf('<nav class="menu');
  const menuBtns = buttonsIn(html.slice(menuStart, mainStart))
    .map((t) => ({ go: attr(t, 'data-go') }))
    .filter((b) => b.go);

  const sectionTags = [];
  const secRe = /<section\b[^>]*>/g;
  let m;
  while ((m = secRe.exec(html))) sectionTags.push({ index: m.index, tag: m[0] });

  const pages = sectionTags.map((s, i) => {
    const end = i + 1 < sectionTags.length ? sectionTags[i + 1].index : html.length;
    const body = html.slice(s.index, end);
    return {
      route: attr(s.tag, 'data-page'),
      parent: attr(s.tag, 'data-parent'),
      on: /class="[^"]*\bon\b/.test(s.tag),
      body,
      btns: buttonsIn(body),
    };
  });
  const byRoute = new Map(pages.map((p) => [p.route, p]));

  /* ---- 1. 一级菜单 ---- */
  const menuRoutes = menuBtns.map((b) => b.go);
  check(menuRoutes.length >= 6, '一级菜单有 6 项以上（常规 / 娱乐 / 历史 / 设置 / 帮助 / 关于 / 退出）',
    menuRoutes.join(' · '));
  check(menuRoutes.every((r) => byRoute.has(r)), '每个一级菜单项都有对应页面',
    menuRoutes.filter((r) => !byRoute.has(r)).join(',') || '全部命中');
  check(menuRoutes.every((r) => !byRoute.get(r).parent), '一级菜单项指向的都是一级页（自己没有父页）');
  check(menuRoutes.indexOf('fun') === 1, '「娱乐模式」紧跟在「常规模式」下面');
  check(menuRoutes.indexOf('rules') < 0, '一级菜单里不再有单独的「规则设置」');
  check(menuRoutes.indexOf('settings') >= 0, '「游戏设置」还是一级菜单');

  /* ---- 2. 所有 data-go 都不落空（页面里那些 → 按钮也一起查） ---- */
  const dead = [];
  for (const p of pages) {
    for (const b of p.btns) {
      const go = attr(b, 'data-go');
      if (go && !byRoute.has(go)) dead.push(p.route + ' → ' + go);
    }
  }
  check(dead.length === 0, '页面里的每一个导航按钮都指向存在的路由（无死链）', dead.join(', ') || '全部有效');

  /* ---- 3. 父链：不成环、层级深度符合预期 ---- */
  const badParent = pages.filter((p) => p.parent && !byRoute.has(p.parent))
    .map((p) => p.route + ' 的父页 ' + p.parent);
  check(badParent.length === 0, '每个 data-parent 都指向存在的页面', badParent.join(', ') || '全部有效');

  const cycle = [];
  for (const p of pages) {
    const seen = new Set([p.route]);
    let q = p;
    let guard = 0;
    while (q && q.parent && guard++ < 16) {
      if (seen.has(q.parent)) { cycle.push(p.route); break; }
      seen.add(q.parent);
      q = byRoute.get(q.parent);
    }
    if (guard >= 16) cycle.push(p.route + '（爬不到顶）');
  }
  check(cycle.length === 0, '父子链不成环、能爬回一级页', cycle.join(', ') || `${pages.length} 个页面都正常`);

  function depthOf(route) { return route.split('/').length; }
  const depthMiss = pages.filter((p) => {
    const d = depthOf(p.route);
    if (d === 1) return !!p.parent;                       // 一级页不该有父页
    return p.parent !== p.route.split('/').slice(0, -1).join('/');   // 子页父名 = 去掉最后一段
  }).map((p) => p.route);
  check(depthMiss.length === 0, '路由名的层级与 data-parent 一致（"a/b/c" 的父必须是 "a/b"）',
    depthMiss.join(', ') || '完全一致');

  /* ---- 4. 没有孤页面：从一级菜单一路点下去能走到所有页面 ---- */
  const seen = new Set(menuRoutes);
  let grew = true;
  while (grew) {
    grew = false;
    for (const r of Array.from(seen)) {
      const p = byRoute.get(r);
      if (!p) continue;
      for (const b of p.btns) {
        const go = attr(b, 'data-go');
        if (go && !seen.has(go)) { seen.add(go); grew = true; }
      }
    }
  }
  const orphan = pages.map((p) => p.route).filter((r) => !seen.has(r));
  check(orphan.length === 0, '没有点不到的孤页面', orphan.join(', ') || `${seen.size} 个页面都能到达`);

  /* ---- 5. 子页面都有"回来"的入口 ---- */
  const noBack = pages.filter((p) => p.parent && !p.btns.some((b) => /data-up\b/.test(b)))
    .map((p) => p.route);
  check(noBack.length === 0, '每个子页都有返回上一级的入口（面包屑 data-up）', noBack.join(', ') || '都有');

  /* ---- 6. 层级分工：选玩法页不含难度，难度页只出一种玩法 ---- */
  /* 页面上真正的选项 = 导航 / 进游戏 / 占位三类；面包屑（data-up）不算一个可选项 */
  const pageLinks = (route) => {
    const p = byRoute.get(route);
    if (!p) return [];
    return p.btns
      .filter((b) => /data-up\b/.test(b) === false)
      .map((b) => ({
        go: attr(b, 'data-go'), game: attr(b, 'data-enter-game'),
        diff: attr(b, 'data-diff'), soon: attr(b, 'data-soon'),
      }));
  };

  const solo = pageLinks('start/solo');
  check(solo.length === 3 && solo.every((b) => !b.diff),
    '「单人模式」页只列三种玩法，不带难度', `${solo.length} 项`);
  check(solo.filter((b) => b.go).length === 2 && solo.filter((b) => b.game === 'score').length === 1,
    '计分模式直接进入，限次 / 计时各自再进一层选难度');

  for (const route of ['start/solo/limit', 'start/solo/timed']) {
    const want = route.split('/').pop();
    const links = pageLinks(route);
    const games = new Set(links.map((b) => b.game).filter(Boolean));
    const diffs = links.map((b) => b.diff).filter(Boolean).sort().join(',');
    check(games.size === 1 && games.has(want), `${route}：这一页只出「${want}」一种玩法`);
    check(diffs === 'easy,hard,normal', `${route}：三档难度齐了`, diffs || '缺');
  }

  /* 难度不与其它选项同屏：带 data-diff 的那一页必须"只有一种玩法的三档难度"，
     不能再挂跳转子页 / 别的玩法 / 占位按钮。
     （人机对战只有一种玩法，所以它的难度页就在第二层；限次 / 计时上面还有一层"选模式"，故在第三层。） */
  const strayDiff = pages.filter((p) => {
    const links = pageLinks(p.route);
    if (!links.some((b) => b.diff)) return false;                       // 不是难度页
    const games = new Set(links.map((b) => b.game).filter(Boolean));
    if (games.size !== 1) return true;                                  // 混了第二种玩法
    return links.some((b) => b.go || b.soon);                           // 混了跳转 / 占位
  }).map((p) => p.route);
  check(strayDiff.length === 0, '难度页不与「选模式」同屏（一屏只出一种玩法的难度档）',
    strayDiff.join(', ') || '干净');

  const diffIds = (r) => (byRoute.get(r)?.btns || [])
    .filter((b) => attr(b, 'data-diff')).map((b) => attr(b, 'data-diff'));
  const diffPages = pages.filter((p) => pageLinks(p.route).some((b) => b.diff)).map((p) => p.route);
  // 限次 / 计时三档，人机四档（多了「极难」）—— 都至少含 简单 / 中等 / 困难
  check(diffPages.every((r) => {
    const ids = diffIds(r);
    return ids.length >= 3 && ['easy', 'normal', 'hard'].every((d) => ids.includes(d));
  }), '每张难度页至少三档、且含 简单/中等/困难', diffPages.join(', ') || '无');
  check(diffIds('start/ai').sort().join(',') === 'easy,extreme,hard,normal',
    '人机难度页四档齐全（含极难）', diffIds('start/ai').join(',') || '缺');

  /* ---- 7. 娱乐模式：自由球挂在 fun 下，且能真的进球台 ---- */
  const fun = byRoute.get('fun');
  check(!!fun && attr((fun.btns.find((b) => attr(b, 'data-go') === 'fun/freeball') || ''), 'data-go') === 'fun/freeball',
    '娱乐模式首页能进到自由球玩法页');
  const fb = byRoute.get('fun/freeball');
  check(!!fb && fb.parent === 'fun', '自由球页挂在「娱乐模式」下');
  check(!!fb && fb.btns.some((b) => attr(b, 'data-enter-game') === 'freeball'),
    '自由球页上有「进入球台」按钮');
  const freeCount = fun.btns.filter((b) => attr(b, 'data-soon')).length;
  check(freeCount >= 3, '娱乐模式留了 3 个以上的占位，后面加玩法不用重排版面', `${freeCount} 个占位`);

  /* ---- 8. 游戏设置 = 四个二级页，规则设置搬进来了 ---- */
  const setLinks = pageLinks('settings');
  const setSubs = setLinks.map((b) => b.go).filter(Boolean);
  check(setSubs.length === 4, '「游戏设置」首页正好四个分类入口', setSubs.join(', '));
  check(setSubs.join(',') === 'settings/game,settings/audio,settings/quality,settings/rules',
    '四个入口的顺序是 游戏 / 声音 / 画质 / 规则');
  check(pageLinks('settings/rules').length >= 0 && !!byRoute.get('settings/rules')
    && byRoute.get('settings/rules').parent === 'settings', '规则设置变成了设置的二级页');
  // 0.7.0（体检 G4）：规则页拆成"单人 / 双人"两个三级页
  check(pageLinks('settings/rules').map((b) => b.go).join(',')
    === 'settings/rules/solo,settings/rules/duo', '规则设置首页正好两张卡：单人 / 双人');
  check(!!byRoute.get('settings/rules/solo')
    && byRoute.get('settings/rules/solo').parent === 'settings/rules'
    && byRoute.get('settings/rules/solo').body.includes('id="p-balls"'),
    '单人规则三级页里带着球体设置那一组');
  check(!!byRoute.get('settings/rules/duo')
    && byRoute.get('settings/rules/duo').parent === 'settings/rules'
    && byRoute.get('settings/rules/duo').body.includes('id="p-duo-rules"')
    && byRoute.get('settings/rules/duo').body.includes('id="p-foul-rules"'),
    '双人规则三级页里带着分组判罚与犯规罚则两组');
  check(!!byRoute.get('settings/game').body.includes('id="p-name"'),
    '游戏设置二级页里带着玩家名称 / 力度那一组');
  check(!!byRoute.get('settings/audio').body.includes('id="p-sfx"'),
    '声音设置二级页独立成页');
  check(!!byRoute.get('settings/quality').body.includes('id="p-quality"'),
    '画质设置二级页独立成页');

  /* ---- 9. id 唯一 + JS 里引用的 id 都存在 ---- */
  const ids = (html.match(/\sid="([^"]+)"/g) || []).map((s) => s.slice(5, -1));
  const dupIds = [];
  const idSet = new Set();
  for (const id of ids) {
    if (idSet.has(id)) dup.ids.push(id);
    idSet.add(id);
  }
  check(dupIds.length === 0, 'launcher.html 里没有重复 id（拆四个二级页最容易手滑）',
    dupIds.join(', ') || `${idSet.size} 个 id 都唯一`);

  /* ---- 9b. 设置项的镜像同步 ----
     src/prefs.js 的 DEFAULT_PREFS 与 public/launcher.js 的 DEFAULTS 是**两份手写副本**
     （启动器是独立页面，不能 import 源码）。加设置项时只改一边，另一边会静默用默认值 ——
     表现是"在游戏里改了设置，下次从启动器进来又变回去了"，很难联想到是这里漏了。 */
  const prefsSrc = readFileSync(ROOT + 'src/prefs.js', 'utf8');
  const launchSrc = readFileSync(ROOT + 'public/launcher.js', 'utf8');
  const blockOf = (src, re) => (src.match(re) || [, ''])[1];
  // 先去掉注释行（注释里的中文冒号会混进来），再取 `key:` —— 一行写了多个字段也要都能抓到
  const keysIn = (block) => [...block.split('\n')
    .filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l)).join('\n')
    .matchAll(/([a-zA-Z]\w*)\s*:/g)].map((m) => m[1]);
  const srcKeys = keysIn(blockOf(prefsSrc, /export const DEFAULT_PREFS = \{([\s\S]*?)\n\};/));
  const mirKeys = keysIn(blockOf(launchSrc, /var DEFAULTS = \{([\s\S]*?)\n  \};/));
  const notMirrored = srcKeys.filter((k) => !mirKeys.includes(k));
  check(srcKeys.length >= 7 && notMirrored.length === 0,
    'src/prefs.js 的每个设置项在启动器里都有镜像（含半透明开关 ghost）',
    notMirrored.length ? `没同步：${notMirrored.join(',')}` : `${srcKeys.length} 项全部同步`);

  const jsFiles = ['public/launcher.js', 'public/launcher-audio.js', 'public/launcher-quality.js'];
  const missing = [];
  for (const f of jsFiles) {
    const src = readFileSync(ROOT + f, 'utf8');
    const re = /getElementById\('([^']+)'\)/g;
    let mm;
    while ((mm = re.exec(src))) {
      if (!idSet.has(mm[1])) missing.push(f + ':#' + mm[1]);
    }
  }
  check(missing.length === 0, '三个脚本里 getElementById 的 id 在 HTML 里都存在',
    missing.join(', ') || '全部命中');

  /* ---- 10. 初始显示 / 旧的折叠结构已经拆干净 ---- */
  const onPages = pages.filter((p) => p.on).map((p) => p.route);
  check(onPages.length === 1 && onPages[0] === 'start', '首屏默认停在「常规模式」且只有一页是打开的',
    onPages.join(','));
  check(!/data-expand=/.test(html), '旧的"就地展开"（data-expand）已经全部换成子路由');
  check(!/id="sub-/.test(html), '旧的 sub-* 折叠容器已经删干净');

  /* ---- 11. 游戏名与「关于」页 ---- */
  check(/<title>幻梦-星光桌球<\/title>/.test(html), '标题是「幻梦-星光桌球」');
  check(/<h1>幻梦-星光桌球<\/h1>/.test(html), '左上角品牌名同步改成了「幻梦-星光桌球」');
  const about = byRoute.get('about');
  check(!!about && /幻梦-星光桌球/.test(about.body), '关于页的大 logo 用新名字');
  check(!!about && /幻梦-拾光回廊工作室/.test(about.body), '关于页写上了制作人「幻梦-拾光回廊工作室」');
  check(!!about && /WorkBuddy/.test(about.body), '关于页标注了使用 WorkBuddy 开发');
  check(!!about && /id="qr-box"/.test(about.body) && /微信/.test(about.body),
    '关于页留了联系方式与二维码位');
  check(!!about && /幻梦系列/.test(about.body), '关于页点明了「幻梦」是系列名');
}
