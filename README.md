# 幻梦-星光桌球（hmzq）

> 「幻梦」是系列名：本作由 **幻梦-拾光回廊工作室** 制作（使用 WorkBuddy 开发），
> 后续作品命名都会带上这个系列名。

**中文** · [English](README.en.md)

Three.js 渲染 + Rapier3D 物理的 3D 台球，9 尺台真实规格（台面 2.54×1.27m、球径 57.15mm、球质量 0.17kg）。
界面支持**中英文切换**（启动器右上角 / 游戏内「⚙ 设置 → 语言」），见「## 中英文切换」。当前版本 **0.8.0-test**。

## 命令

| 命令 | 说明 |
|---|---|
| `npm run dev` | 浏览器开发服务器（:5183，已开局域网监听）；**不转译语法，只适合内核较新的浏览器 / 桌面调试** |

> 全部 25 条 script 的逐条说明，以及**打 exe / 打 APK 分别该跑哪几条**，见 `docs/npm-scripts.md`。

| **`npm run preview:lan`** | **手机实测用这个**：构建（ES2019 目标，兼容老内核）+ 起预览服务器（**:5184**，局域网，启动时会打印手机该打开的地址）。带 `--emptyOutDir false` 是为了不被安全钩子拦清目录，代价是 `dist/` 会留存旧哈希文件，偶尔手动清一次即可 |
| `npm run build` | 浏览器构建 → `dist/`（含启动器） |
| `npm run check:syntax` | 校验产出物语法底线 ≤ ES2019（先 build，见「## 浏览器兼容性」）|
| `npm run check:kernel` | 校验**内核自检卡**的判断逻辑：在 9 种模拟内核下"该不该弹卡"是否符合预期 |
| `npm run check:api` | 扫描产物里 > Chrome 83 的**运行时 API**（`replaceAll` / `Object.hasOwn` 这类，语法过关但一跑就抛） |
| `npm run check` | 上面三个一起跑（改完 `index.html` 自检 / 升依赖 / 加语法后跑一次） |
| `npm run check:smoke` | 无头 Chrome 真开一次游戏（不弹内核卡 / 无报错 / canvas 与帧率都在）；加 `--simulate-old-kernel` 复现 Chrome 83 内核 |
| `npm run check:solo` | 端到端 15 段（`[1]`~`[13]` 把环境钉成**桌面**：`maxTouchPoints=0`，否则无头 Chrome 会被判成触摸设备、测不到鼠标分支；`[13b]` 反过来开触摸模拟 + 竖屏走手机分支）：启动器多级路由（含竖屏三级返回栈）→ 自由球摆球（右键转视角 / 滚轮缩放 / 左键拖球 / 每杆前重摆）→ 设置四个二级页 → 进游戏 → HUD → 结算落库 → 详情弹窗 → 重开确认 → 画质五档与自定义展开 → 移动端触摸（单指拖球时相机不许动 / 双指转视角时白球不许动）→ 本地双人（回合横幅 / 两颗开球键的归属 / 已进袋分两栏 / **定组后半透明材质** / 白球落袋自由摆球 / 摆球时右键转视角且不把白球带跑 / 顶视摆球放开平移与缩放）→ 玩法规则页（中式黑八 + 斯诺克 / 俄式禁用占位）→ **🤖 人机对战**（启动器卡片与四档难度是真入口 / 电脑自己思考 → 转杆 → 出杆 / 转杆动画看得见 / 只打合法球）；先 build |
| `npm run check:i18n` | 中英文切换：先静态审计词表覆盖率（HTML / JS 里的中文有没有英文条目），再用无头 Chrome 真点一遍「切英文 → 扫全页残留汉字 → 切回中文 → 验是否还原」，并留三张对照图到 `docs/i18n-shots/`；先 build |
| `npm test` | 物理层 + 逻辑层 **719 项** + 渲染层 31 项 |
| `npm run android:apk` | 打出 Android release APK（需 `E:/android-tools` 与 `android/keystore.properties`，见「### Android APP」）；加 `:debug` 打 debug 包 |
| `npm run apk:check` | 装机前核验：签名是否有效 + 包里的 `index.html` 是不是刚构建的那份 |
| `npm run electron:dev` | vite dev server + Electron 窗口（热更新） |
| `npm run electron:start` | 构建并启动 Electron（跑 `dist-electron/`） |
| `npm run dist:exe` | 打出 Windows exe → `release/`（安装版 + 便携版） |
| `npm run dist:all` | **一条命令出全部成品**：exe（安装版 + 便携版）+ APK，归集到指定文件夹（默认 `E:/发布`，用法见 `docs/npm-scripts.md`） |
| `npm run sweep` | 开球参数扫描（维护用，见 `test/sweep-break.mjs`） |
| `npm run trace` | 单球轨迹探针（维护用，见 `test/trace-break.mjs`） |

> **为什么手机要跑 `preview:lan` 而不是 `dev`**
> dev 模式把源码原样发给浏览器（连 Vite 自己注入的 `/@vite/client` 都是 ES2020 语法，
> 实测 `/src/main.js` 里也还留着 `?.`），手机自带浏览器（MIUI 浏览器 / 老 WebView，
> 内核常停在 Chrome 70~79）打开会直接 `Uncaught SyntaxError: Unexpected token .` ——
> 整包一行都不执行，表现为黑屏 + 红框，而 HUD 上仍是 HTML 里的初始值（"就绪 / 0 / –"）。
> `build.target` 对 dev **无效**，所以这不是配置问题，dev 给老内核打不开是必然的。
> 构建产物已把 `build.target` 降到 **ES2019**（去掉 `?.` / `??` / `#私有成员`），
> 所以手机实测一律走构建产物。见「## 浏览器兼容性」。
>
> **两条地址不要混**：dev = **5183**（桌面调试，带 HMR），preview = **5184**（手机实测）。
> 手机打开 5183 时，dev 服务器会**直接拦下**并返回一张"请换地址"的说明页（按 UA 判断内核，
> 见 `vite.config.js` 的 `hmzq:dev-old-kernel-notice`），而不是让玩家看到语法错误红框。

## 目录

```
public/
  launcher.html launcher.css launcher.js   启动器（多级子路由：常规 / 娱乐 / 历史 / 设置 / 帮助 / 关于 / 退出）
  launcher-audio.js                        启动器的声音设置面板（抽成类，避免 launcher.js 超 300 行）
  launcher-quality.js                      启动器的画质设置面板（与 src/quality.js 镜像，见下方同步警告）
  i18n.js                                  中英文切换运行时（按中文原文查表 / 还原 / 自动接管 DOM 变化）
  i18n-en.js                               词表：486 条精确条目 + 85 条正则规则（变量文案）
  bg/launcher.png                          启动器背景（游戏实机截图，做毛玻璃用）
  audio/                                   背景音乐 / 欢呼 / 连击语音（见「音频素材来源」）
src/
  audio.js voices.js music.js  音效引擎 / 合成音色配方 / 背景音乐
  combo.js result.js          连击播报 / 结算弹窗与结算音
  quality.js quality-ui.js    画质设置（选项表 / 预设 / 按需阴影）+ 游戏内画质面板
  platform/   平台适配层：web.js（浏览器/Electron）、wechat.js（微信小游戏预留）
  constants.js  所有可调参数（TABLE/PHYS/SHOT/RULES/BREAK_SHOCK...）
  rules.js      玩法规则：中式黑八的球号与球堆形状（斯诺克 / 俄式未开发）
  duo.js duo-ui.js   本地双人 / 人机：规则引擎（纯逻辑）+ 回合横幅与左右两个开球键
  auto-aim.js        🎯 自动瞄准：幽灵球几何 + throw 补偿 + 力度反解（纯几何，无头可测；给电脑用）
  ai.js              🤖 电脑对手：四档难度的手感 + 手中球摆位（纯逻辑，无头可测命中率）
  prefs.js      启动配置：力度区间 / 操作模式 / 玩法规则 / 双人规则 / 模式锁定（默认 ← 存储 ← URL 参数）
  layout.js     纯几何（台面、袋口、任意球组的摆球位）—— 浏览器与测试共用同一份
  sim.js        与引擎无关的物理策略（传导随机化、开球冲击波、限速）
  table.js balls.js textures.js   几何 / 球 / 程序化贴图
  state.js shot.js pockets.js      状态树 / 出杆与静止判定 / 进袋与保险丝
  camera-rig.js aimer.js stage.js  机位 / 瞄准 / 渲染舞台
  hud.js input.js settings.js help.js   界面 / 输入 / 设置与底部动作条 / 帮助文案
  mobile.js mobile.css  移动端外壳：触摸检测 / 手势分工 / 开球键 / 响应式样式
  main.js       入口：建世界 → 接子系统 → 跑主循环
electron/       主进程 + preload（仅桌面端）
scripts/        electron 启动脚本（会自动清掉 ELECTRON_RUN_AS_NODE）
  perf-report.mjs   离线场景负载统计（三角形 / draw call / 纹理 / 物理）
docs/           npm-scripts.md（`package.json` 每条 script 干什么 + 打 exe / APK 该跑哪几条）
                perf-android.md（移动端性能分析报告）
test/           见下
```

## 游戏内界面

底下一排按钮 + 两个弹窗，`index.html` 只放骨架，接线在 `src/settings.js`：

| 位置 | 元素 | 行为 |
|---|---|---|
| 左下 | `?` | 打开**全屏帮助弹窗**（文案在 `src/help.js`） |
| 右下 | `↺ 视角回归` | 复位机位 |
| 右下 | `⟳ 重开本局` | 完全重开一盘（等于 <kbd>R</kbd>）；**先弹确认窗**，且文案会写明这一局不记入挑战历史 |
| 右下 | `⚙ 设置` | 操作模式（启动器锁定后置灰）+ 力度区间 + **声音（音效/音乐音量 + 曲目）** + 玩法规则只读提示 |
| 设置弹窗顶部 | `☰ 主菜单` | 先弹「放弃本局」确认，确认后回启动器；只在 `from=launcher` 时出现 |

