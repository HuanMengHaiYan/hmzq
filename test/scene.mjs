/**
 * 渲染层无头验证：用最小 DOM 打桩（不需要 WebGL），
 * 真实执行 table.js / balls.js 的场景构建代码，检查：
 *   - 网格数量与命名
 *   - 16 颗球的初始位置与 layout 一致
 *   - 6 个袋口传感器的隐藏材质确实不可见
 *   - 球面贴图正常生成
 *
 * 运行：node test/scene.mjs
 */

// ---------- 最小 Canvas / DOM 打桩 ----------
function fakeCanvas() {
  const ctx = {
    fillStyle: '', font: '', textAlign: '', textBaseline: '',
    fillRect() {}, beginPath() {}, arc() {}, fill() {}, fillText() {},
    getImageData: (x, y, w, h) => ({ data: new Uint8ClampedArray(w * h * 4), width: w, height: h }),
    putImageData() {},
  };
  return { width: 0, height: 0, getContext: () => ctx, style: {} };
}
globalThis.document = {
  createElement: (tag) => (tag === 'canvas' ? fakeCanvas() : { style: {} }),
  createElementNS: () => fakeCanvas(),
};
globalThis.window = { devicePixelRatio: 1, innerWidth: 1280, innerHeight: 800, addEventListener() {} };
globalThis.self = globalThis.window;

const THREE = await import('three');
const RAPIER = (await import('@dimforge/rapier3d-compat')).default;
const { buildTable } = await import('../src/table.js');
const { createBalls, resetBalls, hideBall } = await import('../src/balls.js');
const { allBallSpawns, tableBoxes, pocketSensors } = await import('../src/layout.js');
const { BALL_R, PHYS } = await import('../src/constants.js');

let pass = 0, fail = 0;
const check = (ok, label, detail = '') => {
  if (ok) { pass++; console.log(`  [PASS] ${label} ${detail}`); }
  else { fail++; console.log(`  [FAIL] ${label} ${detail}`); }
};

await RAPIER.init();
const world = new RAPIER.World(PHYS.gravity);
world.timestep = PHYS.timestep;

const scene = new THREE.Scene();

console.log('\n[1] 球桌场景构建');
const table = buildTable(scene, world, RAPIER);
const boxes = tableBoxes();
const visibleBoxes = boxes.filter((b) => b.visible).length;
const physBoxes = boxes.filter((b) => b.phys).length;

// 每个袋口：边缘平台 + 袋筒 + 传感器占位；口沿只在"喉口比开口留得出 1.4mm"时才有
// （0.8.0 中袋喉口 62.5 = 开口半宽，没有口沿的空间 —— 与 table.js 的 rimOut 条件同口径）
import { throatRadiusOf, POCKET_HOLE } from '../src/layout.js';
const rimPockets = pocketSensors().filter((p) => throatRadiusOf(p) < POCKET_HOLE.half - 0.0014).length;
const expectedTableMeshes = visibleBoxes + pocketSensors().length * 3 + rimPockets;
check(table.group.children.length === expectedTableMeshes,
  '台桌网格数正确（可见箱体 + 每袋(平台+袋筒+传感器)+有空间者含口沿）',
  `实际 ${table.group.children.length}，期望 ${expectedTableMeshes}（口沿 ${rimPockets} 个）`);
check(table.sensors.length === 6, '袋口传感器 6 个', `实际 ${table.sensors.length}`);
check(table.lids.length === 6, '袋口盖板 6 个', `实际 ${table.lids.length}`);
check(table.lids.every((l) => l.collider.isEnabled() === false),
  '盖板初始为"未启用"状态（袋口正常敞开，默认不封袋）');
check(world.colliders.len() === physBoxes + 6 + 6,
  '静态碰撞体数量 = 物理箱体 + 6 传感器 + 6 盖板',
  `实际 ${world.colliders.len()}，期望 ${physBoxes + 12}`);

