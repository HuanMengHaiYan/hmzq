/**
 * 用 Electron 跑已构建的产物（npm run electron:start）。
 * 与直接 `electron .` 的区别：清掉 ELECTRON_RUN_AS_NODE ——
 * VS Code 集成终端、部分沙箱会注入它，导致 electron.exe 退化成纯 Node，
 * 表现是 require('electron') 返回一个路径字符串、app 为 undefined。
 */
import { spawnSync } from 'node:child_process';
import electronPath from 'electron';

const env = { ...process.env };
delete env.ELECTRON_RUN_AS_NODE;

const r = spawnSync(electronPath, ['.'], { stdio: 'inherit', env });
process.exit(r.status ?? 1);
