/**
 * 中英文切换 · 词表（中文原文 → 英文）
 * ------------------------------------------------------------------
 * 由 public/i18n.js 使用，两份页面各引一次。**key 就是界面上的中文原文**
 * （空白已归一化：换行/多空格折叠成一个空格、首尾去空），不是编码过的 key：
 * 改文案时这里跟着改一行就行，不用回代码里找 key。
 *
 * 三种情形：
 *   ① 固定文案      → HMZQ_EN['开球'] = 'Break'
 *   ② 带变量的      → HMZQ_EN_RULES 里一条正则（`玩家2 胜` / `余 3 次` / `20 分`…）
 *   ③ 带 <b> 的整段 → 值里也带 HTML，整块替换（key 是不带标签的纯文本）
 *
 * 术语口径（统一，别一处一个说法）：
 *   cue ball 白球 · break 开球 · pot 落袋/进球 · pocket 袋口 · corner/side pocket 角袋/中袋
 *   cushion 库边 · cloth 台呢 · rack 摆球/球堆 · solids 小号(1-7) · stripes 大号(9-15)
 *   the 8-ball 黑八 · ball in hand 手中球 · foul 犯规 · run 连击
 *
 * ⚠️ 改完跑 `node scripts/i18n-audit.mjs`：它会用与运行时同一套规则扫 HTML 与 JS，
 *    列出还缺哪几条（退出码非 0 就是有漏）。全绿才算翻完。
 * ⚠️ 语言名（中文 / English）故意**不进词表**：两种语言下都显示原文才是常规做法，
 *    这两个按钮上带 data-i18n-skip。
 * ⚠️ 纯符号/数字项（`512`、`100%`、`2048`）不含汉字，运行时不会碰，不用写进来。
 */
