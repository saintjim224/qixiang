/**
 * 风险分析图表：历史 SHAP 归因、微网格热力图、SPI/GDI 对照及记录标签诊断。
 */
(function (MR) {
  "use strict";

  var store = MR.store;
  var viz = function () { return MR.tokens.viz; };
  var heatmapRequest = 0;
  var heatmapOwner = "";

  // 季节顺序是口径的一部分（春→冬），可以写死；**草场类型不行**——
  // 它随县而变，必须从接口的 grassland_types 读（见 renderHeatmap 里的说明）。
  var SEASON_ORDER = ["spring", "summer", "autumn", "winter"];
  var SEASON_SHORT = { spring: "春季", summer: "夏季", autumn: "秋季", winter: "冬季" };

  // --- 微网格热力图 ---------------------------------------------------------
  function renderHeatmap() {
    var dom = document.getElementById("chartIndexGridHeatmap");
    if (!dom) return;
    var chart = MR.charts.acquire("indexHeatmap", dom);
    if (!chart) return;

    var rid = encodeURIComponent(store.selectedRegionId.value);
    var ag = encodeURIComponent(store.currentAgeGroup.value);
    var requestId = ++heatmapRequest;
    if (heatmapOwner !== rid + "/" + ag) {
      heatmapOwner = rid + "/" + ag;
      chart.clear();
      chart.setOption({ title: MR.theme.emptyTitle("正在加载本县矩阵…") });
    }

    MR.api.get("/api/index/spatio-temporal-grid/" + rid + "?age_group=" + ag).then(function (res) {
      if (requestId !== heatmapRequest || rid !== encodeURIComponent(store.selectedRegionId.value) ||
          ag !== encodeURIComponent(store.currentAgeGroup.value) || res.aborted) return;
      var matrix = res.ok && res.data && res.data.matrix ? res.data.matrix : [];

      if (!matrix.length) {
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

      // --- 两个类目轴都由接口实测取值推导 ------------------------------------
      // 草场类型**必须**从接口读。它随县而变（本县返回的是 河谷草地 / 山地草甸 /
      // 高寒草甸 / 山地灌丛草甸），而旧实现把 y 轴写死成
      // ["高寒草甸","高寒草原","高寒荒漠"]、把 code→行号映射写死成
      // {alpine_meadow:0, alpine_steppe:1, alpine_desert:2}。接口返回的 code 是中文名，
      // 一个都命中不了，于是 16 个格子全部落回 y=0：两行永远空白，另外四列各有
      // 4 个数字叠在同一格里互相糊住。更糟的是侧栏据此得出的"峰值单元"会把
      // 河谷草地·冬季的 62 分安到高寒草甸头上——那已经不是画错，是编造归属。
      var local = res.data.local_pasture_type || "";
      var grassOrder = (res.data.grassland_types || []).slice();
      matrix.forEach(function (it) {
        var g = it.grassland_name;
        if (g && grassOrder.indexOf(g) < 0) grassOrder.push(g);
      });
      if (!grassOrder.length) grassOrder = ["未标注草场类型"];
      // ECharts 类目轴 index 0 在最下面一行，把本县主类型放这里——读者最该先看到它
      if (local && grassOrder.indexOf(local) >= 0) {
        grassOrder = [local].concat(grassOrder.filter(function (g) { return g !== local; }));
      }

      var seasonOrder = SEASON_ORDER.filter(function (s) {
        return matrix.some(function (it) { return it.season_code === s; });
      });
      matrix.forEach(function (it) {
        if (seasonOrder.indexOf(it.season_code) < 0) seasonOrder.push(it.season_code);
      });
      var seasonFull = {};   // code → 接口给的完整季节名（含括注）
      var seasonShort = {};  // code → 短名，用于侧栏读数
      matrix.forEach(function (it) {
        if (!seasonFull[it.season_code]) {
          seasonFull[it.season_code] = it.season_name || SEASON_SHORT[it.season_code] || it.season_code;
          seasonShort[it.season_code] = SEASON_SHORT[it.season_code] || it.season_name || it.season_code;
        }
      });

      var heatmapData = matrix.map(function (item) {
        return {
          value: [seasonOrder.indexOf(item.season_code), grassOrder.indexOf(item.grassland_name), item.risk_score],
          seasonCode: item.season_code,
          grassName: item.grassland_name,
        };
      });

      // 由矩阵真实推导侧栏读数
      var cellLabel = function (cell) {
        return cell.grassName + " · " + (seasonShort[cell.seasonCode] || cell.seasonCode);
      };
      var ranked = heatmapData.slice().sort(function (a, b) { return a.value[2] - b.value[2]; });
      var lowest = ranked[0];
      var highest = ranked[ranked.length - 1];
      var spreadBySeason = seasonOrder.map(function (code) {
        var vals = heatmapData
          .filter(function (d) { return d.seasonCode === code; })
          .map(function (d) { return d.value[2]; });
        return vals.length ? Math.max.apply(null, vals) - Math.min.apply(null, vals) : 0;
      });
      var spreadByGrass = grassOrder.map(function (g) {
        var vals = heatmapData
          .filter(function (d) { return d.grassName === g; })
          .map(function (d) { return d.value[2]; });
        return vals.length ? Math.max.apply(null, vals) - Math.min.apply(null, vals) : 0;
      });
      // 固定草场比较四季得到季节间极差；固定季节比较草场得到草场间极差。
      var seasonSpread = Math.max.apply(null, spreadByGrass);
      var grassSpread = Math.max.apply(null, spreadBySeason);
      var peak = highest.value[2];
      var trough = lowest.value[2];

      store.matrixInsight.value = {
        maxLabel: cellLabel(highest),
        maxValue: peak,
        minLabel: cellLabel(lowest),
        seasonSpread: seasonSpread + "（" + grassOrder[spreadByGrass.indexOf(seasonSpread)] + "内）",
        grassSpread: grassSpread + "（" + (seasonShort[seasonOrder[spreadBySeason.indexOf(grassSpread)]] || "—") + "内）",
        takeaway:
          "峰值单元为 " + cellLabel(highest) + "（" + peak + " 分），较最低的 " + cellLabel(lowest) +
          "（" + trough + " 分）高出 " + (peak - trough) + " 分；草场类型间极差 " + grassSpread +
          " 分，" + (grassSpread === seasonSpread ? "等于" : (grassSpread > seasonSpread ? "大于" : "小于")) + "季节间极差 " + seasonSpread + " 分。",
      };

      var values = heatmapData.map(function (d) { return d.value[2]; });
      var vMin = Math.min.apply(null, values);
      var vMax = Math.max.apply(null, values);
      var span = vMax - vMin || 1;

      // 按格子实际底色实测对比度来配墨，且不加描边——描边会把每个数字变成贴纸。
      var labeledData = heatmapData.map(function (d) {
        return Object.assign({}, d, {
          label: { color: MR.fmt.inkOn(MR.fmt.seqColorAt((d.value[2] - vMin) / span)) },
        });
      });

      // 类目名最长的可能是「山地灌丛草甸（主）」，边距按它实测，避免又被截断
      var yLabels = grassOrder.map(function (g) { return g === local ? g + "（主）" : g; });
      var widest = yLabels.reduce(function (a, b) {
        return MR.fmt.cjkWidth(a, 12, 6) >= MR.fmt.cjkWidth(b, 12, 6) ? a : b;
      }, "");
      var leftPad = Math.min(160, Math.max(72, Math.ceil(MR.fmt.cjkWidth(widest, 12, 6)) + 16));

      chart.setOption(
        {
          tooltip: {
            position: "top",
            formatter: function (p) {
              // p.value 是 [季节序号, 草场序号, 分值]，名字在原始 data 项上
              var d = p.data || {};
              return (
                (d.grassName || "—") + " · " + (seasonShort[d.seasonCode] || d.seasonCode || "—") +
                "<br/>网格风险值: <strong>" + (d.value ? d.value[2] : "—") + "</strong>"
              );
            },
          },
          grid: MR.theme.grid({ top: 14, bottom: 62, left: leftPad, right: 26 }),
          xAxis: {
            type: "category",
            data: seasonOrder.map(function (c) { return seasonFull[c] || c; }),
            axisLabel: { color: viz().textMuted, fontSize: 11 },
            axisLine: { lineStyle: { color: viz().axis } },
            splitArea: { show: false },
          },
          yAxis: {
            type: "category",
            data: yLabels,
            axisLabel: { color: viz().textMuted, fontSize: 12 },
            axisLine: { lineStyle: { color: viz().axis } },
            splitArea: { show: false },
          },
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

        // y 轴 inverse:true → 数据下标 0 落在最上面一行。因此"最上面一行是哪个极端"
        // 完全由排序方向决定，而两个指数的"重"不是一个方向：
        //   SPI 越负越旱，最重的县是**最小值** → 升序排在最上；
        //   GDI 越大退化越重，最重的县是**最大值** → 降序排在最上。
        // 旧实现两条线都用升序，于是 SPI 看起来是对的（最旱在最上），
        // GDI 却把退化最轻的县顶到了最上面，与注释写的"最上面即最重的县"刚好相反。
        var dir = cfg.worstIsHigh ? -1 : 1;
        var rows = usable.slice().sort(function (a, b) {
          return dir * (Number(a[cfg.newKey]) - Number(b[cfg.newKey]));
        });
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
        worstIsHigh: false, // SPI 越负越旱
        normalBand: [-0.5, 0.5], normalBandLabel: "SPI 正常区间 (−0.5 ~ +0.5)",
        thresholds: [
          { value: spiT.moderate_drought !== undefined ? spiT.moderate_drought : -1.0, label: (spiT.moderate_drought !== undefined ? spiT.moderate_drought : -1.0) + " 中旱" },
          { value: spiT.severe_drought !== undefined ? spiT.severe_drought : -1.5, label: (spiT.severe_drought !== undefined ? spiT.severe_drought : -1.5) + " 重旱" },
        ],
      });

      buildDumbbell(chartGdi, {
        oldKey: "gdi_old", newKey: "gdi_new",
        classOldKey: "gdi_class_old", classNewKey: "gdi_class_new",
        oldLabel: "等权 Min-Max", newLabel: "PCA+K-Means", unit: "GDI", axisStep: 0.2, floorAt: 0,
        worstIsHigh: true, // GDI 越大退化越重
        thresholds: [
          { value: gdiT.light_moderate, label: gdiT.light_moderate + " 轻→中" },
          { value: gdiT.moderate_severe, label: gdiT.moderate_severe + " 中→重" },
        ].filter(function (t) { return t.value !== null && t.value !== undefined; }),
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
            var dir = raw && raw.direction === "increase_risk" ? "抬升模型评分" : "压低模型评分";
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
      { key: "labeled_positive_recall", label: "已标注召回率" },
      { key: "unlabeled_alert_rate", label: "未标注告警率" },
      { key: "f1_score", label: "记录标签 F1" },
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
