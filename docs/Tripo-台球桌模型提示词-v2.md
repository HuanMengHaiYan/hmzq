# Tripo 台球桌模型 · 提示词 v2.1（已移除全部袋 / 网兜描述）

> 目标：0.7.0 之后**整桌换成全新 3D 模型**，表现力优先，可以抛掉现有设计。
> 基准：现代**中式八球职业比赛台**（目标图那种，银色多棱锥腿 + 深胡桃木 + 翠绿台布）。
> 正向/负向提示词上限 **1000 字符**，下列中文版均实测合格。

## 变更记录

| 版本 | 状态 | 关键差异 |
|---|---|---|
| v1 英文 | 废弃 | 1548 字符超限；未钉风格锚点 |
| v2 英文 | 废弃 | 2412 字符超 141%，尾部被截断 |
| v2 中文 | 废弃 | 635 字符；**含袋口 / 网兜 / 皮套 / 回球轨道描述** |
| **v2.1 中文** | **当前版** | **彻底移除袋 / 网兜 / 皮套 / 流苏 / 开孔的正面描述**；台面输出封闭平板；负向词改中英混排 |

### 本轮为什么要删（对照 4 张新截图）

红圈标出的是**从台边下方垂落的倒锥形褶皱悬挂物**：上宽下窄、末端带小球或花状团块，还连着细线与碎片。它是 Tripo 把这几句正向描述合成出来的：

- `下方挂黑色网兜`
- `每袋配奶油白皮革嘴角护套`
- `桌下只有细黑钢回球轨道连接各袋`

四个模型无一例外。这类**柔性有机悬挂物**在斜下 / 侧后方视角下形状不雅，平台审核也容易拦 —— 就是你说的「换个角度就过不了审核」。它既不是袋口、也不承担任何功能，纯粹是提示词喂出来的噪声。

**关键判断：光把正向词删掉没用。** `billiard / pool table` 在 Tripo 语料里默认自带古典皮革挂袋，删掉描述它照样会补上。所以这一版是「正向一句不提 + 负向主动压制」成对改的。

顺带把**「六个贯通袋口」也从正向词删掉**：上一轮 GLB 定量诊断显示 4 个模型顶面覆盖率 89.9%~98.9%，袋口位置全是**凸起小圆钮**，一个真开孔都没有。继续写「贯通的洞」只会诱导更多凸起装饰。袋口、台布、库边统一交给程序化 / Blender 布尔挖洞。

---

## 〇、当前版提示词（直接粘贴）

### 主提示词（实测 520 字符）

```text
现代中式八球职业比赛台球桌桌体，2020年代赛事器材，工业设计硬表面，直线条、大平面、锐利倒角。不是古董，不是维多利亚风，不是雕花木家具。

台面：一整块连续无缝的翠绿羊毛台呢，2540×1270毫米，完全平整且封闭，没有拼缝、没有对角线、没有三角分割、没有石板接缝；四边与四角没有任何开孔、凹槽、圆钮、凸起装饰或悬挂物。内沿一圈低矮深绿橡胶库边。整桌外廓2820×1550毫米，台面离地800毫米，轮廓宽扁。

自上而下：宽厚的深浓缩胡桃木顶框，内沿嵌一道香槟银细饰条，顶面有小菱形瞄准点；同色木裙板由上下两道宽幅哑光银铝饰条横向分层，转角带斜切银块；桌下完全敞开，只有六条腿，没有搁板、没有底板、没有第二层、没有横梁、没有任何垂挂物。

六条粗直桌腿：四角各一，两条长边中点各一，彼此分离不粘连。每条为倒收分多棱柱——上部六角宽块向下收窄，大块钻石斜切面，顶端方套箍，底部短圆柱金属脚圈，香槟银阳极氧化铝哑光金属。绝对不要车削罗马柱、圆雕花柱、兽爪脚、卷草纹。

PBR材质：鲜艳赛事绿绒布、深胡桃木缎光漆、香槟银拉丝铝、黑橡胶。干净四边面拓扑，左右对称，分材质槽，原点居中，Y轴向上。空桌面：不要球、球杆、摆球框、文字、商标、人物。
```

### 负向词 · 精简档（实测 270 字符，负向框限制严时用）

```text
古董、维多利亚、雕花、车削罗马柱、流苏、垂饰、悬挂袋、网兜、漏斗锥体、褶皱团块、袋口凸起圆钮、台面开孔、台面对角线、三角拼块、搁板、底板、球、球杆、文字、商标、antique, Victorian, turned baluster, tassels, fringe, hanging pouch, net basket, dangling ornament, funnel cone, raised pocket caps, diagonal cloth seams, lower shelf, organic blobby shapes
```

