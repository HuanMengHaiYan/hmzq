import { defineConfig } from 'vite';

/**
 * file:// 页面加载 <script type="module"> 会被 Chromium 以 CORS（origin null）拦掉，
 * 即便产物本身是 IIFE。这里在构建最后一步把入口脚本改成 defer 的经典脚本
 * （保留 defer，否则会早于 DOM 执行导致找不到挂载点）。
 */
function classicScriptForFileProtocol() {
  return {
    name: 'hmzq-classic-script',
    enforce: 'post',
    transformIndexHtml(html) {
      return html.replace(/<script type="module"([^>]*)src=/g, '<script defer src=');
    },
  };
}

/**
 * Electron 专用构建（输出到 dist-electron/）
 * ------------------------------------------------------------------
 * 与浏览器构建（vite.config.js → dist/）的区别只有两点：
 *   1. base: './'      —— Electron 用 file:// 加载，资源路径必须相对
 *   2. format: 'iife'  —— Chromium 禁止 file:// 页面加载 ES module（CORS origin null），
 *                         所以必须打成经典脚本；依赖（three / rapier）全部内联，
 *                         rapier 的 wasm 是 base64 内联的，file:// 下同样可用。
 */
export default defineConfig({
  base: './',
  plugins: [classicScriptForFileProtocol()],
  build: {
    outDir: 'dist-electron',
    emptyOutDir: true,
    target: 'es2020',
    // 全部内联，避免 file:// 下的额外请求。
    // ⚠️ 0.8.0 起这项也管着台球桌模型（src/assets/table-9ft.glb，约 2.6 MB）：
    //    GLTFLoader 走 fetch，而 Chromium 会拦掉 file:// 的 fetch（和音频那边同一个坑），
    //    所以模型必须以 data: URI 的形式内联进 JS。上限因此抬到 4 MB。
    assetsInlineLimit: 4 * 1024 * 1024,
    rollupOptions: {
      output: {
        format: 'iife',
        inlineDynamicImports: true,
        entryFileNames: 'assets/[name].js',
        chunkFileNames: 'assets/[name].js',
        assetFileNames: 'assets/[name][extname]',
      },
    },
  },
});