左上 HUD 的模式行**三选一互斥**：计分模式显示「得分」、限次显示「剩余次数」、计时显示「剩余时间」
（自由模式三行都不显示）。计时那行最后 30 秒转红（`CLOCK_WARN_MS`），只在文本真的变了才写 DOM。
⚠️ 隐藏行**必须显式写 `display:none`**：`.row` 是 `display:flex`，会盖掉 UA 的 `[hidden]` 规则 ——
表现是"限次模式莫名多出一行『得分』"，而 `el.hidden` 断言是**通过**的，只有截图能看出来。
所以 `test/browser-solo.mjs` 里对三行是**连 `getComputedStyle(...).display` 一起断言**的。

弹窗打开期间 `state.uiBlocked` 为真，指针与按键不会落到球台上（`src/input.js` 里判）。

## 中英文切换

**入口**：启动器右上角「中文 / English」胶囊按钮 · 游戏内「⚙ 设置 → 语言 / Language」。
两处共用同一个选择（启动器选的英文，进游戏就是英文），落盘后下次启动直接生效。

| 事项 | 做法 |
|---|---|
| 存哪 | `hmzq.lang.v1`；Electron 走 `window.__electron.settings`（`file://` 下 localStorage 不可靠），网页走 localStorage |
| 词表 | `public/i18n-en.js`：`HMZQ_EN`（精确条目）+ `HMZQ_EN_RULES`（正则规则，`$1/$2` 捕获组，管 `玩家2 胜` / `余3次` / `20分` 这类带变量的文案） |
| 运行时 | `public/i18n.js`，启动器与游戏页各 `<script>` 引一次（静态页不能 `import src/`，同 `history.js` 的思路） |
| 翻译谁 | 文本节点（归一化空白后查表）+ `title` / `placeholder` / `alt` / `aria-label` 四个属性 + `<html lang>` / `document.title` |

**为什么按「中文原文」查表，而不是 key 表**：全项目 400+ 条文案散在 HTML 与十几个 JS 里，
给每处加 key（`t('settings.minPower')`）要改几百个调用点，改漏一处就漏一处中文；
按原文查只要维护一份 中文 → 英文 对照表，JS 照旧往 DOM 里写中文，翻译由运行时统一接管。

三条实现上必须守住的约束（都踩过）：

1. **不能拿 `innerHTML` 整块替换带交互的元素** —— 会把已绑好的事件监听换掉。
   整块替换只对「纯排版标签」（`b/i/em/strong/kbd/code/br/span/small/sup/sub/wbr/u/s`）且子节点无属性的元素生效，遇到 `button` / `input` 一律下沉到子节点逐段翻。
2. **译文必须能还原**：原文记在 `nodes` 台账里，切回中文时只还原「当前值 === 我们写进去的那串」的节点，被业务代码改过的不动
   （`translateText` 与属性记的是真正写进 DOM 的 `out`，不是词表里的 `en` —— 带缩进的文本节点写回去时前后有空白，拿 `en` 比永远不相等）。切回中文**不能再 walk 一遍**：`translateText` 不看当前语言，一 walk 就把刚还原的中文又翻回英文。
3. **自己写的译文不能再触发翻译**：靠「当前值 === 记录里的译文」判定，不用抑制标志（标志在异步 `MutationObserver` 下有竞争）。

后续 DOM 变化由 `MutationObserver` 自动接管（`childList` + `characterData` + 四个属性），只在英文模式启用，
所以 JS 拼出来的、「每帧重写」的文案（蓄力百分比、电脑瞄准提示）不用改代码也不会漏。

⚠️ **`public/` 下的文件原样下发、不经打包器**，语法必须保持 ES2019 以内（没有 `?.` / `??` / `||=`）；
`npm run check:syntax` 已经把 `public/*.js` 纳入解析校验（以前只查 `src/`，结果 i18n.js 的注释写坏导致整份文件语法错、
页面里运行时根本没挂载，而所有检查全绿）。

**验证分两层**（`npm run check:i18n`）：

- `scripts/i18n-audit.mjs` 静态审计：把 HTML 里能翻的单元 + `src/` 与 `public/` 里含中文的字面量都过一遍词表，
  缺英文条目就红（当前：HTML 245 单元 0 缺，JS 199 条字面量 0 缺，另有 69 条 innerHTML / 模板碎片交给运行时规则接住）。
- `test/browser-i18n.mjs` 端到端：真 Chrome 打开两个页面，TreeWalker 扫**全部**文本节点（含隐藏页），
  切到英文后不许再有汉字（兜住运行时拼串）；再点回中文，验证**还原**而不是单向替换。
  顺带断言帮助弹窗没有横向溢出（它以前是多列布局，内容装不下时浏览器会往右排「溢出列」，后几段跑到屏幕外）。

## 音效

| 声音 | 做法 |
|---|---|
| 出杆 / 球撞球 / 撞库 / 落袋 | **Web Audio 实时合成**，不用素材：接近速度决定响度与音色（撞得越重越脆） |
| **3D 音效** | **只有球撞球**，且只在自由 / 追踪模式（按「相机 → 事件点」做左右声道 + 距离衰减）；顶视模式与其余音效一律固定音量 |
| 每次进球 | 欢呼 `cheer.ogg`，音量随连击递增（上限 1.35 倍）；3 连以上叠掌声 |
| 连击 2 / 3 / 4 / 5 / ≥6 | 非常好 · 太棒了 · 四连无双 · 五连绝世 · 超越神的球技 |
| 一杆进 2 / 3 / ≥4 颗 | 双响炮 · 三响炮 · 满堂彩（此时不再叠连击语音） |
| 白球进洞 | **尴尬长号**（三声下行滑音），不喝彩 |
| 清台 | 胜利号角 + 欢呼 + 掌声，并弹**结算窗**（按模式给得分 / 剩余次数 / 剩余时间 / 进球率等） |
| 提前进黑 8（中式黑八） | 一记**爆炸音效** `boom` 替代进球欢呼；扣 3 分，黑 8 摆回球堆中心 |
| 判负（限次用尽 / 时间到） | 结算音 `defeat` + 结算窗，tag 分别是 `OUT OF SHOTS` / `TIME UP`（一眼能分出是怎么输的） |
| 背景音乐 | 两首爵士循环播放，换曲淡入淡出；可在启动器或游戏内切曲目 / 关闭 |

连击按「连续进球」跨杆累计，某一杆空杆或白球进袋即清零。规则实现在 `src/combo.js`（纯逻辑，有单元测试）。

### 音量
合成音的增益写在 `AUDIO`（`src/constants.js`），素材（欢呼 / 语音）走 `clipBoost`：
媒体元素的音量上限是 1，而 `cheer.ogg` 是"尖峰型"波形（峰值 0.71 / RMS 仅 0.061），
光调音量提不上听感，所以超过 1 的部分由 `playClip()` **分层叠加**补上。
总线末尾还有压缩器，开球 / 进球 + 欢呼 + 语音叠在一起时不会爆。
想预览任意一种结算：`index.html?ending=win|lose|foul8`。

**自动播放（坑）**：浏览器自动播放策略下 `el.play()` 返回的是 **rejected Promise 而不是 throw**，
不接住会冒到 `unhandledrejection`、触发全局错误浮层（表现为进游戏弹红框）。
所有媒体元素播放统一走 `safePlay(el)`（`src/audio.js`），它吞掉策略性拒绝；
`index.html` 的错误浮层另有 `BENIGN_ERROR` 正则兜底过滤。

**为什么素材播放用 `<audio>` 而不是 `fetch` + `decodeAudioData`**：Electron 是 `file://` 页面，
Chromium 会拦掉 file 的 fetch（CORS），媒体元素加载本地文件不受影响。
Web Audio 只在首次点击/按键（用户手势）后才真正出声，音频素材优先/预加载，首撞不会延迟。

### 音频素材来源

| 文件 | 来源 | 授权 |
|---|---|---|
| `audio/bgm/lounge.mp3` | Wikimedia Commons · *Backbay Lounge* — Bar Bugz | CC BY 3.0 |
| `audio/bgm/park.ogg` | Wikimedia Commons · *Jazz at the park* | CC0 公有领域 |
| `audio/cheer.ogg` | Wikimedia Commons · *Hurray* | CC0 / PD |
| `audio/applause.ogg` | Wikimedia Commons · *Clapping hurray* | CC0 / PD |
| `audio/voice/*.mp3` | 百度翻译在线合成朗读的 8 句中文 | 自行合成，仅用于本项目 |

`lounge.mp3`（Bar Bugz）署名 CC BY 3.0，公开发布时请在启动器「关于」页保留署名；其余为 CC0 / 公有领域。
`audio.js` 的 `CLIP_FILES` 是素材清单，`test/suites/audio.mjs` 会校验这些文件确实存在（缺少即 FAIL）。

## 启动器

桌面端启动后先进启动器（`public/launcher.html`），点「常规模式 → 自由模式」才进球台。
**网页端同样先进启动器**：`index.html` 顶部有一段内联脚本，无查询参数且非 Electron 时
自动 `location.replace('launcher.html')`；带参访问（如 `?mode=top&balls=15`）不受影响。
启动器是 `public/` 下的独立页面（原生 JS，经典脚本，不经打包器），
渲染顺序由 `electron/main.cjs` 的 `loadLauncher()` 决定。

- 七个一级菜单：**常规模式** / **娱乐模式** / **挑战历史** / **游戏设置** / 帮助 / 关于 / 退出游戏；
  支持 ↑↓ / Enter / Esc 键盘导航。