### 负向词 · 完整档（实测 567 字符，负向框够长就用这个，压制最硬）

```text
古董、维多利亚、复古、巴洛克、洛可可、繁复雕花、雕花裙板、卷草纹、花卉浮雕、车削罗马柱、圆形凹槽柱、束腰、兽爪脚、球爪脚、莲花柱头、流苏、垂饰、悬挂皮穗、布料垂坠、悬挂网兜、漏斗状锥体、倒锥吊坠、褶皱团块、细线吊挂、悬空碎片、
袋口实心圆帽、袋口半球凸起、袋口方形凸台、袋口皮套、皮革护套、台面开孔、台面凸起圆钮、台面刻线、
台面对角线、三角拼块、梯形拼块、石板接缝、拼板台面、
下层搁板、底板、第二层、横梁、置物架、茶几、抽屉、
球、球杆、摆球框、巧克粉、文字、商标、水印、赞助商贴纸、背景、地板、房间、人物、手、
卡通、低多边形、圆润融化表面、粘连 fused parts、
antique, Victorian, baroque, turned baluster legs, claw feet, tassels, fringe, hanging pouch, net basket, leather pocket liner, dangling ornament, funnel-shaped cone, raised pocket caps, closed pockets, diagonal cloth seams, lower shelf, organic blobby shapes, melted surfaces
```

> **中英混排的理由**：上一轮 4 个模型 100% 生成车削罗马柱，说明纯中文逗号词表对风格标签的抑制偏弱。产品/材质术语用中文省字数，`antique / Victorian / turned baluster / hanging pouch` 这类风格与形状标签保留英文原词压制更硬。

### 图片版配套词（实测 131 字符，走 Image to 3D 时用）

```text
按参考图做成干净的3D游戏资产：保留六条银色多棱锥腿、深胡桃木框与宽幅银饰条、翠绿台呢。忽略并去掉球、球杆、印刷文字与背景。台面做成一整块完全封闭平整的板，四周不开孔、不加圆钮、不挂任何东西；桌下除六条腿外完全敞开。干净四边面拓扑，PBR，原点居中，Y轴向上。
```

### 删了什么 / 补了什么

| 正向词删掉的句子 | 负向词补上的压制 |
|---|---|
| `下方挂黑色网兜` | `悬挂网兜 / net basket / hanging pouch` |
| `每袋配奶油白皮革嘴角护套` | `袋口皮套 / 皮革护套 / leather pocket liner` |
| `桌下只有细黑钢回球轨道连接各袋` | `横梁 / dangling ornament` |
| `六个真正贯通的袋口…114/127毫米` | `台面开孔 / 袋口凸起圆钮 / raised pocket caps` |
| `没有流苏`（正向否定词也删了） | `流苏 / 垂饰 / 漏斗状锥体 / 褶皱团块 / 细线吊挂 / tassels / fringe / funnel-shaped cone / organic blobby shapes` |

> **正向词删的是「具体物件的正面描述」**（网兜、皮套、回球轨道、袋口尺寸），不是把否定句清空。
> 保留的 `没有搁板 / 没有底板 / 没有横梁 / 没有任何垂挂物` 是结构排除，第一轮验证有效；
> 但 `没有流苏` 这类**带具体装饰名词**的否定已从正向词删掉 —— Tripo 有时会把该名词当主体生成，
> 具体物件名一律只放负向框。

### 还有余量时优先补哪几句

1. `台呢有细微绒毛感，木纹细腻，金属为纵向拉丝` —— 提升 PBR 观感
2. `外框上表面高于库边约30毫米，库边高约40毫米` —— 锁定层次比例
3. `桌腿上宽下窄的棱面分界要清晰，不要倒圆角` —— 专治棱锥腿被磨成圆柱
4. `台面四角保持直角切边，不要圆角包边` —— 便于后续布尔挖角袋

**如果还是被卡字数**，按这个顺序砍：最后一段「PBR材质 / 拓扑 / 空桌面」→「木框饰条细节」→「库边描述」。
**绝对不能砍的四处**：第一句风格锁定、台面「四个没有 + 完全封闭」、桌下「没有任何垂挂物」、桌腿「绝对不要车削罗马柱」。

---

## 一、第二轮 GLB 诊断结论（决定本轮策略）

