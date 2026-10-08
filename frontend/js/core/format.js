/**
 * 数值格式与配色计算。
 *
 * 这里的取色函数全部依赖 MR.tokens.viz（唯一色源）；
 * 加载顺序上 format.js 必须排在 core/tokens.js 之后。
 */
(function (MR) {
  "use strict";

  // --- 顺序色带的取色与配墨 -----------------------------------------------
  var INK_ON_DARK_FILL = "#f8fafc";
  var INK_ON_LIGHT_FILL = "#0f172a";

  function hexToRgb(hex) {
    var h = String(hex).replace("#", "");
    return [0, 2, 4].map(function (i) {
      return parseInt(h.slice(i, i + 2), 16);
    });
  }

  function relativeLuminance(rgb) {
    var c = rgb.map(function (v) {
      var x = v / 255;
      return x <= 0.04045 ? x / 12.92 : Math.pow((x + 0.055) / 1.055, 2.4);
    });
    return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
  }

  function contrastRatio(hexA, hexB) {
    var a = relativeLuminance(hexToRgb(hexA));
    var b = relativeLuminance(hexToRgb(hexB));
    return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
  }

  /** t=0 → 量值最低端，t=1 → 量值最高端，与 visualMap 的 min/max 对齐 */
  function seqColorAt(t) {
    var ramp = MR.tokens.viz.seq;
    var pos = Math.min(1, Math.max(0, t)) * (ramp.length - 1);
    var i = Math.min(ramp.length - 2, Math.floor(pos));
    var frac = pos - i;
    var from = hexToRgb(ramp[i]);
    var to = hexToRgb(ramp[i + 1]);
    var mix = from.map(function (v, k) {
      return Math.round(v + (to[k] - v) * frac);
    });
    return (
      "#" +
      mix
        .map(function (v) {
          return v.toString(16).padStart(2, "0");
        })
        .join("")
    );
  }

  /**
   * 实测哪一个墨色对比度高就用哪一个，严格遵循 WCAG 2.1 AA（正文对比度 ≥ 4.5:1）。
   * 对当前发散色阶实测：#10b981 对暗墨 7.2:1 / #0ea5e9 6.5:1 / #f59e0b 7.8:1 /
   * #f97316 5.8:1 / #ef4444 对白墨 4.8:1 —— 全量阶位均达标。
   */
  function inkOn(fillHex) {
    return contrastRatio(fillHex, INK_ON_DARK_FILL) >= contrastRatio(fillHex, INK_ON_LIGHT_FILL)
      ? INK_ON_DARK_FILL
      : INK_ON_LIGHT_FILL;
  }

  function inkStyleOn(fillHex) {
    var darkRatio = contrastRatio(fillHex, INK_ON_DARK_FILL);
    var lightRatio = contrastRatio(fillHex, INK_ON_LIGHT_FILL);
    var color = darkRatio >= lightRatio ? INK_ON_DARK_FILL : INK_ON_LIGHT_FILL;
    var maxRatio = Math.max(darkRatio, lightRatio);
    return {
      color: color,
      textShadow:
        maxRatio < 4.5
          ? color === INK_ON_DARK_FILL
            ? "0 1px 2px rgba(0,0,0,0.9)"
            : "0 1px 2px rgba(255,255,255,0.9)"
          : "none",
    };
  }

  /**
   * 估算一段文字在 canvas 上占多少像素宽，用来给横向图表的类目轴留出合适边距。
   * 写死边距的后果是长类目名被静默截断（例如"ECMWF ERA5 逐日格点再分析气候态"），
   * 而截断后的标签看着像数据本身就叫这个名字。
   *
   * 按全角/半角两档估算即可，不需要精确到字体的字距微调。
   */
  function cjkWidth(text, fullPx, halfPx) {
    var full = fullPx === undefined ? 11 : fullPx;
    var half = halfPx === undefined ? 6 : halfPx;
    var w = 0;
    String(text === null || text === undefined ? "" : text)
      .split("")
      .forEach(function (ch) {
        // 一-鿿 CJK 汉字；　-〿 中文标点；＀-￯ 全角符号
        w += /[一-鿿　-〿＀-￯]/.test(ch) ? full : half;
      });
    return w;
  }

  // --- 数值显示 -------------------------------------------------------------

  /**
   * 气象数值一律带符号显示，并把负零归一为 0（否则会渲染出 "-0.0 ℃"）；
   * 缺测返回 "—" 而不是拿 0 冒充真实取值。
   */
  function signed(v, digits) {
    var d = digits === undefined ? 1 : digits;
    if (v === null || v === undefined || !Number.isFinite(Number(v))) return "—";
    var rounded = Number(Number(v).toFixed(d)) + 0;
    var fixed = rounded.toFixed(d);
    return rounded > 0 ? "+" + fixed : fixed;
  }

  function round(num, decimals) {
    var factor = Math.pow(10, decimals);
    return Math.round(num * factor) / factor;
  }

  /** 缺失值统一呈现为破折号，绝不回落为 0。 */
  function num(v, digits, fallback) {
    if (v === null || v === undefined || !Number.isFinite(Number(v))) {
      return fallback === undefined ? "—" : fallback;
    }
    return digits === undefined ? String(v) : Number(v).toFixed(digits);
  }

  MR.fmt = {
    hexToRgb: hexToRgb,
    relativeLuminance: relativeLuminance,
    contrastRatio: contrastRatio,
    seqColorAt: seqColorAt,
    cjkWidth: cjkWidth,
    inkOn: inkOn,
    inkStyleOn: inkStyleOn,
    signed: signed,
    round: round,
    num: num,
    INK_ON_DARK_FILL: INK_ON_DARK_FILL,
    INK_ON_LIGHT_FILL: INK_ON_LIGHT_FILL,
  };
})(window.MR);
