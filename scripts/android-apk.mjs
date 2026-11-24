/**
 * Android APK 构建（Windows）
 * ------------------------------------------------------------------
 * 用法: node scripts/android-apk.mjs [debug]
 *      npm run android:apk          → release
 *      npm run android:apk:debug    → debug
 *
 * 为什么用 Node 而不是 build.bat：
 *   .bat 里的**中文注释**会被 cmd 按当前代码页（GBK）解析，而文件本身是 UTF-8，
 *   于是整段乱码、被当成命令逐行执行 —— 实测现象是一屏 "不是内部或外部命令"，
 *   而 `npx cap copy` 却**成功跑完了**，最后 gradle 那一步静默没执行。
 *   这种"半成功"最难排查：assets 是新的，APK 却是旧的。
 *   用 Node 拼环境变量 + 直接 spawn，编码完全在掌控内。
 *
 * 它会先做 cap copy 再 gradle —— 忘了同步会打出"界面跟改动对不上"的包，
 * 而症状很难联想到是漏了一步同步。
 */
import { spawn } from 'node:child_process';
import { existsSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';

const TOOLS = process.env.ANDROID_TOOLS || 'E:/android-tools';
const JAVA_HOME = process.env.JAVA_HOME || join(TOOLS, 'jdk17');
const SDK = process.env.ANDROID_HOME || join(TOOLS, 'sdk');
const GRADLE_HOME = process.env.GRADLE_USER_HOME || join(TOOLS, 'gradle-home');
const GRADLE = join(TOOLS, 'gradle-dist', 'gradle-8.2.1', 'bin', 'gradle.bat');

const isDebug = process.argv.slice(2).includes('debug');
const TASK = isDebug ? 'assembleDebug' : 'assembleRelease';
const ANDROID_DIR = resolve('android');

for (const [label, p] of [['JDK', JAVA_HOME], ['Android SDK', SDK], ['gradle', GRADLE]]) {
  if (!existsSync(p)) {
    console.error(`✗ 找不到 ${label}：${p}\n  用环境变量覆盖（ANDROID_TOOLS / JAVA_HOME / ANDROID_HOME）`);
    process.exit(1);
  }
}
if (!isDebug && !existsSync(join(ANDROID_DIR, 'keystore.properties'))) {
  console.error('✗ 缺少 android/keystore.properties —— release 包没法签名（装了也白装）');
  process.exit(1);
}

/** 跑一条命令并把输出接到当前终端；失败即退出 */
function run(cmd, args, cwd) {
  return new Promise((res, rej) => {
    const p = spawn(cmd, args, {
      cwd,
      stdio: 'inherit',
      shell: process.platform === 'win32',
      env: {
        ...process.env,
        JAVA_HOME,
        ANDROID_HOME: SDK,
        ANDROID_SDK_ROOT: SDK,
        GRADLE_USER_HOME: GRADLE_HOME,
      },
    });
    p.on('close', (code) => (code === 0 ? res() : rej(new Error(`${cmd} 退出码 ${code}`))));
    p.on('error', rej);
  });
}

console.log('[1/2] 同步 dist → android 工程（cap copy）…');
await run('npx', ['cap', 'copy', 'android'], process.cwd());

console.log(`[2/2] gradle ${TASK} …`);
await run(GRADLE, ['--console=plain', '-p', ANDROID_DIR, TASK], process.cwd());

const apk = join(
  ANDROID_DIR, 'app', 'build', 'outputs', 'apk',
  isDebug ? 'debug' : 'release',
  isDebug ? 'app-debug.apk' : 'app-release.apk'
);
if (!existsSync(apk)) {
  console.error(`✗ gradle 说成功了，但没找到 APK：${apk}`);
  process.exit(1);
}
const mb = (statSync(apk).size / 1024 / 1024).toFixed(1);
console.log(`\n✓ 打包完成：${apk}  (${mb} MB)`);
console.log('  装机前可跑：node scripts/check-apk.mjs   验签名 + 验包里的 index.html 是新的');
