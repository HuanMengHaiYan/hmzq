# npm scripts 速查（幻梦-星光桌球）

`package.json` 里 `scripts` 下的每一条都是干嘛的，以及**打 exe / 打 APK 分别该跑哪几条**。

---

## 一、总表

| 分类 | 命令 | 一句话 |
|---|---|---|
| 开发 | `npm run dev` | 起 dev server（:5183，源码直出、有热更新），**桌面调试用** |
| 开发 | `npm run build` | 浏览器构建 → `dist/`（语法降到 ES2019，手机 / 老内核能跑） |
| 开发 | `npm run preview` | 把已有的 `dist/` 起成本地服务（:5184），**不开构建** |
| 开发 | `npm run preview:lan` | 构建 + 起服务（:5184，监听 0.0.0.0），**手机实测用这条** |
| 测试 | `npm test` | 无头物理/逻辑 **674 项** + 渲染层 **31 项**，0 失败才算过 |
| 测试 | `npm run check` | 语法底线 + 内核自检卡 + 运行时 API，三道离线护栏一起跑 |
| 测试 | `npm run check:syntax` | 只验产物语法 ≤ ES2019（**先 build**） |
| 测试 | `npm run check:kernel` | 只验「浏览器内核过旧」自检卡在 9 种模拟内核下该不该弹 |
| 测试 | `npm run check:api` | 只扫产物里 > Chrome 83 的运行时 API（`--strict` 才失败） |
| 测试 | `npm run check:smoke` | 无头 Chrome 真开一次 `dist/`（能跑起来 / 无报错 / 有帧率） |
| 测试 | `npm run check:file` | 无头 Chrome + CDP 以 **file://** 打开 `dist-electron/`（与 Electron 同一条加载路径），验证 IIFE 产物在 `file://` 下可用 —— **Electron 窗口自检（HMZQ_SMOKE）起不来时的替代**（详见 `test/browser-file.mjs` 头注释） |
| 测试 | `npm run check:solo` | 无头 Chrome 走完 **15 段**端到端（启动器 → 摆球 → 结算 → 画质 → 移动端 → 本地双人（含定组后半透明）→ 玩法规则 → 🤖 人机对战） |
| Android | `npm run android:apk` | 打 **release** APK（需 `E:/android-tools` + `android/keystore.properties`） |
| Android | `npm run android:apk:debug` | 打 **debug** APK（不需要签名文件） |
| Android | `npm run apk:check` | 装机前核验：签名有效 + 包里 `index.html` 就是刚构建的 `dist` |
| Android | `npm run cap:sync` | 只把 `dist/` 同步进 Android 工程，**不打 APK** |
| 调参 | `npm run sweep` | 开球参数扫描（改 `BREAK_SHOCK` / `RACK` 前先跑） |
| 调参 | `npm run trace` | 开球轨迹探针（看某颗球怎么进的袋） |
| 桌面端 | `npm run build:electron` | Electron 专用构建 → `dist-electron/`（IIFE + 相对路径） |
| 桌面端 | `npm run electron:dev` | vite dev + Electron 窗口，带热更新 |
| 桌面端 | `npm run electron:start` | 构建 + 用 Electron 跑产物（不打包） |
| 桌面端 | **`npm run dist:exe`** | **打包 Windows exe → `release/`（安装版 + 便携版）** |
| 发布 | **`npm run dist:all`** | **一条命令出全部成品（exe 安装版 / 便携版 + APK），归集到指定文件夹** |

---

## 二、逐条说明

### 开发

- **`npm run dev`** → `vite`
  端口 **5183**，`host: true`（手机也能用局域网 IP 访问，但别真用）。
  dev 模式**原样下发源码、不转译语法**，所以老内核（MIUI 浏览器 / 老 WebView）打开会白屏报
  `Unexpected token .`。为此 `vite.config.js` 里挂了个中间件：识别到老内核 UA 时不报错，
  直接给一页人话引导去用 5184。**桌面 Chrome / Edge 调试用这条。**

- **`npm run build`** → `vite build`
  输出到 `dist/`，`target: 'es2019'`，同时关掉 `modulePreload` polyfill、把动态 import 内联
  （这两处的 helper 会用到 ES2020 语法 / Chrome 105+ API，会污染语法底线）。
  `public/` 下的文件（启动器、`history.js`、`launcher-quality.js`）原样拷贝。

- **`npm run preview`** → `vite preview`
  只起服务不构建（:5184），用来复看**已经存在的** `dist/`。

- **`npm run preview:lan`** → `vite build --emptyOutDir false && vite preview`
  构建 + 起 :5184。**手机 / 老内核实测走这条**，控制台会直接打印局域网地址。
  `--emptyOutDir false` 是故意的：不清空 `dist/`（本机有 safe-delete 钩子，vite 自己清目录会被拦）。

