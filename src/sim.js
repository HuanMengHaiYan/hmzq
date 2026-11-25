import { BALL_R, PHYS, BREAK_SHOCK, SHOT } from './constants.js';

/**
 * 库边加塞（english）：撞库的那一瞬间，球的侧旋把出射方向"带偏"。
 * ------------------------------------------------------------------
 * 为什么必须手工补：Rapier 的接触摩擦在这件事上给的份额太小 —— 实测 ω.y = 24 rad/s
 * 正撞库边，反弹方向只偏 **1.4°**（真实台球这个量级的塞能偏十几度）。
 * 原因：接触点滑移速度里，摩擦冲量按「平动 : 自转 = 1 : 2.5」分摊（球 I=2/5mR²），
 * 大部分塞在接触瞬间被自己"吃掉"成角冲量，真正变成横向平移的只剩两成。
 *
 * 做法上特意**不去加横向速度、而是旋转出射速度**：
 * 加横向速度等于让球"横着滑"，而台布摩擦（μ=0.24）0.2 秒就把它抹平了
 * （实测加了 0.52 m/s 的横移，200ms 后只剩 0.1 m/s，看着只偏 3°）；
 * 旋转方向则不改速度大小、不制造侧滑，球会老老实实按新方向滚出去。
 *
 * ⚠️ 只转速度是不够的（实测踩过两次）：
 *    ① 不碰自转：球的自转轴还指着原方向，等于"球往新方向滑过去"，台布摩擦 4cm 内
 *       就把速度拽回自转轴 —— 出射偏了 14.4°，整段轨迹最大横移只有 3.6cm；
 *    ② 把自转一起转 θ：撞库后速度反了向、自转没反向（真实台球的"撞库后变回旋"），
 *       球在打滑中被摩擦强行拧回原方向，横移反而只剩 1.4cm。
 *    所以这里**按新出射方向重建滚动自转**：保持原来的"滚动倍数"（游戏中 0.6），
 *    ω_h = k·(|v'|/R)·(dz', 0, −dx')。速度大小不变、|ω| 只会更小（反弹后速度已衰减），
 *    既不凭空造能量，也不会打滑，球按新方向稳稳滚出去 —— 玩家才看得出"加了塞"。
 *    ω.y（塞本身）原样保留，继续受 spinDecel 衰减。
 *
 * 方向依据（经典台球物理）：球向右带塞（ω.y > 0）正撞库边时，接触点表面速度是
 * **往左**滑的（v = ω×r，r 指向库边），库边给的摩擦与滑移反向 → 把球往**右**推 →
 * 出射方向偏向塞的那一侧。⚠️ 实测踩过的坑：这里写成 `-englishDeg·ω.y` 会把方向
 * 弄反（右塞往左弹），2026-11-25 用户试玩才暴露 —— 因为"偏是偏了"，方向错看不出来。
 * 判定方法：撞击后速度已反向（≈ −V, 0），旋转公式 z' = −x·sinθ = +V·sinθ，
 * 想要 z' > 0（往右）必须 θ > 0，所以系数必须是 **+englishDeg·ω.y**。
 *
 * ⚠️ 中心击球的 ω.y = 0 → 这个函数整体不参与，老手感（长台 / 开球标定）完全不动。
 */
export function applyCushionEnglish(ball) {
  const cfg = SHOT.spin;
  const av = ball.body.angvel();
  if (Math.abs(av.y) < cfg.englishMinSpin) return false;
  const lv = ball.body.linvel();
  const spd = Math.hypot(lv.x, lv.z);
  if (spd < 0.05) return false;                         // 还没真正弹出去，别转
  const deg = clamp(cfg.englishDeg * av.y, -cfg.maxEnglishDeg, cfg.maxEnglishDeg);
  const th = (deg * Math.PI) / 180;
  const cs = Math.cos(th), sn = Math.sin(th);
  // 绕 y 轴转 θ：(x, z) → (x·cosθ + z·sinθ, −x·sinθ + z·cosθ)。速度大小不变。
  const vx = lv.x * cs + lv.z * sn;
  const vz = -lv.x * sn + lv.z * cs;
  ball.body.setLinvel({ x: vx, y: lv.y, z: vz }, true);

  // 滚动倍数 k = |ω_h|·R / |v|（游戏中恒 0.6；钳在 0~2 是防脏数据把球抽成陀螺）
  const k = clamp((Math.hypot(av.x, av.z) * BALL_R) / spd, 0, 2);
  ball.body.setAngvel({
    x: (vz / BALL_R) * k,
    y: av.y,
    z: (-vx / BALL_R) * k,
  }, true);
  return true;
}

