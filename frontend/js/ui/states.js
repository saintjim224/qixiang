/**
 * 通用 UI 组件：状态块、KPI 卡、面板外壳、可信度徽章。
 *
 * 核心纪律：<status-block> 是「没有数字」的合法出口。
 * state !== 'ok' 时页面只渲染状态块，绝不渲染任何数值——这是本项目
 * 「禁止伪造」红线在界面层的落点。
 */
(function (MR) {
  "use strict";

  var STATUS_TEXT = {
    loading: { icon: "◌", text: "正在加载…", hint: "" },
    error: { icon: "⚠", text: "数据暂时无法加载", hint: "请检查服务连接后重试" },
    empty: { icon: "○", text: "该县域/该口径暂无数据", hint: "不显示任何替代数值" },
  };

  // --- <status-block> -------------------------------------------------------
  var StatusBlock = {
    name: "status-block",
    props: {
      state: { type: String, default: "loading" },
      message: { type: String, default: "" },
      detail: { type: String, default: "" },
      compact: { type: Boolean, default: false },
    },
    computed: {
      preset: function () {
        return STATUS_TEXT[this.state] || STATUS_TEXT.loading;
      },
      text: function () {
        return this.message || this.preset.text;
      },
      hint: function () {
        return this.detail || this.preset.hint;
      },
    },
    template:
      '<div class="status-block" :class="[\'status-block--\' + state, { \'is-compact\': compact }]">' +
      '  <span class="status-icon" aria-hidden="true">{{ preset.icon }}</span>' +
      '  <div class="status-body">' +
      '    <div class="status-text">{{ text }}</div>' +
      '    <div v-if="hint" class="status-hint">{{ hint }}</div>' +
      "  </div>" +
      "</div>",
  };

  // --- <prov-badge> ---------------------------------------------------------
  var ProvBadge = {
    name: "prov-badge",
    props: {
      code: { type: String, default: "" },
      note: { type: String, default: "" },
    },
    computed: {
      tier: function () {
        return MR.prov.byCode(this.code);
      },
      tip: function () {
        if (!this.tier) return "";
        return this.tier.title + "：" + this.tier.desc + (this.note ? "\n\n来源说明：" + this.note : "");
      },
    },
    template:
      '<span v-if="tier" class="prov-badge" :class="\'prov-badge--\' + tier.tone" :title="tip">' +
      '  <span class="prov-dot"></span>{{ tier.label }}' +
      "</span>",
  };

  // --- <kpi-card> -----------------------------------------------------------
  var KpiCard = {
    name: "kpi-card",
    props: {
      label: { type: String, required: true },
      value: { default: null },
      unit: { type: String, default: "" },
      sub: { type: String, default: "" },
      tone: { type: String, default: "" }, // danger | warn | good | accent
      prov: { type: String, default: "" },
      provNote: { type: String, default: "" },
      state: { type: String, default: "ok" },
      title: { type: String, default: "" },
    },
    computed: {
      missing: function () {
        return this.state !== "ok" || this.value === null || this.value === undefined || this.value === "";
      },
    },
    template:
      '<div class="kpi-card" :class="[{ \'is-muted\': missing }, tone ? \'kpi--\' + tone : \'\']" :title="title">' +
      '  <div class="kpi-head">' +
      '    <span class="kpi-label">{{ label }}</span>' +
      '    <prov-badge v-if="prov" :code="prov" :note="provNote"></prov-badge>' +
      "  </div>" +
      '  <status-block v-if="missing" :state="state === \'ok\' ? \'empty\' : state" compact></status-block>' +
      '  <div v-else class="kpi-value">' +
      "    {{ value }} <span v-if=\"unit\" class=\"kpi-unit\">{{ unit }}</span>" +
      "  </div>" +
      '  <div v-if="sub && !missing" class="kpi-sub">{{ sub }}</div>' +
      "</div>",
  };

  // --- <panel-shell> --------------------------------------------------------
  var PanelShell = {
    name: "panel-shell",
    props: {
      title: { type: String, default: "" },
      question: { type: String, default: "" }, // 「本页回答：……」的一行导语
      tag: { type: String, default: "" },
      state: { type: String, default: "ok" },
      errorMessage: { type: String, default: "" },
    },
    template:
      '<section class="panel">' +
      '  <div class="panel-header">' +
      '    <div class="panel-title-wrap">' +
      '      <h3 v-if="title">{{ title }}</h3>' +
      '      <p v-if="question" class="panel-question">{{ question }}</p>' +
      "    </div>" +
      '    <div class="panel-actions">' +
      '      <span v-if="tag" class="tag">{{ tag }}</span>' +
      "      <slot name=\"actions\"></slot>" +
      "    </div>" +
      "  </div>" +
      '  <status-block v-if="state === \'error\' || state === \'loading\'" :state="state" :message="errorMessage"></status-block>' +
      "  <slot></slot>" +
      "</section>",
  };

  MR.ui = MR.ui || {};
  MR.ui.components = {
    StatusBlock: StatusBlock,
    ProvBadge: ProvBadge,
    KpiCard: KpiCard,
    PanelShell: PanelShell,
  };

  MR.ui.register = function (app) {
    Object.keys(MR.ui.components).forEach(function (k) {
      app.component(MR.ui.components[k].name, MR.ui.components[k]);
    });
  };
})(window.MR);
