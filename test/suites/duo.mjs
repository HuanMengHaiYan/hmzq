import { check } from '../lib/harness.mjs';
import {
  DuoMatch, DUO_RULE_DEFAULTS, DUO_RULE_TABLES, LOW_NUMBERS, HIGH_NUMBERS, EIGHT,
  groupOf, groupName, groupRange, other, sanitizeDuoRules,
} from '../../src/duo.js';

/**
 * 本地双人模式 · 规则引擎（纯逻辑）
 * ------------------------------------------------------------------
 * 守的是"用户定下的那几条判定"本身，而不是某次实现：
 *   ① 开球那一杆的三种结局（重来 / 定组 / 不分组但续杆）
 *   ② 分组一旦定下就锁死（本局内不会翻）
 *   ③ 只进了对方的球 = 不续杆；进自己的球 = 续杆
 *   ④ 进黑八分两条规则，互不串台：
 *      未分组 → breakEight（重来 / 归位换人 / 判负）；已分组 → earlyEight（判负 / 罚一颗）
 *   ⑤ 白球落袋 → 换人（自由摆球 / 回开球点）
 *   ⑥ 清完自己的球再打黑八 = 获胜
 */

/** 造一个对局，并可选地预置"已经进袋的球" */
function match(rules, potted = []) {
  const m = new DuoMatch(rules);
  return { m, potted };
}

/** 打一杆：登记落袋（按传入顺序）→ 结算 */
function shot(m, potted, numbers, { cue = false, player = null } = {}) {
  m.beginShot();
  if (player) m.turn = player;
  for (const n of numbers) {
    m.onPot(n);
    if (!potted.includes(n)) potted.push(n);
  }
  if (cue) m.markCuePot();
  return m.resolveShot(potted);
}

export function testDuoGroups() {
  console.log('\n[46] 本地双人 · 球组与基础判定');

  check(groupOf(1) === 'low' && groupOf(7) === 'low', '1~7 是小号', `1→${groupOf(1)} 7→${groupOf(7)}`);
  check(groupOf(9) === 'high' && groupOf(15) === 'high', '9~15 是大号', `9→${groupOf(9)} 15→${groupOf(15)}`);
  check(groupOf(8) === 'eight', '8 号是决胜球', String(groupOf(8)));
  check(groupOf(0) === null && groupOf(16) === null, '白球与非法号不归任何组');
  check(LOW_NUMBERS.length === 7 && HIGH_NUMBERS.length === 7, '两组各 7 颗', `${LOW_NUMBERS.length} / ${HIGH_NUMBERS.length}`);
  check(groupName('low') === '小号' && groupRange('high') === '9~15', '组别名与区间文案');
  check(other(1) === 2 && other(2) === 1, '换人就是 1↔2');

  // 规则值收拾：写坏的 / 缺的都要落回默认
  const bad = sanitizeDuoRules({
    breakAssign: 'zzz', breakEight: 42, cueFoul: null, earlyEight: 'nope',
  });
  check(bad.breakAssign === 'never' && bad.breakEight === 'rerack'
    && bad.cueFoul === 'ballInHand' && bad.earlyEight === 'lose',
  '非法规则值一律回落到默认', JSON.stringify(bad));
  check(sanitizeDuoRules().earlyEight === DUO_RULE_DEFAULTS.earlyEight, '不传就是默认');
  // 默认值口径（改这里 = 改了规则设置页的默认项，README 与启动器镜像要一起动）
  check(DUO_RULE_DEFAULTS.breakAssign === 'never' && DUO_RULE_DEFAULTS.breakEight === 'rerack'
    && DUO_RULE_DEFAULTS.cueFoul === 'ballInHand' && DUO_RULE_DEFAULTS.earlyEight === 'lose',
  '四项规则的默认值：不分球 / 本局重来 / 自由摆球 / 提前黑八判负', JSON.stringify(DUO_RULE_DEFAULTS));
  check(Object.keys(DUO_RULE_TABLES).join(',')
    === 'breakAssign,breakEight,cueFoul,earlyEight,foulMiss,foulWrongBall,foulNoPot',
  '七项规则都在设置表里（启动器要照这张表生成选项；后三项是 0.7.0 的犯规罚则）');
}

