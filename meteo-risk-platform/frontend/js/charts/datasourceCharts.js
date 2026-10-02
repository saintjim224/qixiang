/**
 * 数据底座页图表：数据源时间覆盖甘特图 + 样本事实边界图。
 *
 * 这一页此前是"0 图"，全靠文字墙陈述数据来源。改成两图之后，
 * "我们用了多长的时间序列"和"正例/未标注/真值各有多少"一眼可读。
 *
 * 甘特图的年份区间**从 /api/datasource/provenance 的 range 字符串解析**，
 * 不在前端另写一份常量表——否则接口改了范围，图还是旧的。
 */
(function (MR) {
  "use strict";

  var store = MR.store;
  var viz = function () { return MR.tokens.viz; };

  function yearRange(text) {
    var m = String(text || "").match(/(\d{4})\s*[-–~至]\s*(\d{4})/);
    if (m) return [Number(m[1]), Number(m[2])];
    var single = String(text || "").match(/(\d{4})/);
    if (single) return [Number(single[1]), Number(single[1])];
    return null;
  }

  function renderSourceGantt() {
    var dom = document.getElementById("chartSourceGantt");
    if (!dom) return;
    var chart = MR.charts.acquire("sourceGantt", dom);
    if (!chart) return;

    var tiers = store.dataTiers.value || [];
    var tierA = tiers.filter(function (t) {
      return String(t.tier_name || "").indexOf("公开科学观测") >= 0;
    })[0];

    if (!tierA || !tierA.data_sources || !tierA.data_sources.length) {
      chart.clear();
      chart.setOption({ title: MR.theme.emptyTitle("数据源清单未返回") });
      return;
    }

    var NOW_YEAR = new Date().getFullYear();
    var items = [];
    tierA.data_sources.forEach(function (s) {
      var range = yearRange(s.range);
      if (!range) return;
      items.push({ name: s.name, from: range[0], to: range[1], raw: s });
    });
    if (!items.length) {
      chart.clear();
      chart.setOption({ title: MR.theme.emptyTitle("数据源年份区间无法解析") });
      return;
    }

    // 前瞻类数据源（Open-Meteo 0-16 天）的 range 里没有年份对，会落到单年分支，
    // 这里把它显式拉到"当前年 → 当前年"并单独标注，不与历史序列混为一谈。
    items.sort(function (a, b) { return a.from - b.from; });

    var minYear = Math.min.apply(null, items.map(function (i) { return i.from; }));
    var maxYear = Math.max(NOW_YEAR, Math.max.apply(null, items.map(function (i) { return i.to; })));

    var names = items.map(function (i) { return i.name; });
    var rows = items.map(function (i, idx) {
      return { value: [idx, i.from, i.to], itemStyle: { color: viz().seq[Math.min(idx, viz().seq.length - 1)] } };
    });

    chart.setOption(
      {
        tooltip: {
          trigger: "item",
          formatter: function (p) {
            var it = items[p.value[0]];
            return MR.theme.tipTitle(it.name) + "<br/>覆盖区间: " + it.from + " – " + it.to +
              "<br/>记录: " + (it.raw.records || "—") + "<br/>要素: " + (it.raw.fields || "—");
          },
        },
        grid: MR.theme.grid({ top: 16, bottom: 34, left: 168, right: 26 }),
        xAxis: {
          type: "value", min: minYear - 1, max: maxYear + 1,
          axisLabel: { color: viz().textMuted, fontSize: 10, formatter: "{value}" },
          splitLine: { lineStyle: { color: viz().grid } },
          axisLine: { show: false },
        },
        yAxis: {
          type: "category", data: names, inverse: true,
          axisLabel: { color: viz().textMuted, fontSize: 11 },
          axisLine: { lineStyle: { color: viz().axis } },
          axisTick: { show: false },
        },
        series: [
          {
            // 用 custom 画"从 A 年横跨到 B 年"的条，而不是 bar（bar 只能从 0 起）
            type: "custom",
            renderItem: function (params, api) {
              var idx = api.value(0);
              var start = api.coord([api.value(1), idx]);
              var end = api.coord([api.value(2), idx]);
              var h = api.size([0, 1])[1] * 0.45;
              return {
                type: "rect",
                shape: {
                  x: start[0],
                  y: start[1] - h / 2,
                  width: Math.max(2, end[0] - start[0]),
                  height: h,
                  r: 3,
                },
                style: api.style(),
              };
            },
            encode: { x: [1, 2], y: 0 },
            data: rows,
          },
        ],
      },
      true
    );
  }

  function renderSampleBoundary() {
    var dom = document.getElementById("chartSampleBoundary");
    if (!dom) return;
    var chart = MR.charts.acquire("sampleBoundary", dom);
    if (!chart) return;

    var verified = store.verifiedStats.value || {};
    var nppB = store.nppBenchmark.value;
    var nObs = nppB && nppB.loyo_protocol ? nppB.loyo_protocol.n_samples : null;

    if (verified.totalVerified === null || verified.totalVerified === undefined) {
      chart.clear();
      chart.setOption({ title: MR.theme.emptyTitle("样本事实边界未返回") });
      return;
    }

    var data = [
      { name: "官方确证正例", value: verified.totalVerified, itemStyle: { color: viz().seq[0] } },
      { name: "未标注背景样本", value: verified.totalUnlabeled, itemStyle: { color: viz().neutral } },
    ];
    if (nObs) data.push({ name: "MODIS NPP 纯观测真值", value: nObs, itemStyle: { color: viz().seq[1] } });

    chart.setOption(
      {
        tooltip: {
          trigger: "item",
          formatter: function (p) {
            return MR.theme.tipTitle(p.name) + "<br/>样本量: <strong>" + p.value + "</strong> 条" +
              '<br/><span style="color:' + viz().textMuted + '">占比 ' + p.percent + "%</span>";
          },
        },
        legend: {
          bottom: 0, left: "center", icon: "circle",
          textStyle: { color: viz().textMuted, fontSize: 11 },
        },
        series: [
          {
            type: "pie",
            radius: ["48%", "72%"],
            center: ["50%", "44%"],
            avoidLabelOverlap: true,
            itemStyle: { borderColor: viz().surface, borderWidth: 2 },
            label: {
              show: true, color: viz().textMain, fontSize: 11,
              formatter: "{b}\n{c} 条",
            },
            labelLine: { lineStyle: { color: viz().axis } },
            data: data,
          },
        ],
      },
      true
    );
  }

  store.registerRenderer("datasource", function () {
    renderSourceGantt();
    renderSampleBoundary();
  });

  MR.charts.datasourceCharts = {
    renderSourceGantt: renderSourceGantt,
    renderSampleBoundary: renderSampleBoundary,
  };
})(window.MR);
