/**
 * 移动端性能负载统计（离线，无 WebGL）
 * ------------------------------------------------------------------
 * 用最小 DOM 打桩真实执行 table.js / balls.js 的场景构建代码，统计：
 *   网格数（≈ draw call 上限）、三角形总数、材质数、纹理像素总量、
 *   投影阴影的物体数、物理刚体 / 碰撞体数。
 * 灯光与阴影配置的数字取自 src/stage.js（那里要真 WebGL 才能实例化，这里手写同步）。
 *
 * 运行：node scripts/perf-report.mjs
 */
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
const { createBalls } = await import('../src/balls.js');
const { PHYS } = await import('../src/constants.js');

await RAPIER.init();
const world = new RAPIER.World(PHYS.gravity);
world.timestep = PHYS.timestep;

const scene = new THREE.Scene();
buildTable(scene, world, RAPIER);
const { balls } = createBalls(scene, world, RAPIER);

let meshes = 0, tris = 0, casters = 0, receivers = 0;
const materials = new Set();
const textures = new Map();

scene.traverse((o) => {
  if (!o.isMesh && !o.isLineSegments) return;
  meshes++;
  const g = o.geometry;
  if (g?.index) tris += g.index.count / 3;
  else if (g?.attributes?.position) tris += g.attributes.position.count / 3;
  if (o.castShadow) casters++;
  if (o.receiveShadow) receivers++;
  for (const m of (Array.isArray(o.material) ? o.material : [o.material])) {
    if (!m) continue;
    materials.add(m.uuid);
    for (const k of ['map', 'normalMap', 'roughnessMap', 'emissiveMap']) {
      const t = m[k];
      if (t?.image?.width) textures.set(t.uuid, (textures.get(t.uuid) || 0) + t.image.width * t.image.height);
    }
  }
});

let texPixels = 0;
for (const px of textures.values()) texPixels += px;

// ---- src/stage.js 的灯光 / 阴影配置（手抄，改那边时记得同步这里）----
const LIGHTS = {
  spot: 2, spotShadowMap: 2048, spotCastShadow: true,
  hemi: 1, ambient: 1, directional: 1,
  shadowType: 'PCFShadowMap',
  toneMapping: 'ACESFilmic',
};
const shadowPixels = LIGHTS.spot * LIGHTS.spotShadowMap ** 2;

const bodies = world.bodies.len();
const colliders = world.colliders.len();

const row = (k, v, note = '') => console.log(`  ${String(k).padEnd(22)}${String(v).padEnd(14)}${note}`);
console.log('\n===== 渲染负载 =====');
row('网格数', meshes, '≈ 主 pass 的 draw call 上限（含球 16 + 台桌 48）');
row('三角形总数', Math.round(tris).toLocaleString(), '每帧主 pass');
row('投影阴影物体', casters, `× ${LIGHTS.spot} 张 shadow map`);
row('接收阴影物体', receivers, '');
row('材质数', materials.size, 'MeshStandardMaterial 为主（PBR）');
row('纹理像素总量', texPixels.toLocaleString(), `共 ${textures.size} 张程序化贴图`);
row('阴影贴图像素', shadowPixels.toLocaleString(), `${LIGHTS.spot} × ${LIGHTS.spotShadowMap}²（${LIGHTS.shadowType}）`);

console.log('\n===== 物理负载 =====');
row('刚体数', bodies, '16 颗球 + 台桌静态体');
row('碰撞体数', colliders, '含 6 个袋口传感器');
row('固定步长', `${(PHYS.timestep * 1000).toFixed(2)} ms`, '每 16.7ms 帧需要 ~2 步');
row('求解器迭代', 8, 'world.numSolverIterations');
row('速度上限', `${PHYS.maxSpeed} m/s`, '');

console.log('\n===== 每帧估算（60fps 目标 = 16.7ms 预算）=====');
// 主 pass + 2 张 shadow map：阴影 pass 只画 casters，顶点量按 casters 占比折算
const mainTris = Math.round(tris);
const shadowTris = Math.round(tris * (casters / Math.max(meshes, 1))) * LIGHTS.spot;
row('几何吞吐', `${(mainTris + shadowTris).toLocaleString()} 三角/帧`, `主 ${mainTris.toLocaleString()} + 阴影 ${shadowTris.toLocaleString()}`);
row('等效每帧', `${((mainTris + shadowTris) * 60 / 1e6).toFixed(1)} M 三角/秒`, '60fps 时');
console.log('');
