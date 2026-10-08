/**
 * 融天气象 - 高原多源时空融合气象灾害预警平台
 * 全局命名空间 (window.MR)
 *
 * 前端采用「经典 script + IIFE + 全局命名空间」的零构建方案，
 * index.html 末尾的 <script> 顺序即依赖顺序。不使用 ES Module：
 * 模块脚本在 file:// 下会因 CORS 全白屏，现场双击 index.html 的风险不值得承担。
 */
window.MR = window.MR || {};

window.MR.flags = {
  /**
   * 严格数据模式（红线开关）。
   * true：任何接口未返回 'ok' 时，页面只渲染状态块，不渲染任何数字。
   * false：仅用于排查前端渲染问题，正式交付必须保持 true。
   */
  strictData: true,
};

/**
 * 极简事件总线。
 * 用于 store → 图表模块的单向通知（如"当前县域变了，重画地图描边"），
 * 避免图表模块反向依赖 store 的内部实现细节。
 */
window.MR.bus = (function () {
  var handlers = Object.create(null);
  return {
    on: function (evt, fn) {
      (handlers[evt] = handlers[evt] || []).push(fn);
      return function () {
        handlers[evt] = (handlers[evt] || []).filter(function (f) {
          return f !== fn;
        });
      };
    },
    emit: function (evt, payload) {
      (handlers[evt] || []).slice().forEach(function (fn) {
        try {
          fn(payload);
        } catch (e) {
          console.error("[MR.bus] " + evt + " 处理失败：", e);
        }
      });
    },
  };
})();