/**
 * 甩球（spin-induced throw）：带塞的白球撞上目标球，接触摩擦把目标球"甩"偏一点。
 * ------------------------------------------------------------------
 * 这是侧旋在**打目标球**时的主要效果（撞库只是次要效果）：
 * 白球接触面的表面速度因侧旋产生横向分量（v = ω×r），摩擦把它传给目标球 ——
 * **右塞（ω.y > 0）把目标球往左甩、白球自己反而被往右推**（一对反作用力）。
 * 没有这一下，直打目标球时侧旋就是零效果，玩家完全感觉不出左右塞（2026-11-25 用户实测）。
 *
 * 为什么手工补：和库边加塞同一个原因 —— Rapier 的接触摩擦只把塞的横向分量传 1.4°，
 * 真实台球是 2~4°（塞越满、球越慢甩得越多）。做法：把目标球撞后的速度绕 y 轴转 θ，
 * θ = throwDeg·ω.y（钳在 ±maxThrowDeg）。旋转而不是加横向速度：
 * 目标球刚被撞飞时还在滑动段，加横向速度会被台布摩擦按比例磨掉一部分、方向看着"飘"，
 * 旋转则一步到位、不改速率。
 *
 * ⚠️ 符号推导（别再翻车）：目标球速度 ≈ V·n（n = 白球→目标球）。旋转 z' = −V·sinθ，
 *    右塞要往左甩（z' < 0）→ sinθ > 0 → θ = **+throwDeg·ω.y**。
 *    （注意与库边加塞同号是巧合的正确：库边那边速度已反向，几何方向恰好相反。）
 */
export function applyThrow(spinBall, objectBall) {
  const cfg = SHOT.spin;
  // 老测试的假球不一定实现了 angvel / setLinvel：缺了就当"没塞"，别炸
  if (!spinBall.body.angvel || !objectBall.body.setLinvel) return false;
  const wy = spinBall.body.angvel().y;
  if (Math.abs(wy) < cfg.englishMinSpin) return false;
  const lv = objectBall.body.linvel();
  const spd = Math.hypot(lv.x, lv.z);
  if (spd < 1e-4) return false;                       // 还没被撞飞（事件可能早于求解），别转
  const deg = clamp(cfg.throwDeg * wy, -cfg.maxThrowDeg, cfg.maxThrowDeg);
  const th = (deg * Math.PI) / 180;
  const cs = Math.cos(th), sn = Math.sin(th);
  objectBall.body.setLinvel({
    x: lv.x * cs + lv.z * sn,
    y: lv.y,
    z: -lv.x * sn + lv.z * cs,
  }, true);
  return true;
}

function clamp(v, lo, hi) { return v < lo ? lo : v > hi ? hi : v; }
const clamp1 = (v) => clamp(Number(v) || 0, -1, 1);

/**
 * 击球点 → 初始角速度（纯函数，不碰 three / DOM，headless 测试直接验）。
 * ------------------------------------------------------------------
 * 玩家在杆法盘上拖出的偏移量 sx / sy（各自 −1~1）换算成"打在球面哪儿"，
 * 再按 o×J/I 算出这一杆给白球的角速度：
 *
 *   滚动分量（ω.x / ω.z）：中心击球沿用 0.7.0 的 0.6 倍前旋（让球快速进入滚动段）；
 *                          高杆 +rollGain、低杆 −rollGain —— 低到一定程度变成负值，
 *                          就是"回旋球"（撞完目标球往回缩）。
 *   塞（ω.y）            ：ω.y = sideGain · sx · (v/R)，撞库反弹角与撞球甩球全靠它。
 *
 * ⚠️ 只碰这三项，不要顺手去动 PHYS 的 spinDecel —— 那是 ω.y 的衰减率，
 *    改它等于改"球停了还要等多久才能出下一杆"（见 constants.js 的 maxSideSpin 注释）。
 * ⚠️ 放在 sim.js 而不是 shot.js：shot.js 会拉进 three（aimer/balls），
 *    纯数学留在这里，headless 才不用为了验几个数去加载渲染层。
 *
 * @param dir  出杆方向单位向量 {x, z}（水平面）
 * @param v    出杆后白球速度（m/s）= 冲量 / 质量
 * @param spin {x, y} 归一化击球点（可省略 → 中心击球）
 * @returns Rapier 的角速度对象 {x, y, z}
 */
