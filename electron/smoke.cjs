/**
 * Electron 自检（HMZQ_SMOKE=1）
 * ------------------------------------------------------------------
 * 分四段跑：
 *   ① 启动器 —— 菜单项、球体设置、人机对战四档展开、声音面板、背景图毛玻璃与位移动画，
 *               并验证「切曲目 + 拖音量」真的写进了 userData/settings.json
 *   ② 游戏本体 —— WebGL 正常、底部动作条、帮助全屏弹窗、设置弹窗里的「返回主菜单」确认、
 *               玩法规则端到端生效（中式黑八 → HUD 显示 0 / 15）、未开发的斯诺克 / 俄式点了不生效，
 *               以及 file:// 下音频能解码
 *   ③ 特殊失败 —— ?ending=foul8 直接端出「黑 8 提前落袋」结算窗（备用规则的弹窗）
 *   ④ 胜利结算 —— ?ending=win，检查统计行，点「再来一局」能关掉
 * 跑完把启动器与声音设置还原成自检前的样子，结果打成 JSON 打到 stdout 后退出。
 */
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const { LAUNCHER_PROBE, GAME_PROBE, RESULT_PROBE, readConsoleEvent } = require('./probes.cjs');

const PREFS_KEY = 'hmzq.prefs.v1';
const AUDIO_KEY = 'hmzq.audio.v1';        // 声音设置（启动器与游戏共用）
const GAME_HTML = require('node:path').join(__dirname, '..', 'dist-electron', 'index.html');

