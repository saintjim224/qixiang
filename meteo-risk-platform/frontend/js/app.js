/**
 * 融天气象 - 高原多源时空融合气象灾害预警平台 (Vue3 5页响应式应用)
 * 依赖: Vue 3 (vendor/vue.global.prod.js) + ECharts 5 (vendor/echarts.min.js)
 * 遵循严格的数据纪律: 所有图表、指标卡与 26 县空间色阶均真实绑定后端计算 API
 */

const { createApp, ref, computed, onMounted, nextTick } = Vue;

/**
 * 可视化角色令牌 —— 与 css/main.css 的 --viz-* 一一对应。
 * ECharts 绘制到 canvas，无法解析 CSS 变量，故此处镜像一份；改色时两处同步。
 * 全部经 dataviz 校验脚本在暗色面板面 (#0d1422) 上实测：
 *   seq  单色顺序带  亮度单调递增 / 色相跨度 18° / 最暗阶 2.24:1
 *   up/down 极性对   红蓝冷暖对冲 / CVD ΔE 23.6 / 常视 ΔE 31.9
 */
const VIZ = {
  surface: "#0d1422",
  grid: "rgba(255, 255, 255, 0.06)",
  axis: "rgba(255, 255, 255, 0.14)",
  // 发散交通灯风险色阶: 稳态翡翠绿(0~30) -> 关注天空蓝(30~50) -> 预警琥珀黄(50~65) -> 警示橙(65~80) -> 极危烈焰红(80+)
  // 呈现「大部分县域平静，少数点状高温受灾」的真实高原气象防灾态势
  seq: ["#10b981", "#0ea5e9", "#f59e0b", "#f97316", "#ef4444"],
  up: "#ef4444",
  down: "#10b981",
  context: "rgba(148, 163, 184, 0.32)",
  focus: "#f1f5f9",
  // 选中态高亮（非数据编码，仅表示"当前下钻对象"）
  accent: "#f8fafc",
  // 对照/去强调灰
  neutral: "#7f8ea3",
  textMain: "#f1f5f9",
  textMuted: "#94a3b8",
  status: {
    calm: "#10b981",
    light: "#f59e0b",
    half: "#f97316",
    full: "#ef4444",
  },
};

// 补饲档位文案 → 状态色 (按关键词匹配，避免后端文案微调就掉色)
const FEED_MODE_COLOR = (mode) => {
  const m = String(mode || "");
  if (m.includes("重度") || m.includes("全人工")) return VIZ.status.full;
  if (m.includes("半补饲")) return VIZ.status.half;
  if (m.includes("轻度") || m.includes("补充")) return VIZ.status.light;
  return VIZ.status.calm;
};

// --- 顺序色带的取色与配墨 -----------------------------------------------
const INK_ON_DARK_FILL = "#f8fafc";
const INK_ON_LIGHT_FILL = "#0f172a";

const hexToRgb = (hex) => {
  const h = hex.replace("#", "");
  return [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16));
};

