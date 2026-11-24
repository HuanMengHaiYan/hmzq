import { check } from '../lib/harness.mjs';
import { TABLE, CAM } from '../../src/constants.js';
import { fovForAspect } from '../../src/stage.js';
import { isPortrait, fitOverviewDist } from '../../src/camera-rig.js';

/**
 * 竖屏俯瞰机位（纯逻辑，不需要浏览器）
 * ------------------------------------------------------------------
 * 用户反馈的原始问题：竖屏下球台"横着摆"—— 台子两头被裁掉、上下大片空黑。
 * 现在的做法是绕 Y 轴转 90°（相机挪到长轴那端斜上方）+ 按视锥反解距离。
 * 这里守住三件事：
 *   ① 反解出来的机位真的能把整张台（含木框）装进屏幕，且**占得够满**；
 *   ② 竖屏才转、横屏必须一个字都不变（桌面观感不能被这次改动带偏）；
 *   ③ 反解是"从近到远"的最小距离 —— 距离再大还能装下，但不该被白白浪费。
 */

const ASPECTS = [0.40, 0.46, 0.50, 0.55, 0.75];

/** 把球台外框 8 个角投到 NDC（和 fitOverviewDist 内部用的是同一套公式，独立写一遍做交叉验证） */
function projectCorners(aspect, fovDeg, dist) {
  const elev = (CAM.portElev * Math.PI) / 180;
  const cam = [-dist * Math.cos(elev), 0.1 + dist * Math.sin(elev), 0];
  const ty = 0.1;
  let bx = cam[0], by = cam[1] - ty, bz = cam[2];
  const bl = Math.hypot(bx, by, bz);
  bx /= bl; by /= bl; bz /= bl;
  let rx = bz, rz = -bx;
  const rl = Math.hypot(rx, rz); rx /= rl; rz /= rl;
  const ux = by * rz, uy = bz * rx - bx * rz, uz = -by * rx;
  const tanV = Math.tan((fovDeg * Math.PI) / 360);
  const tanH = tanV * aspect;
  const out = [];
  for (const x of [-TABLE.outerHalfL, TABLE.outerHalfL]) {
    for (const z of [-TABLE.outerHalfW, TABLE.outerHalfW]) {
      const vx = x - cam[0], vy = 0 - cam[1], vz = z - cam[2];
      const dist = -(vx * bx + vy * by + vz * bz);
      out.push([
        (vx * rx + vz * rz) / dist / tanH,
        (vx * ux + vy * uy + vz * uz) / dist / tanV,
      ]);
    }
  }
  return out;
}

export function testPortraitOverview() {
  console.log('\n[30] 竖屏俯瞰机位：整台占满屏幕');

  check(isPortrait(0.46) && isPortrait(0.99) && !isPortrait(1) && !isPortrait(1.78),
    '竖屏判定 = 宽高比 < 1');
  check(!isPortrait(NaN) && !isPortrait(0) && !isPortrait(-2), '异常宽高比不会被误判成竖屏');

  for (const a of ASPECTS) {
    const fov = fovForAspect(a);
    const fit = fitOverviewDist(a, fov);
    // 反解出来的距离必须真的装得下（留 1% 容差，二分收的是 hi 侧）
    const corners = projectCorners(a, fov, fit.dist);
    const worst = corners.reduce((m, [x, y]) => Math.max(m, Math.abs(x), Math.abs(y)), 0);
    check(worst <= CAM.portMargin + 0.01,
      `宽高比 ${a}（fov ${fov.toFixed(0)}°）：整张台在屏内`,
      `最外侧角占屏 ${(worst * 100).toFixed(0)}%（上限 ${(CAM.portMargin * 100).toFixed(0)}%）`);
    // "尽可能占满"= 至少有一个方向贴到边距（哪个方向是瓶颈取决于屏幕有多窄）
    const tightest = Math.max(fit.useX, fit.useY);
    check(tightest >= CAM.portMargin - 0.01,
      `宽高比 ${a}：至少一个方向贴到边距（不白留空）`,
      `横 ${(fit.useX * 100).toFixed(0)}% / 纵 ${(fit.useY * 100).toFixed(0)}%`);
    if (a < 0.6) {
      check(fit.useX > 0.85,
        `宽高比 ${a}：横向占满屏幕（台子不再两头出画）`, `横向占屏 ${(fit.useX * 100).toFixed(0)}%`);
    }
    check(fit.useY > 0.55,
      `宽高比 ${a}：纵向也用起来（旧机位只有 24%）`, `纵向占屏 ${(fit.useY * 100).toFixed(0)}%`);
  }

  // 对照：老机位 (0, 2.1, 3.0) 在竖屏下横向溢到 148%（台子被裁）
  const oldCorner = (() => {
    const cam = [0, 2.1, 3.0];
    const ty = 0.1;
    let bx = cam[0] - 0, by = cam[1] - ty, bz = cam[2] - 0;
    const bl = Math.hypot(bx, by, bz); bx /= bl; by /= bl; bz /= bl;
    let rx = bz, rz = -bx;
    const rl = Math.hypot(rx, rz); rx /= rl; rz /= rl;
    const ux = by * rz, uy = bz * rx - bx * rz, uz = -by * rx;
    const a = 0.46;
    const tanV = Math.tan((fovForAspect(a) * Math.PI) / 360);
    const tanH = tanV * a;
    let worst = 0;
    for (const x of [-TABLE.outerHalfL, TABLE.outerHalfL]) {
      for (const z of [-TABLE.outerHalfW, TABLE.outerHalfW]) {
        const vx = x - cam[0], vy = -cam[1], vz = z - cam[2];
        const d = -(vx * bx + vy * by + vz * bz);
        worst = Math.max(worst, Math.abs((vx * rx + vz * rz) / d / tanH));
      }
    }
    return worst;
  })();
  check(oldCorner > 1.2, '对照：老机位在竖屏下横向溢到屏外（这就是"别扭"的根源）',
    `横向 ${(oldCorner * 100).toFixed(0)}%`);
  const a46 = 0.46;
  const now = fitOverviewDist(a46, fovForAspect(a46));
  check(now.dist < 6, '反解出的距离落在自由模式的缩放区间内（0.55~6m）', `${now.dist.toFixed(2)}m`);
  check(now.useX > 0.85 && now.useX < 1, '新机位横向既不裁切也不浪费', `${(now.useX * 100).toFixed(0)}%`);

  // 越窄的屏幕需要越远（同一个球台要塞进更窄的画幅）
  const d42 = fitOverviewDist(0.42, fovForAspect(0.42)).dist;
  const d75 = fitOverviewDist(0.75, fovForAspect(0.75)).dist;
  check(d42 > d75, '屏幕越窄相机越远（否则装不下）',
    `0.42 → ${d42.toFixed(2)}m · 0.75 → ${d75.toFixed(2)}m`);

  // 相机必须在白球那端（-X）上空：这样摆球架朝屏幕上方，出杆方向朝上
  const elev = (CAM.portElev * Math.PI) / 180;
  const px = -now.dist * Math.cos(elev);
  const py = 0.1 + now.dist * Math.sin(elev);
  check(px < -0.5 && py > 1.5, '相机在白球那端的斜上方（长边竖进屏幕）',
    `camera(${px.toFixed(2)}, ${py.toFixed(2)}, 0)`);

  // 同一个宽高比反复调用必须稳定（机位不能每帧抖）
  const again = fitOverviewDist(a46, fovForAspect(a46));
  check(Math.abs(again.dist - now.dist) < 1e-9, '反解结果可复现（不会每帧抖）');
}
