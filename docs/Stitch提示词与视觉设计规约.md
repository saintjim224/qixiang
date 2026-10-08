> 历史设计稿，已被当前工作台实现取代。本文的固定数字、国标表述、指令下发和旧 PU 成绩不得复制进新版界面或参赛材料；请以当前代码与 `tools/out/pu_temporal_evaluation.json` 为准。
>
> **本文所有数值一律视为占位符。** 需要引用任何量化指标时，一律回到《参赛作品设计方案说明书》§7.3「数值单一来源说明」所列来源复跑取得（新增价值类指标见 `python tools/value_metrics_probe.py` → `tools/out/aic_value_metrics.json`）。

# 第八届全球校园人工智能算法精英大赛
## “智慧气象”算法主题赛 · 赛题方向（二）：气象赋能行业应用
# Google Stitch UI 设计提示词与视觉规约指南

> 💡 **使用前必读三条铁律**：
> 1. **只要图和色，不要代码**：本项目已锁定原生 Vue 3 + ECharts 5 零构建体系（Zero-Build Step），Stitch 生成的仅作为栅格比例、组件留白与色板采样的视觉参考；
> 2. **中文字体渲染模糊属于正常现象**：Stitch 渲染 CJK 字体常有占位乱码或模糊，重点看**栅格分栏、视觉流向、留白率与层级对比**；
> 3. **严禁截图直接放入申报材料**：Stitch 界面上的数字为模拟占位符，若截图进正式文档将触发大赛《真实性审查》红线（§7.3），真实运行截图必须从本地真实运行系统（`http://127.0.0.1:8001/`）截取！
>
> 🌐 **Stitch 平台访问地址**：`https://stitch.withgoogle.com/`（支持 Google 账号登录免费使用）。

---

## §1. 全局共用规范 (Global Base Prompt)
> 📌 **使用方法**：在向 Stitch 输入任何单个页面的 Prompt 前，**必须先粘贴本段规范**，确保全系统 5 大页面出自同一套 Design Token 与交互逻辑。

```markdown
[PROJECT IDENTITY & DESIGN SYSTEM SPECIFICATION]
Project: High-Plateau Multi-Source Spatio-Temporal Meteorological Disaster Warning & Grazing-Livestock Resilience Decision Platform (Qinghai-Tibet Alpine Pasture).
Competition Track: 2026 AI Algorithm Elite Competition - Intelligent Meteorology Track II (Agri-Finance Synergy).
Design Theme: Operational Meteorological Cockpit & Scientific Decision System. Modern Dark Mode, Scientific Grade, Utmost Rigor.

CORE DESIGN CONSTRAINTS (MANDATORY SUBTRACTIONS):
1. TYPOGRAPHY WEIGHT LIMIT: Strict limit of AT MOST 3 font weights across the UI (400 Regular for body/notes, 600 Semi-Bold for section headers, 700 Bold for primary KPIs only). NO arbitrary ultra-heavy fonts.
2. CARD DENSITY CONTROL: At most 4-6 cards per viewport. Prevent cognitive fatigue. Wide breathing margins (gap: 16px to 20px, padding: 18px).
3. SINGLE DOMINANT FOCUS: Each tab MUST have EXACTLY ONE primary visual anchor (Tab 1: GIS Risk Map; Tab 2: 3-Stage Data Topology; Tab 3: Model Benchmark Matrix; Tab 4: 30-Day Evolution & Validation Table; Tab 5: County Priority Ranking & Dispatch Audit). Secondary elements must visually yield to the primary anchor.
4. ZERO WALLS OF GREY TEXT: Eliminate all long, unformatted grey paragraphs. All methodological notes must use structured key-value chips or concise bulleted callouts.

THREE CARDINAL VISUAL INTENTS:
1. GEOGRAPHIC CONTEXT FOR MAP: Bare polygon floating in a dark vacuum is STRICTLY UNACCEPTABLE. The regional map must display clear geographic context: elevation contour hints (3,000m - 5,200m), latitude/longitude graticules (30°N~36°N, 80°E~102°E), a North arrow (Compass Rose), and a graphic scale bar (0-200 km).
2. DIVERGENT TRAFFIC-LIGHT RISK RAMP: In real-world highland pastoral meteorology, MOST counties are calm and safe under normal conditions. A pure monotonic red ramp makes a peaceful plateau look like a catastrophic inferno. The palette MUST read as "mostly calm/emerald, with a few prominent hot spots (amber/red)".
3. WCAG 2.1 AA ACCESSIBILITY: All text-on-fill ratios MUST guarantee >= 4.5:1 contrast. Light text on dark fills (#f8fafc on dark), dark text on light fills (#0f172a on yellow/amber), with subtle outline fallback if near boundary.

TOKEN PALETTE REFERENCE:
- Canvas Surface: #080c14 (Deep Void Navy)
- Panel Surface: rgba(14, 21, 37, 0.85) with border rgba(45, 62, 85, 0.6)
- Text Main: #f1f5f9 | Text Muted: #94a3b8 | Text Dim: #64748b
- Risk Diverging Ramp: 
  * Low Risk (Calm): #10b981 (Emerald Green, 0-35)
  * Mild (Attention): #0ea5e9 (Sky Blue, 35-50)
  * Moderate (Watch): #f59e0b (Amber Yellow, 50-65)
  * Severe (Warning): #f97316 (Orange, 65-80)
  * Extreme (Emergency): #ef4444 (Flame Crimson, 80-100)
- Brand Accent / Focus: #00d2ff (Cyan) / #3a86ff (Cobalt)
```