export function testDuoBreak() {
  console.log('\n[47] 本地双人 · 开球那一杆');

  // ① 开球进黑八 → 整个球局重来
  {
    const m = new DuoMatch();
    const potted = [];
    const r = shot(m, potted, [8, 3]);
    check(r.outcome === 'rerack', '开球进黑八 → 本局重来', r.outcome);
    check(m.shot === 0 && m.turn === 1 && m.open, '重来后杆数归零、回到玩家1、台面重新开放',
      `shot=${m.shot} turn=${m.turn}`);
    check(/重来/.test(r.note), '有明确的提示文案', r.note);
  }

  // ② 只进 1 颗（默认规则）→ 不分组，但开球方继续打
  {
    const m = new DuoMatch();
    const potted = [];
    const r = shot(m, potted, [3]);
    check(r.outcome === 'continue' && r.next === 1, '开球进 1 颗：不分组，开球方继续', `${r.outcome}/${r.next}`);
    check(m.open, '默认规则下开球进 1 颗不定组');
  }

  // ③ 只进 1 颗 + 规则改成"进 1 颗也判定" → 分组，继续打
  {
    const m = new DuoMatch({ breakAssign: 'always' });
    const potted = [];
    const r = shot(m, potted, [11]);
    check(!m.open && m.groups[1] === 'high' && m.groups[2] === 'low',
      '规则改成 always：开球进 1 颗就定组（玩家1 大号 / 玩家2 小号）',
      JSON.stringify(m.groups));
    check(r.outcome === 'continue' && r.next === 1, '定组的那一杆仍然由击球方继续', r.outcome);
  }

  // ④ 进 2 颗及以上 → 无论如何都判定分组，按**第一颗**落袋的球定组
  {
    const m = new DuoMatch();                 // 默认 never
    const potted = [];
    const r = shot(m, potted, [12, 2]);       // 先大号后小号
    check(m.groups[1] === 'high' && m.groups[2] === 'low',
      '开球进 2 颗 → 强制分组，按第一颗（12 号）定组', JSON.stringify(m.groups));
    check(r.assigned && r.assigned[1] === 'high', '返回值带上"本杆刚定了组"', JSON.stringify(r.assigned));
  }
  {
    const m = new DuoMatch();
    const potted = [];
    shot(m, potted, [4, 10]);                 // 先小号后大号
    check(m.groups[1] === 'low', '顺序反过来看第一颗（4 号）→ 玩家1 小号', String(m.groups[1]));
  }

  // ⑤ 开球空杆 → 换人
  {
    const m = new DuoMatch();
    const potted = [];
    const r = shot(m, potted, []);
    check(r.outcome === 'switch' && m.turn === 2, '开球空杆 → 换玩家2', `${r.outcome}/${m.turn}`);
  }
}

