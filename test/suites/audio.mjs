import { existsSync } from 'node:fs';
import { check } from '../lib/harness.mjs';
import { ComboAnnouncer } from '../../src/combo.js';
import { VOICES } from '../../src/voices.js';
import { AUDIO } from '../../src/constants.js';

/**
 * 音效 / 连击播报单元测试（纯逻辑，不需要 Rapier、DOM 与音频上下文）。
 * ComboAnnouncer 只依赖一个鸭子类型的 engine.playClip(name, vol)，
 * 所以这里用一个记录调用序列的假引擎就能把整套播报规则锁死。
 */

const AUDIO_DIR = new URL('../../public/audio/', import.meta.url);

/** 素材清单（镜像 src/audio.js 的 CLIP_FILES：那条 import 会带进 three，测试里用不了） */
const CLIP_FILES = {
  cheer: 'cheer.ogg',
  applause: 'applause.ogg',
  streak2: 'voice/streak2.mp3',
  streak3: 'voice/streak3.mp3',
  streak4: 'voice/streak4.mp3',
  streak5: 'voice/streak5.mp3',
  streak6: 'voice/streak6.mp3',
  multi2: 'voice/multi2.mp3',
  multi3: 'voice/multi3.mp3',
  multi4: 'voice/multi4.mp3',
};

function makeCombo() {
  const log = [];
  const sfx = [];
  const engine = {
    playClip(name, vol) { log.push({ name, vol }); },
    sfx(name) { sfx.push(name); },
  };
  // schedule 换成同步：避免测试里等 setTimeout
  const combo = new ComboAnnouncer(engine, { schedule: (fn) => fn() });
  return {
    combo, log, sfx,
    names: () => log.map((x) => x.name),
    take() { const n = this.names(); log.length = 0; return n; },
  };
}

/** 只录 tone(spec) 的假引擎：voices.js 只依赖这一个发声原语 */
function makeEngine() {
  const tones = [];
  return { tones, tone(spec) { tones.push(spec); } };
}

/** 打若干杆（每杆 potCounts[i] 颗），返回每个球落袋时放了哪些音 */
function playShots(h, potCounts) {
  const perPot = [];
  for (const n of potCounts) {
    h.combo.onShotStart();
    for (let i = 0; i < n; i++) {
      h.take();
      h.combo.onPot(false);
      perPot.push(h.names());
    }
    h.combo.onShotEnd();
  }
  return perPot;
}

/* ---------------- [15] 素材齐全 ---------------- */
export function testAudioAssets() {
  console.log('\n[15] 音效：素材是否齐全');
  const missing = Object.entries(CLIP_FILES)
    .filter(([, rel]) => !existsSync(new URL(rel, AUDIO_DIR)))
    .map(([k]) => k);
  check(missing.length === 0, '音效素材齐全', missing.length ? `缺少 ${missing.join(', ')}` : `共 ${Object.keys(CLIP_FILES).length} 个`);

  const bgm = ['bgm/lounge.mp3', 'bgm/park.ogg'].filter((f) => !existsSync(new URL(f, AUDIO_DIR)));
  check(bgm.length === 0, '背景音乐素材齐全', bgm.length ? `缺少 ${bgm.join(', ')}` : 'lounge / park');
}

