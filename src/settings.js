import { AUDIO, SHOT } from './constants.js';
import { host } from './platform/index.js';
import { persistFromGame, patchPrefs } from './prefs.js';
import { getBallSet } from './rules.js';
import { renderHelp } from './help.js';
import { isNativeApp } from './android.js';

const MIN_GAP = 0.05;   // 最小力度与最大力度之间至少留这么多

/**
 * 游戏内界面接线：右下角动作条、帮助全屏弹窗、操作设置弹窗、返回主菜单确认。
 * ------------------------------------------------------------------
 * 布局约定（2026-09-16 调整）：
 *   · 顶部模式按钮已删除 —— 操作模式由启动器决定，游戏内只展示不改
 *   · 左下角「?」→ 全屏帮助弹窗（原来是常驻的左下角文字面板）
 *   · 右下角一排：视角回归 / 重开本局 / 设置
 *   · 「☰ 主菜单」移进设置弹窗顶部，点击先弹「放弃本局」确认
 *
 * @param state             全局状态
 * @param audio             AudioEngine（可为 null：无音频环境下跳过声音面板）
 * @param onMode(mode)          切换操作模式
 * @param onResetView()         视角回归
 * @param onRestart()           完全重开一盘（等同 R 键）
 * @param onBackToMenu()        返回启动器
 */
export function wireGameUI({ state, audio, onMode, onResetView, onRestart, onBackToMenu }) {
  if (!host.hasDOM) return;
  const id = (x) => host.byId(x);

  // ---------- 右下角动作条 ----------
  host.on(id('btn-reset-view'), 'click', onResetView);
  host.on(id('btn-restart'), 'click', onRestart);

  // ---------- 帮助：全屏弹窗 ----------
  const helpModal = id('help-modal');
  renderHelp(id('help-body'), { native: isNativeApp() });
  const openHelp = () => { helpModal.style.display = 'flex'; };
  const closeHelp = () => { helpModal.style.display = 'none'; state.uiBlocked = false; };
  host.on(id('btn-help'), 'click', () => { openHelp(); state.uiBlocked = true; });
  host.on(id('help-close'), 'click', closeHelp);
  host.on(helpModal, 'click', (e) => { if (e.target === helpModal) closeHelp(); });

  // ---------- 操作设置 ----------
  const modal = id('settings-modal');
  const confirm = id('confirm-menu');
  const minS = id('set-min');
  const maxS = id('set-max');
  const minV = id('set-min-val');
  const maxV = id('set-max-val');
  const lockNote = id('set-lock-note');
  const ballNote = id('set-ballset');
  const modeBtns = host.queryAll('#settings-modal [data-mode]');

  // 玩法规则是启动器的「游戏设置 → 规则设置」项：这里只读展示，免得两处改法不一致
  const set = getBallSet(state.ballSet);
  if (ballNote) ballNote.textContent = `玩法规则：${set.name}（${set.sub}）· 在启动器的「游戏设置 → 规则设置」里更改`;

  // 锁定：三个模式按钮禁用，只把当前模式标出来
  if (state.modeLocked) {
    for (const el of modeBtns) el.disabled = true;
    if (lockNote) lockNote.hidden = false;
  }

  const sync = () => {
    for (const el of modeBtns) {
      el.classList.toggle('active', el.getAttribute('data-mode') === state.mode);
    }
    minS.value = SHOT.minImpulse.toFixed(2);
    maxS.value = SHOT.maxImpulse.toFixed(2);
    minV.textContent = SHOT.minImpulse.toFixed(2);
    maxV.textContent = SHOT.maxImpulse.toFixed(2);
  };

  const openSettings = () => {
    modal.style.display = 'flex';
    state.uiBlocked = true;
    sync();
    syncAudio?.();
  };
  const closeSettings = () => {
    modal.style.display = 'none';
    confirm.style.display = 'none';
    state.uiBlocked = false;
  };

  host.on(id('btn-settings'), 'click', openSettings);
  host.on(id('settings-close'), 'click', closeSettings);
  host.on(modal, 'click', (e) => { if (e.target === modal) closeSettings(); });

  for (const el of modeBtns) {
    host.on(el, 'click', () => {
      if (state.modeLocked) return;
      const m = el.getAttribute('data-mode');
      onMode(m);
      persistFromGame(m, state.ballSet);   // 游戏内改的模式，启动器下次打开也能看到
      sync();
    });
  }

  // ---------- 非己方球半透明（只在本地双人 / 人机里生效，见 main.js 的 refreshGhost） ----------
  // 与画面强相关的开关：点了立刻生效（下一帧 refreshGhost 就会照新值重刷一次材质），
  // 但也要落盘 —— 不然下一次进游戏又变回默认，玩家会以为"设置没记住"。
  const ghostBtns = host.queryAll('#set-ghost [data-ghost]');
  const syncGhost = () => {
    for (const el of ghostBtns) {
      el.classList.toggle('active', el.getAttribute('data-ghost') === (state.ghostOn ? 'on' : 'off'));
    }
  };
  for (const el of ghostBtns) {
    host.on(el, 'click', () => {
      state.ghostOn = el.getAttribute('data-ghost') !== 'off';
      syncGhost();
      patchPrefs({ ghost: state.ghostOn ? 'on' : 'off' });
    });
  }
  syncGhost();

  // ---------- 声音：音效 / 背景音乐音量 + 曲目 ----------
  // 与启动器共用同一份设置（同一个 storage key），两边改动互相同步。
  const syncAudio = audio ? wireAudioUI(audio) : null;

  /** 拖动滑块：立刻作用于当前对局，并（合并后）落盘 */
  const onSlide = () => {
    let lo = parseFloat(minS.value);
    const hi = parseFloat(maxS.value);
    if (lo > hi - MIN_GAP) { lo = hi - MIN_GAP; minS.value = lo.toFixed(2); }
    SHOT.minImpulse = lo;
    SHOT.maxImpulse = hi;
    minV.textContent = lo.toFixed(2);
    maxV.textContent = hi.toFixed(2);
    persistFromGame(state.mode, state.ballSet);
  };
  host.on(minS, 'input', onSlide);
  host.on(maxS, 'input', onSlide);

  // ---------- 返回主菜单：先确认「是否放弃本局」 ----------
  const menuBtn = id('btn-menu');
  if (menuBtn && onBackToMenu) {
    menuBtn.hidden = false;                       // 网页直开游戏页时没有主菜单可回，保持隐藏
    host.on(menuBtn, 'click', () => { confirm.style.display = 'flex'; });
  }
  host.on(id('confirm-cancel'), 'click', () => { confirm.style.display = 'none'; });
  host.on(id('confirm-ok'), 'click', () => {
    confirm.style.display = 'none';
    modal.style.display = 'none';
    state.uiBlocked = false;
    onBackToMenu?.();
  });

  // ---------- 键盘：Esc 逐层关闭 ----------
  // ⚠️ 0.7.0（体检 B4）：result / ask 两个弹窗各有自己的 Esc 处理（confirm.js / result.js）。
  //    以前三个 keydown 并存，Esc 一按会把两层一起关掉（比如"重开确认 + 设置面板"同时消失）。
  //    这里只管自己这一层及以下的 confirm-menu / help / settings，高层开着就让路。
  const highModals = [id('result-modal'), id('ask-modal')];
  host.on(globalThis, 'keydown', (e) => {
    if (e.key !== 'Escape') return;
    if (highModals.some((m) => m && m.style.display === 'flex')) return;
    if (confirm.style.display === 'flex') { confirm.style.display = 'none'; return; }
    if (helpModal.style.display === 'flex') { closeHelp(); return; }
    if (modal.style.display === 'flex') closeSettings();
  });

  sync();
}

