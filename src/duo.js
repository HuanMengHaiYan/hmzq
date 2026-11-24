/**
 * 本地双人模式 · 规则引擎（同一台设备轮流击球）
 * ------------------------------------------------------------------
 * ⚠️ 这个文件刻意**不碰 three、不碰 DOM**：和 modes.js 一样，无头测试可以直接 import 跑，
 * 分组 / 开球 / 提前打进黑八 / 白球犯规这些判定都能被断言，而不是靠肉眼看 HUD。
 *
 * 规则（用户定的，2026-09-24）：
 *   · 词：1~7 = 小号（全色），9~15 = 大号（半色），8 号 = 决胜球
 *   · 谁打哪一组由**实际打球结果**决定，开局不定
 *   · 开球那一杆（第一杆）：
 *       - 进 2 颗及以上 → 判定分组（按本杆**第一颗**落袋的球）
 *       - 只进 1 颗 → 默认**不**判定分组（可在规则设置里改成"进 1 颗也判定"）
 *       - 进了球（不含黑 8）→ 击球方继续打下一杆；没进 → 换人
 *   · 第二杆起：谁先打进某一组的球，谁本局就打那一组（另一人自动是另一组）
 *   · 打进**自己组**的球 = 得分、可以继续打（连击音效照常）；只打进对方的球 → 换人
 *   · 自己的球全部打完（含对手误打进的、含开球进的）→ 可以打黑 8
 *   · ⚠️ 进黑 8 要**分两种情况**，各有一套规则设置：
 *       - 开球杆、或台面还没分大小号 → breakEight：本局重来（默认）/ 黑八归位换人 / 判负
 *       - 已经分组、自己的球没清完 → earlyEight：直接判负（默认）/ 罚一颗 + 黑八回位
 *   · 白球落袋 → 无条件取消连打、换人（可在规则设置里选"对方自由摆球"还是"白球回开球点"）
 *   · 白球与目标球同时落袋 → 换人，但**分组照判**（进的那颗球仍然定下大小号）
 */

/** 小号（低号）球：1~7 */
export const LOW_NUMBERS = [1, 2, 3, 4, 5, 6, 7];
/** 大号（高号）球：9~15 */
export const HIGH_NUMBERS = [9, 10, 11, 12, 13, 14, 15];
/** 决胜球 */
export const EIGHT = 8;

/** 球号 → 组别（'low' | 'high' | 'eight'） */
export function groupOf(n) {
  const v = Number(n);
  if (v === EIGHT) return 'eight';
  if (LOW_NUMBERS.includes(v)) return 'low';
  if (HIGH_NUMBERS.includes(v)) return 'high';
  return null;
}

export function groupName(g) {
  return g === 'low' ? '小号' : g === 'high' ? '大号' : '未分组';
}

export function groupRange(g) {
  return g === 'low' ? '1~7' : g === 'high' ? '9~15' : '—';
}

/** 另一名玩家 */
export function other(player) {
  return player === 1 ? 2 : 1;
}

// ---------- 三项可改的规则（启动器「游戏设置 → 规则设置」里改） ----------

/**
 * 开局进球判定：开球那一杆只进了 1 颗球时，算不算判定分组。
 * ⚠️ 无论选哪项，「进 2 颗及以上」都一定判定分组 —— 那条是硬规则，不进设置。
 */
export const DUO_BREAK_ASSIGN = {
  never: {
    id: 'never', name: '第一杆进洞不分组', sub: '默认',
    desc: '开球进 1 颗只算进球、由开球方继续打；进 2 颗及以上才判定分组。',
  },
  always: {
    id: 'always', name: '第一杆进洞就分组', sub: '开局即定组',
    desc: '开球只要进 1 颗球，就按这颗球的号定下双方的大小号。',
  },
};

/**
 * 进黑八时台面**还没分大小号**（开球那一杆、或第二杆起还没人进过球）怎么办。
 * ⚠️ 这条只管"没分组"的情况；已经分了组再提前进黑八，走下面的 DUO_EARLY_EIGHT。
 */
export const DUO_BREAK_EIGHT = {
  rerack: {
    id: 'rerack', name: '本局重来', sub: '默认',
    desc: '整局重新开球（球全部摆回、分数与分组清零），由原来开球的人重新开球。',
  },
  respot: {
    id: 'respot', name: '黑八归位，换人继续', sub: '宽松',
    desc: '这一次进黑八不算数，黑八摆回初始位置，换对手接着打，本局继续。',
  },
  lose: {
    id: 'lose', name: '击球者直接判负', sub: '严格',
    desc: '打进黑八的人直接输掉这一局，本局结束。',
  },
};