/* ---------------- [16] 连击播报 ---------------- */
export function testComboVoice() {
  console.log('\n[16] 连击播报：2 连 ~ 6 连');
  // 连续四杆，每杆一颗：1 连只有欢呼，2 连开始念语音
  const h = makeCombo();
  const pots = playShots(h, [1, 1, 1, 1]);
  check(pots[0].join() === 'cheer', '首颗只有欢呼，不念语音', pots[0].join());
  check(pots[1].includes('streak2'), '二连 → 非常好', pots[1].join());
  check(pots[2].includes('streak3') && pots[2].includes('applause'), '三连 → 太棒了 + 掌声', pots[2].join());
  check(pots[3].includes('streak4'), '四连 → 四连无双', pots[3].join());
  check(h.combo.best === 4, '连击最高纪录被记下来', `best=${h.combo.best}`);

  // 五连 / 六连 / 七连
  const h2 = makeCombo();
  const pots2 = playShots(h2, [1, 1, 1, 1, 1, 1, 1]);
  check(pots2[4].includes('streak5'), '五连 → 五连绝世', pots2[4].join());
  check(pots2[5].includes('streak6'), '六连 → 超越神的球技', pots2[5].join());
  check(pots2[6].includes('streak6'), '七连及以上沿用最高档语音', pots2[6].join());

  // 欢呼音量随连击递增，但不越过 cheerGain × 1.35 的上限
  const h3 = makeCombo();
  const vols = [];
  for (let i = 0; i < 8; i++) {
    h3.combo.onShotStart();
    h3.take();
    h3.combo.onPot(false);
    const cheer = h3.log.find((x) => x.name === 'cheer');
    vols.push(cheer ? cheer.vol : 0);
    h3.combo.onShotEnd();
  }
  const rising = vols.every((v, i) => i === 0 || v >= vols[i - 1]);
  check(rising, '欢呼音量随连击递增', vols.map((v) => v.toFixed(2)).join(' → '));
  check(vols[7] <= AUDIO.cheerGain * 1.35 + 1e-9, '欢呼音量有上限，不会越来越吵', `最高 ${vols[7].toFixed(3)}`);
}

/* ---------------- [17] 一杆多响 ---------------- */
export function testMultiPot() {
  console.log('\n[17] 连击播报：一杆多响');
  const h = makeCombo();
  const pots = playShots(h, [2]);
  check(pots[1].includes('multi2'), '一杆两颗 → 双响炮', pots[1].join());
  check(!pots[1].some((n) => n.startsWith('streak')), '多响时不叠加连击语音', pots[1].join());

  const h2 = makeCombo();
  const pots2 = playShots(h2, [3]);
  check(pots2[1].includes('multi2') && pots2[2].includes('multi3'), '一杆三颗 → 双响炮 → 三响炮', pots2[2].join());

  const h3 = makeCombo();
  const pots3 = playShots(h3, [5]);
  check(pots3[3].filter((n) => n.startsWith('multi')).join() === 'multi4', '第四颗升到最高档「满堂彩」', pots3[3].join());
  check(pots3[4].filter((n) => n.startsWith('multi')).join() === '', '第五颗不再重复播同一档语音', pots3[4].join());
  check(h3.combo.multi === 4, '多响档位封顶在 4', `multi=${h3.combo.multi}`);
  check(h3.combo.streak === 5, '一杆多颗仍按实际球数累计连击', `streak=${h3.combo.streak}`);
}

/* ---------------- [18] 连击中断 ---------------- */
export function testComboBreak() {
  console.log('\n[18] 连击播报：中断与重开');
  // 二连之后空杆一杆，连击清零
  const h = makeCombo();
  playShots(h, [1, 1]);
  check(h.combo.streak === 2, '二连成立', `streak=${h.combo.streak}`);
  const after = playShots(h, [0]);
  check(h.combo.streak === 0, '空杆清零', `streak=${h.combo.streak}`);
  check(after.length === 0, '空杆不发声', `${after.length} 次播报`);

  const next = playShots(h, [1]);
  check(next[0].join() === 'cheer', '断档后重新起算：又是只有欢呼', next[0].join());

  // 白球落袋：同样清零，而且这个 ball 不该被欢呼 —— 改播尴尬音
  const h2 = makeCombo();
  h2.combo.onShotStart();
  h2.combo.onPot(false);
  h2.take();
  h2.sfx.length = 0;
  h2.combo.onPot(true);
  check(h2.names().length === 0, '白球落袋不喝彩', h2.names().join());
  check(h2.sfx.join() === 'awkward', '白球落袋改播尴尬音', h2.sfx.join());
  check(h2.combo.streak === 0, '白球落袋中断连击', `streak=${h2.combo.streak}`);

  // 重开一局
  const h3 = makeCombo();
  playShots(h3, [1, 1, 1]);
  h3.combo.reset();
  check(h3.combo.streak === 0 && h3.combo.shotPots === 0, '重开一盘：连击与本杆计数归零');

  // 音量上限：连击再高也不会超过 cheerGain 的 1.35 倍
  check(AUDIO.cheerGain > 0 && AUDIO.voiceGain > AUDIO.applauseGain,
    '音量档位合理（语音 > 掌声垫底）', `cheer=${AUDIO.cheerGain} voice=${AUDIO.voiceGain} applause=${AUDIO.applauseGain}`);

  // 本地双人「进错球」：本该打自己那组，却打进了对方的球 → 连击当场断掉、不喝彩
  const h4 = makeCombo();
  playShots(h4, [1, 1, 1]);                  // 先攒到三连
  check(h4.combo.streak === 3, '进错球之前已经是三连', `streak=${h4.combo.streak}`);
  h4.take();
  h4.sfx.length = 0;
  h4.combo.onWrongPot();
  check(h4.combo.streak === 0, '进错球立刻清零连击', `streak=${h4.combo.streak}`);
  check(h4.names().length === 0, '进错球不喝彩（否则会以为自己打对了）', h4.names().join());
  check(h4.sfx.join() === 'awkward', '进错球播尴尬音，提示这一杆打错了', h4.sfx.join());

  // 进错球不算进球：本杆计数不涨，所以"一杆多响"不会被它顶上去
  const h5 = makeCombo();
  h5.combo.onShotStart();
  h5.combo.onPot(false);
  h5.combo.onWrongPot();
  check(h5.combo.shotPots === 1, '进错球不计进本杆进球数', `shotPots=${h5.combo.shotPots}`);
  h5.combo.onShotEnd();
  check(h5.combo.streak === 0, '一杆只进错了球 → 视为没进球，连击断掉');
}