详见 `docs/GLB模型诊断-第二轮.md`（含等轴 / 俯视 / 正视三张渲染证据）。四个模型：

| 检查项 | 结果 |
|---|---|
| 袋口真开孔 | **0/4**。顶面栅格覆盖率 89.9%~98.9%，袋口位置全是凸起小圆钮 |
| 材质 / 贴图 | **1 个空材质、0 贴图、连 `TEXCOORD_0` 都没有** —— 纯几何白模 |
| 中文硬约束 | 写了「绝对不要车削罗马柱」，**4/4 仍是罗马柱 + 维多利亚古董台** |
| 长宽比 | 1.44 / 1.72 / 1.58 / 1.51（真实外廓 **1.82**）；高长比 0.38~0.49（真实 0.28） |
| 朝向 | 模型 2 长轴在 Z、其余在 X；归一化尺度各不相同 |

**结论**：Text-to-3D 生成「6 个精确贯通开孔」基本是方法天花板，四轮一致。所以 v2.1 不再让 AI 碰袋口 —— 台面输出一整块封闭平板，后续按 `114 / 127 mm` 精确布尔挖洞。这样既避开凸起圆钮，也避开悬挂物带来的审核风险。

> 上一轮我把「台面被切成三角拼块」排得太重了：栅格显示模型 0 顶面 98.9% 连续覆盖，那些对角线是**共面网格的拓扑接缝**，不是真裂开。焊接顶点 + 重算法线即可，优先级远低于袋口与贴图。

**先改导出设置，别再调提示词**：重出一份带 PBR 的 GLB，验收写死 `images ≥ 1`、材质有 `baseColorTexture`、顶点属性有 `TEXCOORD_0`。这一项不修，后面生成十轮也进不了游戏。

---

## 二、第一轮为什么全废（历史分析，保留作迭代记录）

| # | 症状 | Tripo 把它理解成了什么 | 治法 |
|---|---|---|---|
| 1 | 台面被对角线切成三角 / 梯形拼块 | 把 "6 pockets / 9-foot slate" 理解成「台面由几块板拼成」 | 正面写 `一整块连续无缝…没有对角线`，负向词点名 `diagonal cloth seams` |
| 2 | 袋口不是洞，是凸起的圆帽，还挂流苏 | "pocket" 被当成古典台的皮革挂件 | **v2.1 已改为：正向完全不提袋口，交给程序化** |
| 3 | 维多利亚古董风：车削罗马柱腿、束腰、雕花裙板 | 语料里台球桌大多是古董家具 | 第一句锁 `2020s / 赛事器材 / 工业设计`，腿用纯几何词 + 英文负向标签 |
| 4 | 桌下多出一层大平板 / 搁架 | 把 "apron + tray" 理解成置物层板 | 写 `桌下完全敞开…没有搁板、没有底板、没有横梁` |
| 5 | 腿短粗、桌面过薄，比例像茶几 | 没给绝对尺寸与风格锚点 | 给 2820×1550 / 800mm / 六腿 + 明确「比赛器械」 |

---

## 三、【附录 · 勿直接粘贴】英文主提示词

⚠️ 2412 字符，**超 1000 上限 141%**，粘贴后会被尾部截断；且**含本轮已废弃的袋口 / 网兜 / 皮套 / 回球轨道描述**。仅作内容对照 / 走 API 或字数放宽时用。可直接粘贴的中文版见第〇节。

