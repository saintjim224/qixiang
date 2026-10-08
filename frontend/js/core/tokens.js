/**
 * 设计令牌桥 —— 把 css/main.css 的 :root 变量读进 JS。
 *
 * ECharts 绘制到 canvas，无法解析 CSS 变量，因此必须在启动时把变量值读出来。
 * 此前 app.js 顶部手工镜像了一份 const VIZ，与 CSS 双写；改色要改两处，迟早对不上。
 * 现在 CSS 是唯一色源，本文件只负责搬运。
 */
(function (MR) {
  "use strict";

  /**
   * 唯一一份兜底色表。
   * 仅在 CSS 变量读取失败（样式表未加载 / 被覆盖）时启用。
   * 颜色不是业务数据，可以兜底；但全站只此一处，不再与 main.css 双写。
   */
  var FALLBACK = {
    surface: "#0d1422",
    grid: "rgba(255, 255, 255, 0.06)",
    axis: "rgba(255, 255, 255, 0.14)",
    "seq-1": "#10b981",
    "seq-2": "#0ea5e9",
    "seq-3": "#f59e0b",
    "seq-4": "#f97316",
    "seq-5": "#ef4444",
    up: "#ef4444",
    down: "#10b981",
    context: "rgba(148, 163, 184, 0.32)",
    focus: "#f1f5f9",
    accent: "#f8fafc",
    "neutral-series": "#7f8ea3",
    "text-main": "#f1f5f9",
    "text-muted": "#94a3b8",
    "status-calm": "#10b981",
    "status-light": "#f59e0b",
    "status-half": "#f97316",
    "status-full": "#ef4444",
  };

  var missing = [];

  function read(key) {
    var raw = "";
    try {
      raw = getComputedStyle(document.documentElement)
        .getPropertyValue("--viz-" + key)
        .trim();
    } catch (e) {
      raw = "";
    }
    if (!raw) {
      missing.push(key);
      return FALLBACK[key];
    }
    return raw;
  }

  var viz = {
    surface: read("surface"),
    grid: read("grid"),
    axis: read("axis"),
    // 单色顺序带：低值 → 高值。ECharts visualMap 的 color[0] 对应 min。
    seq: [read("seq-1"), read("seq-2"), read("seq-3"), read("seq-4"), read("seq-5")],
    up: read("up"),
    down: read("down"),
    context: read("context"),
    focus: read("focus"),
    accent: read("accent"),
    neutral: read("neutral-series"),
    textMain: read("text-main"),
    textMuted: read("text-muted"),
    status: {
      calm: read("status-calm"),
      light: read("status-light"),
      half: read("status-half"),
      full: read("status-full"),
    },
  };

  /**
   * 补饲档位文案 → 状态色。
   * 按关键词匹配，后端文案微调（如"轻度补充防寒"→"轻度补充"）不会掉色。
   */
  function feedModeColor(mode) {
    var m = String(mode || "");
    if (m.indexOf("重度") >= 0 || m.indexOf("全人工") >= 0) return viz.status.full;
    if (m.indexOf("半补饲") >= 0) return viz.status.half;
    if (m.indexOf("轻度") >= 0 || m.indexOf("补充") >= 0) return viz.status.light;
    return viz.status.calm;
  }

  MR.tokens = {
    viz: viz,
    FALLBACK: FALLBACK,
    feedModeColor: feedModeColor,
    /** 自检：返回读不到、被迫走兜底的令牌名。空数组表示令牌链路完整。 */
    audit: function () {
      return missing.slice();
    },
  };

  if (missing.length) {
    console.error(
      "[MR.tokens] 以下 CSS 令牌读取失败，已回落到兜底色：",
      missing.join(", "),
      "（这意味着 main.css 未加载或变量名被改动）"
    );
  }
})(window.MR);