export function testDuoAssign() {
  console.log('\n[48] 本地双人 · 第二杆起定组与续杆');

  // 第二杆：谁先打进哪组，谁就打哪组
  {
    const m = new DuoMatch();
    const potted = [];
    shot(m, potted, []);                       // 开球空杆 → 换玩家2
    const r = shot(m, potted, [13]);           // 玩家2 打进大号
    check(m.groups[2] === 'high' && m.groups[1] === 'low',
      '玩家2 先打进大号 → 玩家2 大号、玩家1 小号', JSON.stringify(m.groups));
    check(r.outcome === 'continue' && r.next === 2, '定组那一杆继续打', `${r.outcome}/${r.next}`);
  }

  // 进了自己的球 → 续杆；只进对方的球 → 换人（两个方向都验）
  {
    const m = new DuoMatch();
    const potted = [];
    shot(m, potted, []);
    shot(m, potted, [2]);                      // 玩家2 打进小号 → 玩家2 小号
    check(m.groups[2] === 'low', '玩家2 小号', String(m.groups[2]));
    const keep = shot(m, potted, [5]);         // 玩家2 再进小号（自己的）
    check(keep.outcome === 'continue' && m.turn === 2, '进了自己的球 → 继续打', `${keep.outcome}/${m.turn}`);
    const pass = shot(m, potted, [10]);        // 玩家2 只进大号（对方的）
    check(pass.outcome === 'switch' && m.turn === 1, '只进了对方的球 → 换人', `${pass.outcome}/${m.turn}`);
    check(/对方/.test(pass.note), '提示写明是"进了对方的球"', pass.note);
  }

  // 分组一旦定下就锁死：之后无论进什么组都不会翻
  {
    const m = new DuoMatch();
    const potted = [];
    shot(m, potted, [12, 2]);                  // 玩家1 大号
    for (const n of [1, 3, 5]) shot(m, potted, [n], { player: 1 });   // 玩家1 连着打进小号
    check(m.groups[1] === 'high' && m.groups[2] === 'low',
      '定组之后不会因为打进对方的球而改组', JSON.stringify(m.groups));
  }

  // 剩余球数：对手误打进的、开球进的，都算进"自己的进度"
  {
    const m = new DuoMatch();
    const potted = [];
    shot(m, potted, [9, 10]);                  // 开球进两颗大号 → 玩家1 大号
    shot(m, potted, [11], { player: 2 });      // 玩家2 误打进大号
    check(m.remaining(1, potted) === 4 && m.remaining(2, potted) === 7,
      '对手误打进的球算进对方的清台进度（玩家1 只剩 4 颗）',
      `P1剩${m.remaining(1, potted)} P2剩${m.remaining(2, potted)}`);
  }
}

export function testDuoEarlyEight() {
  console.log('\n[49] 本地双人 · 已分组后提前打进黑八（两套规则）');
  // ⚠️ 这一段全部要先"分好组"：没分组就打进黑八走的是另一条规则（见 [53]）。

  // ① 罚球规则：罚一颗已进的球 + 黑八，都回位，然后换人
  {
    const m = new DuoMatch({ earlyEight: 'penalty' });
    const potted = [];
    shot(m, potted, [9, 10]);                  // 开球进两颗大号 → 玩家1 大号
    const r = shot(m, potted, [8]);            // 玩家1 提前打进黑八
    check(r.outcome === 'penalty', '提前打黑八 → 罚球', r.outcome);
    check(r.respot && r.respot.length === 2 && r.respot.includes(8),
      '要摆回的球：黑八 + 罚掉的那颗', JSON.stringify(r.respot));
    check(r.respot[1] === 10, '罚的是"已经打进的最后一颗"（10 号）', String(r.respot[1]));
    check(m.turn === 2, '罚完换人', String(m.turn));
    check(!m.over, '罚球不结束本局');
    // 调用方按 respot 摘掉这两颗之后，进度要跟着退回去
    const after = potted.filter((n) => !r.respot.includes(n));
    check(m.remaining(1, after) === 6, '摘掉被罚的那颗后，玩家1 的进度退回 6 颗',
      String(m.remaining(1, after)));
  }

  // ② 一颗都没进就打进黑八 → 直接判负（即便规则是"罚球"，因为没得可罚）
  {
    const m = new DuoMatch({ earlyEight: 'penalty' });
    const potted = [];
    shot(m, potted, [9, 10]);                  // 玩家1 大号、玩家2 小号
    const r = shot(m, potted, [8], { player: 2 });   // 玩家2 上场，一颗未进就打黑八
    check(r.outcome === 'lose' && r.winner === 1, '一颗未进就打进黑八 → 玩家1 获胜', `${r.outcome}/${r.winner}`);
    check(m.over && m.winner === 1, '本局结束');
  }

  // ③ 规则=判输（这条是**默认**，所以显式传与不传都得是它）
  {
    const m = new DuoMatch({ breakAssign: 'always', earlyEight: 'lose' });
    const potted = [];
    shot(m, potted, [9]);                      // 玩家1 已进一颗大号（开球即定组）
    const r = shot(m, potted, [8]);
    check(r.outcome === 'lose' && r.winner === 2, '规则=判输：提前打黑八直接判负', `${r.outcome}/${r.winner}`);
    check(!r.respot, '判输不需要摆球');
  }

  // ④ 默认值就是"判输"（不传任何规则，已分组后提前打黑八应该直接结束本局）
  {
    const m = new DuoMatch();
    const potted = [];
    shot(m, potted, [9, 10]);
    const r = shot(m, potted, [8]);
    check(r.outcome === 'lose' && r.winner === 2 && m.over,
      '默认口径：已分组后提前打黑八 = 直接判负', `${r.outcome}/${r.winner}`);
  }

  // ④ 清完自己的球再打黑八 = 获胜（含对手误打进的）
  {
    const m = new DuoMatch();
    const potted = [];
    for (const n of HIGH_NUMBERS) {            // 玩家1 把大号全打完
      m.beginShot();
      m.turn = 1;
      m.onPot(n);
      if (!potted.includes(n)) potted.push(n);
      m.resolveShot(potted);
    }
    check(m.cleared(1, potted) && m.remaining(1, potted) === 0, '玩家1 的大号已清完');
    const r = shot(m, potted, [8]);
    check(r.outcome === 'win' && r.winner === 1, '清完自己那组再打进黑八 → 获胜', `${r.outcome}/${r.winner}`);
    check(m.over, '本局结束');
  }
}

