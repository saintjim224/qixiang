/**
 * ECharts 主题工厂。
 *
 * 此前 9 张图各自重复声明 axisLabel 颜色（18 处）、splitLine（10 处）、
 * tooltip（10 处）、grid（9 处），改一处字号要翻九个地方。
 * 现在统一注册名为 'mr' 的主题，并用 MR.theme.* 提供常用片段。
 */
(function (MR) {
  "use strict";

  function viz() {
    return MR.tokens.viz;
  }

  function buildTheme() {
    var v = viz();
    return {
      color: [v.down, v.up, v.seq[1], v.seq[2], v.seq[3], v.neutral],
      backgroundColor: "transparent",
      textStyle: {
        color: v.textMuted,
        fontFamily:
          '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "PingFang SC", "Microsoft YaHei", sans-serif',
        fontSize: 11,
      },
      title: {
        textStyle: { color: v.textMuted, fontSize: 12, fontWeight: 400, lineHeight: 18 },
        subtextStyle: { color: v.textMuted, fontSize: 11 },
      },
      legend: {
        textStyle: { color: v.textMuted, fontSize: 11 },
        itemWidth: 12,
        itemHeight: 8,
        icon: "roundRect",
      },
      tooltip: {
        backgroundColor: "rgba(13, 20, 34, 0.96)",
        borderColor: "rgba(255, 255, 255, 0.14)",
        borderWidth: 1,
        textStyle: { color: v.textMain, fontSize: 12 },
        axisPointer: {
          lineStyle: { color: "rgba(241, 245, 249, 0.25)" },
        },
      },
      categoryAxis: {
        axisLine: { lineStyle: { color: v.axis } },
        axisTick: { show: false },
        axisLabel: { color: v.textMuted, fontSize: 10 },
        splitLine: { show: false },
      },
      valueAxis: {
        axisLine: { show: false },
        axisTick: { show: false },
        axisLabel: { color: v.textMuted, fontSize: 10 },
        splitLine: { lineStyle: { color: v.grid } },
      },
    };
  }

  var registered = false;

  function register() {
    if (registered) return;
    echarts.registerTheme("mr", buildTheme());
    registered = true;
  }

  /** 统一入口：所有图表都经由它初始化，确保主题一致且实例可被 manager 托管。 */
  function init(dom, opts) {
    register();
    return echarts.init(dom, "mr", Object.assign({ renderer: "canvas" }, opts || {}));
  }

  MR.theme = {
    register: register,
    init: init,
    build: buildTheme,

    /** 统一 grid：只覆写需要微调的边距 */
    grid: function (over) {
      return Object.assign({ top: 26, left: 52, right: 20, bottom: 30, containLabel: false }, over || {});
    },

    /** 坐标轴名称样式（name 默认颜色过于抢眼，统一压暗） */
    axisName: function (text, over) {
      return Object.assign(
        {
          name: text,
          nameTextStyle: { color: viz().textMuted, fontSize: 10, align: "left" },
          nameGap: 12,
        },
        over || {}
      );
    },

    /** 数字轴刻度格式化：统一交给 MR.fmt */
    valueFormatter: function (v) {
      return v === null || v === undefined ? "—" : String(v);
    },

    /** 把 HTML 片段包成 tooltip 的标题行 */
    tipTitle: function (text) {
      return "<strong>" + text + "</strong>";
    },

    /** 空数据态标题：所有图表共用同一句披露，避免各写各的措辞 */
    emptyTitle: function (extra) {
      return {
        text:
          (extra ? extra + "\n" : "") +
          "数据暂不可用\n请检查数据连接后重试",
        left: "center",
        top: "middle",
        textStyle: { color: viz().textMuted, fontSize: 12, lineHeight: 18 },
      };
    },
  };
})(window.MR);