- **多级子路由**：玩法（选模式）与难度（选难度）各占一页，靠 `section[data-page]` +
  `data-parent` 串成树，层级全部由这两个属性推导（加新页不用改菜单 / 返回 / 面包屑代码）：

  ```
  start 常规模式 ─┬─ start/solo 单人模式 ─┬─ 计分模式（直接进球台）
                  │                       ├─ start/solo/limit  限次 → 简单40 / 中等30 / 困难20
                  │                       └─ start/solo/timed  计时 → 简单10min / 中等6min / 困难3min
                  ├─ 自由模式（直接进球台）
                  ├─ 本地双人（两人轮流用同一台设备，见「本地双人模式」一节）
                  └─ start/ai 人机对战 → 四档难度（都是真入口）
  fun 娱乐模式 ──── fun/freeball 自由球模式 → 进入球台
  settings 游戏设置 ┬─ settings/game    玩家名称 / 力度区间 / 操作模式
                    ├─ settings/audio   音效 / 音乐音量 / 曲目
                    ├─ settings/quality 画质档位（自动 / 低 / 中 / 高 / 自定义 → 展开四项细分）
                    └─ settings/rules   玩法规则 + 本地双人规则（原先是一级菜单项，已搬进来）
  history / help / about / quit 是平铺的一级页
  ```
  ⚠️ 之所以拆开而不是「点一下就地展开」：选项和模式只会越来越多，摊在一屏里会叠成一堵墙。
  子页面包屑按钮写的是 `data-up`（回到"我这一层的父级"），不写死目标。
- **返回栈**：只要停在内容页里就始终保留一条多余的 history 记录（`ensureEntry()`），
  手机上的返回键 / 浏览器后退先被我们接住 —— 子页逐层往上退，一级页才退回主菜单。
  竖屏顶栏那条返回键的文案跟着层级走（主菜单 / 常规模式 / 单人模式…）。
- **窄屏（手机）是二级页面结构**：一级 = 整屏竖向主菜单（品牌 + 7 个条目，长屏垂直居中），
  点条目进二级 = 内容页（顶部有 sticky 返回键，Esc 也返回）。
  切换靠 `<body data-lv="2">`，样式全在 `launcher.css` 的窄屏断点里 ——
  桌面端不写这个属性、左右两栏同屏显示，行为与以前完全一致。
- **娱乐模式**（一级菜单，独立模块）：目前 1 个可玩玩法 + 3 个占位卡片。
  **自由球模式**（`fun/freeball`，玩法见下节）。
- **规则设置 → 玩法规则**（现在在「游戏设置 → 规则设置」里）：只有**中式黑八**（五排三角形）；
  **斯诺克规则 / 俄式规则**渲染成禁用按钮占位，点了不生效。
  只影响桌上有哪些球、怎么摆；球组定义在 `src/rules.js`，摆位由 `layout.js` 的
  `rackLayoutFor(setId)` 统一算，**不涉及任何计分规则**（后续阶段再补）。
  切球组不需要重建刚体：16 颗球一次性建满，非本组的球 `hideBall` 收起，切回来再启用。
- 设置项：**最小力度（默认 0.05）/ 最大力度（默认 1.20）/ 操作模式 / 玩法规则 / 本地双人规则 / 画质档位**。
  桌面端落盘在 `%APPDATA%/幻梦-星光桌球/settings.json`（经 preload 的同步 IPC），
  网页端走 localStorage；游戏内改力度也会写回，两边保持一致。
  四个设置二级页各有一枚自己的「已保存」提示（`SAVED_OF` 映射当前路由）。
- 操作模式**在启动器里定，进游戏后锁定**（设置弹窗里三个模式禁用并给出提示）。
- 「自由模式」进入时用查询参数交接：
  `index.html?mode=tracking&balls=15&lock=1&min=0.05&max=1.20&from=launcher&game=free`；
  单人模式额外带 `game=score`、`game=limit&diff=hard` 或 `game=timed&diff=normal`；
  娱乐模式带 `game=freeball`。
  **玩法模式只走 URL、不落盘** —— 否则上次打过计分，下次从「自由模式」卡片进来会变成计分。
- 「挑战历史」页：tab（所有 / 计分 / 限次 / 计时 / **娱乐** / 自由 / 人机 / 联机）+ 记录列表 + 「初始化」按钮
  （只清当前 tab；「所有」= 全清；点两次确认）。**点某一条会弹详情窗**看这一局的完整数据。
  「娱乐」是个**分组**（`GROUPS = { fun: ['freeball'] }`），以后加娱乐玩法只改这个常量。
  实现见「## 单人模式与挑战历史」。
- 「关于」页：制作人 **幻梦-拾光回廊工作室** · 开发工具 **WorkBuddy** · 联系方式（微信二维码占位方框，
  以后把图放进 `public/bg/contact-qr.png` 并给 `#qr-box` 加 `data-qr-src` 就会自动显示，**没配图时不会发起请求**）。
- ⚠️ 启动器的设置 key（`hmzq.prefs.v1`）与默认值在 `public/launcher.js` 和 `src/prefs.js`
  各写了一份，球组表在 `public/launcher.js` 与 `src/rules.js` 各写了一份，
  **画质选项表在 `public/launcher-quality.js` 与 `src/quality.js` 各写了一份**，
  改任意一边都要同步另一边（启动器不能 import 游戏源码，否则会与游戏入口
  产生共享 chunk，破坏 IIFE 构建）。
  **挑战历史是个例外**：它有独立的 `public/history.js`，启动器与游戏页各引一次，
  两边共用同一份实现 —— 新代码尽量照这个路子走，别再镜像。
- 路由树有静态护栏：`test/suites/launcher.mjs` 直接解析 `launcher.html`，检查死链 / 父链成环 /
  孤页面 / id 重复 / 脚本里引用的 id 是否存在。**改启动器版面后 `npm test` 会先替你抓一遍。**

## 娱乐模式 · 自由球模式

`GAME_MODES.freeball`（`src/modes.js`）：`scored: true` + `placing: true` + `live: true`，没有难度档位。

- **每一杆开球前都重新摆一次白球**：底部浮出 `#place-bar`，右下的「开球」键在手机上被
  `body.placing` 隐藏，`canCharge` 期间返回 false —— **点「确定」之前不能出杆**。
  代码上就是 `onAllStopped()` 末尾无条件 `if (gameMode.placing) enterPlacing()` ——
  **不区分是开局、白球落袋还是普通一杆打完**，球一停稳就摆。
  这是这套玩法的本意：**开挂 / 纯练习的手感**，想打哪就先把白球摆到哪，
  不用被上一杆的走位结果绑住。
- 拖动白球每帧/每次移动都过 `layout.js` 的 `clampCuePlace()`：球心至少离库边内沿一个球半径、
  离袋口中心 `pocketThroat + 1.6R`；落在袋口圆内沿径向推出，角袋处"推出会顶到边界"，
  所以推完再夹一次、迭代 4 轮收敛（袋口与库边夹角那块本来就放不下球）。
  **没有这一条时把白球拖到袋口正上方、手指一松球就自己落袋了。**
- `pinCueToPlace()` 每帧把白球回设到 `placeAt`（`state.placeAt`）—— 物理求解器会把压着别的球的白球顶开，不回设就"漂"。
- ⚠️ **摆球期间相机必须能用，只停"自动跟随"**：`CameraRig.setPlacing(true)` 不关手势，
  改的是手势分配；`update()` 里摆球阶段直接跳过追踪模式的 target 跟随（否则拖球时白球一动、
  相机跟着走、"屏幕点 → 台面"的射线一直在变，球会跟着手指漂）。
  **别写回 `rig.lockAim()`** —— 那会把右键转视角与滚轮缩放一起关掉（曾经就是这样）。
- 手势分配（不会打架）：

  | 设备 | 拖白球 | 转视角 | 缩放 |
  |---|---|---|---|
  | 鼠标 | 按住左键拖 | 右键拖动 | 滚轮（或中键） |
  | 触摸 | 单指拖动 | 双指拖动 | 双指捏合 |

  实现见 `input.js`（`dragBtn === 0 && pointers === 1` 才算拖球，活跃指针数由 `platform` 层传上来）
  与 `CameraRig.setPlacing()`（`touches.ONE = null`、`TWO = DOLLY_ROTATE`）。
- ⚠️ **画布必须是 `touch-action: none`**，否则移动端浏览器会把单指拖走做成"滚动页面"、
  双指做成"缩放页面"，并在接管手势时抛 `pointercancel`，拖球拖到一半就断。
  这条是 `OrbitControls` 构造时写在 canvas 的 **inline style** 上的（不是我们的 CSS），
  所以**别把控制器 `disconnect()`** —— 它会把 `touchAction` 恢复成 `''`。
  `check:solo` 的 [12] 段直接断言 `getComputedStyle(canvas).touchAction === 'none'`。
- 计分口径与**计分模式完全一致**（同一个 `ScoreBoard`）：由 `state.scored` / `getGameMode(m).scored`
  / `history.js` 的 `SCORED` 三处统一判定，"是不是计分玩法"不再写死 `modeId === 'score'`。
- 判定只有"清台 = 通关"，没有次数与时限（`judgeAfterShot` 两种都不触发）。

## 本地双人模式（第三阶段）

两个人**轮流用同一台设备**，各自一个开球键：**玩家 1 在右、玩家 2 在左**，屏幕顶部一条
` #turn-banner` 横幅大字提示"轮到谁"，当前回合那一侧高亮，只有他的键能按下（另一个置灰）。
规则引擎全在 `src/duo.js`（`DuoMatch`）——**纯逻辑、不碰 three 与 DOM**，所以能被无头测试直接
import 断言；`src/duo-ui.js` 只负责把 `snapshot()` 画成横幅与两颗键。

**常规规则**（中式黑八 1~15 号）：1~7 小号、9~15 大号、8 号决胜。谁打哪一组由**实际打球结果**
决定，开局不定 group；一杆进多颗时按**第一颗落袋的球**定组。打进自己组的球 = 得分并续杆，
只打进对方的球或空杆 = 换人；自己的组清空后才能打 8 号，先打进者获胜。

### 四条可以在【规则设置】里改的规则