/** 已经分好组之后、自己的球还没清完就打进黑 8 怎么办 */
export const DUO_EARLY_EIGHT = {
  lose: {
    id: 'lose', name: '直接判输', sub: '默认',
    desc: '自己的球没清完就打进黑八 → 直接判负，本局结束。',
  },
  penalty: {
    id: 'penalty', name: '罚一颗 + 黑八回位', sub: '宽松',
    desc: '罚一颗已经打进的球重新摆回台面，黑八也摆回初始位置，然后换人。' +
      '一颗都还没进就直接打进黑八 → 判负。',
  },
};

/** 白球落袋后，接手的那个人怎么摆白球 */
export const DUO_CUE_FOUL = {
  ballInHand: {
    id: 'ballInHand', name: '对方自由摆球', sub: '默认',
    desc: '白球落袋 → 换人，接手的一方可以在台面任意位置摆白球（手中球）。',
  },
  headSpot: {
    id: 'headSpot', name: '白球回开球点', sub: '宽松',
    desc: '白球落袋 → 换人，白球放回开球点，接手的一方从开球点打。',
  },
};

/**
 * 犯规罚则（0.7.0 新增，体检 G4）—— 三项犯规各自独立配置，默认全部"不罚"。
 * ------------------------------------------------------------------
 * 默认（'none'）保持 0.6.x 的行为：犯规只换人，不额外判罚。
 * 选「判罚手中球」后：犯规 → 换人，且接手的一方可以在台面**任意位置**摆白球
 * （真实中式黑八的"自由球"）。判定细节见 DuoMatch.#activeFoul。
 */
export const DUO_FOUL_PENALTY = {
  none: {
    id: 'none', name: '不罚，只换人', sub: '默认',
    desc: '保持宽松：犯规的那一杆只换人，对方从白球现在的位置接着打。',
  },
  ballInHand: {
    id: 'ballInHand', name: '判罚手中球', sub: '严格',
    desc: '犯规 → 换人，接手的一方可以把白球摆到台面任意位置（真实规则的自由球）。',
  },
};

/** 各项规则的默认值与合法值（启动器的镜像表要跟这里保持一致） */
export const DUO_RULE_DEFAULTS = {
  breakAssign: 'never',
  breakEight: 'rerack',
  cueFoul: 'ballInHand',
  earlyEight: 'lose',
  // 犯规罚则（默认全关 —— 犯规只换人，与 0.6.x 行为一致，见 DUO_FOUL_PENALTY）
  foulMiss: 'none',       // 空杆：白球没碰到任何球
  foulWrongBall: 'none',  // 打错球组：第一下碰到不该碰的球（含没清完先碰黑八）
  foulNoPot: 'none',      // 击球后没进袋
};

export const DUO_RULE_TABLES = {
  breakAssign: DUO_BREAK_ASSIGN,
  breakEight: DUO_BREAK_EIGHT,
  cueFoul: DUO_CUE_FOUL,
  earlyEight: DUO_EARLY_EIGHT,
  foulMiss: DUO_FOUL_PENALTY,
  foulWrongBall: DUO_FOUL_PENALTY,
  foulNoPot: DUO_FOUL_PENALTY,
};

/** 把任意来源的规则值收拾成合法值（存坏 / URL 参数被改坏也不会崩） */
export function sanitizeDuoRules(raw = {}) {
  const out = {};
  for (const [key, def] of Object.entries(DUO_RULE_DEFAULTS)) {
    const table = DUO_RULE_TABLES[key];
    out[key] = table[raw[key]] ? raw[key] : def;
  }
  return out;
}

/**
 * 本地双人对局。
 * ------------------------------------------------------------------
 * 只管"规则"，不管球怎么动：`resolveShot()` 由 main.js 在**球全部停稳**之后调用一次，
 * 传进本杆落袋的球号（按落袋顺序）与白球有没有掉袋，返回这一杆之后该怎么办。
 *
 * `potted` 由调用方持有（就是 state.potted 那一份）—— 两边共用同一个数组，
 * 免得"引擎自己记一份、HUD 读另一份"这种对不上的 bug。
 */
export class DuoMatch {
  constructor(rules = {}) {
    this.rules = sanitizeDuoRules(rules);
    this.reset();
  }