### 测试

- **`npm test`** → `node test/headless.mjs 24 && node test/scene.mjs`
  前半是无头物理/逻辑测试（**24** = 每组开球的采样次数，用例按主题拆在 `test/suites/`），
  后半是渲染层场景测试（Three.js 网格与 Rapier 刚体）。当前基线 **600 + 31，0 失败**。
  改完任何代码都该跑一遍。

- **`npm run check:syntax`** → `node test/syntax-floor.mjs`
  扫 `dist/` 产物，断言没有 ES2020 及以上的语法。**它读的是构建产物，所以必须先 `npm run build`**，
  否则验的是上一版。

- **`npm run check:kernel`** → `node test/kernel-selfcheck.mjs`
  把 `index.html` 里那段内核自检脚本抽出来，用假的 `Function` 构造器模拟 9 种内核，
  断言「该弹卡才弹卡、不该弹别弹」。
  > 背景（2026-09-19 事故）：自检卡自己把好机器挡在门外了 —— Chrome 83 的 WebView 只卡在 `||=`
  > （需 Chrome 85）上，但游戏从头到尾能跑，结果用户装机一进游戏就看到「内核过旧」卡。

- **`npm run check:api`** → `node test/api-floor.mjs`
  语法过关 ≠ 跑得起来。`String.replaceAll`（Chrome 85+）、`Object.hasOwn` 这类是**运行时 API**，
  语法检查抓不到，现象是页面能加载、跑到某处才抛 TypeError。按版本分档扫一遍并打印上下文。
  字符串匹配会有误报，所以默认只提示、退出码仍是 0；要卡 CI 就跑 `node test/api-floor.mjs --strict`。

- **`npm run check`** — 上面三条串起来跑。**改了 `index.html` 自检 / 升依赖 / 加了新语法后跑一次。**

- **`npm run check:smoke`** → `node test/browser-smoke.mjs`
  起静态服务托管 `dist/` + 无头 Chrome 打开，断言三件事：不弹内核卡、`window.__gameErrors` 为空、
  canvas 有 WebGL 上下文且帧率在跳。
  加 `--simulate-old-kernel` 会把 `window.Function` 换成「不认识 `||=` 的解析器」，
  **精确复现 Chrome 83 的 Android WebView**（本机拿不到老 Chromium 快照，这是唯一能确定性复现的手段）。
  需要先 build。

- **`npm run check:solo`** → `node test/browser-solo.mjs`
  真·端到端，**12 段**：启动器挑战历史 → 多级路由 → 计分/计时模式 HUD 与结算落库 → 详情弹窗 →
  重开确认 → 自由球摆球（右键转视角 / 滚轮缩放 / 左键拖球 / 每杆前重摆）→ 设置四个二级页 →
  竖屏三级返回栈 → 画质五档与自定义展开 → **移动端触摸**（单指拖球时相机不许动、双指转视角时白球不许动）。
  > ⚠️ [1]~[11] 会把环境**钉成桌面**（`maxTouchPoints=0`）—— 否则无头 Chrome 被判成触摸设备，
  > 鼠标分支根本测不到；[12] 反过来开触摸模拟走手机分支。
  需要先 build。截图落在 `%TEMP%/hmzq-solo/`。

### Android

- **`npm run android:apk`** → `node scripts/android-apk.mjs`（release）
  先 `cap copy`（同步 `dist/` 进 Android 工程）再跑 gradle `assembleRelease`。
  产物：`android/app/build/outputs/apk/release/app-release.apk`。
  **前置**：`E:/android-tools`（JDK17 / SDK / gradle-8.2.1，可用 `ANDROID_TOOLS` 环境变量覆盖）
  + `android/keystore.properties`（缺了会直接报错退出 —— **没签名的 release 包装不上，装了也白装**）。
  > 为什么是 Node 脚本而不是 `.bat`：`.bat` 里的**中文注释**会被 cmd 按 GBK 解析而文件是 UTF-8，
  > 实测现象是一屏「不是内部或外部命令」，但 `npx cap copy` 却成功跑完了、gradle 静默没执行 ——
  > **assets 是新的、APK 是旧的**，「半成功」最难排查。

- **`npm run android:apk:debug`** → 同一脚本加 `debug`
  gradle `assembleDebug`，**不需要 keystore**，产物 `.../apk/debug/app-debug.apk`。日常自测用这条。

- **`npm run apk:check`** → `node scripts/check-apk.mjs`
  装机前核验两件肉眼看不出来的事：① **签名有效**（无效签名的 APK 装不上，但文件看上去一切正常）；
  ② 包里那份 `index.html` 就是刚构建的 `dist`（有过「APK 里是旧 bundle」的事故，
  症状是「界面跟这轮的改动对不上」，极难联想到是漏了同步）。加 `debug` 参数验 debug 包。