| 规则 | 选项（**默认第一项**） |
|---|---|
| 开局进球判定 `breakAssign` | 第一杆进 1 颗**不分**组 / 进 1 颗**就**分组（进 2 颗及以上两种都分组） |
| 第一球进黑八 `breakEight` | 本局**重来** / 黑八归位、继续打并换人 / 直接判输 |
| 提前进黑八 `earlyEight` | **直接判输** / 罚一颗已进的球 + 黑八回位、换人 |
| 白球落袋 `cueFoul` | 换人 + 对方**自由摆球** / 换人 + 白球回开球点 |

⚠️ **未分球时打进黑八走「第一球进黑八」那条规则，分了组才走「提前进黑八」** ——
这两条默认值不同（重开 vs 判输），分流写死其中一条会让另一半局面判错。
三项键值与合法值在 `src/duo.js` 的 `DUO_RULE_TABLES` 定义，并在 `public/launcher.js` 里
**镜像一份**（启动器是经典脚本，import 不到 `src/`），改一边必须同步另一边。

**落地**：球停稳后 `onAllStopped()` 调一次 `duo.resolveShot(state.potted)`，按 outcome 分别处理
`rerack`（重新摆球）/ `penalty`（`respot` 里的球回初始位，**必须从 `state.potted` 摘掉**，
否则清台进度永远差这几颗）/ `cueFoul`（走 `enterPlacing()` 或 `respawnCue()`）/ `win`｜`lose`。
HUD 的「已进袋」在双人模式下换成**两栏**（`#panel-pot-duo`），各记自己打进的球。
进了对方的球要**断连击**（`combo.onWrongPot()`）—— 不然会出现"打错号照样喝彩升级"的荒唐事。

**定组后半透明**：`main.js` 的 `refreshGhost()` 每帧问一次「这颗球归谁」——自己这组实色、
对方那组半透明（`GHOST_OPACITY = 0.32`），黑 8 在自己那组没清完时也淡着（现在打它是犯规），
清完变实色。白球永远实色（双方共用）。换人 / 进球 / 罚球回位都不用各自刷，让这一帧的事实说了算。
⚠️ 改 `balls.js` 的 `setBallGhost()` 时记住：**`transparent` 变了必须 `needsUpdate = true`**
（不重编译着色器，opacity 就是摆设），半透明要关 `depthWrite`（否则自遮挡糊成一团）；
函数是**幂等**的，所以每帧调用不会反复重编译。

## 🎱 杆法（旋转球，`src/spin.js` + `SHOT.spin`）

按住开球键时，左下角淡出一个**杆法盘**：盘里的红点就是**击球点**，默认在正中心。

```
        ↑ 高杆（跟进）
        │
左塞 ←  ●  → 右塞
        │
        ↓ 低杆（回旋）
```

| 拖到哪 | 归一化值 | 效果 |
|---|---|---|
| 正中心 | (0, 0) | **中杆**：和 0.7.0 的老出杆完全一致（逐位相同，长台标定不动） |
| 最上 | (0, +1) | **高杆**：撞完白球继续往前跑（滚动倍数 0.6 → 0.8） |
| 最下 | (0, −1) | **低杆 / 拉杆**：撞完白球往回缩（滚动倍数 → −0.95，真回旋） |
| 最左 / 最右 | (∓1, 0) | **左右塞**：撞库反弹角最多偏 ±15°，也能把目标球甩偏 |
| 斜着拖 | (x, y) | 高低杆 + 塞一起来（长度自动钳到 1，斜向到底 = 双满） |

三条输入路径（蓄力期间都可用）：**手指按住红点拖**（拖出圆盘不断）· 桌面**鼠标划过圆盘** ·
<kbd>↑</kbd><kbd>↓</kbd><kbd>←</kbd><kbd>→</kbd> 微调 · **双击圆盘**回中。
红点是**粘住**的（下一杆沿用），按 <kbd>R</kbd> 重开本局才回中。

### 换算（`sim.js` 的 `spinAngular()`）

击球点偏移 `o` 给白球的初始角速度 `Δω = (o × J) / I`，`I = 2/5·m·R²`。落到代码里只有两项：

```js
ω_roll = (v/R) · roll,   roll = 0.6 + (sy ≥ 0 ? 0.2 : 1.55) · sy
ω_y    = clamp(sideGain · sx · v/R, ±24)
```

⚠️ **上下增益刻意不对称**，因为台布摩擦对"过旋"根本不响应 —— 实测滚动倍数 0.8 / 1.0 / 2.15
打出来是**同一个跟进距离**（+0.45m）。所以高杆只给到 0.8（多送 ≈12cm），
低杆给到 −0.95（**真能拉回来**）：

| 滚动倍数 | 0（定杆） | 0.6（中杆） | 0.8（高杆） | −0.5 | −0.95（拉杆） |
|---|---|---|---|---|---|
| 撞完白球位移 | −0.02m | +0.42m | +0.45m | −0.09m | −0.26m |

### 库边加塞（`sim.js` 的 `applyCushionEnglish()`）

Rapier 的接触摩擦在这件事上给的份额太小：ω.y = 24 正撞库边，反弹方向只偏 **1.4°**
（摩擦冲量按「平动 : 自转 = 1 : 2.5」分摊，大部分塞被自己吃掉成角冲量）。
所以改成**手工旋转出射速度**：`θ = clamp(0.6·|ω.y|, ±15°)`。

⚠️ 这里踩过两次坑，别再往回改：
1. **只转速度**：球的自转轴还指着原方向，等于"往新方向滑过去"，台布摩擦 4cm 内
   就把速度拽回自转轴 —— 出射偏了 14.4°，整条轨迹最大横移只有 **3.6cm**，玩家看不出加了塞。
2. **自转跟着转 θ**：撞库后速度反向、自转没反向（真实台球的"撞库变回旋"），
   球在打滑中被摩擦拧回原方向，横移反而只剩 **1.4cm**。

正解是**按新出射方向重建滚动自转**（保持原来的滚动倍数 `k = |ω_h|·R/|v|`），
速度大小不变、`|ω|` 只会更小（反弹后速度已衰减），球按新方向稳稳滚出去：
同样一杆横移 **6.8cm**。ω.y 原样保留，继续受 `spinDecel` 衰减。

### 停转时间（不能让出杆被卡住）

`ω.y` 靠 `applyRollFriction` 的 `spinDecel = 9 rad/s²` 单独衰减（这类自转接触点瞬时速度为 0，
库仑摩擦给不出力矩）。上限 24 rad/s → **2.67 秒**归零，加上走位实测最强旋一杆
**2.2~3.6 秒**停稳，仍在 `updateRestState` 的容忍范围内。

⚠️ `maxSideSpin` 与 `spinDecel` 是一对：调大上限等于调长"球停了还要等几秒才能出下一杆"。
`test/suites/spin.mjs` 里有 4.6 秒的红线。

### 电脑永远打中心点

`main.js` 里电脑出杆是 `fireShot(p.power, { x: 0, y: 0 })` —— 故意的：
四档难度（30 / 45 / 70 / 90%）是在**中杆**下标定的，让电脑自己加塞会把命中率标定全部打乱。

## 🎯 自动瞄准（`src/auto-aim.js`）

> 这一层**没有按钮**——它最早是给玩家的一键进球键，后来改成**专门给电脑用**
> （用户定的：这个功能不是给玩家准备的）。电脑上场时走的就是它算出来的方案。

挑一颗**最容易进的球**、算好角度与力度，交给调用方去打；人机对战里，电脑还会把
「打算打哪颗球、进哪个袋、多大力度」写在屏幕上的提示条里（2.4 秒后自己收掉）。

两条规矩：本地双人 / 人机只打**当前这一方该打的球**（`duoTargets()`），
绝不替玩家把对方的球或黑八打进去；开球那一杆由人类来。

算法全在 `auto-aim.js`——**纯几何 + 物理模型，不碰 three 与 DOM**，所以无头测试能直接
拿几百个随机球位跑真实物理验命中率：

| 环节 | 做法 |
|---|---|
| 幽灵球 | 让目标球沿 u 进袋，白球撞击瞬间必须位于 `G = B − 2R·u`（**背向袋口那一侧**；写成 `+` 会把球打向反方向） |
| throw 补偿 | 切球越大目标球被往切向带偏越多，实测偏差 ≈ `0.13 × cut`，迭代 3 次收敛 |
| 力度反解 | 两条实测速度曲线（`v1 = v0 − 0.625·d1`、`v2 = 0.056 + 0.744·d2`）+ 撞击传递 0.87，再乘 1.14 安全系数 |
| 贴库处理 | 白球离库边 <5.5cm 时出杆方向会被求解器带偏 1~9°，所以放大切角/距离权重并限速 1.35m/s |
| 选球打分 | `wCut·切角 + wPot·目标球到袋口 + wCue·白球到幽灵球`，取最小；路径有球挡住或超切角上限就不入选 |

调参集中在 `constants.js` 的 `AUTO`。实测命中率 **≈95%**（160 个随机球位，无头套件断言 ≥92%），
白球掉袋 <6% —— 做不成 100% 是物理本身有离散误差，够用了。

## 🤖 人机对战（`src/ai.js`，第三阶段收尾）

电脑扮演**玩家2**，与人类走**同一套**中式黑八规则（`duo.js`）和**同一条**出杆链路。
轮到它时，屏幕上会看到三步：

```
think（思考 0.4~1.3 秒）→ aim（把球杆转过去，最短 0.4 秒）→ fireShot(力度)
```

难度**只是电脑手抖的程度**，球桌、球、物理、出杆方式与你手动打的时候完全一致：

| 难度 | 目标进球率 | 实测（各 178 杆真实物理） | 做法 |
|---|---|---|---|
| 极难 | ≥85% | **91.0%** | 瞄准抖动 0.0024 rad、几乎总挑最容易那颗 |
| 困难 | ≈70% | **70.2%** | 抖动 0.0066、两成概率去打次优解 |
| 中等 | ≈45% | **46.6%** | 抖动 0.0115、近一半概率不看全局 |
| 简单 | ≈30% | **30.9%** | 抖动 0.0196、多半抓着次优那颗就打 |