---

## §2. 五个页面的具体 Prompt

### 页面 1：风险态势驾驶舱 (Tab 1: Risk Overview & Cockpit)

```markdown
[PAGE 1 PROMPT: RISK SITUATION COCKPIT]
Context: Paste §1 Global Base Prompt first.

Layout Architecture (Grid & Proportions):
- Header Bar (Height: 64px): System Title "融天气象 - 高原多源时空融合气象灾害预警平台", 5 Tab Navigation buttons with active state on Tab 1, right-aligned county selector dropdown ("那曲市色尼区 · 4520m 高寒草甸").
- Top Overview Metrics Strip (4 Horizontal KPI Cards, 1 Row):
  * Card 1: "监测覆盖县域" -> 26 走廊县 (西藏/青海/四川/甘肃 4省区).
  * Card 2: "重特大雪灾预警" -> 3 县预警中 (Tag: GB/T 20482 国标 III/IV 级).
  * Card 3: "干旱预警 (SPI-3)" -> 1 县异常预警 (Tag: Gamma 拟合降水指数).
  * Card 4: "草畜平衡指数" -> 0.92 全域均值 (Tag: 实际存栏 ÷ 精算载畜量).
- Main Body Grid (2 Columns, Ratio 62% : 38%):
  * Left Primary Anchor (62% width): Qinghai-Tibet Plateau 26-County GeoJSON Risk Map.
    - Floating geographic badge: "🧭 北 (N) | 青藏高寒牧区 (30°N~36°N, 80°E~102°E · 海拔 3,000~5,200m)".
    - Scale bar in bottom right corner: "0 ─── 200 km".
    - Vertical visualMap legend on bottom-left: Divergent green-to-red ramp showing "高险 89" down to "低险 24". Most counties colored emerald/cyan (#10b981 / #0ea5e9), with 2-3 snow-hit counties highlighted in amber/red (#f59e0b / #ef4444).
    - Top header of map panel includes 3 Quick-jump link badges: [气象指数详查 →], [NPP预测外推 →], [应急调度决策 →].
  * Right Secondary Column (38% width, 2 Stacked Panels):
    - Top Panel: Current County (那曲市色尼区) Real-Time Weather & National Standard Box. 4 clean stat blocks: 日均气温 (-9.3℃), 积雪深度 (1.4cm, Tag: 正常), 牧区雪灾等级 (正常·无灾害), 季气象干旱 (SPI-3 = -0.59, 正常偏湿).
    - Bottom Panel: 16-Day Extreme Weather Forward Projection Curve. Dual-line chart showing Forecast Temp (cyan) vs Snow Depth (blue filled area) across D+1 to D+16.
```

---

### 页面 2：气象数据底座 (Tab 2: Meteorological & Remote Sensing Data Foundation) ★【重构重点】

