/**
 * 无头物理测试（不依赖浏览器 / Three.js）· 入口
 * 复用 src/layout.js 的同一份几何定义，验证：
 *   1. 初始摆球无穿模
 *   2. 6 个袋口传感器都能正确判定进袋
 *   3. 开球后球不会穿透库边 / 飞出台面
 *   4. 开球扩散效果与静止收敛时间
 *
 * 运行：node test/headless.mjs [每组开球次数]
 * 用例按主题拆分在 test/suites/ 下，公共工具在 test/lib/ 下。
 */
import RAPIER from '@dimforge/rapier3d-compat';
import { BALL_R, TABLE, PHYS } from '../src/constants.js';
import { summary } from './lib/harness.mjs';

import {
  testRackSpacing, testPocketSensors, testSurfaceHoldsBalls,
  testThroatCapture, testNormalPotting,
} from './suites/table-geometry.mjs';
import { testImpactVariance, testBreakFan, testSpinFriction } from './suites/sim-units.mjs';
import {
  testBreaks, testBreakPots, testGuardNoDeadlock, testBreakAsymmetry,
} from './suites/break-play.mjs';
import { testPocketLidFuse } from './suites/deadlock-fuses.mjs';
import { testBallSets, testBallSetRacks, testBallSetReset } from './suites/ball-sets.mjs';
import {
  testAudioAssets, testComboVoice, testMultiPot, testComboBreak,
  testSpatialScope, testEventVoices,
} from './suites/audio.mjs';
import { testResultCopy, testResultStats, testResultRules, testResultAi } from './suites/result.mjs';
import {
  testMobileFallback, testMobileFov, testMobileAssets, testModePanRules,
  testTopPanBounds, testShootLongPressGuard,
} from './suites/mobile.mjs';
import { testQualityMapping, testOrthoCoverage } from './suites/quality.mjs';
import { testPortraitOverview } from './suites/portrait.mjs';
import { testTrackingWatchCamera, testAimLock } from './suites/tracking.mjs';
import { testSoloModes } from './suites/modes.mjs';
import { testLauncherRoutes } from './suites/launcher.mjs';
import { testPrefsModule } from './suites/prefs.mjs';
import {
  testDuoGroups, testDuoBreak, testDuoAssign, testDuoEarlyEight,
  testDuoCueFoul, testDuoSnapshot, testDuoEighthLast, testDuoBreakEight,
  testDuoPotsByPlayer, testDuoFouls,
} from './suites/duo.mjs';
import {
  testAutoAimGeometry, testAutoAimPower, testAutoAimDuoTargets,
  testAutoAimLastResort, testAutoAimHitRate, testAutoAimHitRateAggregated,
} from './suites/autoaim.mjs';
import {
  testAiLevels, testAiPlanBasics, testAiPlaceCue, testAiHitRates,
} from './suites/ai.mjs';

await RAPIER.init();
console.log('Rapier 已初始化 · 台面 ' +
  `${(TABLE.halfL * 2).toFixed(2)}×${(TABLE.halfW * 2).toFixed(2)}m · 球直径 ${(BALL_R * 2000).toFixed(1)}mm · ` +
  `步长 1/${Math.round(1 / PHYS.timestep)}s`);

const RUNS = Number(process.argv[2] || 20);

// ---- 球台几何 ----
testRackSpacing();
testPocketSensors();
testSurfaceHoldsBalls();
testThroatCapture();
testNormalPotting();

// ---- 物理模型单元测试 ----
testImpactVariance();
testBreakFan();
testSpinFriction();

// ---- 音效：素材与连击播报（纯逻辑，不需要 Rapier） ----
testAudioAssets();
testComboVoice();
testMultiPot();
testComboBreak();
testSpatialScope();
testEventVoices();

// ---- 结算弹窗（纯逻辑） ----
testResultCopy();
testResultStats();
testResultRules();
testResultAi();          // 人机对战：赢了记胜利 / 输了提示失败的文案

// ---- 移动端适配（纯逻辑 + 静态资源；手势与手感靠真机实测） ----
await testMobileFallback();
testMobileFov();
testMobileAssets();
await testModePanRules();
await testTopPanBounds();
testShootLongPressGuard();

// ---- 画质设置 / 顶视视锥（纯逻辑） ----
testQualityMapping();
testOrthoCoverage();

// ---- 竖屏俯瞰机位（纯逻辑） ----
testPortraitOverview();

// ---- 追踪模式：击球后拉远看全场（纯逻辑） ----
testTrackingWatchCamera();

// ---- 蓄力期间的瞄准冻结（"松开开球后视角突然旋转"的护栏） ----
testAimLock();

// ---- 第三阶段：单人模式规则（计分 / 限次）+ 挑战历史 ----
testSoloModes();

// ---- 启动器：多级子路由与页面树（静态分析，不需要浏览器） ----
testLauncherRoutes();
testPrefsModule();

// ---- 规则设置：球体设置 ----
testBallSets();
testBallSetRacks();
testBallSetReset();

// ---- 本地双人模式：分组 / 开球 / 黑八 / 白球犯规（纯规则，不需要浏览器）----
testDuoGroups();
testDuoBreak();
testDuoAssign();
testDuoEarlyEight();
testDuoCueFoul();
testDuoSnapshot();
testDuoEighthLast();
testDuoBreakEight();
testDuoPotsByPlayer();
testDuoFouls();

// ---- 🎯 自动进球：幽灵球几何 / 力度反解 / 双人选球 / 实战命中率 ----
testAutoAimGeometry();
testAutoAimPower();
testAutoAimDuoTargets();
testAutoAimLastResort();
testAutoAimHitRateAggregated(160);

// ---- 🤖 人机对战 ----
testAiLevels();
testAiPlanBasics();
testAiPlaceCue();
testAiHitRates();

// ---- 开球玩法 ----
testBreaks();
testBreakPots(RUNS);
testGuardNoDeadlock(RUNS);
testPocketLidFuse();
testBreakAsymmetry(RUNS);

process.exit(summary() > 0 ? 1 : 0);