⚠️ 瞄准抖动看着只有千分之几弧度，是因为**几何会放大它**：白球走 1m 到幽灵球，
0.001 rad 的偏差会让撞击法线转约 1°，球就擦着袋口过去了。改档位要一点点试——
`test/suites/ai.mjs` 会拿真实物理把四档命中率重新量一遍，落在区间外就红。

电脑还会自己摆手中球（人类白球落袋后）：在台面上撒 5×5 网格，每个点跑一次
`planAutoShot`，挑最容易进球的那个位置。

追踪模式下**相机跟着电脑转**（`state.aiAiming`）：平时是"相机决定杆向"，
电脑没有手去转相机，不改这一句的话它转杆时镜头纹丝不动 —— 只有球杆在转，
玩家看不出它在瞄哪颗球。

调参在 `constants.js` 的 `AI_LEVELS` / `AI`。人机**无论输赢都记挑战历史**
（`result` 区分胜负）；本地双人也入史，`winner` 字段记下获胜方（0.7.0 起，体检 G7）。

## 单人模式与挑战历史（第三阶段）

四种单机玩法，**共用同一张台、同一套物理**，差别只在"怎么算成绩、什么时候结束"：

| 模式 | 计分 | 结束条件 | 记录长什么样 |
|---|---|---|---|
| 自由模式 | 无 | 清台才结算（也可以一直不打完） | `玩家1 自由模式 — 通关` |
| 计分模式 | 有（见下表） | 清台结算，显示得分 | `玩家1 计分模式 — 20分` |
| 限次模式 | 无 | 次数内清台 = 通关；次数用尽还没清完 = 失败 | `玩家1 限次模式(困难) 余3次 通关` |
| 计时模式 | 无 | 限时内清台 = 通关；时间到还没清完 = 失败 | `玩家1 计时模式(中等) 剩0:42 通关` |

**计分口径**（`src/constants.js` 的 `SCORE`，改这里就是改手感）

| 事件 | 分值 |
|---|---|
| 进一颗目标球 | +1 |
| 每连进一球 | 再多 +1（连着进第 2 颗 +2、第 3 颗 +3…），**跨杆累计**，空杆或白球落袋清零 |
| 一杆进 2 颗及以上 | 额外 +3，每多一颗再 +3（2 颗 +3、3 颗 +6、4 颗 +9） |
| 白球落袋 | −1，并断连击 |
| 提前把黑 8 打进 | −3，并断连击（**只有中式黑八**有这条：别的玩法没有"8 号是决胜球"的约定） |

提前打进黑 8 除了扣分还有两个动作：**黑 8 摆回球堆中心**（`src/balls.js` 的 `respawnBallToRack()`，
抬 6cm 落下免得与占位球互弹）+ 从 `state.potted` 里摘掉（`withoutPotted()` —— 不摘的话清台进度永远差一颗），
并播一记爆炸音效 `sfx('boom')` 替代欢呼。

"连击"复用的是播报系统的口径（`src/combo.js`）：连续进球跨杆累计，**空杆或白球进袋清零** ——
所以听到"非常好"的时候，计分那边也正好在连击加成。

**限次模式**的次数由难度决定：简单 40 / 中等 30 / 困难 20（`src/modes.js` 的 `LIMIT_DIFFS`）。
**计时模式**的时长由难度决定：简单 10 / 中等 6 / 困难 3 分钟（同文件 `TIME_DIFFS`）。
两者判定顺序都是"**先看是否清台**" —— 最后一杆刚好用完次数 / 刚好到点算通关，不会因为差一点点被判负。
时间到不会立刻糊上结算弹窗：先记 `state.timeUp`，等球停稳再判负。

**挑战历史**

- 存储：`localStorage`（Electron 走 IPC 落盘）键 `hmzq.history.v1`，只存本机，**最多 200 条**，超出丢最旧的。
- 一条记录：`{ name, mode, diff, score, shots, left, potted, total, best, timeLeft, view, aimMs, aimCount, result, ms, ts }`。
  展示文案由 `rowText()` 统一算（玩家 / 模式(难度) / 次数或时间槽 / 结果 / 用时 / 日期六列）。
- **只记打完的局**：清台、或限次用尽 / 时间到判负。中途按 R 重开、或返回主菜单的都不记 —— 免得列表里堆半截记录。
- **点任意一条记录弹详情窗**（`detailRows()` 算内容）：玩法模式 / 玩家 / 结果 / 用时 / 剩余次数 / 剩余时间 /
  击球次数 / 进球 / 进球率 / 最高连击 / 平均瞄准 / 视角模式 / 时间。老记录缺字段的那几行直接不显示
  （不是显示 0）—— 所以升级后翻旧记录不会看到一堆假数据。
- **过程数据怎么量**：`aimMs / aimCount` 是"平均瞄准时间"。口径是——**玩家对瞄准做过任意调整**
  （`state.aimAngle` 偏离超过 `AIM.moveEps` = 0.004 rad，顶视拖动与追踪转相机都会改它）就算这一杆开始了；
  **点开球即结束**。一次都没调整就直接开球的那杆**不计入平均**（否则手快的人会被算成 0 秒）。
- 「初始化」**按当前 tab 清空**：在「计分」里点只清计分，「所有」里点是全清。清空是破坏性的，
  所以按钮要点两次（第一次变"再点一次确认"，4 秒不点自动复原）。
- 玩家名在「游戏设置 → 玩家名称」里改（最长 12 字，默认"玩家1"），存在 `hmzq.prefs.v1` 的 `name` 字段。

**重开要过一道确认**：点「⟳ 重开本局」或按 R 会弹 `src/confirm.js` 的确认窗，**文案里写明"这一局不会记入挑战历史"** ——
因为重开本来就不落库，误触一次等于白打且列表里连痕迹都没有，只说"确定吗"讲不清代价。
已经判完胜负（结算弹窗开着）时不再问：那一局早落库了，重开就是「再来一局」。

**文件职责**

| 文件 | 管什么 |
|---|---|
| `public/history.js` | 历史的存储与格式化（`rowText()` 列表行 + `detailRows()` 详情行）。**启动器与游戏页共用这一份**（各 `<script src="history.js">`），不像 prefs/rules 那样两边镜像。ES5 写法 —— 它原样下发给老内核，不过打包器 |
| `src/modes.js` | 模式与难度定义、`ScoreBoard`（计分板）、清台/判负判定、`potRate()`、`withoutPotted()`、历史记录组装。**不碰 three、不碰 DOM**，无头测试直接跑 |
| `src/history.js` | 游戏内的薄封装：从 `window.HMZQHistory` 取模块，取不到就降级成空操作 |
| `src/state.js` | `modeId / diff / score / shotsLeft / matchMs / timeLimitMs / timeLeftMs / timeUp` + 瞄准统计（`aimMark / aimSeen / aimAcc / aimCount`） |
| `src/result.js` | 结算弹窗：按模式换文案（限次通关叫"通关"、次数用尽叫"次数用尽"、时间到叫"时间到"），统计行按模式增删 |
| `src/confirm.js` | 通用二次确认弹窗（`ask-*`，与"返回主菜单"的 `confirm-menu` 分开），Enter = 确认、Esc = 取消 |

**调试 / 预览**

- `?game=score|limit|timed&diff=easy|normal|hard` 直接指定玩法模式。
- `?ending=win|lose|foul8` 直接端出结算弹窗；再加 `&record=1` 则走**完整结算链路**（含写历史），
  用来端到端验证"打完一局"这条路径（单独用 `ending` 不写历史，免得预览污染玩家的记录）。

## 真实桌面模型（0.8.0 起默认）

球桌外观换成了 Tripo 生成的 GLB（`src/assets/table-9ft.glb`），**0.8.0-test 起默认启用**。

- **只作外观，不参与物理**：碰撞体全部来自 `layout.js` 的纯数据，`table.js` 用
  `buildTable(..., { hideVisual: true })` 只建刚体不建可视网格。所以开球参数 / 袋口喉口标定全部沿用。
- **对齐的是"击球区"不是外框**：球按 `TABLE.halfL/halfW` 放，只要模型两库鼻之间和 2540×1270 重合，
  球看起来就贴着库边反弹。模型长宽比偏方（1.773 vs 2.000），所以**必须非均匀缩放**。
- **回退**：`?model=0` 回到 0.7.0 的参数化桌面；GLB 加载失败也会自动回落（不会白屏）。
- **换模型**只改 `src/table-model.js` 顶部 `MODEL` 的四个实测常数（`clothW/clothL/clothY/longAxis`）；
  新模型先用 `python test/glb-measure.py <模型.glb>` 在**游戏世界坐标**下量库鼻 / 袋口剖面 / 台呢矩形，
  `python test/glb-check.py` 出体检报告（尺寸 / 比例 / 材质 / 连通分量）。
- **贴图分档**见下节「贴图精度」；资产流水线 `scripts/prepare-table-glb.py`
  （`--size` 决定 GLB 内嵌档、`--sizes` 产出外置档、`--tex-dir` 指定输出目录）。
- **文档配图**：`npm run shots:model` 出 `docs/model-shots/{overview,top,corner-pocket,mid-pocket,legs-low}.png`
  与袋口验收图 `{pocket-corner-top,pocket-mid-top,pocket-corner-check,pocket-mid-check,throat-check}.png`
  （`-check` 是叠了物理线框的对照图：验收"判定圆 / 收口环是否压在模型袋口上"）
  （真 Chrome 固定机位，**换了模型资产 / 袋口 / 光照都要重跑**，否则文档图还停在旧版本）。

### 碰撞体怎么跟模型对上

外框围墙按模型**实测外沿**加宽（`buildTable` 的 `railHalfL/railHalfW` ← `modelState.size/2`），
所以球撞的是看得到的那圈木框，而不是一圈比木框小的隐形墙。参数化桌面不传这两个值，行为不变。
袋口**不在模型上挖洞**：模型自带的袋口就是玩家看到的洞口，物理判定圆通过
`TABLE.pocketOut / pocketOutMid` 挪到模型袋口上（见下节「判定圆对准模型袋口」）。