  /** 开新的一局（重开本局 / 开球进黑八重来都走这里） */
  reset() {
    this.shot = 0;                       // 已打杆数（1 = 开球那一杆）
    this.turn = 1;                       // 当前该谁：1 | 2
    this.groups = { 1: null, 2: null };  // 'low' | 'high' | null（未分组）
    this.over = false;
    this.winner = null;                  // 1 | 2
    this.shotPots = [];                  // 本杆落袋的球号（按落袋顺序，白球不算）
    this.cuePotted = false;              // 本杆白球有没有掉袋
    this.contact = null;                 // 本杆白球**第一次**碰到的球号（null = 还没碰到任何球，犯规判定用）
    this.ballInHand = null;              // 谁拿到手中球（自由摆白球）
    this.pots = { 1: [], 2: [] };        // 每人**自己打进**的球号（HUD 分两栏显示）
    this.lastNote = '';                  // 上一杆的判罚说明（给 HUD / 提示条用）
  }

  /**
   * 把若干球号从"某人打进的清单"里摘掉。
   * ------------------------------------------------------------------
   * 罚球把黑八 / 被罚的那颗摆回台面时要调它 —— 只摘台面的总进度（state.potted）
   * 不摘这一份的话，HUD 上会挂着一颗"其实已经回到台面上"的球。
   */
  removePots(numbers) {
    if (!numbers || !numbers.length) return;
    const drop = new Set(numbers.map(Number));
    for (const p of [1, 2]) {
      this.pots[p] = this.pots[p].filter((n) => !drop.has(n));
    }
  }

  /** 换规则（规则设置里改完立刻生效；已经打完的杆不追溯） */
  setRules(rules) {
    this.rules = sanitizeDuoRules(rules);
  }

  /** 双方还没分组（"台面是开放的"） */
  get open() {
    return !this.groups[1] && !this.groups[2];
  }

  /** 某组的全部球号 */
  numbersOf(group) {
    return group === 'low' ? LOW_NUMBERS.slice() : group === 'high' ? HIGH_NUMBERS.slice() : [];
  }

  /** 某名玩家本组还剩几颗没进（未分组时返回 7） */
  remaining(player, potted) {
    const g = this.groups[player];
    if (!g) return LOW_NUMBERS.length;
    const set = new Set(potted);
    return this.numbersOf(g).filter((n) => !set.has(n)).length;
  }

  /** 某名玩家的球是不是全打完了（未分组 = 没打完） */
  cleared(player, potted) {
    const g = this.groups[player];
    if (!g) return false;
    const set = new Set(potted);
    return this.numbersOf(g).every((n) => set.has(n));
  }

  /** 本杆的落袋登记（由 main.js 的落袋回调调用；白球另走 markCuePot） */
  onPot(number) {
    if (Number(number) === EIGHT || groupOf(number)) this.shotPots.push(Number(number));
  }

  markCuePot() {
    this.cuePotted = true;
  }

  /**
   * 白球碰到了第一颗球（由 main.js 在物理碰撞回调里调用；只记第一次）。
   * 犯规判定靠它：null = 空杆；号码属于对方组 = 打错球组。
   */
  markCueContact(number) {
    if (this.contact == null) this.contact = Number(number);
  }

