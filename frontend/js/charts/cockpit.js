/**
 * 驾驶舱图表：26 县风险地图 + 前瞻 16 天演化。
 *
 * 地图此前"90% 空黑"不是缺数据（/api/overview/geojson-all 已返回 4 省 + 26 县），
 * 而是省界被涂成 rgba(15,23,42,0.45) 压在 #080c14 上，等于隐形，且 layoutSize 只有
 * 115%，26 个县缩成中间一小簇。本次修正：
 *   - 省界提亮、改实线、显示省名，作为宏观地理语境；
 *   - 改用 geo 组件 + boundingCoords 锁定青藏高原范围，四省填满视口；
 *   - 补真实经纬网（经线 80/85/90/95/100、纬线 30/32/34/36）；
 *   - 删除假罗盘"🧭 北 (N)"与假比例尺"0 ─── 200 km"（与真实缩放无关的固定贴纸），
 *     改为用 convertToPixel 按中心纬度做 cos 校正算出的**投影真实**比例尺；
 *   - 叠加风险气泡层，让少数橙红县从底图里跳出来。
 */
(function (MR) {
  "use strict";

  var store = MR.store;
  var viz = function () { return MR.tokens.viz; };

  // 视口锁定范围（青藏高原 + 周边，含四省完整轮廓）
  var BOUNDING = [[76.5, 25.5], [105.5, 38.5]];
  var PROVINCES = ["西藏自治区", "青海省", "四川省", "甘肃省"];
  var GRAT_LON = [80, 85, 90, 95, 100];
  var GRAT_LAT = [30, 32, 34, 36];

  function provinceStyle() {
    var v = viz();
    return {
      itemStyle: {
        // 此前是 rgba(15,23,42,0.45)：在 #080c14 画布上几乎不可见
        areaColor: "rgba(30, 41, 59, 0.62)",
        borderColor: v.context,
        borderWidth: 1.2,
      },
      emphasis: {
        itemStyle: { areaColor: "rgba(51, 65, 85, 0.75)" },
        label: { show: true, color: v.textMain, fontSize: 12 },
      },
      label: { show: true, color: viz().textMuted, fontSize: 11 },
    };
  }

  function buildMapOption(geoJson, mapData) {
    var v = viz();
    echarts.registerMap("plateau_26", geoJson);

    var scores = mapData
      .map(function (d) { return Number(d.value); })
      .filter(function (n) { return Number.isFinite(n); });

    // 色阶分档阈值与后端 comp_risk 分级（app/api/overview.py）逐字一致：
    // <40 低风险 / 40–60 中度 / 60–75 高 / ≥75 重特大，且与卡片上那个 risk_level
    // 徽章同源，因此**色块与文字标签不可能互相矛盾**。
    //
    // 旧实现是把当日真实分布的 min–max 拉满到 5 色连续带上。风险分被后端钳在
    // [15, 95]，实测常在 15–74 之间，于是"低风险"的县也会落在暖色段里被涂成橙黄，
    // 全图看上去像满屏告警，与同一屏右侧"低风险 14"的计数自相矛盾。
    // 必须用 gte/lt 这种半开区间，不能用 min/max 闭区间：后端的判级是 comp_risk >= 40
    // 才算中度风险，而 ECharts 闭区间会把恰好等于 40 的值匹配给前一段。实测真有县
    // 落在边界上（海北州刚察县 = 40.0，标注"中度风险"），闭区间下会被涂成绿色——
    // 色块与徽章当场打架。
    var PIECES = [
      { gte: 15, lt: 40, label: "低风险 (<40)", color: v.seq[0] }, // 翡翠绿
      { gte: 40, lt: 60, label: "中度风险 (40–60)", color: v.seq[1] }, // 天空蓝
      { gte: 60, lt: 75, label: "高风险 (60–75)", color: v.seq[3] }, // 警示橙
      { gte: 75, label: "重特大预警 (≥75)", color: v.seq[4] }, // 烈焰红
    ];

    var graticule = [];
    GRAT_LON.forEach(function (lon) {
      graticule.push({ coords: [[lon, BOUNDING[0][1]], [lon, BOUNDING[1][1]]] });
    });
    GRAT_LAT.forEach(function (lat) {
      graticule.push({ coords: [[BOUNDING[0][0], lat], [BOUNDING[1][0], lat]] });
    });

    var gratLabels = []
      .concat(GRAT_LON.map(function (lon) { return { value: [lon, BOUNDING[1][1]], text: lon + "°E" }; }))
      .concat(GRAT_LAT.map(function (lat) { return { value: [BOUNDING[0][0], lat], text: lat + "°N" }; }));

    // 热点阈值 = "高风险"分档下沿（60），与色阶、与卡片徽章同一把尺子。
    // 旧实现取 50，会把"中度风险"的县也点成红点，等于抬高了一档。
    var HOTSPOT_MIN = 60;
    var hotspots = mapData
      .filter(function (d) { return Number.isFinite(Number(d.value)) && Number(d.value) >= HOTSPOT_MIN; })
      .map(function (d) {
        var r = (store.regions.value || []).filter(function (x) { return x.region_id === d.region_id; })[0];
        if (!r || !Number.isFinite(Number(r.longitude))) return null;
        return { name: d.name, value: [Number(r.longitude), Number(r.latitude), Number(d.value)], region_id: d.region_id, risk_level: d.risk_level };
      })
      .filter(Boolean);

    return {
      backgroundColor: "transparent",
      geo: {
        map: "plateau_26",
        roam: true,
        boundingCoords: BOUNDING,
        zoom: 1.02,
        layoutCenter: ["50%", "50%"],
        layoutSize: "100%",
        silent: false,
        itemStyle: {
          areaColor: "rgba(17, 24, 39, 0.9)",
          borderColor: "rgba(255,255,255,0.28)",
          borderWidth: 0.8,
        },
        emphasis: {
          itemStyle: { areaColor: "#3a86ff" },
          label: { show: true, color: "#fff", fontSize: 11 },
        },
        select: { itemStyle: { areaColor: "#3a86ff" } },
        regions: PROVINCES.map(function (n) {
          return Object.assign({ name: n }, provinceStyle());
        }),
      },
      visualMap: {
        type: "piecewise",
        pieces: PIECES,
        // 缺风险分的县（当前 1 个）不着色，也不冒充"低风险"
        outOfRange: { color: "rgba(71, 85, 105, 0.55)" },
        selectedMode: false, // 禁止点图例把某一档藏掉——那会让"少数橙红县"凭空消失
        orient: "vertical",
        itemWidth: 14,
        itemHeight: 12,
        itemGap: 6,
        textStyle: { color: v.textMuted, fontSize: 11 },
        bottom: 18,
        left: 12,
      },
      tooltip: {
        trigger: "item",
        formatter: function (params) {
          var d = params.data;
          if (!d || !d.region_id) {
            return MR.theme.tipTitle(params.name) +
              '<br/><span style="color:' + v.textMuted + ';font-size:11px;">青藏高原省界底图背景 · 提供 26 牧区监测县的宏观地理语境</span>';
          }
          return MR.theme.tipTitle(d.name) +
            (d.value === null ? '<br/>综合风险分: 数据不足' : "<br/>综合气象灾害风险分: <strong>" + d.value + "</strong>") +
            '<br/>综合预警评级: <span style="color:' + v.textMain + '">' + d.risk_level + "</span>" +
            (d.pu_sample_count === 0 ? "<br/>本县无 PU 历史样本，暂不评分" : "") +
            "<br/>牧区雪灾: " + d.snow_level +
            "<br/>干旱态势: " + d.drought_level;
        },
      },
      series: [
        {
          name: "青藏高原 26 县",
          type: "map",
          geoIndex: 0,
          data: mapData,
          emphasis: { label: { show: true, color: "#fff" } },
        },
        {
          name: "经纬网",
          type: "lines",
          coordinateSystem: "geo",
          silent: true,
          z: 2,
          polyline: false,
          data: graticule,
          lineStyle: { color: "rgba(148,163,184,0.16)", width: 1, type: "solid" },
        },
        {
          name: "经纬网标注",
          type: "scatter",
          coordinateSystem: "geo",
          silent: true,
          z: 2,
          symbolSize: 0,
          data: gratLabels.map(function (g) {
            return {
              name: g.text,
              value: g.value,
              label: {
                show: true,
                formatter: g.text,
                color: "rgba(148,163,184,0.7)",
                fontSize: 9,
              },
            };
          }),
        },
        {
          // 风险热点气泡：符号大小 ∝ 风险分，让少数橙红县从底图中跳出
          name: "风险热点",
          type: "scatter",
          coordinateSystem: "geo",
          z: 5,
          symbolSize: function (val) { return 6 + (Number(val[2]) - HOTSPOT_MIN) / 5; },
          itemStyle: {
            color: v.up,
            opacity: 0.85,
            borderColor: "rgba(255,255,255,0.65)",
            borderWidth: 1,
          },
          data: hotspots,
          tooltip: {
            formatter: function (p) {
              return MR.theme.tipTitle(p.data.name) + "<br/>综合风险分: <strong>" + p.value[2] + "</strong>";
            },
          },
        },
      ],
    };
  }

  /**
   * 真实比例尺：按视口中心纬度做 cos(lat) 校正，把"度"换算成公里，
   * 再用 convertToPixel 量出屏幕上 1° 经度对应多少像素，从而得到真实公里/像素比。
   * 缩放、漫游后都会重算——这与旧实现那张永远写死 200km 的贴纸是两回事。
   */
  function renderScaleBar(chart) {
    var v = viz;
    try {
      var lon0 = 90, lat0 = 32;
      var p0 = chart.convertToPixel({ geoIndex: 0 }, [lon0, lat0]);
      var p1 = chart.convertToPixel({ geoIndex: 0 }, [lon0 + 1, lat0]);
      if (!p0 || !p1) return;
      var pxPerDeg = Math.abs(p1[0] - p0[0]);
      if (!pxPerDeg || !Number.isFinite(pxPerDeg)) return;
      // 1° 经度 ≈ 111.32 km × cos(纬度)
      var kmPerPx = (111.32 * Math.cos((lat0 * Math.PI) / 180)) / pxPerDeg;

      var candidates = [50, 100, 200, 300, 500];
      var target = 110; // 目标像素长度
      var best = candidates[0];
      candidates.forEach(function (c) {
        if (Math.abs(c / kmPerPx - target) < Math.abs(best / kmPerPx - target)) best = c;
      });
      var px = Math.round(best / kmPerPx);
      if (!Number.isFinite(px) || px < 20 || px > 400) return;

      chart.setOption({
        graphic: [
          {
            type: "group",
            id: "mr-scalebar",
            bottom: 20,
            right: 20,
            silent: true,
            children: [
              {
                type: "rect",
                shape: { width: px + 24, height: 30, r: 4 },
                style: { fill: "rgba(11,17,30,0.82)", stroke: "rgba(255,255,255,0.14)", lineWidth: 1 },
              },
              {
                type: "line",
                shape: { x1: 12, y1: 20, x2: 12 + px, y2: 20 },
                style: { stroke: v().textMuted, lineWidth: 1.6 },
              },
              {
                type: "line",
                shape: { x1: 12, y1: 15, x2: 12, y2: 25 },
                style: { stroke: v().textMuted, lineWidth: 1.6 },
              },
              {
                type: "line",
                shape: { x1: 12 + px, y1: 15, x2: 12 + px, y2: 25 },
                style: { stroke: v().textMuted, lineWidth: 1.6 },
              },
              {
                type: "text",
                style: { text: best + " km", x: 12 + px / 2, y: 6, fill: v().textMuted, font: "10px sans-serif", textAlign: "center" },
              },
            ],
          },
          {
            // 北向标：本图用的是经纬度投影、始终 north-up，所以这个箭头表述的是
            // 一个恒真的事实（与旧实现那枚跟缩放/漫游无关的"罗盘贴纸"不同）。
            // 箭头用多边形画，不用 emoji，避免与图标体系不一致。
            type: "group",
            id: "mr-northarrow",
            top: 14,
            right: 16,
            silent: true,
            children: [
              {
                type: "rect",
                shape: { width: 34, height: 46, r: 4 },
                style: { fill: "rgba(11,17,30,0.82)", stroke: "rgba(255,255,255,0.14)", lineWidth: 1 },
              },
              {
                type: "polygon",
                shape: { points: [[17, 7], [24, 26], [17, 21], [10, 26]] },
                style: { fill: v().textMuted },
              },
              {
                type: "text",
                style: { text: "N", x: 17, y: 30, fill: v().textMuted, font: "11px sans-serif", textAlign: "center" },
              },
            ],
          },
        ],
      });
    } catch (e) {
      /* 投影尚未就绪时静默跳过，下一帧 resize 会重算 */
    }
  }

  var mapData = [];
  var applySelection = null;
  var lastMissingWarned = "";

  function renderMap() {
    var dom = document.getElementById("chartPlateauMap");
    if (!dom) return;
    var chart = MR.charts.acquire("map", dom);
    if (!chart) return;

    MR.api.get("/api/overview/geojson-all").then(function (res) {
      if (res.aborted) return;
      if (!res.ok || !res.data || !res.data.features) {
        chart.clear();
        chart.setOption({ title: MR.theme.emptyTitle("县域边界 GeoJSON 未取得") });
        return;
      }
      var regionsList = store.regions.value || [];
      var risks = store.countyRisks.value || {};
      var missing = [];

      mapData = regionsList.map(function (r) {
        var cr = risks[r.region_id];
        if (!cr || cr.risk_score === null || cr.risk_score === undefined) {
          // 没有真实风险分就不着色、也不编一个 50 分出来充数
          missing.push(r.name_cn);
          return {
            name: r.name_cn,
            value: null,
            region_id: r.region_id,
            risk_level: "数据不足",
            pu_sample_count: cr ? cr.pu_sample_count : null,
            snow_level: "—",
            drought_level: "—",
          };
        }
        return {
          name: r.name_cn,
          value: cr.risk_score,
          region_id: r.region_id,
          risk_level: cr.risk_level,
          pu_sample_count: cr.pu_sample_count,
          snow_level: cr.snow_level || "—",
          drought_level: cr.drought_level || "—",
        };
      });

      // 地图会随状态到位重绘数次，同一份告警只需说一次，否则控制台被同一行刷屏
      var missingKey = missing.join("、");
      if (missingKey && missingKey !== lastMissingWarned) {
        lastMissingWarned = missingKey;
        console.warn("[MR] 以下县域缺少综合风险分，不着色：" + missingKey);
      }

      chart.setOption(buildMapOption(res.data, mapData), true);
      renderScaleBar(chart);

      applySelection = function () {
        var focusId = store.selectedRegionId.value;
        var v = viz;
        chart.setOption({
          series: [
            {
              name: "青藏高原 26 县",
              data: mapData.map(function (d) {
                return Object.assign({}, d, {
                  itemStyle:
                    d.region_id === focusId
                      ? {
                          borderColor: v().accent,
                          borderWidth: 2.5,
                          shadowBlur: 12,
                          shadowColor: "rgba(248,250,252,0.4)",
                        }
                      : { borderColor: "rgba(255,255,255,0.28)", borderWidth: 0.8 },
                });
              }),
            },
          ],
        });
      };
      applySelection();

      // 地图是"点击联动"的入口，点击有效县域时改 hash，由 router 统一分发
      chart.off("click");
      chart.on("click", function (params) {
        if (params.data && params.data.region_id) {
          MR.router.go({ region: params.data.region_id });
        }
      });
      chart.off("georoam");
      chart.on("georoam", function () {
        renderScaleBar(chart);
      });
    });
  }

  // --- 前瞻 16 天演化 -------------------------------------------------------
  function renderForecast16() {
    var dom = document.getElementById("chartCockpitForecast");
    if (!dom) return;
    var chart = MR.charts.acquire("cockpitForecast", dom);
    if (!chart) return;
    var v = viz;

    var d = store.currentDisaster.value;
    var series16 = d && d.forecast_series;
    var days = (series16 && series16.days_16) || [];
    var temps = (series16 && series16.temps_16) || [];
    var snow = (series16 && series16.snow_16) || [];

    if (!days.length || !temps.length) {
      chart.clear();
      chart.setOption({ title: MR.theme.emptyTitle() });
      return;
    }

    // 温度轴改为**窗口化**取值（按窗口极值 ±15% 取 nice 区间），不再从 0 基线起。
    // 高原 9 月日均温在 +2 ~ +9℃ 之间震荡，从 0 起的轴会把整条曲线压成一条直线。
    var tMin = Math.min.apply(null, temps);
    var tMax = Math.max.apply(null, temps);
    var pad = Math.max(1, (tMax - tMin) * 0.15);
    var yMin = Math.floor(tMin - pad);
    var yMax = Math.ceil(tMax + pad);

    var maxTempIdx = temps.indexOf(tMax);
    var minTempIdx = temps.indexOf(tMin);

    chart.setOption(
      {
        title: { show: false },
        tooltip: { trigger: "axis" },
        axisPointer: { link: [{ xAxisIndex: "all" }] },
        grid: [
          { top: 30, left: 52, right: 16, height: "38%" },
          { left: 52, right: 16, top: "70%", height: "22%" },
        ],
        xAxis: [
          { type: "category", gridIndex: 0, data: days, axisLabel: { show: false }, axisLine: { lineStyle: { color: v().axis } } },
          { type: "category", gridIndex: 1, data: days, axisLabel: { color: v().textMuted, fontSize: 10, interval: 2 }, axisLine: { lineStyle: { color: v().axis } } },
        ],
        yAxis: [
          MR.theme.axisName("日均温 (℃)", { type: "value", gridIndex: 0, min: yMin, max: yMax, scale: true, axisLine: { show: false } }),
          MR.theme.axisName("积雪深度 (cm)", { type: "value", gridIndex: 1, axisLine: { show: false } }),
        ],
        series: [
          {
            name: "日均温 (℃)",
            type: "line",
            xAxisIndex: 0,
            yAxisIndex: 0,
            data: temps,
            smooth: true,
            symbol: "none",
            lineStyle: { color: v().down, width: 2 },
            areaStyle: { color: "rgba(57,135,229,0.10)" },
            // D+1 与窗口极值打点，让"真实波动"在图上有个可读的锚
            markPoint: {
              symbolSize: 44,
              label: { fontSize: 10, color: v().textMain },
              itemStyle: { color: "rgba(13,20,34,0.9)", borderColor: v().axis, borderWidth: 1 },
              data: [
                { name: "D+1", coord: [0, temps[0]], value: temps[0] },
                { name: "峰值", coord: [maxTempIdx, tMax], value: tMax },
                { name: "谷值", coord: [minTempIdx, tMin], value: tMin },
              ],
            },
          },
          {
            name: "积雪深度 (cm)",
            type: "line",
            xAxisIndex: 1,
            yAxisIndex: 1,
            data: snow,
            smooth: true,
            symbol: "none",
            lineStyle: { color: v().neutral, width: 2 },
            areaStyle: { color: "rgba(127,142,163,0.16)" },
          },
        ],
      },
      true
    );
  }

  var bound = false;
  function bindBus() {
    if (bound) return;
    bound = true;
    MR.bus.on("region", function () {
      if (applySelection) applySelection();
    });
  }

  store.registerRenderer("cockpit", function () {
    bindBus();
    renderMap();
    renderForecast16();
  });

  MR.charts.cockpit = {
    renderMap: renderMap,
    renderForecast16: renderForecast16,
    scaleBar: renderScaleBar,
  };
})(window.MR);