export function spinAngular(dir, v, spin) {
  const cfg = SHOT.spin;
  const sx = clamp1(spin?.x ?? 0);
  const sy = clamp1(spin?.y ?? 0);
  // 纯滚动角速度（rad/s）：滚动自转 = v/R，方向见 shot.js 里那条符号说明
  const rollOmega = v / BALL_R;
  const roll = cfg.baseRoll + (sy >= 0 ? cfg.rollGainUp : cfg.rollGainDown) * sy;
  const side = clamp(cfg.sideGain * sx * rollOmega, -cfg.maxSideSpin, cfg.maxSideSpin);
  return {
    x: dir.z * rollOmega * roll,
    y: side,
    z: -dir.x * rollOmega * roll,
  };
}

/**
 * 碰撞传导随机化：让"球撞球 → 再把力度传给下一颗球"的过程带上随机浮动。
 *
 * 为什么：真实台球不是完美弹性体 —— 球不完全圆、台布不完全平、两颗球也不可能理想正碰，
 * 所以"这一下撞得多重"本来就该有波动。
 *
 * 做法（每次"新发生的球球碰撞"触发一次）：
 *   1. 用撞前速度算出接近速度 closing，得到引擎本应传导的冲量 J = (1+e)/2 · m · closing；
 *   2. 取随机系数 k ∈ [1−variance, 1+variance]，补一个 (k−1)·J 的冲量；
 *   3. 冲量对两颗球等大反向 → 总动量严格守恒，只是"这一下撞得多重"变了。
 *
 * ⚠️ 实测（30~40 次满力开球样本）：把 variance 从 0 调到 0.5，
 *    镜像偏差 8→9cm、半边空球比例 100%→100%、两次开球差异度 21.0→19.1cm ——
 *    也就是"开球是否对称、球会不会铺满全场"这两件事，靠传导随机化是改不动的。
 *    根因是开球结果的随机性早已被"球堆内部几十个接触的混沌放大"占满，再加噪声统计上看不出来。
 *    真正解决这两个问题的是 applyBreakShock 里的扇形扩散（fanAngle）。
 *    本函数保留为物理上更真实的建模：它让单次碰撞的细节更贴近真实台球，
 *    但不要指望它来改变开球宏观结果。
 *
 * @param events   Rapier EventQueue（autoDrain = true 即可，每步 step 后立刻 drain）
 * @param byHandle collider.handle → ball（只有球球碰撞参与，撞库边/盖板不算）
 * @param prevVel  Map<ball, {x,z}> 本步开始前的速度（即撞前速度）
 * @param opts     { variance, minSpeed, restitution, cushions, onImpact, onCueHit }
 *                 cushions  Set<handle> 库边碰撞体句柄（可选）
 *                 onImpact  ({kind:'ball'|'cushion', closing|speed, x, z}) => void，音效系统的钩子
 *                 onCueHit  (number) => void，白球碰到一颗目标球时回调（犯规判定用，
 *                           传的是**被碰到的那颗**球号；一杆只报第一颗）
 * @returns 本次处理的球球碰撞次数
 */
