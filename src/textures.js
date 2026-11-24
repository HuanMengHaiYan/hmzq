import * as THREE from 'three';
import { BALL_COLORS, isStriped } from './constants.js';
import { host } from './platform/index.js';

/**
 * 各向异性过滤级别（画质设置里的「纹理细节」）。
 * 建纹理时用它当默认值，之后 applyAnisotropy() 可以一次性改掉所有已建好的纹理。
 */
let anisoLevel = 8;

/** 所有生成过的纹理：改各向异性时要统一刷一遍（three 只在重新上传时应用该参数） */
const registry = [];

function track(tex) {
  tex.anisotropy = anisoLevel;
  registry.push(tex);
  return tex;
}

/** 当前的各向异性级别（外部建纹理时想跟着画质走就取这个） */
export function getAnisoLevel() {
  return anisoLevel;
}

/**
 * 把外部建好的纹理纳入统一管理（模型贴图用）。
 * 之后 applyAnisotropy() 刷级别时会一并刷到它 —— 否则模型贴图永远停在 1×。
 */
export function trackTexture(tex) {
  if (!tex || registry.includes(tex)) return tex;
  return track(tex);
}

/** 反注册（纹理 dispose 之前调用，免得 registry 里留着已释放的纹理） */
export function untrackTexture(tex) {
  const i = registry.indexOf(tex);
  if (i >= 0) registry.splice(i, 1);
}

/**
 * 改所有纹理的各向异性过滤级别（画质设置调用）。
 * 需要在改完设 needsUpdate = true 才会重新上传生效。
 * @param level 目标级别（会被上限截断）
 * @param max   渲染器支持的上限（renderer.capabilities.getMaxAnisotropy()）
 */
export function applyAnisotropy(level, max = 16) {
  const n = Math.max(1, Math.min(Math.round(level) || 1, Math.max(1, max | 0) || 16));
  anisoLevel = n;
  for (const t of registry) {
    if (t.anisotropy === n) continue;
    t.anisotropy = n;
    t.needsUpdate = true;
  }
  return n;
}

/**
 * 用 Canvas 程序化生成球面贴图（等距柱面映射，正好匹配 SphereGeometry 的 UV）
 * - 全色球：整体上色
 * - 花色球：白底 + 赤道色带
 * - 号码：在 u=0.25 / u=0.75 两处各画一个白圈+数字，保证任意角度都能看到
 */
function makeBallTexture(number) {
  const W = 1024;
  const H = 512;
  const cvs = host.canvas(W, H);
  const ctx = cvs.getContext('2d');

  const color = BALL_COLORS[number];
  const striped = isStriped(number);

  if (striped) {
    ctx.fillStyle = '#f6f4ef';
    ctx.fillRect(0, 0, W, H);
    ctx.fillStyle = color;
    ctx.fillRect(0, H * 0.235, W, H * 0.53);
  } else {
    ctx.fillStyle = color;
    ctx.fillRect(0, 0, W, H);
  }

  // 号码圈
  for (const cx of [W * 0.25, W * 0.75]) {
    const cy = H * 0.5;
    const r = H * 0.185;

    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.fillStyle = '#fbfaf6';
    ctx.fill();

    ctx.fillStyle = '#15181c';
    ctx.font = `bold ${Math.floor(r * 1.32)}px "Arial Narrow", Arial, sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(String(number), cx, cy + r * 0.06);
  }

  const tex = new THREE.CanvasTexture(cvs);
  tex.colorSpace = THREE.SRGBColorSpace;
  return track(tex);
}

/** 白球：加两个红点便于观察自转 */
function makeCueTexture() {
  const W = 1024;
  const H = 512;
  const cvs = host.canvas(W, H);
  const ctx = cvs.getContext('2d');

  ctx.fillStyle = '#f7f5ee';
  ctx.fillRect(0, 0, W, H);

  ctx.fillStyle = '#c8342f';
  for (const [ux, uy] of [[0.25, 0.5], [0.75, 0.5], [0.5, 0.22], [0.5, 0.78]]) {
    ctx.beginPath();
    ctx.arc(W * ux, H * uy, H * 0.035, 0, Math.PI * 2);
    ctx.fill();
  }

  const tex = new THREE.CanvasTexture(cvs);
  tex.colorSpace = THREE.SRGBColorSpace;
  return track(tex);
}

const cache = new Map();

export function getBallTexture(number) {
  if (!cache.has(number)) {
    cache.set(number, number === 0 ? makeCueTexture() : makeBallTexture(number));
  }
  return cache.get(number);
}

/** 台布：细微噪点，避免纯色塑料感 */
export function makeClothTexture() {
  const S = 512;
  const cvs = host.canvas(S, S);
  const ctx = cvs.getContext('2d');

  ctx.fillStyle = '#1c6b4a';
  ctx.fillRect(0, 0, S, S);

  const img = ctx.getImageData(0, 0, S, S);
  const d = img.data;
  for (let i = 0; i < d.length; i += 4) {
    const n = (Math.random() - 0.5) * 26;
    d[i] += n;
    d[i + 1] += n;
    d[i + 2] += n;
  }
  ctx.putImageData(img, 0, 0);

  const tex = new THREE.CanvasTexture(cvs);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(10, 5);
  return track(tex);
}
