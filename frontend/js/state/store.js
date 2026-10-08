/**
 * 全局状态与数据加载。
 *
 * 三条纪律，全部落在这个文件里：
 *   1. **初值一律为 null，不用"看起来正常"的假数字**。旧实现给 SPI 0.42 / GDI 0.58 /
 *      PU 46 分 / 决策 42.5 万元等初值，接口一旦失败，页面就带着这些编造数字继续跑，
 *      读者无从分辨。现在缺失就是 null，模板渲染成状态块。
 *   2. **meta 状态机**：每个数据域有 loading / ok / error / empty 四态，
 *      state !== 'ok' 时不渲染任何数值。
 *   3. **请求序号校验**：快速连续切县时，晚到的旧响应直接丢弃，不覆盖新值。
 */
(function (MR) {
  "use strict";

  var ref = Vue.ref;
  var computed = Vue.computed;
  var reactive = Vue.reactive;
  var api = MR.api;
  var fmt = MR.fmt;

  var DEFAULT_REGION = "naqu-seni";

  // --- meta 状态机 ----------------------------------------------------------
  var meta = reactive({
    regions: "loading",
    countyRisks: "loading",
    provenance: "loading",
    indices: "loading",
    spi: "loading",
    gdi: "loading",
    pu: "loading",
    disaster: "loading",
    decision: "loading",
    priority: "loading",
    benchmarks: "loading",
    puBenchmark: "loading",
    nppBenchmark: "loading",
    verified: "loading",
    dispatch: "loading",
    series: "loading",
    methodCompare: "loading",
  });

  var errors = reactive({});

  /**
   * 状态落点 → 补渲染。
   *
   * 页面里每个图表容器都跟在 `<status-block v-if="meta.X !== 'ok'">` 的 v-else 之后：
   * 该状态还没到 ok 时，容器**根本不在 DOM 里**，此时渲染器 getElementById 拿到 null
   * 就静默返回；等状态到位、Vue 把容器插进来，却没有任何东西再去画它。
   * 症状是"表出来了、图永远空白"，且只在深链直达该页时暴露（手工点页签时数据已就绪）。
   *
   * 因此任何状态**首次**落到 ok 都在 DOM 更新后补渲染一次；同一 tick 内多次落点合并成一次。
   */
  var rerenderScheduled = false;
  function scheduleRerender() {
    if (rerenderScheduled) return;
    rerenderScheduled = true;
    window.Vue.nextTick(function () {
      rerenderScheduled = false;
      renderActiveTab();
    });
  }

  function setMeta(key, state, error) {
    var prev = meta[key];
    meta[key] = state;
    errors[key] = error || "";
    if (state === "ok" && prev !== "ok") scheduleRerender();
  }

  // --- 基础状态 -------------------------------------------------------------
  var currentTab = ref("cockpit");
  var selectedRegionId = ref(DEFAULT_REGION);
  var currentAgeGroup = ref("all");
  var drawerKey = ref("");

  var regions = ref([]);
  var dataTiers = ref([]);
  var provenance = ref(null);
  var nppAnnual = ref({});

  var macroStats = ref({
    totalCounties: null,
    snowWarningCount: null,
    droughtWarningCount: null,
    avgCarryingBalance: null,
    degradedCounties: null,
    realtimeCounties: null,
    snowDataMode: null,
  });

  var countyRisks = ref({});

  var verifyKpi = ref({
    f1Text: "—",
    f1GainText: "—",
    naiveF1Text: "—",
    precisionText: "—",
    rulePrecisionText: "—",
    brierText: "—",
    naiveBrierText: "—",
    nppGainText: "—",
  });

  var puBenchmark = ref(null);
  var nppBenchmark = ref(null);

  var navTabs = [
    { id: "cockpit", label: "风险总览", icon: "ic-map", question: "查看县域风险分布与数据时效" },
    { id: "datasource", label: "数据来源", icon: "ic-sat", question: "查看数据覆盖、来源与适用范围" },
    { id: "index", label: "风险分析", icon: "ic-chart", question: "查看风险指数、影响因子与验证结果" },
    { id: "forecast", label: "趋势预测", icon: "ic-trend", question: "查看天气趋势与草地生产力预测" },
    { id: "decision", label: "应急方案", icon: "ic-shield", question: "测算草料需求并登记模拟处置方案" },
  ];

  var ageGroups = [
    { code: "all", name: "全部牛群 (加权综合)" },
    { code: "calf", name: "犊牛 (0-1岁 极危)" },
    { code: "yearling", name: "育成牛 (1-2岁)" },
    { code: "adult", name: "成年牛 (耐寒)" },
    { code: "old", name: "老龄牛 (弱耐性)" },
  ];

  // 当前选中县的实时监测卡片。初值全部为 null → 渲染为 "—"，
  // 绝不以 0 或任何默认值冒充实测。
  var currentMetrics = ref({
    temp: null,
    tempWindowMean: null,
    tempMin: null,
    snow: null,
    snowDays: null,
    snowLevel: null,
    droughtLevel: null,
    spiVal: null,
    snowLevelCode: null,
    isRealtime: null,
    provenanceNote: "",
  });

  // 接口未返回前一律为 null：模板据此显示状态块而不是"看起来正常"的数值。
  var currentDisaster = ref(null);
  var currentSpi = ref(null);
  var currentGdi = ref(null);
  var currentPuRisk = ref(null);
  var currentDecision = ref(null);

  var spiSummary = ref(null);
  var gdiSummary = ref(null);
  var priorityRanking = ref(null);

  var matrixInsight = ref({
    maxLabel: "—",
    maxValue: "—",
    minLabel: "—",
    seasonSpread: "—",
    grassSpread: "—",
    takeaway: "",
  });

  var methodCompareCache = null;
  var methodComparePending = null;
  var benchmarksPending = null;

  // --- 派生状态 -------------------------------------------------------------
  var currentRegionName = computed(function () {
    var found = regions.value.filter(function (r) {
      return r.region_id === selectedRegionId.value;
    })[0];
    return found ? found.name_cn : "—";
  });

  // 雪灾等级配色跟随真实等级，而不是无条件报警
  var snowLevelBadgeClass = computed(function () {
    var code = currentMetrics.value.snowLevelCode;
    if (code === null || code === undefined) return "badge-muted";
    if (code >= 3) return "badge-danger";
    if (code >= 1) return "badge-warning";
    return "badge-success";
  });

  var snowDepthClass = computed(function () {
    var code = currentMetrics.value.snowLevelCode;
    return code !== null && code >= 1 ? "text-danger" : "";
  });

  // 仅全部县域使用气候态时标记为全域离线降级。
  var snowDataDegraded = computed(function () {
    return macroStats.value.snowDataMode === "climatological";
  });

  var uncertaintyInfo = computed(function () {
    var u = currentDisaster.value && currentDisaster.value.uncertainty;
    if (!u) return null;
    return { sigma: u.sigma_cm, years: u.sample_years, method: u.method };
  });

  /**
   * 预报窗口内**首个积雪深度达到 5 cm 的日序**。
   *
   * 口径限定（必须随数值一并呈现，否则极易被读成"提前预警能力"）：
   * 1) 5.0 cm 是 GB/T 20482 轻度雪灾判据里的**深度下限**，完整判据还要求连续积雪 ≥ 3 天，
   *    这里只按下限逐日筛选，故称"首触阈值日序"，不称"达到轻度雪灾标准"；
   * 2) 它是**预报序列里的第几天**，不是实际灾情发生日；
   * 3) 序列若来自气候态外推（confidence_tier=climatological_projection），
   *    该日序只是历史同期的平均节律，不构成任何提前预警能力。
   * 序列缺失、全为 null 或全程未触阈值时返回 null → 模板渲染为 "—"，绝不回落到 0。
   */
  var SNOW_TRIGGER_CM = 5.0;
  var currentLeadTime = computed(function () {
    var d = currentDisaster.value;
    var series = d && d.forecast_series && d.forecast_series.snow_16;
    if (!Array.isArray(series) || !series.length) return null;
    for (var i = 0; i < series.length; i++) {
      if (series[i] === null || series[i] === undefined) continue;
      var v = Number(series[i]);
      if (isFinite(v) && v >= SNOW_TRIGGER_CM) {
        return {
          days: i + 1,
          thresholdCm: SNOW_TRIGGER_CM,
          windowDays: series.length,
          realtime: !!d.is_realtime,
        };
      }
    }
    return null;
  });

  // 26 县风险等级分布：只列出当天真实存在的计数（空等级也显示 0，但不承诺色阶）
  var riskLevelCounts = computed(function () {
    var all = Object.keys(countyRisks.value).map(function (k) {
      return countyRisks.value[k];
    });
    return ["低风险", "中度风险", "高风险", "重特大预警"].map(function (name) {
      return {
        name: name,
        count: all.filter(function (c) {
          return c.risk_level === name;
        }).length,
      };
    });
  });

  /**
   * 投放效益测算用的两个常数，全部对齐后端口径，前端不新增假设：
   * - 4.2 kg/头·天 = 4.0 kg 干草 × 1.05 牛群均值系数（app/algorithm/carrying.py）；
   * - 0.85 元/kg 为干草情景单价（app/api/decision.py 与 tools/value_metrics_probe.py 同值）。
   * 单价只影响"折算金额"，不影响吨数；接口若改价，需与此处一并核对。
   */
  var FULL_RATION_KG_PER_HEAD_DAY = 4.0 * 1.05;
  var HAY_PRICE_YUAN_PER_KG = 0.85;

  /**
   * 决策页宏观看板。
   * 累积覆盖必须按**图上显示的同一顺序**重算——后端按补饲量排序、前端按风险分排序，
   * 直接用后端的 coverage 会与读者在图上数出来的名次对不上。
   */
  var prioritySummary = computed(function () {
    var d = priorityRanking.value;
    if (!d) return null;
    var t = d.totals || {};
    var rows = (d.counties || []).slice().sort(function (a, b) {
      return (b.risk_score === null ? -1 : b.risk_score) - (a.risk_score === null ? -1 : a.risk_score);
    });
    var totalHay = rows.reduce(function (s, c) {
      return s + (c.hay_tons || 0);
    }, 0);
    var cum = 0, p50 = null, p80 = null;
    rows.forEach(function (c, i) {
      cum += c.hay_tons || 0;
      if (totalHay <= 0) return;
      if (p50 === null && cum / totalHay >= 0.5) p50 = i + 1;
      if (p80 === null && cum / totalHay >= 0.8) p80 = i + 1;
    });

    // 满额兜底口径：不分档、每县每天按 4.0 kg 干草 × 1.05 牛群均值系数足额投喂
    // （与 app/algorithm/carrying.py 的 daily_hay_kg_per_yak 同源）。
    // 这是"若不做分级、一律按满量备料"的对照情景，用于回答"分级到底省下了什么"。
    var herd = Number(d.herd_size_yak);
    var days = Number(d.forecast_days);
    var fullRationTons = null;
    if (isFinite(herd) && isFinite(days) && herd > 0 && days > 0 && rows.length) {
      fullRationTons = fmt.round((FULL_RATION_KG_PER_HEAD_DAY * herd * days * rows.length) / 1000, 1);
    }
    // 差额 ≤ 0 时不给数字：说明当轮分级口径并未低于满额兜底，此时谈"节省"不成立。
    var savingsTons = null;
    if (fullRationTons !== null && t.hay_tons !== null && t.hay_tons !== undefined) {
      var diff = fmt.round(fullRationTons - Number(t.hay_tons), 1);
      savingsTons = diff > 0 ? diff : null;
    }
    var savingsWan =
      savingsTons === null ? null : fmt.round((savingsTons * 1000 * HAY_PRICE_YUAN_PER_KG) / 10000, 1);

    // 逐县授信额度区间：只取接口返回值，区间端点由真实最小值/最大值给出
    var credits = rows
      .map(function (c) {
        return c.credit_quota_wan;
      })
      .filter(function (v) {
        return v !== null && v !== undefined && isFinite(Number(v));
      });
    var creditRange = null;
    if (credits.length) {
      var lo = Math.min.apply(null, credits);
      var hi = Math.max.apply(null, credits);
      // 端点直接沿用接口返回值（后端已保留两位小数），不再二次取整，
      // 否则 137.18 会被 toFixed(1) 成 137.2，与文档口径对不上。
      creditRange = lo === hi ? fmt.num(lo) : fmt.num(lo) + "–" + fmt.num(hi);
    }
    return {
      hayTons: t.hay_tons,
      grainTons: t.grain_tons,
      costWan: t.feed_cost_wan,
      creditWan: t.credit_quota_wan,
      needCount: rows.filter(function (c) {
        return (c.hay_tons || 0) > 0;
      }).length,
      countyCount: t.county_count,
      realtime: d.realtime_counties,
      p50: p50,
      p80: p80,
      scored: rows.filter(function (c) {
        return c.risk_score !== null && c.risk_score !== undefined;
      }).length,
      // --- 投放效益测算的输入与派生（同口径复算，不引入任何新常量来源） ---
      // 养殖规模与窗口长度由接口原值带出：前端不自行假设，接口换了参数这里跟着变。
      herdSize: d.herd_size_yak,
      feedDays: d.forecast_days,
      fullRationTons: fullRationTons,
      savingsTons: savingsTons,
      savingsWan: savingsWan,
      creditRange: creditRange,
      hayPriceYuanPerKg: HAY_PRICE_YUAN_PER_KG,
    };
  });

  /**
   * 数据来源页「覆盖范围」卡。
   * 每一个数字都从已在手的数据派生，不写死任何规模值：
   * 微网格 = 县数 × 4 草场类型 × 4 季节 × 5 生理期，与后端微切片口径同构，
   * 它是**模型派生的分析单元**，不是新增的物理观测站点——卡片文案必须说清这一点。
   */
  var coverageScope = computed(function () {
    var list = Array.isArray(regions.value) ? regions.value : [];
    var provinces = {};
    var pastures = {};
    list.forEach(function (r) {
      if (r && r.province) provinces[r.province] = 1;
      if (r && r.pasture_type) pastures[r.pasture_type] = 1;
    });
    var n = Number(macroStats.value.totalCounties);
    var tierOne = (dataTiers.value || []).filter(function (t) {
      return t && typeof t.tier_name === "string" && t.tier_name.indexOf("公开数据产品") >= 0;
    })[0];
    var products = (tierOne && tierOne.data_sources) || [];
    return {
      counties: macroStats.value.totalCounties,
      provinceCount: Object.keys(provinces).length || null,
      pastureCount: Object.keys(pastures).length || null,
      pastureTypes: Object.keys(pastures),
      microGrids: isFinite(n) && n > 0 ? n * 4 * 4 * 5 : null,
      productCount: products.length || null,
      products: products,
    };
  });

  // --- 加载器 ---------------------------------------------------------------

  function loadRegions() {
    return api.get("/api/overview/regions").then(function (res) {
      if (!res.ok || !Array.isArray(res.data)) {
        setMeta("regions", "error", res.error);
        return;
      }
      regions.value = res.data;
      setMeta("regions", res.data.length ? "ok" : "empty");
    });
  }

  function loadCountyRisks() {
    return api.get("/api/overview/county-risks", { timeout: 60000 }).then(function (res) {
      if (!res.ok || !res.data || !res.data.macro_stats) {
        setMeta("countyRisks", "error", res.error);
        return;
      }
      var ms = res.data.macro_stats;
      macroStats.value = {
        totalCounties: ms.total_counties,
        snowWarningCount: ms.snow_warning_count,
        droughtWarningCount: ms.drought_warning_count,
        avgCarryingBalance: ms.avg_carrying_balance === undefined ? null : ms.avg_carrying_balance,
        degradedCounties: ms.degraded_counties,
        realtimeCounties: ms.realtime_counties,
        snowDataMode: ms.snow_data_mode,
      };
      var dict = {};
      (res.data.counties || []).forEach(function (c) {
        dict[c.region_id] = c;
      });
      countyRisks.value = dict;
      setMeta("countyRisks", res.data.counties && res.data.counties.length ? "ok" : "empty");
      syncCurrentCountyMetrics();
    });
  }

  function loadProvenance() {
    return api.get("/api/datasource/provenance").then(function (res) {
      if (!res.ok) {
        setMeta("provenance", "error", res.error);
        return;
      }
      provenance.value = res.data;
      dataTiers.value = (res.data && res.data.tiers) || [];
      // 「气象灾种 / 非气象灾种」的拆分只存在于 provenance 的 tier 2 里
      // （verified-events 只给 category_distribution）。这里取一次存下，
      // 让口径抽屉不必在前端重复推断哪些类目算气象。
      var tierB = dataTiers.value.filter(function (t) {
        return t.count_meteorological !== undefined;
      })[0];
      if (tierB) {
        meteorologyBreakdown.value = {
          meteorological: tierB.count_meteorological,
          nonMeteorological: tierB.count_non_meteorological,
        };
      }
      setMeta("provenance", dataTiers.value.length ? "ok" : "empty");
    });
  }

  function loadPriorityRanking() {
    return api.get("/api/decision/priority-ranking?herd_size=1000&days=14", { timeout: 30000 }).then(function (res) {
      if (!res.ok || !res.data) {
        setMeta("priority", "error", res.error);
        return;
      }
      // 风险分来自已缓存的 county-risks，不在后端重复计算 SPI/GDI
      var risks = countyRisks.value || {};
      (res.data.counties || []).forEach(function (row) {
        var r = risks[row.region_id];
        row.risk_score = r && r.risk_score !== null && r.risk_score !== undefined ? Number(r.risk_score) : null;
        row.risk_level = r ? r.risk_level : "";
      });
      priorityRanking.value = res.data;
      setMeta("priority", (res.data.counties || []).length ? "ok" : "empty");
    });
  }

  /**
   * 全域 SPI/GDI 新旧方法逐县对照。
   * 这份数据不属于任何一个页签——它服务指数页的哑铃图，也被抽屉里的
   * 「等级被重判 N / 26 县」引用。所以必须在启动时就取，不能等用户切到指数页才拉；
   * 否则从别的页深链进来时，指数页会显示"对照未取得"，把"没请求"说成"没数据"。
   */
  function loadMethodCompare(force) {
    if (methodCompareCache && !force) return Promise.resolve(methodCompareCache);
    if (methodComparePending) return methodComparePending;
    setMeta("methodCompare", "loading");
    methodComparePending = api.get("/api/index/method-compare", { timeout: 30000 }).then(function (res) {
      methodComparePending = null;
      if (!res.ok || !res.data || !res.data.counties) {
        spiSummary.value = null;
        gdiSummary.value = null;
        setMeta("methodCompare", "error", res.error);
        return null;
      }
      methodCompareCache = res.data;
      spiSummary.value = res.data.spi_summary || null;
      gdiSummary.value = res.data.gdi_summary || null;
      setMeta("methodCompare", "ok");
      return res.data;
    });
    return methodComparePending;
  }

  function loadSeries() {
    var rid = selectedRegionId.value;
    return api.get("/api/datasource/series/" + encodeURIComponent(rid)).then(function (res) {
      if (rid !== selectedRegionId.value || res.aborted) return;
      if (!res.ok || !res.data) {
        setMeta("series", "error", res.error);
        return;
      }
      // npp_annual 是 {年份: NPP} 的字典，不是数组——用 .length 判空会恒为空，
      // 于是 25 年真值明明拿到了却被判成 empty 态。必须按键数判断。
      nppAnnual.value = res.data.npp_annual || {};
      setMeta("series", Object.keys(nppAnnual.value).length ? "ok" : "empty");
    });
  }

  function loadIndicesAndDecision() {
    var rid = selectedRegionId.value;
    var seq = ++regionSeq;
    var e = encodeURIComponent(rid);

    var jobs = [
      api.get("/api/index/spi/" + e).then(function (res) {
        if (seq !== regionSeq) return;
        if (!res.ok) { setMeta("spi", "error", res.error); currentSpi.value = null; return; }
        currentSpi.value = res.data;
        setMeta("spi", res.data ? "ok" : "empty");
      }),
      api.get("/api/index/gdi/" + e).then(function (res) {
        if (seq !== regionSeq) return;
        if (!res.ok) { setMeta("gdi", "error", res.error); currentGdi.value = null; return; }
        currentGdi.value = res.data;
        setMeta("gdi", res.data ? "ok" : "empty");
      }),
      api.get("/api/index/pu/" + e).then(function (res) {
        if (seq !== regionSeq) return;
        if (!res.ok) {
          setMeta("pu", "error", res.status === 503 ? "当前数据条件下无法完成风险评估，请查看数据来源与覆盖范围。" : res.error);
          currentPuRisk.value = null;
          return;
        }
        currentPuRisk.value = res.data;
        setMeta("pu", res.data ? "ok" : "empty");
      }),
      api.get("/api/decision/signal/" + e).then(function (res) {
        if (seq !== regionSeq) return;
        if (!res.ok) { setMeta("decision", "error", res.error); currentDecision.value = null; return; }
        currentDecision.value = res.data;
        setMeta("decision", res.data ? "ok" : "empty");
      }),
      api.get("/api/forecast/disaster/" + e + "?days=30", { timeout: 60000 }).then(function (res) {
        if (seq !== regionSeq) return;
        if (!res.ok) { setMeta("disaster", "error", res.error); currentDisaster.value = null; return; }
        currentDisaster.value = res.data;
        setMeta("disaster", res.data ? "ok" : "empty");
      }),
    ];
    return Promise.all(jobs).then(function () {
      if (seq === regionSeq) setMeta("indices", "ok");
    });
  }

  function loadBenchmarks() {
    if (benchmarksPending) return benchmarksPending;
    function loadOne(key, url, target, valid) {
      if (meta[key] === "ok") return Promise.resolve();
      setMeta(key, "loading");
      // 首次完整拟合可能超过 10 秒；各协议独立反馈，失败后可单独重试。
      return api.get(url, { timeout: 60000 }).then(function (res) {
        if (res.ok && valid(res.data)) {
          target.value = res.data;
          setMeta(key, "ok");
          deriveVerifyKpis();
        } else {
          target.value = null;
          setMeta(key, "error", res.error || "验证结果结构不完整");
        }
      });
    }
    benchmarksPending = Promise.all([
      loadOne("puBenchmark", "/api/index/pu-benchmark", puBenchmark, function (data) {
        return data && data.benchmark_results && data.evaluation;
      }),
      loadOne("nppBenchmark", "/api/forecast/npp-benchmark", nppBenchmark, function (data) {
        return data && data.loyo_protocol && data.loro_protocol;
      }),
    ]).then(function () {
      benchmarksPending = null;
      var ok = meta.puBenchmark === "ok" && meta.nppBenchmark === "ok";
      setMeta("benchmarks", ok ? "ok" : "error", errors.puBenchmark || errors.nppBenchmark);
    });
    return benchmarksPending;
  }

  /** 四个模型验证指标全部现算，不写死；取不到则保持 "—"。 */
  function deriveVerifyKpis() {
    var next = {};
    var puB = puBenchmark.value;
    if (puB && puB.benchmark_results) {
      var models = puB.benchmark_results;
      var pu = models["Model 3 (PU Learning Model)"];
      var naive = models["Baseline 2 (Naive Supervised)"];
      var rule = models["Baseline 1 (Rule-based)"];
      if (pu) {
        next.f1Text = Number(pu.f1_score).toFixed(4);
        next.precisionText = Number(pu.precision).toFixed(4);
        next.brierText = Number(pu.brier_score).toFixed(4);
      }
      if (naive) {
        next.naiveF1Text = Number(naive.f1_score).toFixed(4);
        next.naiveBrierText = Number(naive.brier_score).toFixed(4);
      }
      if (rule) next.rulePrecisionText = Number(rule.precision).toFixed(4);
      if (pu && naive && naive.f1_score > 0) {
        var gain = (pu.f1_score / naive.f1_score - 1) * 100;
        next.f1GainText = (gain >= 0 ? "+" : "") + gain.toFixed(1) + "%";
      }
    }
    var nppB = nppBenchmark.value;
    if (nppB && nppB.loyo_protocol && nppB.loyo_protocol.models) {
      var ms = nppB.loyo_protocol.models;
      var key = Object.keys(ms).filter(function (k) {
        return k.indexOf("本系统方法") >= 0;
      })[0];
      if (key) {
        var g = Number(ms[key].reduction_vs_b1_pct);
        if (Number.isFinite(g)) next.nppGainText = (g >= 0 ? "+" : "") + g.toFixed(1) + "%";
      }
    }
    verifyKpi.value = Object.assign({}, verifyKpi.value, next);
  }

  // --- 选中县联动 -----------------------------------------------------------
  var regionSeq = 0;

  function syncCurrentCountyMetrics() {
    var cr = countyRisks.value[selectedRegionId.value];
    if (!cr) {
      currentMetrics.value = {
        temp: null, tempWindowMean: null, tempMin: null, snow: null, snowDays: null,
        snowLevel: null, droughtLevel: null, spiVal: null, snowLevelCode: null,
        isRealtime: null, provenanceNote: "",
      };
      return;
    }
    currentMetrics.value = {
      temp: fmt.signed(cr.temp),
      tempWindowMean: fmt.signed(cr.temp_window_mean),
      tempMin: fmt.signed(cr.temp_min),
      snow: cr.snow_depth === null || cr.snow_depth === undefined ? null : String(cr.snow_depth),
      snowDays: cr.continuous_snow_days === null || cr.continuous_snow_days === undefined ? null : String(cr.continuous_snow_days),
      snowLevel: cr.snow_level,
      droughtLevel: cr.drought_level,
      spiVal: fmt.signed(cr.spi_value, 2),
      snowLevelCode: cr.snow_level_code === undefined ? null : cr.snow_level_code,
      isRealtime: cr.is_realtime === undefined ? null : cr.is_realtime,
      provenanceNote: cr.provenance_note || "",
    };
  }

  /**
   * 切换县域。
   * @param {string} rid
   * @param {{syncUrl?:boolean, replace?:boolean}} opts
   */
  function clearCountyData() {
    currentSpi.value = null;
    currentGdi.value = null;
    currentPuRisk.value = null;
    currentDecision.value = null;
    currentDisaster.value = null;
    nppAnnual.value = {};
    matrixInsight.value = {
      maxLabel: "—", maxValue: "—", minLabel: "—", seasonSpread: "—", grassSpread: "—",
      takeaway: "正在加载本县矩阵…",
    };
    ["spi", "gdi", "pu", "decision", "disaster", "series"].forEach(function (key) {
      setMeta(key, "loading");
    });
  }

  function setRegion(rid, opts) {
    var o = opts || {};
    if (!rid || rid === selectedRegionId.value) {
      if (o.syncUrl) MR.router.sync({ region: selectedRegionId.value, tab: currentTab.value, ag: currentAgeGroup.value });
      return Promise.resolve();
    }
    selectedRegionId.value = rid;
    // 县域切换后旧数据立刻失效，先把可见数值清空，避免"新县名 + 旧县数字"的串台
    clearCountyData();
    syncCurrentCountyMetrics();
    if (o.syncUrl !== false) {
      var patch = { region: rid, tab: currentTab.value, ag: currentAgeGroup.value };
      if (o.replace) MR.router.sync(patch);
      else MR.router.sync(patch); // 县域选择统一用 replace，不污染历史
    }
    MR.bus.emit("region", rid);
    var pending = Promise.all([loadIndicesAndDecision(), loadSeries()]);
    renderActiveTab();
    return pending.then(function () {
      renderActiveTab();
    });
  }

  function onRegionChange(rid) {
    // 下拉框传入目标值，由 setRegion 原子地更新县域及数据状态。
    return setRegion(rid, { syncUrl: true, replace: true });
  }

  function switchAgeGroup(code) {
    currentAgeGroup.value = code;
    MR.router.sync({ ag: code, tab: currentTab.value, region: selectedRegionId.value });
    renderActiveTab();
  }

  // --- Tab 渲染分发（唯一一份） ---------------------------------------------
  var TAB_RENDERERS = {
    cockpit: [],
    datasource: [],
    index: [],
    forecast: [],
    decision: [],
  };

  function registerRenderer(tab, fn) {
    if (TAB_RENDERERS[tab] && TAB_RENDERERS[tab].indexOf(fn) < 0) TAB_RENDERERS[tab].push(fn);
  }

  function renderActiveTab() {
    var list = TAB_RENDERERS[currentTab.value] || [];
    list.forEach(function (fn) {
      try {
        fn();
      } catch (e) {
        console.error("[MR] 渲染 " + currentTab.value + " 失败：", e);
      }
    });
  }

  function switchTab(tabId) {
    MR.router.go({ tab: tabId });
  }

  function navigateTo(tab, regionId) {
    var patch = { tab: tab };
    if (regionId) patch.region = regionId;
    if (currentAgeGroup.value !== "all") patch.ag = currentAgeGroup.value;
    MR.router.go(patch);
  }

  // 由 router 在 hashchange 时回调；这是全站唯一的导航入口
  function applyRoute(route) {
    var tabChanged = route.tab && route.tab !== currentTab.value;
    var regionChanged = route.region && route.region !== selectedRegionId.value;
    var agChanged = route.ag && route.ag !== currentAgeGroup.value;

    if (route.tab) currentTab.value = route.tab;
    if (tabChanged) Vue.nextTick(function () { window.scrollTo({ top: 0, behavior: "auto" }); });
    drawerKey.value = route.drawer || "";
    if (route.ag) currentAgeGroup.value = route.ag;

    var tasks = [];
    if (regionChanged) {
      selectedRegionId.value = route.region;
      clearCountyData();
      syncCurrentCountyMetrics();
      MR.bus.emit("region", route.region);
      tasks.push(loadIndicesAndDecision(), loadSeries());
      renderActiveTab();
    }

    // 仅 tab 变化而 region 未变时不重新拉数据，只重绘当前页
    if (!regionChanged) {
      tasks.push(Promise.resolve());
    }

    return Promise.all(tasks).then(function () {
      if (tabChanged || regionChanged || agChanged) {
        // 先渲染（新页签的容器此刻已可见，ECharts 能拿到真实尺寸），
        // 再对既有实例做一次 resize，兜住"在隐藏状态下被创建"的图。
        Vue.nextTick(function () {
          renderActiveTab();
          MR.charts.resizeOf(allChartNames());
        });
      }
    });
  }

  function allChartNames() {
    return MR.charts.names();
  }

  // --- 官方确证事件 ---------------------------------------------------------
  var verifiedEvents = ref([]);
  var verifiedStatsRaw = ref({ totalVerified: null, totalUnlabeled: null, types: {} });
  var meteorologyBreakdown = ref({ meteorological: null, nonMeteorological: null });

  // 事件总数来自 verified-events，气象/非气象拆分来自 provenance 的 tier 2。
  // 两处都是后端实时统计，前端只做合并，不各自复写一份计数。
  var verifiedStats = computed(function () {
    return Object.assign({}, verifiedStatsRaw.value, meteorologyBreakdown.value);
  });
  var verifiedSelectedCategory = ref("全部");
  var verifiedCategories = ref(["全部"]);

  function loadVerifiedEvents(category) {
    var cat = category === undefined || category === null ? verifiedSelectedCategory.value : category;
    var url = cat && cat !== "全部"
      ? "/api/datasource/verified-events?category=" + encodeURIComponent(cat) + "&limit=200"
      : "/api/datasource/verified-events?limit=200";
    return api.get(url).then(function (res) {
      if (!res.ok || !res.data) {
        setMeta("verified", "error", res.error);
        return;
      }
      verifiedEvents.value = res.data.events || [];
      verifiedStatsRaw.value = {
        totalVerified: res.data.total_verified_count,
        totalUnlabeled: res.data.total_unlabeled_count,
        types: res.data.category_distribution || {},
      };
      if (res.data.categories_ordered && res.data.categories_ordered.length) {
        verifiedCategories.value = res.data.categories_ordered;
      }
      setMeta("verified", verifiedEvents.value.length ? "ok" : "empty");
    });
  }

  function filterVerifiedEvents(cat) {
    verifiedSelectedCategory.value = cat;
    loadVerifiedEvents(cat);
  }

  var CATEGORY_TONE = {
    "暴雪与雪灾": "cat-snow",
    "暴雨洪涝": "cat-rain",
    "政策农险赔付实证": "cat-insure",
    "强对流天气": "cat-convective",
    "次生地质灾害": "cat-geo",
    "干旱与草场压力": "cat-drought",
    "寒潮与复合": "cat-cold",
  };

  function categoryTagClass(cat) {
    return CATEGORY_TONE[cat] || "cat-other";
  }

  // --- 本地模拟处置记录 -----------------------------------------------------
  var dispatchLogs = ref([]);
  // 初值不再写死 "2 笔 / 55.8 吨 / 11.1 吨"：那是演示样例的数字，
  // 挂在 KPI 位置会被读成真实累计调拨量。未加载 + 未加载完一律为 null。
  var dispatchStats = ref({ count: null, hay: null, grain: null });
  var dispatchSubmitting = ref(false);
  var dispatchToast = ref("");
  var dispatchToastTone = ref("");
  var dispatchForm = ref({ hay_tons: null, grain_tons: null, action_type: "应急补饲与转场防寒", operator_role: "平台演示操作员", memo: "" });

  var feedDemand = computed(function () {
    return (currentDecision.value && currentDecision.value.emergency_feed_demand) || null;
  });

  // 建议值缺失时禁止登记，不能用占位数字冒充测算结果。
  var dispatchReady = computed(function () {
    var f = feedDemand.value;
    return !!(f && f.recommended_hay_tons !== null && f.recommended_hay_tons !== undefined);
  });

  function loadDispatchLogs() {
    return api.get("/api/decision/dispatch-logs").then(function (res) {
      if (!res.ok || !res.data) {
        setMeta("dispatch", "error", res.error);
        return;
      }
      dispatchLogs.value = res.data.logs || [];
      dispatchStats.value = {
        count: res.data.count,
        hay: res.data.total_dispatched_hay_tons,
        grain: res.data.total_dispatched_grain_tons,
      };
      setMeta("dispatch", "ok");
    });
  }

  function toast(msg, tone) {
    dispatchToast.value = msg;
    dispatchToastTone.value = tone || "ok";
    setTimeout(function () {
      dispatchToast.value = "";
    }, 6000);
  }

  function submitDispatch() {
    if (dispatchSubmitting.value) return Promise.resolve();
    var f = feedDemand.value;
    if (!f || f.recommended_hay_tons === null || f.recommended_hay_tons === undefined) {
      toast("当前县域的补饲需求暂不可用，请稍后再登记模拟方案", "err");
      return Promise.resolve();
    }
    var hayTons = Number(dispatchForm.value.hay_tons !== null && dispatchForm.value.hay_tons !== "" ? dispatchForm.value.hay_tons : f.recommended_hay_tons);
    var grainTons = Number(dispatchForm.value.grain_tons !== null && dispatchForm.value.grain_tons !== "" ? dispatchForm.value.grain_tons : f.recommended_grain_tons);
    if (!Number.isFinite(hayTons) || !Number.isFinite(grainTons) || hayTons < 0 || grainTons < 0) {
      toast("计划草料数量须为不小于 0 的有效数值", "err");
      return Promise.resolve();
    }
    dispatchSubmitting.value = true;
    dispatchToast.value = "";

    var payload = {
      region_id: selectedRegionId.value,
      hay_tons: hayTons,
      grain_tons: grainTons,
      action_type: dispatchForm.value.action_type,
      operator_role: dispatchForm.value.operator_role,
      memo: dispatchForm.value.memo ||
        "针对" + currentRegionName.value + "计划开展" + dispatchForm.value.action_type +
        "，计划干草" + hayTons + "吨、精饲料" + grainTons + "吨",
    };

    return api.post("/api/decision/dispatch", payload).then(function (res) {
      if (res.ok && res.data) {
        toast("模拟处置 [" + res.data.dispatch_id + "] 已保存至本地记录", "ok");
        dispatchForm.value.hay_tons = null;
        dispatchForm.value.grain_tons = null;
        return loadDispatchLogs();
      }
      toast("保存失败：" + (res.error || "服务端未接受该请求"), "err");
    }).then(function () {
      dispatchSubmitting.value = false;
    });
  }

  // --- 展示用派生量（只做投影，不产生新数值） --------------------------------
  // 模板里不用 ?? 与 ?. —— 浏览器内编译的模板表达式跨 Vue 小版本支持度不一致，
  // 统一走 orDash，null / undefined / 空串一律显示为 "—"，其余（含 0）原样输出。
  function orDash(v) {
    return v === null || v === undefined || v === "" ? "—" : v;
  }

  function signedPct(v) {
    if (v === null || v === undefined || v === "") return "—";
    var n = Number(v);
    if (!isFinite(n)) return "—";
    return (n >= 0 ? "+" : "") + n.toFixed(1) + "%";
  }

  var PU_ORDER = [
    { key: "Baseline 1 (Rule-based)", fallback: "基线 1 · 规则评分", ours: false },
    { key: "Baseline 2 (Naive Supervised)", fallback: "基线 2 · 未标注当负例", ours: false },
    { key: "Model 3 (PU Learning Model)", fallback: "本项目 · PU Learning", ours: true },
    // 第三方 pulearn 的 Elkan-Noto 独立实现。放在最后是因为它是**外部佐证**，
    // 不是本项目的模型；排序上也避免让人误读成"我们的第四个模型"。
    { key: "Baseline 4 (Elkan-Noto PU)", fallback: "基线 4 · Elkan-Noto (第三方)", ours: false },
  ];

  var MODEL3_KEY = "Model 3 (PU Learning Model)";
  var ELKAN_KEY = "Baseline 4 (Elkan-Noto PU)";

  /** PU 对照表：行来自接口，顺序与标签由接口的 name_cn 决定，前端不编数值。 */
  var puRows = computed(function () {
    var b = puBenchmark.value;
    if (!b || !b.benchmark_results) return [];
    return PU_ORDER.filter(function (o) {
      return b.benchmark_results[o.key];
    }).map(function (o) {
      var m = b.benchmark_results[o.key];
      // available === false 表示该对照根本没跑起来（如缺 pulearn 库）。
      // 此时六列指标全为 null，由模板显示"未安装，跳过该对照"，
      // 绝不能渲染成 0——那是把"没测"说成了"测得 0 分"。
      var available = m.available !== false;
      return {
        key: o.key,
        name_cn: m.name_cn || o.fallback,
        ours: !!o.ours,
        available: available,
        unavailable_reason: m.unavailable_reason || "",
        accuracy: available ? m.accuracy : null,
        precision: available ? m.precision : null,
        recall: available ? m.recall : null,
        unlabeled_alert_rate: available ? m.unlabeled_alert_rate : null,
        f1_score: available ? m.f1_score : null,
        brier_score: available ? m.brier_score : null,
      };
    });
  });

  /**
   * 对照结论必须现算，不能写死。
   *
   * 只比较当次返回的记录标签诊断指标；不把指标名次当作真实灾害效果。
   * 历史随机划分结果已弃用，不在前端保留固定实验数值。
   */
  var puVerdict = computed(function () {
    var rows = puRows.value.filter(function (r) {
      return r.available && isFinite(Number(r.f1_score));
    });
    if (!rows.length) return null;

    var bestF1 = rows[0], bestBrier = rows[0];
    rows.forEach(function (r) {
      if (Number(r.f1_score) > Number(bestF1.f1_score)) bestF1 = r;
      if (Number(r.brier_score) < Number(bestBrier.brier_score)) bestBrier = r;
    });

    var ours = null;
    rows.forEach(function (r) {
      if (r.key === MODEL3_KEY) ours = r;
    });
    var elkan = null;
    rows.forEach(function (r) {
      if (r.key === ELKAN_KEY) elkan = r;
    });

    return {
      bestF1: bestF1,
      bestBrier: bestBrier,
      ours: ours,
      elkan: elkan,
      // 结论只在"当次真正跑起来的行"范围内成立，行数必须一起说出去
      nAvailable: rows.length,
      nTotal: puRows.value.length,
      // 有对照行没跑起来时，把原因一并带出来，供页面如实说明
      unavailableReason: (function () {
        var skip = puRows.value.filter(function (r) {
          return !r.available;
        })[0];
        return skip ? (skip.name_cn + "：" + skip.unavailable_reason) : "";
      })(),
      // 只有两项都确实由本项目模型拿下时，才允许说"双优"
      oursDominates:
        !!ours &&
        bestF1.key === MODEL3_KEY &&
        bestBrier.key === MODEL3_KEY,
      /** 第三方实现是否给出同向佐证：两者 F1 都远高于朴素监督基线 */
      thirdPartyAgrees: (function () {
        if (!ours || !elkan) return false;
        var naive = null;
        rows.forEach(function (r) {
          if (r.key === "Baseline 2 (Naive Supervised)") naive = r;
        });
        if (!naive) return false;
        return (
          Number(elkan.f1_score) > Number(naive.f1_score) &&
          Number(ours.f1_score) > Number(naive.f1_score)
        );
      })(),
    };
  });

  function puRow(key, field) {
    var b = puBenchmark.value;
    if (!b || !b.benchmark_results || !b.benchmark_results[key]) return null;
    var v = b.benchmark_results[key][field];
    return v === undefined ? null : v;
  }

  /** LOYO / LORO 两张协议表，全部字段原样来自接口。 */
  var protocolList = computed(function () {
    var b = nppBenchmark.value;
    if (!b) return [];
    return ["loyo_protocol", "loro_protocol"]
      .filter(function (k) {
        return b[k];
      })
      .map(function (k) {
        var p = b[k];
        var models = p.models || {};
        // 固定按 基线1 → 基线2 → 基线3 → 本系统方法 排列，
        // 否则 Object.keys 的顺序一旦变化，表头下的行就会错位。
        var keys = Object.keys(models).sort(function (a, c) {
          var rank = function (s) {
            if (s.indexOf("Baseline 1") >= 0) return 0;
            if (s.indexOf("Baseline 2") >= 0) return 1;
            if (s.indexOf("Baseline 3") >= 0) return 2;
            return 3;
          };
          return rank(a) - rank(c);
        });
        return {
          key: k,
          protocol: p.protocol,
          n_folds: p.n_folds,
          n_samples: p.n_samples,
          rows: keys.map(function (name) {
            var m = models[name];
            return {
              name: name,
              isOurs: name.indexOf("本系统方法") >= 0,
              mae: m.mae,
              mae_ci95: m.mae_ci95,
              rmse: m.rmse,
              rmse_ci95: m.rmse_ci95,
              r2: m.r2,
              reduction_vs_b1_pct: m.reduction_vs_b1_pct,
              reduction_vs_b2_pct: m.reduction_vs_b2_pct,
              reduction_vs_b3_pct: m.reduction_vs_b3_pct,
            };
          }),
        };
      });
  });

  // --- 方法论胶囊：把长段口径压成可扫读的 key:value，完整文字仍在抽屉里 -----

  var spiChips = computed(function () {
    var s = spiSummary.value;
    if (!s) return [];
    return [
      { k: "等级被重判", v: orDash(s.level_changed) + " / " + orDash(s.compared_counties) + " 县" },
      { k: "|ΔSPI| 均值", v: orDash(s.mean_abs_delta) },
      { k: "|ΔSPI| 最大", v: orDash(s.max_abs_delta) },
      { k: "拟合方式", v: "Gamma MLE + 零降水概率 q" },
      { k: "分级标准", v: "GB/T 20481-2017" },
    ];
  });

  var gdiChips = computed(function () {
    var s = gdiSummary.value;
    var g = currentGdi.value;
    if (!s) return [];
    return [
      { k: "等级被重判", v: orDash(s.level_changed) + " / " + orDash(s.compared_counties) + " 县" },
      { k: "|ΔGDI| 均值", v: orDash(s.mean_abs_delta) },
      { k: "PC1 方差贡献", v: g && g.pca_variance_ratio !== undefined ? (g.pca_variance_ratio * 100).toFixed(1) + "%" : "—" },
      { k: "构成指标", v: "NPP / NDVI / 植被覆盖 / 产草量" },
      { k: "脆弱系数", v: "草甸 0.70 · 草原 1.00 · 荒漠 1.35" },
    ];
  });

  var nppChips = computed(function () {
    var b = nppBenchmark.value;
    var loyo = b && b.loyo_protocol;
    var loro = b && b.loro_protocol;
    return [
      { k: "验证协议", v: "双向留一（LOYO 留年验证 + LORO 留县验证）" },
      { k: "遥感产品参考值", v: loyo ? orDash(loyo.n_samples) + " 条 MODIS 年度 NPP" : "—" },
      { k: "LOYO 轮数", v: loyo ? orDash(loyo.n_folds) + " 轮" : "—" },
      { k: "LORO 轮数", v: loro ? orDash(loro.n_folds) + " 轮" : "—" },
      { k: "基线方案", v: "气候态均值 / 线性趋势 / 近 3 年移动平均" },
    ];
  });

  var priorityChips = computed(function () {
    var s = prioritySummary.value;
    return [
      { k: "合成权重", v: "SPI 0.40 · GDI 0.30 · PU 0.15 · 载畜压力 0.15" },
      { k: "补饲档位依据", v: "模型参考阈值 + 窗口均温与平均积雪" },
      { k: "覆盖口径", v: "按本图自上而下顺序重算" },
      { k: "实时驱动", v: s ? orDash(s.realtime) + " / " + orDash(s.countyCount) + " 县" : "—" },
      { k: "数据性质", v: "下游应用模拟建议值，非观测事实" },
    ];
  });

  /** 五灾种一览：雪灾 / 寒潮 / 大风 / 干旱 / 霜冻，等级一律取接口原值。 */
  var disasterChips = computed(function () {
    var d = currentDisaster.value;
    var s = d && d.disaster_summary;
    if (!s) return [];
    return [
      { k: "雪灾", v: orDash(s.snow && s.snow.level_cn) },
      { k: "寒潮", v: orDash(s.cold_wave && s.cold_wave.risk) },
      { k: "大风", v: orDash(s.gale && s.gale.risk) },
      { k: "霜冻", v: orDash(s.frost && s.frost.risk) },
      { k: "干旱 SPI-3", v: orDash(s.drought && s.drought.level_spi_3) },
    ];
  });

  // --- 启动 -----------------------------------------------------------------
  function init() {
    MR.charts.bindWindowResize();
    // 独立加载基准结果，不阻塞首屏与县域业务数据。
    var first = Promise.all([loadRegions(), loadCountyRisks(), loadProvenance()]);
    var second = first.then(function () {
      return Promise.all([
        loadPriorityRanking(),
        loadSeries(),
        loadIndicesAndDecision(),
        loadDispatchLogs(),
        loadMethodCompare(false),
      ]);
    });
    second.then(function () {
      loadVerifiedEvents();
      renderActiveTab();
    });
    loadBenchmarks();
    return second;
  }

  MR.store = {
    // state
    meta: meta, errors: errors,
    currentTab: currentTab, selectedRegionId: selectedRegionId, currentAgeGroup: currentAgeGroup,
    drawerKey: drawerKey, regions: regions, dataTiers: dataTiers, provenance: provenance,
    nppAnnual: nppAnnual, macroStats: macroStats, countyRisks: countyRisks, verifyKpi: verifyKpi,
    puBenchmark: puBenchmark, nppBenchmark: nppBenchmark,
    currentMetrics: currentMetrics, currentDisaster: currentDisaster, currentSpi: currentSpi,
    currentGdi: currentGdi, currentPuRisk: currentPuRisk, currentDecision: currentDecision,
    feedDemand: feedDemand, dispatchReady: dispatchReady,
    spiSummary: spiSummary, gdiSummary: gdiSummary, priorityRanking: priorityRanking,
    matrixInsight: matrixInsight, navTabs: navTabs, ageGroups: ageGroups,
    currentRegionName: currentRegionName, snowLevelBadgeClass: snowLevelBadgeClass,
    snowDepthClass: snowDepthClass, snowDataDegraded: snowDataDegraded,
    uncertaintyInfo: uncertaintyInfo, riskLevelCounts: riskLevelCounts, prioritySummary: prioritySummary,
    currentLeadTime: currentLeadTime, coverageScope: coverageScope,
    verifiedEvents: verifiedEvents, verifiedStats: verifiedStats,
    verifiedSelectedCategory: verifiedSelectedCategory, verifiedCategories: verifiedCategories,
    dispatchLogs: dispatchLogs, dispatchStats: dispatchStats, dispatchSubmitting: dispatchSubmitting,
    dispatchToast: dispatchToast, dispatchToastTone: dispatchToastTone, dispatchForm: dispatchForm,
    // actions
    init: init, applyRoute: applyRoute, switchTab: switchTab, navigateTo: navigateTo,
    setRegion: setRegion, onRegionChange: onRegionChange, switchAgeGroup: switchAgeGroup,
    registerRenderer: registerRenderer, renderActiveTab: renderActiveTab,
    loadVerifiedEvents: loadVerifiedEvents, filterVerifiedEvents: filterVerifiedEvents,
    categoryTagClass: categoryTagClass, submitDispatch: submitDispatch,
    loadBenchmarks: loadBenchmarks, loadMethodCompare: loadMethodCompare,
    // 展示用派生量
    puRows: puRows, puRow: puRow, protocolList: protocolList, puVerdict: puVerdict,
    spiChips: spiChips, gdiChips: gdiChips, nppChips: nppChips, priorityChips: priorityChips,
    disasterChips: disasterChips, orDash: orDash, signedPct: signedPct,
    get methodCompareCache() { return methodCompareCache; },
    set methodCompareCache(v) { methodCompareCache = v; },
    spiSummaryRef: spiSummary, gdiSummaryRef: gdiSummary,
  };
})(window.MR);