export function randomizeBallImpacts(events, byHandle, prevVel, opts = {}) {
  const variance = opts.variance ?? 0;
  const minSpeed = opts.minSpeed ?? 0.1;
  const e = opts.restitution ?? PHYS.ball.restitution;
  const cushions = opts.cushions;
  const onImpact = opts.onImpact;
  const onCueHit = opts.onCueHit;
  let count = 0;

  events.drainCollisionEvents((h1, h2, started) => {
    if (!started) return;
    const b1 = byHandle.get(h1);
    const b2 = byHandle.get(h2);

    // 球撞静态体：只有库边值得出声（台布、袋筒、落球盘一路蹭过去会很吵）
    if (!b1 || !b2) {
      const ball = b1 || b2;
      if (!ball || ball.potted || ball.hidden) return;
      const isCushion = cushions ? cushions.has(b1 ? h2 : h1) : false;
      // 库边加塞：与"要不要出声"无关，只要撞的是库边、球上带着塞就生效
      if (isCushion) applyCushionEnglish(ball);
      if (!onImpact || !isCushion) return;
      const v = prevVel.get(ball) || { x: 0, z: 0 };
      const speed = Math.hypot(v.x, v.z);
      if (speed < minSpeed) return;
      const t = ball.body.translation();
      onImpact({ kind: 'cushion', speed, x: t.x, z: t.z });
      return;
    }
    if (b1 === b2) return;
    if (b1.potted || b2.potted || b1.hidden || b2.hidden) return;

    const t1 = b1.body.translation();
    const t2 = b2.body.translation();
    let nx = t2.x - t1.x, nz = t2.z - t1.z;
    const d = Math.hypot(nx, nz);
    if (d < 1e-6) return;
    nx /= d; nz /= d;

    const v1 = prevVel.get(b1) || { x: 0, z: 0 };
    const v2 = prevVel.get(b2) || { x: 0, z: 0 };
    const closing = (v1.x - v2.x) * nx + (v1.z - v2.z) * nz;   // >0 表示正在靠近
    if (closing < minSpeed) return;                            // 轻微接触不加噪（否则求解器会抖）
    count++;
    // 白球第一次碰到球：登记给犯规判定（"打错球组 / 空杆"，见 duo.js 的 markCueContact）
    if (onCueHit) {
      if (b1.isCue) onCueHit(b2.number);
      else if (b2.isCue) onCueHit(b1.number);
    }
    // 音效：取两球中点作为发声位置（左右声道与距离衰减都按这一点算）
    if (onImpact) {
      onImpact({ kind: 'ball', closing, x: (t1.x + t2.x) / 2, z: (t1.z + t2.z) / 2 });
    }
    // 甩球：塞大的一方当"带塞的白球"，另一颗当被甩的目标球。
    // 与随机传导（variance）互相独立 —— variance=0 的测试 / 标定场景也必须有甩球。
    // （老测试里的假球不一定实现 angvel，探一下再调，别让它们炸。）
    const wy1 = b1.body.angvel ? b1.body.angvel().y : 0;
    const wy2 = b2.body.angvel ? b2.body.angvel().y : 0;
    if (Math.abs(wy1) >= Math.abs(wy2)) applyThrow(b1, b2);
    else applyThrow(b2, b1);
    if (variance <= 0) return;

    const m = b1.body.mass ? b1.body.mass() : 0.17;
    const J = ((1 + e) / 2) * m * closing;                     // 引擎本应传导的冲量
    const dJ = (Math.random() * 2 - 1) * variance * J;         // 随机浮动的那一份

    b2.body.applyImpulse({ x: nx * dJ, y: 0, z: nz * dJ }, true);
    b1.body.applyImpulse({ x: -nx * dJ, y: 0, z: -nz * dJ }, true);
  });

  return count;
}

/**
 * 开球冲击波：把开球动量按"真实开球"的方式重新分配到球堆上。
 *
 * 为什么需要：
 *   物理引擎在一个步进里同时解算球堆里几十个接触，实测它把 15 颗贴身球当成
 *   一个刚性块整体推走 —— 动能传递只有 ~50%，而且 15 颗球速度几乎一样（≈0.5m/s）、
 *   白球还反弹回来。结果就是满台球全部堆在脚区库边，既不像开球、也是连进多颗的根源。
 *   真实台球是硬质弹性球，冲击波几乎无损地穿过球堆：能量集中在末排和边缘球上，
 *   它们高速飞出、撞库反弹后再铺向全场，而前排球几乎不动、白球基本停在球堆附近。
 *
 * 本函数只做"重新分配"，不凭空造动量：
 *   1. 读出碰撞瞬间的实际总动量 P；
 *   2. 按"纵深/边缘"权重把 P 分给各球（白球只留一小份）；
 *   3. 只施加「目标动量 − 当前动量」的修正冲量，因此总动量严格守恒，
 *      横向分量左右对称（净横向动量为 0）。
 *
 * @param bodies  16 个刚体，bodies[0] 为白球，其余按顺序对应 anchors
 * @param dir     开球方向单位向量 {x, z}
 * @param anchors 15 颗目标球的开球摆位 [{x, z}]
 * @returns 是否真的施加了冲击
 */
