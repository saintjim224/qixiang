/**
 * 风险指数页图表：微网格热力图、SPI/GDI 逐县哑铃对照、SHAP 归因、PU 基线 F1 对比。
 *
 * 本页的 Dominant Anchor 是 **PU 消融矩阵**：读者最该看到的不是"我们算了几个指数"，
 * 而是"把 1373 条未标注当负例会错成什么样、我们怎么修好的"。
 * 因此 SHAP 与 F1 对比柱置顶，热力图次之，SPI/GDI 对照降为两个半宽面板。
 */
(function (MR) {
  "use strict";

  var store = MR.store;
  var viz = function () { return MR.tokens.viz; };

  var SEASONS = ["春季 (春旱/倒春寒)", "夏季 (水热充沛)", "秋季 (早霜降雪)", "冬季 (极端暴雪/严寒)"];
  var SHORT_SEASONS = ["春季", "夏季", "秋季", "冬季"];
  var GRASSLANDS = ["高寒草甸", "高寒草原", "高寒荒漠"];
  var SEASON_IDX = { spring: 0, summer: 1, autumn: 2, winter: 3 };
  var GRASS_IDX = { alpine_meadow: 0, alpine_steppe: 1, alpine_desert: 2 };

  // --- 微网格热力图 ---------------------------------------------------------
  function renderHeatmap() {
    var dom = document.getElementById("chartIndexGridHeatmap");
    if (!dom) return;
    var chart = MR.charts.acquire("indexHeatmap", dom);
    if (!chart) return;

    var rid = encodeURIComponent(store.selectedRegionId.value);
    var ag = encodeURIComponent(store.currentAgeGroup.value);

    MR.api.get("/api/index/spatio-temporal-grid/" + rid + "?age_group=" + ag).then(function (res) {
      var matrix = res.ok && res.data && res.data.matrix ? res.data.matrix : [];
      var heatmapData = matrix.map(function (item) {
        return [SEASON_IDX[item.season_code] !== undefined ? SEASON_IDX[item.season_code] : 0,
                GRASS_IDX[item.grassland_code] !== undefined ? GRASS_IDX[item.grassland_code] : 0,
                item.risk_score];
      });

      if (!heatmapData.length) {
        // 旧实现在这里用 12 项写死的 base_scores 兜底，能凭空画出一张好看的矩阵。
        // 现在没有真实矩阵就是没有：清空并给出状态，不做任何替代。
        chart.clear();
        chart.setOption({ title: MR.theme.emptyTitle("本县微网格矩阵未返回") });
        store.matrixInsight.value = {
          maxLabel: "—", maxValue: "—", minLabel: "—",
          seasonSpread: "—", grassSpread: "—", takeaway: "微网格矩阵接口未返回数据，本卡片不展示任何替代数值。",
        };
        return;
      }

      // 由矩阵真实推导侧栏读数
      var cellLabel = function (cell) { return GRASSLANDS[cell[1]] + " · " + SHORT_SEASONS[cell[0]]; };
      var ranked = heatmapData.slice().sort(function (a, b) { return a[2] - b[2]; });
      var lowest = ranked[0];
      var highest = ranked[ranked.length - 1];
      var spreadBySeason = SHORT_SEASONS.map(function (_, s) {
        var vals = heatmapData.filter(function (d) { return d[0] === s; }).map(function (d) { return d[2]; });
        return vals.length ? Math.max.apply(null, vals) - Math.min.apply(null, vals) : 0;
      });
      var spreadByGrass = GRASSLANDS.map(function (_, g) {
        var vals = heatmapData.filter(function (d) { return d[1] === g; }).map(function (d) { return d[2]; });
        return vals.length ? Math.max.apply(null, vals) - Math.min.apply(null, vals) : 0;
      });
      var seasonSpread = Math.max.apply(null, spreadBySeason);
      var grassSpread = Math.max.apply(null, spreadByGrass);

      store.matrixInsight.value = {
        maxLabel: cellLabel(highest),
        maxValue: highest[2],
        minLabel: cellLabel(lowest),
        seasonSpread: seasonSpread + "（" + SHORT_SEASONS[spreadBySeason.indexOf(seasonSpread)] + "内）",
        grassSpread: grassSpread + "（" + GRASSLANDS[spreadByGrass.indexOf(grassSpread)] + "内）",
        takeaway:
          "峰值单元为 " + cellLabel(highest) + "（" + highest[2] + " 分），较最低的 " + cellLabel(lowest) +
          "（" + lowest[2] + " 分）高出 " + (highest[2] - lowest[2]) + " 分；草场类型间极差 " + grassSpread +
          " 分，" + (grassSpread >= seasonSpread ? "大于" : "小于") + "季节间极差 " + seasonSpread + " 分。",
      };

      var values = heatmapData.map(function (d) { return d[2]; });
      var vMin = Math.min.apply(null, values);
      var vMax = Math.max.apply(null, values);
      var span = vMax - vMin || 1;

      // 按格子实际底色实测对比度来配墨，且不加描边——描边会把每个数字变成贴纸。
      var labeledData = heatmapData.map(function (d) {
        return {
          value: d,
          label: { color: MR.fmt.inkOn(MR.fmt.seqColorAt((d[2] - vMin) / span)) },
        };
      });

      chart.setOption(
        {
          tooltip: {
            position: "top",
            formatter: function (p) {
              return GRASSLANDS[p.value[1]] + " · " + SEASONS[p.value[0]] + "<br/>网格风险值: <strong>" + p.value[2] + "</strong>";
            },
          },
          grid: MR.theme.grid({ top: 14, bottom: 62, left: 86, right: 26 }),
          xAxis: { type: "category", data: SEASONS, axisLabel: { color: viz().textMuted, fontSize: 11 }, axisLine: { lineStyle: { color: viz().axis } }, splitArea: { show: false } },
          yAxis: { type: "category", data: GRASSLANDS, axisLabel: { color: viz().textMuted, fontSize: 12 }, axisLine: { lineStyle: { color: viz().axis } }, splitArea: { show: false } },
          visualMap: {
            type: "continuous",
            min: vMin,
            max: vMax,
            orient: "horizontal",
            left: "center",
            bottom: 10,
            itemWidth: 12,
            itemHeight: 152,
            calculable: false,
            text: ["高风险 " + vMax, "低风险 " + vMin],
            textStyle: { color: viz().textMuted, fontSize: 11 },
            inRange: { color: viz().seq.slice() },
          },
          series: [
            {
              type: "heatmap",
              data: labeledData,
              label: { show: true, fontSize: 14, fontWeight: 600 },
              itemStyle: { borderRadius: 4, borderColor: viz().surface, borderWidth: 3 },
              emphasis: { itemStyle: { borderColor: viz().focus, borderWidth: 2 } },
            },
          ],
        },
        true
      );
    });
  }

  // --- SPI / GDI 逐县哑铃对照 ----------------------------------------------
  function renderMethodCompare(forceReload) {
    var domSpi = document.getElementById("chartSpiSlope");
    var domGdi = document.getElementById("chartGdiSlope");
    if (!domSpi || !domGdi) return;
    var chartSpi = MR.charts.acquire("spiSlope", domSpi);
    var chartGdi = MR.charts.acquire("gdiSlope", domGdi);

    // 数据由 store.loadMethodCompare 统一持有（启动时已取过一次），
    // 这里不再自己发一份请求，避免同一份对照被拉两次、两处各自写 spiSummary。
    store.loadMethodCompare(forceReload).then(function (data) {
      if (!data || !data.counties) {
        [chartSpi, chartGdi].forEach(function (c) {
          if (!c) return;
          c.clear();
          c.setOption({ title: MR.theme.emptyTitle("全域方法对照接口未返回") });
        });
        return;
      }

      var buildDumbbell = function (chart, cfg) {
        if (!chart) return;
        var focusId = store.selectedRegionId.value;
        var usable = data.counties.filter(function (c) {
          return c[cfg.oldKey] !== null && c[cfg.oldKey] !== undefined && c[cfg.newKey] !== null && c[cfg.newKey] !== undefined;
        });
        if (!usable.length) {
          chart.clear();
          chart.setOption({ title: MR.theme.emptyTitle("本对照无可比县域") });
          return;
        }

        var reclassed = function (c) {
          return String(c[cfg.classOldKey] === undefined ? "" : c[cfg.classOldKey]) !== String(c[cfg.classNewKey] === undefined ? "" : c[cfg.classNewKey]);
        };

        // 按新值升序排列、y 轴 inverse —— 最上面一行即"新方法下最重"的县
        var rows = usable.slice().sort(function (a, b) { return Number(a[cfg.newKey]) - Number(b[cfg.newKey]); });
        var n = rows.length;
        var focusIdx = -1;
        rows.forEach(function (c, i) { if (c.region_id === focusId) focusIdx = i; });
        var f = function (v) { return Number(v).toFixed(3); };

        var thresholds = (cfg.thresholds || []).filter(function (t) { return t && t.value !== null && t.value !== undefined; });
        var observed = [];
        rows.forEach(function (c) { observed.push(Number(c[cfg.oldKey]), Number(c[cfg.newKey])); });
        var allX = observed.concat(thresholds.map(function (t) { return t.value; }));
        var lo = Math.min.apply(null, allX);
        var hi = Math.max.apply(null, allX);
        var step = cfg.axisStep || 0.5;
        var pad = (hi - lo) * 0.05 || step;
        var snappedMin = Math.floor((lo - pad) / step) * step;
        var xMin = cfg.floorAt !== null && cfg.floorAt !== undefined ? Math.max(cfg.floorAt, snappedMin) : snappedMin;
        var xMax = Math.ceil((hi + pad) / step) * step;

        var focusNew = focusIdx >= 0 ? Number(rows[focusIdx][cfg.newKey]) : null;
        var focusRatio = focusNew !== null ? (focusNew - xMin) / (xMax - xMin || 1) : 0.5;
        var prefersRight = focusNew !== null && focusIdx >= 0 && focusNew >= Number(rows[focusIdx][cfg.oldKey]);
        var focusLabelPos = prefersRight
          ? (focusRatio > 0.88 ? "left" : "right")
          : (focusRatio < 0.12 ? "right" : "left");

        var backdrop = function (api) {
          var band = api.size([0, 1])[1];
          var top = api.coord([0, 0])[1] - band / 2;
          var bottom = api.coord([0, n - 1])[1] + band / 2;
          var left = api.coord([xMin, 0])[0];
          var right = api.coord([xMax, 0])[0];
          var els = [];

          els.push({
            type: "text", silent: true,
            style: { text: cfg.unit || "", x: left, y: top - 11, fill: viz().textMuted, font: "10px sans-serif", textVerticalAlign: "top" },
          });

          if (cfg.normalBand) {
            var a = api.coord([Math.max(cfg.normalBand[0], xMin), 0])[0];
            var b = api.coord([Math.min(cfg.normalBand[1], xMax), 0])[0];
            if (b > a) {
              els.push({ type: "rect", silent: true, shape: { x: a, y: top, width: b - a, height: bottom - top }, style: { fill: "rgba(148,163,184,0.07)" } });
              els.push({
                type: "text", silent: true,
                style: { text: cfg.normalBandLabel || "", x: b - 8, y: top + 7, fill: viz().textMuted, font: "10px sans-serif", textAlign: "right", textVerticalAlign: "top" },
              });
            }
          }

          thresholds.forEach(function (t) {
            var x = api.coord([t.value, 0])[0];
            els.push({ type: "line", silent: true, shape: { x1: x, y1: top, x2: x, y2: bottom }, style: { stroke: "rgba(241,245,249,0.24)", lineWidth: 1, lineDash: [4, 4] } });
            els.push({
              type: "text", silent: true,
              style: { text: t.label, x: x + 5, y: top - 11, fill: viz().textMuted, font: "10px sans-serif", textVerticalAlign: "top" },
            });
          });

          if (focusIdx >= 0) {
            var y = api.coord([0, focusIdx])[1];
            els.push({ type: "rect", silent: true, shape: { x: left, y: y - band / 2, width: right - left, height: band }, style: { fill: "rgba(248,250,252,0.055)" } });
          }
          return els;
        };

        // renderItem 在本版 ECharts 里只接受单个图元，多图元必须包进 group.children
        var backdropSeries = {
          name: "__backdrop", type: "custom", z: 1, silent: true,
          encode: { x: [1, 2], y: 0 },
          dimensions: ["row", cfg.oldKey, cfg.newKey],
          data: [{ value: [0, 0, 0] }],
          tooltip: { show: false },
          renderItem: function (params, api) { return { type: "group", children: backdrop(api) }; },
        };

        var connectorSeries = function (name, color, match) {
          return {
            name: name, type: "custom", z: 3,
            encode: { x: [1, 2], y: 0 },
            dimensions: ["row", cfg.oldKey, cfg.newKey],
            data: rows.map(function (c, i) { return { value: [i, Number(c[cfg.oldKey]), Number(c[cfg.newKey])] }; })
              .filter(function (_, i) { return match(rows[i]); }),
            renderItem: function (params, api) {
              var i = api.value(0);
              var c = rows[i];
              var band = api.size([0, 1])[1];
              var y = api.coord([0, i])[1];
              var a = api.coord([Number(c[cfg.oldKey]), i]);
              var b = api.coord([Number(c[cfg.newKey]), i]);
              var left = api.coord([xMin, 0])[0];
              return {
                type: "group",
                children: [
                  { type: "rect", shape: { x: left, y: y - band / 2, width: api.coord([xMax, 0])[0] - left, height: band }, style: { fill: "transparent" } },
                  { type: "line", silent: true, shape: { x1: a[0], y1: a[1], x2: b[0], y2: b[1] }, style: { stroke: color, lineWidth: 2, lineCap: "round" } },
                ],
              };
            },
          };
        };

        var dotSeries = function (name, key, z, size, hollow) {
          return {
            name: name, type: "scatter", z: z, symbolSize: size,
            data: rows.map(function (c, i) {
              return {
                value: [Number(c[key]), i],
                itemStyle: hollow
                  ? { color: viz().surface, borderColor: reclassed(c) ? viz().up : viz().neutral, borderWidth: 2 }
                  : { color: reclassed(c) ? viz().up : viz().neutral, borderColor: viz().surface, borderWidth: 1.5 },
                label: !hollow && i === focusIdx
                  ? { show: true, position: focusLabelPos, distance: 7, color: viz().textMain, fontSize: 11, fontWeight: 600, formatter: function () { return f(focusNew); } }
                  : { show: false },
              };
            }),
            emphasis: { scale: 1.25, itemStyle: { borderColor: viz().focus, borderWidth: 2 } },
          };
        };

        chart.resize();
        chart.setOption(
          {
            legend: {
              show: true, bottom: 0, left: "center", itemWidth: 10, itemHeight: 10, itemGap: 18, icon: "circle",
              textStyle: { color: viz().textMuted, fontSize: 11 },
              data: [
                { name: "旧实现取值", itemStyle: { color: viz().surface, borderColor: viz().neutral, borderWidth: 2 } },
                { name: "新方法取值", itemStyle: { color: viz().neutral } },
                { name: "等级判定被改写", icon: "roundRect", itemStyle: { color: viz().up } },
              ],
            },
            tooltip: {
              trigger: "item",
              formatter: function (p) {
                var i = p.seriesType === "scatter" ? p.value[1] : p.value[0];
                var c = rows[i];
                if (!c) return "";
                return [
                  MR.theme.tipTitle(c.region_name),
                  cfg.oldLabel + "：" + f(c[cfg.oldKey]) + " · " + (c[cfg.classOldKey] || "—"),
                  cfg.newLabel + "：" + f(c[cfg.newKey]) + " · " + (c[cfg.classNewKey] || "—"),
                  reclassed(c)
                    ? '<span style="color:' + viz().up + '">等级判定被改写</span>'
                    : '<span style="color:' + viz().textMuted + '">等级判定未变</span>',
                ].join("<br/>");
              },
            },
            grid: MR.theme.grid({ top: 28, bottom: 42, left: 86, right: 34 }),
            xAxis: {
              type: "value", min: xMin, max: xMax,
              axisLabel: { color: viz().textMuted, fontSize: 10 },
              axisLine: { show: false }, axisTick: { show: false },
              splitLine: { lineStyle: { color: viz().grid } },
            },
            yAxis: {
              type: "category", data: rows.map(function (c) { return c.region_name; }), inverse: true,
              axisLabel: {
                fontSize: 10,
                color: function (value, index) {
                  return rows[index] && rows[index].region_id === focusId ? viz().textMain : viz().textMuted;
                },
              },
              axisLine: { lineStyle: { color: viz().axis } }, axisTick: { show: false },
              splitLine: { show: false },
              splitArea: { show: true, areaStyle: { color: ["rgba(255,255,255,0.016)", "transparent"] } },
            },
            series: [
              backdropSeries,
              connectorSeries("修正幅度", viz().neutral, function (c) { return !reclassed(c); }),
              connectorSeries("等级判定被改写", viz().up, reclassed),
              dotSeries("旧实现取值", cfg.oldKey, 6, 8, true),
              dotSeries("新方法取值", cfg.newKey, 7, 9, false),
            ],
          },
          true
        );
      };

      var spiT = (data.thresholds && data.thresholds.spi) || {};
      var gdiT = (data.thresholds && data.thresholds.gdi) || {};

      buildDumbbell(chartSpi, {
        oldKey: "spi_old", newKey: "spi_new",
        classOldKey: "spi_class_old", classNewKey: "spi_class_new",
        oldLabel: "简化 Z-score", newLabel: "Gamma MLE", unit: "SPI", axisStep: 0.5,
        normalBand: [-1, 1], normalBandLabel: "SPI 正常区间 (−1 ~ +1)",
        thresholds: [
          { value: spiT.moderate_drought !== undefined ? spiT.moderate_drought : -1.0, label: (spiT.moderate_drought !== undefined ? spiT.moderate_drought : -1.0) + " 中旱" },
          { value: spiT.severe_drought !== undefined ? spiT.severe_drought : -1.5, label: (spiT.severe_drought !== undefined ? spiT.severe_drought : -1.5) + " 重旱" },
        ],
      });

      buildDumbbell(chartGdi, {
        oldKey: "gdi_old", newKey: "gdi_new",
        classOldKey: "gdi_class_old", classNewKey: "gdi_class_new",
        oldLabel: "等权 Min-Max", newLabel: "PCA+K-Means", unit: "GDI", axisStep: 0.2, floorAt: 0,
        thresholds: [
          { value: gdiT.light_moderate !== undefined ? gdiT.light_moderate : 0.5032, label: (gdiT.light_moderate !== undefined ? gdiT.light_moderate : 0.5032) + " 轻→中" },
          { value: gdiT.moderate_severe !== undefined ? gdiT.moderate_severe : 0.7502, label: (gdiT.moderate_severe !== undefined ? gdiT.moderate_severe : 0.7502) + " 中→重" },
        ],
      });
    });
  }

  // --- SHAP 归因 ------------------------------------------------------------
  function renderShap() {
    var dom = document.getElementById("chartPuShap");
    if (!dom) return;
    var chart = MR.charts.acquire("puShap", dom);
    if (!chart) return;

    var pu = store.currentPuRisk.value;
    var top = pu && pu.top_shap_features && pu.top_shap_features.length ? pu.top_shap_features : [];

    if (!top.length) {
      // 旧实现在这里回落到 5 条写死的 SHAP 值，等于给每个县都画同一张归因图。
      chart.clear();
      chart.setOption({ title: MR.theme.emptyTitle("本县 SHAP 归因未返回") });
      return;
    }

    var yData = top.map(function (x) { return x.feature_label_cn; }).reverse();
    var xData = top
      .map(function (x) {
        return {
          value: x.contribution_pct,
          itemStyle: { color: x.direction === "increase_risk" ? viz().up : viz().down, borderRadius: [0, 4, 4, 0] },
        };
      })
      .reverse();

    chart.setOption(
      {
        tooltip: {
          trigger: "axis",
          axisPointer: { type: "shadow" },
          formatter: function (params) {
            var p = params[0];
            var raw = top.filter(function (x) { return x.feature_label_cn === p.name; })[0];
            var dir = raw && raw.direction === "increase_risk" ? "抬升致灾概率" : "压低致灾概率";
            var s = raw ? (raw.shap_value > 0 ? "+" : "") + raw.shap_value : "—";
            return p.name + "<br/>边际贡献占比: <strong>" + p.value + "%</strong><br/>SHAP 值: " + s + "<br/>方向: " + dir;
          },
        },
        grid: MR.theme.grid({ top: 12, bottom: 22, left: 116, right: 46 }),
        xAxis: { type: "value", axisLabel: { color: viz().textMuted, fontSize: 11, formatter: "{value}%" }, splitLine: { lineStyle: { color: viz().grid } }, axisLine: { show: false } },
        yAxis: { type: "category", data: yData, axisLabel: { color: viz().textMain, fontSize: 12 }, axisLine: { lineStyle: { color: viz().axis } }, axisTick: { show: false } },
        series: [
          {
            name: "边际贡献占比", type: "bar", data: xData, barWidth: 14,
            label: { show: true, position: "right", color: viz().textMuted, fontSize: 11, formatter: "{c}%" },
          },
        ],
      },
      true
    );
  }

  // --- PU 基线 F1 分组柱（新增，回答"凭什么说我们的模型更好"） --------------
  function renderPuBenchmark() {
    var dom = document.getElementById("chartPuBenchmark");
    if (!dom) return;
    var chart = MR.charts.acquire("puBenchmark", dom);
    if (!chart) return;

    var b = store.puBenchmark.value;
    if (!b || !b.benchmark_results) {
      chart.clear();
      chart.setOption({ title: MR.theme.emptyTitle("PU 基准接口未返回") });
      return;
    }

    // 顺序与上方对照表一致，方便逐行对照；ours 为 true 的那根用状态绿。
    // 第 4 根（第三方 Elkan-Noto）刻意用中性灰而非顺序色 —— 它不是本项目的模型，
    // 配色上就不该和"我们的"那根混为一谈。
    var order = [
      { key: "Baseline 1 (Rule-based)", label: "基线1 规则评分", color: viz().seq[2] },
      { key: "Baseline 2 (Naive Supervised)", label: "基线2 未标注当负例", color: viz().seq[1] },
      { key: "Model 3 (PU Learning Model)", label: "本项目 PU Learning", color: viz().seq[0] },
      { key: "Baseline 4 (Elkan-Noto PU)", label: "基线4 Elkan-Noto (第三方)", color: viz().neutral },
    ];
    var metrics = [
      { key: "accuracy", label: "准确率" },
      { key: "precision", label: "精确率" },
      { key: "recall", label: "召回率" },
      { key: "f1_score", label: "F1 分数" },
    ];

    chart.setOption(
      {
        tooltip: { trigger: "axis", axisPointer: { type: "shadow" } },
        legend: { top: 0, right: 0, itemWidth: 12, itemHeight: 8, textStyle: { color: viz().textMuted, fontSize: 11 } },
        grid: MR.theme.grid({ top: 30, bottom: 26, left: 46, right: 16 }),
        xAxis: {
          type: "category",
          data: metrics.map(function (m) { return m.label; }),
          axisLabel: { color: viz().textMuted, fontSize: 11 },
          axisLine: { lineStyle: { color: viz().axis } },
        },
        yAxis: { type: "value", min: 0, max: 1, axisLabel: { color: viz().textMuted, fontSize: 10 }, splitLine: { lineStyle: { color: viz().grid } }, axisLine: { show: false } },
        // 没跑起来的对照不画柱子，也不进图例——留一根空柱子等于在图上暗示它得了 0 分
        series: order
          .filter(function (o) {
            var m = b.benchmark_results[o.key];
            return m && m.available !== false;
          })
          .map(function (o) {
            var m = b.benchmark_results[o.key];
            return {
              name: o.label,
              type: "bar",
              barWidth: 16,
              itemStyle: { color: o.color, borderRadius: [3, 3, 0, 0] },
              data: metrics.map(function (mm) {
                var v = m[mm.key];
                return v === null || v === undefined ? null : Number(Number(v).toFixed(4));
              }),
            };
          }),
      },
      true
    );
  }

  store.registerRenderer("index", function () {
    renderPuBenchmark();
    renderShap();
    renderHeatmap();
    renderMethodCompare(false);
  });

  MR.charts.indexCharts = {
    renderHeatmap: renderHeatmap,
    renderMethodCompare: renderMethodCompare,
    renderShap: renderShap,
    renderPuBenchmark: renderPuBenchmark,
  };
})(window.MR);