### 模型几何修复（`scripts/fix-table-glb.py`）

Tripo 导出的模型有三处几何缺陷是"看得见穿模"的，只能在资产层修，代码补不了：

```bash
# 必须从**源资产**开始（src/assets/table-9ft-src.glb，0.72 MB）
python scripts/fix-table-glb.py src/assets/table-9ft-src.glb src/assets/table-9ft.glb \
  --sights --underboard
```

| 开关 | 做什么 | 为什么必须做 |
|---|---|---|
| `--sights` | 删框顶 519 个三角的悬空装饰块（6 处 39~50 mm 高的小方块） | 高画质低角度看是一串"悬空方块" |
| `--underboard` | 删台面下方的两块整桌大板（106 / 289 mm） | 球落袋后会看到实心板，堵住洞口 |
| `--pockets` | ~~按判定圆挖通 6 个袋口~~ **0.8.0 定版不再使用** | 挖出来的黑圆洞是"我们发明的洞"，用户指出模型在该位置本来没有洞 —— 见下节 |

### 判定圆对准模型袋口（不挖洞，0.8.0 定版）

原则：**球消失的位置 = 玩家看到的洞口**。模型的台呢在袋口处本来就有自然缺口
（中袋台呢边 z≈0.618；角袋对角 (1.270, 0.600)→(1.298, 0.632)），所以做法是
**把判定圆挪过去**，而不是在台呢上挖洞：

| 项 | 值 | 说明 |
|---|---|---|
| `TABLE.pocketOut` | 10 mm | 角袋袋心 (±1.280, ±0.645) |
| `TABLE.pocketOutMid` | 16 mm | 中袋袋心 (0, ±0.651) |
| `TABLE.pocketThroatMid` | 62.5 mm | 中袋喉口 = 开口半宽（收口环几何上限），判定圆仍在 140 mm 视觉洞口内 |

⚠️ 两个外移量是**四轮实测折中**（结论见 `docs/0.8.0-模型引入评估.md` 9.3.1）：
旧袋心（-12.5）球在离洞口 47 mm 的台呢上就消失（用户截图圈出的错位）；完美贴齐视觉洞口的
14/45 会把 auto-aim 从 93.5% 打到 80.7%、AI 四档全崩；10/16 兼顾"洞口内消失"与命中率。
**袋口一动必须重扫开球参数**（`test/sweep-break.mjs`）**和 AI 三档 `aimErr`** ——
这一轮分别是 `sideBias 0.60 → 0.65`、`hard/normal/easy = 0.0042/0.0072/0.0122`。

### 模型模式下补"袋兜内壁"

模型袋口下方是桌腔（`--underboard` 删掉整桌大板之后能直接看到落球盘），所以 `table.js`
在 `hideVisual` 时补一层深色袋兜：`CylinderGeometry(R+4, R, 320, openEnded)` + `CircleGeometry(R)`
底板，`#15191d`、双面，`R` 按袋型喉口（角袋 57 / 中袋 62.5）。
**护圈（黑环挤出）在定版里删掉了** —— 模型袋口是唯一视觉洞口，再套一圈黑环等于又造一个
"不是模型上的洞"（返工第 ③ 版就是这么被否的）。

⚠️ 袋口形状**返工四次**，别再走回头路：

| 版本 | 做法 | 后果 |
|---|---|---|
| ① 圆 + 台面下放宽 | 台面以下 `R_BELOW = 150 mm` | 木框下半部被掏空，俯视木框上一圈洞 → "大坑不像台球桌" |
| ② 近圆胶囊 | 宽 125 mm、A 端=袋心、B 端拉到框内沿 1333/706 | 想让物理方孔四条边都被盖住，但台呢上被咬掉的月牙**重心偏台内 40 mm**，洞口和判定圆错位 |
| ③ 圆洞 | 圆心 = 袋心、半径 = 喉口 + 1 mm | 洞 = 判定圆，但**模型在红圈位置本来没有洞** —— 用户："请你移除这个黑色的洞" |
| ④ **不挖（定版）** | 资产只跑 `--sights --underboard`；判定圆外移到模型袋口（10/16） | 台呢上零人造洞；球在模型袋口内消失 |

`--pockets` 的实现留着（含"三顶点全在洞外"的细分判据等五个坑），万一以后换一个
袋口位置更靠内的模型还用得上；**但当前资产不要带它跑**。
- 修完（不带 `--pockets`）17,013 三角形、GLB 0.71 MB。
- ⚠️ **改完资产要 `npx vite build` 再 `npm run shots:model`**：出图脚本读 `dist/`，不 build 出的还是旧图。

### 光照

模型比参数化桌面反光强，五路同步压（`stage.js`）：`toneMappingExposure 1.15 → 0.68`、
半球光 `0.55 → 0.22`、环境光 `0.18 → 0.055`、聚光灯 `34 → 21`、补光 `0.25 → 0.095`。
参数化桌面共用同一套光照，一起变暗**是有意的**（两条路径观感一致，方便 `?model=0` 对照）。

调档别凭感觉，用 `docs/model-shots/` 固定机位图算**近白像素占比**（台呢区域亮度 > 200 的比例）：
exposure 0.94 时俯视 80% 的台呢像素已经贴白，0.68 降到 57%、全景台呢平均亮度 90.9 → 77.1。
⚠️ **只调 exposure 没用**（ACES 会把高光压回来），必须曝光与四路光同比例一起收。

## 画质设置

桌面 / 网页 / 启动器三处共用同一份（`localStorage` 键 `hmzq.quality.v1`），
游戏内在 ⚙ 设置弹窗，网页与桌面启动器在「游戏设置 → 画质设置」：

| 档位 | 阴影 | 渲染分辨率（DPR 上限） | 各向异性 | 桌面贴图 |
|---|---|---|---|---|
| 自动 | 按触摸 / 桌面自动挑 | 同左 | 同左 | 同左 |
| 低 | 关 | 100% | 1× | 512² |
| 中 | 1024 | 125% | 4× | 1024² |
| 高 | 2048 | 200% | 8× | 2048² |
| 自定义 | 自己选下面四项 | | | |

**一档 + 四个细分项**：档位是 `自动 / 低 / 中 / 高 / 自定义`，选**自定义**才会展开
**阴影精度 / 渲染分辨率 / 贴图精度 / 纹理细节** 四行（`QUALITY_ITEMS` 里这四行标了 `customOnly`，
面板据此显隐；`src/quality.js` 与镜像 `public/launcher-quality.js` 各一份）。

- **换档位会把四项一起刷成该档的值** —— 之后再进「自定义」是从这一档起步微调，而不是跳回出厂默认。
- **改任一细分项 → 档位自动落到「自定义」**（`Quality.set` 与 `LauncherQuality.set` 同口径）。
- 四项细分值**任何时候都留着**（不随档位被清掉），所以切走再切回来，上次调的四项还在。
- 老档位按 `LEGACY_PRESET`（smooth→low / balanced→mid / fancy→high）迁移；
  `custom` 现在是合法档位，带四项的旧 `custom` 记录原样读回来。
- 只写了 `preset:'custom'` 却没有任何四项值（老存档 / 首次进自定义）→ 按设备默认补齐，不会解析出 undefined。

**贴图精度只管 0.8.0 的真实桌面模型**（`src/table-model.js`）：GLB 里内嵌 256²
作为基线，512/1024/2048 三套 JPEG 在 `src/assets/table-tex/`，运行期**只换贴图不重建模型**。
显存按边长² 涨（两张贴图含 mip）：512 ≈ 3 MB / 1024 ≈ 11 MB / 2048 ≈ 45 MB。

下面那行「当前：阴影 … · 渲染 … × … · 贴图 …² · 各向异性 …」是实际取值，调档时用来看效果。
**阴影按需刷新**：`renderer.shadowMap.autoUpdate = false`，世界静止
（球不动 / 不蓄力 / 杆不转）时跳过整趟 shadow pass，球一停帧率立刻抬升；
`stage.requestShadowUpdate()` 用于重摆球 / 改阴影尺寸后强制重画几帧。
左上角 HUD 的「帧率」为半秒平均实机读数，移动端调参直接看它。
红米 K30（骁龙 730G）各档帧率估算与降级路线见 `docs/perf-android.md`。

## 多端

**桌面 exe（Electron）**——已可用，启动器 + 游戏都打进同一个 exe。
游戏本体是纯 Web 应用，`electron/main.cjs` 只负责建窗与转存设置。注意三个坑：
- Electron 用 `file://` 加载，而 Chromium 禁止 `file://` 页面加载 ES module，
  所以有独立的 `vite.electron.config.js`，产物是 IIFE 经典脚本。
- 部分终端（VS Code 集成终端、沙箱）会注入 `ELECTRON_RUN_AS_NODE=1`，
  会让 electron.exe 退化成纯 Node（`require('electron')` 返回路径字符串）。
  `scripts/` 下的启动脚本会自动清掉它。
- `file://` 页面的 localStorage 不可靠，所以桌面端设置走主进程落盘（见上面）。

自检：`HMZQ_SMOKE=1 npx electron .` 分四段跑（代码在 `electron/smoke.cjs` + `electron/probes.cjs`）：
先验启动器（7 个菜单项、玩法规则 3 个按钮（中式黑八 + 斯诺克 / 俄式禁用占位）、人机对战页四档难度可见、9 个占位按钮、声音面板、
切曲目与拖音量是否真的写盘、背景图已加载、毛玻璃 filter、平移动画、无页面错误），
再点「自由模式」进游戏，验 WebGL、底部动作条、帮助弹窗是否真全屏、设置弹窗里的
「返回主菜单」与确认弹窗、HUD 是否显示 `0 / 15`，以及 `file://` 下音频能否解码；
最后两段用 `?ending=foul8` / `?ending=win` 直接端出两种结算窗，检查配色、统计行与「再来一局」。
跑完会把启动器与声音设置还原成自检前的样子，不污染开发环境。打包前后各跑一次，
避免交付白屏或丢样式的包。
⚠️ 沙箱 / VS Code 集成终端会注入 `ELECTRON_RUN_AS_NODE=1`，直接跑会退化成纯 Node 而失败，
要手动带上 `env -u ELECTRON_RUN_AS_NODE`。另外**结算里的「进球率」行只在打过球时才渲染**，
自检必须按行数范围断言（`>= 3 && <= 4`），写死数字会随机红。