/* ---------------- [19] 3D 定位只给球撞球 ---------------- */
export function testSpatialScope() {
  console.log('\n[19] 音效：3D 定位只给球撞球');
  const hit = makeEngine();
  VOICES.ballHit(hit, 3.0, 1, 2);
  check(hit.tones.length > 0 && hit.tones.every((s) => s.spatial === true),
    '球撞球走 3D 定位', `${hit.tones.length} 段声音`);

  for (const [name, args] of [['cushion', [3.0]], ['cueStrike', [1]], ['pocketDrop', []]]) {
    const e = makeEngine();
    VOICES[name](e, ...args);
    const any3D = e.tones.some((s) => s.spatial);
    check(!any3D && e.tones.length > 0, `${name}：固定音量，不做 3D`, `${e.tones.length} 段声音`);
  }

  // 轻轻蹭一下不该出声（球堆互相挤压时会连续触发极低速碰撞）
  const soft = makeEngine();
  VOICES.ballHit(soft, AUDIO.ballMin * 0.5, 0, 0);
  check(soft.tones.length === 0, '极低速碰撞不出声', `${AUDIO.ballMin * 0.5} m/s`);

  // 弱撞 vs 满力：响度应该差出一大截
  const light = makeEngine();
  const hard = makeEngine();
  VOICES.ballHit(light, 0.6, 0, 0);
  VOICES.ballHit(hard, 3.0, 0, 0);
  check(hard.tones[0].gain > light.tones[0].gain * 2,
    '撞得越重越响', `${light.tones[0].gain.toFixed(2)} → ${hard.tones[0].gain.toFixed(2)}`);
}

/* ---------------- [20] 结算音 / 尴尬音 / 自爆音 ---------------- */
export function testEventVoices() {
  console.log('\n[20] 音效：尴尬 / 胜利 / 失败 / 自爆');
  for (const name of ['awkward', 'fanfare', 'defeat', 'boom']) {
    const e = makeEngine();
    VOICES[name](e);
    const loud = e.tones.filter((s) => (s.gain || 0) > 0.05).length;
    check(e.tones.length > 0 && loud > 0, `${name}：有声音且不是哑的`, `${e.tones.length} 段`);
  }
  // 旋律类：用 delay 排的音符不能全挤在同一时刻
  const f = makeEngine();
  VOICES.fanfare(f);
  check(new Set(f.tones.map((s) => (s.delay || 0).toFixed(2))).size >= 3,
    '胜利号角是一串音符而不是一声', `${f.tones.length} 段`);

  // 音量整体比初版抬上来过（"太小"那次反馈）
  check(AUDIO.ballGain >= 1 && AUDIO.sfx >= 0.8 && AUDIO.clipBoost > 1,
    '音量档位已整体抬高', `ballGain=${AUDIO.ballGain} sfx=${AUDIO.sfx} clipBoost=${AUDIO.clipBoost}`);
  check(AUDIO.minAtten >= 0.4, '3D 最远衰减不再把声音掐没', `minAtten=${AUDIO.minAtten}`);
}