> 🎯 **重构设计思想**：摒弃单纯罗列原始数据表格的陈旧做法，构建「**数据链 → 分级依据 → 真实凭证**」三段式叙事链条，精准支撑大赛评审标准中“**需求分析与技术选用依据（15分）**”。

```markdown
[PAGE 2 PROMPT: METEOROLOGICAL & REMOTE SENSING DATA FOUNDATION]
Context: Paste §1 Global Base Prompt first.

Narrative Structure: 3 Sequential Vertical Stages (Pipeline Flow -> Industry Standards -> Ground Truth Evidence).

Stage 1: Multi-Source Spatio-Temporal Data Pipeline & Ingestion Topology (Top Section):
- Full-width panel with title "1. 多源长时序时空数据链与清洗对齐拓扑 (Data Ingestion & Alignment Topology)".
- 3 Connected Sequential Step Cards (Horizontal 3-Column Grid):
  * Step 01 (Multi-Source Ingestion): TPDC CMFD packaged 2015-2024 subset, ECMWF ERA5 reanalysis (2020-2025, 2,192 daily records per county), NASA MOD17A3HGF (2001-2025, 650 annual NPP product records), NASA MCD12Q2 phenology product, Open-Meteo API, and 127 source-linked event labels pending review.
  * Step 02 (Spatio-Temporal Alignment Operators): Daily to 16-day sliding window aggregation; 26 counties x 80 micro-grids (2,080 grids); Zero-precipitation probability boundary handler (q=m/N); Elevation temperature lapse rate correction (0.0065 ℃/m); Double-blind identity stripping.
  * Step 03 (Unified Feature Matrix Output): 16-dimensional PU feature matrix; 4-dimensional GDI remote sensing vector; 650-sample LOYO/LORO product reference table; Alpine grazing vulnerability coefficients (0.70 meadow / 1.00 steppe / 1.35 desert).

Stage 2: Disaster & Ecological Classification Standards Matrix (Middle Section):
- 4-Column Grid displaying 4 formal scientific standards:
  * Standard 1 (Blizzard): National Standard GB/T 20482-2017《雪灾气象等级》 (Light >=5cm, Moderate >=10cm, Heavy >=15cm, Severe >=20cm). Rationale: Replaces arbitrary rules with statutory physics thresholds.
  * Standard 2 (Drought): WMO Standardized Precipitation Index (SPI-3) (Extreme <=-2.0, Heavy -1.99~-1.50, Light -1.49~-1.00, Normal -0.99~+0.99, Wet >=+1.00). Rationale: Gamma MLE fitting eliminates winter zero-precip variance collapse.
  * Standard 3 (Degradation): Li et al. (2025, Remote Sensing) GDI Index (Stable <0.1589, Light 0.1589~0.5032, Moderate 0.5032~0.7502, Severe >0.7502). Rationale: PCA + curvature break points break flat nationwide homogeneity.
  * Standard 4 (Carrying Capacity): National Agricultural Standard NY/T 635-2015 Carrying Capacity (Sheep unit ratio: Sheep 1.0, Yak 4.0; Dry matter requirement: 2.5% body weight). Rationale: Translates meteo signals into exact tons of feed demand.

Stage 3: Ground Truth Boundaries & Official Disaster Evidence (Bottom Section, 2-Column Split):
- Left Column (Width: 380px): Data Boundary Classification Card:
  * Source-linked Label Box (127 Cases, Red highlight): Event records pending review of county, event type, amount, and meteorological connection.
  * Unlabeled Box (1,373 Cases, Amber highlight): Months without linked reports. Unlabeled (U) is not a verified disaster-free class; do not label its alert rate as a false alarm rate.
  * NPP Product Reference (650 Cases, Green highlight): 26 counties x 25 years NASA MODIS annual product records.
- Right Column: Official Disaster Evidence Traceability Table (Clean dark data table with scroll):
  * Columns: Month (e.g. 2024-12), County (雷乌齐县), Disaster Type (雪灾/保费理赔), Severity (中度), Loss Amount, Claim Amount, Official Traceability Link (clickable link to financial news/ministry bulletin).
```

---