export function testDuoCueFoul() {
  console.log('\n[50] 本地双人 · 白球落袋');

  // 默认：换人 + 对方自由摆球（手中球）
  {
    const m = new DuoMatch();
    const potted = [];
    shot(m, potted, [12, 2]);                  // 玩家1 大号
    const r = shot(m, potted, [3], { cue: true });   // 进了球但白球也掉了
    check(r.outcome === 'cueFoul' && m.turn === 2, '白球落袋一律换人（哪怕进了球）', `${r.outcome}/${m.turn}`);
    check(r.ballInHand === 2, '默认：接手的玩家2 拿到手中球', String(r.ballInHand));
    check(r.cueToHead === false, '默认不是"回开球点"');
  }

  // 改成"回开球点"
  {
    const m = new DuoMatch({ cueFoul: 'headSpot' });
    const potted = [];
    const r = shot(m, potted, [], { cue: true });
    check(r.outcome === 'cueFoul' && m.turn === 2, '换人照旧', String(m.turn));
    check(r.ballInHand === null && r.cueToHead === true, '规则=回开球点：不给手中球，白球放回开球点',
      `hand=${r.ballInHand} head=${r.cueToHead}`);
  }

  // 白球与目标球同时落袋：换人，但**分组照判**（进的那颗仍然定下大小号）
  {
    const m = new DuoMatch({ breakAssign: 'always' });
    const potted = [];
    const r = shot(m, potted, [11], { cue: true });   // 开球：进了 11 号，白球也掉了
    check(r.outcome === 'cueFoul' && m.turn === 2, '白球落袋取消连打、换人', `${r.outcome}/${m.turn}`);
    check(m.groups[1] === 'high' && m.groups[2] === 'low',
      '白球一起掉了也照样按进的那颗分组', JSON.stringify(m.groups));
  }

  // 手中球只在"刚换人那一杆"有效，下一杆就失效（ballInHand 每次结算重算）
  {
    const m = new DuoMatch();
    const potted = [];
    shot(m, potted, [], { cue: true });
    check(m.ballInHand === 2, '换人后玩家2 拿到手中球');
    shot(m, potted, []);                       // 玩家2 打一杆空杆
    check(m.ballInHand === null, '打完一杆后手中球失效（不能一直摆）');
  }
}