export function applyBreakShock(bodies, dir, anchors) {
  if (!BREAK_SHOCK.enabled || !anchors || anchors.length === 0) return false;

  const cfg = BREAK_SHOCK;
  const px = -dir.z, pz = dir.x;          // 垂直于开球方向的单位向量
  const baseAng = Math.atan2(dir.z, dir.x);

  // 1) 把摆位投影到「纵深 s」与「横向 t」两个轴上
  let sMin = Infinity, sMax = -Infinity, tMax = 1e-6;
  const proj = anchors.map((a) => {
    const s = a.x * dir.x + a.z * dir.z;
    const t = a.x * px + a.z * pz;
    if (s < sMin) sMin = s;
    if (s > sMax) sMax = s;
    if (Math.abs(t) > tMax) tMax = Math.abs(t);
    return { s, t };
  });
  const sSpan = Math.max(1e-6, sMax - sMin);

  // 2) 权重：末排 + 边缘的球拿大头（rearPower 越大越集中）
  const w = proj.map((p) => {
    const sn = (p.s - sMin) / sSpan;                            // 0=顶点 1=末排
    const tn = Math.min(1, Math.abs(p.t) / tMax);               // 0=中轴 1=最外侧
    return cfg.floor + Math.pow(sn, cfg.rearPower) * (1 - cfg.sideWeight + cfg.sideWeight * tn);
  });
  const wSum = w.reduce((a, b) => a + b, 0) || 1;

  // 3) 扇形扩散：真实球堆不是"一块板"把球全往前推，而是一个楔形——
  //    顶点球径直向前，越靠后、越靠边的球被斜着甩出去（末排角球甚至略带向后）。
  //    这一步是把"15 颗球一起撞脚库、回弹互相抵消"变成"散开覆盖全场"的关键：
  //    单球探针实测，一颗球以 2m/s 撞脚库回弹后能退到 x=-0.25（头区），
  //    所以只要有球能单独跑到脚库、且身后没有球堆堵着，它就一定能回到头区。
  const fanRad = (cfg.fanAngle * Math.PI) / 180;
  // 出射角抖动（度 → 弧度）：真实的球堆每一颗球的"被撞方向"都略有不同
  // （球不完全圆、台布有绒向、摆球时每颗球的接触点都不同）。
  // ⚠️ 实测（各 120~300 次满力开球）：它救不了"总是那两颗球进" —— 因为角袋的
  //    可进角度很宽，±25° 的抖动照样落袋，反而把更多球推进了"死亡角"区间（见下）。
  const scatterRad = ((cfg.scatter ?? 0) * Math.PI) / 180;
  // 横向压缩 sideBias：把横向偏移往"最外侧"压 —— |tn| ← |tn| + sideBias·(1−|tn|)。
  //
  // 这是"几乎每次都是那两颗球进"的真正解药，依据是轨迹探针（test/trace-break.mjs）：
  //   末排内圈球（6/7 号，横向偏移只有角球的一半）在旧参数下拿到约 59° 出射角，
  //   它们擦过长边库与脚库之间的夹角后，正好顺着库边低速滚进脚区角袋 ——
  //   实测满力开球里 6→右下角袋、7→右上角袋 各约 20%，两条固定线路。
  //   把横向球整体抬出那段角区之后，6/7 号的行为和角球 13/15 一样：
  //   撞长边库 → 弹回中场 → 铺向另一侧；落袋从"固定线路"变成"随机事件"。
  //
  // 实测（满力开球，平移取"好区"中心 -0.16~-0.17，括号内为单颗球最高 / 单袋最高 进袋率）：
  //   sideBias 0    fan118   0.84 颗/次  0进 38%   (23% / 23%)   旧行为
  //   sideBias 0.65 fan 96   0.89       32%       (25% / 36%)
  //   sideBias 0.65 fan 92   0.85       39%       (24% / 39%)
  //   sideBias 0.7  fan 92   1.03       25%       (31% / 53%)  ← 已开始变差
  //   sideBias 0.7  fan 96   0.82       41%       (18% / 28%)
  //   sideBias 0.65 fan100   0.80       41%       (16% / 23%)
  //   sideBias 0.7  fan100   0.71       44%       (20% / 21%)
  //   sideBias 0.68 fan 98   0.60~0.65 50%       (13% / 19%)  ← 采用，三次独立采样一致
  //   sideBias 0.75 fan100   1.56        3%       (59% / 66%)  ← 好区外侧：劣化很陡
  //   sideBias 0.7  fan104   1.63        7%       (51% / 56%)  ← 好区外侧：劣化很陡
  //   sideBias 0.7  fan108   1.76       12%       (55% / 67%)  ← 好区外侧：劣化很陡
  // 注意这块参数面很"陡"：出好区之后单颗球进袋率会从 ~13% 直接跳到 50% 以上。
  // 改动 fanAngle / sideBias / RACK.shiftX 中任何一项后，都要用 test/sweep-break.mjs 重新扫描。
  const sideBias = cfg.sideBias ?? 0;
  const ang = proj.map((p) => {
    const sn = (p.s - sMin) / sSpan;
    const tn = p.t / tMax;
    const at = Math.abs(tn);
    const side = Math.sign(tn) * (at + sideBias * (1 - at));
    const jitter = scatterRad > 0 ? (Math.random() * 2 - 1) * scatterRad : 0;
    return baseAng + fanRad * side * (0.35 + 0.65 * sn) + jitter;
  });
  // 朝前的动量只由"方向"和"权重"决定，基准速度由目标前向动量反解 → 冲量大小可控
  let fwdUnit = 0;
  for (let k = 0; k < proj.length; k++) fwdUnit += (w[k] / wSum) * Math.cos(ang[k] - baseAng);
  if (fwdUnit < 0.08) fwdUnit = 0.08;   // 扇形过宽时兜底，避免除零/反向

  // 4) 当前沿开球方向的总动量
  let P = 0;
  for (const b of bodies) {
    const lv = b.linvel();
    const m = b.mass ? b.mass() : PHYS.ball.mass || 0.17;
    P += m * (lv.x * dir.x + lv.z * dir.z);
  }
  if (P <= 1e-5) return false;

  // 5) 逐个球施加修正冲量
  const mBall = bodies[1] && bodies[1].mass ? bodies[1].mass() : 0.17;
  const fwdTarget = P * (1 - cfg.cueShare) * cfg.boost;              // 球堆应分到的朝前动量
  let v0 = fwdTarget / (mBall * fwdUnit);                            // 权重=1 的球的目标速度
  // 安全钳制：扇形角调得过大时 fwdUnit 会趋近 0，v0 会失控（实测 130° 时球速飙到 17m/s）。
  // 这里保证"拿到最大权重的球"不超过 cfg.maxSpeed，其余球按比例一起压下来。
  const wMaxNorm = Math.max(...w.map((x) => x / wSum));
  if (wMaxNorm > 1e-6) v0 = Math.min(v0, cfg.maxSpeed / wMaxNorm);

  // 6) 先算出每颗球的目标动量。出射角抖动会让左、右两侧不再严格镜像，
  //    球堆会带上一个净横向动量（凭空多出来的横向推力）。真实开球不会这样 ——
  //    白球只沿开球方向用力，系统总横向动量必须为 0。这里把这个残差按均摊扣回去。
  const targets = bodies.map((body, i) => {
    const m = body.mass ? body.mass() : 0.17;
    if (i === 0) return { F: P * cfg.cueShare, T: 0 };   // 白球只留一小份，基本停在球堆附近
    const k = i - 1;
    const a = ang[k];
    const speed = v0 * (w[k] / wSum);
    const dvx = Math.cos(a) * speed;
    const dvz = Math.sin(a) * speed;
    return { F: m * (dvx * dir.x + dvz * dir.z), T: m * (dvx * px + dvz * pz) };
  });
  let latSum = 0;
  for (let i = 1; i < targets.length; i++) latSum += targets[i].T;
  const nRack = Math.max(1, targets.length - 1);
  if (Math.abs(latSum) > 1e-9) {
    for (let i = 1; i < targets.length; i++) targets[i].T -= latSum / nRack;
  }

  // 7) 逐个球施加「目标动量 − 当前动量」的修正冲量
  for (let i = 0; i < bodies.length; i++) {
    const body = bodies[i];
    const m = body.mass ? body.mass() : 0.17;
    const lv = body.linvel();
    const curF = m * (lv.x * dir.x + lv.z * dir.z);
    const curT = m * (lv.x * px + lv.z * pz);
    const dF = targets[i].F - curF;
    const dT = targets[i].T - curT;
    body.applyImpulse({ x: dF * dir.x + dT * px, y: 0, z: dF * dir.z + dT * pz }, true);
  }
  return true;
}

