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

    var pick = function (proto) {
      var ms = proto.models || {};
      var out = {};
      Object.keys(ms).forEach(function (k) {
        var short = k.replace(/^Baseline (\d):.*$/, "基线$1").replace(/本系统方法:.*/, "本系统方法");
        out[short] = ms[k].reduction_vs_b1_pct;
      });
      return out;
    };

    var loyo = pick(b.loyo_protocol);
    var loro = pick(b.loro_protocol);
    var names = Object.keys(loyo).filter(function (k) { return k !== "基线1"; });

    chart.setOption(
      {
        tooltip: {
          trigger: "axis",
          axisPointer: { type: "shadow" },
          valueFormatter: function (v) { return v === null || v === undefined ? "—" : v + "%"; },
        },
        legend: { top: 0, right: 0, itemWidth: 12, itemHeight: 8, textStyle: { color: viz().textMuted, fontSize: 11 } },
        grid: MR.theme.grid({ top: 30, bottom: 26, left: 52, right: 16 }),
        xAxis: {
          type: "category", data: names,
          axisLabel: { color: viz().textMuted, fontSize: 11, interval: 0 },
          axisLine: { lineStyle: { color: viz().axis } },
        },
        yAxis: MR.theme.axisName("相对气候态基线 MAE 降低 (%)", {
          type: "value", axisLine: { show: false },
          axisLabel: { color: viz().textMuted, fontSize: 10, formatter: "{value}%" },
        }),
        series: [
          {
            name: "协议 A · 留一年 (时间外推)", type: "bar", barWidth: 18,
            itemStyle: { color: viz().seq[1], borderRadius: [3, 3, 0, 0] },
            data: names.map(function (n) { return loyo[n]; }),
          },
          {
            name: "协议 B · 留一县 (空间迁移)", type: "bar", barWidth: 18,
            itemStyle: { color: viz().seq[3], borderRadius: [3, 3, 0, 0] },
            data: names.map(function (n) { return loro[n]; }),
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