- **`npm run cap:sync`** → `cap copy android`
  只同步 web 资源、不碰 gradle。想在 Android Studio 里手动打包时用。
  （`android:apk` 内部已经包含了这一步，正常流程不用单独跑。）

### 调参（维护工具，不进 CI）

- **`npm run sweep`** → `node test/sweep-break.mjs [每次数] ["配置串"]`
  开球参数扫描。定位「同一颗球几乎每次都进」这类系统性偏差，扫出各旋钮的「好区」。
  `BREAK_SHOCK` 的参数面非常陡（例如 `fanAngle` 98→104，单颗球最高进袋率就能从 ~14% 跳到 45%+），
  所以 **fanAngle / sideBias / RACK.shiftX / boost 任何一项改动后都必须重扫**。
  例：`npm run sweep 250 "-0.17;sideBias=0.7;fan=100"`；`DETAIL=1` 打印球号/袋口明细。

- **`npm run trace`** → `node test/trace-break.mjs [次数]`
  开球轨迹探针：每次开球打印末排 4 颗球（6/7/13/15）每 0.05s 的位置与速度、最终进袋的袋口与时刻。
  需要「眼见为实」看某颗球怎么进的袋时用。

### 桌面端（Electron）

- **`npm run build:electron`** → `vite build --config vite.electron.config.js`
  输出到 `dist-electron/`。与浏览器构建只有两点不同：
  ① `base: './'`（Electron 用 `file://` 加载，资源路径必须相对）；
  ② `format: 'iife'`（**Chromium 禁止 `file://` 页面加载 ES module，CORS origin null**），
  构建最后还会把入口的 `<script type="module">` 改成 `<script defer src=>`。
  另外 `target` 这里是 `es2020`（Electron 自带新内核，不用降到 2019）。

- **`npm run electron:dev`** → `node scripts/electron-dev.mjs`
  起 vite dev（**5183**）→ 等端口就绪 → 拉起 Electron，热更新。
  脚本里会 `delete env.ELECTRON_RUN_AS_NODE`：VS Code 集成终端 / 部分沙箱会注入它，
  导致 electron 退化成纯 Node（表现为 `require('electron')` 返回路径字符串、`app` 为 undefined）。

- **`npm run electron:start`** → `build:electron` + `node scripts/electron-run.mjs`
  构建产物再用 Electron 跑起来，**不打包**。同样会清掉 `ELECTRON_RUN_AS_NODE`。

- **`npm run dist:exe`** → `build:electron` + `electron-builder --win --x64`
  **打包 Windows exe**，产物在 `release/`：
  `幻梦-星光桌球-<version>-x64.exe`（NSIS 安装版）+ `幻梦-星光桌球-<version>-便携版-x64.exe`（绿色版）。
  配置见 `electron-builder.yml`（`appId: com.huanmeng.hmzq`，`asar: true`，nsis 装中文 `2052`）。
  两个已踩过的坑都已经在配置里规避掉了：
  - `electronDist: node_modules/electron/dist` —— 不指定它会**重新从 github 下 Electron 本体**
    （国内必超时），指定后从 ~10 分钟降到 49 秒。
  - `.npmrc` 里写了 `electron-builder-binaries-mirror=https://cdn.npmmirror.com/binaries/...`
    —— winCodeSign / nsis 资源同样走 github，走镜像才下得动。

---

## 三、一键出成品（省事就跑这一条）

```bash
npm run dist:all                        # 成品放默认目录 E:/发布
npm run dist:all -- E:/hmzq-发布          # 换输出目录
npm run dist:all -- E:/hmzq-发布 --no-apk # 只打 exe（跳过 gradle 那几分钟）
npm run dist:all -- E:/hmzq-发布 --no-exe # 只打 APK
```

依次做完：清目录 → 构建 `dist-electron/` → electron-builder（安装版 + 便携版）
→ 构建 `dist/` → `cap copy` + `gradle assembleRelease` → 成品复制到输出文件夹并打交付清单。

**它替你处理掉的几件事**（都是踩过的坑）：

- **两份产物不会搞混**：APK 用 `dist/`（ES module，浏览器构建），exe 用 `dist-electron/`
  （IIFE，`file://` 下才加载得了）—— 顺序固定，中间不互相覆盖。
- **构建前先手动清目录**：vite 的 `emptyOutDir` 会被 safe-delete 钩子拦下、整个构建失败；
  脚本先逐文件 unlink 清干净，再交给 vite。
