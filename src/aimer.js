import * as THREE from 'three';
import { BALL_R, CUE } from './constants.js';

const UP = new THREE.Vector3(0, 1, 0);

/** 击球方向（水平单位向量）：方向向量 = (sinθ, 0, cosθ) */
export function aimVector(angle, out = new THREE.Vector3()) {
  return out.set(Math.sin(angle), 0, Math.cos(angle));
}

/**
 * 瞄准辅助 + 球杆模型（纯渲染，不参与物理）
 *  - 高亮瞄准线 + 箭头（细圆柱，避免 LineBasicMaterial 的 linewidth 在多数平台无效）
 *  - 白球脚下的高亮圆环
 *  - 球杆：杆身 + 杆头，击球瞬间沿击球方向短暂前冲
 */
export class Aimer {
  constructor(scene) {
    // 让圆柱从原点沿 +Y 生长，之后只需用 quaternion 把 +Y 转到击球方向
    const lineGeo = new THREE.CylinderGeometry(0.0045, 0.0045, 1, 12);
    lineGeo.translate(0, 0.5, 0);
    this.length = 0.55;

    const mat = new THREE.MeshBasicMaterial({ color: 0xffe14d });
    this.line = new THREE.Mesh(lineGeo, mat);
    this.tip = new THREE.Mesh(new THREE.ConeGeometry(0.016, 0.05, 16), mat);
    this.ring = new THREE.Mesh(
      new THREE.RingGeometry(BALL_R * 1.25, BALL_R * 1.55, 32),
      new THREE.MeshBasicMaterial({ color: 0xffe14d, transparent: true, opacity: 0.6, side: THREE.DoubleSide })
    );
    this.ring.rotation.x = -Math.PI / 2;

    this.stick = this.#buildStick();
    for (const o of [this.line, this.tip, this.ring, this.stick]) scene.add(o);
  }

  #buildStick() {
    const group = new THREE.Group();
    const shaft = new THREE.Mesh(
      new THREE.CylinderGeometry(CUE.tipR, CUE.buttR, CUE.length, 20),
      new THREE.MeshStandardMaterial({ color: CUE.color, roughness: 0.5, metalness: 0.05 })
    );
    shaft.rotation.x = Math.PI / 2;   // 轴 +Y → +Z（杆头在 +Z，指向白球）
    shaft.castShadow = true;
    group.add(shaft);

    const tip = new THREE.Mesh(
      new THREE.CylinderGeometry(CUE.tipR * 1.05, CUE.tipR * 1.05, 0.02, 16),
      new THREE.MeshStandardMaterial({ color: CUE.tipColor, roughness: 0.85 })
    );
    tip.rotation.x = Math.PI / 2;
    tip.position.z = CUE.length / 2;
    group.add(tip);
    return group;
  }

  /**
   * @param visible 能否出杆（球在动 / 白球进袋时整套辅助隐藏）
   * @param ballPos 白球球心世界坐标
   * @param dir     击球方向（单位向量）
   * @param cueAnim 击球动画进度 0~1（0 = 没在播）
   */
  update(visible, ballPos, dir, cueAnim) {
    this.line.visible = this.tip.visible = this.ring.visible = this.stick.visible = visible;
    if (!visible) return;

    const start = ballPos.clone().addScaledVector(dir, BALL_R + 0.004);
    const end = start.clone().addScaledVector(dir, this.length);

    this.line.position.copy(start);
    this.line.scale.set(1, this.length, 1);
    this.line.quaternion.setFromUnitVectors(UP, dir);

    this.tip.position.copy(end);
    this.tip.quaternion.setFromUnitVectors(UP, dir);

    this.ring.position.set(ballPos.x, 0.004, ballPos.z);

    // 杆头停在白球后方 gap 处、略微抬高；击球动画期间沿击球方向前冲
    const tipWorld = ballPos.clone()
      .addScaledVector(dir, -CUE.gap)
      .add(new THREE.Vector3(0, CUE.lift, 0));
    if (cueAnim > 0) tipWorld.addScaledVector(dir, Math.sin(cueAnim * Math.PI) * CUE.thrust);

    this.stick.position.copy(tipWorld).addScaledVector(dir, -CUE.length / 2);
    this.stick.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), dir);
  }
}
