import { defineConfig } from 'vite';
import os from 'node:os';

// ---------------------------------------------------------------------------
// 老内核（MIUI 浏览器 / 老 WebView / 老 Chrome）在 dev 模式下无解，这里做两件事：
//   1. 手机打开 dev 地址时，直接给一句人话 + 该用的地址，而不是 "Unexpected token ."；
//   2. dev / preview 用不同端口（5183 / 5184），杜绝"打开了错的地址还看不出来"。
// 判定保守：只有能明确看出内核偏旧时才拦，认不出来一律放行（桌面 Chrome / Edge 不受影响）。
// ---------------------------------------------------------------------------
function isOldKernel(ua) {
  ua = String(ua || '');
  const chrome = /Chrome\/(\d+)/.exec(ua); // 覆盖 Chrome / Edge / Opera / 国产壳（它们的 UA 里都带 Chrome/x）
  if (chrome) return Number(chrome[1]) < 80; // 可选链 ?. / 空值合并 ?? 需要 Chrome 80+
  const ff = /Firefox\/(\d+)/.exec(ua);
  if (ff) return Number(ff[1]) < 74; // Firefox 74+ 才有 ?.
  const sf = /Version\/(\d+)\.(\d+)[.\d]* Safari/.exec(ua);
  if (sf) return Number(sf[1]) < 13 || (Number(sf[1]) === 13 && Number(sf[2]) < 1); // Safari 13.1+
  return false;
}

// 本机局域网 IP：手机要打开的那个地址（拿不到就退回提示文案）
function lanIp() {
  try {
    for (const list of Object.values(os.networkInterfaces())) {
      for (const n of list || []) {
        if (n.family === 'IPv4' && !n.internal) return n.address;
      }
    }
  } catch (e) { /* ignore */ }
  return '本机局域网IP';
}

const PREVIEW_PORT = 5184;

function oldKernelPage(ua, previewPort) {
  const url = `http://${lanIp()}:${previewPort}/`;
  return `<!DOCTYPE html>
<html lang="zh-CN"><head>
<meta charset="UTF-8" />
<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover" />
<title>幻梦-星光桌球 · 请换一个地址</title>
<style>
  html,body{margin:0;background:#0f1317;color:#e8eef5;
    font:15px/1.8 system-ui,-apple-system,"PingFang SC","Microsoft YaHei",sans-serif}
  main{padding:22px 20px 40px;max-width:640px;margin:0 auto}
  h1{font-size:18px;font-weight:600;margin:0 0 14px}
  p{margin:0 0 14px;color:#cfdce8}
  code{background:#1b2229;padding:1px 6px;border-radius:5px;
    font-family:ui-monospace,Consolas,monospace;font-size:13px;color:#ffd9a8}
  .cmd{background:#161d24;border:1px solid #24303a;border-radius:12px;padding:14px 16px}
  .url{color:#ffb27d;font-weight:600;word-break:break-all}
  .note{color:#7a8b99;font-size:13px}
  pre{margin:22px 0 0;color:#5d6b78;font-size:11px;white-space:pre-wrap;word-break:break-all}
  ol{padding-left:20px;color:#cfdce8}
  li{margin-bottom:8px}
</style></head>
<body><main>
  <h1>这个地址在你手机上跑不起来（不是游戏坏了）</h1>
  <p>你现在打开的是 <b>npm run dev</b> 的地址（5183）。dev 模式是<b>原样下发源码、不转译语法</b>，
     而你手机的浏览器内核不认可选链 <code>?.</code> 这类新语法，所以脚本一行都执行不了 ——
     表现就是「HUD 出来了但没反应 + 红框报 Unexpected token .」。</p>
  <p>手机实测改用<b>构建产物</b>（已降级到 ES2019，你的内核能跑）：</p>
  <div class="cmd">
    <p style="margin:0 0 8px">① 在电脑上执行：<code>npm run preview:lan</code></p>
    <p style="margin:0">② 在手机上打开：<span class="url">${url}</span></p>
  </div>
  <p class="note">电脑上用 Chrome 调试仍然用 dev（5183），不受影响；preview 是 5184，两边可以同时开着。</p>
  <p class="note">如果换成 5184 仍然报同样的错，就更新手机里的「Android 系统 WebView」，或改用 Chrome / Edge 打开。</p>
  <pre>UA: ${ua}</pre>
</main></body></html>`;
}