### 页面 3：气象风险指数与 PU 学习消融 (Tab 3: Meteorological Risk Indices & PU Ablation)

```markdown
[PAGE 3 PROMPT: METEOROLOGICAL RISK INDICES & PU ABLATION]
Context: Paste §1 Global Base Prompt first.

Layout Architecture:
- Top Section: Dual Lollipop / Dumbbell Slope Comparison Charts (2 Columns, 50% : 50%):
  * Left: SPI-3 Drought Index (Gamma MLE vs Legacy Z-score). 26 horizontal rows representing 26 counties sorted by SPI. Hollow dot = old Z-score, Solid dot = new Gamma MLE. Threshold dashed lines at -1.0 and -1.5. Top stat badges: Level changed: 1 / 26 counties, Mean |ΔSPI|: 0.0985, Current County: -0.59 (Normal). Honest note explaining N=5 sample size variance.
  * Right: GDI Grassland Degradation Index (PCA+KMeans vs Old Min-Max). 26 horizontal rows. Red dots/lines indicate counties where degradation level was corrected (22 / 26 counties). Threshold lines at 0.5032 and 0.7502. Top stat badges: Corrected: 22 / 26 counties, Mean |ΔGDI|: 0.3808, Current County: 0.6529 (Moderate).
- Middle Section: Micro-Grid Heatmap Matrix (3 Pasture Types x 4 Seasons, 12 Cells):
  * 3 rows (Alpine Desert, Alpine Steppe, Alpine Meadow) x 4 columns (Spring, Summer, Autumn, Winter).
  * Cells colored with sequential risk palette, numbers boldly centered with WCAG AA compliant text color.
  * Right sidebar reads: Peak Cell: Alpine Desert Winter (89), Minimum: Alpine Meadow Summer (24), Pasture Spread: 51 points.
- Bottom Primary Section: PU Learning Ablation Benchmark & SHAP Explainability (Dominant Anchor):
  * Header with Tag: "PU 末年留出诊断" and Jump link button: [查看数据底座 127 条待复核来源记录与样本流转 →].
  * Left Half: 3-Baseline Ablation Table:
    - Baseline 1 (Rule-based): Labeled recall 1.0000, unlabeled alert rate 0.9785, label F1 0.1333, label Brier 0.1525.
    - Baseline 2 (Naive Supervised): Labeled recall 0.0000, unlabeled alert rate 0.0036, label F1 0.0000, label Brier 0.0652.
    - Model 3 (Bagging PU Learning): Labeled recall 0.4286, unlabeled alert rate 0.2401, label F1 0.1856, label Brier 0.1602.
    - Callout: "Historical label diagnostics only; unlabeled records are not verified negatives."
  * Right Half: SHAP TreeExplainer Horizontal Bar Chart:
    - Top 5 drivers: Monthly Precip (25.4%), Snow Depth (20.8%), Mean Temp (19.2%), Carrying Pressure (8.0%), NDVI (7.0%).
    - Bars color-coded by contribution direction (Red for increase risk, Cyan for decrease risk).
```

---

### 页面 4：灾害预测与草畜平衡 (Tab 4: Spatio-Temporal Prediction & LOYO/LORO Benchmark)