```text
Modern professional Chinese eight-ball championship pool table, 2020s
competition equipment, industrial product design, hard-surface geometry with
sharp straight edges and large flat planes. NOT an antique, NOT Victorian,
NOT a carved wooden heirloom, NOT ornate furniture.

A single continuous seamless vivid emerald-green wool cloth playing surface,
2540 x 1270 mm, one unbroken flat plane: NO panel seams, NO diagonal lines,
NO triangular divisions, NO visible slate joints. Overall footprint 2820 x
1550 mm, cloth surface 800 mm above the floor, wide flat table silhouette.

Six real open pockets: four corner pockets with 114 mm openings cut at 45
degrees into the table corners, and two side pockets with 127 mm openings at
the exact midpoints of the long rails. These are actual THROUGH-HOLES cut into
the bed and rails — you can see down into them, they are NOT solid caps or
raised round bumps. Each pocket is trimmed with a cream-white leather jaw
protector and a black mesh net basket hanging underneath. Six green rubber
cushions with true angled jaws flanking each pocket mouth.

Rail and body from top to bottom: a wide flat dark espresso-walnut hardwood
top rail with a thin brushed champagne-silver inlay strip along the inner edge
and small diamond sight markers on top; a broad dark walnut side apron banded
horizontally by wide satin silver-aluminum trim strips (top and bottom) with
angled silver corner blocks; beneath it, thin black steel ball-return rails
running between the pockets and otherwise completely open empty space — NO
shelf, NO bottom board, NO second tier, NO carved skirt, NO tassels.

Six heavy straight legs: four at the corners plus two under the midpoints of
the long sides. Each leg is an inverted tapered polygonal prism — a wide
faceted hexagonal upper block narrowing toward the bottom, with large flat
diamond-cut bevel planes, a square collar at the top and a short cylindrical
metal foot ring. Brushed champagne-silver anodized aluminum, matte metallic.
ABSOLUTELY NO turned baluster legs, NO round fluted columns, NO claw feet,
NO carved ornaments.

PBR materials: vivid tournament green felt, deep espresso walnut satin lacquer,
satin silver aluminum, cream leather, black rubber, black steel mesh.
Game-ready clean quad topology, symmetrical, separated material zones, centred
at origin, Y-up. Empty table: no balls, no cue sticks, no rack, no text, no logos.
```

### 关键句的作用

- **第一句**：整轮成败在这里。Tripo 的台球桌语料 90% 是古董台，必须给「年代 + 赛事类型 + 工业设计」+ 三重 NOT。
- **`one unbroken flat plane` + 四个 NO**：专治台面三角分割线。
- **腿单独一段 + 全大写 ABSOLUTELY NO**：腿型从没对过，用「倒棱锥 / 六角 / 钻石切面 / 银色阳极氧化铝」堆几何词，别用 `elegant / classic`。
- ⚠️ `THROUGH-HOLES` 与 `net basket` 两句**已被 v2.1 判定无效且有害**（前者造凸起圆钮，后者造悬挂物），保留在此仅为对照。

---

## 四、【附录 · 备用】英文负向提示词

⚠️ 729 字符，若负向框上限低于 1000 也可能被截断。**优先用第〇节的中文完整档**（中英混排，压制更硬）。同样含已废弃的袋口相关项，仅作对照。

```text
antique, vintage, Victorian, baroque, ornate, carved wood, carved skirt,
carved details, scrollwork, floral motifs, turned baluster legs, round fluted
columns, turned wood, claw feet, claw-and-ball feet, tassels, fringe, hanging
leather tassels, drapery, raised pocket caps, solid pocket bumps, spherical
corner ornaments, closed pockets, pockets as solid discs, diagonal lines on
cloth, triangular cloth panels, visible slate seams, split bed, checkerboard,
lower shelf, bottom board, second tier, tea table, coffee table, storage shelf,
balls, cue sticks, ball rack, triangle, chalk, text, logo, watermark, sponsor
decals, background, floor, room, wall, people, hands, cartoon, low-poly,
organic blobby shapes, melted surfaces
```

---

## 五、比调提示词更有效的一招：直接用目标图

Tripo 的 **Image to 3D** 对「有明确产品参考」的需求还原度远高于纯文字，尤其银色棱锥腿、宽幅银饰条这些文字难描述准的特征。

1. 把目标图存成单独文件，先裁掉桌面上的球、球杆和背景（Tripo 会把它们一起做成几何）。
2. Studio 选 **Image to 3D**（不是 Text to 3D）。
3. 若有 **Image to Multiview** → 先生成正俯视 / 正侧视 / 45° 三张再送进 3D，几何一致性明显更好。
4. 图片配套词用**第〇节的中文图片版**（131 字符，已移除全部袋 / 网兜描述）。
5. 负向词用第〇节的中文完整档。

英文图片版（字符数未超限，但压制不如中文混排版，**不推荐**；同样一句不提袋类物件）：

```text
Convert this reference photo into a clean 3D game asset of the same modern
Chinese 8-ball tournament table. Keep the six faceted silver legs, the dark
walnut rails with wide silver trim bands and the vivid green cloth. Ignore and
remove the balls, cue sticks, printed sponsor text and the studio background.
Keep the cloth bed as one flat sealed plane with no openings. Clean quad
topology, PBR, centred, Y-up.
```

> 文字版通常在「台面无缝、桌下干净」上更稳，图片版在「腿与饰条造型」上更准。取两者优点在 Blender 里拼。

---

## 六、拆件生成（推荐架构）

