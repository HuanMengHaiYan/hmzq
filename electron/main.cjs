/**
 * Electron 主进程（第二阶段：桌面 exe；第三阶段起带启动器）
 * ------------------------------------------------------------------
 * 只做窗口壳：建窗、加载启动器页、转发少量桌面能力给渲染进程。
 * 游戏本体与启动器都是 dist-electron/ 里的普通网页，与浏览器端同一套代码。
 *
 * 加载顺序：launcher.html（菜单）→ 点「自由模式」→ index.html?mode=...（游戏）
 *
 * 开发：VITE_DEV_SERVER_URL 有值时加载 vite dev server（热更新）
 * 生产：加载 dist-electron/launcher.html（file://，因此构建必须是 IIFE 而非 ESM）
 *
 * 自检（HMZQ_SMOKE=1）放在 electron/smoke.cjs：它会自己点一遍启动器与游戏，
 * 把结构检查的结果打到 stdout 后退出。打包前跑一遍，避免交付一个白屏的 exe。
 */
const { app, BrowserWindow, Menu, ipcMain, screen } = require('electron');
const path = require('node:path');
const fs = require('node:fs');

const DEV_URL = process.env.VITE_DEV_SERVER_URL;
const SMOKE = process.env.HMZQ_SMOKE === '1';
const { attachSmoke } = require('./smoke.cjs');
const DIST = path.join(__dirname, '..', 'dist-electron');

let win = null;

/* ---------------------------------------------------------
 * 设置持久化：userData/settings.json，结构是 { "<key>": <任意 JSON> }
 * 渲染进程（启动器与游戏共用）通过 preload 的 __electron.settings 同步读写。
 * ------------------------------------------------------- */
const storeFile = () => path.join(app.getPath('userData'), 'settings.json');

function readStore() {
  try {
    const o = JSON.parse(fs.readFileSync(storeFile(), 'utf8'));
    return o && typeof o === 'object' ? o : {};
  } catch {
    return {};                       // 首次运行 / 文件损坏都当成空表
  }
}

function writeStore(o) {
  try {
    fs.mkdirSync(path.dirname(storeFile()), { recursive: true });
    fs.writeFileSync(storeFile(), JSON.stringify(o, null, 2));
  } catch (e) {
    console.error('[settings] 写入失败：' + e.message);
  }
}

ipcMain.on('settings:get', (e, key) => {
  const v = readStore()[key];
  e.returnValue = v === undefined ? '' : JSON.stringify(v);
});

ipcMain.on('settings:set', (e, key, json) => {
  const store = readStore();
  try {
    store[key] = JSON.parse(json);
  } catch {
    delete store[key];
  }
  writeStore(store);
  e.returnValue = true;
});

/* 渲染进程通过 preload 请求的其它桌面能力 */
ipcMain.on('toggle-fullscreen', () => {
  if (win) win.setFullScreen(!win.isFullScreen());
});

ipcMain.on('quit', () => app.quit());

/* ---------------------------------------------------------
 * 窗口
 * ------------------------------------------------------- */
function createWindow() {
  const area = screen.getPrimaryDisplay().workAreaSize;
  const w = Math.min(1440, Math.round(area.width * 0.86));
  const h = Math.min(900, Math.round(area.height * 0.86));

  win = new BrowserWindow({
    width: w,
    height: h,
    minWidth: 900,
    minHeight: 560,
    title: '幻梦桌球',
    backgroundColor: '#05070b',
    show: false,
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });

  win.once('ready-to-show', () => win?.show());
  win.on('closed', () => { win = null; });

  loadLauncher(win);

  if (SMOKE) attachSmoke(win, app);
}

function loadLauncher(w) {
  if (DEV_URL) {
    w.loadURL(new URL('launcher.html', DEV_URL).href);
  } else {
    w.loadFile(path.join(DIST, 'launcher.html'));
  }
}

app.whenReady().then(() => {
  Menu.setApplicationMenu(null);     // 去掉默认菜单栏（游戏用不到，F11 仍可全屏）
  createWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