**移动端（手机 / 平板）**——以「微信内置浏览器能正常玩」为验收标准，已实机通过
（出厂浏览器不达标的情况见「## 浏览器兼容性」）。
`src/mobile.js` 在检测到主输入是手指时（`platform` 层的 `host.touch`，
Electron 恒为 false）给 `<html>` 打 `data-mobile="1"`，CSS 与操作分工随之切换：

| 操作 | 桌面 | 触摸设备 |
|---|---|---|
| 旋转视角 | 右键拖拽 | **单指拖动** |
| 平移 | 中键拖拽（自由模式） | **双指同向拖动**（自由模式） |
| 缩放 | 滚轮 | **双指捏合** |
| 出杆 | 左键按住蓄力 / 空格 | **「开球」键按住**，屏幕底部大蓄力条，松手击球 |

手势交给 OrbitControls 内建的 `touches` 配置（`ONE: ROTATE`、`TWO: DOLLY_PAN`）；
追踪模式相机每帧跟随白球，那边**禁用平移**（与桌面一致：桌面追踪模式本来就是 `MIDDLE: null`），
只保留旋转与捏合缩放。
`src/mobile.css` 处理安全区（`env(safe-area-inset-*)`）、44px 触摸目标、
竖屏与矮屏（横屏手机）的紧凑布局；竖屏时 `stage.js` 会放宽透视 fov，
否则水平视野窄到只看得见台面中间一条。

### 竖屏：球台转 90° 摆

竖屏不是"缩小版的横屏"——球台是 2.82×1.55m 的横长条，竖屏里横着摆会**两头出画**
（实测横向占屏 148%、纵向只有 24%，上下全是黑），所以竖屏统一把长边转到屏幕的长边方向：

| 模式 | 竖屏怎么做 |
|---|---|
| 自由模式 | 相机挪到**白球那端**的斜上方（仰角 `CAM.portElev = 62°`）、注视桌心 —— 白球在下方、摆球架在上方，出杆方向朝屏幕上方；距离由 `fitOverviewDist()` 二分反解到"整台恰好占满"（实测 92% 宽 × 57% 高） |
| 追踪模式 | 瞄准视角本来就是"沿台长往远处看"，不用动；击球后的全局俯瞰改用上面那套机位 |
| 顶视模式 | 正交视锥整体转 90°（`orthoFrustum()` 返回 `portrait`，`Stage` 把相机 `up` 指到世界 X），长边顺着屏幕长边，占屏面积是老算法的 2.4 倍 |

细节：横竖屏切换会自动重摆一次机位（只动自由模式，转屏那一帧不打断蓄力）；
灯罩在竖屏下一律隐藏（和顶视同理，它正悬在台面中央，透视俯瞰时会变成一块黑饼压在球堆上）。

### 追踪模式：击球后拉远看全场

击球瞬间相机**沿本杆瞄准方向往后退**（锚点取白球，所以运动是纯粹的"向后退"，
从瞄准机位的 0.95m 一路退到 2~3.5m，中间不会横跳），退到"整张台（含木框）刚好在屏内"
的距离 —— 距离由 `fitOverviewDist()` 按当前视锥反解，横屏仰角 `CAM.watchElev = 40°`
（`watchMargin = 0.88`）、竖屏沿用 `CAM.portElev = 62°`，所以任何屏幕比例、任何击球方向
都保证整台入画。动画 `CAM.watchTween = 0.4s` + easeOutCubic（起步最快，球一出去就得看全场）；
球全部停稳后再自动回到白球后方的追踪视角（`autoFocusTimer` 只在停稳后倒计时）。

⚠️ **观战阶段必须临时放开 `controls.maxDistance`**（`CameraRig#orbitRange`）：
追踪模式的缩放上限是瞄准用的 1.7m，而观战机位在桌心外 3~4m ——
沿用 1.7m 的话补间一结束 `controls.update()` 就按 `_clampDistance` 把相机**吸回 1.7m**，
整张台瞬间被裁掉（实测最外侧角占屏 335%，这才是"看不清全场"的根因）。
回到瞄准机位时要把区间收回去，否则瞄准视角能被拉到天上。护栏：`test/suites/tracking.mjs` [33]。

⚠️ **蓄力期间相机必须彻底冻住，出杆方向只认按下瞬间的快照**（护栏 `[43]`，`CameraRig#lockAim()`）：
曾出现"松开开球后视角突然转一下、白球方向完全变了"（顶视下能看出瞄准线扫向「开球」键）。
两个根因，缺一不可地都要堵：
1. `CameraRig.update()` 里 `charging` 的判断排在了 `camTween` **之后** —— 蓄力时那条补间还在推进；
2. OrbitControls 开了阻尼惯性（`enableDamping`），松手后相机还会滑十几帧；蓄力时冻结不衰减，
   解冻瞬间把攒下的位移一次性放出来 —— 看起来就是"松手后视角突然转"。
   所以 `lockAim()` 要顺手把 `_sphericalDelta` / `_panOffset` 清成 0、`_scale` 归 1（私有字段，
   检测不到就跳过，别硬写）。
相机一转，同一个屏幕点射线打到台面上的世界坐标就变了 → 瞄准角跟着变。所以除了冻结相机，
出杆方向**还必须用按下瞬间的 `state.lockedAim`**，而不是 `pointerup` 时重算的 `state.aimAngle`。

性能与降级建议见 `docs/perf-android.md`（最差兼容机型红米 K30 / 骁龙 730G 的负载与各画质档帧率估算）。

### Android APP（Capacitor）

`android/` 是 Capacitor 6 生成的原生工程（appId `com.hmzq.pool`，版本 **1.0.1** / versionCode 2）。
**web 侧不用为 APK 单独做一套**：Capacitor 默认走 **https scheme**
（`com.getcapacitor.Bridge#CAPACITOR_HTTPS_SCHEME`），不是 `file://`，
所以 ES module 能直接加载 —— **不需要**像 Electron 那样再出一份 IIFE 包，
`dist/` 原样同步进去即可。界面就是移动端那套（`host.touch` 判定同一条路径），
横屏 / 竖屏二级页 / 手势 / 开球键全部一致。

原生侧只补三件 web 做不到的事：

| 事 | 在哪 |
|---|---|
| 游戏全程亮屏（`FLAG_KEEP_SCREEN_ON`，不需要任何权限） | `MainActivity.onCreate` |
| 全屏沉浸：隐藏状态栏与导航条（从边缘划一下仍能临时调出，不会锁死） | `MainActivity.hideSystemBars` |
| 返回键：先收面板，**2 秒内再按一次**才退出（`App.exitApp`） | `src/android.js` 的 `initAndroidBack` |

Manifest 里 `screenOrientation="fullSensor"` —— 跟着重力转，不锁死某个方向。
`isNativeApp()`（`src/android.js`）供页面判断是否真·APP，帮助页据此隐掉
「浏览器要求 / 局域网调试地址」这类在 APP 里没意义的条目。

**打包**

```bat
npm run android:apk           :: release APK（签名）
npm run android:apk:debug     :: debug APK
npm run apk:check             :: 装机前核验（签名 + 包里是不是新产物）
android\build.bat             :: 同上，薄封装，最终都走 scripts\android-apk.mjs
```

脚本自己配好 `JAVA_HOME` / `ANDROID_HOME` / `GRADLE_USER_HOME`，并且**先 `cap copy` 再 gradle**
——直接跑 gradle 会打出装着旧 `dist` 的 APK，症状是"改了没生效"，很难联想到这一步。

**为什么真正的逻辑在 `scripts/android-apk.mjs` 而不是 `.bat`**（2026-09-19 实测）：
`.bat` 里的**中文注释**会被 cmd 按当前代码页（GBK）解析，而文件本身是 UTF-8 ——
于是整段乱码、被当成命令逐行执行。最坑的是它**半成功**：`npx cap copy` 跑完了（assets 是新的），
gradle 那一步静默没执行，最后拿到一个"看着没问题"的旧 APK。改成 Node 拼环境变量 + `spawn`，
编码完全可控。`build.bat` 因此只留一段 ASCII 注释 + 转调 node。

**装机前核验**（`npm run apk:check`）：验签名（`apksigner verify --verbose`，注意**不加 `--verbose`
成功时什么都不打印**，判不出"有效"还是"没跑起来"）+ 用 `tar.exe` 从 APK 里解出
`assets/public/index.html` 与 `dist/index.html` 比 sha1（**这条正是防上面那个"旧 APK"事故**）
+ 断言包里带上了「内核自检卡」的修复（防再打出被自家卡片挡住的包）。

工具链放在 `E:/android-tools`（不在仓库里）：`jdk17` + `sdk`（android-34 / build-tools 34.0.0）
+ `gradle-dist/gradle-8.2.1`（gradle 缓存也在同级的 `gradle-home`）。

**签名**：`android/keystore.properties` 指定密钥库，四个键
`STORE_FILE` / `STORE_PASSWORD` / `KEY_ALIAS` / `KEY_PASSWORD`；
它与 `.jks` 都已在 `.gitignore` 里。密钥库丢了就无法覆盖升级（只能卸载重装，丢存档），
请单独备份一份。当前密钥库有效期到 2056 年，别名 `hmzq`。

**踩过的坑**

- `minSdkVersion` 从 Capacitor 默认的 22 提到 **24**：24 起系统 WebView 才能在应用商店里独立
  更新，而物理引擎的 wasm 需要 Chrome 75+ 的指令（见「浏览器兼容性」）——
  22/23 的机器装上也是黑屏，不如直接挡在门外。
