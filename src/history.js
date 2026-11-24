/**
 * 挑战历史 · 游戏内入口（薄封装）
 * ------------------------------------------------------------------
 * 真正的实现在 public/history.js —— 那是 public/ 下的经典脚本，启动器与游戏页
 * 各 <script src="history.js"> 引一次，**两边共用同一份逻辑**，不用像 prefs 那样镜像维护。
 * 这里只做两件事：把它取出来，以及在拿不到时（无 DOM 环境 / 脚本没加载）降级成空操作，
 * 免得 main.js 里到处判空。
 */

/** 取历史模块；没加载到返回 null */
export function historyStore() {
  const g = globalThis;
  const h = g && g.HMZQHistory;
  return h && typeof h.add === 'function' ? h : null;
}

/** 追加一条记录（存不进去就返回 null，不影响对局本身） */
export function pushRecord(rec) {
  const h = historyStore();
  if (!h) return null;
  try {
    return h.add(rec);
  } catch (e) {
    return null;   // 存储配额满 / 隐私模式：不能让写历史把游戏搞崩
  }
}
