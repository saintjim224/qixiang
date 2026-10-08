/**
 * 决策页图表：26 县应急资源投放优先级排序。
 *
 * 唯一数值轴 = 综合风险分（连续量，决定排序）；颜色 = 补饲档位（状态，决定要不要动手）。
 * 两者职责不重叠，故不构成双轴，也不让颜色去承担名次信息。
 * 图例由页面 HTML 的 .status-legend 提供，色块取自 --viz-status-*，与条形颜色同源。
 */
(function (MR) {
  "use strict";

  var store = MR.store;
  var viz = function () { return MR.tokens.viz; };

  function renderPriority() {
    var dom = document.getElementById("chartPriorityRank");
    if (!dom) return;
    var chart = MR.charts.acquire("priorityRank", dom);
    if (!chart) return;

    var d = store.priorityRanking.value;
    if (!d || !d.counties) {
      chart.clear();
      chart.setOption({ title: MR.theme.emptyTitle("资源投放优先级未返回") });
      return;
    }

    var rows = d.counties.filter(function (r) {
      return r.risk_score !== null && r.risk_score !== undefined;
    });

    if (!rows.length) {
      chart.clear();
      chart.setOption({ title: MR.theme.emptyTitle("全域尚无可比综合风险分") });
      return;
    }

    // ECharts 类目轴自下而上绘制，升序入参才能让风险最高的县落在最上方
    var ordered = rows.slice().sort(function (a, b) { return a.risk_score - b.risk_score; });
    var names = ordered.map(function (r) {
      return String(r.name_cn).replace(/^.+?市|^.+?州|^.+?地区/, "");
    });

    chart.setOption(
      {
        backgroundColor: "transparent",
        grid: MR.theme.grid({ top: 12, bottom: 34, left: 84, right: 30 }),
        tooltip: {
          trigger: "item",
          formatter: function (p) {
            var r = ordered[p.dataIndex];
            return [
              MR.theme.tipTitle(r.name_cn),
              "综合风险分：" + r.risk_score,
              "补饲档位：" + r.feed_mode,
              "窗口均温：" + r.mean_temp_c + " ℃ ／ 平均积雪：" + r.mean_snow_depth_cm + " cm",
              "干草需求：" + r.hay_tons + " 吨 ／ 建议信贷：" + r.credit_quota_wan + " 万元",
            ].join("<br/>");
          },
        },
        xAxis: {
          type: "value",
          name: "综合风险分",
          nameLocation: "middle",
          nameGap: 26,
          nameTextStyle: { color: viz().textMuted, fontSize: 11 },
          axisLine: { lineStyle: { color: viz().axis } },
          axisLabel: { color: viz().textMuted, fontSize: 11 },
          splitLine: { lineStyle: { color: viz().grid } },
        },
        yAxis: {
          type: "category", data: names,
          axisLine: { lineStyle: { color: viz().axis } },
          axisTick: { show: false },
          axisLabel: { color: viz().textMuted, fontSize: 11 },
        },
        series: [
          {
            type: "bar", name: "综合风险分", barWidth: 9,
            itemStyle: { borderRadius: [0, 4, 4, 0] },
            data: ordered.map(function (r) {
              return { value: r.risk_score, itemStyle: { color: MR.tokens.feedModeColor(r.feed_mode) } };
            }),
          },
        ],
      },
      true
    );
  }

  store.registerRenderer("decision", function () {
    renderPriority();
  });

  MR.charts.decisionCharts = { renderPriority: renderPriority };
})(window.MR);