/**
 * 滚动摩擦（0.7.0，体检 P1）：每个物理步对台面上的球施加
 * 「恒定减速度 rollDecel + 速度比例阻尼 rollDamp」的混合减速。
 *
 * 为什么不用 Rapier 自带的 linearDamping：
 *   线性阻尼是指数衰减（v 每秒 ×e^-k），换算到"每米掉多少速度"是常数 ——
 *   高速球和低速球一样重，长台要打得比真实重得多。真实台布近似匀减速：
 *   高速球每米只掉一点点、低速球利落地停住。本函数在离散步长上施加
 *   dv = (rollDecel + rollDamp·v)·dt，与解析解的误差在 1/120s 步长下可忽略
 *   （auto-aim.js 的力度反解用的就是这套模型的解析形式）。
 *
 * ⚠️ 与游戏主循环、test/ 各套件的物理循环保持一致：world.step() 之后必须跟着
 *    clampBallSpeeds() 与 applyRollFriction() 各一次，少一边测试就失真。
 *
 * 另外它还负责「支点摩擦」（2026-11-04）：只衰减**绕竖直轴**的角速度 ω.y。
 * 竖直轴自转的接触点瞬时速度为 0，台布摩擦给不出力矩（实测会转 17.5 秒），
 * 必须手工补一个角减速度；水平轴（滚动）自转不动，避免破坏 P1 的长台标定。
 * @returns 本步实际减速的球数
 */