  /**
   * 本杆结算（球全部停稳后调用一次）。
   * @param potted 当前台面累计已进袋的全部球号（含本杆）
   * @returns 见下面的 outcome
   */
  resolveShot(potted) {
    this.shot += 1;
    const player = this.turn;
    const foe = other(player);
    const isBreak = this.shot === 1;
    const nums = this.shotPots.slice();
    const eight = nums.includes(EIGHT);
    const plain = nums.filter((n) => n !== EIGHT);   // 不含黑 8 的目标球
    this.ballInHand = null;

    // 本杆打进的球记在**击球者**名下（HUD 分两栏显示"谁进了哪些"）。
    // ⚠️ 记在 rerack 分支之前是对的：整局重来时 reset() 会把它一起清掉，
    //    重来的那一局本来就该从零开始记。
    for (const n of nums) {
      if (!this.pots[player].includes(n)) this.pots[player].push(n);
    }

    // ---- ② 分组判定（台面还是开放的才有这一步）----
    let assigned = null;
    if (this.open && plain.length) {
      const byBreak = isBreak
        ? plain.length > 1 || (plain.length === 1 && this.rules.breakAssign === 'always')
        : true;
      if (byBreak) {
        const g = groupOf(plain[0]);
        if (g) {
          this.groups[player] = g;
          this.groups[foe] = g === 'low' ? 'high' : 'low';
          assigned = { 1: this.groups[1], 2: this.groups[2] };
        }
      }
    }

    // ---- ③ 黑 8 ----
    if (eight) {
      // 自己的球已经打完（含本杆刚进的）→ 赢
      if (this.cleared(player, potted)) {
        this.over = true;
        this.winner = player;
        this.lastNote = `玩家${player}打进黑八，获胜`;
        return { outcome: 'win', player, winner: player, assigned, note: this.lastNote };
      }
      // 开球那一杆，或台面还没分大小号 → 走「进黑八」规则（默认整局重来）
      // 已经分好组了 → 才算"提前进黑八"，走另一条规则（默认直接判负）
      if (isBreak || this.open) return this.#eightOpen(player, foe, assigned);
      return this.#eightEarly(player, foe, potted, assigned);
    }

    // ---- ④ 白球落袋：一律换人（进了自己的球也不续杆）----
    if (this.cuePotted) {
      if (this.rules.cueFoul === 'ballInHand') this.ballInHand = foe;
      this.lastNote = `玩家${player}白球落袋，换玩家${foe}`
        + (this.rules.cueFoul === 'ballInHand' ? '（可自由摆球）' : '（白球回开球点）');
      this.#pass(foe);
      return {
        outcome: 'cueFoul', player, assigned, next: this.turn,
        ballInHand: this.ballInHand,
        cueToHead: this.rules.cueFoul === 'headSpot',
        note: this.lastNote,
      };
    }

    // ---- ④.5 犯规判定（0.7.0，体检 G4；三项罚则默认全关）----
    // 优先级：白球落袋（上面已处理）> 打错球组 > 空杆 > 没进袋。
    // 只有对应规则选了「判罚手中球」才算犯规 —— 'none' 时走下面 ⑤ 的原判（只换人），
    // 与 0.6.x 行为完全一致。
    const foul = this.#activeFoul(player, potted);
    if (foul) {
      this.lastNote = `${foul.note}，换玩家${foe}（自由球）`;
      this.#pass(foe);
      this.ballInHand = foe;
      return {
        outcome: 'foul', player, assigned, next: this.turn,
        ballInHand: this.ballInHand, kind: foul.kind, note: this.lastNote,
      };
    }

    // ---- ⑤ 普通一杆：进了自己的球就续杆 ----
    const own = this.open
      ? plain                                        // 还没分组：进任何一颗都算"进了球"
      : plain.filter((n) => this.ownerOf(n) === player);
    if (own.length) {
      this.lastNote = assigned
        ? `玩家${player}打${groupName(this.groups[player])}（${groupRange(this.groups[player])}）`
        : `玩家${player}继续击球`;
      return { outcome: 'continue', player, assigned, next: player, potted: own, note: this.lastNote };
    }
    this.lastNote = plain.length
      ? `玩家${player}只进了对方的球，换人`
      : `玩家${player}空杆，换人`;
    this.#pass(foe);
    return { outcome: 'switch', player, assigned, next: this.turn, note: this.lastNote };
  }

  /** 下一杆开始前的收尾（清掉本杆的临时登记） */
  beginShot() {
    this.shotPots = [];
    this.cuePotted = false;
    this.contact = null;
  }

  /** 交给 HUD 的一份快照（纯数据，方便断言与渲染） */
  snapshot(potted) {
    return {
      turn: this.turn,
      over: this.over,
      winner: this.winner,
      open: this.open,
      groups: { 1: this.groups[1], 2: this.groups[2] },
      remaining: { 1: this.remaining(1, potted), 2: this.remaining(2, potted) },
      ballInHand: this.ballInHand,
      note: this.lastNote,
    };
  }

