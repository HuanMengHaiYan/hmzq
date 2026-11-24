# Tripo 台球桌模型 · 生成提示词（v1，已废弃）

> ⚠️ **本版第一轮生成结果全部不理想**（台面被切成三角拼块、袋口做成凸起的圆帽、腿跑成维多利亚罗马柱、桌下多出搁板）。
> 请使用 **`Tripo-台球桌模型提示词-v2.md`**：改用现代中式八球职业比赛台作风格锚点、真实规格、Image-to-3D + 拆件策略。
>
> 本文件保留作为迭代记录与「迁就现有物理尺寸」方案的参考。

> 用途：把现有「参数化建模」的台球桌换成 Tripo 生成的 3D 模型。
> 尺寸以 `src/constants.js` 的 `TABLE` 为准，袋口取真实 9 尺台规格。

---

## 一、规格来源（提示词里的数字都从这里来）

| 部位 | 现有参数值 | 说明 |
|---|---|---|
| 击球面（库边内沿之间） | **2540 × 1270 mm** | 9 尺台标准，`halfL 1.27 / halfW 0.635` |
| 外廓（含库边 + 木框） | **2820 × 1550 mm** | `halfL + cushionW 0.05 + railW 0.09` 再 ×2 |
| 橡胶库边 | 高 **62 mm** / 厚 **50 mm** | 游戏值比真实（≈40mm）高，为防跳球飞出 |
| 木质外框 | 宽 **90 mm** / 顶面高 **95 mm** | 顶面比库边高 33 mm |
| 桌裙（apron） | 下垂 **160 mm** / 板厚 22 mm | |
| 桌腿 | 4 条，**85 × 85 mm**，高 **420 mm** | 桌面离地 = 40 + 160 + 420 = **620 mm** |
| 角袋开口 | **114 mm**（4.5 英寸，真实规格） | 现有物理喉口 57 mm 半径，一致 |
| 中袋开口 | **127 mm**（5 英寸，真实规格） | ⚠️ 现有物理是 120 mm，见第五节 |

**配色（现有材质）**

| 部位 | 色值 | 质感 |
|---|---|---|
| 台布 cloth | `#1C6B4A` 深绿 | 哑光绒面，粗糙度 0.94 |
| 库边 cushion | `#18754F` 略亮绿 | 橡胶，粗糙度 0.85 |
| 木质 rails / 裙板 / 腿 | `#5B3220` 深红棕胡桃 | 缎光清漆，粗糙度 0.55，微弱金属感 0.08 |
| 袋口内衬 / 收口环 | `#1B2126` 近黑 | 哑光 0.88 |

---

## 二、主提示词（英文，直接粘贴进 Tripo）

Tripo 对英文理解更准，且优先看句子前半段的形状描述 —— 台球桌类型和袋口位置放最前面。

```text
Realistic 9-foot tournament billiard table, a single standalone furniture asset,
photo-accurate proportions: playing bed 2540 x 1270 mm, overall footprint
2820 x 1550 mm, bed surface 620 mm above the floor.

Six true pockets, correctly placed and sized: four corner pockets with 114 mm
openings cut at 45 degrees into the corners, and two side pockets with 127 mm
openings centred on the exact middle of each long rail. The side pockets are
visibly larger than the corner pockets. Every pocket mouth leads down into a
matte black leather-lined pocket throat that hangs below the bed, with a
slightly bulged leather rim around each opening.

Six green rubber cushions with a beveled playing edge and true 45-degree jaw
angles on both sides of every pocket mouth, capped by a wide polished
reddish-brown hardwood rail frame with a softly rounded outer edge, inlaid with
small diamond sight markers along the top. A matching hardwood apron skirt
160 mm deep runs below the bed, and four square tapered hardwood legs with a
small turned collar stand at the corners.

Material response: the bed cloth is matte woven dark green felt (#1C6B4A) with a
fine fibre sheen; the cushions are slightly brighter green rubber (#18754F); the
wood is deep reddish-walnut satin lacquer (#5B3220) with visible fine grain; the
pocket liners and interior are near-black matte (#1B2126).

Game-ready: clean quad topology, symmetrical, separate material zones for wood,
cloth, rubber and pocket liner, baked PBR textures, centred at the origin, Y-up,
empty table surface.
```

### 中文对照（只是给你看，不用粘进 Tripo）

> 写实 9 尺锦标赛台球桌，单体家具资产，比例准确：击球面 2540 × 1270 mm，外廓 2820 × 1550 mm，台面离地 620 mm。
> 六个真实袋口、位置与尺寸正确：四个角袋开口 114 mm、以 45° 切入台角；两个中袋开口 127 mm，精确位于每条长库边的中点。中袋明显大于角袋。每个袋口向下接入哑光黑皮革内衬的落袋喉口，悬在台面下方，袋口周围有一圈微鼓的皮革收口。
> 六段绿色橡胶库边，击球面有倒角，每个袋口两侧都是真实的 45° 死角；上面压着宽大的红棕抛光木框，外沿圆润，顶面嵌有小菱形瞄准标记。台面下方是一圈 160 mm 深的同色木质桌裙，四角是带小束腰的方形收分桌腿。
> 材质表现：台布为哑光深绿绒面（#1C6B4A），有细微纤维光泽；库边为略亮的绿色橡胶（#18754F）；木质为深红棕胡桃缎光漆（#5B3220），有清晰细木纹；袋口内衬与内部为近黑哑光（#1B2126）。
> 游戏可用：干净四边面拓扑、左右前后对称、木/布/胶/内衬分材质槽、烘焙 PBR 贴图、原点居中、Y 轴向上、桌面为空。