export default defineConfig({
  server: {
    // host: true = 同时监听 0.0.0.0：手机能用局域网 IP 直接访问。
    // 但注意：dev 模式只适合**桌面**调试 —— 它不转译语法，老内核打不开（见下方中间件）。
    host: true,
    port: 5183,
    strictPort: true,
    open: false,
  },
  // 手机实测走**构建产物**：npm run preview:lan（:5184）
  preview: {
    host: true, // 同 dev：监听 0.0.0.0，手机用局域网 IP 访问
    port: PREVIEW_PORT,
    strictPort: true,
  },
  build: {
    // 语法降级到 ES2019 —— 手机自带浏览器（MIUI 浏览器 / 老 WebView）内核常停在 Chrome 70~79，
    // 而可选链 ?. 与空值合并 ?? 是 ES2020 语法：不降级的话整个包一行都跑不了，
    // 表现就是黑屏 + 红框 "Unexpected token ."（HUD 上仍是 HTML 里的初始值，因为脚本没执行）。
    // ES2019 目标会去掉 ?. ?? ||= 、把类字段/私有成员 # 降级，Chrome 73+ / Safari 13+ 可跑。
    // 代价：私有成员降级成 WeakMap 查找、类字段搬进构造函数，体积略增、性能影响可忽略。
    target: 'es2019',
    outDir: 'dist',
    // 关掉 modulePreload 的 polyfill：它生成的 helper 里用了 `import.meta.resolve`
    // —— 既是 ES2020 语法（会让 `npm run check:syntax` 判超标），又是 Chrome 105+ 才有的 API。
    // 我们不需要它：产物只有两个 chunk，主 chunk 加载时浏览器自己会去取，
    // 关掉后语法底线能老老实实停在 ES2019。（真正要求 75+ 的是 wasm，不是这个。）
    modulePreload: { polyfill: false },
    rollupOptions: {
      output: {
        // Capacitor 用动态 `import()` 按平台懒加载插件实现（Web / Android 各一份）。
        // 动态 import 被 acorn 归到 ES2020，会让 `npm run check:syntax` 判定超标；
        // 而插件实现总共不到 1KB，为它单独切一个 chunk 毫无意义。
        // 内联回主 bundle：语法底线干净，运行时也不用担心 https scheme 下动态取 chunk 出幺蛾子。
        //
        // 选项名：Vite 8（rolldown）里 `inlineDynamicImports: true` 已弃用，改为 `codeSplitting: false`
        // —— 实测产物字节完全一致（连 hash 都不变），只是警告没了。
        codeSplitting: false,
      },
    },
  },
  // rapier3d-compat 内联了 wasm（base64），无需额外插件
  optimizeDeps: {
    exclude: [],
  },
  plugins: [
    {
      name: 'hmzq:dev-old-kernel-notice',
      configureServer(server) {
        // 注意：middlewares.use 在 configureServer 里**同步**调用 → 注册在 Vite 内置中间件之前，
        // 所以能先一步拦下 HTML 导航（返回函数那种写法会排到内置中间件后面，就拦不住了）。
        server.middlewares.use((req, res, next) => {
          if (process.env.HMZQ_DEV_ALLOW_OLD) return next();
          if (String(req.headers.accept || '').indexOf('text/html') < 0) return next();
          const ua = String(req.headers['user-agent'] || '');
          if (!isOldKernel(ua)) return next();
          res.statusCode = 200;
          res.setHeader('Content-Type', 'text/html; charset=utf-8');
          res.setHeader('Cache-Control', 'no-store');
          res.end(oldKernelPage(ua, PREVIEW_PORT));
        });
        return () => {
          console.log(
            '\n  \x1b[33m▸ dev = 源码直出（不转译语法）：桌面调试用；\n' +
            '    手机 / 老内核请用 \x1b[1mnpm run preview:lan\x1b[0m\x1b[33m，然后访问 ' +
            `http://${lanIp()}:${PREVIEW_PORT}/\x1b[0m\n`
          );
        };
      },
      configurePreviewServer(server) {
        if (!server.httpServer) return;
        server.httpServer.once('listening', () => {
          const addr = server.httpServer.address();
          const port = addr && typeof addr === 'object' ? addr.port : PREVIEW_PORT;
          console.log(
            `\n  \x1b[32m▸ 手机实测（构建产物，老内核可跑）: \x1b[1mhttp://${lanIp()}:${port}/\x1b[0m` +
            `\n    桌面: http://localhost:${port}/   ·   改代码热更新请另开 npm run dev（:5183）\n`
          );
        });
      },
    },
  ],
});
