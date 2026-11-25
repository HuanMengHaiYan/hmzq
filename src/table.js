import * as THREE from 'three';
import { PHYS, TABLE } from './constants.js';
import {
  tableBoxes, pocketSensors, POCKET_HOLE, throatRadiusOf, pocketLids,
} from './layout.js';
import { makeClothTexture } from './textures.js';

/**
 * 球桌搭建：几何体全部来自 layout.js 的纯数据定义
 *  - cloth   台面（5 块 Box 拼出带 6 个袋口洞的台布）
 *  - cushion 橡胶库边（6 段，袋口处断开）
 *  - wood    木质外框 / 桌裙 / 桌腿
 *  - tray    落球盘
 *  另外创建 6 个袋口传感器（sensor，材质隐藏，仅用于进袋判定）
 *
 * @param opts.hideVisual 0.8.0：为 true 时**只建碰撞体、不建任何可视网格**
 *        （连袋口平台/袋筒/口沿也跳过），桌面外观交给 table-model.js 的 GLB。
 *        碰撞体的位置、尺寸、材质、传感器、盖板一律不变 —— 换外观不改手感。
 */
export function buildTable(scene, world, RAPIER, opts = {}) {
  const hideVisual = !!opts.hideVisual;
  const group = new THREE.Group();
  group.name = 'table';
  scene.add(group);
  const materials = {
    cloth: new THREE.MeshStandardMaterial({
      map: makeClothTexture(), roughness: 0.94, metalness: 0,
    }),
    cushion: new THREE.MeshStandardMaterial({ color: 0x18754f, roughness: 0.85 }),
    wood: new THREE.MeshStandardMaterial({ color: 0x5b3220, roughness: 0.55, metalness: 0.08 }),
    tray: new THREE.MeshStandardMaterial({ color: 0x22262c, roughness: 0.9 }),
  };
  const darkMat = new THREE.MeshStandardMaterial({ color: 0x0c0f12, roughness: 0.95 });

  const staticBody = world.createRigidBody(RAPIER.RigidBodyDesc.fixed());
  const cushionHandles = new Set();   // 库边碰撞体句柄：音效系统靠它识别"撞库"

  // ---------- 可视网格 + 静态碰撞体 ----------
  for (const b of tableBoxes({ railHalfL: opts.railHalfL, railHalfW: opts.railHalfW })) {
    const [sx, sy, sz] = b.size;
    const [px, py, pz] = b.pos;
    const rotY = b.rotY || 0;

    if (b.visible && !hideVisual) {
      const mesh = new THREE.Mesh(new THREE.BoxGeometry(sx, sy, sz), materials[b.kind]);
      mesh.position.set(px, py, pz);
      if (rotY) mesh.rotation.y = rotY;
      mesh.receiveShadow = true;
      mesh.castShadow = !!b.castShadow;
      mesh.name = b.id;
      group.add(mesh);
    }

    if (b.phys) {
      const p = PHYS[b.phys];
      const desc = RAPIER.ColliderDesc.cuboid(sx / 2, sy / 2, sz / 2)
        .setTranslation(px, py, pz)
        .setRestitution(p.restitution)
        .setFriction(p.friction);
      // 橡胶库边开碰撞事件，供音效系统播放"撞库"声。
      // 只对 cushion 开：台布 / 落球盘 / 外框开了也只会带来一堆无意义的瞬时接触。
      if (b.kind === 'cushion') desc.setActiveEvents(RAPIER.ActiveEvents.COLLISION_EVENTS);
      // 绕 Y 轴旋转 rotY（四元数 y=sin(θ/2), w=cos(θ/2)）
      if (rotY) desc.setRotation({ x: 0, y: Math.sin(rotY / 2), z: 0, w: Math.cos(rotY / 2) });
      const collider = world.createCollider(desc, staticBody);
      if (b.kind === 'cushion') cushionHandles.add(collider.handle);
    }
  }

  // ---------- 袋口装饰：边缘平台 + 通喉袋筒 + 喉口口沿 ----------
  // 之前整块方形开口都是「洞」，会在绿台布上留出一圈虚空、也会让球沿边再滚几厘米才掉下去。
  // 现在改成：方形开口铺一块深色边缘平台（中间挖一个圆形喉口），喉口下方才是落球通道。
  //
  // ⚠️ 角袋 / 中袋的喉口半径不同（中袋更大，见 constants.js），所以平台与袋筒的
  //    几何要按袋逐个生成 —— 不能在循环外建一份共用的 Shape。
  const hole = POCKET_HOLE.half;   // 开口半宽
  const linerMat = darkMat.clone();
  linerMat.side = THREE.DoubleSide;          // 从上方能看见袋筒内壁
  // 口沿：比平台略亮一档的暗色，让洞口边缘有一点层次（不改就完全是个纯黑洞）。
  const rimMat = new THREE.MeshStandardMaterial({ color: 0x1b2126, roughness: 0.88 });

  const linerTop = -0.002;
  const linerH = 0.22;
  // 两条路：
  //   参数化桌面（hideVisual=false）：深色平台 + 袋筒 + 喉口口沿，把方形开口收成圆洞；
  //   真实模型（hideVisual=true）：**不挖洞**，模型自带袋口就是玩家看到的洞
  //     （0.8.0 定版：以前按判定圆在台呢上挖一个圆洞，结果绿台呢上多出一个黑圆盘，
  //      模型自己的袋口反而在旁边 —— 用户一眼就看出来"这个洞不是模型上的"）。
  //     这里只补一个深色袋兜内壁，挡住球落下去时从洞口看到的桌腔与落球盘。
  //
  // ⚠️ 洞口形状的历史（别走回头路，0.8.0-test 返工四次）：
  //   ①「袋心 + 半径 60/70、往下放到 150」把木框下半部掏空 → "像挖了个大坑"；
  //   ②「125 mm 宽、向框内沿延伸的胶囊」→ 台呢上被咬掉的月牙重心偏台内约 40 mm；
  //   ③「圆心 = 判定圆、半径 = 喉口」→ 洞是正圆了，但它落在台呢中间而不是模型袋口上
  //     （因为判定圆本身就比模型袋口靠内 3~5 cm）；
  //   ④ 现在：不挖，把**判定圆挪到模型袋口上**（见 constants.js 的 pocketOut）。
  if (hideVisual) {
    const wellMat = darkMat.clone();
    wellMat.side = THREE.DoubleSide;
    wellMat.color = new THREE.Color(0x15191d);
    wellMat.roughness = 0.95;
    const WELL_H = 0.32;

    for (const p of pocketSensors()) {
      const R = throatRadiusOf(p);

      // 袋兜内壁：正圆筒，口径贴着喉口（模型袋口是漏斗形，筒比它略大就永远看不到筒外的结构）
      const tube = new THREE.Mesh(
        new THREE.CylinderGeometry(R + 0.004, R, WELL_H, 32, 1, true),
        wellMat,
      );
      tube.position.set(p.x, -WELL_H / 2 - 0.004, p.z);
      tube.name = `pocket-well-${p.index}`;
      group.add(tube);

      const bottom = new THREE.Mesh(new THREE.CircleGeometry(R, 32), wellMat);
      bottom.rotation.x = -Math.PI / 2;
      bottom.position.set(p.x, -WELL_H - 0.004, p.z);
      bottom.name = `pocket-bottom-${p.index}`;
      group.add(bottom);
    }
  }
  for (const p of (hideVisual ? [] : pocketSensors())) {
    const throatR = throatRadiusOf(p);

    // 平台：正方外形 + 圆形挖孔（单独一片网格，避免拼缝卡顿）
    const plateShape = new THREE.Shape();
    plateShape.moveTo(-hole, -hole);
    plateShape.lineTo(hole, -hole);
    plateShape.lineTo(hole, hole);
    plateShape.lineTo(-hole, hole);
    plateShape.closePath();
    const throatHole = new THREE.Path();
    throatHole.absarc(0, 0, throatR, 0, Math.PI * 2, true);
    plateShape.holes.push(throatHole);

    const plate = new THREE.Mesh(new THREE.ShapeGeometry(plateShape, 48), darkMat);
    plate.rotation.x = -Math.PI / 2;
    plate.position.set(p.x, -0.0005, p.z);
    plate.name = `pocket-plate-${p.index}`;
    group.add(plate);

    // 落球通道：上口严格对齐喉口，再往下收窄
    const liner = new THREE.Mesh(
      new THREE.CylinderGeometry(throatR, throatR * 0.72, linerH, 28, 1, true),
      linerMat
    );
    liner.position.set(p.x, linerTop - linerH / 2, p.z);
    liner.name = `pocket-liner-${p.index}`;
    group.add(liner);

    // 口沿：平贴在台面上的一圈薄环（0.7.0 改）。
    // 0.6.0 及以前这里是一个 `TorusGeometry(throatR + 3mm, 管径 5mm)`，圆心抬到 y=3mm ——
    // 从斜上方看就是"洞口套了一个圈"，用户这次点名的就是它。
    // 现在改成零高度的 RingGeometry：只做边缘的暗色过渡，不再有浮起的圆管。
    // 外径要压在方形开口以内（中袋喉口已经 60mm，加上环就顶到 62.5mm 的开口边），
    // 所以按袋型夹一下，绝不越过绿台布。
    const rimOut = Math.min(throatR + 0.0028, hole - 0.0008);
    if (rimOut > throatR + 0.0006) {
      const rim = new THREE.Mesh(new THREE.RingGeometry(throatR, rimOut, 48), rimMat);
      rim.rotation.x = -Math.PI / 2;
      rim.position.set(p.x, 0.0008, p.z);
      rim.name = `pocket-rim-${p.index}`;
      group.add(rim);
    }
  }

  // ---------- 6 个进袋判定几何体（sensor + 隐藏材质）----------
  const sensors = pocketSensors().map((p) => {
    const desc = RAPIER.ColliderDesc.cylinder(p.halfHeight, p.radius)
      .setTranslation(p.x, p.y, p.z)
      .setSensor(true)
      .setActiveEvents(RAPIER.ActiveEvents.COLLISION_EVENTS);
    const collider = world.createCollider(desc, staticBody);

    // 场景图中真实存在，但材质不可见（按 D 键可显形用于调试）
    const ghost = new THREE.Mesh(
      new THREE.CylinderGeometry(p.radius, p.radius, p.halfHeight * 2, 16),
      new THREE.MeshBasicMaterial({ color: 0xff3366, transparent: true, opacity: 0, visible: false })
    );
    ghost.position.set(p.x, p.y, p.z);
    ghost.name = `pocket-sensor-${p.index}`;
    group.add(ghost);

    return {
      collider, ghost, index: p.index, name: p.name,
      type: p.type, throat: p.throat, x: p.x, z: p.z,
    };
  });

  // ---------- 袋口盖板（默认停用 = 袋口敞开）----------
  // 玩法规则用：启用后该袋暂时「关闭」，球滚过去不会掉下去。
  const lids = pocketLids().map((l) => {
    const p = PHYS.clothSurface;
    const collider = world.createCollider(
      RAPIER.ColliderDesc.cuboid(l.half, l.thickness / 2, l.half)
        .setTranslation(l.x, -l.thickness / 2, l.z)
        .setRestitution(p.restitution)
        .setFriction(p.friction),
      staticBody
    );
    collider.setEnabled(false);
    return {
      collider, ghost: null, index: l.index, name: l.name, type: l.type,
      x: l.x, z: l.z, throat: throatRadiusOf(l),
    };
  });

  return { group, sensors, staticBody, lids, cushionHandles };
}