(function (root) {
  'use strict';

  var EN = {
    /* ================= 品牌与通用 ================= */
    '幻梦-星光桌球': 'Huanmeng Starlight Pool',
    '自由练习版': 'Free-play build',
    '主菜单': 'Main menu',
    '返回主菜单': 'Back to menu',
    '帮助': 'Help',
    '关于': 'About',
    '关于本作': 'About this game',
    '关于版本': 'About',
    '取消': 'Cancel',
    '确定': 'OK',
    '确 定': 'OK',
    '完 成': 'Done',
    '知道了': 'Got it',
    '关闭': 'Close',
    '开启': 'On',
    '自动': 'Auto',
    '低': 'Low',
    '中': 'Medium',
    '高': 'High',
    '自定义': 'Custom',
    '简单': 'Easy',
    '中等': 'Normal',
    '困难': 'Hard',
    '极难': 'Extreme',
    '默认': 'Default',
    '宽松': 'Lenient',
    '严格': 'Strict',
    '关': 'Off',
    '已保存': 'Saved',
    '已清空': 'Cleared',
    '收起': 'Collapse',
    '展开': 'Expand',
    '收起面板': 'Collapse panel',
    '展开面板': 'Expand panel',

    /* ================= 游戏页静态 UI ================= */
    '正在装载物理世界…': 'Loading physics world…',
    '↺ 视角回归': '↺ Reset view',
    '⟳ 重开本局': '⟳ Restart',
    '⚙ 设置': '⚙ Settings',
    '开球': 'Break',
    '☰ 主菜单': '☰ Main menu',
    '操作设置': 'Settings',
    '操作模式': 'Camera mode',
    '自由': 'Free',
    '追踪': 'Tracking',
    '顶视': 'Top-down',
    '操作模式已由启动器锁定，游戏中不可切换': 'Camera mode is locked by the launcher and cannot be changed in game',
    '最小力度（轻推）': 'Min power (soft tap)',
    '最大力度（硬杆）': 'Max power (full stroke)',
    '非己方球半透明': 'Fade the other player\'s balls',
    '只在本地双人 / 人机对战里生效：轮到你时，不是你那组（或现在还不能打）的球淡下去， 一眼分得出该打哪颗。关掉则全程实色。':
      'Only applies to local 2-player and vs-computer: on your turn, balls that are not yours (or not yet legal) fade out so you can tell at a glance which one to hit. Turn it off to keep everything solid.',
    '音效音量': 'Sound volume',
    '背景音乐': 'Music',
    '撞球、撞库、落袋与连击语音。0 = 完全静音。': 'Ball contact, cushion, pocket and streak voice. 0 = fully muted.',
    '画质': 'Graphics',
    '语言 / Language': 'Language',
    '语言：启动器右上角的「中文 / English」胶囊按钮，或游戏内「⚙ 设置 → 语言」；两边共用一份选择，切完立刻生效并记住':
      'Language: the Chinese / English pill at the top right of the launcher, or ⚙ Settings → Language in game; both share one setting — it applies instantly and is remembered',
    '切换界面语言，立刻生效并记住；启动器与游戏共用同一个选择。':
      'Switch the interface language — it applies immediately, is remembered, and is shared with the launcher.',
    '选一档即可；想自己抠细节就选「自定义」，下面会展开阴影精度 / 渲染分辨率 / 贴图精度 / 纹理细节。上面那行是当前实际取值。':
      'Pick a preset; choose “Custom” to open shadow quality / render resolution / texture resolution / anisotropic filtering. The line above shows the values actually in use.',
    '玩法规则：中式黑八 · 在启动器的「游戏设置 → 规则设置」里更改':
      'Ruleset: Chinese 8-ball · change it in Launcher → Game Settings → Rules',
    '本局进度（球位、击球次数、已进袋的球）不会保存，确定要放弃本局游戏吗？':
      'This game\'s progress (ball positions, shot count, balls potted) will not be saved. Abandon it?',
    '继续本局': 'Keep playing',
    '放弃并返回': 'Abandon and leave',
    '重开本局？': 'Restart this game?',
    '清 台 ！': 'CLEARED!',
    '全部目标球入袋。': 'Every object ball is potted.',
    '再来一局': 'Play again',
    '幻梦-星光桌球 ': 'Huanmeng Starlight Pool ',

    /* ---- HUD ---- */
    '状态': 'Status',
    '就绪': 'Ready',
    '运动中': 'In motion',
    '白球待复位': 'Cue ball respot',
    '摆放白球': 'Placing cue ball',
    '本次力度': 'Power',
    '击球次数': 'Shots',
    '得分': 'Score',
    '剩余次数': 'Shots left',
    '剩余时间': 'Time left',
    '运动中球数': 'Balls moving',
    '帧率': 'FPS',
    '已进袋': 'Potted',
    '玩家1 已进袋': 'P1 potted',
    '玩家2 已进袋': 'P2 potted',
    '玩家1': 'Player 1',
    '玩家2': 'Player 2',
    '电脑': 'Computer',
    '你': 'You',
    '无人': 'Nobody',
    '未分组': 'Unassigned',
    '轮到你击球': 'Your turn',
    '电脑正在瞄准': 'Computer is aiming',
    '自动出杆': 'auto shot',
    '小号': 'Solids',
    '大号': 'Stripes',

    /* ---- 双人 / 人机开球键（整块） ---- */
    '玩家1开球': '<b>Player 1</b><small>Break</small>',
    '玩家2开球': '<b>Player 2</b><small>Break</small>',

    /* ---- 摆白球浮条 ---- */
    '拖动白球到你想要的位置，然后点「确定」开始': 'Drag the cue ball where you want it, then hit OK',

    /* ================= 结算 ================= */
    '全部目标球入袋，这一局打得漂亮。': 'Every object ball is down — nicely played.',
    '惜 败': 'SO CLOSE',
    '这一局没能清台，再来一杆说不定就成了。': 'Not cleared this time — one more run might do it.',
    '黑 8 提前落袋': '8-BALL TOO EARLY',
    '目标球还没清完就把黑 8 打进袋 —— 自爆，本局判负。':
      'You potted the 8-ball before clearing your object balls — this game is lost.',
    '清完自己那组球再打进黑八 —— 这一局赢下电脑了。': 'Group cleared, then the 8-ball — you beat the computer.',
    '清完自己那组球之后打进黑八 —— 这一局归你。': 'Group cleared, 8-ball potted — this game is yours.',
    '这一局没能赢下电脑 —— 换档难度或再来一局试试。':
      'The computer took this one — try another difficulty or another game.',
    '对手在自己的球清完之前就打进了黑八，判负。': 'Your opponent potted the 8-ball before clearing their group — they lose.',
    '通 关 ！': 'CLEARED!',
    '在限定次数内清台 —— 这一局打得漂亮。': 'Cleared within the shot limit — nicely played.',
    '次数用尽': 'Out of shots',
    '限定次数内没能清台，下次试试先规划走位。': 'Not cleared within the shot limit — plan your position play first.',
    '在限定时间内清台 —— 这一局打得漂亮。': 'Cleared within the time limit — nicely played.',
    '时间到': 'Time up',
    '限定时间内没能清台，下次试试打得更果断些。': 'Not cleared in time — try committing to your shots faster.',
    '全部目标球入袋 —— 看看这一局拿了多少分。': 'Every object ball is down — let\'s see your score.',
    '清台进度': 'Cleared',
    '最高连击': 'Best streak',
    '进球率': 'Pot rate',
    '用时': 'Time',

    /* ================= 画质 ================= */
    '画质档位': 'Graphics preset',
    '按设备挑一档：手机偏保守（中）、桌面放开（高）。下面那行会显示实际取值。':
      'One preset per device: phones stay conservative (medium), desktops open up (high). The line below shows the actual values.',
    '关阴影 + 原分辨率 + 512 贴图 + 最低纹理过滤：最省电，适合老机型或发烫时用。':
      'No shadows + native resolution + 512 textures + minimal filtering: cheapest, for older or overheating phones.',
    '阴影 1024 + 125% 分辨率 + 1024 贴图 + 4× 过滤：手机上推荐，观感与性能的平衡点。':
      '1024 shadows + 125% resolution + 1024 textures + 4× filtering: the recommended phone balance.',
    '阴影 2048 + 200% 分辨率 + 2048 贴图 + 8× 过滤：桌面观感最好，手机上偏烫。':
      '2048 shadows + 200% resolution + 2048 textures + 8× filtering: best on desktop, hot on phones.',
    '自己定下面四项：阴影精度 / 渲染分辨率 / 贴图精度 / 纹理细节。改任意一项都会落到这里。':
      'Set the four items below yourself: shadow quality / render resolution / texture resolution / anisotropic filtering. Changing any of them lands you here.',
    '阴影精度': 'Shadow quality',
    '关掉阴影：最省，但球和杆没有投影，立体感弱一些。': 'No shadows: cheapest, but balls and cue lose their grounding.',
    '512² 阴影：能看到投影，边缘略糊。': '512² shadows: visible, slightly soft edges.',
    '1024² 阴影：手机上推荐的平衡点。': '1024² shadows: the recommended phone balance.',
    '2048² 阴影：边缘最干净，代价是每帧多画 4 倍阴影像素。': '2048² shadows: crispest edges, at 4× the shadow pixels per frame.',
    '渲染分辨率': 'Render resolution',
    '100%：一个 CSS 像素渲染一个物理像素，最省。': '100%: one physical pixel per CSS pixel — cheapest.',
    '125%：略微超采样，锯齿更少。': '125%: slight supersampling, fewer jaggies.',
    '150%：明显更清晰，开销约为 100% 的 2.25 倍。': '150%: noticeably sharper, about 2.25× the cost of 100%.',
    '200%：最锐利，开销约为 100% 的 4 倍。': '200%: sharpest, about 4× the cost of 100%.',
    '贴图精度': 'Texture resolution',
    '256²：几乎不占显存（两张 1 MB），近看台呢和木纹会糊，只在内存极紧张时用。':
      '256²: barely any VRAM (1 MB for both), cloth and wood blur up close — only when memory is tight.',
    '512²：显存约 3 MB，远景够用，凑近看木纹偏模糊 —— 低档位默认。':
      '512²: ~3 MB VRAM, fine from a distance, soft wood grain up close — the low preset default.',
    '1024²：显存约 11 MB，桌面与手机都清楚的平衡点 —— 中档位默认。':
      '1024²: ~11 MB VRAM, crisp on both desktop and phone — the medium preset default.',
    '2048²：显存约 45 MB，木纹与台呢最细腻 —— 高档位默认，老机型慎用。':
      '2048²: ~45 MB VRAM, the finest grain and cloth — the high preset default, risky on older phones.',
    '纹理细节': 'Anisotropic filtering',
    '1×：不过滤，斜着看台布会有糊斑。': '1×: no filtering, the cloth smears at oblique angles.',
    '4×：够用，斜视观感明显改善。': '4×: enough, a clear improvement at oblique angles.',
    '8×：最清晰，采样成本最高。': '8×: crispest, highest sampling cost.',

    /* ================= 玩法 / 规则 ================= */
    '自由练习版 ': 'Free-play build ',
    '纯粹游玩：自由练习、无计分、无胜负判定': 'Pure play: free practice, no scoring, no win or loss',
    '计分模式': 'Score attack',
    '按连击与一杆多进累加分数，把全部目标球打完即结算':
      'Points for streaks and multi-pot shots; the game ends when every object ball is down',
    '限次模式': 'Shot limit',
    '限定击球次数内清台即通关，次数用尽还没清完则失败':
      'Clear the table within a fixed number of shots; run out and the game is lost',
    '计时模式': 'Time attack',
    '限定时间内清台即通关，时间到还没清完则失败':
      'Clear the table within a time limit; run out of time and the game is lost',
    '自由球模式': 'Free placement',
    '每一杆开球前都把白球摆到顺手的位置，再开始击球；按计分模式的口径计分':
      'Place the cue ball wherever you like before each shot; scored the same as score attack',
    '本地双人': 'Local 2-player',
    '同一台设备轮流击球：1~7 小号 / 9~15 大号，8 号为决胜球，先清完自己那组再打进 8 号者获胜':
      'Take turns on one device: 1–7 solids / 9–15 stripes, the 8-ball decides — clear your group first, then pot it',
    '人机对战': 'vs Computer',
    '与电脑对手对局：中式黑八规则，电脑扮演玩家2，轮到它时自己瞄准出杆（四档难度）':
      'Play a Chinese 8-ball match against the computer as Player 2 — it aims and shoots on its own (four levels)',
    '在线联机': 'Online',
    '房间与回合同步，需要服务器支持（后续阶段开放）': 'Rooms and turn sync, needs a server (planned)',
    '中式黑八': 'Chinese 8-ball',
    '标准玩法': 'Standard',
    '1~15 号全彩球摆成五排三角形，8 号居中。1~7 全色、9~15 半色，8 号决胜。':
      'Balls 1–15 racked in a five-row triangle with the 8 in the middle. 1–7 solids, 9–15 stripes, the 8 decides.',

    /* ---- 双人规则（启动器） ---- */
    '开局进球判定': 'Group assignment on the break',
    '开球那一杆只进 1 颗球时，算不算定下大小号': 'Whether potting a single ball on the break assigns groups',
    '第一杆进洞不分组': 'No groups on a single ball',
    '开球进 1 颗只算进球、由开球方继续打；进 2 颗及以上才判定分组。':
      'A single ball on the break is just a pot and the breaker continues; two or more assigns groups.',
    '第一杆进洞就分组': 'Groups on the first ball',
    '开球只要进 1 颗球，就按这颗球的号定下双方的大小号。':
      'One ball on the break is enough — its number decides who takes solids and who takes stripes.',
    '未分组时进黑八': '8-ball potted before groups',
    '开球那一杆，或还没人进过球就打进了 8 号': 'On the break, or before either player has potted a ball',
    '本局重来': 'Re-rack',
    '整局重新开球（球全部摆回、分数与分组清零），由原来开球的人重新开球。':
      'The whole game re-racks: balls back, groups cleared, same player breaks again.',
    '黑八归位，换人继续': 'Respot the 8, pass the turn',
    '这一次进黑八不算数，黑八摆回初始位置，换对手接着打，本局继续。':
      'The pot does not count: the 8-ball goes back to its spot, the opponent shoots, the game continues.',
    '击球者直接判负': 'Shooter loses',
    '打进黑八的人直接输掉这一局，本局结束。': 'Whoever pots the 8-ball loses the game on the spot.',
    '白球落袋': 'Cue ball potted',
    '白球掉袋之后接手的那一方怎么摆白球（每一杆都适用，含开球）':
      'How the incoming player places the cue ball after a scratch (every shot, break included)',
    '对方自由摆球': 'Ball in hand',
    '换人，接手的一方可以在台面任意位置摆白球（手中球）。':
      'Turn passes and the incoming player may place the cue ball anywhere on the table.',
    '白球回开球点': 'Cue ball back to the head spot',
    '换人，白球放回开球点，接手的一方从开球点打。':
      'Turn passes; the cue ball goes back to the head spot and play continues from there.',
    '已分组后提前进黑八': '8-ball potted early (groups assigned)',
    '已经定了大小号，自己的球还没清完就打进了 8 号': 'Groups are set but your own balls are still on the table',
    '直接判输': 'Lose the game',
    '自己的球没清完就打进黑八 → 直接判负，本局结束。':
      'Potting the 8-ball before clearing your group loses the game immediately.',
    '罚一颗 + 黑八回位': 'Penalty ball + respot the 8',
    '罚一颗已经打进的球重新摆回台面，黑八也摆回初始位置，然后换人。一颗都还没进就直接打进黑八 → 判负。':
      'One of your potted balls goes back on the table, the 8-ball returns to its spot, then the turn passes. If you had not potted anything yet, you lose.',
    '打错球组犯规': 'Wrong group foul',
    '第一下碰到的不是自己组的球（没清完时先碰黑八也算）':
      'The first contact is not your own group (hitting the 8-ball early counts)',
    '不罚，只换人': 'No penalty, just pass',
    '保持宽松：犯规的那一杆只换人，对方从白球现在的位置接着打。':
      'Keep it loose: the foul only passes the turn and the opponent plays from where the cue ball lies.',
    '判罚手中球': 'Ball in hand',
    '犯规 → 换人，接手的一方可以把白球摆到台面任意位置（真实规则的自由球）。':
      'Foul → turn passes and the incoming player may place the cue ball anywhere (real-rule ball in hand).',
    '空杆犯规': 'No-contact foul',
    '出杆后白球没碰到任何球': 'The cue ball never touched a ball',
    '空杆 → 换人，接手的一方可以把白球摆到台面任意位置。':
      'No contact → turn passes and the incoming player may place the cue ball anywhere.',
    '击球后没进袋': 'No pot on the shot',
    '这一杆一颗球都没打进（真实中式规则没有这条，可选的严格玩法）':
      'Nothing went down on the shot (not part of the real rules — an optional strict mode)',
    '默认：没进球就正常换人，不加别的判罚。': 'Default: no pot just passes the turn, nothing more.',
    '没进球也算犯规 → 换人，接手的一方可以把白球摆到台面任意位置。':
      'No pot counts as a foul → turn passes and the incoming player may place the cue ball anywhere.',

    /* ================= 帮助（游戏内，整段带标签） ================= */
    '基本操作': 'Controls',
    '手机 / 平板（触摸操作）': 'Phones / tablets (touch)',
    '开球与物理': 'The break and the physics',
    '界面与快捷键': 'Interface and hotkeys',
    '音效与背景音乐': 'Sound and music',
    '玩法规则（规则设置）': 'Ruleset (Rules settings)',
    '<b>通用</b>：<b>左键在任意处按下</b>即蓄力（光标右侧出现蓄力条，0→1→0 约 4 秒），松手击球；<b>蓄力期间杆向锁定</b> · <kbd>空格</kbd> 同样可蓄力':
      '<b>General</b>: <b>press the left button anywhere</b> to charge (a power bar follows the cursor, 0→1→0 in about 4 s), release to shoot; <b>the aim locks while charging</b> · <kbd>Space</kbd> charges too',
    '<b>🤖 人机对战</b>：电脑扮演<b>玩家2</b>，走的是中式黑八同一套规则；轮到它时<b>自己思考 → 转杆 → 出杆</b>，镜头也跟着它转，屏幕上写出它打算打哪颗球、多大力度 · 四档难度就是它<b>手抖的程度</b>（简单约 30% / 中等约 45% / 困难约 70% / 极难约 90% 进球率，用真实物理跑出来的）· 开球永远是你来 · <b>无论输赢都记进挑战历史</b>':
      '<b>🤖 vs Computer</b>: the computer plays <b>Player 2</b> under the same Chinese 8-ball rules; on its turn it <b>thinks → swings → shoots</b>, the camera follows, and the screen shows which ball it is going for and how hard · the four levels are just how much its <b>hand shakes</b> (about 30% / 45% / 70% / 90% pot rate, measured with the real physics) · you always break · <b>win or lose, it goes into match history</b>',
    '<b>追踪模式</b>：视角自动对焦到白球后方 · <b>右键拖拽</b>可旋转视角，瞄准方向跟随相机 · 击球后自动拉远，球停稳后自动拉回':
      '<b>Tracking</b>: the camera sits behind the cue ball · <b>right-drag</b> to swing it and the aim follows · it pulls back on the shot and returns once the balls stop',
    '<b>自由模式</b>：<b>右键拖拽</b>旋转视角（相机即方向）· <b>中键拖拽</b>平移 · 滚轮缩放 · <b>↺ 视角回归</b>复位机位':
      '<b>Free</b>: <b>right-drag</b> orbits (the camera is your aim) · <b>middle-drag</b> pans · wheel zooms · <b>↺ Reset view</b> puts the camera back',
    '<b>顶视模式</b>：正交俯视、视角固定 · 移动/拖拽鼠标改变杆子方向（手机上可<b>双指捏合放大</b>与<b>双指拖动平移</b>，见下）':
      '<b>Top-down</b>: orthographic overhead view, fixed angle · move/drag the mouse to aim the cue (on phones use <b>pinch to zoom</b> and <b>two-finger drag to pan</b>, see below)',
    '<b>单指拖动</b>：旋转视角 · <b>双指捏合</b>：缩放 · <b>双指同向拖动</b>：平移（自由模式）':
      '<b>One-finger drag</b>: orbit · <b>pinch</b>: zoom · <b>two-finger drag</b>: pan (free mode)',
    '<b>出杆</b>：按住右下角 <b>开球</b> 键开始蓄力，屏幕底部浮出大蓄力条，<b>松手即击球</b>（力度条 0→1→0 约 4 秒）· 按住期间不会弹出「选择 / 复制」菜单（已做长按防护）':
      '<b>Shooting</b>: hold the <b>Break</b> button at the bottom right to charge — a big power bar rises from the bottom edge — and <b>release to shoot</b> (0→1→0 in about 4 s) · the select/copy menu is suppressed while you hold it',
    '<b>追踪模式</b>下相机自动跟随白球，双指只保留缩放 —— 平移会被跟球逻辑立刻拉回，看着像"拖了又弹回去"':
      'In <b>tracking</b> the camera follows the cue ball, so pinching only zooms — panning gets pulled straight back, which feels like it snaps home',
    '<b>顶视模式</b>：<b>双指捏合</b>放大（最多 6 倍）、<b>双指拖动</b>平移 · 平移有边界，台子拖不出屏幕（最多把台面任意一处推到屏幕中心）· 按 <b>↺ 视角回归</b>回到整台俯视':
      '<b>Top-down</b>: <b>pinch</b> to zoom (up to 6×), <b>two-finger drag</b> to pan · panning is clamped so the table cannot leave the screen (at most any point of the cloth to the centre) · <b>↺ Reset view</b> returns to the full overhead shot',
    '<b>竖屏</b>：球台会自动转 90° <b>竖着摆</b>（长边顺着屏幕长边、尽量占满屏幕），自由模式与顶视模式都适用 · 手机转屏会自动重摆一次机位':
      '<b>Portrait</b>: the table rotates 90° to <b>stand upright</b> (long side along the screen, filling it as much as possible) in both free and top-down modes · rotating the phone re-seats the camera once',
    '<b>浏览器要求</b>：<b>用微信直接打开最省事</b>（已实测可跑），Chrome / Edge 也可以。物理引擎的 wasm 用到了 <b>Chrome / Android System WebView 75+</b> 才有的指令，小米 / 红米自带浏览器的内核停在 71，属于跑不了 —— 它会自己弹一张说明卡片告诉你原因，不会白屏':
      '<b>Browser requirements</b>: <b>opening the link inside WeChat is easiest</b> (tested and working); Chrome / Edge work too. The physics wasm uses instructions that need <b>Chrome / Android System WebView 75+</b>; the built-in browser on Xiaomi / Redmi phones is stuck on 71 and cannot run it — it shows a card explaining why instead of a blank screen',
    '<b>调试地址别混</b>：dev（<b>5183</b>，源码直出、不转译语法）只给桌面调试用；手机实测一律用 <b>npm run preview:lan</b>（<b>5184</b>，已降级的构建产物）。手机打开 5183 会看到一张"请换地址"的说明页':
      '<b>Do not mix up the dev URLs</b>: dev (<b>5183</b>, untranspiled source) is for desktop debugging only; for phone testing always use <b>npm run preview:lan</b> (<b>5184</b>, the downgraded build). Opening 5183 on a phone shows a “use the other URL” page',
    '<b>开球</b>：就是一杆普通的球，<b>进几颗算几颗</b>（不限制开球进袋数）· 三角球堆整体向开球线一侧微调 17cm，末排球不再每次固定冲进脚区角袋':
      '<b>The break</b> is just a normal shot — <b>whatever drops counts</b> (no limit on break pots) · the rack sits 17 cm toward the head end so the back-row balls no longer fly into the foot corner pockets every time',
    '<b>真实开球</b>：球堆像楔形一样向两侧扇形散开（末排角球甚至略带向后），球会铺满整张台面，不再全堆在脚区':
      '<b>A real break</b>: the pack fans out like a wedge to both sides (the back corners even drift backwards) and the balls spread over the whole table instead of piling up in the foot area',
    '<b>落袋不再"看球号"</b>：扇形扩散的角度分配重新调过，末排内圈球不再被固定甩进同两个角袋 —— 开球落袋是随机事件，实测约一半的开球一颗不进':
      '<b>Pots no longer depend on the ball number</b>: the fan angles were redistributed so the inner back-row balls are not thrown into the same two corner pockets every time — break pots are random, and about half of all breaks pot nothing',
    '<b>左下角 <kbd>?</kbd></b> 打开这份说明 · 右下角 <b>↺ 视角回归</b> / <b>⟳ 重开本局</b> / <b>⚙ 设置</b>':
      '<b><kbd>?</kbd> at the bottom left</b> opens this guide · bottom right: <b>↺ Reset view</b> / <b>⟳ Restart</b> / <b>⚙ Settings</b>',
    '<b>操作模式</b>：从启动器进入游戏时由启动器决定，游戏内不可切换（设置里的模式按钮会置灰）':
      '<b>Camera mode</b>: decided by the launcher when you enter a game and locked in game (the buttons in Settings are greyed out)',
    '<b>语言</b>在「⚙ 设置 → 语言 / Language」里切（中文 / English），启动器右上角也有同一个开关；两边共用一份选择，切完立刻生效并记住':
      '<b>Language</b> is switched in <b>⚙ Settings → Language</b> (Chinese / English); the launcher has the same switch at the top right. Both share one setting — it applies instantly and is remembered',
    '<b>画质</b>在「⚙ 设置」里：先选<b>档位</b>（自动 / 低 / 中 / 高），阴影、渲染分辨率、桌面贴图与纹理按档一起定；想自己抠细节就选<b>自定义</b>，下面会展开<b>阴影精度 / 渲染分辨率 / 贴图精度 / 纹理细节</b>四项。改动即时生效、与启动器的「游戏设置 → 画质设置」同步':
      '<b>Graphics</b> live in <b>⚙ Settings</b>: pick a <b>preset</b> (auto / low / medium / high) and shadows, render resolution, table textures and filtering all follow; choose <b>Custom</b> to open <b>shadow quality / render resolution / texture resolution / anisotropic filtering</b>. Changes apply instantly and sync with Launcher → Game Settings → Graphics',
    '左上角面板的<b>帧率</b>是半秒平均的实机读数：手机上一旦掉到 30 以下，就把画质档位调低一档':
      'The <b>FPS</b> in the top-left panel is a half-second average: if it drops below 30 on a phone, step the graphics preset down one notch',
    '<kbd>R</kbd> 重开本局 · <kbd>D</kbd> 碰撞体线框 · <kbd>H</kbd> 隐藏/显示界面':
      '<kbd>R</kbd> restart · <kbd>D</kbd> collider wireframe · <kbd>H</kbd> hide/show the interface',
    '<b>出杆 / 撞球 / 撞库 / 落袋</b>：实时合成，不看素材 —— 撞得越重越响越脆。<b>只有球撞球用 3D 音效</b>，且只在自由 / 追踪模式（按方位做左右声道与距离衰减）；顶视与其它音效一律固定音量。':
      '<b>Cue, ball contact, cushion, pocket</b>: synthesised live from the impact — the harder the hit, the louder and sharper. <b>Only ball-on-ball gets 3D audio</b>, and only in free / tracking mode (panning and distance falloff by direction); everything else is fixed volume.',
    '<b>连击播报</b>：每进一颗都有欢呼，累计 <b>2 非常好 · 3 太棒了 · 4 四连无双 · 5 五连绝世 · 6 连及以上超越神的球技</b>；一杆进 2 颗及以上改播 <b>双响炮 / 三响炮 / 满堂彩</b>。':
      '<b>Streak calls</b>: every pot gets a cheer, with escalating lines at <b>2 · 3 · 4 · 5 · 6 or more</b> in a row; two or more in one shot plays a multi-pot call instead.',
    '<b>连击</b>按连续进球跨杆累计（白球进袋或某一杆空杆就清零）。<b>白球进洞</b>会来一声尴尬长号，不喝彩。<b>音量与曲目</b>在「⚙ 设置」里调，与启动器同步。':
      '<b>Streaks</b> carry across shots (a scratch or a dry shot resets them). <b>Scratching</b> gets a sad trombone, not a cheer. <b>Volume and track</b> are in ⚙ Settings and sync with the launcher.',
    '<b>结算</b>：清台后播胜利号角并弹出结算窗（击球次数 / 清台进度 / 最高连击）。失败与「黑 8 提前落袋」的结算已备好，等胜负规则上线后启用。':
      '<b>Results</b>: clearing the table plays a fanfare and opens the summary (shots / progress / best streak). Defeat and “8-ball too early” screens are ready and switch on with the win-loss rules.',
    '现在是<b>中式黑八</b>：1~15 号摆成五排三角形、8 号居中；1~7 全色、9~15 半色、8 号决胜。':
      'It is <b>Chinese 8-ball</b> right now: 1–15 racked in a five-row triangle with the 8 in the middle; 1–7 solids, 9–15 stripes, the 8 decides.',
    '<b>斯诺克规则</b>与<b>俄式规则</b>是未来的玩法，界面上是禁用状态（标着「敬请期待」），现阶段选不了。':
      '<b>Snooker</b> and <b>Russian pyramid</b> are planned; they are disabled on the UI (“Coming soon”) and cannot be picked yet.',
    '它只影响<b>桌面上有哪些球、怎么摆</b>；切换后进入游戏（或在游戏内按 <kbd>R</kbd> 重开本局）即按新玩法重新摆球。':
      'It only changes <b>which balls are on the table and how they are racked</b>; enter a game (or press <kbd>R</kbd>) and the new rack is used.',

    /* ================= 启动器 · 侧栏与一级页 ================= */
    '↑↓ 选择 · Enter 确定 · Esc 返回': '<kbd>↑</kbd><kbd>↓</kbd> Select · <kbd>Enter</kbd> Confirm · <kbd>Esc</kbd> Back',
    '常规模式': 'Standard play',
    '娱乐模式': 'Casual play',
    '挑战历史': 'Match history',
    '游戏设置': 'Game settings',
    '退出游戏': 'Quit',
    '先选玩法，需要难度的再选难度，然后进入球台':
      'Pick a mode, pick a difficulty if it has one, then head to the table',
    '可进入': 'Available',
    '单人模式': 'Solo',
    '计分 / 限次 / 计时三种玩法，成绩会记进挑战历史':
      'Score attack / shot limit / time attack — every game goes into match history',
    '选择玩法 →': 'Choose a mode →',
    '进入球台 →': 'To the table →',
    '同一台机器轮流击球：1~7 小号 / 9~15 大号，先清完自己那组再打进 8 号者获胜':
      'Take turns on one machine: 1–7 solids / 9–15 stripes — clear your group first, then pot the 8',
    '后续开发': 'Planned',
    '在线联机大厅': 'Online lobby',
    '匹配对手、房间与回合同步，需要服务器支持': 'Matchmaking, rooms and turn sync — needs a server',
    '与电脑对手对局 · 中式黑八 · 选择难度': 'Play the computer · Chinese 8-ball · choose a level',
    '选择难度 →': 'Choose a level →',
    '当前可进入 自由模式、单人模式（计分 / 限次 / 计时）、本地双人模式 与 人机对战；在线联机将在后续阶段开发。 双人 / 人机模式是轮流击球：屏幕顶部会大字提示轮到谁，玩家 1 用右边的开球键、 玩家 2 用左边的（人机模式下左边那颗是电脑自己打，永远置灰）， 规则细节在「游戏设置 → 规则设置」里改。 游戏内右下角有 ⟳ 重开本局（会先问一句，中途重开的那局不记入历史）； 打完的每一局都会记进 挑战历史。':
      'Available now: <b>free play</b>, <b>solo (score attack / shot limit / time attack)</b>, <b>local 2-player</b> and <b>vs computer</b>; online play comes later. The 2-player and vs-computer modes take <b>turns</b>: a big banner at the top says whose turn it is, Player 1 uses the right break button and Player 2 the left one (in vs-computer the left button is the computer\'s own shot and stays greyed out). Rule details live in Game Settings → Rules. In game, <b>⟳ Restart</b> at the bottom right asks first and does not count towards history; every finished game goes into <b>match history</b>.',
    '选一种玩法 —— 限次与计时还要再选难度': 'Pick a mode — shot limit and time attack ask for a level next',
    '‹ 常规模式': '‹ Standard play',
    '连击与一杆多进加分，清台结算': 'Points for streaks and multi-pots, settled when the table is cleared',
    '计分模式连击与一杆多进加分，清台结算': '<b>Score attack</b><i>Points for streaks and multi-pots, settled when the table is cleared</i>',
    '限次模式限定次数内清台 · 去选难度 →': '<b>Shot limit</b><i>Clear the table in a set number of shots · choose a level →</i>',
    '计时模式限定时间内清台 · 去选难度 →': '<b>Time attack</b><i>Clear the table in a set time · choose a level →</i>',
    '限定次数内清台 · 去选难度 →': 'Clear the table in a set number of shots · choose a level →',
    '限定时间内清台 · 去选难度 →': 'Clear the table in a set time · choose a level →',
    '限次模式 · 选择难度': 'Shot limit · choose a level',
    '难度只决定给多少次出杆机会': 'The level only sets how many shots you get',
    '‹ 单人模式': '‹ Solo',
    '简单40 次机会': '<b>Easy</b><i>40 shots</i>',
    '中等30 次机会': '<b>Normal</b><i>30 shots</i>',
    '困难20 次机会': '<b>Hard</b><i>20 shots</i>',
    '40 次机会': '40 shots',
    '30 次机会': '30 shots',
    '20 次机会': '20 shots',
    '计时模式 · 选择难度': 'Time attack · choose a level',
    '难度只决定给多长时间': 'The level only sets how much time you get',
    '简单10 分钟': '<b>Easy</b><i>10 minutes</i>',
    '中等6 分钟': '<b>Normal</b><i>6 minutes</i>',
    '困难3 分钟': '<b>Hard</b><i>3 minutes</i>',
    '10 分钟': '10 minutes',
    '6 分钟': '6 minutes',
    '3 分钟': '3 minutes',
    '人机对战 · 选择难度': 'vs Computer · choose a level',
    '中式黑八规则 · 你打玩家1，电脑扮演玩家2，轮到它时自己瞄准出杆':
      'Chinese 8-ball · you are Player 1, the computer is Player 2 and shoots on its own',
    '简单对手失误多（进球率约 30%）· 适合熟悉操作':
      '<b>Easy</b><i>Misses a lot (about 30% pot rate) — good for learning the controls</i>',
    '中等会打，但失误不少（约 45%）': '<b>Normal</b><i>Can play, but misses plenty (about 45%)</i>',
    '困难准度高，长台与薄球偶尔失手（约 70%）':
      '<b>Hard</b><i>Accurate — the occasional miss on long or thin cuts (about 70%)</i>',
    '极难几乎不失误，长台薄球也照进（约 90%）':
      '<b>Extreme</b><i>Barely misses, long thin cuts included (about 90%)</i>',
    '对手失误多（进球率约 30%）· 适合熟悉操作': 'Misses a lot (about 30% pot rate) — good for learning the controls',
    '会打，但失误不少（约 45%）': 'Can play, but misses plenty (about 45%)',
    '准度高，长台与薄球偶尔失手（约 70%）': 'Accurate — the occasional miss on long or thin cuts (about 70%)',
    '几乎不失误，长台薄球也照进（约 90%）': 'Barely misses, long thin cuts included (about 90%)',
    '四档难度只是电脑的手抖程度不同：球桌、球、出杆链路与你自己打的时候完全一致， 电脑不占任何物理上的便宜。进球率是 用真实物理跑几百杆量出来的， 觉得对手太强或太弱都好调（改 AI_LEVELS 的抖动值即可）。 无论输赢都会记进 挑战历史，历史页能看出你对电脑的胜负战绩。':
      'The four levels only change how much the <b>computer\'s hand shakes</b>: the table, the balls and the whole shot pipeline are identical to yours, so it gets no physical advantage. The pot rates were <b>measured by running hundreds of shots through the real physics</b>, and they are easy to retune (adjust the jitter in <b>AI_LEVELS</b>). Win or lose, every game goes into <b>match history</b>, where you can see your record against the computer.',
    '常规之外的花式玩法，记录单独收进挑战历史的「娱乐」标签':
      'Extra modes beyond the standard ones, filed under the “Casual” tab in match history',
    '开杆前自己把白球摆到顺手的位置 · 按计分口径算分':
      'Place the cue ball wherever you like before each shot · scored like score attack',
    '查看玩法 →': 'How it plays →',
    '敬请期待': 'Coming soon',
    '花式玩法': 'Trick shots',
    '规则之外的趣味打法': 'Fun formats outside the rulebook',
    '限时挑战': 'Timed challenge',
    '抢时间的短局玩法': 'Short rounds against the clock',
    '街机闯关': 'Arcade run',
    '一关比一关难': 'Each level harder than the last',
    '娱乐模式不参与常规排行的分组：它的每一局照样记进 挑战历史， 只是单独放在 娱乐 标签里 —— 以后再加新玩法不用往菜单位置里挤。':
      'Casual modes stay out of the standard rankings: every game still goes into <b>match history</b>, just under the <b>Casual</b> tab — so future modes do not have to squeeze into the menu.',
    '娱乐': 'Casual',

    /* ---- 自由球玩法页 ---- */
    '每一杆开球前，都先把白球摆到你想要的位置': 'Before every shot, put the cue ball exactly where you want it',
    '‹ 娱乐模式': '‹ Casual play',
    '怎么玩': 'How it plays',
    '每一杆开球前都会先进入 摆放白球 阶段：拖着白球挪到任意顺手的位置， 不用被上一杆的走位结果绑住 —— 想打哪就先把白球摆到哪，开挂般的练习手感':
      '<b>Every shot starts in the cue-ball placement phase</b>: drag the cue ball anywhere you like, with no need to live with the last shot\'s position — put it where you want to shoot from, which makes practice almost unfair',
    '位置不能压在袋口上，也不能嵌进库边里 —— 拖到不合法的位置时它会自动停在合法处':
      'It cannot sit <b>over a pocket</b> or inside a <b>cushion</b> — drag it somewhere illegal and it stops at the nearest legal spot',
    '摆好后点确定，才进入瞄准阶段；此前按不出杆': 'Hit <b>OK</b> once it is placed to start aiming; no shot goes off before that',
    '摆球的同时照样能转视角、缩放：鼠标右键拖动 / 滚轮，手机上用双指 （单指留给拖白球）':
      '<b>You can still orbit and zoom while placing</b>: right-drag / wheel with a mouse, <b>two fingers</b> on a phone (one finger is reserved for dragging the cue ball)',
    '计分口径与计分模式完全一致：进一颗 +1、连进递增、一杆多进额外加分、白球落袋 −1':
      'Scoring matches <b>score attack</b> exactly: +1 per pot, escalating bonuses for streaks, extra for multi-pots, −1 for a scratch',
    '没有次数与时限，桌面上的球打完（清台）就算通关。':
      'No shot or time limit — clear the table and the game is won.',

    /* ---- 挑战历史 ---- */
    '每一局的用时与成绩，按玩法分组': 'Time and score for every game, grouped by mode',
    '初始化': 'Reset',
    '只清空当前标签下的记录：在「计分」里点就只清计分模式，在「所有」里点是全部清空。 记录最多保留 200 条（超出丢最旧的），只存本机。 点任意一条可以看 这一局的完整数据 （进球率、平均瞄准时间、视角模式等）。':
      '<b>Reset</b> clears only the current tab: under “Score” it clears score-attack records, under “All” it clears everything. At most <b>200</b> records are kept (oldest dropped first) and they stay on this device. Tap any row to see <b>the full numbers for that game</b> (pot rate, average aiming time, camera mode and more).',
    '这一局的完整数据': 'the full numbers for that game',
    '本局详情': 'Game details',
    '所有': 'All',
    '计分': 'Score',
    '限次': 'Limit',
    '计时': 'Timed',
    '自由': 'Free',
    '人机': 'vs CPU',
    '双人': '2P',
    '联机': 'Online',
    '通关': 'Cleared',
    '失败': 'Failed',
    '胜利': 'Won',
    '追踪视角': 'Tracking',
    '自由视角': 'Free',
    '玩法模式': 'Mode',
    '玩家': 'Player',
    '结果': 'Result',
    '获胜方': 'Winner',
    '进球': 'Potted',
    '平均瞄准': 'Avg. aim',
    '视角模式': 'Camera',
    '时间': 'Date',

    /* ---- 设置（二级页） ---- */
    '四类设置分门别类，改动即时保存，进入游戏后依然生效':
      'Four groups of settings, saved the moment you change them and applied in game',
    '玩家名称、最小 / 最大力度、操作模式': 'Player name, min / max power, camera mode',
    '进入 →': 'Open →',
    '声音设置': 'Audio settings',
    '音效与背景音乐音量、曲目选择': 'Sound and music volume, track choice',
    '画质设置': 'Graphics settings',
    '按机器性能挑一档：自动 / 低 / 中 / 高': 'One preset for your hardware: auto / low / medium / high',
    '规则设置': 'Rules settings',
    '玩法规则：桌面上的球有哪些、怎么摆': 'Ruleset: which balls are on the table and how they are racked',
    '恢复默认': 'Reset to defaults',
    '四类设置与游戏内「⚙ 设置」共享同一份存档，两边改动互相同步。 以后再加新的设置分类，只要在这里加一张卡 + 一个二级页，不用动菜单。':
      'All four groups share one save file with the in-game ⚙ Settings, so changes sync both ways. Adding a new group later just needs a card here and one sub-page — the menu stays untouched.',
    '改动即时保存，进入游戏后依然生效（游戏内也可以再调整）':
      'Saved as you change it and applied in game (and adjustable there too)',
    '‹ 设置': '‹ Settings',
    '玩家名称': 'Player name',
    '显示在挑战历史里，最长 12 个字。不填就是「玩家1」。':
      'Shown in match history, up to 12 characters. Leave it blank for “Player 1”.',
    '蓄力条刚起步就松手时的力度。数值越大，最轻的一杆也越有力。':
      'The power of a release right after charging starts. Higher makes even the softest tap stronger.',
    '蓄满力时的力度。开球与大力炸球都靠它。': 'The power of a full charge — this is what the break and power shots rely on.',
    '进入游戏后锁定，不可切换': 'Locked once in game',
    '追踪：视角自动对焦到白球后方，瞄准方向跟随相机。':
      'Tracking: the camera sits behind the cue ball and the aim follows it.',
    '与游戏内「⚙ 设置」是同一份，两边改动互相同步':
      'The same save as the in-game ⚙ Settings — changes sync both ways',
    '球撞球、出杆、落袋与连击语音的音量。0 = 完全静音。':
      'Volume of ball contact, cue, pocket and streak voice. 0 = fully muted.',
    '背景音乐音量': 'Music volume',
    'BGM 是陪衬，建议低于音效音量。': 'Music is background — keep it below the sound volume.',
    '背景音乐曲目': 'Music track',
    '两首都来自维基共享资源，可自由使用（授权见「关于」）。':
      'Both tracks come from Wikimedia Commons and are free to use (credits under About).',
    '阴影、分辨率、贴图与纹理不再单独调，按档位一次到位':
      'Shadows, resolution, textures and filtering are set by preset instead of one at a time',
    '进游戏后也能在「⚙ 设置」里改。阴影、分辨率与桌面贴图是最吃性能的几项：手机（红米 K30 一档）建议留在 自动或中，卡顿就选低；想自己抠细节就选自定义， 下面会展开阴影精度 / 渲染分辨率 / 贴图精度 / 纹理细节四项。左上角面板里的「帧率」就是实机读数。':
      'You can also change this in game under ⚙ Settings. Shadows, resolution and <b>table textures</b> are the expensive parts: on a phone (a Redmi K30 class device) stay on <b>Auto</b> or <b>Medium</b>, drop to <b>Low</b> if it stutters; choose <b>Custom</b> to open shadow quality / render resolution / texture resolution / anisotropic filtering. The FPS in the top-left panel is the real reading.',
    '按玩法分开：一个人打的一套，双人对战的一套': 'Split by mode: one set for solo play, one for two players',
    '单人模式规则': 'Solo rules',
    '玩法规则：桌面上的球有哪些、怎么摆（自由 / 计分 / 限次 / 计时共用）':
      'Ruleset: which balls are on the table and how they are racked (shared by free / score / limit / timed)',
    '双人对战规则': 'Two-player rules',
    '本地双人与人机对战：分组、黑八处置、白球落袋与犯规罚则':
      'Local 2-player and vs computer: groups, dealing with the 8-ball, scratches and foul penalties',
    '单人规则影响所有一个人打的玩法；双人规则只在「本地双人」与「人机对战」里生效。 犯规罚则默认全部关闭 —— 犯规只换人，想要真实规则的"手中球"判罚再到双人对战规则里开。':
      'Solo rules affect every single-player mode; two-player rules only apply to <b>local 2-player</b> and <b>vs computer</b>. <b>Foul penalties are all off by default</b> — a foul just passes the turn; turn on real-rule ball in hand under two-player rules if you want it.',
    '犯规罚则默认全部关闭': 'Foul penalties are all off by default',
    '决定球桌上玩的是哪一种台球（自由 / 计分 / 限次 / 计时共用）':
      'Which cue sport is on the table (shared by free / score / limit / timed)',
    '‹ 规则设置': '‹ Rules settings',
    '玩法规则': 'Ruleset',
    '决定桌面上有哪些球、怎么摆': 'Which balls are on the table and how they are racked',
    '球体设置只改变「桌面上有哪些球、怎么摆」， 不涉及计分、犯规与胜负判定。 进入游戏（或在游戏内重开本局）时按这里的设置摆球。':
      'The ruleset only changes <b>which balls are on the table and how they are racked</b>; it does not touch <b>scoring, fouls or win conditions</b>. The table is racked this way when you enter a game (or restart from inside one).',
    '不涉及计分、犯规与胜负判定': 'scoring, fouls or win conditions',
    '只在「本地双人」与「人机对战」里生效，单人玩法不受影响':
      'Only applies to local 2-player and vs computer; solo modes are unaffected',
    '分组与判罚': 'Groups and rulings',
    '大小号怎么定、黑八与白球落袋怎么处置': 'How groups are assigned and how 8-balls and scratches are handled',
    '犯规罚则': 'Foul penalties',
    '默认全部关闭：犯规只换人。开启后才按真实规则判"手中球"':
      'All off by default: a foul just passes the turn. Turn one on and it awards real-rule ball in hand',
    '开球那一杆进 2 颗及以上一定判定分组，这条是硬规则。 「击球后没进袋」的罚则比真实中式规则更严，想要挑战再开 —— 默认关。':
      'Potting <b>two or more on the break always assigns groups</b> — that one is a hard rule. The “no pot on the shot” penalty is stricter than the real Chinese rules, so it stays off unless you want the challenge.',
    '开球那一杆': 'On the break',
    '进 2 颗及以上一定判定分组': 'two or more pots always assign groups',

    /* ---- 帮助 / 关于 / 退出 ---- */
    '操作方式与玩法说明': 'Controls and how the game plays',
    '界面': 'Interface',
    '<b>左下角 <kbd>?</kbd></b> 打开游戏内说明（全屏弹窗）':
      '<b><kbd>?</kbd> at the bottom left</b> opens the in-game guide (full-screen)',
    '右下角一排：↺ 视角回归 · ⟳ 重开本局（完全重开一盘）· ⚙ 设置':
      'Bottom-right row: <b>↺ Reset view</b> · <b>⟳ Restart</b> (fresh game) · <b>⚙ Settings</b>',
    '返回主菜单在「⚙ 设置」弹窗的顶部，点击后会询问是否放弃本局':
      '<b>Back to menu</b> sits at the top of the ⚙ Settings dialog and asks before you lose the game',
    '画质在「启动器 → 游戏设置 → 画质设置」里：四档（自动 / 低 / 中 / 高），一次把阴影、分辨率、桌面贴图与纹理都定下来':
      '<b>Graphics</b> live under Launcher → Game Settings → Graphics: four presets (auto / low / medium / high) that set shadows, resolution, table textures and filtering in one go',
    '左上角面板里的帧率是实机读数（半秒平均），卡不卡看它最准':
      'The <b>FPS</b> in the top-left panel is the real reading (half-second average) — the surest sign of whether it stutters',
    '<kbd>R</kbd> 重开本局 · <kbd>D</kbd> 碰撞体线框 · <kbd>H</kbd> 隐藏界面 · <kbd>Esc</kbd> 关闭弹窗':
      '<kbd>R</kbd> restart · <kbd>D</kbd> collider wireframe · <kbd>H</kbd> hide the interface · <kbd>Esc</kbd> close dialogs',
    '在 启动器 → 游戏设置 → 规则设置 → 玩法规则 里切换：现在是中式黑八（1~15 号五排三角形、8 号居中；1~7 全色、9~15 半色）':
      'Switch it under <b>Launcher → Game Settings → Rules → Ruleset</b>: currently <b>Chinese 8-ball</b> (1–15 in a five-row triangle with the 8 in the middle; 1–7 solids, 9–15 stripes)',
    '斯诺克规则与俄式规则是未来开发的方向，界面上禁用（「敬请期待」），现阶段选不了':
      '<b>Snooker</b> and <b>Russian pyramid</b> are future plans and disabled on the UI (“Coming soon”)',
    '它只影响桌面上有哪些球、怎么摆；计分与胜负规则在后续版本加入':
      'It only affects <b>which balls are on the table and how they are racked</b>; scoring and win rules arrive in a later version',
    '版本与制作信息': 'Version and credits',
    '系列': 'Series',
    '幻梦系列（HUANMENG）': 'Huanmeng series',
    '制作人': 'Studio',
    '幻梦-拾光回廊工作室': 'Huanmeng · Shiguang Corridor Studio',
    '开发工具': 'Built with',
    '渲染': 'Rendering',
    '物理': 'Physics',
    'Rapier3D（9 尺台真实规格）': 'Rapier3D (real 9-ft table specs)',
    '构建': 'Build',
    '平台': 'Platforms',
    'Windows 桌面端 / 网页端（手机浏览器可用）': 'Windows desktop / web (works in phone browsers)',
    '音效': 'Audio',
    'Web Audio 实时合成 + 素材': 'Web Audio synthesis + samples',
    '联系方式': 'Contact',
    '扫码加好友': 'Scan to add me',
    '微信：扫左侧二维码加好友（二维码后续补上）': '<b>WeChat</b>: scan the code on the left to add me (code coming soon)',
    '工作室：幻梦-拾光回廊工作室（注册中）': '<b>Studio</b>: Huanmeng · Shiguang Corridor Studio (registering)',
    '作者：幻梦丶海炎': '<b>Author</b>: Huanmeng · Haiyan',
    '玩法建议、BUG 与合作意向，欢迎随时反馈': 'Ideas, bug reports and collaboration enquiries are always welcome',
    '音频素材署名': 'Audio credits',
    '爵士酒廊：Bar Bugz《Backbay Lounge》· CC BY 3.0（Wikimedia Commons）':
      '<b>Lounge jazz</b>: Bar Bugz “Backbay Lounge” · CC BY 3.0 (Wikimedia Commons)',
    '公园爵士：《Jazz at the park》· CC0 公有领域（Wikimedia Commons）':
      '<b>Park jazz</b>: “Jazz at the park” · CC0 public domain (Wikimedia Commons)',
    '欢呼 / 掌声：《Hurray》《Clapping hurray》· CC0 公有领域（Wikimedia Commons）':
      '<b>Cheers / applause</b>: “Hurray”, “Clapping hurray” · CC0 public domain (Wikimedia Commons)',
    '连击语音：百度翻译在线合成朗读的中文短句':
      '<b>Streak voice</b>: Chinese phrases from Baidu Translate text-to-speech',
    '幻梦-星光桌球是「幻梦」系列的第一款作品 —— 后续作品的命名都会带上这个系列名':
      '<b>Huanmeng Starlight Pool</b> is the first entry in the “Huanmeng” series — later titles carry the same name',
    '由 幻梦-拾光回廊工作室 制作，全程使用 WorkBuddy 开发':
      'Made by <b>Huanmeng · Shiguang Corridor Studio</b>, built entirely with <b>WorkBuddy</b>',
    '「幻梦」代表作者 幻梦丶海炎 的个人作品线': '“Huanmeng” is the personal line of <b>Huanmeng · Haiyan</b>',
    '确定要退出幻梦-星光桌球吗？': 'Quit Huanmeng Starlight Pool?',
    '未保存的进度只有当前这一局的球位，退出后需要重新摆球。':
      'The only unsaved progress is the current game\'s ball positions — you will re-rack next time.',

    /* ================= 启动器 · JS 动态文案 ================= */
    '自由：右键拖拽旋转视角（相机即方向），中键平移、滚轮缩放，斜俯视角。':
      'Free: right-drag to orbit (the camera is your aim), middle-drag to pan, wheel to zoom — an angled overhead view.',
    '追踪：视角自动对焦到白球后方，瞄准方向跟随相机，最接近真人站位。':
      'Tracking: the camera sits behind the cue ball and the aim follows it — closest to standing at the table.',
    '顶视：正交俯视、视角固定，移动鼠标改变杆向，适合看清走位与角度。':
      'Top-down: orthographic overhead view with a fixed angle; move the mouse to aim — best for reading angles and position.',
    '舒缓的爵士三重奏，适合慢慢打。（Bar Bugz - Backbay Lounge，CC BY 3.0）':
      'A relaxed jazz trio for slow games. (Bar Bugz — Backbay Lounge, CC BY 3.0)',
    '轻快的 Swing 小曲，节奏更明快。（Jazz at the park，CC0 公有领域）':
      'A light swing number with a brisker beat. (Jazz at the park, CC0 public domain)',
    '不播放背景音乐，球台内的音效照常。': 'No background music; table sounds keep playing.',
    '五排三角形（1/2/3/4/5）': 'Five-row triangle (1/2/3/4/5)',
    '斯诺克规则': 'Snooker',
    '俄式规则': 'Russian pyramid',
    '未来开发': 'Planned',
    '球数': 'Balls',
    '摆法': 'Rack',
    '说明': 'Notes',
    /* 拆段后的连接碎片：settings.js 与 launcher.js 把值包进 <b>/<i>/<span> 后，
       标点与尾段各自成为独立文本节点，逐段查表（整句规则会连变量留下中文）。 */
    '：': ': ',
    '（': ' (',
    '玩法规则：': 'Ruleset: ',
    '）· 在启动器的「游戏设置 → 规则设置」里更改':
      ') · change it in Launcher → Game Settings → Rules',
    '玩法规则已改为 ': 'Ruleset changed to ',
    '已恢复默认设置': 'Settings restored to defaults',
    '该模式': 'This mode',
    '后续阶段开发中': 'is still in development',
    '已清空 ': 'Cleared ',
    ' 条记录': ' records',
    '再点一次确认': 'Tap again to confirm',

    /* ---- 游戏内设置 / 确认 / AI 提示 ---- */
    '这一局的进度会全部清空，并且不会记入挑战历史。':
      'This game\'s progress will be cleared and will not count towards match history.',
    '重开': 'Restart',
    '确定继续？': 'Continue?',
    '电脑瞄准：': 'Computer aims: ',
    '电脑先撞开 ': 'Computer breaks up ',
    '电脑碰一下 ': 'Computer nudges ',
    '（力度 ': ' (power ',

    /* ================= 启动器 · 帮助页（措辞与游戏内那份略有出入，故各存一份） ================= */
    '爵士酒廊': 'Lounge jazz',
    '公园爵士': 'Park jazz',
    '自由模式': 'Free play',
    '本地双人模式': 'Local 2-player',
    '初始化只清空当前标签下的记录：在「计分」里点就只清计分模式，在「所有」里点是全部清空。 记录最多保留 200 条（超出丢最旧的），只存本机。 点任意一条可以看这一局的完整数据（进球率、平均瞄准时间、视角模式等）。':
      '<b>Reset</b> clears only the current tab: under “Score” it clears score-attack records, under “All” it clears everything. At most <b>200</b> records are kept (oldest dropped first) and they stay on this device. Tap any row to see <b>the full numbers for that game</b> (pot rate, average aiming time, camera mode and more).',
    '球体设置只改变「桌面上有哪些球、怎么摆」，不涉及计分、犯规与胜负判定。 进入游戏（或在游戏内重开本局）时按这里的设置摆球。':
      'The ruleset only changes <b>which balls are on the table and how they are racked</b>; it does not touch <b>scoring, fouls or win conditions</b>. The table is racked this way when you enter a game (or restart from inside one).',
    '🤖 人机对战：电脑扮演玩家2，走的是中式黑八同一套规则；轮到它时自己思考 → 转杆 → 出杆，屏幕上写出它打算打哪颗球、多大力度，镜头也跟着它转 · 四档难度就是它手抖的程度（简单约 30% / 中等约 45% / 困难约 70% / 极难约 90% 进球率，用真实物理跑出来的）· 开球永远是你来 · 无论输赢都会记进挑战历史，历史页能看出对电脑的胜负':
      '<b>🤖 vs Computer</b>: the computer plays <b>Player 2</b> under the same Chinese 8-ball rules; on its turn it <b>thinks → swings → shoots</b>, the camera follows, and the screen shows which ball it is going for and how hard · the four levels are just how much its <b>hand shakes</b> (about 30% / 45% / 70% / 90% pot rate, measured with the real physics) · you always break · <b>win or lose, it goes into match history</b>, where you can see your record against it',
    '追踪模式下相机自动跟随白球，双指只保留缩放 —— 平移会被跟球逻辑立刻拉回，看着像“拖了又弹回去”':
      'In <b>tracking</b> the camera follows the cue ball, so pinching only zooms — panning gets pulled straight back, which feels like it <em>snaps home</em>',
    '落袋不再“看球号”：扇形扩散的角度分配重新调过，末排内圈球不再被固定甩进同两个角袋 —— 开球落袋是随机事件，实测约一半的开球一颗不进':
      '<b>Pots no longer depend on the ball number</b>: the fan angles were redistributed so the inner back-row balls are not thrown into the same two corner pockets every time — break pots are random, and about half of all breaks pot nothing',
    '实时合成：出杆、球撞球、撞库、落袋都是按力度即时算出来的，撞得越重越响越脆':
      '<b>Synthesised live</b>: cue, ball contact, cushion and pocket are all computed from the impact — the harder the hit, the louder and sharper',
    '3D 音效：自由 / 追踪模式按"相机 → 事件点"做左右声道与距离衰减；顶视模式固定音量':
      '<b>3D audio</b>: in free / tracking mode panning and distance falloff are derived from “camera → event”; <b>top-down uses a fixed volume</b>',
    '连击播报：2 非常好 · 3 太棒了 · 4 四连无双 · 5 五连绝世 · 6 连及以上超越神的球技（跨杆累计，空杆或白球进袋清零）':
      '<b>Streak calls</b>: 2 · 3 · 4 · 5 · 6 or more in a row each get their own line (they carry across shots; a dry shot or a scratch resets them)',
    '一杆多响：同一杆进 2 / 3 / 4 颗及以上另有专用音效（双响炮 · 三响炮 · 满堂彩）':
      '<b>Multi-pot calls</b>: 2 / 3 / 4 or more in a single shot each get their own sound',

    /* 关于页的「标签 + 值」行：textContent 是 span+b 拼起来的，值里把两个标签都带上 */
    '系列幻梦系列（HUANMENG）': '<span>Series</span><b>Huanmeng series</b>',
    '制作人幻梦-拾光回廊工作室': '<span>Studio</span><b>Huanmeng · Shiguang Corridor Studio</b>',
    '开发工具WorkBuddy': '<span>Built with</span><b>WorkBuddy</b>',
    '渲染Three.js': '<span>Rendering</span><b>Three.js</b>',
    '物理Rapier3D（9 尺台真实规格）': '<span>Physics</span><b>Rapier3D (real 9-ft table specs)</b>',
    '构建Vite + Electron': '<span>Build</span><b>Vite + Electron</b>',
    '平台Windows 桌面端 / 网页端（手机浏览器可用）': '<span>Platforms</span><b>Windows desktop / web (works in phone browsers)</b>',
    '音效Web Audio 实时合成 + 素材': '<span>Audio</span><b>Web Audio synthesis + samples</b>',

    /* ================= 剩余零散文案 ================= */
    '开局即定组': 'Groups from the start',
    '白球落袋 → 换人，接手的一方可以在台面任意位置摆白球（手中球）。':
      'Scratch → turn passes and the incoming player may place the cue ball anywhere (ball in hand).',
    '白球落袋 → 换人，白球放回开球点，接手的一方从开球点打。':
      'Scratch → turn passes; the cue ball goes back to the head spot and play continues from there.',
    '整局重新开球，球全部摆回、分组清零，由原来开球的人重新开球。':
      'The whole game re-racks: balls back, groups cleared, same player breaks again.',
    '这次进黑八不算数，黑八摆回初始位置，换对手接着打，本局继续。':
      'The pot does not count: the 8-ball goes back to its spot, the opponent shoots, the game continues.',
    '保持宽松：空杆只换人，对方从白球现在的位置接着打。':
      'Keep it loose: a dry shot only passes the turn and the opponent plays from where the cue ball lies.',
    '还没有人机对局记录 —— 去「常规模式 → 人机对战」打一局吧':
      'No games against the computer yet — play one from Standard play → vs Computer',
    '还没有本地双人记录 —— 去「常规模式」开一局吧':
      'No two-player games yet — start one from Standard play',
    '还没有记录 —— 去「常规模式」打一局吧': 'No records yet — play a game from Standard play',
    '网页版无法自动关闭窗口，请直接关闭浏览器标签页。':
      'The web build cannot close the window itself — please close the browser tab.',
    '联系方式二维码': 'Contact QR code',
    '[table] 使用 GLB 桌面模型': '[table] using the GLB table model',
  };

  root.HMZQ_EN = EN;

  /* ---------------- 带变量的文案 ----------------
     规则按顺序试，第一条命中就用。`^…$` 锚定整串，避免误伤更长的句子。
     ⚠️ 这里的 key 是**运行时归一化后的整串**，模板字符串拼出来的最终文本才算数。 */
  root.HMZQ_EN_RULES = [
    /* --- 玩家 / 分组 --- */
    [/^玩家(\d) 胜$/, 'Player $1 wins'],
    [/^玩家(\d)开球$/, 'Player $1 · Break'],
    [/^玩家(\d)已进袋$/, 'Player $1 potted'],
    [/^小号（1~7）$/, 'Solids (1-7)'],
    [/^大号（9~15）$/, 'Stripes (9-15)'],
    [/^未分组（—）$/, 'Unassigned'],
    [/^剩 (\d+)$/, '$1 left'],
    [/^剩(\d+:\d+)$/, '$1 left'],
    [/^余(\d+)次$/, '$1 left'],
    [/^(\d+) 次$/, '$1 left'],
    [/^(\d+) 颗目标球（另加白球）$/, '$1 object balls (plus the cue ball)'],
    [/^余(\d+) 号球$/, 'ball $1'],

    /* --- 双人对局播报（duo.js 的 lastNote，显示在顶部横幅） --- */
    [/^玩家(\d)打进黑八，获胜$/, 'Player $1 pots the 8-ball and wins'],
    [/^电脑打进黑八，获胜$/, 'Computer pots the 8-ball and wins'],
    [/^玩家(\d)白球落袋，换玩家(\d)（可自由摆球）$/, 'Player $1 scratched — Player $2 has ball in hand'],
    [/^玩家(\d)白球落袋，换玩家(\d)（白球回开球点）$/, 'Player $1 scratched — Player $2 plays from the head spot'],
    [/^电脑白球落袋，换玩家(\d)（可自由摆球）$/, 'Computer scratched — Player $1 has ball in hand'],
    [/^电脑白球落袋，换玩家(\d)（白球回开球点）$/, 'Computer scratched — Player $1 plays from the head spot'],
    [/^玩家(\d)先碰到了不该碰的球，换玩家(\d)（自由球）$/, 'Player $1 hit the wrong ball first — Player $2 has ball in hand'],
    [/^玩家(\d)空杆（没碰到任何球），换玩家(\d)（自由球）$/, 'Player $1 hit nothing — Player $2 has ball in hand'],
    [/^玩家(\d)击球后没进球，换玩家(\d)（自由球）$/, 'Player $1 potted nothing — Player $2 has ball in hand'],
    [/^电脑先碰到了不该碰的球，换玩家(\d)（自由球）$/, 'Computer hit the wrong ball first — Player $1 has ball in hand'],
    [/^电脑空杆（没碰到任何球），换玩家(\d)（自由球）$/, 'Computer hit nothing — Player $1 has ball in hand'],
    [/^电脑击球后没进球，换玩家(\d)（自由球）$/, 'Computer potted nothing — Player $1 has ball in hand'],
    [/^玩家(\d)先碰到了不该碰的球$/, 'Player $1 hit the wrong ball first'],
    [/^电脑先碰到了不该碰的球$/, 'Computer hit the wrong ball first'],
    [/^玩家(\d)空杆（没碰到任何球）$/, 'Player $1 hit nothing'],
    [/^电脑空杆（没碰到任何球）$/, 'Computer hit nothing'],
    [/^玩家(\d)击球后没进球$/, 'Player $1 potted nothing'],
    [/^电脑击球后没进球$/, 'Computer potted nothing'],
    [/^玩家(\d)打小号（1~7）$/, 'Player $1 is on solids (1-7)'],
    [/^玩家(\d)打大号（9~15）$/, 'Player $1 is on stripes (9-15)'],
    [/^电脑打小号（1~7）$/, 'Computer is on solids (1-7)'],
    [/^电脑打大号（9~15）$/, 'Computer is on stripes (9-15)'],
    [/^玩家(\d)继续击球$/, 'Player $1 keeps shooting'],
    [/^电脑继续击球$/, 'Computer keeps shooting'],
    [/^玩家(\d)只进了对方的球，换人$/, 'Player $1 potted only the opponent\'s ball — turn passes'],
    [/^电脑只进了对方的球，换人$/, 'Computer potted only your ball — turn passes'],
    [/^玩家(\d)空杆，换人$/, 'Player $1 missed — turn passes'],
    [/^电脑空杆，换人$/, 'Computer missed — turn passes'],
    [/^玩家(\d)打进黑八，本局重来$/, 'Player $1 potted the 8-ball — re-rack'],
    [/^电脑打进黑八，本局重来$/, 'Computer potted the 8-ball — re-rack'],
    [/^玩家(\d)打进黑八，判负$/, 'Player $1 potted the 8-ball — game lost'],
    [/^电脑打进黑八，判负$/, 'Computer potted the 8-ball — game lost'],
    [/^玩家(\d)打进黑八：黑八归位，换玩家(\d)$/, 'Player $1 potted the 8-ball — respotted, Player $2 to shoot'],
    [/^电脑打进黑八：黑八归位，换玩家(\d)$/, 'Computer potted the 8-ball — respotted, Player $1 to shoot'],
    [/^玩家(\d)提前打进黑八，判负$/, 'Player $1 potted the 8-ball early — game lost'],
    [/^电脑提前打进黑八，判负$/, 'Computer potted the 8-ball early — game lost'],
    [/^玩家(\d)一颗未进就打进黑八，判负$/, 'Player $1 potted the 8-ball with nothing down — game lost'],
    [/^电脑一颗未进就打进黑八，判负$/, 'Computer potted the 8-ball with nothing down — game lost'],
    [/^玩家(\d)提前打进黑八：罚 (\d+) 号与黑八回位，换人$/, 'Player $1 potted the 8-ball early — ball $2 and the 8 respotted, turn passes'],
    [/^电脑提前打进黑八：罚 (\d+) 号与黑八回位，换人$/, 'Computer potted the 8-ball early — ball $1 and the 8 respotted, turn passes'],

    /* --- 结算 / 统计 --- */
    [/^(\d+) 获 胜$/, 'PLAYER $1 WINS'],
    [/^您 获 胜$/, 'YOU WIN'],
    [/^电脑 获 胜$/, 'COMPUTER WINS'],
    [/^无人 获 胜$/, 'NO WINNER'],
    [/^(\d+) 分$/, '$1 pts'],
    [/^(\d+)分$/, '$1 pts'],
    [/^(\d+) \/ (\d+)$/, '$1 / $2'],
    [/^(\d+) \/ (\d+) 颗$/, '$1 / $2'],
    [/^(\d+) 杆$/, '$1 shots'],
    [/^（(\d+) 杆）$/, '($1 shots)'],
    [/^([\d.]+) 秒$/, '$1 s'],
    [/^(\d+) 连$/, '$1 in a row'],

    /* --- 游戏内动态状态 --- */
    [/^(\d+)% · 蓄力中$/, '$1% · charging'],
    [/^当前：阴影 (.+) · 渲染 (.+) · 贴图 (.+) · 各向异性 (.+)$/,
      'Now: shadow $1 · render $2 · texture $3 · aniso $4'],
    [/^电脑瞄准：(\d+) 号 → (.+)（力度 (\d+)%）$/, 'Computer aims: ball $1 → $2 (power $3%)'],
    [/^电脑先撞开 (\d+) 号$/, 'Computer breaks up ball $1'],
    [/^电脑碰一下 (\d+) 号$/, 'Computer nudges ball $1'],
    [/^(\d+) 号 → (.+)$/, 'ball $1 → $2'],

    /* --- 渲染层兜底：模板字符串的零散片段（只在极端情况下单独出现） --- */
    [/· 蓄力中$/, '· charging'],
    [/^当前：阴影 /, 'Now: shadow '],
    [/ · 渲染 /, ' · render '],
    [/ · 贴图 /, ' · texture '],
    [/ · 各向异性 /, ' · aniso '],
    [/^贴图 /, 'Texture '],

    /* --- 版本号 / 宿主标识（启动器拼出来的） --- */
    [/^自由练习版 v(.+)$/, 'Free-play build v$1'],
    [/ · 桌面版$/, ' · desktop'],
    [/ · 网页版$/, ' · web'],

    /* --- 启动器的提示条（字符串拼接拼出来的） --- */
    [/^(.+)：后续阶段开发中$/, '$1 — in development'],
    [/^玩法规则已改为 (.+)$/, 'Ruleset changed to $1'],
    [/^(.+)已改为「(.+?)」$/, '$1 set to “$2”'],
    [/^已清空 (\d+) 条记录$/, 'Cleared $1 records'],
    [/^已恢复默认设置$/, 'Settings restored to defaults'],
    [/^没有次数与时限/, 'No shot or time limit'],
  ];
}(typeof window !== 'undefined' ? window : globalThis));