```markdown
[PAGE 4 PROMPT: SPATIO-TEMPORAL PREDICTION & BENCHMARK VALIDATION]
Context: Paste §1 Global Base Prompt first.

Layout Architecture:
- Top Section (2 Columns, 50% : 50%):
  * Left Panel: Current County (那曲市色尼区) 30-Day Snow Depth Evolution & Climatology Envelope:
    - Line chart: First 16 days driven by Open-Meteo daily forecast (solid blue curve); Days 17-30 extrapolated by ERA5 10-year climatology (calm continuation).
    - Shaded grey/cyan envelope representing historical interannual standard deviation (+-1.0 sigma).
  * Right Panel: Grassland NPP Annual Yield Prediction vs 3 Baselines (2021-2025):
    - Ground truth dots (NASA MODIS real observations).
    - Model forecast curve (cyan) vs Climatological Mean baseline curve (dashed grey).
- Bottom Primary Section: Full-Width Scientific Benchmark Scorecard (Strict LOYO & LORO Protocols):
  * Tag: "650 真实观测样本 · 双向留一验证 (严禁随机切分)".
  * Protocol A: Leave-One-Year-Out (LOYO, Temporal Extrapolation, 25 Folds, 650 Samples):
    - Baseline 1 (Climatological Mean): MAE 0.0142, RMSE 0.0202, R2 0.9974.
    - Baseline 2 (Linear Trend OLS): MAE 0.0122, RMSE 0.0175, R2 0.9980.
    - Baseline 3 (3-Year Moving Average): MAE 0.0127, RMSE 0.0186, R2 0.9977.
    - Our System (Meteo-Driven Ridge): MAE 0.0117 (MAE -17.4% vs B1), RMSE 0.0249, R2 0.9960.
  * Protocol B: Leave-One-Region-Out (LORO, Spatial Cross-County Transfer, 26 Folds, 650 Samples):
    - Baseline 1: MAE 0.2567, RMSE 0.4036, R2 -0.0598.
    - Baseline 2: MAE 0.2592, RMSE 0.4077, R2 -0.0810.
    - Baseline 3: MAE 0.2585, RMSE 0.4077, R2 -0.0814.
    - Our System (Environment Gradient Regressor): MAE 0.2060 (MAE -20.5% vs B2), RMSE 0.3933, R2 -0.0060.
  * Methodological Notes Callout:
    - Explains why MAE reduced 17.4% (L1 penalty robust to outlier extremes);
    - Transparently discloses why RMSE is slightly higher on extreme blizzard years;
    - Explains that high R2 (~0.996) is mathematically dominated by constant elevation variance (3,000m to 4,750m) rather than interannual drift;
    - Honestly reports negative R2 under spatial zero-shot transfer without local micro-sensors.
```

---

### 页面 5：应用与韧性决策 (Tab 5: Resilience Decision, Dispatch Audit & Financial Synergy)

```markdown
[PAGE 5 PROMPT: RESILIENCE DECISION, DISPATCH AUDIT & FINANCIAL SYNERGY]
Context: Paste §1 Global Base Prompt first.

Layout Architecture:
- Top Section (2 Columns, 55% : 45%):
  * Left Column: Meteo-Driven Emergency Reserves & Financial Decision Signals:
    - 3 Highlight KPI Cards:
      1. Emergency Feed Demand: 17.6 Tons Hay + 3.5 Tons Grain (Cost: 2.76 万元, Window: 14 Days).
      2. Disaster Asset Exposure: 4.25 万元 (Total Yak Assets: 850 万元, Loss Exposure: 0.5%).
      3. Green Credit & Insurance Quota: 131.64 万元 (Proactive disaster mitigation credit ceiling).
    - 4 Action Protocols (Clean numbered steps): 01 Weather Status, 02 Feed Storage, 03 Freeze Migration, 04 Financial Synergy.
    - NEW Interactive Dispatch Action Card (Audit Closed Loop):
      * Sub-card: "下发那曲市色尼区应急调拨指令".
      * Input fields: Hay Tons (17.6t), Grain Tons (3.5t), Action Type dropdown, Operator Role.
      * Action Button: [保存本地模拟方案].
      * Sub-table: "本地模拟记录" displaying simulation ID, Timestamp, Target County, Tons, Status badge ("已保存 LOCAL").
  * Right Column: Scientific Benchmark Scorecard (Core Scoring Summary):
    - 4 Big Metric Chips: Label F1 (0.1856), unlabeled alert rate (0.2401), label Brier (0.1602), NPP LOYO MAE (0.0117).
    - Evidence Review Box: 127 source-linked event records with county, category, amount, and causality pending review.
- Bottom Section: All 26 Counties Emergency Resource Allocation Priority Ranking (Horizontal Bar Chart):
  * Panel Header includes Jump Links: [返回驾驶舱空间分布 →], [查看当前县气象指数 →].
  * 4 Summary Metric Chips: Total Feed Demand (193.6 Tons), Counties Requiring Feed (11 / 26), Cumulative Coverage (Rank 9 covers 50%), Matched Green Credit (3360.54 万元).
  * 26 Horizontal bars sorted by Comprehensive Risk Score (玛沁县 41.2 down to 措美县 15.3).
  * Bar lengths represent Risk Score; Bar colors represent Feed Tier (Green: Full Pasture, Yellow: Light Supplement, Orange: Half Grazing Half Feed, Red: Full Artificial Feeding).
```