export function testDuoSnapshot() {
  console.log('\n[51] 本地双人 · HUD 快照');

  const m = new DuoMatch();
  const potted = [];
  let s = m.snapshot(potted);
  check(s.turn === 1 && s.open && !s.over, '开局：玩家1、未分组、未结束', JSON.stringify(s.groups));
  check(s.remaining[1] === 7 && s.remaining[2] === 7, '未分组时两边都显示 7 颗');

  shot(m, potted, [9, 10]);
  s = m.snapshot(potted);
  check(s.groups[1] === 'high' && s.groups[2] === 'low' && !s.open, '定组后快照带上组别', JSON.stringify(s.groups));
  check(s.remaining[1] === 5 && s.remaining[2] === 7, '剩余球数跟着台面走', `${s.remaining[1]}/${s.remaining[2]}`);
  check(typeof s.note === 'string' && s.note.length > 0, '带一句本杆发生了什么', s.note);

  // 重开：状态全清
  m.reset();
  s = m.snapshot([]);
  check(s.turn === 1 && s.open && s.winner === null && !s.over, 'reset 之后回到开局状态');
  check(m.shot === 0, '杆数归零（开球那一杆要重新算）', String(m.shot));
}

export function testDuoEighthLast() {
  console.log('\n[52] 本地双人 · 黑八必须是「最后一颗」');

  // 台面上还有对方的球时打进黑八，同样算提前（按"自己的球清完没有"判，不看台面总数）
  {
    const m = new DuoMatch();
    const potted = [];
    for (const n of HIGH_NUMBERS) {
      m.beginShot(); m.turn = 1; m.onPot(n);
      if (!potted.includes(n)) potted.push(n);
      m.resolveShot(potted);
    }
    check(m.remaining(2, potted) === 7, '玩家2 的小号一颗没进');
    const r = shot(m, potted, [8]);
    check(r.outcome === 'win', '只看自己那组清没清完 —— 对方的球还在台上也算赢', r.outcome);
  }

  // 反过来：自己那组没清完，哪怕台上只剩黑八也不算赢
  {
    const m = new DuoMatch({ breakAssign: 'always', earlyEight: 'penalty' });
    const potted = [];
    shot(m, potted, [9]);                      // 玩家1 只进了一颗大号（开球即定组）
    const r = shot(m, potted, [8]);
    check(r.outcome === 'penalty', '自己那组没清完 → 提前打黑八（罚球）', r.outcome);
  }
}

export function testDuoPotsByPlayer() {
  console.log('\n[54] 本地双人 · 进袋按人分两栏记 / 进错球的判定');

  // ① 各人自己打进的球分开记（HUD 那两栏就是读这份）
  {
    const m = new DuoMatch();
    const potted = [];
    shot(m, potted, [9, 10]);                  // 玩家1 开球进两颗大号
    shot(m, potted, [3], { player: 2 });       // 玩家2 打进小号
    check(m.pots[1].join(',') === '9,10', '玩家1 名下是他自己打进的那两颗', m.pots[1].join(','));
    check(m.pots[2].join(',') === '3', '玩家2 名下是他自己打进的那颗', m.pots[2].join(','));
    // 误打进对方的球，记在**打进的人**名下（事实如此），但它算对手那一组的进度
    shot(m, potted, [11], { player: 2 });      // 玩家2 误打进大号
    check(m.pots[2].join(',') === '3,11', '误打进的球也记在打进者名下', m.pots[2].join(','));
    check(m.remaining(1, potted) === 4, '但这颗算玩家1 的清台进度', String(m.remaining(1, potted)));
  }

  // ② 罚球把球摆回台面时，两栏也要一起摘掉（否则 HUD 挂着一颗已经上桌的球）
  {
    const m = new DuoMatch({ earlyEight: 'penalty' });
    const potted = [];
    shot(m, potted, [9, 10]);
    check(m.pots[1].join(',') === '9,10', '罚球前：玩家1 名下有 9、10');
    const r = shot(m, potted, [8]);            // 玩家1 提前打黑八 → 罚 10 号
    m.removePots(r.respot);
    check(m.pots[1].join(',') === '9', '罚球后：被罚的那颗从两栏里摘掉', m.pots[1].join(','));
    check(!m.pots[1].includes(8) && !m.pots[2].includes(8), '黑八也不该留在"已进袋"里');
  }

  // ③ 整局重来：两栏一起清空
  {
    const m = new DuoMatch();
    const potted = [];
    shot(m, potted, [9]);                      // 开球只进 1 颗 → 默认不分组
    shot(m, potted, [8]);                      // 还是没分组就打进黑八 → 默认本局重来
    check(m.pots[1].length === 0 && m.pots[2].length === 0, '重来之后两栏归零',
      `${m.pots[1].length}/${m.pots[2].length}`);
  }

  // ④ "进错球"的判定：只有**已经分组**才有进错这回事
  {
    const m = new DuoMatch();
    const potted = [];
    shot(m, potted, [9, 10]);                  // 玩家1 大号、玩家2 小号
    check(m.ownerOf(9) === 1 && m.ownerOf(3) === 2, '分组后每颗球都归得到人',
      `9→${m.ownerOf(9)} 3→${m.ownerOf(3)}`);
    check(m.ownerOf(3) !== m.turn, '轮到玩家1 时，小号球不是他的球（= 进错球）');
    check(m.ownerOf(8) === null, '黑八不归任何人，不算进错球');
  }
  {
    const m = new DuoMatch();                  // 开局台面开放
    check(m.open && m.ownerOf(9) === null, '未分组时没有"进错球"这回事（进任何一颗都只是进球）');
  }
}

