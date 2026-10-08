# 前端改版 · Stitch 提示词包

> 用途：给 Google Stitch 出「视觉参考图」，**不是**要它的代码。
> 拿到图后回到本项目原地改 `frontend/css/main.css` + `frontend/js/app.js` 的 VIZ token。
> 生成日期：2026-10-01

---

## 0. 三条使用纪律（先读）

1. **只要图和色，不要代码。** Stitch 导出的是它自己的 HTML/React 风格，而规格书 D23 锁死「Vue3 全局版 + ECharts 本地 vendor + 零构建」。搬代码＝破决策 + 重接 5 条 API 链。
2. **中文字会糊。** Stitch 渲染 CJK 常出乱码或伪中文，这是已知现象。**别在意文字**，只看栅格、留白、层级、配色。文字回本项目里用真数据渲染。
3. **绝不截图进材料。** Stitch 稿里是占位数字和假地名，一旦进文档或 PPT 就撞规格书红线 §7.3「不得以概念描述替代实际验证」。

---

## 1. 共用设计规范（每页 prompt 都先粘这段）

```
Design a data-dense monitoring dashboard for a meteorological risk platform.

GLOBAL STYLE
- Target: 1920x1080 desktop, projected on a large screen during a presentation.
  Body text must be readable when projected: minimum 14px, key numbers 28-40px.
- Dark theme. Background #0b1220, card surface #0d1422, border rgba(255,255,255,0.08).
- Corners radius 10px. Card padding 20px. Grid gap 16px.
- Typography: one sans family. Three weights only — 400 body, 600 label, 700 number.
  Do NOT use more than three font sizes per card.

VISUAL HIERARCHY (this is the main fix)
- Each page has exactly ONE primary element that occupies the most area.
- Secondary panels are visibly subordinate: smaller, less saturated, thinner border.
- No more than 6 cards visible per screen. Never a uniform grid of equal-weight cards.

COLOR SEMANTICS
- Use a traffic-light ramp for risk, NOT a single-hue red ramp:
    lowest risk  #2c6e6a  (calm teal)
                 #5f9e6e  (soft green)
                 #d4b03c  (amber)
                 #e07a2f  (orange)
    highest risk #d94a3d  (alarm red)
  Rationale: most regions are LOW risk. A red ramp makes a calm map look like
  a full emergency. The map must read "mostly calm, a few hot spots".
- Neutral/muted text #94a3b8. Primary text #f1f5f9. Accent for selection #f8fafc.

MAP REQUIREMENT (page 1 only, but critical)
- The choropleth map MUST sit on a geographic context layer: province boundaries
  and subtle terrain/relief shading. Bare polygon shapes floating on a black
  background is NOT acceptable — it reads as scattered puzzle pieces.

CHARTS
- Charts are ECharts-style, flat, no 3D, no drop shadows on data marks.
- Axes: labels at 12px muted, gridlines at 6% white. Never both gridlines and borders.
- Always include a legend when more than one series is shown.

DO NOT INCLUDE
- Any placeholder logo, any university name, any watermark, any fake person name.
- Long paragraphs of small grey explanatory text. If a note is needed, make it a
  single short line at 13px, or move it out of the card entirely.
```

---

## 2. 五个页面 prompt

### 页 1 · 风险态势驾驶舱

```
[粘上面 §1 共用规范]

LAYOUT: 100vw x 100vh, no page scroll.
- Top bar 64px: left = compact wordmark block; right = region selector (dropdown)
  showing current county name. Center = 5-step horizontal progress nav, each step is
  a number + short label on ONE line (do not let labels wrap to two lines).
- KPI strip, 4 equal cards, 96px tall:
    监测覆盖县域 26 · 干旱预警(SPI-3) 7 · 重特大雪灾预警 0 · 草畜平衡指数 0.34
  Style: small muted label on top, large number below, one short sub-caption.
  The "0 雪灾预警" card should read visually CALM (teal), not alarming.
- Main area, two columns 2:1.
  LEFT (primary, ~66% width): full-bleed choropleth map of 26 counties on the
    terrain + province-boundary context layer. Traffic-light risk ramp.
    A horizontal legend bar at the bottom of the map, with labels 低 / 中 / 高.
    One county is highlighted with a white outline (the currently selected one).
    Small floating count chips: 低风险 23 · 中风险 3 · 高风险 0.
  RIGHT (~33%, secondary, visibly quieter):
    - Card A "current county at a glance": 2x2 mini stat tiles
      (日均气温 +6.9℃ / 积雪深度 2.7cm / 牧区雪灾等级 正常 / 季气象干旱 轻旱)
    - Card B: a small 16-day dual line chart (temperature + snow depth),
      compact, no title inside, just axis labels D+1 ... D+16.
- The map must dominate. The right column must not compete with it.
```

### 页 2 · 气象数据底座 ← **最需要重做的一页**