- maven 仓库顺序很关键：官方 `google()` / `mavenCentral()` 在本机几乎拉不动。
  构建插件要单独加 `maven.aliyun.com/repository/gradle-plugin`（它和 AAR 依赖不在同一个仓库，
  漏了会直接找不到 AGP）；其余用 aliyun/google、腾讯云、华为云兜底。
- `signingConfigs` 里写 `file('xxx.jks')` 会以 `app/` 为基准，必须写成 `rootProject.file(...)`，
  否则报 `Keystore file app\hmzq-release.jks not found`。
- Git Bash 里跑 `gradle`（shell 版）会报 `cygpath: command not found`，走 PowerShell 调
  `gradle.bat` 即可。

## 浏览器兼容性

> **验收标准（2026-09-18 定）**：以「**微信内置浏览器**打开分享链接能正常玩」为准。
> 微信（XWeb 内核）实测跑得起来；小米 / 红米自带的 MIUI 浏览器内核停在 Chrome 71，
> 撞在下面那道 wasm 门槛上，**不再作为目标环境** —— 它打开时会看到一张说明卡片而不是白屏。

**症状**：手机自带浏览器打开游戏页 → 黑屏 + 红框 `Uncaught SyntaxError: Unexpected token .`（可能两条），
HUD 上仍是 HTML 里的初始值（状态"就绪"、击球 0、帧率 `–`）。

**原因**：主脚本在**解析阶段**就挂了，一行都没执行。`?.`（可选链）与 `??` 是 **ES2020** 语法、
`#私有成员` 是 **ES2022**，而手机自带浏览器（MIUI 浏览器 / 老 WebView）内核常停在 **Chrome 70~79**。
`dev` 模式下 Vite 还会额外注入同样用着 ES2020 语法的 `/@vite/client`，所以报错常是**两条一样的**。

**修法**：`vite.config.js` 的 `build.target` 定在 **ES2019**，让打包器把 `?.` / `??` / `||=` /
`#私有成员` / 类字段全部降级：

| | 语法底线 | 覆盖内核 |
|---|---|---|
| 旧（`esnext`） | ES2022（`#私有成员`） | Chrome 94+ |
| 现在 | **ES2019** | **Chrome 63+ / Safari 12+** |

`public/` 下的启动器脚本是**原样下发的经典脚本**（不经打包），本来就写在 ES6 水平，不受影响；
`vite.electron.config.js` 保持 `es2020`（Electron 自带新版 Chromium，不受此限）。

**第二道门槛（更硬）：wasm 指令**
语法降级能把门槛压到 Chrome 73，但物理引擎 Rapier 的 wasm 还卡着一条。反编译
`rapier_wasm3d_bg.wasm`（`wasm-dis`）实测它用了三个非 MVP 指令：

| 指令 | 用途 | 需要内核 |
|---|---|---|
| `i32.extend8_s` / `i32.extend16_s` | 符号扩展（Rust `i8/i16` 转换） | **Chrome 74+** |
| `i32.trunc_sat_f32_s` 等 | 饱和浮点取整 | **Chrome 75+** |
| `memory.copy` / `memory.fill` | 批量内存（LLVM lower memcpy） | **Chrome 75+** |

缺任何一个，`WebAssembly` 直接编译失败、物理世界建不起来。这一条**换地址、换构建产物都解决不了**，
只能更新内核 —— 所以本作的实际门槛是 **Chrome / Android System WebView 75+**。

**四重保险**
1. 手机实测走构建产物：`npm run preview:lan`（**:5184**，启动时直接打印手机该打开的局域网地址）；
   `dev` 不转译语法，老内核打不开，这不是配置问题；
2. dev（**:5183**）按 UA 判断内核，老内核访问时**直接返回"请换地址"说明页**（含本机局域网 IP，
   见 `vite.config.js` 的 `hmzq:dev-old-kernel-notice`），而不是让人对着语法错误发呆；
3. `index.html` 顶部一段 **ES5 写法**的内核自检：JS 语法缺项 + **3 个 36~46 字节的 wasm 探针**
   （`WebAssembly.validate` 直接问内核支不支持上表三条指令）→ 用整屏卡片说清"缺什么 / 下一步做什么"，
   并写明当前打开的是 dev 还是构建产物；
4. 错误浮层末尾常驻 `模式: / 出错脚本: / UA:` 三行 —— 手机截图发过来就能定位。

**护栏**：`npm run check:syntax`（`test/syntax-floor.mjs`）除了用 acorn 逐级试解析、报出
`dist/` 与 `public/` 里每个 js 的语法底线（超过 ES2019 就退出码 1 并指到具体行列），
还会校验 `index.html` 里那三个 wasm 探针能被 `WebAssembly.validate` 通过、且构建产物里没被丢掉
（防止粘错 base64、或打包器把内联脚本弄丢）。改动 `build.target`、升级依赖、给源码引入新语法后，
build 完跑一次。

配套还有两道（`npm run check` 一并跑）：

| 护栏 | 文件 | 管什么 |
|---|---|---|
| `check:kernel` | `test/kernel-selfcheck.mjs` | 把 `index.html` 那段自检脚本抽出来，在 Node 的 `vm` 里用一个**假的 `Function` 构造器**模拟不同内核，断言"该弹卡才弹卡"。**见下面那节血泪史** |
| `check:api` | `test/api-floor.mjs` | 语法过关 ≠ 跑得起来：产品里若用了 `String.replaceAll`（Chrome 85+）这类高版本**运行时 API**，语法检查抓不到，现象是页面能加载、跑到某处才抛 TypeError。这个脚本按版本分档扫一遍并打印上下文（字符串匹配会有误报，所以默认只提示，`--strict` 才退出码 1） |
| 端到端 | `test/browser-smoke.mjs` | 起静态服务 + 无头 Chrome，打开**启动器**与**游戏本体**，断言不弹内核卡、无运行期错误、canvas/WebGL2/帧率都正常。加 `--simulate-old-kernel` 会把 `window.Function` 换成"不认识 `||=` 的解析器"，**精确复现 Chrome 83 的 Android WebView**（本机拿不到老 Chromium 快照，这是唯一能确定性复现老内核的手段） |

**⚠️ 2026-09-19 血泪史：自检卡把好机器挡在门外**

现象：APK 装机后**一进游戏就是那张「浏览器内核过旧」卡**，写着"缺少：逻辑赋值 `||=`"。
但那个产物里**一个 `||=` 都没有**（`npm run check:syntax` 干净，`||=` 只存在于探针字符串本身）。
用户那台 Android WebView 是 **Chrome 83**，只是恰好卡在 `||=`（需 Chrome 85）上 ——
**游戏从头到尾都能跑**，是自检卡自己把页面挡了。

根因：那段自检把 4 个 ES2020/2021/2022 探针（`?.` `??` `||=` `#`）和"真正的硬门槛"混在一个 `miss` 里。
这四项在**构建产物里早被 esbuild 降级掉了**（只有 dev 模式源码直出时才真的要它们），
所以产物 + 缺这四项 = 完全正常。修法：拆成 `miss`（硬门槛：ES2015~2018 语法 + WebAssembly + WebGL2）
与 `devMiss`（只在 `__runMode()` 判为 dev 时才拦）。`check:kernel` 就是钉这条的护栏 ——
其中"Chrome 83 + 产物 → 必须放行"这个用例，就是那台装机机型。

**教训**：自检代码的"假阴性"比它要解决的问题更贵 —— 它看起来非常笃定，人反而不会去怀疑。
所以任何"我们跑不动"的判定，都要有一条断言"**跑得动的时候不许报**"。
排查时也顺手确认了：产物对 Chrome 83 完全兼容（`check:api` 报的两处是 `Ray.at()` 撞名
与 Rapier 自带的 `typeof FinalizationRegistry === 'undefined'` 特性探测，均无害），
并且在模拟 Chrome 83 的内核下**游戏本体帧率照常**。

**移动端长按防护（2026-09-18 微信实测）**

微信里按住「开球」键蓄力到 30% 左右，会弹出「选择 / 复制 / 搜索」菜单并把蓄力打断。
两道防线缺一不可，分别在 `src/mobile.css` 与 `src/mobile.js`：

| 防线 | 位置 | 为什么不能省 |
|---|---|---|
| `-webkit-user-select: none` + `-webkit-touch-callout: none` | `mobile.css` 的 `html[data-mobile="1"]` 根规则 | 微信的 X5 / XWeb **只认带前缀**的 `-webkit-user-select`，无前缀版本会被整个忽略 |
| `touchstart` 上 `preventDefault()` | `mobile.js` 的 `bindShootButton` | 长按计时是**从 `touchstart` 开始**的，等 `pointerdown` 再拦已经晚了；而且触摸事件的 `passive` 默认是 **true**，不写 `{ passive: false }` 这次 `preventDefault` 会被**静默丢弃**（代码看着没问题，实际完全不生效） |

另外 `touchend` / `touchcancel` 也挂了松手回调 —— 某些内核在 `touchstart` 被拦后不再派发 `pointerup`，
`up()` 本身靠 `state.charging` 幂等，重复触发无副作用。
回归护栏见 `test/suites/mobile.mjs` 的 `[31]`（静态断言各项开关在位，尤其盯着 `passive: false`）。

**微信小游戏**——已预留适配层，尚未真机验证。
`src/platform/wechat.js` 里写有完整接入清单（画布挂载、触摸、UI 降级、贴图生成）。
游戏核心（layout / sim / table / balls / state / shot / pockets / camera-rig / aimer）
不引用任何宿主 API，可直接复用；只有外壳（stage / hud / input / settings / textures）
需要 host 提供能力，无 DOM 时自动降级。

## 物理调参

改手感先看 `src/constants.js`，每个参数都写了实测依据。
⚠️ 开球参数面很陡（好区约 `RACK.shiftX ∈ [-0.18, -0.15]`，到 -0.19 就崩），
改完务必 `npm run sweep` 重扫，别只挑数值最优点。