整桌一次性生成，AI 要在同一张网格里同时处理「多层饰条 + 6 条结构腿 + 台面」，必然顾此失彼。按游戏资产的做法拆：

| 件 | 提示词要点 | 生成后 |
|---|---|---|
| **A. 桌体外壳** | 只描述台面以下的木框 + 银饰条 + 裙板，明确 `no legs`；**不要提任何袋口、网兜、皮套、回球轨道** | 一件 |
| **B. 单条桌腿** | `single straight inverted-taper faceted hexagonal table leg, brushed champagne silver aluminum, large diamond-cut bevel planes, square top collar, cylindrical foot ring, isolated object` | 生成 1 条，在 Blender / three.js 里实例化 6 份 |
| **C. 台布 + 库边 + 6 袋口** | **不要让 AI 做** | 按精确尺寸程序化 / 手工建模 |

**B 单独生成性价比最高**：四轮里腿型从没对过，把腿从整桌摘出来单独描述几乎不会跑偏，6 条腿共用 1 份 mesh 也省面数。

**C 为什么必须程序化**：袋口的 114 / 127 mm 开口、45° 嘴角、库边内沿 2540×1270 是**进袋判定和碰撞的物理基准**。Tripo 不可能精确到毫米，一旦台布也换成 AI 网格，球会滚到洞口边缘悬空或卡住。模型输出封闭平板后，用 Blender 布尔挖 6 个洞即可，视觉与手感都不受影响。

推荐架构：**A + B（AI 生成，负责观感）+ C（程序化，负责手感）**，拼在一起仍是整桌全新 3D 模型；碰撞体继续走 `tableBoxes()` 里不可见的 box，不受视觉替换影响。

---

## 七、换成真实规格后，代码侧要跟着动的清单

你说 0.7.0 之后可以抛掉现有设计，下面是后续改造范围（**本轮不动代码**，等模型定稿再排期）：

| 项目 | 现有 | 真实模型 | 连带影响 |
|---|---|---|---|
| 桌面离地 | 620 mm | **800 mm** | `TABLE.legH` 0.42 → 0.60；`camera-rig.js` 高度与俯角重新对 |
| 桌腿 | 4 条 85mm 方柱 | **6 条多棱锥** | `layout.js` 的 `leg-*` 段改为 6 处 |
| 库边高 | 62 mm（防跳球） | **≈40 mm** | `TABLE.cushionH`；跳球风险上升，需靠不可见顶盖 / 调 `SHOT` 兜底 |
| 台布色 | `#1C6B4A` 暗绿 | **翠绿** | `textures.js` 的 `makeClothTexture()` 基色 |
| 木框 | 纯木 `0x5B3220` | **深胡桃 + 香槟银饰条** | 材质槽从 4 类扩到 5 类（+银） |
| 中袋 | 120 mm | **127 mm** | `pocketThroatMid` / `pocketGapMid` / `pocketCut` 三处联动，且**必须重扫开球参数** |
| 袋口可见物 | 无 | **由程序化生成，不进 AI 模型** | 布尔挖洞后补一圈喉口内壁；不要加网兜 / 皮套 / 悬挂物 |

> 视觉可以一步到位换成新模型，但**袋口与库边的物理尺寸必须等模型定稿后一起改**，否则会出现「看着进得去、实际被挡住」。这也是体检报告里「中袋还原真实 127mm」那项待办提前落地的最好时机。

---

## 八、参数面板

| 选项 | 建议 | 原因 |
|---|---|---|
| 输入方式 | **优先 Image to 3D / Multiview** | 有现成目标图 |
| 模型版本 | v3.1 / P1.0 或当前 F2.0 | 硬表面边更利落 |
| Face Limit | 高（5~8 万） | 多层饰条 + 棱锥腿，面数给足才不糊 |
| Quad Mesh | 开 | 硬表面尤其需要 |
| Symmetry | 关 | 六腿 / 长边中点在镜像面上易出错 |
| Texture / PBR | **开 + Detailed/HD** | ⚠️ 上一轮导出的是纯几何白模，这一项必须确认真的勾上了 |
| Style | None | 风格化会把硬表面拉成卡通 |
| Negative Prompt | **第〇节中文完整档** | 中英混排，专压古典化与悬挂物 |

> 生成是随机的，同一份提示词建议跑 3~4 个种子，优先挑 **「台面一整块封闭无缝 + 桌下无任何垂挂物 + 腿是棱锥」** 这三点全对的那个。袋口不再作为筛选条件 —— 它本来就不该由 AI 生成。
