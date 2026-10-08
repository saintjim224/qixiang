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

  /**
   * 按类目名估算 y 轴左侧需要留多少像素。
   * 此前写死 168，最长的「ECMWF ERA5 逐日格点再分析气候态」会被截掉半句。
   */
  function labelWidth(names) {
    var widest = names.reduce(function (a, b) {
      return MR.fmt.cjkWidth(a, 11, 6) >= MR.fmt.cjkWidth(b, 11, 6) ? a : b;
    }, "");
    return Math.min(280, Math.max(120, Math.ceil(MR.fmt.cjkWidth(widest, 11, 6)) + 18));
  }

  function renderSourceGantt() {
    var dom = document.getElementById("chartSourceGantt");
    if (!dom) return;
    var chart = MR.charts.acquire("sourceGantt", dom);
    if (!chart) return;

    var tiers = store.dataTiers.value || [];
    var tierA = tiers.filter(function (t) {
      return Array.isArray(t.data_sources);
    })[0];

    if (!tierA || !tierA.data_sources || !tierA.data_sources.length) {
      chart.clear();
      chart.setOption({ title: MR.theme.emptyTitle("数据源清单未返回") });
      return;
    }

    var NOW_YEAR = new Date().getFullYear();
    var hist = [];
    var realtime = [];
    (tierA.data_sources || []).forEach(function (s) {
      var range = yearRange(s.range);
      if (range) {
        hist.push({ name: s.name, from: range[0], to: range[1], raw: s });
        return;
      }
      // "前瞻 0-16 天" 这类 range 里根本没有四位年份，过不了 yearRange 的匹配。
      // 早先的写法在这里直接 return 把它丢掉——于是甘特图上凭空少一个数据源，
      // 且没有任何提示。它不是历史序列，画成"当前这一年"的一根短条，
      // 类目名后缀「（前瞻）」把口径带出来，精确区间与说明交给 tooltip。
      realtime.push({
        name: s.name + "（前瞻）",
        from: NOW_YEAR,
        to: NOW_YEAR + 1,
        raw: s,
        realtime: true,
      });
    });
    if (!hist.length && !realtime.length) {
      chart.clear();
      chart.setOption({ title: MR.theme.emptyTitle("数据源年份区间无法解析") });
      return;
    }
    hist.sort(function (a, b) { return a.from - b.from; });
    // 实时前瞻源固定排在最后一行：与历史序列不同源，只是共用同一条时间轴
    var items = hist.concat(realtime);

    var minYear = Math.min.apply(null, items.map(function (i) { return i.from; }));
    var maxYear = Math.max(NOW_YEAR, Math.max.apply(null, items.map(function (i) { return i.to; })));

    var names = items.map(function (i) { return i.name; });
    var rows = items.map(function (i, idx) {
      return {
        value: [idx, i.from, i.to],
        itemStyle: i.realtime
          ? // 实时源用中性色 + 半透明：与四条历史实心条在视觉上不该是一类东西
            { color: viz().neutral, opacity: 0.5 }
          : { color: viz().seq[Math.min(idx, viz().seq.length - 1)] },
      };
    });

    chart.setOption(
      {
        tooltip: {
          trigger: "item",
          formatter: function (p) {
            var it = items[p.value[0]];
            var base =
              "<br/>记录: " + (it.raw.records || "—") + "<br/>要素: " + (it.raw.fields || "—");
            if (it.realtime) {
              return (
                MR.theme.tipTitle(it.raw.name) +
                "<br/>覆盖区间: " + (it.raw.range || "—") +
                base +
                '<br/><span style="color:' + viz().textMuted +
                '">实时滚动窗口，不是历史归档序列；图中横条仅示意其落在当前时段</span>'
              );
            }
            return MR.theme.tipTitle(it.name) + "<br/>覆盖区间: " + it.from + " – " + it.to + base;
          },
        },
        grid: MR.theme.grid({ top: 16, bottom: 34, left: labelWidth(names), right: 26 }),
        xAxis: {
          type: "value",
          min: minYear - 1,
          // 右侧只留 0.4 年余白（写成 +1 会凭空多出一整年的空白，
          // 看上去像"数据覆盖到那一年"，而实际上并没有）。
          max: maxYear + 0.4,
          // 固定 5 年一档：坐标域就是 2001–2026 的历史区间。
          // 不定死的话 ECharts 会把轴末端的余白也画成刻度——图上会莫名出现一个"2027"，
          // 与"某数据源覆盖到 2027"是完全不同的意思。
          interval: 5,
          axisLabel: {
            color: viz().textMuted,
            fontSize: 10,
            // 默认的 {value} 把年份渲染成 "2,025"（千分位）。年份不是数量，不该有千分位。
            formatter: function (val) { return String(Math.round(val)); },
            showMaxLabel: false,
          },
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

    // 三者的量级是 127 : 1373 : 650。原先画环形图，127 那一瓣在圆环上只有 6%，
    // 标签必然叠在一起，"已确证"和"未标注"在视觉上被抹平——而这张图唯一要说清的
    // 恰恰是这三者不可混为一谈。改为横向条形：每一类的绝对条长自己说话。
    var rows = [
      { name: "未标注背景样本", value: verified.totalUnlabeled, color: viz().neutral,
        hint: "无报道记录的月份，不是「无灾害」" },
      { name: "MODIS NPP 参考值", value: nObs, color: viz().seq[1],
        hint: "仅用于 NPP 模型的那一次验证" },
      { name: "已标注事件（待复核）", value: verified.totalVerified, color: viz().seq[0],
        hint: "附官方通报 URL，可逐条溯源" },
    ].filter(function (r) {
      return r.value !== null && r.value !== undefined && isFinite(Number(r.value));
    });

    var total = rows.reduce(function (s, r) { return s + Number(r.value); }, 0);
    var displayRows = rows.slice().reverse();

    chart.setOption(
      {
        tooltip: {
          trigger: "item",
          formatter: function (p) {
            var r = displayRows[p.dataIndex] || {};
            return (
              MR.theme.tipTitle(r.name) +
              "<br/>样本量: <strong>" + p.value + "</strong> 条" +
              '<br/><span style="color:' + viz().textMuted + '">占三类合计 ' +
              ((Number(p.value) / total) * 100).toFixed(1) + "%</span>" +
              '<br/><span style="color:' + viz().textMuted + '">' + (r.hint || "") + "</span>"
            );
          },
        },
        // containLabel 关掉了，左留 152px 给「MODIS NPP 纯观测真值」这类长类目名，
        // 否则会被截断或压到轴上
        grid: MR.theme.grid({ top: 12, bottom: 16, left: 152, right: 64, containLabel: false }),
        xAxis: {
          type: "value",
          axisLabel: { color: viz().textMuted, fontSize: 10 },
          splitLine: { lineStyle: { color: viz().grid } },
          axisLine: { show: false },
        },
        yAxis: {
          type: "category",
          // 倒序：条形图从下往上画，"官方确证正例"要落在最上面那一行
          data: displayRows.map(function (r) { return r.name; }),
          axisLabel: { color: viz().textMuted, fontSize: 11 },
          axisLine: { lineStyle: { color: viz().axis } },
          axisTick: { show: false },
        },
        series: [
          {
            type: "bar",
            barWidth: 22,
            data: displayRows
              .map(function (r) {
                return { value: Number(r.value), itemStyle: { color: r.color, borderRadius: [0, 3, 3, 0] } };
              }),
            label: {
              show: true,
              position: "right",
              color: viz().textMain,
              fontSize: 11,
              formatter: function (p) {
                return p.value + " 条";
              },
            },
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
