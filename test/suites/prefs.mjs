/**
 * 启动配置（src/prefs.js）的纯逻辑测试。
 * ------------------------------------------------------------------
 * 这个模块以前**完全没被测过** —— 测试只用 readFileSync 把它当文本比对 key，
 * 所以 0.7.0 之前 `persistFromGame()` 里那个未声明的 `saveTimer` 一直没人发现：
 * 拖力度滑块 / 切操作模式时会抛 ReferenceError，设置静默不落盘。
 *
 * 这里的断言刻意打"行为"而不是"实现"：
 *   · 调用不抛错（回归 saveTimer）
 *   · 越界 / 脏数据一律收敛成合法值
 *   · 力度区间的最小间隙
 *   · ghost 只认 'off'，其余全按开处理
 *   · 双人规则写坏了回落默认
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { check } from '../lib/harness.mjs';
import {
  DEFAULT_PREFS, sanitizePrefs, persistFromGame, patchPrefs, readPrefs, sanitizeName,
} from '../../src/prefs.js';
import { SHOT } from '../../src/constants.js';
import { DUO_RULE_DEFAULTS } from '../../src/duo.js';

const HERE = dirname(fileURLToPath(import.meta.url));

export function testPrefsModule() {
  console.log('\n[prefs] 启动配置：持久化调用、清洗、镜像');

  /* ---- 1) persistFromGame 不再抛错（0.7.0 回归） ---- */
  let err = null;
  try {
    persistFromGame('top', DEFAULT_PREFS.balls);
    persistFromGame('tracking', DEFAULT_PREFS.balls);
  } catch (e) {
    err = e;
  }
  check(!err, 'persistFromGame 不抛错（saveTimer 已声明）', err ? String(err.message || err) : '');

  /* ---- 2) 力度区间：越界收敛 + 最小间隙 ---- */
  const lo = sanitizePrefs({ min: -5, max: 99 });
  check(lo.min === 0.05 && lo.max === 1.5, '力度区间越界被夹回 [0.05, 1.00]/[0.10, 1.50]',
    `min=${lo.min} max=${lo.max}`);

  const gap = sanitizePrefs({ min: 0.5, max: 0.51 });
  check(gap.max >= gap.min + 0.05 - 1e-9, '最小力度与最大力度之间至少留 0.05',
    `min=${gap.min} max=${gap.max}`);

  const nan = sanitizePrefs({ min: 'abc', max: null });
  check(nan.min === DEFAULT_PREFS.min && nan.max === DEFAULT_PREFS.max, 'NaN / null 回落到默认值',
    `min=${nan.min} max=${nan.max}`);

  /* ---- 3) 枚举：写坏一律回落 ---- */
  const bad = sanitizePrefs({ mode: 'nope', game: 'nope', diff: 'nope', balls: 'nope' });
  check(bad.mode === DEFAULT_PREFS.mode && bad.game === DEFAULT_PREFS.game
    && bad.diff === DEFAULT_PREFS.diff && bad.balls === DEFAULT_PREFS.balls,
    '操作模式 / 玩法 / 难度 / 球组 写坏都回落默认',
    `${bad.mode}/${bad.game}/${bad.diff}/${bad.balls}`);

  /* ---- 4) ghost：只有 'off' 是关 ---- */
  check(sanitizePrefs({ ghost: 'off' }).ghost === 'off', "ghost='off' 才是关");
  for (const v of ['on', 'maybe', '', null, 0, undefined]) {
    check(sanitizePrefs({ ghost: v }).ghost === 'on', `ghost=${JSON.stringify(v)} 一律按开`,
      `实际 ${sanitizePrefs({ ghost: v }).ghost}`);
  }

  /* ---- 5) 双人规则：写坏回落默认 ---- */
  const rules = sanitizePrefs({ breakAssign: 'x', breakEight: 'y', cueFoul: 'z', earlyEight: 'w' });
  const okRules = Object.keys(DUO_RULE_DEFAULTS).every((k) => rules[k] === DUO_RULE_DEFAULTS[k]);
  check(okRules, '四项双人规则写坏后全部回落默认', JSON.stringify(
    Object.fromEntries(Object.keys(DUO_RULE_DEFAULTS).map((k) => [k, rules[k]]))));

  /* ---- 6) 名字：空 / 超长 / 非字符串 ---- */
  check(sanitizeName('').length > 0 && sanitizeName(null).length > 0, '空名字会用默认名');
  check(sanitizeName('一二三四五六七八九十十一十二十三').length === 12, '名字最多 12 字',
    `实际 ${sanitizeName('一二三四五六七八九十十一十二十三').length}`);

  /* ---- 7) patchPrefs 只改传进去的项（别把别的规则冲掉） ---- */
  const before = readPrefs();
  const patched = patchPrefs({ min: before.min });
  check(patched.max === before.max && patched.breakEight === before.breakEight,
    'patchPrefs 不会顺手把没传的项清成默认值',
    `max ${before.max}→${patched.max} · breakEight ${before.breakEight}→${patched.breakEight}`);

  /* ---- 8) 镜像：public/launcher.js 的 DEFAULTS 必须与 DEFAULT_PREFS 同值 ----
     启动器是独立静态页（不能 import src），只能读文本比对；
     0.7.0 起至少把"默认值"也比一遍，不再只比 key。 */
  const src = readFileSync(join(HERE, '../../public/launcher.js'), 'utf8');
  const block = (src.match(/(?:const|var|let) DEFAULTS = \{[\s\S]*?\n\s*\};/) || [''])[0];
  check(block.length > 0, '能定位到启动器的 DEFAULTS 块');
  const missing = [];
  const valueMismatch = [];
  for (const [k, v] of Object.entries(DEFAULT_PREFS)) {
    const m = block.match(new RegExp(`${k}\\s*:\\s*([^,\\n]+)`));
    if (!m) { missing.push(k); continue; }
    const raw = m[1].trim().replace(/^['"]|['"]$/g, '');
    const got = raw === 'true' ? true : raw === 'false' ? false
      : Number.isFinite(Number(raw)) && raw !== '' ? Number(raw) : raw;
    if (String(got) !== String(v)) valueMismatch.push(`${k}: src=${v} public=${got}`);
  }
  check(missing.length === 0, '启动器 DEFAULTS 覆盖了 src 的全部 key', missing.join(', '));
  check(valueMismatch.length === 0, '启动器 DEFAULTS 的默认值与 src 一致', valueMismatch.join(' · '));

  /* ---- 9) 力度区间被 applyPowerRange 灌进 SHOT 后仍然是同一份数 ---- */
  check(SHOT.minImpulse >= 0.05 && SHOT.maxImpulse <= 1.5, 'SHOT 的力度区间在合法范围内',
    `${SHOT.minImpulse}~${SHOT.maxImpulse}`);
}