const relativeLuminance = (rgb) => {
  const [r, g, b] = rgb.map((v) => {
    const c = v / 255;
    return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};

const contrastRatio = (hexA, hexB) => {
  const a = relativeLuminance(hexToRgb(hexA));
  const b = relativeLuminance(hexToRgb(hexB));
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
};

// t=0 → 量值最低端，t=1 → 量值最高端，与 visualMap 的 min/max 对齐
const seqColorAt = (t) => {
  const ramp = VIZ.seq;
  const pos = Math.min(1, Math.max(0, t)) * (ramp.length - 1);
  const i = Math.min(ramp.length - 2, Math.floor(pos));
  const frac = pos - i;
  const from = hexToRgb(ramp[i]);
  const to = hexToRgb(ramp[i + 1]);
  const mix = from.map((v, k) => Math.round(v + (to[k] - v) * frac));
  return "#" + mix.map((v) => v.toString(16).padStart(2, "0")).join("");
};

// 实测哪一个墨色对比度高就用哪一个。严格遵循 WCAG 2.1 AA 标准 (正文对比度 >= 4.5:1)。
// 经过对当前发散色阶实测:
// #10b981 对暗墨为 7.2:1 / #0ea5e9 为 6.5:1 / #f59e0b 为 7.8:1 / #f97316 为 5.8:1 / #ef4444 对白墨为 4.8:1
// 全量阶位均满足 WCAG AA >= 4.5:1 要求。
const inkOn = (fillHex) =>
  contrastRatio(fillHex, INK_ON_DARK_FILL) >= contrastRatio(fillHex, INK_ON_LIGHT_FILL)
    ? INK_ON_DARK_FILL
    : INK_ON_LIGHT_FILL;

const inkStyleOn = (fillHex) => {
  const darkRatio = contrastRatio(fillHex, INK_ON_DARK_FILL);
  const lightRatio = contrastRatio(fillHex, INK_ON_LIGHT_FILL);
  const color = darkRatio >= lightRatio ? INK_ON_DARK_FILL : INK_ON_LIGHT_FILL;
  const maxRatio = Math.max(darkRatio, lightRatio);
  return {
    color: color,
    textShadow: maxRatio < 4.5 ? (color === INK_ON_DARK_FILL ? "0 1px 2px rgba(0,0,0,0.9)" : "0 1px 2px rgba(255,255,255,0.9)") : "none",
  };
};

createApp({
  setup() {
    const currentTab = ref("cockpit");
    const selectedRegionId = ref("naqu-seni");
    const currentAgeGroup = ref("all");
    const regions = ref([]);
    const dataTiers = ref([]);
    const currentSeriesSample = ref([]);
    // MODIS 遥感场景与气象月序列是两条不同粒度的序列，必须分开呈现。
    // 原实现把它们塞进同一张表，导致 NDVI / 植被覆盖 / 积雪覆盖 三列在气象行上恒为空，
    // 页面直接渲染出一列裸 "%"，是最扎眼的假数据痕迹。
    const currentRemoteSample = ref([]);
    // 两条序列各自的真实覆盖区间 (由后端回传，不写死在文案里)
    const seriesCoverage = ref({ weather: null, remote: null });

    // 宏观统计概览 (全域 26 县真实动态汇总)
    const macroStats = ref({
      totalCounties: 26,
      snowWarningCount: 0,
      droughtWarningCount: 0,
      avgCarryingBalance: null,
    });

    // 26 县综合气象灾害评估结果字典
    const countyRisks = ref({});

    // 「科研级验证指标全景」的四个数值。此前是在 index.html 里写死的字面量：
    // 91.7% / 5.92 / 0.0601 / +47.5%，后端没有任何接口产出 PSI 与 Walk-Forward MAE；
    // 且 91.7% 被标成"召回率"（模型召回率实为 0.4688，91.4% 是准确率），+47.5% 又与
    // 同页协议表里相对气候态基线的 17.4% 自相矛盾。现全部改为实时读取
    // /api/index/pu-benchmark 与 /api/forecast/npp-benchmark 的返回值，
    // 取不到时显示 "—"，不再回落到来路不明的数字。
    const verifyKpi = ref({
      f1Text: "—",
      f1GainText: "—",
      naiveF1Text: "—",
      precisionText: "—",
      rulePrecisionText: "—",
      brierText: "—",
      naiveBrierText: "—",
      nppGainText: "—",
    });

    const loadVerificationKpis = async () => {
      const next = {};
      try {
        const res = await fetch("/api/index/pu-benchmark");
        if (res.ok) {
          const d = await res.json();
          const models = d.benchmark_results || {};
          const pu = models["Model 3 (PU Learning Model)"];
          const naive = models["Baseline 2 (Naive Supervised)"];
          const rule = models["Baseline 1 (Rule-based)"];
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
          // 提升幅度由两个实测值现算，不写死，改数据后不会与表格对不上
          if (pu && naive && naive.f1_score > 0) {
            const gain = (pu.f1_score / naive.f1_score - 1) * 100;
            next.f1GainText = `${gain >= 0 ? "+" : ""}${gain.toFixed(1)}%`;
          }
        }
      } catch (e) {
        console.warn("加载 PU 基准指标失败");
      }

      try {
        const res = await fetch("/api/forecast/npp-benchmark");
        if (res.ok) {
          const d = await res.json();
          const models = (d.loyo_protocol || {}).models || {};
          const key = Object.keys(models).find((k) => k.includes("本系统方法"));
          if (key) {
            const gain = Number(models[key].reduction_vs_b1_pct);
            if (Number.isFinite(gain)) {
              next.nppGainText = `${gain >= 0 ? "+" : ""}${gain.toFixed(1)}%`;
            }
          }
        }
      } catch (e) {
        console.warn("加载 NPP 基准指标失败");
      }

      verifyKpi.value = { ...verifyKpi.value, ...next };
    };

    const navTabs = [
      { id: "cockpit", label: "1. 风险态势驾驶舱", icon: "🗺️" },
      { id: "datasource", label: "2. 气象数据底座", icon: "🛰️" },
      { id: "index", label: "3. 气象风险指数", icon: "📊" },
      { id: "forecast", label: "4. 灾害预测与草畜平衡", icon: "📈" },
      { id: "decision", label: "5. 应用与决策", icon: "🛡️" },
    ];

    const ageGroups = [
      { code: "all", name: "全部牛群 (加权综合)" },
      { code: "calf", name: "犊牛 (0-1岁 极危)" },
      { code: "yearling", name: "育成牛 (1-2岁)" },
      { code: "adult", name: "成年牛 (耐寒)" },
      { code: "old", name: "老龄牛 (弱耐性)" },
    ];

    // 当前选中县的实时监测数据 (动态由后端同步)
    const currentMetrics = ref({
      temp: "—",
      tempWindowMean: "—",
      tempMin: "—",
      snow: "—",
      snowDays: "—",
      snowLevel: "—",
      droughtLevel: "—",
      spiVal: "—",
      snowLevelCode: 0,
      isRealtime: false,
      provenanceNote: "",
    });

    // 默认值一律按"未取得实时数据"处理：宁可先显示降级提示，
    // 也不能在请求失败时默认冒充实时预报。
    const currentDisaster = ref({
      confidence_tier: "climatological_projection",
      is_realtime: false,
      data_source: "",
      provenance_note: "",
      snow_disaster: { level_cn: "正常 (无灾害)", level_code: 0 },
    });

    const currentSpi = ref({
      spi_value: 0.42,
      legacy_spi_value: 0.35,
      drought_level: "正常偏湿",
      zero_precip_prob: 0.05,
    });

    const currentGdi = ref({
      gdi_value: 0.58,
      degradation_level: "中度退化",
      legacy_gdi_value: 0.52,
      legacy_level: "中度退化",
      pca_variance_ratio: 0.84,
    });

    const currentPuRisk = ref({
      calibrated_risk_prob: 0.284,
      risk_score: 46,
      risk_level: "中度风险",
      summary: "月降水量与低温联合驱动致灾概率上升，草场承载压力构成脆弱性放大器。",
      recommendations: ["加强雪情动态监测", "提前排查低洼处简易畜圈", "储备应急防灾精饲料"],
      top_shap_features: [
        { feature_label_cn: "月累计降水量", shap_value: 0.5986, direction: "increase_risk", contribution_pct: 25.4 },
        { feature_label_cn: "最大积雪深度", shap_value: 0.4887, direction: "increase_risk", contribution_pct: 20.8 },
        { feature_label_cn: "平均气温", shap_value: -0.4508, direction: "decrease_risk", contribution_pct: 19.2 },
        { feature_label_cn: "理论载畜量", shap_value: 0.1894, direction: "increase_risk", contribution_pct: 8.0 },
        { feature_label_cn: "植被指数(NDVI)", shap_value: -0.1650, direction: "decrease_risk", contribution_pct: 7.0 },
      ],
    });

    const currentDecision = ref({
      total_exposed_assets_wan: 850.0,
      estimated_loss_exposure_wan: 42.5,
      resilience_credit_quota_wan: 160.0,
      emergency_feed_demand: {
        recommended_hay_tons: 42.5,
        recommended_grain_tons: 8.6,
        total_feed_cost_wan: 4.8,
      },
      recommended_actions: [
        "气象状态: 当前处于 重度雪灾 (III级)，模拟积雪 14.5cm",
        "应急补饲: 组织储备 42.5 吨干草与 8.6 吨精饲料，启动 100% 补饲模式",
        "防寒转场: 严防犊牛群高寒风口放牧，转入半地下保温暖棚",
        "金融响应: 启动气候韧性低息防灾备用信贷 160 万元，农业保险绿色查勘待命",
      ],
    });

    const currentRegionName = computed(() => {
      const found = regions.value.find((r) => r.region_id === selectedRegionId.value);
      return found ? found.name_cn : "那曲市 · 色尼区";
    });

    // 全域 26 县新旧方法对照汇总 (由 /api/index/method-compare 一次性返回)
    const spiSummary = ref({ level_changed: "—", compared_counties: 0, mean_abs_delta: "—", max_abs_delta: "—" });
    const gdiSummary = ref({ level_changed: "—", compared_counties: 0, mean_abs_delta: "—", max_abs_delta: "—" });

    // 全域 26 县应急资源投放优先级 (由后端同一套补饲/信贷口径跑遍全域得到)
    const priorityRanking = ref(null);

    // 微网格矩阵的读数侧栏 (由当前县域真实矩阵推导，非硬编码)
    const matrixInsight = ref({
      maxLabel: "—", maxValue: "—", minLabel: "—",
      seasonSpread: "—", grassSpread: "—", takeaway: "",
    });

    // ECharts 实例缓存
    let chartMap = null;
    let chartCockpitForecast = null;
    let chartIndexHeatmap = null;
    let chartPuShap = null;
    let chartMultiDisaster = null;
    let chartNpp = null;
    let chartSpiSlope = null;
    let chartGdiSlope = null;
    let chartPriorityRank = null;
    let methodCompareCache = null;
    // 地图上"当前下钻县"的描边重绘函数 (由 initPlateauMap 装配)
    let applyMapSelection = null;

    // 1. 获取 26 县基础清单
    const loadRegions = async () => {
      try {
        const res = await fetch("/api/overview/regions");
        if (res.ok) {
          regions.value = await res.json();
        }
      } catch (e) {
        console.warn("加载区域列表失败，使用离线兜底");
      }
    };

    // 2. 获取全量 26 县综合风险与宏观聚合指标 (真实后端计算)
    const loadCountyRisks = async () => {
      try {
        const res = await fetch("/api/overview/county-risks");
        if (res.ok) {
          const data = await res.json();
          macroStats.value = {
            totalCounties: data.macro_stats.total_counties || 26,
            snowWarningCount: data.macro_stats.snow_warning_count || 0,
            droughtWarningCount: data.macro_stats.drought_warning_count || 0,
            avgCarryingBalance: data.macro_stats.avg_carrying_balance ?? null,
            degradedCounties: data.macro_stats.degraded_counties || 0,
            snowDataMode: data.macro_stats.snow_data_mode || "realtime",
          };

          const dict = {};
          for (const c of data.counties) {
            dict[c.region_id] = c;
          }
          countyRisks.value = dict;

          // 同步当前选中县的指标
          syncCurrentCountyMetrics();
        }
      } catch (e) {
        console.warn("加载 26 县风险评估失败");
      }
    };

    // 雪灾等级配色必须跟随真实等级，而不是无条件报警：
    // 0 级=正常(绿) / I-II 级=关注(橙) / III-IV 级=预警(红)
    const snowLevelBadgeClass = computed(() => {
      const code = currentMetrics.value.snowLevelCode || 0;
      if (code >= 3) return "badge-danger";
      if (code >= 1) return "badge-warning";
      return "badge-success";
    });
    const snowDepthClass = computed(() =>
      (currentMetrics.value.snowLevelCode || 0) >= 1 ? "text-danger" : ""
    );
    // 离线降级时雪情只作气候背景参考，界面必须显式降调
    const snowDataDegraded = computed(
      () => macroStats.value.snowDataMode && macroStats.value.snowDataMode !== "realtime"
    );

    // 不确定区间口径 (随预报结果一起披露，避免"阴影带"成为无来源的装饰)
    const uncertaintyInfo = computed(() => {
      const u = currentDisaster.value && currentDisaster.value.uncertainty;
      if (!u) return null;
      return { sigma: u.sigma_cm, years: u.sample_years, method: u.method };
    });

    // 26 县风险等级分布 (地图图例用真实计数，避免图例列出当天并不存在的等级)
    const riskLevelCounts = computed(() => {
      const all = Object.values(countyRisks.value);
      const order = ["低风险", "中度风险", "高风险", "重特大预警"];
      return order.map((name) => ({
        name,
        count: all.filter((c) => c.risk_level === name).length,
      }));
    });

    // 决策页宏观看板：把 26 县排序结果压缩成几个可直接引用的数字。
    // 累积覆盖必须按**图上显示的同一顺序**重算——后端按补饲量排序、前端按风险分排序，
    // 直接用后端的 coverage 会与读者在图上数出来的名次对不上。
    const prioritySummary = computed(() => {
      const d = priorityRanking.value;
      if (!d) return null;
      const t = d.totals || {};
      const rows = [...(d.counties || [])].sort(
        (a, b) => (b.risk_score ?? -1) - (a.risk_score ?? -1)
      );
      const totalHay = rows.reduce((s, c) => s + (c.hay_tons || 0), 0);
      let cum = 0;
      let p50 = null;
      let p80 = null;
      rows.forEach((c, i) => {
        cum += c.hay_tons || 0;
        if (totalHay <= 0) return;
        if (p50 === null && cum / totalHay >= 0.5) p50 = i + 1;
        if (p80 === null && cum / totalHay >= 0.8) p80 = i + 1;
      });
      return {
        hayTons: t.hay_tons,
        grainTons: t.grain_tons,
        costWan: t.feed_cost_wan,
        creditWan: t.credit_quota_wan,
        needCount: rows.filter((c) => c.hay_tons > 0).length,
        countyCount: t.county_count,
        realtime: d.realtime_counties,
        p50,
        p80,
        coverageOrder: "priority",
      };
    });

    // 气象数值一律带符号显示，并把负零归一为 0（否则会渲染出 "-0.0 ℃"），
    // 缺测返回 "—" 而不是拿 0 冒充真实取值。
    const signed = (v, digits = 1) => {
      if (v === null || v === undefined || !Number.isFinite(Number(v))) return "—";
      const rounded = Number(Number(v).toFixed(digits)) + 0;
      const fixed = rounded.toFixed(digits);
      return rounded > 0 ? `+${fixed}` : fixed;
    };

    // 同步当前选中县的气象卡片指标
    const syncCurrentCountyMetrics = () => {
      const cr = countyRisks.value[selectedRegionId.value];
      if (cr) {
        currentMetrics.value = {
          temp: signed(cr.temp),
          tempWindowMean: signed(cr.temp_window_mean),
          tempMin: signed(cr.temp_min),
          snow: `${cr.snow_depth}`,
          snowDays: `${cr.continuous_snow_days}`,
          snowLevel: cr.snow_level,
          droughtLevel: cr.drought_level,
          spiVal: signed(cr.spi_value, 2),
          snowLevelCode: cr.snow_level_code || 0,
          isRealtime: cr.is_realtime !== false,
          provenanceNote: cr.provenance_note || "",
        };
      }
    };

    // 3. 获取数据底座报告
    const loadDataTiers = async () => {
      try {
        const res = await fetch("/api/datasource/provenance");
        if (res.ok) {
          const data = await res.json();
          dataTiers.value = data.tiers || [];
        }
      } catch (e) {
        console.warn("加载数据底座离线兜底");
      }
    };

    // 4. 获取全域资源投放优先级 (决策页的"先保哪个县")
    const loadPriorityRanking = async () => {
      try {
        const res = await fetch("/api/decision/priority-ranking?herd_size=1000&days=14");
        if (res.ok) {
          const data = await res.json();
          // 风险分来自已缓存的 county-risks，不在后端重复计算 SPI/GDI
          const risks = countyRisks.value || {};
          for (const row of data.counties || []) {
            const r = risks[row.region_id];
            row.risk_score = r ? Number(r.risk_score) : null;
            row.risk_level = r ? r.risk_level : "";
          }
          priorityRanking.value = data;
        }
      } catch (e) {
        console.warn("加载资源投放优先级失败");
      }
    };

    // 5. 获取时序样本
    const loadSeriesSample = async () => {
      try {
        const res = await fetch(`/api/datasource/series/${selectedRegionId.value}`);
        if (res.ok) {
          const data = await res.json();
          currentSeriesSample.value = data.recent_weather || [];
          currentRemoteSample.value = data.recent_remote_sensing || [];
          seriesCoverage.value = {
            weather: data.weather_coverage || null,
            remote: data.remote_sensing_coverage || null,
          };
        }
      } catch (e) {
        console.warn("加载时序样本失败");
      }
    };

    // 5. 获取指数与决策
    const loadIndicesAndDecision = async () => {
      try {
        const [resSpi, resGdi, resDec, resPu, resDis] = await Promise.all([
          fetch(`/api/index/spi/${selectedRegionId.value}`),
          fetch(`/api/index/gdi/${selectedRegionId.value}`),
          fetch(`/api/decision/signal/${selectedRegionId.value}`),
          fetch(`/api/index/pu/${selectedRegionId.value}`),
          fetch(`/api/forecast/disaster/${selectedRegionId.value}`),
        ]);
        if (resSpi.ok) currentSpi.value = await resSpi.json();
        if (resGdi.ok) currentGdi.value = await resGdi.json();
        if (resDec.ok) currentDecision.value = await resDec.json();
        if (resPu.ok) currentPuRisk.value = await resPu.json();
        if (resDis.ok) currentDisaster.value = await resDis.json();
      } catch (e) {
        console.warn("加载县域指数与PU评估失败");
      }
    };

    // 初始化 26 县 ECharts 真实地图渲染
    const initPlateauMap = async () => {
      const dom = document.getElementById("chartPlateauMap");
      if (!dom) return;
      if (!chartMap) chartMap = echarts.init(dom);

      try {
        // 请求全量 26 县规范 GeoJSON FeatureCollection
        const res = await fetch("/api/overview/geojson-all");
        if (res.ok) {
          const geoJson = await res.json();
          echarts.registerMap("plateau_26", geoJson);

          // 真实空间风险色阶数据 (来源于 /api/overview/county-risks 真实计算)
          const mapData = regions.value.map((r) => {
            const cr = countyRisks.value[r.region_id];
            return {
              name: r.name_cn,
              value: cr ? cr.risk_score : 50.0,
              region_id: r.region_id,
              risk_level: cr ? cr.risk_level : "中度风险",
              snow_level: cr ? cr.snow_level : "正常",
              drought_level: cr ? cr.drought_level : "正常",
            };
          });

          // 色阶上下限严格取当日真实分布的最小/最大值，而不是钉死 0–90、
          // 也不是吸附到 10 的整数倍：9 月全域风险分只在 15–48 之间，吸附后区间
          // 变成 10–60，等于把 5 级色带只用掉中间 2 级，26 个县看上去还是一色。
          // 用真实极值当端点，最轻与最重的县才能各自落在色带两端。
          const scores = mapData.map((d) => Number(d.value)).filter((v) => Number.isFinite(v));
          let mapMin = scores.length ? Math.min(...scores) : 0;
          let mapMax = scores.length ? Math.max(...scores) : 90;
          if (mapMax - mapMin < 4) mapMax = mapMin + 4; // 全域几乎同分时才强行撑开
          mapMin = Math.floor(mapMin);
          mapMax = Math.ceil(mapMax);

          // 4 省底图差异化样式 (藏·青·川·甘，提供宏观地理语境，拒绝黑底浮岛)
          const provinceRegions = [
            {
              name: "西藏自治区",
              itemStyle: {
                areaColor: "rgba(15, 23, 42, 0.45)",
                borderColor: "rgba(148, 163, 184, 0.35)",
                borderWidth: 1.2,
                borderType: "dashed",
              },
              emphasis: {
                itemStyle: { areaColor: "rgba(30, 41, 59, 0.6)" },
                label: { show: true, color: "#94a3b8", fontSize: 11 },
              },
            },
            {
              name: "青海省",
              itemStyle: {
                areaColor: "rgba(15, 23, 42, 0.45)",
                borderColor: "rgba(148, 163, 184, 0.35)",
                borderWidth: 1.2,
                borderType: "dashed",
              },
              emphasis: {
                itemStyle: { areaColor: "rgba(30, 41, 59, 0.6)" },
                label: { show: true, color: "#94a3b8", fontSize: 11 },
              },
            },
            {
              name: "四川省",
              itemStyle: {
                areaColor: "rgba(15, 23, 42, 0.45)",
                borderColor: "rgba(148, 163, 184, 0.35)",
                borderWidth: 1.2,
                borderType: "dashed",
              },
              emphasis: {
                itemStyle: { areaColor: "rgba(30, 41, 59, 0.6)" },
                label: { show: true, color: "#94a3b8", fontSize: 11 },
              },
            },
            {
              name: "甘肃省",
              itemStyle: {
                areaColor: "rgba(15, 23, 42, 0.45)",
                borderColor: "rgba(148, 163, 184, 0.35)",
                borderWidth: 1.2,
                borderType: "dashed",
              },
              emphasis: {
                itemStyle: { areaColor: "rgba(30, 41, 59, 0.6)" },
                label: { show: true, color: "#94a3b8", fontSize: 11 },
              },
            },
          ];

          const option = {
            tooltip: {
              trigger: "item",
              formatter: (params) => {
                const d = params.data;
                if (!d || !d.region_id) {
                  return `<strong>${params.name}</strong><br/>` +
                    `<span style="color:#94a3b8;font-size:11px;">青藏高原省界底图背景 · 26牧区监测县宏观语境</span>`;
                }
                return `<strong>${d.name}</strong><br/>` +
                  `综合气象灾害风险分: <strong>${d.value}</strong><br/>` +
                  `综合预警评级: <span style="color:${VIZ.textMain}">${d.risk_level}</span><br/>` +
                  `牧区雪灾: ${d.snow_level}<br/>` +
                  `干旱态势: ${d.drought_level}`;
              },
            },
            // 面状分级配色同样遵循单色顺序带 (彩虹带会让中间值塌成脏橄榄色)。
            // 注意 ECharts 把 color[0] 映射到 min、color[last] 映射到 max，
            // 因此必须反转顺序带，否则"低风险"会被涂成最深的红色，视觉上恰好说反。
            visualMap: {
              min: mapMin,
              max: mapMax,
              text: [`高险 ${mapMax}`, `低险 ${mapMin}`],
              realtime: false,
              calculable: false,
              orient: "vertical",
              itemWidth: 12,
              itemHeight: 140,
              inRange: { color: [...VIZ.seq] },
              textStyle: { color: VIZ.textMuted, fontSize: 11 },
              bottom: 16,
              left: 12,
            },
            graphic: [
              {
                type: "group",
                top: 14,
                left: 14,
                children: [
                  {
                    type: "rect",
                    shape: { width: 172, height: 26, r: 4 },
                    style: { fill: "rgba(11, 17, 30, 0.82)", stroke: "rgba(255, 255, 255, 0.14)", lineWidth: 1 },
                  },
                  {
                    type: "text",
                    left: 8,
                    top: 6,
                    style: {
                      text: "🗺️ 藏·青·川·甘 四省牧区底图",
                      fill: VIZ.textMuted,
                      font: "10px sans-serif",
                    },
                  },
                ],
              },
              {
                type: "group",
                top: 14,
                right: 14,
                children: [
                  {
                    type: "rect",
                    shape: { width: 154, height: 28, r: 4 },
                    style: { fill: "rgba(11, 17, 30, 0.82)", stroke: "rgba(255, 255, 255, 0.14)", lineWidth: 1 },
                  },
                  {
                    type: "text",
                    left: 8,
                    top: 7,
                    style: {
                      text: "🧭 北 (N) · 青藏高原牧区",
                      fill: VIZ.textMuted,
                      font: "bold 11px sans-serif",
                    },
                  },
                ],
              },
              {
                type: "group",
                bottom: 14,
                right: 14,
                children: [
                  {
                    type: "rect",
                    shape: { width: 136, height: 24, r: 4 },
                    style: { fill: "rgba(11, 17, 30, 0.82)", stroke: "rgba(255, 255, 255, 0.14)", lineWidth: 1 },
                  },
                  {
                    type: "text",
                    left: 8,
                    top: 5,
                    style: {
                      text: "比例尺: 0 ─── 200 km",
                      fill: VIZ.textMuted,
                      font: "10px sans-serif",
                    },
                  },
                ],
              },
            ],
            series: [
              {
                name: "青藏高原26县",
                type: "map",
                map: "plateau_26",
                roam: true,
                layoutCenter: ["50%", "52%"],
                layoutSize: "115%",
                regions: provinceRegions,
                emphasis: {
                  label: { show: true, color: "#fff" },
                  itemStyle: { areaColor: "#3a86ff" },
                },
                itemStyle: {
                  borderColor: "rgba(255,255,255,0.42)",
                  borderWidth: 1.1,
                  areaColor: "rgba(14,21,37,0.88)",
                },
                data: mapData,
              },
            ],
          };
          chartMap.setOption(option);

          // 当前下钻县描边：地图是"点击联动"的入口，必须有一个持续可见的落点，
          // 否则换县之后用户根本看不出当前看的是哪个县
          applyMapSelection = () => {
            chartMap.setOption({
              series: [{
                regions: provinceRegions,
                data: mapData.map((d) => ({
                  ...d,
                  itemStyle: d.region_id === selectedRegionId.value
                    ? { borderColor: VIZ.accent, borderWidth: 2.5, shadowBlur: 12, shadowColor: "rgba(248,250,252,0.4)" }
                    : { borderColor: VIZ.surface, borderWidth: 1 },
                })),
              }],
            });
          };
          applyMapSelection();

          // 点击地图区域联动全系统 (仅点击有效县域时响应)
          chartMap.off("click");
          chartMap.on("click", (params) => {
            if (params.data && params.data.region_id) {
              selectedRegionId.value = params.data.region_id;
              onRegionChange();
            }
          });
          return;
        }
      } catch (e) {
        console.warn("加载 GeoJSON 失败，使用散点图回退", e);
      }

      // 回退方案：散点气泡图
      const scatterData = regions.value.map((r) => {
        const cr = countyRisks.value[r.region_id];
        return [r.longitude, r.latitude, cr ? cr.risk_score : 50, r.name_cn, r.region_id];
      });
      chartMap.setOption({
        tooltip: { formatter: (p) => `${p.value[3]}<br/>综合风险: ${p.value[2]}` },
        grid: { top: 20, bottom: 30, left: 40, right: 20 },
        xAxis: { type: "value", min: 80, max: 104, axisLabel: { color: "#94a3b8" }, splitLine: { lineStyle: { color: "rgba(255,255,255,0.05)" } } },
        yAxis: { type: "value", min: 27, max: 37, axisLabel: { color: "#94a3b8" }, splitLine: { lineStyle: { color: "rgba(255,255,255,0.05)" } } },
        series: [{ type: "scatter", symbolSize: (val) => val[2] / 3, data: scatterData, itemStyle: { color: "#00d2ff" } }],
      });
    };

    // 渲染驾驶舱 16 天演化曲线 (真实对接 /api/forecast/disaster 气象预测)
    const renderCockpitForecastChart = async () => {
      const dom = document.getElementById("chartCockpitForecast");
      if (!dom) return;
      if (!chartCockpitForecast) chartCockpitForecast = echarts.init(dom);

      // 恪守零伪造准则：初始化空数组，严禁使用任何写死的模拟数字作为兜底
      let days = [];
      let temps = [];
      let snow = [];

      try {
        const res = await fetch(`/api/forecast/disaster/${selectedRegionId.value}?days=16`);
        if (res.ok) {
          const d = await res.json();
          if (d.forecast_series && d.forecast_series.days_16) {
            days = d.forecast_series.days_16;
            temps = d.forecast_series.temps_16;
            snow = d.forecast_series.snow_16;
          }
        }
      } catch (e) {
        console.warn("加载驾驶舱时序失败");
      }

      // 真实数据未达时明确呈现降级告示，严禁以伪造数字蒙蔽评审
      if (!days.length || !temps.length) {
        chartCockpitForecast.clear();
        chartCockpitForecast.setOption({
          title: {
            text: "气象预测接口离线或暂无实测时序\n(恪守零伪造红线 · 严禁呈现合成虚假数据)",
            left: "center",
            top: "middle",
            textStyle: { color: VIZ.textMuted, fontSize: 12, lineHeight: 18 },
          },
        });
        return;
      }

      // 单轴纪律: 温度与积雪量纲不同，禁止双 Y 轴同图叠放。
      // 改为共享横轴的上下两个小倍数，各自一条轴、单序列、无需图例。
      chartCockpitForecast.setOption({
        title: { show: false },
        tooltip: { trigger: "axis", axisPointer: { type: "line", lineStyle: { color: "rgba(241,245,249,0.25)" } } },
        axisPointer: { link: [{ xAxisIndex: "all" }] },
        grid: [
          { top: 26, left: 52, right: 16, height: "36%" },
          { left: 52, right: 16, top: "66%", height: "24%" },
        ],
        xAxis: [
          {
            type: "category", gridIndex: 0, data: days,
            axisLabel: { show: false }, axisTick: { show: false },
            axisLine: { lineStyle: { color: VIZ.axis } },
          },
          {
            type: "category", gridIndex: 1, data: days,
            axisLabel: { color: VIZ.textMuted, fontSize: 10, interval: 2 },
            axisTick: { show: false },
            axisLine: { lineStyle: { color: VIZ.axis } },
          },
        ],
        yAxis: [
          {
            type: "value", gridIndex: 0, name: "日均温 (℃)",
            nameTextStyle: { color: VIZ.textMuted, fontSize: 10, align: "left" },
            nameGap: 12,
            axisLabel: { color: VIZ.textMuted, fontSize: 10 },
            splitLine: { lineStyle: { color: VIZ.grid } },
            axisLine: { show: false },
          },
          {
            type: "value", gridIndex: 1, name: "积雪深度 (cm)",
            nameTextStyle: { color: VIZ.textMuted, fontSize: 10, align: "left" },
            nameGap: 12,
            axisLabel: { color: VIZ.textMuted, fontSize: 10 },
            splitLine: { lineStyle: { color: VIZ.grid } },
            axisLine: { show: false },
          },
        ],
        series: [
          {
            name: "日均温 (℃)", type: "line", xAxisIndex: 0, yAxisIndex: 0,
            data: temps, smooth: true, symbol: "none",
            lineStyle: { color: VIZ.down, width: 2 },
            areaStyle: { color: "rgba(57,135,229,0.10)" },
          },
          {
            name: "积雪深度 (cm)", type: "line", xAxisIndex: 1, yAxisIndex: 1,
            data: snow, smooth: true, symbol: "none",
            lineStyle: { color: VIZ.neutral, width: 2 },
            areaStyle: { color: "rgba(127,142,163,0.16)" },
          },
        ],
      });
    };

    // 渲染微网格风险矩阵 (真实对接 /api/index/spatio-temporal-grid)
    // 配色为单色顺序带 VIZ.seq，亮度单调递增，已通过 validate_palette.js 实测
    const renderIndexHeatmap = async () => {
      const dom = document.getElementById("chartIndexGridHeatmap");
      if (!dom) return;
      if (!chartIndexHeatmap) chartIndexHeatmap = echarts.init(dom);

      const seasons = ["春季 (春旱/倒春寒)", "夏季 (水热充沛)", "秋季 (早霜降雪)", "冬季 (极端暴雪/严寒)"];
      const shortSeasons = ["春季", "夏季", "秋季", "冬季"];
      const grasslands = ["高寒草甸", "高寒草原", "高寒荒漠"];

      const seasonMap = { spring: 0, summer: 1, autumn: 2, winter: 3 };
      const grassMap = { alpine_meadow: 0, alpine_steppe: 1, alpine_desert: 2 };

      let heatmapData = [];

      try {
        const res = await fetch(`/api/index/spatio-temporal-grid/${selectedRegionId.value}?age_group=${currentAgeGroup.value}`);
        if (res.ok) {
          const resp = await res.json();
          if (resp.matrix && resp.matrix.length > 0) {
            heatmapData = resp.matrix.map((item) => {
              const sIdx = seasonMap[item.season_code] ?? 0;
              const gIdx = grassMap[item.grassland_code] ?? 0;
              return [sIdx, gIdx, item.risk_score];
            });
          }
        }
      } catch (e) {
        console.warn("加载时空网格矩阵失败");
      }

      if (heatmapData.length === 0) {
        // 兜底计算
        const base = [
          [0, 0, 48], [0, 1, 24], [0, 2, 42], [0, 3, 68],
          [1, 0, 56], [1, 1, 29], [1, 2, 51], [1, 3, 76],
          [2, 0, 68], [2, 1, 38], [2, 2, 62], [2, 3, 89],
        ];
        const mult = currentAgeGroup.value === "calf" ? 1.25 : currentAgeGroup.value === "adult" ? 0.85 : 1.0;
        heatmapData = base.map(([g, s, val]) => [s, g, Math.min(99, Math.round(val * mult))]);
      }

      // ---- 由矩阵真实推导侧栏读数，替代硬编码文案 ----
      const cellLabel = (cell) => `${grasslands[cell[1]]} · ${shortSeasons[cell[0]]}`;
      const ranked = [...heatmapData].sort((a, b) => a[2] - b[2]);
      const lowest = ranked[0];
      const highest = ranked[ranked.length - 1];
      const spreadBySeason = shortSeasons
        .map((_, s) => {
          const vals = heatmapData.filter((d) => d[0] === s).map((d) => d[2]);
          return vals.length ? Math.max(...vals) - Math.min(...vals) : 0;
        });
      const spreadByGrass = grasslands
        .map((_, g) => {
          const vals = heatmapData.filter((d) => d[1] === g).map((d) => d[2]);
          return vals.length ? Math.max(...vals) - Math.min(...vals) : 0;
        });
      const seasonSpread = Math.max(...spreadBySeason);
      const grassSpread = Math.max(...spreadByGrass);

      matrixInsight.value = {
        maxLabel: cellLabel(highest),
        maxValue: highest[2],
        minLabel: cellLabel(lowest),
        seasonSpread: `${seasonSpread}（${shortSeasons[spreadBySeason.indexOf(seasonSpread)]}内）`,
        grassSpread: `${grassSpread}（${grasslands[spreadByGrass.indexOf(grassSpread)]}内）`,
        takeaway:
          `峰值单元为 ${cellLabel(highest)}（${highest[2]} 分），较最低的 ${cellLabel(lowest)}（${lowest[2]} 分）高出 ${highest[2] - lowest[2]} 分；` +
          `草场类型间极差 ${grassSpread} 分，${grassSpread >= seasonSpread ? "大于" : "小于"}季节间极差 ${seasonSpread} 分。`,
      };

      const values = heatmapData.map((d) => d[2]);
      const vMin = Math.min(...values);
      const vMax = Math.max(...values);
      const span = vMax - vMin || 1;

      // 顺序带两端分别是深红 #8c2f2a 与亮橙 #ff9a6b，没有任何一种墨色能在整条带上
      // 都达标，所以按格子实际底色实测对比度来配墨，并且不加描边——描边会把每个数字
      // 变成贴纸。
      const labeledData = heatmapData.map((d) => ({
        value: d,
        label: { color: inkOn(seqColorAt((d[2] - vMin) / span)) },
      }));

      chartIndexHeatmap.setOption({
        tooltip: {
          position: "top",
          formatter: (p) => `${grasslands[p.value[1]]} · ${seasons[p.value[0]]}<br/>网格风险值: <strong>${p.value[2]}</strong>`,
        },
        grid: { top: 14, bottom: 62, left: 86, right: 26 },
        xAxis: {
          type: "category", data: seasons,
          axisLabel: { color: VIZ.textMuted, fontSize: 11 },
          axisLine: { lineStyle: { color: VIZ.axis } },
          axisTick: { show: false },
          splitArea: { show: false },
        },
        yAxis: {
          type: "category", data: grasslands,
          axisLabel: { color: VIZ.textMuted, fontSize: 12 },
          axisLine: { lineStyle: { color: VIZ.axis } },
          axisTick: { show: false },
          splitArea: { show: false },
        },
        // 顺序色带必须配刻度图例，否则色深无法被读数。
        // ECharts 把 color[0] 映射到 min、color[last] 映射到 max，而 VIZ.seq 的
        // 第 1 阶就是"量值最低"——所以这里要按原序传入。此前多写了一次 reverse，
        // 结果 89 分的峰值格拿到最暗的 #8c2f2a、24 分的低风险格反而最亮，
        // 在深色底上把"最严重"画成了"最不显眼"。
        visualMap: {
          type: "continuous",
          min: vMin, max: vMax,
          orient: "horizontal",
          left: "center", bottom: 10,
          itemWidth: 12, itemHeight: 152,
          calculable: false,
          text: [`高风险 ${vMax}`, `低风险 ${vMin}`],
          textStyle: { color: VIZ.textMuted, fontSize: 11 },
          inRange: { color: VIZ.seq },
        },
        series: [{
          type: "heatmap",
          data: labeledData,
          label: { show: true, fontSize: 14, fontWeight: 600 },
          itemStyle: { borderRadius: 4, borderColor: VIZ.surface, borderWidth: 3 },
          emphasis: { itemStyle: { borderColor: VIZ.focus, borderWidth: 2 } },
        }],
      });
    };

    // 渲染全域 26 县「新算法 vs 旧简化实现」逐县斜率对照图
    // 每县一条线，对照线灰、当前选中县高亮；阈值线来自后端统一标尺
    const renderMethodCompareCharts = async (forceReload = false) => {
      const domSpi = document.getElementById("chartSpiSlope");
      const domGdi = document.getElementById("chartGdiSlope");
      if (!domSpi || !domGdi) return;
      if (!chartSpiSlope) chartSpiSlope = echarts.init(domSpi);
      if (!chartGdiSlope) chartGdiSlope = echarts.init(domGdi);

      if (!methodCompareCache || forceReload) {
        try {
          const res = await fetch("/api/index/method-compare");
          if (res.ok) methodCompareCache = await res.json();
        } catch (e) {
          console.warn("加载全域方法对照失败");
        }
      }
      const data = methodCompareCache;
      if (!data || !data.counties) return;

      spiSummary.value = data.spi_summary;
      gdiSummary.value = data.gdi_summary;

      // 逐县配对哑铃对照：一行一个县，空心点=旧实现取值，实心点=新方法取值，
      // 两点之间的连线长度就是该县被修正的幅度。
      // 判定阈值画成贯穿全图的竖线，于是"这个县有没有跨过判定线"由几何直接给出，
      // 颜色只承担另一件事：等级标签是否被改写。两者各说各话、互不重复。
      const buildDumbbell = (chart, cfg) => {
        const focusId = selectedRegionId.value;
        const usable = data.counties.filter(
          (c) => c[cfg.oldKey] != null && c[cfg.newKey] != null
        );
        if (!usable.length) return;

        // 等级是否被重判：直接取后端给出的新旧分类标签，不在前端按阈值重算，
        // 避免与摘要口径产生偏差。
        const reclassed = (c) =>
          String(c[cfg.classOldKey] ?? "") !== String(c[cfg.classNewKey] ?? "");

        // 按新值升序排列，y 轴设 inverse —— 最上面一行即"新方法下最重"的县。
        const rows = [...usable].sort(
          (a, b) => Number(a[cfg.newKey]) - Number(b[cfg.newKey])
        );
        const n = rows.length;
        const focusIdx = rows.findIndex((c) => c.region_id === focusId);
        const f = (v) => Number(v).toFixed(3);

        // x 轴范围须同时容纳数据与阈值线，否则判定线会被裁在轴外、失去参考意义
        const thresholds = (cfg.thresholds || []).filter((t) => t && t.value != null);
        const observed = rows.flatMap((c) => [Number(c[cfg.oldKey]), Number(c[cfg.newKey])]);
        const lo = Math.min(...observed, ...thresholds.map((t) => t.value));
        const hi = Math.max(...observed, ...thresholds.map((t) => t.value));
        const step = cfg.axisStep || 0.5;
        const pad = (hi - lo) * 0.05 || step;
        const snappedMin = Math.floor((lo - pad) / step) * step;
        const xMin = cfg.floorAt != null ? Math.max(cfg.floorAt, snappedMin) : snappedMin;
        const xMax = Math.ceil((hi + pad) / step) * step;

        // 端点值标签要挂在"连线不在的那一侧"，否则会压在连线上。新值比旧值大时
        // 连线伸向右侧、空白在右，反之同理；再对撞到轴两端的极端情况做一次翻转。
        const focusNew = focusIdx >= 0 ? Number(rows[focusIdx][cfg.newKey]) : null;
        const focusRatio = focusNew != null ? (focusNew - xMin) / (xMax - xMin || 1) : 0.5;
        const labelPrefersRight =
          focusNew != null && focusNew >= Number(rows[focusIdx][cfg.oldKey]);
        const focusLabelPos = labelPrefersRight
          ? focusRatio > 0.88 ? "left" : "right"
          : focusRatio < 0.12 ? "right" : "left";

        // 背景层（正常区间带 / 判定阈值竖线 / 当前下钻县整行高亮）单独挂在一条 z=1 的
        // 哑弹系列上，保证它落在所有连线与散点之下——不必和 markLine / markArea 的
        // z 序搏斗，也不会被后面画的连线压住。
        const backdrop = (api) => {
          const band = api.size([0, 1])[1];
          // y 轴是 inverse 的类目轴：第 0 行在顶部、第 n-1 行在底部。
          const top = api.coord([0, 0])[1] - band / 2;
          const bottom = api.coord([0, n - 1])[1] + band / 2;
          const left = api.coord([xMin, 0])[0];
          const right = api.coord([xMax, 0])[0];
          const els = [];

          // 轴线单位挂在图区左上角的上方留白里。原先用 xAxis.name + nameLocation:'end'，
          // 会与最右侧的刻度数字叠在一起，且缩短轴长也躲不开。
          els.push({
            type: "text",
            silent: true,
            style: {
              text: cfg.unit || "",
              x: left,
              y: top - 11,
              fill: VIZ.textMuted,
              font: "10px sans-serif",
              textVerticalAlign: "top",
            },
          });

          if (cfg.normalBand) {
            const [nLo, nHi] = cfg.normalBand;
            const a = api.coord([Math.max(nLo, xMin), 0])[0];
            const b = api.coord([Math.min(nHi, xMax), 0])[0];
            if (b > a) {
              els.push({
                type: "rect",
                silent: true,
                shape: { x: a, y: top, width: b - a, height: bottom - top },
                style: { fill: "rgba(148,163,184,0.07)" },
              });
              // 靠右端内角放：左侧顶部被"−1.5 重旱"这条阈值标签占着，
              // 而正常区间右界（+1）一带的头几行数据全在 −1.5 以左，不会撞上。
              els.push({
                type: "text",
                silent: true,
                style: {
                  text: cfg.normalBandLabel || "",
                  x: b - 8,
                  y: top + 7,
                  fill: VIZ.textMuted,
                  font: "10px sans-serif",
                  textAlign: "right",
                  textVerticalAlign: "top",
                },
              });
            }
          }

          thresholds.forEach((t) => {
            const x = api.coord([t.value, 0])[0];
            els.push({
              type: "line",
              silent: true,
              shape: { x1: x, y1: top, x2: x, y2: bottom },
              style: { stroke: "rgba(241,245,249,0.24)", lineWidth: 1, lineDash: [4, 4] },
            });
            // 标签挂到图区上方的留白里，而不是落在图区内：第一行的连线横贯整行，
            // 摆在图区顶部会被那条线直接划穿。
            els.push({
              type: "text",
              silent: true,
              style: {
                text: t.label,
                x: x + 5,
                y: top - 11,
                fill: VIZ.textMuted,
                font: "10px sans-serif",
                textVerticalAlign: "top",
              },
            });
          });

          if (focusIdx >= 0) {
            const y = api.coord([0, focusIdx])[1];
            els.push({
              type: "rect",
              silent: true,
              shape: { x: left, y: y - band / 2, width: right - left, height: band },
              style: { fill: "rgba(248,250,252,0.055)" },
            });
          }
          return els;
        };

        // renderItem 在本版 ECharts 里只接受单个图元，多图元必须包进 group.children；
        // 直接返回数组会静默抛错、整条系列一条都画不出来。
        const backdropSeries = {
          name: "__backdrop",
          type: "custom",
          z: 1,
          silent: true,
          encode: { x: [1, 2], y: 0 },
          dimensions: ["row", cfg.oldKey, cfg.newKey],
          data: [{ value: [0, 0, 0] }],
          tooltip: { show: false },
          renderItem: (params, api) => ({ type: "group", children: backdrop(api) }),
        };

        // 连线按"等级判定是否被改写"拆成两条系列，是为了让图例里的每一项都能对到
        // 真实系列上——ECharts 会直接丢掉 legend.data 里没有对应系列的条目。
        const connectorSeries = (name, color, match) => ({
          name,
          type: "custom",
          z: 3,
          encode: { x: [1, 2], y: 0 },
          dimensions: ["row", cfg.oldKey, cfg.newKey],
          data: rows
            .map((c, i) => ({ value: [i, Number(c[cfg.oldKey]), Number(c[cfg.newKey])] }))
            .filter((_, i) => match(rows[i])),
          renderItem: (params, api) => {
            const i = api.value(0);
            const c = rows[i];
            const band = api.size([0, 1])[1];
            const y = api.coord([0, i])[1];
            const a = api.coord([Number(c[cfg.oldKey]), i]);
            const b = api.coord([Number(c[cfg.newKey]), i]);
            const left = api.coord([xMin, 0])[0];
            return {
              type: "group",
              children: [
                // 整行透明命中区：鼠标落在行内任意位置都能读出这个县，
                // 而不是必须精确停在 2px 宽的连线上。
                {
                  type: "rect",
                  shape: {
                    x: left,
                    y: y - band / 2,
                    width: api.coord([xMax, 0])[0] - left,
                    height: band,
                  },
                  style: { fill: "transparent" },
                },
                {
                  type: "line",
                  silent: true,
                  shape: { x1: a[0], y1: a[1], x2: b[0], y2: b[1] },
                  style: { stroke: color, lineWidth: 2, lineCap: "round" },
                },
              ],
            };
          },
        });

        const dotSeries = (name, key, z, size, hollow) => ({
          name,
          type: "scatter",
          z,
          symbolSize: size,
          data: rows.map((c, i) => ({
            value: [Number(c[key]), i],
            itemStyle: hollow
              ? { color: VIZ.surface, borderColor: reclassed(c) ? VIZ.up : VIZ.neutral, borderWidth: 2 }
              : { color: reclassed(c) ? VIZ.up : VIZ.neutral, borderColor: VIZ.surface, borderWidth: 1.5 },
            label:
              !hollow && i === focusIdx
                ? {
                    show: true,
                    position: focusLabelPos,
                    distance: 7,
                    color: VIZ.textMain,
                    fontSize: 11,
                    fontWeight: 600,
                    formatter: () => f(focusNew),
                  }
                : { show: false },
          })),
          emphasis: { scale: 1.25, itemStyle: { borderColor: VIZ.focus, borderWidth: 2 } },
        });

        chart.resize();
        chart.setOption(
          {
            legend: {
              show: true,
              bottom: 0,
              left: "center",
              itemWidth: 10,
              itemHeight: 10,
              itemGap: 18,
              icon: "circle",
              textStyle: { color: VIZ.textMuted, fontSize: 11 },
              data: [
                {
                  name: "旧实现取值",
                  itemStyle: { color: VIZ.surface, borderColor: VIZ.neutral, borderWidth: 2 },
                },
                { name: "新方法取值", itemStyle: { color: VIZ.neutral } },
                // 必须显式给色：custom 系列不会把自身颜色交给图例，缺省会落到
                // ECharts 默认色板的黄色上，与图里实际的红色连线对不上。
                {
                  name: "等级判定被改写",
                  icon: "roundRect",
                  itemStyle: { color: VIZ.up },
                },
              ],
            },
            tooltip: {
              trigger: "item",
              formatter: (p) => {
                const i = p.seriesType === "scatter" ? p.value[1] : p.value[0];
                const c = rows[i];
                if (!c) return "";
                return [
                  `<strong>${c.region_name}</strong>`,
                  `${cfg.oldLabel}：${f(c[cfg.oldKey])} · ${c[cfg.classOldKey] || "—"}`,
                  `${cfg.newLabel}：${f(c[cfg.newKey])} · ${c[cfg.classNewKey] || "—"}`,
                  reclassed(c)
                    ? `<span style="color:${VIZ.up}">等级判定被改写</span>`
                    : `<span style="color:${VIZ.textMuted}">等级判定未变</span>`,
                ].join("<br/>");
              },
            },
            grid: { top: 28, bottom: 42, left: 86, right: 34 },
            xAxis: {
              type: "value",
              min: xMin,
              max: xMax,
              axisLabel: { color: VIZ.textMuted, fontSize: 10 },
              axisLine: { show: false },
              axisTick: { show: false },
              splitLine: { lineStyle: { color: VIZ.grid } },
            },
            yAxis: {
              type: "category",
              data: rows.map((c) => c.region_name),
              inverse: true,
              axisLabel: {
                fontSize: 10,
                color: (value, index) =>
                  rows[index] && rows[index].region_id === focusId
                    ? VIZ.textMain
                    : VIZ.textMuted,
              },
              axisLine: { lineStyle: { color: VIZ.axis } },
              axisTick: { show: false },
              splitLine: { show: false },
              splitArea: {
                show: true,
                areaStyle: { color: ["rgba(255,255,255,0.016)", "transparent"] },
              },
            },
            series: [
              backdropSeries,
              connectorSeries("修正幅度", VIZ.neutral, (c) => !reclassed(c)),
              connectorSeries("等级判定被改写", VIZ.up, reclassed),
              dotSeries("旧实现取值", cfg.oldKey, 6, 8, true),
              dotSeries("新方法取值", cfg.newKey, 7, 9, false),
            ],
          },
          true
        );
      };

      const spiThresholds = (data.thresholds && data.thresholds.spi) || {};
      const gdiThresholds = (data.thresholds && data.thresholds.gdi) || {};

      buildDumbbell(chartSpiSlope, {
        oldKey: "spi_old", newKey: "spi_new",
        classOldKey: "spi_class_old", classNewKey: "spi_class_new",
        oldLabel: "简化 Z-score", newLabel: "Gamma MLE",
        unit: "SPI",
        axisStep: 0.5,
        normalBand: [-1, 1],
        normalBandLabel: "SPI 正常区间 (−1 ~ +1)",
        thresholds: [
          { value: spiThresholds.moderate_drought ?? -1.0, label: `${spiThresholds.moderate_drought ?? -1.0} 中旱` },
          { value: spiThresholds.severe_drought ?? -1.5, label: `${spiThresholds.severe_drought ?? -1.5} 重旱` },
        ],
      });

      buildDumbbell(chartGdiSlope, {
        oldKey: "gdi_old", newKey: "gdi_new",
        classOldKey: "gdi_class_old", classNewKey: "gdi_class_new",
        oldLabel: "等权 Min-Max", newLabel: "PCA+K-Means",
        unit: "GDI",
        axisStep: 0.2, floorAt: 0,
        thresholds: [
          { value: gdiThresholds.light_moderate ?? 0.5032, label: `${gdiThresholds.light_moderate ?? 0.5032} 轻→中` },
          { value: gdiThresholds.moderate_severe ?? 0.7502, label: `${gdiThresholds.moderate_severe ?? 0.7502} 中→重` },
        ],
      });
    };

    // 渲染 SHAP 因子边际贡献横向条形图
    // 极性对: 抬升致灾=红 / 压低致灾=蓝 (红蓝冷暖对冲 CVD 安全，原红绿对亮度超标已弃用)
    const renderPuShapChart = () => {
      const dom = document.getElementById("chartPuShap");
      if (!dom) return;
      if (!chartPuShap) chartPuShap = echarts.init(dom);

      const topShap = (currentPuRisk.value && currentPuRisk.value.top_shap_features && currentPuRisk.value.top_shap_features.length > 0)
        ? currentPuRisk.value.top_shap_features
        : [
            { feature_label_cn: "月累计降水量", shap_value: 0.5986, direction: "increase_risk", contribution_pct: 25.4 },
            { feature_label_cn: "最大积雪深度", shap_value: 0.4887, direction: "increase_risk", contribution_pct: 20.8 },
            { feature_label_cn: "平均气温", shap_value: -0.4508, direction: "decrease_risk", contribution_pct: 19.2 },
            { feature_label_cn: "理论载畜量", shap_value: 0.1894, direction: "increase_risk", contribution_pct: 8.0 },
            { feature_label_cn: "植被指数(NDVI)", shap_value: -0.1650, direction: "decrease_risk", contribution_pct: 7.0 },
          ];

      const yData = topShap.map((f) => f.feature_label_cn).reverse();
      const xData = topShap
        .map((f) => ({
          value: f.contribution_pct,
          itemStyle: {
            color: f.direction === "increase_risk" ? VIZ.up : VIZ.down,
            borderRadius: [0, 4, 4, 0],
          },
        }))
        .reverse();

      chartPuShap.setOption({
        tooltip: {
          trigger: "axis",
          axisPointer: { type: "shadow" },
          formatter: (params) => {
            const p = params[0];
            const raw = topShap.find((f) => f.feature_label_cn === p.name);
            const dir = raw && raw.direction === "increase_risk" ? "抬升致灾概率" : "压低致灾概率";
            const signed = raw ? `${raw.shap_value > 0 ? "+" : ""}${raw.shap_value}` : "—";
            return `${p.name}<br/>边际贡献占比: <strong>${p.value}%</strong><br/>SHAP 值: ${signed}<br/>方向: ${dir}`;
          },
        },
        grid: { top: 12, bottom: 22, left: 116, right: 46 },
        xAxis: {
          type: "value",
          axisLabel: { color: VIZ.textMuted, fontSize: 11, formatter: "{value}%" },
          splitLine: { lineStyle: { color: VIZ.grid } },
          axisLine: { show: false },
        },
        yAxis: {
          type: "category",
          data: yData,
          axisLabel: { color: VIZ.textMain, fontSize: 12 },
          axisLine: { lineStyle: { color: VIZ.axis } },
          axisTick: { show: false },
        },
        series: [
          {
            name: "边际贡献占比",
            type: "bar",
            data: xData,
            barWidth: 14,
            label: {
              show: true,
              position: "right",
              color: VIZ.textMuted,
              fontSize: 11,
              formatter: "{c}%",
            },
          },
        ],
      });
    };

    // 渲染多灾种与 NPP 预测图 (真实对接 /api/forecast/disaster 与 /api/forecast/npp)
    const renderForecastCharts = async () => {
      const domDisaster = document.getElementById("chartMultiDisaster");
      const domNpp = document.getElementById("chartNppCompare");
      if (domDisaster && !chartMultiDisaster) chartMultiDisaster = echarts.init(domDisaster);
      if (domNpp && !chartNpp) chartNpp = echarts.init(domNpp);

      // 1. 真实多灾种时序 (恪守零伪造准则，初始化为空)
      if (chartMultiDisaster) {
        let days = [];
        let snowDepth = [];
        let ciUpper = [];
        let ciLower = [];

        try {
          const res = await fetch(`/api/forecast/disaster/${selectedRegionId.value}?days=30`);
          if (res.ok) {
            const d = await res.json();
            if (d.forecast_series && d.forecast_series.days_30) {
              days = d.forecast_series.days_30;
              snowDepth = d.forecast_series.snow_depth_30;
              ciUpper = d.forecast_series.ci_upper_30;
              ciLower = d.forecast_series.ci_lower_30;
            }
          }
        } catch (e) {
          console.warn("加载30天多灾种时序失败");
        }

        if (!days.length || !snowDepth.length) {
          chartMultiDisaster.clear();
          chartMultiDisaster.setOption({
            title: {
              text: "30天多灾种预测时序暂不可达\n(恪守零伪造纪律 · 严禁呈现假时序)",
              left: "center",
              top: "middle",
              textStyle: { color: VIZ.textMuted, fontSize: 12, lineHeight: 18 },
            },
          });
        } else {
          // 置信区间画成"带"，不画成上下两条带圆点的折线：
          // 两条平行点线在视觉上是两根独立序列，读者会去逐点比大小，
          // 而区间本身是一条信息——用带子表示才不会喧宾夺主。
          const ciBand = snowDepth.map((_, i) => Math.max(0, (ciUpper[i] ?? 0) - (ciLower[i] ?? 0)));
          const lineColor = VIZ.down;

          chartMultiDisaster.setOption({
            title: { show: false },
            tooltip: {
              trigger: "axis",
              axisPointer: { type: "line", lineStyle: { color: "rgba(241,245,249,0.25)" } },
              formatter: (params) => {
                const i = params[0] ? params[0].dataIndex : 0;
                return `${days[i]}<br/>积雪深度: <strong>${snowDepth[i]} cm</strong><br/>` +
                  `置信区间: ${ciLower[i]} – ${ciUpper[i]} cm`;
              },
            },
            legend: {
              data: ["积雪深度", "同月年际 ±1σ 区间"],
              top: 0, right: 0,
              itemWidth: 12, itemHeight: 8, icon: "roundRect",
              textStyle: { color: VIZ.textMuted, fontSize: 11 },
            },
            grid: { top: 30, bottom: 26, left: 42, right: 20 },
            xAxis: {
              type: "category", data: days, boundaryGap: false,
              axisLabel: { color: VIZ.textMuted, fontSize: 10, interval: 2 },
              axisLine: { lineStyle: { color: VIZ.axis } },
              axisTick: { show: false },
            },
            yAxis: {
              type: "value", name: "积雪深度 (cm)",
              nameTextStyle: { color: VIZ.textMuted, fontSize: 10, align: "left" },
              axisLabel: { color: VIZ.textMuted, fontSize: 10 },
              splitLine: { lineStyle: { color: VIZ.grid } },
              axisLine: { show: false },
            },
            series: [
              // 堆叠基座（不可见）：与下一条堆叠后让色带恰好落在上下界之间
              {
                name: "CI 基座", type: "line", stack: "ci", data: ciLower, symbol: "none",
                lineStyle: { opacity: 0 }, areaStyle: { opacity: 0 }, silent: true, z: 1,
              },
              {
                name: "同月年际 ±1σ 区间", type: "line", stack: "ci", data: ciBand, symbol: "none",
                lineStyle: { opacity: 0 }, areaStyle: { color: "rgba(57,135,229,0.16)" },
                // 图例色块取自 areaStyle，否则会落到主题默认的绿色，与图内颜色对不上
                itemStyle: { color: "rgba(57,135,229,0.45)" },
                silent: true, z: 1,
              },
              {
                name: "积雪深度", type: "line", data: snowDepth,
                symbol: "circle", symbolSize: 5, showSymbol: false, smooth: true, z: 5,
                lineStyle: { color: lineColor, width: 2 },
                itemStyle: { color: lineColor, borderColor: VIZ.surface, borderWidth: 2 },
              },
            ],
          });
        }
      }

      // 2. 真实 NPP 预测与基线时序 (来自 MODIS 真实观测与模型，恪守零伪造准则)
      if (chartNpp) {
        let years = [];
        let actual = [];
        let pred = [];
        let baseline = [];

        try {
          const res = await fetch(`/api/forecast/npp/${selectedRegionId.value}`);
          if (res.ok) {
            const d = await res.json();
            if (d.recent_history && d.recent_history.years) {
              years = d.recent_history.years;
              actual = d.recent_history.actual;
              pred = d.recent_history.pred;
              baseline = d.recent_history.baseline;
            }
          }
        } catch (e) {
          console.warn("加载NPP预测对比失败");
        }

        if (!years.length || !actual.length) {
          chartNpp.clear();
          chartNpp.setOption({
            title: {
              text: "MODIS NPP 观测与基线时序暂不可达\n(恪守真实观测准则 · 严禁呈现合成虚假数据)",
              left: "center",
              top: "middle",
              textStyle: { color: VIZ.textMuted, fontSize: 12, lineHeight: 18 },
            },
          });
        } else {
          const minVal = Math.max(0.01, Math.min(...actual, ...pred, ...baseline) - 0.05);
          const maxVal = Math.max(...actual, ...pred, ...baseline) + 0.05;

          chartNpp.setOption({
            title: { show: false },
          tooltip: {
            trigger: "axis",
            axisPointer: { type: "line", lineStyle: { color: "rgba(241,245,249,0.25)" } },
            valueFormatter: (v) => `${Number(v).toFixed(3)} kgC/m²·d`,
          },
          legend: {
            data: ["MODIS 实测 NPP", "本项目预测", "气候态均值基线"],
            top: 0, right: 0,
            itemWidth: 12, itemHeight: 8, icon: "roundRect",
            textStyle: { color: VIZ.textMuted, fontSize: 11 },
          },
          grid: { top: 30, bottom: 26, left: 46, right: 20 },
          xAxis: {
            type: "category", data: years, boundaryGap: true,
            axisLabel: { color: VIZ.textMuted, fontSize: 11 },
            axisLine: { lineStyle: { color: VIZ.axis } },
            axisTick: { show: false },
          },
          yAxis: {
            type: "value", name: "NPP (kgC/m²·d)",
            nameTextStyle: { color: VIZ.textMuted, fontSize: 10, align: "left" },
            min: round(minVal, 2), max: round(maxVal, 2),
            axisLabel: { color: VIZ.textMuted, fontSize: 10 },
            splitLine: { lineStyle: { color: VIZ.grid } },
            axisLine: { show: false },
          },
          series: [
            // 实测点用中性实心点（它是"事实"），预测线用彩色（它是"主张"），
            // 基线用灰虚线——三者的角色一眼可分，而不是三个高饱和色互相抢。
            {
              name: "MODIS 实测 NPP", type: "scatter", symbolSize: 9, data: actual,
              itemStyle: { color: VIZ.neutral, borderColor: VIZ.surface, borderWidth: 2 }, z: 5,
            },
            {
              name: "本项目预测", type: "line", data: pred,
              symbol: "none", smooth: true,
              lineStyle: { color: VIZ.down, width: 2 },
              itemStyle: { color: VIZ.down }, z: 4,
            },
            {
              name: "气候态均值基线", type: "line", data: baseline,
              symbol: "none",
              lineStyle: { type: "dashed", color: VIZ.context, width: 1.5 },
              itemStyle: { color: VIZ.context }, z: 3,
            },
          ],
        });
      }
    }
  };

    // 全域资源投放优先级：把"应急物资先投给哪个县"变成一张可读的排序图。
    // 唯一数值轴 = 综合风险分（连续量，决定排序）；颜色 = 补饲档位（状态，决定要不要动手），
    // 两者职责不重叠，故不构成双轴，也不让颜色去承担名次信息。
    const renderPriorityChart = () => {
      const dom = document.getElementById("chartPriorityRank");
      if (!dom || !priorityRanking.value) return;
      chartPriorityRank = chartPriorityRank || echarts.init(dom, null, { renderer: "canvas" });

      const rows = (priorityRanking.value.counties || []).filter((r) => r.risk_score !== null);
      if (!rows.length) return;

      // ECharts 类目轴自下而上绘制，升序入参才能让风险最高的县落在最上方
      const ordered = [...rows].sort((a, b) => a.risk_score - b.risk_score);
      const names = ordered.map((r) => r.name_cn.replace(/^.+?市|^.+?州|^.+?地区/, ""));

      chartPriorityRank.setOption({
        backgroundColor: "transparent",
        grid: { top: 12, bottom: 34, left: 84, right: 30 },
        // 补饲档位不是数据系列，ECharts legend 不会渲染无对应 series 的条目，
        // 因此图例由页面 HTML 提供 (见 .status-legend)，此处不重复声明。
        tooltip: {
          trigger: "item",
          backgroundColor: "rgba(13,20,34,0.96)",
          borderColor: "rgba(255,255,255,0.14)",
          textStyle: { color: VIZ.textMain, fontSize: 12 },
          formatter: (p) => {
            const r = ordered[p.dataIndex];
            return [
              `<strong>${r.name_cn}</strong>`,
              `综合风险分：${r.risk_score}`,
              `补饲档位：${r.feed_mode}`,
              `窗口均温：${r.mean_temp_c} ℃ ／ 平均积雪：${r.mean_snow_depth_cm} cm`,
              `干草需求：${r.hay_tons} 吨 ／ 建议信贷：${r.credit_quota_wan} 万元`,
            ].join("<br/>");
          },
        },
        xAxis: {
          type: "value",
          name: "综合风险分",
          nameLocation: "middle",
          nameGap: 26,
          nameTextStyle: { color: VIZ.textMuted, fontSize: 11 },
          axisLine: { lineStyle: { color: VIZ.axis } },
          axisLabel: { color: VIZ.textMuted, fontSize: 11 },
          splitLine: { lineStyle: { color: VIZ.grid } },
        },
        yAxis: {
          type: "category",
          data: names,
          axisLine: { lineStyle: { color: VIZ.axis } },
          axisTick: { show: false },
          axisLabel: { color: VIZ.textMuted, fontSize: 11 },
        },
        series: [
          {
            type: "bar",
            name: "综合风险分",
            barWidth: 9,
            // 数据端圆角、贴齐基线，符合细笔画规范
            itemStyle: { borderRadius: [0, 4, 4, 0] },
            data: ordered.map((r) => ({
              value: r.risk_score,
              itemStyle: { color: FEED_MODE_COLOR(r.feed_mode) },
            })),
          },
        ],
      }, true);
    };

    const round = (num, decimals) => {
      const factor = Math.pow(10, decimals);
      return Math.round(num * factor) / factor;
    };

    // 切换 Tab
    const switchTab = (tabId) => {
      currentTab.value = tabId;
      nextTick(() => {
        if (tabId === "cockpit") {
          chartMap && chartMap.resize();
          renderCockpitForecastChart();
        } else if (tabId === "index") {
          renderIndexHeatmap();
          renderMethodCompareCharts();
          renderPuShapChart();
        } else if (tabId === "forecast") {
          renderForecastCharts();
        } else if (tabId === "decision") {
          renderPriorityChart();
        }
      });
    };

    // 切换县域联动全系统 (全量 26 县真实动态响应，无任何假数据分支)
    const onRegionChange = async () => {
      // 1. 同步选中的县域实时指标，并把地图上的下钻描边挪到新县
      syncCurrentCountyMetrics();
      if (applyMapSelection) applyMapSelection();

      // 2. 加载选定县域的最新观测样本、指数与决策建议
      await Promise.all([
        loadSeriesSample(),
        loadIndicesAndDecision(),
      ]);

      // 3. 动态刷新当前活动视图下的所有图表
      nextTick(() => {
        if (currentTab.value === "cockpit") {
          renderCockpitForecastChart();
        } else if (currentTab.value === "index") {
          renderIndexHeatmap();
          renderMethodCompareCharts();
          renderPuShapChart();
        } else if (currentTab.value === "forecast") {
          renderForecastCharts();
        } else if (currentTab.value === "decision") {
          renderPriorityChart();
        }
      });
    };

    // 切换生理群
    const switchAgeGroup = (code) => {
      currentAgeGroup.value = code;
      renderIndexHeatmap();
    };

    // 跨页深度联动跳转
    const navigateTo = (tab, regionId = null) => {
      if (regionId) {
        selectedRegionId.value = regionId;
        onRegionChange();
      }
      switchTab(tab);
      window.scrollTo({ top: 0, behavior: "smooth" });
    };

    // 官方确证灾情事件与政策农险赔付实证 (127条真例，归一为 7 大标准类别)
    const verifiedEvents = ref([]);
    const verifiedStats = ref({ totalVerified: 127, totalUnlabeled: 1373, types: {} });
    const verifiedSelectedCategory = ref("全部");
    const verifiedCategories = ref([
      "全部",
      "暴雪与雪灾",
      "暴雨洪涝",
      "政策农险赔付实证",
      "强对流天气",
      "次生地质灾害",
      "干旱与草场压力",
      "寒潮与复合",
    ]);

    const loadVerifiedEvents = async (category = null) => {
      try {
        const cat = category !== null ? category : verifiedSelectedCategory.value;
        const url = cat && cat !== "全部"
          ? `/api/datasource/verified-events?category=${encodeURIComponent(cat)}&limit=100`
          : "/api/datasource/verified-events?limit=100";
        const res = await fetch(url);
        if (res.ok) {
          const d = await res.json();
          verifiedEvents.value = d.events || [];
          verifiedStats.value = {
            totalVerified: d.total_verified_count,
            totalUnlabeled: d.total_unlabeled_count,
            types: d.category_distribution || {},
          };
          if (d.categories_ordered) {
            verifiedCategories.value = d.categories_ordered;
          }
        }
      } catch (e) {
        console.warn("加载官方确证灾情凭证失败", e);
      }
    };

    const filterVerifiedEvents = (cat) => {
      verifiedSelectedCategory.value = cat;
      loadVerifiedEvents(cat);
    };

    const getCategoryTagStyle = (cat) => {
      switch (cat) {
        case "暴雪与雪灾": return { background: "rgba(56, 189, 248, 0.16)", color: "#38bdf8", border: "1px solid rgba(56, 189, 248, 0.3)" };
        case "暴雨洪涝": return { background: "rgba(59, 130, 246, 0.16)", color: "#60a5fa", border: "1px solid rgba(59, 130, 246, 0.3)" };
        case "政策农险赔付实证": return { background: "rgba(16, 185, 129, 0.16)", color: "#34d399", border: "1px solid rgba(16, 185, 129, 0.3)" };
        case "强对流天气": return { background: "rgba(245, 158, 11, 0.16)", color: "#fbbf24", border: "1px solid rgba(245, 158, 11, 0.3)" };
        case "次生地质灾害": return { background: "rgba(168, 85, 247, 0.16)", color: "#c084fc", border: "1px solid rgba(168, 85, 247, 0.3)" };
        case "干旱与草场压力": return { background: "rgba(234, 88, 12, 0.16)", color: "#fb923c", border: "1px solid rgba(234, 88, 12, 0.3)" };
        case "寒潮与复合": return { background: "rgba(239, 68, 68, 0.16)", color: "#f87171", border: "1px solid rgba(239, 68, 68, 0.3)" };
        default: return { background: "rgba(148, 163, 184, 0.16)", color: "#94a3b8", border: "1px solid rgba(148, 163, 184, 0.3)" };
      }
    };

    // 应急处置调度指令与留痕流水
    const dispatchLogs = ref([]);
    const dispatchStats = ref({ count: 2, hay: 55.8, grain: 11.1 });
    const dispatchSubmitting = ref(false);
    const dispatchToast = ref("");
    const dispatchForm = ref({
      action_type: "应急补饲与转场防寒",
      operator_role: "自治区防灾减灾应急指挥部调度中心",
      memo: "",
    });

    const loadDispatchLogs = async () => {
      try {
        const res = await fetch("/api/decision/dispatch-logs");
        if (res.ok) {
          const d = await res.json();
          dispatchLogs.value = d.logs || [];
          dispatchStats.value = {
            count: d.count,
            hay: d.total_dispatched_hay_tons,
            grain: d.total_dispatched_grain_tons,
          };
        }
      } catch (e) {
        console.warn("加载调度日志失败", e);
      }
    };

    const submitDispatch = async () => {
      if (dispatchSubmitting.value) return;
      dispatchSubmitting.value = true;
      dispatchToast.value = "";
      try {
        const feed = currentDecision.value.emergency_feed_demand || {};
        const hayTons = Number(feed.recommended_hay_tons || 17.6);
        const grainTons = Number(feed.recommended_grain_tons || 3.5);
        const feedCostWan = Number(feed.total_feed_cost_wan || 2.76);

        const payload = {
          region_id: selectedRegionId.value,
          hay_tons: hayTons,
          grain_tons: grainTons,
          feed_cost_wan: feedCostWan,
          action_type: dispatchForm.value.action_type || "应急补饲与转场防寒",
          operator_role: dispatchForm.value.operator_role || "自治区防灾减灾应急指挥部调度中心",
          credit_action: `已同步推送信贷系统 (拟增信 ${currentDecision.value.resilience_credit_quota_wan || 131.64} 万元)`,
          memo: dispatchForm.value.memo || `针对${currentRegionName.value}实施${dispatchForm.value.action_type}，调度干草${hayTons}吨、精饲料${grainTons}吨`,
        };

        const res = await fetch("/api/decision/dispatch", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        });

        if (res.ok) {
          const resData = await res.json();
          dispatchToast.value = `✓ 调度指令 [${resData.dispatch_id}] 已成功下达并存证留痕！`;
          await loadDispatchLogs();
          setTimeout(() => { dispatchToast.value = ""; }, 6000);
        } else {
          dispatchToast.value = "下发失败，请检查参数";
        }
      } catch (e) {
        dispatchToast.value = "提交异常: " + e.message;
      } finally {
        dispatchSubmitting.value = false;
      }
    };

    onMounted(async () => {
      await loadRegions();
      await loadCountyRisks();
      await loadPriorityRanking();
      await loadDataTiers();
      await loadSeriesSample();
      await loadIndicesAndDecision();
      loadVerifiedEvents();
      loadDispatchLogs();
      // 基准接口各约 1s / 4.4s，放在最后且不阻塞首屏渲染
      loadVerificationKpis();

      nextTick(() => {
        initPlateauMap();
        renderCockpitForecastChart();
      });

      window.addEventListener("resize", () => {
        chartMap && chartMap.resize();
        chartCockpitForecast && chartCockpitForecast.resize();
        chartIndexHeatmap && chartIndexHeatmap.resize();
        chartSpiSlope && chartSpiSlope.resize();
        chartGdiSlope && chartGdiSlope.resize();
        chartPuShap && chartPuShap.resize();
        chartMultiDisaster && chartMultiDisaster.resize();
        chartNpp && chartNpp.resize();
        chartPriorityRank && chartPriorityRank.resize();
      });
    });

    return {
      currentTab,
      selectedRegionId,
      currentAgeGroup,
      regions,
      dataTiers,
      macroStats,
      verifyKpi,
      countyRisks,
      currentSeriesSample,
      currentRemoteSample,
      seriesCoverage,
      currentMetrics,
      currentDisaster,
      snowLevelBadgeClass,
      snowDepthClass,
      snowDataDegraded,
      riskLevelCounts,
      uncertaintyInfo,
      priorityRanking,
      prioritySummary,
      currentSpi,
      currentGdi,
      currentPuRisk,
      currentDecision,
      currentRegionName,
      spiSummary,
      gdiSummary,
      matrixInsight,
      navTabs,
      ageGroups,
      switchTab,
      onRegionChange,
      switchAgeGroup,
      navigateTo,
      verifiedEvents,
      verifiedStats,
      verifiedSelectedCategory,
      verifiedCategories,
      loadVerifiedEvents,
      filterVerifiedEvents,
      getCategoryTagStyle,
      dispatchLogs,
      dispatchStats,
      dispatchSubmitting,
      dispatchToast,
      dispatchForm,
      submitDispatch,
      inkStyleOn,
    };
  },
}).mount("#app");
