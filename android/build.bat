@echo off
REM ============================================================
REM  Android release APK build (thin wrapper).
REM
REM  Real logic lives in scripts\android-apk.mjs. Reasons:
REM   1. Chinese comments in a .bat get decoded with the console
REM      codepage (GBK) while the file is UTF-8, so cmd reads
REM      garbage and tries to execute it. The nasty part: it fails
REM      *partially* - "npx cap copy" succeeds, gradle silently
REM      never runs, and you end up with a stale APK.
REM   2. JAVA_HOME / ANDROID_HOME / GRADLE_USER_HOME are then set
REM      in one place instead of three.
REM
REM  Usage: android\build.bat          build release APK
REM         android\build.bat debug    build debug APK
REM         npm run android:apk        same thing
REM ============================================================
setlocal
pushd "%~dp0.."
node scripts\android-apk.mjs %1
set "RC=%ERRORLEVEL%"
popd
exit /b %RC%
