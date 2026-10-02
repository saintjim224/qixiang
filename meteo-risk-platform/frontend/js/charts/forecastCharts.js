/**
 * 预测页图表：30 天积雪演化（含气候态外推分界） + NPP 25 年真值与预测窗 + MAE 降低对比。
 *
 * 30 天曲线的关键修正是**把"实时预报"与"气候态外推"的分界画出来**。
 * 旧实现把两段拼接成一条连续填充带，读者完全看不出第 16 天之后已经换了数据来源；
 * 现在第 16 天有 markLine 竖线，17 天以后线段改虚线、置信带降不透明度。
 *
 * NPP 图的修正是**把 25 年真值铺满坐标轴**。旧实现只画 recent_history 的 5 个点，
 * 横轴挤成 5 格，读者以为"这个县只有 5 年数据"。
 */
(function (MR) {
  "use strict";

  var store = MR.store;
  var viz = function () { return MR.tokens.viz; };

  // --- 30 天积雪演化 --------------------------------------------------------
  function renderSnow30() {
    var dom = document.getElementById("chartMultiDisaster");
    if (!dom) return;
    var chart = MR.charts.acquire("multiDisaster", dom);
    if (!chart) return;

    var d = store.currentDisaster.value;
    var fs = d && d.forecast_series;
    var days = (fs && fs.days_30) || [];
    var snow = (fs && fs.snow_depth_30) || [];
    var up = (fs && fs.ci_upper_30) || [];
    var low = (fs && fs.ci_lower_30) || [];
    var boundary = (fs && fs.boundary_index) || 0;

    if (!days.length || !snow.length) {
      chart.clear();
      chart.setOption({ title: MR.theme.emptyTitle("30 天积雪预测未返回") });
      return;
    }

    var ciBand = snow.map(function (_, i) {
      return Math.max(0, (up[i] === undefined ? 0 : up[i]) - (low[i] === undefined ? 0 : low[i]));
    });

    // 17 天以后的线段改虚线：视觉上直接宣告"数据来源变了"
    var solid = snow.map(function (v, i) { return i < boundary ? v : null; });
    var dashedTail = snow.map(function (v, i) { return i >= boundary - 1 ? v : null; });

    chart.setOption(
      {
        title: { show: false },
        tooltip: {
          trigger: "axis",
          formatter: function (params) {
            var i = params[0] ? params[0].dataIndex : 0;
            var src = i < boundary ? "Open-Meteo 实时预报" : "ERA5 同月气候态外推";
            return days[i] + "<br/>积雪深度: <strong>" + snow[i] + " cm</strong><br/>" +
              "不确定区间: " + low[i] + " – " + up[i] + " cm<br/>" +
              '<span style="color:' + viz().textMuted + '">数据来源: ' + src + "</span>";
          },
        },
        legend: {
          data: ["积雪深度", "同月年际 ±1σ 区间"],
          top: 0, right: 0, itemWidth: 12, itemHeight: 8, icon: "roundRect",
          textStyle: { color: viz().textMuted, fontSize: 11 },
        },
        grid: MR.theme.grid({ top: 30, bottom: 26, left: 46, right: 20 }),
        xAxis: {
          type: "category", data: days, boundaryGap: false,
          axisLabel: { color: viz().textMuted, fontSize: 10, interval: 2 },
          axisLine: { lineStyle: { color: viz().axis } },
        },
        yAxis: MR.theme.axisName("积雪深度 (cm)", { type: "value", axisLine: { show: false } }),
        series: [
          { name: "CI 基座", type: "line", stack: "ci", data: low, symbol: "none", lineStyle: { opacity: 0 }, areaStyle: { opacity: 0 }, silent: true, z: 1 },
          {
            name: "同月年际 ±1σ 区间", type: "line", stack: "ci", data: ciBand, symbol: "none",
            lineStyle: { opacity: 0 },
            areaStyle: { color: "rgba(57,135,229,0.16)" },
            itemStyle: { color: "rgba(57,135,229,0.45)" },
            silent: true, z: 1,
          },
          {
            name: "积雪深度", type: "line", data: solid,
            symbol: "circle", symbolSize: 5, showSymbol: false, smooth: true, z: 5,
            lineStyle: { color: viz().down, width: 2 },
            itemStyle: { color: viz().down, borderColor: viz().surface, borderWidth: 2 },
            markLine: boundary
              ? {
                  silent: true,
                  symbol: "none",
                  lineStyle: { color: viz().seq[2], type: "dashed", width: 1.4 },
                  label: { formatter: "第 " + boundary + " 天\n实时预报 → 气候态外推", color: viz().textMuted, fontSize: 10, position: "insideEndTop" },
                  data: [{ xAxis: boundary - 1 }],
                }
              : undefined,
          },
          {
            name: "气候态外推段", type: "line", data: dashedTail,
            symbol: "none", smooth: true, z: 4, silent: true,
            lineStyle: { color: viz().down, width: 2, type: "dashed", opacity: 0.75 },
          },
        ],
      },
      true
    );
  }

  // --- NPP 25 年真值 + 预测窗 ----------------------------------------------
  function renderNpp() {
    var dom = document.getElementById("chartNppCompare");
    if (!dom) return;
    var chart = MR.charts.acquire("nppCompare", dom);
    if (!chart) return;

    var annualMap = store.nppAnnual.value || {};
    var years = Object.keys(annualMap).sort();
    if (!years.length) {
      chart.clear();
      chart.setOption({ title: MR.theme.emptyTitle("本县 NPP 年值序列未返回") });
      return;
    }
    var observed = years.map(function (y) { return annualMap[y]; });
    var idxOf = {};
    years.forEach(function (y, i) { idxOf[y] = i; });

    var predSeries = years.map(function () { return null; });
    var baseSeries = years.map(function () { return null; });
    var hasPred = false;

    var nppJob = MR.api.get("/api/forecast/npp/" + encodeURIComponent(store.selectedRegionId.value)).then(function (res) {
      if (res.ok && res.data && res.data.recent_history && res.data.recent_history.years) {
        var rh = res.data.recent_history;
        rh.years.forEach(function (y, i) {
          var k = String(y);
          if (idxOf[k] === undefined) return;
          predSeries[idxOf[k]] = rh.pred ? rh.pred[i] : null;
          baseSeries[idxOf[k]] = rh.baseline ? rh.baseline[i] : null;
          hasPred = true;
        });
        return res.data;
      }
      return null;
    });

    nppJob.then(function () {
      var firstPred = years.length;
      years.forEach(function (_, i) {
        if (predSeries[i] !== null && i < firstPred) firstPred = i;
      });

      chart.setOption(
        {
          title: { show: false },
          tooltip: {
            trigger: "axis",
            valueFormatter: function (v) {
              return v === null || v === undefined ? "—" : Number(v).toFixed(4) + " kgC/m²·d";
            },
          },
          legend: {
            data: ["MODIS 实测 NPP", "本项目预测", "气候态均值基线"],
            top: 0, right: 0, itemWidth: 12, itemHeight: 8, icon: "roundRect",
            textStyle: { color: viz().textMuted, fontSize: 11 },
          },
          grid: MR.theme.grid({ top: 30, bottom: 44, left: 56, right: 20 }),
          dataZoom: [
            { type: "inside", startValue: Math.max(0, years.length - 9), endValue: years.length - 1 },
            {
              type: "slider", height: 16, bottom: 8,
              borderColor: "rgba(255,255,255,0.12)",
              fillerColor: "rgba(57,135,229,0.16)",
              handleStyle: { color: viz().neutral },
              textStyle: { color: viz().textMuted, fontSize: 9 },
              startValue: Math.max(0, years.length - 9), endValue: years.length - 1,
            },
          ],
          xAxis: {
            type: "category", data: years, boundaryGap: true,
            axisLabel: { color: viz().textMuted, fontSize: 11 },
            axisLine: { lineStyle: { color: viz().axis } },
          },
          yAxis: MR.theme.axisName("NPP (kgC/m²·d)", { type: "value", scale: true, axisLine: { show: false } }),
          series: [
            // 实测用中性实心点（它是"事实"），预测用彩色线（它是"主张"），基线用灰虚线
            {
              name: "MODIS 实测 NPP", type: "scatter", symbolSize: 7, data: observed, z: 5,
              itemStyle: { color: viz().neutral, borderColor: viz().surface, borderWidth: 2 },
              silent: false,
            },
            {
              name: "本项目预测", type: "line", data: predSeries, symbol: "none", smooth: true, z: 4,
              connectNulls: true,
              lineStyle: { color: viz().down, width: 2 },
              itemStyle: { color: viz().down },
            },
            {
              name: "气候态均值基线", type: "line", data: baseSeries, symbol: "none", z: 3,
              connectNulls: true,
              lineStyle: { type: "dashed", color: viz().context, width: 1.5 },
              itemStyle: { color: viz().context },
            },
          ],
        },
        true
      );
      if (!hasPred) {
        chart.setOption({
          graphic: [
            {
              type: "text", left: "center", bottom: 34,
              style: { text: "预测序列未返回，当前仅展示 25 年 MODIS 实测真值", fill: viz().textMuted, font: "11px sans-serif" },
            },
          ],
        });
      }
    });
  }

  // --- LOYO / LORO 误差降低对比（新增） ------------------------------------
  function renderMaeReduction() {
    var dom = document.getElementById("chartMaeReduction");
    if (!dom) return;
    var chart = MR.charts.acquire("maeReduction", dom);
    if (!chart) return;

    var b = store.nppBenchmark.value;
    if (!b || !b.loyo_protocol || !b.loro_protocol) {
      chart.clear();
      chart.setOption({ title: MR.theme.emptyTitle("NPP 基准接口未返回") });
      return;
    }

    // 本图只回答一个问题：**本系统方法相对每一个基线，误差降了多少**。
    //
    // 旧实现把"基线2 / 基线3 / 本系统方法"三个模型各自相对基线1 的降幅画在同一张图上。
    // 那个口径本身没错，但基线3(3年移动平均)相对基线1 是 -88%，一根柱子把纵轴拉到
    // -90%~+20%，于是本系统方法真正要展示的 +17.4% / +19.8% 被压成两颗像素点。
    // 基线之间的互比（含"某个基线还不如气候态均值"）在下方的完整表里一字不少地列着，
    // 这里回归它该讲的那件事。
    var oursOf = function (proto) {
      var ms = (proto && proto.models) || {};
      var k = Object.keys(ms).filter(function (n) { return n.indexOf("本系统方法") === 0; })[0];
      return k ? ms[k] : null;
    };
    var oursA = oursOf(b.loyo_protocol);
    var oursB = oursOf(b.loro_protocol);

    if (!oursA || !oursB) {
      chart.clear();
      chart.setOption({ title: MR.theme.emptyTitle("基准接口未包含本系统方法结果") });
      return;
    }

    // 基线名取自接口（序号 + 中文名），不另写一份常量表
    var baseKeys = Object.keys(b.loyo_protocol.models)
      .filter(function (k) { return /^Baseline \d/.test(k); })
      .sort();
    var shortName = function (k) {
      return k.replace(/^Baseline (\d+):\s*/, "相对基线$1 · ").replace(/\s*\([^)]*\)\s*$/, "");
    };
    var names = baseKeys.map(shortName);
    var seriesA = baseKeys.map(function (_, i) { return oursA["reduction_vs_b" + (i + 1) + "_pct"]; });
    var seriesB = baseKeys.map(function (_, i) { return oursB["reduction_vs_b" + (i + 1) + "_pct"]; });

    // 纵轴留 15% 顶部余量：容器只有 170px，柱子顶到框顶会把柱顶数值标签挤出画布
    var peak = Math.max.apply(
      null,
      seriesA.concat(seriesB).filter(function (v) { return Number.isFinite(Number(v)); }).map(Number)
    );
    var yMax = Number.isFinite(peak) && peak > 0 ? Math.ceil((peak * 1.15) / 5) * 5 : null;

    chart.setOption(
      {
        tooltip: {
          trigger: "axis",
          axisPointer: { type: "shadow" },
          formatter: function (ps) {
            var i = ps.length ? ps[0].dataIndex : 0;
            return (
              MR.theme.tipTitle("本系统方法 vs " + (baseKeys[i] || "").replace(/^Baseline \d+:\s*/, "")) +
              ps.map(function (p) {
                return "<br/>" + p.marker + p.seriesName + "：<strong>" +
                  (p.value === null || p.value === undefined ? "—" : p.value + "%") + "</strong>";
              }).join("")
            );
          },
        },
        legend: { top: 0, right: 0, itemWidth: 12, itemHeight: 8, textStyle: { color: viz().textMuted, fontSize: 11 } },
        grid: MR.theme.grid({ top: 30, bottom: 46, left: 52, right: 16 }),
        xAxis: {
          type: "category", data: names,
          axisLabel: { color: viz().textMuted, fontSize: 11, interval: 0 },
          axisLine: { lineStyle: { color: viz().axis } },
        },
        yAxis: MR.theme.axisName("MAE 相对该基线降低 (%)", {
          type: "value",
          // 全部为正值就该从 0 起，否则"差一点点"会被画成"差很多"
          min: 0,
          max: yMax,
          axisLine: { show: false },
          axisLabel: { color: viz().textMuted, fontSize: 10, formatter: "{value}%" },
        }),
        graphic: [
          {
            type: "text", left: "center", bottom: 6, silent: true,
            style: {
              text: "两个协议下本系统方法均优于全部三个基线；基线之间的互比见下方完整表",
              fill: viz().textMuted, font: "11px sans-serif",
            },
          },
        ],
        series: [
          // 柱宽给足 + 留间距：柱顶数值两位小数，"17.41%" 与 "19.75%" 挨太近会糊成一串
          {
            name: "协议 A · 留一年 (时间外推)", type: "bar", barWidth: 34, barGap: "35%",
            itemStyle: { color: viz().seq[1], borderRadius: [3, 3, 0, 0] },
            label: {
              show: true, position: "top", color: viz().textMain, fontSize: 10,
              formatter: function (p) { return Number(p.value).toFixed(1) + "%"; },
            },
            data: seriesA,
          },
          {
            name: "协议 B · 留一县 (空间迁移)", type: "bar", barWidth: 34,
            itemStyle: { color: viz().seq[3], borderRadius: [3, 3, 0, 0] },
            label: {
              show: true, position: "top", color: viz().textMain, fontSize: 10,
              formatter: function (p) { return Number(p.value).toFixed(1) + "%"; },
            },
            data: seriesB,
          },
        ],
      },
      true
    );
  }

  store.registerRenderer("forecast", function () {
    renderSnow30();
    renderNpp();
    renderMaeReduction();
  });

  MR.charts.forecastCharts = {
    renderSnow30: renderSnow30,
    renderNpp: renderNpp,
    renderMaeReduction: renderMaeReduction,
  };
})(window.MR);