---

## §3. 视觉成果 12 条逐项打勾验收清单 (Checklist)

在拿到 Stitch 生成的图稿后，请对照下表逐条打勾核验：

- [ ] **1. 地图地理上下文**：地图底图严禁为“黑色虚空中的漂浮孤立多边形”，必须有经纬度网格线、地形起伏线索、北向标（Compass）与比例尺。
- [ ] **2. 交通灯发散风险色谱**：全图 26 县必须呈现“大部区域翡翠绿/蓝、少数 2~3 个受灾点橙红”的真实态势，绝不能满屏通红。
- [ ] **3. 视觉焦点单一性**：每一页有且仅有一个视觉重心（Dominant Anchor），其余卡片对比度自然退让，避免多点抢戏。
- [ ] **4. 字重严格不超过 3 档**：全文仅使用 Regular(400)、Semi-Bold(600)、Bold(700)，禁止滥用特粗字体。
- [ ] **5. 卡片数量与呼吸感**：单屏主要卡片数量控制在 4~6 张以内，边距（gap）保持 16~20px，无拥挤堆砌感。
- [ ] **6. 彻底杜绝小灰字墙**：没有连续超过 3 行未经提炼的小灰字段落，所有说明均结构化为标签、指标条或分步清单。
- [ ] **7. 页 2 三段式叙事落地**：数据底座页面清晰展现「数据链拓扑 → 4 大行业分级依据 → 127 真实正例/1373 未标注事实凭证」。
- [ ] **8. 算法指标客观透明**：LOYO 与 LORO 验证表中同时并列 MAE、RMSE 与 $R^2$，没有选择性隐瞒或虚报。
- [ ] **9. 业务闭环与留痕**：页 5 包含完整的“调度指令下发”与“防灾留痕审计流水表”，形成业务闭环。
- [ ] **10. 跨页导航流向明确**：驾驶舱、指数页、决策页之间包含清晰的深链跳转标识，逻辑环环相扣。
- [ ] **11. 文本对比度合规 (WCAG AA)**：浅色字在深色背景、暗色字在浅色背景上的对比度均满足 $\ge 4.5:1$。
- [ ] **12. 严格双盲合规**：全图界面严禁出现任何高校 Logo、院系校徽、导师姓名或参赛人员个人信息。

---

## §4. 可直接落地的参考色板与 Token 映射 (VIZ Tokens)

```javascript
// 代码已落地于 frontend/js/app.js 与 frontend/css/main.css
const VIZ = {
  surface: "#0d1422",       // 容器基准画布底色
  grid: "rgba(255, 255, 255, 0.06)",
  axis: "rgba(255, 255, 255, 0.14)",
  
  // 发散交通灯风险色阶 (0 - 100 连续分位数映射)
  seq: [
    "#10b981",  // 0~35: 稳态/低风险 (Emerald Green · 对比度 7.2:1)
    "#0ea5e9",  // 35~50: 关注/低中 (Sky Blue · 对比度 6.5:1)
    "#f59e0b",  // 50~65: 轻中度预警 (Amber Yellow · 对比度 7.8:1)
    "#f97316",  // 65~80: 重度警示 (Warning Orange · 对比度 5.8:1)
    "#ef4444",  // 80~100: 特重极危 (Flame Red · 对比度 4.8:1)
  ],

  // 极性致因对冲
  up: "#ef4444",    // 增险/恶化 (Red)
  down: "#10b981",  // 缓释/改善 (Green)

  // 状态分档映射 (补饲档位与处置响应)
  status: {
    calm: "#10b981",   // 全草场放牧 (无需补饲)
    light: "#f59e0b",  // 轻度补充防寒
    half: "#f97316",   // 半草场半补饲
    full: "#ef4444",   // 全人工重度补饲
  },

  textMain: "#f1f5f9",
  textMuted: "#94a3b8",
  accent: "#f8fafc",
};
```