console.log('\n[2] 袋口传感器隐藏性 & sensor 标记');
const allHidden = table.sensors.every((s) => s.ghost.material.visible === false && s.ghost.material.opacity === 0);
check(allHidden, '6 个判定几何体材质不可见（opacity=0, visible=false）');
const allSensor = table.sensors.every((s) => s.collider.isSensor());
check(allSensor, '6 个碰撞体均为 sensor（不产生物理阻挡）');
for (const s of table.sensors) {
  const t = s.collider.translation();
  const g = s.ghost.position;
  const dx = t.x - g.x, dy = t.y - g.y, dz = t.z - g.z;
  // 容差 1e-5m（10µm）：远低于任何渲染/碰撞判断阈值；
  // 大于 Rapier 内部 float32 存储带来的 ~1e-7 相对舍入误差。
  const aligned = Math.abs(dx) < 1e-5 && Math.abs(dy) < 1e-5 && Math.abs(dz) < 1e-5;
  check(aligned, `${s.name} 物理体与可视占位对齐`,
    `t=(${t.x.toFixed(4)}, ${t.y.toFixed(4)}, ${t.z.toFixed(4)}) g=(${g.x.toFixed(4)}, ${g.y.toFixed(4)}, ${g.z.toFixed(4)}) d=(${dx.toExponential(1)}, ${dy.toExponential(1)}, ${dz.toExponential(1)})`);
}

console.log('\n[3] 16 颗球');
const { balls, cue } = createBalls(scene, world, RAPIER);
check(balls.length === 16, '球数量 16', `实际 ${balls.length}`);
check(cue.number === 0 && cue.isCue, '白球标记正确');

const spawns = allBallSpawns();
let posOK = true;
let maxErr = 0;
balls.forEach((b, i) => {
  const t = b.body.translation();
  const e = Math.max(Math.abs(t.x - spawns[i].x), Math.abs(t.z - spawns[i].z), Math.abs(t.y - BALL_R));
  maxErr = Math.max(maxErr, e);
  if (e > 1e-5) posOK = false;
  if (b.mesh.position.distanceTo(new THREE.Vector3(spawns[i].x, BALL_R, spawns[i].z)) > 1e-5) posOK = false;
});
check(posOK, '刚体与网格初始位置均与 layout 一致', `最大偏差 ${maxErr.toExponential(1)}m`);

const texOK = balls.every((b) => b.mesh.material.map && b.mesh.material.map.isTexture);
check(texOK, '16 颗球贴图均已生成');
const massOK = balls.every((b) => Math.abs(b.body.mass() - 0.17) < 1e-6);
check(massOK, '球质量均为 0.17kg', `白球 ${cue.body.mass().toFixed(4)}kg`);
const ccdOK = balls.every((b) => b.body.isCcdEnabled());
check(ccdOK, '16 颗球均已开启 CCD（防高速穿透）');

console.log('\n[4] 复位功能');
cue.body.setTranslation({ x: 0.9, y: BALL_R, z: 0.3 }, true);
balls[5].body.setTranslation({ x: -1.0, y: BALL_R, z: -0.4 }, true);
resetBalls(balls);
let resetOK = true;
balls.forEach((b, i) => {
  const t = b.body.translation();
  if (Math.abs(t.x - spawns[i].x) > 1e-5 || Math.abs(t.z - spawns[i].z) > 1e-5) resetOK = false;
});
check(resetOK, 'resetBalls 能把 16 颗球全部还原');

console.log('\n[5] 落袋即消失');
const victim = balls[7];
hideBall(victim);
check(victim.mesh.visible === false && victim.body.isEnabled() === false,
  `${victim.number} 号球落袋后从场上收掉（网格隐藏 + 刚体停用）`,
  `visible=${victim.mesh.visible} enabled=${victim.body.isEnabled()}`);
check(victim.body.linvel().x === 0 && victim.body.linvel().z === 0,
  '收掉的球速度已归零（不会再影响静止判定）');
resetBalls(balls);
check(victim.mesh.visible === true && victim.body.isEnabled() === true,
  '复位后重新出现在台面',
  `visible=${victim.mesh.visible} enabled=${victim.body.isEnabled()}`);