---

## 三、Tripo 参数面板建议

| 选项 | 取值 | 理由 |
|---|---|---|
| 模型版本 | **v3.1 / H3.1**（有 P1.0 更好） | 几何精度优先；P1.0 直接出四边面 |
| 面数上限 Face Limit | **Medium–High（3 万面左右）** | 台子是静态背景物，袋口是曲面细节，面数给足 |
| 四边面重网格 Quad Mesh | **开启** | 后续若要做袋口微调、法线烘焙更省事 |
| 自动尺寸 Auto Size | **开启**（或生成后手动校准） | 目标：外廓 2820 × 1550 mm |
| 贴图 Texture | **开启** | |
| PBR | **开启** | 木漆 vs 绒布 vs 哑光皮革的差异全靠它 |
| 贴图质量 | **Detailed / HD** | |
| 对称 Symmetry | **先关**，袋口歪了再开 | 开启后中袋正好落在镜像面上，可能被做成一个整体凸台或直接被切开 |
| 种子 Seed | 首次固定一个，只变纹理种子 | 便于比较手感 |

**负向提示词（Negative Prompt，单独输入）**

```text
no balls, no cue stick, no rack, no hands, no people, no background, no floor,
no room, no wall, no text, no brand logo, no painted markings on the cloth,
no extra pockets, no slots or cut-outs other than the six pockets, no floating
or disconnected parts, no fused legs, no clutter, no cartoon style, no low-poly
faceting, no flat untextured surfaces
```

---

## 四、两个要你决定的取舍

### ① 中袋：真实 127 mm vs 现有物理 120 mm

提示词里写的是**真实 127 mm**，但游戏物理的喉口现在只有 **120 mm**（`TABLE.pocketThroatMid = 0.060`）。
原因是台面上挖出的方形开口只有 125 mm 见方，再大就放不下收口环了。

如果模型真的做出 127 mm 的洞而物理还是 120 mm，会出现「视觉上洞口比能进的尺寸大一点」的轻微不一致（球在洞口边缘被挡的那一下会看出缝隙）。

两条路：

- **A. 物理跟着改成真实 127 mm**（体检报告里的待办项）：要同时加宽 `pocketGapMid` 与 `pocketCut`，会牵动台布拼块、库边断开位置，**并且必须重扫一遍开球参数**（`BREAK_SHOCK.sideBias / fanAngle`、`RACK.shiftX` 对袋口尺寸极敏感）。
- **B. 物理不动**：把提示词里的 `127 mm` 改成 `120 mm`、`114 mm` 改成 `114 mm`（角袋本来就一致）。

### ② 桌腿高度：620 mm vs 真实 800 mm

现有 `legH` 只有 420 mm，桌面离地 620 mm（真实 9 尺台是 790~800 mm），当初是为了配合相机机位压低的。提示词按现有 620 mm 写。

想要更真实就把提示词里的 `620 mm` 换成 `800 mm`，同时把 `TABLE.legH` 从 0.42 改成 0.61 —— 但相机 rig 的高度与俯角需要重新对一遍。

---

## 五、生成后接进游戏（这一步比提示词更容易翻车）

**关键：不要让模型接管台布和库边。**

袋口的精确几何（114 / 127 mm）和碰撞体是 `layout.js` 算出来的，Tripo 出的洞位置和尺寸不可能对上——一旦台布也换成模型，球会滚到洞口边缘**悬空或卡住**，而那正是"进袋判定"最敏感的地方。

推荐接法：

1. **模型只取四件**：木质外框（rails）、桌裙（apron）、桌腿（legs）、袋口内衬（liner）。
   台布（cloth）与库边（cushion）继续由代码程序化生成 —— 换色、纹理、画质档位都还能动态调。
2. **接缝位置**：木框内沿 = `x = ±(1.27 + 0.05) = ±1.32 m`、`z = ±(0.635 + 0.05) = ±0.685 m`。
   模型这一圈必须正好贴住库边外沿，差 2~3 mm 就会露出缝。
3. **尺寸校准**：导入后按外廓 φ 缩放到 **2.82 × 1.55 m**，再把"台布顶面"对齐到 `y = 0`（现有坐标系的台面就是 y=0）。Tripo 出的模型尺寸是随机的，必须校。
4. **删掉多余材质槽**：模型里若烘了 cloth / cushion 材质，删掉换成代码的材质，否则台布就是一张死的贴图。
5. **碰撞体完全不动**：`tableBoxes()` 里带 `phys` 的那些 box 继续建，模型只是视觉层。

这样替换后，物理、进袋判定、开球标定全都不受影响，只有观感变了 —— 也就不用重跑那套开球参数扫描。

---

## 六、如果想更省事：提示词可以拆

Tripo 对"一张完整桌子"的理解力还行，但它对**细长小特征**（袋口收口的皮革圈、菱形瞄准点）经常糊掉。如果第一版袋口不满意，可以改用两步：

1. 先用上面主提示词生成整体（只为拿外框与腿的比例）；
2. 再单独生成「black leather pool table pocket liner with bulged rim」（单体小件），手工摆到 6 个袋口位置。

小件单独生成的成功率远高于逼它在一张桌子上刻出 6 个细节。