  #pass(next) {
    this.turn = next;
  }

  /**
   * 某颗球属于谁（未分组 / 黑八返回 null）。
   * ------------------------------------------------------------------
   * 公开是因为落袋那一刻 main.js 就要立刻判断"有没有进错球"——
   * 进错球要当场掐掉连击音效，不能等到球停稳结算（那时候欢呼已经放完了）。
   */
  ownerOf(n) {
    const g = groupOf(n);
    if (!g || g === 'eight') return null;
    if (this.groups[1] === g) return 1;
    if (this.groups[2] === g) return 2;
    return null;
  }

  /**
   * 本杆有没有犯下"已开启罚则"的规。
   * ------------------------------------------------------------------
   * 三项犯规（对应规则开关见 DUO_FOUL_PENALTY）：
   *   · 打错球组：已分组后，第一下碰到的不是自己组的球 —— 没清完时先碰黑八也算；
   *     台面开放（含开球那一杆）时碰谁都行，不算。
   *   · 空杆：白球一次都没碰到任何球（contact === null）。
   *   · 没进袋：这一杆一颗球都没打进（真实中式规则没有这条，属于可选的严格玩法）。
   * 只有对应规则 === 'ballInHand' 才返回犯规描述；'none' 时恒返回 null（不罚）。
   * 进了自己组的球续杆的场面不判罚 —— 犯规判定只在"这杆打完要换人"时才有意义。
   */
  #activeFoul(player, potted) {
    const r = this.rules;
    const contact = this.contact;
    // 打错球组：第一下碰到的球不属于自己（ownerOf 对黑八返回 null → 没清完先碰黑八也判）
    if (r.foulWrongBall === 'ballInHand' && !this.open && contact != null) {
      const hitEight = Number(contact) === EIGHT;
      const wrongEight = hitEight && !this.cleared(player, potted);
      if (wrongEight || (!hitEight && this.ownerOf(contact) !== player)) {
        return { kind: 'wrongBall', note: `玩家${player}先碰到了不该碰的球` };
      }
    }
    // 空杆：没碰到任何球
    if (r.foulMiss === 'ballInHand' && contact == null) {
      return { kind: 'miss', note: `玩家${player}空杆（没碰到任何球）` };
    }
    // 击球后没进袋
    if (r.foulNoPot === 'ballInHand' && this.shotPots.length === 0) {
      return { kind: 'noPot', note: `玩家${player}击球后没进球` };
    }
    return null;
  }

  /**
   * 进黑八时**台面还没分大小号**（开球那一杆，或第二杆起还没人进过球）。
   * ------------------------------------------------------------------
   * 这种情况没有"提前进黑八"这回事 —— 因为还不知道谁打哪一组，所以单独有一套规则：
   *   重来（默认） / 黑八归位换人继续 / 击球者直接判负。
   */
  #eightOpen(player, foe, assigned) {
    const rule = this.rules.breakEight;
    // 整局重来：杆数、分组、手中球全部清零，由原来开球的人重新开球
    if (rule === 'rerack') {
      this.reset();
      this.lastNote = `玩家${player}打进黑八，本局重来`;
      return { outcome: 'rerack', player, note: this.lastNote };
    }
    // 击球者直接判负
    if (rule === 'lose') {
      this.over = true;
      this.winner = foe;
      this.lastNote = `玩家${player}打进黑八，判负`;
      return { outcome: 'lose', player, winner: foe, loser: player, assigned, note: this.lastNote };
    }
    // 这次不算：黑八摆回初始位置，换对手接着打
    this.lastNote = `玩家${player}打进黑八：黑八归位，换玩家${foe}`;
    this.#pass(foe);
    return {
      outcome: 'respot', player, assigned, respot: [EIGHT],
      next: this.turn, note: this.lastNote,
    };
  }

  /**
   * **已经分好组**、自己的球还没清完就打进黑八。
   * ------------------------------------------------------------------
   * 默认直接判负；也可以选"罚一颗 + 黑八回位"。
   * 罚球池是空的（一颗都没进过）→ 无论选哪项都判负。
   */
  #eightEarly(player, foe, potted, assigned) {
    if (this.rules.earlyEight === 'lose') {
      this.over = true;
      this.winner = foe;
      this.lastNote = `玩家${player}提前打进黑八，判负`;
      return { outcome: 'lose', player, winner: foe, loser: player, assigned, note: this.lastNote };
    }
    // 罚球：罚一颗已经打进的球 + 黑八，都摆回初始位置，然后换人
    const mine = this.#penaltyPool(player, potted);
    if (!mine.length) {
      this.over = true;
      this.winner = foe;
      this.lastNote = `玩家${player}一颗未进就打进黑八，判负`;
      return { outcome: 'lose', player, winner: foe, loser: player, assigned, note: this.lastNote };
    }
    const penalty = mine[mine.length - 1];
    this.lastNote = `玩家${player}提前打进黑八：罚 ${penalty} 号与黑八回位，换人`;
    this.#pass(foe);
    return {
      outcome: 'penalty', player, assigned, respot: [EIGHT, penalty],
      next: this.turn, note: this.lastNote,
    };
  }

  /**
   * 罚球时"可以退回台面"的那些球号。
   * ------------------------------------------------------------------
   * 已分组 → 只从**自己那组**已进的球里退（这就是"罚一颗已经进了的球"）；
   * 台面还开放（没分组）→ 还没有"我的组"这回事，退任意一颗已进的目标球。
   * 两种情况只要池子是空的，就意味着"一颗没进就直接打进了黑八" → 判负。
   */
  #penaltyPool(player, potted) {
    const pool = potted.filter((n) => n !== EIGHT);
    const g = this.groups[player];
    if (!g) return pool;
    return this.numbersOf(g).filter((n) => pool.includes(n));
  }
}