export function testDuoBreakEight() {
  console.log('\n[53] 本地双人 · 还没分大小号就打进黑八（三选一）');
  // 与 [49] 的分水岭：台面还没分组时，"提前进黑八"这说法不成立 —— 走的是这一条规则。

  // ① 默认 = 本局重来（开球进黑八最常见的处理）
  {
    const m = new DuoMatch();
    const potted = [];
    const r = shot(m, potted, [8]);            // 开球那一杆直接进黑八
    check(r.outcome === 'rerack', '开球进黑八 → 本局重来', r.outcome);
    check(m.shot === 0 && m.turn === 1 && m.open, '重来：杆数归零、回到玩家1 开球、分组清零',
      `shot=${m.shot} turn=${m.turn}`);
    check(!m.over && m.winner === null, '重来不算任何人输赢');
  }

  // ② 规则=黑八归位、换人继续
  {
    const m = new DuoMatch({ breakEight: 'respot' });
    const potted = [];
    const r = shot(m, potted, [8]);
    check(r.outcome === 'respot' && r.respot.join(',') === '8',
      '黑八摆回原位（只摆黑八，不牵连别的球）', JSON.stringify(r.respot));
    check(m.turn === 2 && !m.over, '换人接着打，本局不结束', `turn=${m.turn} over=${m.over}`);
    check(m.open, '还是没分组（下一杆谁先进球谁定组）');
  }

  // ③ 规则=击球者直接判负
  {
    const m = new DuoMatch({ breakEight: 'lose' });
    const potted = [];
    const r = shot(m, potted, [8]);
    check(r.outcome === 'lose' && r.winner === 2 && r.loser === 1,
      '规则=判负：开球进黑八的人直接输', `${r.outcome}/win=${r.winner}`);
    check(m.over, '本局结束');
  }

  // ④ 第二杆起、还没人进过球就打进黑八 → 同一条规则（不是"提前进黑八"那条）
  {
    const m = new DuoMatch({ earlyEight: 'penalty' });
    const potted = [];
    shot(m, potted, []);                       // 玩家1 空杆 → 换玩家2
    const r = shot(m, potted, [8]);            // 玩家2 一颗未进就打黑八
    check(r.outcome === 'rerack',
      '未分组时进黑八走 breakEight（默认重来），而不是 earlyEight 的罚球', r.outcome);
  }

  // ⑤ 已经分组之后就归 [49] 那条规则管（两条规则互不串台）
  {
    const m = new DuoMatch({ breakEight: 'respot', earlyEight: 'lose' });
    const potted = [];
    shot(m, potted, [9, 10]);                  // 玩家1 定下大号
    const r = shot(m, potted, [8]);            // 玩家1 提前打黑八
    check(r.outcome === 'lose', '已分组 → 走 earlyEight（判负），不再走 breakEight 的归位', r.outcome);
  }
}