```
[粘上面 §1 共用规范]

PROBLEM TO SOLVE: the current version is two raw data tables. It reads like a
database dump. It must instead read like a DATA PROVENANCE STORY.

LAYOUT: three vertical bands, no page scroll.

BAND 1 — "多源数据链" (about 30% height)
- A horizontal flow diagram, left to right:
    [4 satellite/reanalysis source boxes] → [fusion node] → [4 derived product boxes]
  Sources: TPDC CMFD 2.0 (1951-2024) / ECMWF ERA5 (2015-2025) /
           Open-Meteo realtime / NASA MOD17A3HGF + MCD12Q2 (2001-2025)
  Derived: 气象驱动空间 / 遥感生态与物候特征 / 灾情事件凭证 127 条
- Each source box: name + time range + a tiny colored dot indicating update cadence
  (realtime / daily / static).

BAND 2 — "数据事实分级" (about 25% height)
- 5 tier cards in a row, each with a distinct left border color by tier:
    公开观测 / 派生 / 来源支持事件 / 样例模拟 / 未标注
  Each card: tier name, one-line definition, count badge, and a small icon.
- This band is a SCORING ASSET (honest data classification), so make it prominent
  and confident, not apologetic.

BAND 3 — "样本检视" (about 45% height)
- A single compact table with tabs: [气象驱动序列] [MODIS 遥感场景序列]
  Only ~6 visible rows. Columns are narrow. Numbers right-aligned, monospace.
- Above the table, a one-line strip: county name + "只读旧资产" + a small note.

KEY: no table should dominate the page. The story is the data CHAIN and the
CLASSIFICATION, not the rows.
```

### 页 3 · 气象风险指数

```
[粘上面 §1 共用规范]

LAYOUT: two rows.
ROW 1 (55% height) — two side-by-side comparison panels, equal width.
  LEFT: "SPI-3 标准 Gamma 拟合 vs 简化 Z-score"
  RIGHT: "GDI 草地退化指数 PCA+K-Means vs 简化版"
  Each panel is a DUMBBELL chart: 26 counties listed vertically on the left axis,
  each row has two dots (旧值 grey muted, 新值 red) connected by a line.
  Counties where the grade CHANGED get the new dot in alarm red and a bold label;
  unchanged counties stay fully grey. This makes "which ones changed" pop instantly.
  Each panel has a 3-stat strip on top: 等级发生改判的县数 / 均值 / 当前县取值+等级.
  Below each panel, ONE line of 13px note maximum. Not a paragraph.

ROW 2 (45% height) — two panels again.
  LEFT (60%): "微网格风险矩阵" — a 3x4 heatmap grid
    (rows = 高寒荒漠 / 高寒草原 / 高寒草甸, cols = 春/夏/秋/冬),
    cell values 24..89, traffic-light ramp. A compact read-out panel on the right
    of the grid: 峰值单元 / 峰值风险值 / 最低单元 / 季节极差 with numbers.
  RIGHT (40%): "PU Learning 消融对照" — a 4-row comparison table
    (规则基线 / 朴素监督基线 / 本项目 PU模型), columns 准确率/精确率/召回率/F1/Brier.
    The winning row highlighted with a left accent bar.
    Below it, a compact horizontal SHAP bar chart, top 5 features.

CRITICAL: this page currently has a wall of tiny grey explanatory text. Remove it.
Replace every long note with a number or delete it.
```

### 页 4 · 灾害预测与草畜平衡

```
[粘上面 §1 共用规范]

LAYOUT: two rows.

ROW 1 (45%) — full width, "积雪深度 30 天演化与不确定区间"
- A line chart with a shaded confidence band around the forecast line.
- A vertical divider marker at "今日" separating 实测 (solid line) from 预测 (dashed).
- Below the x-axis, a small caption strip explicitly stating the confidence layer:
  "0-16 天: Open-Meteo 实时预报" and "17-30 天: 气候态外推 · 非统计置信区间"
  Render these as two small labeled chips, NOT as a sentence.

ROW 2 (55%) — "草地 NPP 预测与基线对照"
- LEFT (65%): a line chart, NPP over 2001-2025.
  Four series: 本系统预测 (thick, accent color) vs 三条基线
  (气候态均值 / 线性趋势 / ARIMA, all thin and muted grey).
  A visible gap annotation at the recent years showing the improvement.
- RIGHT (35%): a metrics table, 4 rows x 3 cols (MAE / RMSE / R2), one row per method,
  the proposed method's row highlighted. Two sub-tabs at top: [留一年 LOYO] [留一县 LORO].
- A single stat tile at the top right of this row: "NPP 误差降低 +17.4%",
  with a small muted sub-caption "相对气候态基线 · LOYO 时间外推".

HONESTY REQUIREMENT: the LORO tab's R2 values are negative. Show them, do not hide
them. Style negative R2 in muted grey with a small "跨区外推" tag, so it reads as a
disclosed limitation rather than a failure.
```