export function applyRollFriction(bodies) {
  const dt = PHYS.timestep;
  const a = PHYS.ball.rollDecel;
  const k = PHYS.ball.rollDamp;
  const spinA = PHYS.ball.spinDecel;
  let count = 0;
  for (const body of bodies) {
    const t = body.translation?.();
    if (t && t.y < 0) continue;                // 正在落袋下坠的球：水平减速没意义

    // 支点摩擦（0.7.0 / 2026-11-04）：绕竖直轴的自转，接触点瞬时速度为 0，
    // 台布 Coulomb 摩擦给不出力矩，只能靠接触面微滑动与台布变形 —— 用恒定角减速度补。
    // 只碰 ω.y：水平轴（滚动）自转由接触摩擦自行处理，动它会破坏 P1 的长台标定。
    const av = body.angvel();
    if (Math.abs(av.y) > 1e-4) {
      const drop = spinA * dt;
      const ay = Math.abs(av.y) > drop ? av.y - Math.sign(av.y) * drop : 0;
      body.setAngvel({ x: av.x, y: ay, z: av.z }, true);
    }

    const lv = body.linvel();
    const h = Math.hypot(lv.x, lv.z);
    if (h < 1e-4) continue;
    const drop = (a + k * h) * dt;
    const f = h > drop ? (h - drop) / h : 0;
    body.setLinvel({ x: lv.x * f, y: lv.y, z: lv.z * f }, true);
    count++;
  }
  return count;
}

/**
 * 每个物理步后对球速做钳制：
 *  - 总速度上限：密集球堆挤压时，求解器可能"注入能量"导致速度爆炸（实测可达 23 m/s）
 *  - 向上速度上限：抑制不真实的跳球（真实台球几乎贴着台面滚动）
 * 与不可见顶盖配合，构成三重保险，确保球永远不会飞出台面。
 */
export function clampBallSpeeds(bodies) {
  for (const body of bodies) {
    const lv = body.linvel();
    const sp = Math.hypot(lv.x, lv.y, lv.z);
    let vx = lv.x, vy = lv.y, vz = lv.z;
    let changed = false;

    if (sp > PHYS.maxSpeed) {
      const k = PHYS.maxSpeed / sp;
      vx *= k; vy *= k; vz *= k;
      changed = true;
    }
    if (vy > PHYS.maxUpSpeed) {
      vy = PHYS.maxUpSpeed;
      changed = true;
    }
    if (changed) body.setLinvel({ x: vx, y: vy, z: vz }, true);
  }
}
