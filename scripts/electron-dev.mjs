/**
 * 开发用：起 vite dev server → 等端口就绪 → 拉起 Electron（带热更新）。
 * 用法：npm run electron:dev
 */
import { spawn } from 'node:child_process';
import { createServer } from 'vite';
import electronPath from 'electron';

const server = await createServer({
  configFile: 'vite.config.js',
  server: { port: 5183, strictPort: false },
});
await server.listen();

const url = server.resolvedUrls.local[0];
console.log(`[dev] vite: ${url}`);

// 清掉 ELECTRON_RUN_AS_NODE：VS Code 终端等环境会注入，会让 electron 退化成纯 Node
const env = { ...process.env, VITE_DEV_SERVER_URL: url };
delete env.ELECTRON_RUN_AS_NODE;

const child = spawn(electronPath, ['.'], { stdio: 'inherit', env });

const shutdown = () => {
  child.kill();
  server.close().finally(() => process.exit(0));
};
child.on('exit', shutdown);
process.on('SIGINT', shutdown);