console.log('\n[6] 袋口几何：方形边缘平台 + 圆形落球喉口');
{
  const { POCKET_HOLE, pocketCollarBoxes, throatRadiusOf } = await import('../src/layout.js');
  // 只把"真正的台布"算进来：收口环虽然 kind=cloth，但它是袋口内部的挡板
  const cloth = boxes.filter((b) => b.kind === 'cloth' && !String(b.id).startsWith('pocket-collar'));
  const insideCloth = (x, z) => cloth.some((b) => {
    const [sx, , sz] = b.size;
    const [px, , pz] = b.pos;
    return Math.abs(x - px) <= sx / 2 + 1e-9 && Math.abs(z - pz) <= sz / 2 + 1e-9;
  });

  const hole = POCKET_HOLE.half;             // 方形开口半宽
  // 口沿：0.7.0 起是平贴的 RingGeometry（不再是浮起的 Torus），外半径与 table.js 同一公式，
  // 且按袋型取喉口半径（角袋 57 / 中袋 60）——中袋已经顶到方形开口，必须一起夹住。
  const rimOuterOf = (p) => Math.min(throatRadiusOf(p) + 0.0028, hole - 0.0008);

  // 1) 口沿圆环必须完全落在开口内（不能压到绿台布上）
  let worst = '';
  let spill = 0;
  let rimMin = Infinity;
  let rimMax = 0;
  for (const p of pocketSensors()) {
    const ringOuter = rimOuterOf(p);
    rimMin = Math.min(rimMin, ringOuter);
    rimMax = Math.max(rimMax, ringOuter);
    for (let ri = 0; ri <= 12; ri++) {
      for (let ai = 0; ai < 48; ai++) {
        const r = (ri / 12) * ringOuter;
        const a = (ai / 48) * Math.PI * 2;
        const x = p.x + Math.cos(a) * r;
        const z = p.z + Math.sin(a) * r;
        if (insideCloth(x, z)) { spill++; worst = `${p.name} @ (${x.toFixed(3)}, ${z.toFixed(3)})`; }
      }
    }
  }
  check(spill === 0, `喉口口沿（外径 ${(rimMin * 2000).toFixed(1)}~${(rimMax * 2000).toFixed(1)}mm）不越过台布`, worst);

  // 2) 边缘平台：外缘正好贴着开口边界（直接量网格包围盒）
  const plate = table.group.children.find((m) => m.name === 'pocket-plate-0');
  plate.geometry.computeBoundingBox();
  const bb = plate.geometry.boundingBox;      // ShapeGeometry 在 XY 平面，旋转 -90° 后平铺
  const p0 = pocketSensors()[0];
  check(Math.abs(bb.max.x - hole) < 1e-6 && Math.abs(bb.max.y - hole) < 1e-6,
    `边缘平台外缘 = 开口半宽 ${(hole * 1000).toFixed(1)}mm（不会压到绿台布上）`,
    `实测 ${(bb.max.x * 1000).toFixed(1)} / ${(bb.max.y * 1000).toFixed(1)}mm`);
  check(Math.abs(plate.position.x - p0.x) < 1e-9 && Math.abs(plate.position.z - p0.z) < 1e-9,
    '边缘平台与袋口中心对齐');

  let insideIsCloth = 0;
  const dirs = [[1, 0], [-1, 0], [0, 1], [0, -1]];
  for (const p of pocketSensors()) {
    for (const [sx, sz] of dirs) {
      if (insideCloth(p.x + sx * (hole - 0.004), p.z + sz * (hole - 0.004))) insideIsCloth++;
    }
  }
  check(insideIsCloth === 0, '开口内侧确实是空的（不是台布）');

  // 开口尺寸：袋口是**袋心 ∓ POCKET_HOLE.half** 的正方形。0.8.0 起由袋心反推
  // （袋心已经移到库鼻线外侧，不再等于 pocketCut + cushionW）。
  // 这里量的性质是"台布缺口的内沿 = 收口环的外沿"：从袋心沿四个方向往外走，
  // 第一次碰到台布的距离必须正好是开口半宽 —— 差一点就会出现"球从台布上凭空掉下去"
  // （缺口比环大）或"环压在台布上拱起一条边"（缺口比环小）。
  const notchDist = [];
  for (const p of pocketSensors()) {
    for (const [sx, sz] of dirs) {
      let first = null;
      for (let r = 0.001; r <= hole * 1.6; r += 0.0005) {
        if (insideCloth(p.x + sx * r, p.z + sz * r)) { first = r; break; }
      }
      // 朝台外的两个方向（角袋）根本没有台布，跳过
      if (first === null) continue;
      if (Math.abs(first - hole) > 0.0006) notchDist.push(`${p.name} ${sx},${sz} → ${(first * 1000).toFixed(1)}mm`);
    }
  }
  check(notchDist.length === 0,
    `台布缺口内沿 = 开口半宽 ${(hole * 1000).toFixed(1)}mm（收口环外沿严丝合缝）`,
    notchDist.join(' · '));
  // 0.7.0 喉口半径按袋型分开（角袋 57 / 中袋 60）→ 取最小值与球径比
  const minThroat = Math.min(...pocketSensors().map((p) => throatRadiusOf(p)));
  check(minThroat * 2 > 0.0572 + 0.01,
    `圆形喉口最小直径 ${(minThroat * 2000).toFixed(1)}mm > 球直径 57.2mm（球能顺利落袋）`);

  // 每个袋口中心都必须落在"没有台布"的开口里
  const centersInHole = pocketSensors().every((p) => !insideCloth(p.x, p.z));
  check(centersInHole, '6 个袋口中心均位于开口内（不在台布上）');

  // 3) 收口环必须无缝覆盖「喉口之外、方形开口之内」的全部区域
  //    这一段同时验证了旋转方块的 rotY 朝向是否正确（local +Z = 径向）
  const collars = pocketCollarBoxes();
  const boxCovers = (b, x, z) => {
    const [bx, , bz] = b.size;
    const [px, , pz] = b.pos;
    const dx = x - px, dz = z - pz;
    const c = Math.cos(b.rotY), s = Math.sin(b.rotY);
    const lx = c * dx - s * dz;      // 逆旋转回方块局部坐标
    const lz = s * dx + c * dz;
    return Math.abs(lx) <= bx / 2 + 1e-9 && Math.abs(lz) <= bz / 2 + 1e-9;
  };
  let gaps = 0;
  let gapWorst = '';
  for (const p of pocketSensors()) {
    const throatR = throatRadiusOf(p);
    for (let ai = 0; ai < 72; ai++) {
      const a = (ai / 72) * Math.PI * 2;
      const rMax = hole / Math.max(Math.abs(Math.cos(a)), Math.abs(Math.sin(a))) - 0.002;
      // 0.7.0 中袋喉口 60mm：θ 靠近轴向时开口边界 ≈60.7mm，收口进深 <2mm ——
      // 与 pocketCollarBoxes 的 depth<=1e-4 continue 同口径：没有收口区域就跳过
      if (rMax <= throatR + 0.002) continue;
      for (let ri = 1; ri <= 10; ri++) {
        const r = throatR + 0.002 + (ri / 10) * (rMax - throatR - 0.002);
        const x = p.x + Math.cos(a) * r;
        const z = p.z + Math.sin(a) * r;
        if (!collars.some((b) => boxCovers(b, x, z))) {
          gaps++;
          gapWorst = `${p.name} r=${(r * 1000).toFixed(1)}mm θ=${((a * 180) / Math.PI).toFixed(0)}°`;
        }
      }
    }
  }
  check(gaps === 0, '收口环无缝覆盖「喉口之外、开口之内」（旋转方块朝向正确）',
    gaps ? `漏洞 ${gaps} 处，例如 ${gapWorst}` : '全部采样点均被覆盖');
}

console.log('\n[7] 场景节点统计');
console.log(`  台桌网格 ${table.group.children.length} 个 · 球网格 ${balls.length} 个 · ` +
  `物理刚体 ${world.bodies.len()} 个 · 碰撞体 ${world.colliders.len()} 个`);
console.log(`  袋口: ${pocketSensors().map((p) => p.name).join('、')}`);

console.log(`\n===== 渲染层结果：${pass} 项通过，${fail} 项失败 =====`);
process.exit(fail > 0 ? 1 : 0);