function attachSmoke(w, app) {
  const consoleErrors = [];
  const consoleWarns = [];
  let phase = 0;
  let launcher = null;
  let savedPrefs = '';
  let savedAudio = '';

  const exec = (script) => w.webContents.executeJavaScript(script).catch(() => null);
  const disp = (id) => `getComputedStyle(document.getElementById('${id}')).display`;
  /** 直接跳到游戏页（带参数），用来预览某一类结算 */
  const openGame = (query) => w.loadFile(GAME_HTML, { query });

  const timer = setTimeout(() => report({ ok: false, why: '超时：75s 内未跑完四段自检' }), 75000);

  w.webContents.on('console-message', (...args) => {
    const { level, msg } = readConsoleEvent(args);
    const text = String(msg || '').slice(0, 200);
    if (!text) return;
    if (level === 'error' || level === 3) consoleErrors.push(text);
    else if (level === 'warning' || level === 2) consoleWarns.push(text);
  });

  w.webContents.on('did-finish-load', async () => {
    phase += 1;

    // ---------- 第一段：启动器 ----------
    if (phase === 1) {
      await wait(2200);
      savedPrefs = await exec(`window.__electron ? window.__electron.settings.get('${PREFS_KEY}') : ''`) || '';
      savedAudio = await exec(`window.__electron ? window.__electron.settings.get('${AUDIO_KEY}') : ''`) || '';
      launcher = await probe(w, LAUNCHER_PROBE);

      // 进「常规模式 → 人机对战」，确认四档难度真的露出来（现在是独立子页，不是就地展开）
      await exec(`document.querySelector('.mi[data-go="start"]')?.click(); true`);
      await wait(280);
      await exec(`document.querySelector('[data-go="start/ai"]')?.click(); true`);
      await wait(380);
      const aiOpen = await probe(w, `(() => {
        const b = document.querySelector('[data-page="start/ai"]');
        if (!b) return null;
        const cs = getComputedStyle(b);
        return {
          on: b.classList.contains('on'), display: cs.display,
          h: Math.round(b.getBoundingClientRect().height),
          chips: b.querySelectorAll('.chip-btn').length,
        };
      })()`);
      const aiOK = !!aiOpen && aiOpen.on && aiOpen.display !== 'none' && aiOpen.h > 0 && aiOpen.chips === 4;
      // 四档难度（含「极难」）都是**真入口**（不再是"敬请期待"）：点一下就会带着
      // ?game=ai&diff=xxx 进球台，所以这里只能查属性、不能真点（真点了就离开启动器了）。
      const aiReal = await probe(w, `(() => {
        const b = [...document.querySelectorAll('[data-page="start/ai"] .chip-btn')];
        return b.map((x) => (x.getAttribute('data-enter-game') || '') + ':' + (x.getAttribute('data-diff') || '')).sort().join(',');
      })()`);
      if (aiReal !== 'ai:easy,ai:extreme,ai:hard,ai:normal') {
        return report({ ok: false, stage: 'launcher-ai-real', aiReal, consoleErrors });
      }
      // 反过来：「在线联机」这类**占位**点了必须纹丝不动（不能偷偷进游戏）
      await exec(`document.querySelector('[data-soon]')?.click(); true`);
      await wait(250);
      const stayPut = await probe(w, `(() => {
        const b = document.querySelector('.page.on');
        return b ? b.getAttribute('data-page') : '';
      })()`);
      if (stayPut !== 'start/ai') {
        return report({ ok: false, stage: 'launcher-ai-stay', stayPut, consoleErrors });
      }

      const ok = launcher
        && launcher.menuCount === 7              // 加了「娱乐模式」一级菜单
        && launcher.hasEnter && launcher.hasRules && launcher.hasAiPage
        && launcher.ballSetBtns === 3 && launcher.ballSetOn === '中式黑八'   // 中式黑八 + 斯诺克 / 俄式两个占位
        && launcher.aiChips === 4 && launcher.aiClosedInitially && aiOK
        && launcher.soonChips === 6               // 在线联机 + 娱乐模式 3 个 + 斯诺克 / 俄式 2 个（人机四档已转正成真入口，不再是占位）
        && launcher.ballMetaLines === 3
        && launcher.audioSliders && launcher.audioTracks === 3
        && ['lounge', 'park', 'off'].includes(launcher.audioTrackOn)
        && launcher.audioHint.length > 0
        && launcher.bgLoaded
        && /blur/.test(launcher.bgFilter)
        && launcher.bgAnim === 'bgPan'
        && launcher.pageErrors.length === 0;
      if (!ok) return report({ ok: false, stage: 'launcher', launcher, aiOpen, consoleErrors });

      // 声音设置：切曲目 + 拖音量，确认真的写进了存储（游戏里读同一个 key）
      await exec(`document.querySelector('#p-bgm button[data-bgm="park"]').click(); true`);
      await exec(`
        (function () {
          var s = document.getElementById('p-sfx');
          s.value = 25;
          s.dispatchEvent(new Event('input', { bubbles: true }));
          return true;
        })()
      `);
      await wait(320);
      const audioStore = await exec(`window.__electron ? window.__electron.settings.get('${AUDIO_KEY}') : ''`);
      const audioSaved = (() => {
        try { return JSON.parse(audioStore || '{}'); } catch { return {}; }
      })();
      if (audioSaved.bgm !== 'park' || Math.abs((audioSaved.sfx ?? 1) - 0.25) > 0.02) {
        return report({ ok: false, stage: 'launcher-audio', audioSaved, consoleErrors });
      }

      // 端到端验玩法规则：未开发的斯诺克 / 俄式是禁用按钮，点了不能把选择改走；
      // 留在中式黑八 → 进游戏应显示 0 / 15
      const beforeSel = await probe(w, `document.querySelector('#p-balls button.on').dataset.balls`);
      await exec(`document.querySelector('#p-balls button[data-balls="snooker"]').click(); true`);
      await exec(`document.querySelector('#p-balls button[data-balls="russian"]').click(); true`);
      await wait(320);
      const afterSel = await probe(w, `document.querySelector('#p-balls button.on').dataset.balls`);
      if (beforeSel !== afterSel) {
        return report({ ok: false, stage: 'launcher-rules-soon', beforeSel, afterSel, consoleErrors });
      }

      try {
        await w.webContents.executeJavaScript(
          `document.querySelector('[data-enter-game="free"]').click(); true`
        );
      } catch {
        /* 点击触发了导航，脚本上下文被销毁会抛错 —— 属预期 */
      }
      return;
    }

    // ---------- 第二段：游戏本体 + 新界面 ----------
    if (phase === 2) {
      await wait(6000);
      const game = await probe(w, GAME_PROBE);

      // 帮助：左下角「?」→ 全屏弹窗 → 关闭
      await exec(`document.getElementById('btn-help').click(); true`);
      await wait(260);
      const helpBox = await probe(w, `(() => {
        const m = document.getElementById('help-modal');
        const r = m.getBoundingClientRect();
        return { display: getComputedStyle(m).display, w: Math.round(r.width), h: Math.round(r.height), vw: innerWidth, vh: innerHeight };
      })()`);
      await exec(`document.getElementById('help-close').click(); true`);
      await wait(180);
      const helpClosed = await probe(w, disp('help-modal'));

      // 设置：弹窗打开 → 顶部「☰ 主菜单」可见 → 点它弹「放弃本局」确认
      await exec(`document.getElementById('btn-settings').click(); true`);
      await wait(300);
      const setOpen = await probe(w, `(() => {
        const m = document.getElementById('settings-modal');
        const b = document.getElementById('btn-menu');
        return {
          display: getComputedStyle(m).display,
          menuBtn: !!b && !b.hidden,
          menuBtnH: b ? Math.round(b.getBoundingClientRect().height) : 0,
          menuBtnText: b ? b.textContent.trim() : '',
          ballNote: (document.getElementById('set-ballset') || {}).textContent || '',
        };
      })()`);
      await exec(`document.getElementById('btn-menu').click(); true`);
      await wait(220);
      const confirmOpen = await probe(w, disp('confirm-menu'));
      const confirmText = await probe(w, `document.getElementById('confirm-menu').textContent`);
      await exec(`document.getElementById('confirm-cancel').click(); true`);
      await wait(180);
      const confirmClosed = await probe(w, disp('confirm-menu'));
      // 重开本局：点一下确认不会报错（球位/击球数归零）
      await exec(`document.getElementById('btn-restart').click(); true`);
      await wait(400);
      const afterRestart = await probe(w, GAME_PROBE);
      await exec(`document.getElementById('settings-close').click(); true`);

      // 文件协议下音频能不能真的解码：file:// 会拦 fetch，媒体元素不受影响，
      // 这一项就是在替 "素材路径 / 打包后是否带上" 兜底。
      const mediaProbe = await exec(`
        (function () {
          window.__au = { done: false, dur: 0, err: '' };
          var a = new Audio('audio/cheer.ogg');
          a.preload = 'auto';
          a.addEventListener('loadedmetadata', function () { window.__au.dur = a.duration; window.__au.done = true; });
          a.addEventListener('error', function () { window.__au.err = 'load error'; window.__au.done = true; });
          a.load();
          return true;
        })()
      `);
      await wait(1600);
      const au = await probe(w, 'window.__au');

      const ui = {
        helpBox, helpClosed, setOpen, confirmOpen, confirmClosed,
        confirmAsks: /放弃本局/.test(String(confirmText || '')),
        audioTrackOn: afterRestart.audioTrackOn,
        media: au, mediaProbe,
      };
      const uiOK = ui.helpBox.display === 'flex'
        && ui.helpBox.w >= ui.helpBox.vw - 2 && ui.helpBox.h >= ui.helpBox.vh - 2   // 全屏
        && ui.helpClosed === 'none'
        && ui.setOpen.display === 'flex' && ui.confirmOpen === 'flex'
        && ui.confirmClosed === 'none' && ui.confirmAsks
        && setOpen.menuBtn && setOpen.menuBtnH > 0 && /主菜单/.test(setOpen.menuBtnText)
        && /中式黑八/.test(setOpen.ballNote)
        && !!au && au.done && au.dur > 0.2 && !au.err;      // file:// 下 cheer.ogg 能解码
      const gameOK = game.ok
        && game.modeBtnRemoved && game.helpPanelRemoved
        && game.dockBtns === 3 && game.resetViewInDock
        && game.hasRestart && game.hasHelpBtn
        && game.audioSliders && game.audioTracks === 3      // 游戏内也有同一套声音设置
        && game.helpSections === 6                          // 基本操作 / 触摸 / 开球 / 界面 / 音效 / 玩法规则
        && game.cssApplied === 'fixed'
        && game.potted === '0 / 15'                      // 玩法规则端到端生效
        && afterRestart.potted === '0 / 15'
        && afterRestart.pageErrors.length === 0
        && game.pageErrors.length === 0;

      if (!uiOK || !gameOK) {
        return finish({ ok: false, stage: 'game', launcher, game, ui, consoleErrors, consoleWarns });
      }
      // 进入第三段：预览「黑 8 提前落袋」的结算弹窗（备用规则，默认不自动触发）
      await openGame({ from: 'launcher', lock: '1', ending: 'foul8' });
      return;
    }

    // ---------- 第三段：特殊失败弹窗（黑 8 自爆，备用） ----------
    if (phase === 3) {
      await wait(6000);
      const foul = await probe(w, RESULT_PROBE);
      const foulOK = foul.display === 'flex' && foul.visible
        && foul.tone === 'boom' && foul.tag === 'FOUL'
        && /黑 8/.test(foul.title) && foul.sub.length > 0
        // ⚠️ 别写死行数：「进球率」那行只在打过球（shots > 0）时才渲染 ——
        //    直接用 ending 端出来的局面没有击球记录 → 3 行；真打过几杆 → 4 行。
        && foul.statRows >= 3 && foul.statRows <= 4
        && foul.hasAgain && foul.hasMenu
        && foul.pageErrors.length === 0;
      if (!foulOK) return finish({ ok: false, stage: 'result-foul8', foul, consoleErrors });

      // 第四段：胜利结算
      await openGame({ from: 'launcher', lock: '1', ending: 'win' });
      return;
    }

    // ---------- 第四段：胜利结算 ----------
    if (phase === 4) {
      await wait(6000);
      const win = await probe(w, RESULT_PROBE);
      await exec(`document.getElementById('result-again').click(); true`);
      await wait(500);
      const closed = await probe(w, disp('result-modal'));
      const winOK = win.display === 'flex' && win.visible
        && win.tone === 'win' && win.tag === 'VICTORY'
        && /清\s*台/.test(win.title) && win.statRows >= 3 && win.statRows <= 4   // 同上：进球率行是有条件的
        && closed === 'none' && win.pageErrors.length === 0;
      finish({
        ok: winOK, stage: 'result-win', win, closed, consoleErrors, consoleWarns,
      });
    }
  });

  /** 收尾：还原设置 → 打结果 → 退出 */
  async function finish(payload) {
    // 把启动器设置还原成进入自检之前的样子，别污染开发环境
    if (savedPrefs) {
      await exec(`window.__electron && window.__electron.settings.set('${PREFS_KEY}', ${JSON.stringify(savedPrefs)}); true`);
    }
    if (savedAudio) {
      await exec(`window.__electron && window.__electron.settings.set('${AUDIO_KEY}', ${JSON.stringify(savedAudio)}); true`);
    } else {
      // 之前从没存过声音设置：回写一份默认值，别把自检里"切了一刀"的值留在用户环境里
      await exec(`window.__electron && window.__electron.settings.set('${AUDIO_KEY}', '{"sfx":0.85,"music":0.4,"bgm":"lounge"}'); true`);
    }
    report(payload);
  }

  async function probe(target, script) {
    try {
      return await target.webContents.executeJavaScript(script);
    } catch (e) {
      return { ok: false, why: String(e) };
    }
  }

  function report(payload) {
    clearTimeout(timer);
    console.log('[smoke] ' + JSON.stringify(payload, null, 2));
    // Windows 上 Electron 是 GUI 子系统程序：stdout 一旦被重定向（管道 / 文件），
    // 整段输出可能**一个字都收不到** —— 而进程照常退出、exit code 也照常正确。
    // 实测过：命令返回 0、日志 0 字节，光看输出会误判成"自检没跑"。
    // 所以除了打印，再按需落一份文件；自动化里以这份文件为准。
    const outFile = process.env.HMZQ_SMOKE_OUT;
    if (outFile) {
      try {
        require('node:fs').writeFileSync(outFile, JSON.stringify(payload, null, 2), 'utf8');
      } catch { /* 写不进去也不影响退出码 */ }
    }
    app.exit(payload.ok ? 0 : 1);
  }
}

module.exports = { attachSmoke };
