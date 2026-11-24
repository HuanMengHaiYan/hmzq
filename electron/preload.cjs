/**
 * 预加载脚本：只向渲染进程暴露最小桌面能力。
 * 平台层的 host.desktop 就是靠 window.__electron 判断当前是否在 Electron 里。
 *
 * settings 用 sendSync（同步）而不是 invoke：平台层的 storage.get/set 是同步接口，
 * 游戏与启动器的初始化代码都直接读值，改成异步会污染一大片调用点。
 * 读写的是一个几百字节的小 JSON，同步开销可以忽略。
 */
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('__electron', {
  isElectron: true,
  versions: {
    node: process.versions.node,
    chrome: process.versions.chrome,
    electron: process.versions.electron,
  },
  toggleFullscreen: () => ipcRenderer.send('toggle-fullscreen'),
  quit: () => ipcRenderer.send('quit'),
  settings: {
    get: (key) => ipcRenderer.sendSync('settings:get', key),
    set: (key, json) => ipcRenderer.sendSync('settings:set', key, json),
  },
});