### 页 5 · 应用与决策

```
[粘上面 §1 共用规范]

LAYOUT: two rows.

ROW 1 (40%) — "决策信号", three cards in a row, each with a colored top edge:
  1. 应急补饲调度 — 大数字 17.6 吨干草, sub: 精饲料 3.5 吨, foot: 按 1000 头核算
  2. 灾害暴露敞口 — 大数字 850 万元, sub: 总暴露牲畜资产, foot: 脆弱性与积雪时长建模
  3. 绿色信贷与保险增值 — 大数字 131.64 万元, sub: 气候韧性防灾信贷建议额度
  Each card must also carry a small "派生值" tag — these are derived, not observed.
- Below the three cards, a numbered action list 01-04 (气象状态 / 应急补饲 / 防寒转移 / 金融协同),
  each ONE line, max 20 characters, no wrapping paragraphs.

ROW 2 (60%) — "26 县应急处置优先级排序"
- A horizontal bar chart, 26 counties, sorted descending.
- Bar LENGTH encodes risk score; bar COLOR encodes the 补饲档位 status
  (全草场放牧 / 轻度补充防寒 / 半草场半补饲 / 全人工重度补饲) — four discrete colors,
  kept strictly separate from the risk ramp.
- Top-left stat strip: 全域需求 211.2 吨干草 / 需启动补饲 12 县 /
  第 8 县累计覆盖 50% / 配套绿色信贷 3364.68 万元.
- A cumulative-coverage marker line overlaid on the bars at the 50% and 80% points.

MISSING PIECE TO ADD (important):
- Each top-ranked county row needs an inline action affordance — a small
  "派单" / "登记处置" text button, and a right-side drawer mockup showing a
  "处置留痕" panel: 时间 / 处置人 / 动作 / 备注, with 2-3 existing entries.
- This is the closed-loop record. The current system has NO write-back at all,
  so this panel is what makes the decision page end in an ACTION rather than a number.
```

---

## 3. 拿到图之后的验收清单

对照 Stitch 输出逐条打勾，任何一条不满足就重出：

- [ ] 页 1 地图有明显的地理语境（省界 / 地形），不是漂在黑底上的多边形
- [ ] 风险色阶是**交通灯式**（青→绿→琥珀→橙→红），不是纯红单色带
- [ ] 页 1 里「0 重特大雪灾」那张卡读起来是**平静**的，不是告警的
- [ ] 每屏卡片数 ≤ 6，且有一张明显是主角、其余明显次要
- [ ] 全页找不到任何"整段小灰字解释"
- [ ] 顶部导航 5 个步骤，标签**都是单行**，没有折行
- [ ] 页 2 第一眼是"数据链 + 分级"，不是"表格"
- [ ] 页 3 哑铃图能一眼看出**哪几个县改判了**
- [ ] 页 4 置信层级是**标签**形式，不是一句长话
- [ ] 页 4 负的 R² 被展示出来了，没被藏掉
- [ ] 页 5 有"处置留痕"面板（这是补闭环的关键）
- [ ] 全图无校名、无教师名、无占位人名

---

## 4. 参考色板（改代码时用，可先按这个落）

```js
// 风险发散色阶：低 → 高（替换现有 VIZ.seq 的纯红单色带）
seq: ["#2c6e6a", "#5f9e6e", "#d4b03c", "#e07a2f", "#d94a3d"],

// 状态色（补饲档位）保持不变，与 seq 严格分离
status: {
  calm: "#6b7a90", light: "#d99a3c", half: "#d9702f", full: "#e34948",
},
```

⚠️ **改 `VIZ.seq` 后必须重跑 `app.js:92` 的 `inkOn()` 对比度逻辑。**

已实测两套色板的最差档（用 `app.js:56-57` 的两个墨色 `#f8fafc` / `#231210`）：

| 色板 | 最差档 | 落在哪一档 |
|---|---|---|
| 旧（纯红单色带） | **4.43:1** | 中间档 `#d9503c` |
| 新（交通灯发散） | **4.29:1** | **红色端** `#d94a3d` |

两点澄清，避免误判：

1. **不是换色板引入的新问题。** 旧色板本来就已经在 WCAG AA（4.5:1）线下了，
   而 `app.js:90-91` 的注释写的是「实测最差的一档仍有 4.2:1，不需要描边兜底」——
   **这行注释的结论本身就偏乐观**（实测 4.43，且低于 AA）。新色板是同一个量级。
2. **新色板的弱点在红色端，不在青色端。** `#5f9e6e` 配深墨是 5.67:1，完全合格。
   红色端 `#d94a3d` 两墨都不到 4.5:1（浅墨 4.02 / 深墨 4.29），要动就动这里：
   要么把红端压深到 `#c0392b` 一带，要么给落在该档上的数字加描边。

`inkOn()` 的**方法**没问题（实测取墨，不猜切点），保留；要改的是它下面那行注释的断言。
