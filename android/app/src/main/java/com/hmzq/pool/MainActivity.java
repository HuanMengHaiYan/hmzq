package com.hmzq.pool;

import android.os.Bundle;
import android.view.WindowManager;
import androidx.core.view.WindowCompat;
import androidx.core.view.WindowInsetsCompat;
import androidx.core.view.WindowInsetsControllerCompat;
import com.getcapacitor.BridgeActivity;

/**
 * 幻梦桌球 · Android 壳
 * ------------------------------------------------------------------
 * 界面完全由 web 那套负责（触摸分支 → 与手机浏览器一致的移动端布局），
 * 这里只补三件 web 做不到、又必须有的事：
 *   ① 游戏全程亮屏（FLAG_KEEP_SCREEN_ON —— 不需要任何权限）
 *   ② 全屏沉浸：隐藏状态栏 / 导航条，把整块屏幕都给台面
 *      （从屏幕边缘划一下仍能临时调出来，不会锁死）
 *   ③ 返回键交给 web 处理（见 src/android.js），由它决定是回上一级还是退出
 */
public class MainActivity extends BridgeActivity {

    @Override
    public void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
        hideSystemBars();
    }

    @Override
    public void onWindowFocusChanged(boolean hasFocus) {
        super.onWindowFocusChanged(hasFocus);
        // 从后台切回来、或手势划出过导航条之后系统栏会自己冒出来 —— 每次拿到焦点都再藏一次
        if (hasFocus) hideSystemBars();
    }

    private void hideSystemBars() {
        WindowCompat.setDecorFitsSystemWindows(getWindow(), false);
        WindowInsetsControllerCompat c =
            WindowCompat.getInsetsController(getWindow(), getWindow().getDecorView());
        if (c == null) return;
        c.hide(WindowInsetsCompat.Type.systemBars());
        c.setSystemBarsBehavior(
            WindowInsetsControllerCompat.BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE);
    }
}
