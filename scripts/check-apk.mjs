/**
 * APK 交付前核验
 * ------------------------------------------------------------------
 * 用法: node scripts/check-apk.mjs [debug]
 *
 * 查两件肉眼看不出来的事：
 *   1. **签名有效**（无效签名的 APK 装不上，但文件看上去一切正常）
 *   2. **包里那份 index.html 就是刚构建的 dist**（有过一次"APK 里是旧 bundle"的事故，
 *      症状是"界面跟这轮的改动对不上"，极难联想到是没同步）
 *
 * 读 zip 用 Windows 自带的 bsdtar（Git Bash 里没有 unzip；tar.exe -tf 能列 zip 条目）。
 */
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync, mkdtempSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { createHash } from 'node:crypto';

const isDebug = process.argv.slice(2).includes('debug');
const TAG = isDebug ? 'debug' : 'release';
const APK = resolve('android/app/build/outputs/apk', TAG, isDebug ? 'app-debug.apk' : 'app-release.apk');
const TAR = 'C:/Windows/system32/tar.exe';
const TOOLS = process.env.ANDROID_TOOLS || 'E:/android-tools';
const JAVA_HOME = process.env.JAVA_HOME || join(TOOLS, 'jdk17');

if (!existsSync(APK)) {
  console.error(`✗ 找不到 APK：${APK}\n  先 npm run android:apk`);
  process.exit(1);
}
if (!existsSync(TAR)) {
  console.error(`✗ 找不到 ${TAR}（读 zip 用）`);
  process.exit(1);
}

let bad = 0;

// ---- 1. 签名 ----
if (isDebug) {
  console.log('· debug 包不验签名（用的是 debug key）');
} else {
  const apksigner = join(TOOLS, 'sdk', 'build-tools', '34.0.0', 'apksigner.bat');
  if (!existsSync(apksigner)) {
    console.log(`? 找不到 apksigner（${apksigner}），跳过签名校验`);
  } else {
    // --verbose 才会有 "Verifies" / "Verified using vN scheme" 这几行；
    // 不加只会静默退出（成功时不打印任何东西），判定不出"有效"还是"没跑起来"。
    const r = spawnSync(apksigner, ['verify', '--verbose', '--print-certs', APK], {
      encoding: 'utf8', shell: true,
      env: { ...process.env, JAVA_HOME },
    });
    const out = (r.stdout || '') + (r.stderr || '');
    // 判定：出现 "Verifies" 且 v2 方案为 true（minSdk 24 起 v2 是硬要求），
    // 同时绝不能出现 DOES NOT VERIFY。
    const ok = /^Verifies\b/m.test(out) &&
      /Verified using v2 scheme.*:\s*true/.test(out) &&
      !/DOES NOT VERIFY/.test(out);
    if (ok) {
      console.log('✓ 签名有效（APK Signature Scheme v2）');
      const who = /Signer #1 certificate DN:\s*(.+)/.exec(out);
      if (who) console.log(`  ${who[1].trim().slice(0, 120)}`);
    } else {
      bad++;
      console.log('✗ 签名校验没通过：');
      console.log(out.split('\n').slice(0, 12).map((l) => '   ' + l).join('\n'));
    }
  }
}

// ---- 2. 包里的 index.html 是不是刚构建的那份 ----
const dir = mkdtempSync(join(tmpdir(), 'hmzq-apk-'));
const ex = spawnSync(TAR, ['-xf', APK, '-C', dir, 'assets/public/index.html'], { encoding: 'utf8' });
const inApk = join(dir, 'assets', 'public', 'index.html');
if (ex.status !== 0 || !existsSync(inApk)) {
  bad++;
  console.log(`✗ 解不出包里的 assets/public/index.html（tar 退出码 ${ex.status}）`);
} else {
  const h = (p) => createHash('sha1').update(readFileSync(p)).digest('hex').slice(0, 12);
  const a = h(inApk), b = h('dist/index.html');
  if (a === b) {
    console.log(`✓ 包里的 index.html 与 dist 一致（sha1 ${a}）`);
  } else {
    bad++;
    console.log(`✗ 包里是旧产物！APK=${a}  dist=${b} —— 重跑 npm run android:apk（它会先 cap copy）`);
  }
  // 这条断言来自 2026-09-19 的 APK 装机故障：内核自检卡把 ES2021 的 ||= 当成硬门槛，
  // 结果 Chrome 83 的 Android WebView 明明能跑，却一进游戏就被自家卡片挡住。
  const html = readFileSync(inApk, 'utf8');
  if (html.includes('!(onDev && devMiss.length)')) {
    console.log('✓ 内核自检卡含修复（ES2020+ 探针不再当硬门槛）');
  } else {
    bad++;
    console.log('✗ 内核自检卡是旧逻辑 —— Chrome 83 WebView 会被自己的卡片挡住（见 index.html 注释）');
  }
}

console.log('');
if (bad) {
  console.log(`===== APK 核验：${bad} 项不合格，先别装机 =====`);
  process.exit(1);
}
console.log('===== APK 核验：通过 =====');