/**
 * 声音面板：音效音量 / 背景音乐音量 / 曲目。
 * 三条设置都走 AudioEngine.set()，由它统一落盘并通知 Music。
 * @returns 刷新 UI 的函数
 */
function wireAudioUI(audio) {
  const id = (x) => host.byId(x);
  const sfx = id('set-sfx');
  const mus = id('set-music');
  const sfxV = id('set-sfx-val');
  const musV = id('set-music-val');
  const bgmBtns = host.queryAll('#set-bgm [data-bgm]');
  const pct = (v) => String(Math.round(v * 100));

  const sync = () => {
    const s = audio.settings;
    sfx.value = pct(s.sfx);
    sfxV.textContent = pct(s.sfx);
    mus.value = pct(s.music);
    musV.textContent = pct(s.music);
    for (const el of bgmBtns) el.classList.toggle('active', el.getAttribute('data-bgm') === s.bgm);
  };

  host.on(sfx, 'input', () => { audio.set({ sfx: +sfx.value / 100 }); sync(); });
  host.on(mus, 'input', () => { audio.set({ music: +mus.value / 100 }); sync(); });
  for (const el of bgmBtns) {
    host.on(el, 'click', () => {
      const track = el.getAttribute('data-bgm');
      // 选曲目却把音乐拖到 0 了：替用户拉回默认值，否则"选了没声音"像个 bug
      if (track !== 'off' && audio.settings.music < 0.01) audio.set({ music: AUDIO.music });
      audio.set({ bgm: track });
      sync();
    });
  }
  sync();
  return sync;
}