- **产物改名归集**：`release/` 里那两个 exe 复制出去时，安装版补上「安装版」三个字
  （否则和便携版分不清）；APK 重命名成
  `幻梦-星光桌球-v<versionName>-code<versionCode>-release.apk`。
- **认死 APK 路径**：只认 `android/app/build/outputs/apk/release/app-release.apk`，
  不做同名搜索 —— 构建缓存里也有同名文件，搜出来的可能是旧的。
- 任一步失败即中断报错，**不会出现「半成功」**（新 exe + 旧 APK 那种最难查的状态）。

---

## 四、打 exe 该跑哪几条

```bash
npm test                 # 先确保逻辑没坏（600 + 31 全绿）
npm run dist:exe         # 一条就够：内部会先跑 build:electron，再 electron-builder
```

产物在 `release/`。**版本号取 `package.json` 的 `version`**（当前 `0.6.0`），
所以会出 `幻梦-星光桌球-0.6.0-x64.exe` 和 `幻梦-星光桌球-0.6.0-便携版-x64.exe`。

想先看看跑起来对不对、不想等打包：

```bash
npm run electron:start   # 构建 + 起窗口（不打包，快）
npm run electron:dev     # 或者这条：dev server + 热更新
```

> **交付前自检**：`HMZQ_SMOKE=1 npx electron .`（代码在 `electron/smoke.cjs` + `electron/probes.cjs`）
> 分四段自动点一遍：启动器（菜单项 / 玩法规则 / 声音面板写盘 / 无页面错误）→ 点自由模式进游戏
> （WebGL / 动作条 / 帮助与设置弹窗 / HUD / `file://` 下音频解码）→ `?ending=foul8` 与 `?ending=win`
> 两种结算窗。跑完会把启动器与声音设置还原成自检前的样子。**打包前后各跑一次，避免交付白屏或丢样式的包。**

---

## 五、打 APK 该跑哪几条

```bash
npm test                        # 逻辑
npm run build                   # 浏览器构建 → dist/（cap copy 拷的就是这个）
npm run check                   # 语法底线 + 内核卡 + 运行时 API（老内核事故就是这么防的）
npm run android:apk             # 打 release（会自动 cap copy + gradle）
npm run apk:check               # 装机前：签名有效 + 包内 index.html 就是刚构建的那份
```

产物：`android/app/build/outputs/apk/release/app-release.apk`。

**日常自测用 debug 更快**（不需要签名文件）：

```bash
npm run android:apk:debug && node scripts/check-apk.mjs debug
```

**前置条件**（缺一不可，脚本会直接报错退出）：
- `E:/android-tools`：JDK17 / Android SDK / gradle-8.2.1（`ANDROID_TOOLS` 环境变量可改路径）
- `android/keystore.properties`：release 签名配置（只在打 release 时需要）

---

## 六、两套版本号是分开的（容易踩）

| 产物 | 版本号在哪改 | 当前值 |
|---|---|---|
| Windows exe | `package.json` 的 `version` | `0.6.0` → `幻梦-星光桌球-0.6.0-x64.exe` |
| Android APK | `android/app/build.gradle` 的 `versionCode` / `versionName` | `4` / `1.0.3` |

**改一边不会同步另一边。** 发版时两边都要手动抬 —— 尤其 `versionCode` 必须是递增整数，
不抬的话覆盖了旧包也装不上。

---

## 七、几个常见组合

| 你想干什么 | 跑这些 |
|---|---|
| 桌面改代码、看效果 | `npm run dev` → 开 `localhost:5183` |
| 手机真机实测 | `npm run preview:lan` → 手机开控制台打印的局域网地址（:5184） |
| 改完代码、交付前 | `npm test` → `npm run build` → `npm run check` → `npm run check:smoke` → `npm run check:solo` |
| 只改了界面/文案，想快点验 | `npm run build` → `npm run check:solo`（12 段，含截图） |
| 调开球手感 | 改 `constants.js` 的 `BREAK_SHOCK` / `RACK` → `npm run sweep` 重扫 → 必要时 `npm run trace` |
| 出 Windows 安装包 | `npm run dist:exe` |
| 出 Android 包 | `npm run build` → `npm run android:apk` → `npm run apk:check` |

---

## 附：不在 `scripts` 里但有用

- `node scripts/perf-report.mjs` —— 移动端性能负载统计（离线，无 WebGL）：
  网格数 / 三角形数 / 材质数 / 纹理像素 / 投影阴影物体数 / 物理刚体与碰撞体数。
  调画质档位或场景复杂度前后各跑一次对比。

- `npm run check:smoke -- --simulate-old-kernel` —— 复现 Chrome 83 老内核。
- `node test/api-floor.mjs --strict` —— 让运行时 API 检查真的返回非零退出码（CI 用）。
