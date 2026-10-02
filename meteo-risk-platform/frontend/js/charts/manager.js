/**
 * 图表实例注册表。
 *
 * 旧实现把 9 个 ECharts 实例散落成 setup() 里 9 个 let 变量，resize 时逐个点名；
 * 新增一张图就要改三处。这里改为按名字注册，resize / dispose 统一遍历。
 *
 * 隐藏页签里的容器尺寸为 0，ECharts 初始化后画不出东西，因此切页时必须 resize。
 */
(function (MR) {
  "use strict";

  var registry = Object.create(null);
  var resizeBound = false;

  function acquire(name, dom, opts) {
    if (!dom) return null;
    if (registry[name]) {
      // 容器可能被 v-if 重建过，实例挂在旧节点上 → 比对后重建
      if (registry[name].getDom() === dom) return registry[name];
      registry[name].dispose();
      delete registry[name];
    }
    registry[name] = MR.theme.init(dom, opts);
    return registry[name];
  }

  function get(name) {
    return registry[name] || null;
  }

  function withChart(name, dom, fn) {
    var chart = acquire(name, dom);
    if (chart) fn(chart);
    return chart;
  }

  function resizeAll() {
    Object.keys(registry).forEach(function (k) {
      try {
        registry[k].resize();
      } catch (e) {
        /* 容器已从文档移除，忽略 */
      }
    });
  }

  function disposeAll() {
    Object.keys(registry).forEach(function (k) {
      try {
        registry[k].dispose();
      } catch (e) {
        /* 忽略 */
      }
      delete registry[k];
    });
  }

  /** 只 resize 与某个页签相关的图，避免切页时全量重算 */
  function resizeOf(names) {
    names.forEach(function (n) {
      var c = registry[n];
      if (!c) return;
      try {
        c.resize();
      } catch (e) {
        /* 忽略 */
      }
    });
  }

  function bindWindowResize() {
    if (resizeBound) return;
    resizeBound = true;
    var raf = 0;
    window.addEventListener("resize", function () {
      if (raf) cancelAnimationFrame(raf);
      raf = requestAnimationFrame(function () {
        raf = 0;
        resizeAll();
      });
    });
  }

  MR.charts = {
    acquire: acquire,
    get: get,
    withChart: withChart,
    resizeAll: resizeAll,
    resizeOf: resizeOf,
    disposeAll: disposeAll,
    bindWindowResize: bindWindowResize,
    names: function () {
      return Object.keys(registry);
    },
  };
})(window.MR);
