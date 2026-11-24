/**
 * 游戏内「画质」面板
 * ------------------------------------------------------------------
 * 选项表来自 quality.js，这里只负责把表变成 DOM、把点击变成 quality.set()。
 * 生成 DOM 而不是写死在 index.html：以后加一个画质项只要往表里加一行，
 * HTML 与 CSS 都不用动（启动器那边有一份镜像实现，见 public/launcher-quality.js）。
 * `customOnly` 的三行（阴影精度 / 渲染分辨率 / 纹理细节）只在档位 = 自定义 时显示。
 */
import { host } from './platform/index.js';
import { QUALITY_ITEMS, describeQuality } from './quality.js';

/**
 * @param quality Quality 实例
 * @param boxId   容器 id（默认 #quality-rows）
 * @returns {{ sync: Function } | null} 无 DOM 环境返回 null
 */
export function mountQualityUI(quality, boxId = 'quality-rows') {
  if (!host.hasDOM) return null;
  const box = host.byId(boxId);
  if (!box) return null;
  const doc = box.ownerDocument;
  const now = host.byId('q-now');
  const rows = [];

  for (const item of QUALITY_ITEMS) {
    const row = doc.createElement('div');
    row.className = 'settings-row';

    const label = doc.createElement('label');
    label.textContent = item.name;
    row.appendChild(label);

    const grid = doc.createElement('div');
    grid.className = 'mode-grid q-grid';
    const btns = new Map();
    for (const opt of item.options) {
      const b = doc.createElement('button');
      b.type = 'button';
      b.textContent = opt.name;
      grid.appendChild(b);
      btns.set(opt.id, b);
    }
    row.appendChild(grid);

    const hint = doc.createElement('p');
    hint.className = 'hint';
    row.appendChild(hint);

    box.appendChild(row);
    rows.push({ item, row, btns, hint });

    host.on(grid, 'click', (e) => {
      const btn = e.target.closest('button');
      if (!btn) return;
      const val = [...btns.entries()].find(([, el]) => el === btn)?.[0];
      if (!val) return;
      // 动细分项时 Quality.set 会把档位落成 custom（见 quality.js）
      quality.set({ [item.id]: val });
      sync();
    });
  }

  function sync() {
    const prefs = quality.prefs;
    for (const { item, row, btns, hint } of rows) {
      // 细分项只在「自定义」档露出；其余档位整行收掉（⚠️ 必须用 hidden 之外的样式兜住：
      // .settings-row 是 flex 容器，[hidden] 那条规则要显式写 display:none，见 style.css）
      if (item.customOnly) row.hidden = prefs.preset !== 'custom';
      for (const [id, btn] of btns) btn.classList.toggle('active', prefs[item.id] === id);
      hint.textContent = item.hints[prefs[item.id]] || '';
    }
    if (now) now.textContent = describeQuality(quality.resolved);
  }

  sync();
  return { sync };
}