/**
 * 犯规罚则（0.7.0 新增，体检 G4）：空杆 / 打错球组 / 击球后没进袋。
 * 三项默认全 'none' —— 行为与 0.6.x 完全一致（犯规只换人）；
 * 选 'ballInHand' 后犯规 → 换人 + 对方手中球（outcome 'foul'）。
 */
export function testDuoFouls() {
  console.log('\n[54] 本地双人 · 犯规罚则（默认全关）');

  check(DUO_RULE_DEFAULTS.foulMiss === 'none' && DUO_RULE_DEFAULTS.foulWrongBall === 'none'
    && DUO_RULE_DEFAULTS.foulNoPot === 'none', '三项犯规罚则默认全部不罚', JSON.stringify({
    miss: DUO_RULE_DEFAULTS.foulMiss, wrong: DUO_RULE_DEFAULTS.foulWrongBall, noPot: DUO_RULE_DEFAULTS.foulNoPot,
  }));
  check(DUO_RULE_TABLES.foulMiss.none && DUO_RULE_TABLES.foulMiss.ballInHand
    && DUO_RULE_TABLES.foulWrongBall.ballInHand && DUO_RULE_TABLES.foulNoPot.ballInHand,
  '三项共用同一张罚则表（none / ballInHand）');
  check(sanitizeDuoRules({ foulMiss: 'zzz' }).foulMiss === 'none', '写坏的罚则值回落默认');

  // ① 默认（全关）：空杆就是普通换人，与 0.6.x 一致
  {
    const m = new DuoMatch();
    const potted = [];
    const r = shot(m, potted, []);             // 没进球、也没登记触球
    check(r.outcome === 'switch' && m.turn === 2 && r.ballInHand == null,
      '默认：空杆只换人、不给手中球（现状不变）', `${r.outcome}/hand=${r.ballInHand}`);
  }

  // ② 空杆罚则开启：没碰到任何球 → foul + 对方手中球
  {
    const m = new DuoMatch({ foulMiss: 'ballInHand' });
    const potted = [];
    const r = shot(m, potted, []);
    check(r.outcome === 'foul' && r.kind === 'miss' && m.turn === 2 && r.ballInHand === 2,
      '空杆 + 罚则开启 → 判罚手中球', `${r.outcome}/${r.kind}/hand=${r.ballInHand}`);
  }
  // 空杆罚则开，但碰到了球（只是没进）→ 不是空杆，回到普通换人
  {
    const m = new DuoMatch({ foulMiss: 'ballInHand' });
    const potted = [];
    m.beginShot();
    m.markCueContact(10);
    const r = m.resolveShot(potted);
    check(r.outcome === 'switch', '碰到了球但没进 ≠ 空杆（除非 foulNoPot 也开）', r.outcome);
  }

  // ③ 打错球组罚则开启：先碰到对方的球 → foul（哪怕这杆进了自己的球也判罚，真实规则如此）
  {
    const m = new DuoMatch({ foulWrongBall: 'ballInHand' });
    const potted = [];
    shot(m, potted, [12, 2]);                  // 玩家1 定下大号
    m.beginShot();
    m.markCueContact(3);                       // 先碰 3 号（小号）
    m.onPot(3);
    potted.push(3);
    const r = m.resolveShot(potted);           // 还把对方的球打进了
    check(r.outcome === 'foul' && r.kind === 'wrongBall' && m.turn === 2,
      '先碰对方球 → 犯规，进了球也判罚（真实规则）', `${r.outcome}/${r.kind}`);
  }
  // 先碰自己的球、没进 → 不是打错球组（若 noPot 关，就是普通换人）
  {
    const m = new DuoMatch({ foulWrongBall: 'ballInHand' });
    const potted = [];
    shot(m, potted, [12, 2]);
    m.beginShot();
    m.markCueContact(11);                      // 自己组（大号）
    const r = m.resolveShot(potted);
    check(r.outcome === 'switch', '先碰自己的球再没进：不算打错球组', r.outcome);
  }
  // 台面开放（含开球杆）碰谁都行
  {
    const m = new DuoMatch({ foulWrongBall: 'ballInHand' });
    const potted = [];
    m.beginShot();
    m.markCueContact(8);                       // 开球先蹭到黑八也不算（还没分组）
    const r = m.resolveShot(potted);
    check(r.outcome === 'switch', '台面开放时不判打错球组', r.outcome);
  }
  // 没清完先碰黑八 = 打错球组；清完了先碰黑八 = 正常（那是决胜球）
  {
    const m = new DuoMatch({ foulWrongBall: 'ballInHand' });
    const potted = [9, 10, 11];                // 假装已经清了大半
    shot(m, potted, [12, 2]);                  // 定组（12 本就在 potted 里，不重复算）
    m.beginShot();
    m.markCueContact(8);
    const r = m.resolveShot(potted);
    check(r.outcome === 'foul' && r.kind === 'wrongBall', '没清完先碰黑八 → 打错球组', `${r.outcome}/${r.kind}`);

    const m2 = new DuoMatch({ foulWrongBall: 'ballInHand' });
    m2.groups = { 1: 'high', 2: 'low' };       // 直接摆成"大号已清完"
    const potted2 = [9, 10, 11, 12, 13, 14, 15];
    m2.beginShot();
    m2.markCueContact(8);                      // 只是先碰到了黑八（没打进）
    const r2 = m2.resolveShot(potted2);
    check(r2.outcome === 'switch' && r2.kind !== 'wrongBall',
      '清完自己那组后先碰黑八不算犯规（那是决胜球，没进就普通换人）', r2.outcome);
  }

  // ④ 击球后没进袋：默认关；开了就是"没进 = 犯规"
  {
    const m = new DuoMatch({ foulNoPot: 'ballInHand' });
    const potted = [];
    m.beginShot();
    m.markCueContact(10);                      // 碰到了球但没进
    const r = m.resolveShot(potted);
    check(r.outcome === 'foul' && r.kind === 'noPot', '没进袋罚则开启：碰到了也没进 → 判罚', `${r.outcome}/${r.kind}`);
  }
  {
    const m = new DuoMatch({ foulNoPot: 'ballInHand' });
    const potted = [];
    const r = shot(m, potted, [9]);            // 进了球 → 不触发
    check(r.outcome !== 'foul', '进球的杆不受"没进袋"罚则影响', r.outcome);
  }

  // ⑤ 犯规优先级：白球落袋 > 打错球组 > 空杆 > 没进袋
  {
    const m = new DuoMatch({ foulMiss: 'ballInHand', foulWrongBall: 'ballInHand', foulNoPot: 'ballInHand' });
    const potted = [];
    shot(m, potted, [12, 2]);
    const r = shot(m, potted, [], { cue: true });   // 白球落袋（也没碰球、没进球）
    check(r.outcome === 'cueFoul', '白球落袋优先于一切犯规（它自带一套规则）', r.outcome);
  }

  // ⑥ markCueContact 只记第一颗
  {
    const m = new DuoMatch({ foulWrongBall: 'ballInHand' });
    const potted = [];
    shot(m, potted, [12, 2]);
    m.beginShot();
    m.markCueContact(3);                       // 先碰对方的
    m.markCueContact(11);                      // 再碰自己的：不该覆盖
    const r = m.resolveShot(potted);
    check(r.outcome === 'foul' && m.contact === 3, '只记第一次触球（后续碰球不覆盖）', String(m.contact));
  }
}
