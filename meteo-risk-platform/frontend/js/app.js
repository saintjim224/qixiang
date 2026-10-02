/**
 * 融天气象 - 高原多源时空融合气象灾害预警平台
 * 应用装配与挂载。
 *
 * 这里是唯一的 createApp 调用点；状态在 state/store.js，图表在 charts/*.js，
 * 通用组件在 ui/*.js。本文件只做三件事：注册组件、把 store 暴露给模板、挂载。
 */
(function () {
  "use strict";

  var S = window.MR.store;

  var app = Vue.createApp({
    setup: function () {
      return {
        // --- 导航与路由 ---
        navTabs: S.navTabs,
        currentTab: S.currentTab,
        switchTab: S.switchTab,
        navigateTo: S.navigateTo,
        nextTab: function () {
          var next = window.MR.router.nextOf(S.currentTab.value);
          if (!next) return "";
          var t = S.navTabs.filter(function (x) { return x.id === next; })[0];
          return t ? t.label : "";
        },
        nextTabId: function () {
          return window.MR.router.nextOf(S.currentTab.value);
        },
        drawerKey: S.drawerKey,

        // --- 县域 ---
        regions: S.regions,
        selectedRegionId: S.selectedRegionId,
        onRegionChange: S.onRegionChange,
        currentRegionName: S.currentRegionName,
        currentAgeGroup: S.currentAgeGroup,
        ageGroups: S.ageGroups,
        switchAgeGroup: S.switchAgeGroup,

        // --- 状态机 ---
        meta: S.meta,
        errors: S.errors,

        // --- 驾驶舱 ---
        macroStats: S.macroStats,
        snowDataDegraded: S.snowDataDegraded,
        riskLevelCounts: S.riskLevelCounts,
        currentMetrics: S.currentMetrics,
        currentDisaster: S.currentDisaster,
        snowLevelBadgeClass: S.snowLevelBadgeClass,
        snowDepthClass: S.snowDepthClass,
        uncertaintyInfo: S.uncertaintyInfo,

        // --- 指数 ---
        currentSpi: S.currentSpi,
        currentGdi: S.currentGdi,
        currentPuRisk: S.currentPuRisk,
        currentDecision: S.currentDecision,
        spiSummary: S.spiSummary,
        gdiSummary: S.gdiSummary,
        matrixInsight: S.matrixInsight,
        puBenchmark: S.puBenchmark,
        nppBenchmark: S.nppBenchmark,
        puRows: S.puRows,
        puRow: S.puRow,
        protocolList: S.protocolList,
        puVerdict: S.puVerdict,
        spiChips: S.spiChips,
        gdiChips: S.gdiChips,
        nppChips: S.nppChips,
        priorityChips: S.priorityChips,
        disasterChips: S.disasterChips,
        signedPct: S.signedPct,
        orDash: S.orDash,

        // --- 底座 ---
        dataTiers: S.dataTiers,
        provenance: S.provenance,
        verifiedEvents: S.verifiedEvents,
        verifiedStats: S.verifiedStats,
        verifiedSelectedCategory: S.verifiedSelectedCategory,
        verifiedCategories: S.verifiedCategories,
        filterVerifiedEvents: S.filterVerifiedEvents,
        categoryTagClass: S.categoryTagClass,

        // --- 决策 ---
        priorityRanking: S.priorityRanking,
        prioritySummary: S.prioritySummary,
        verifyKpi: S.verifyKpi,
        feedDemand: S.feedDemand,
        dispatchReady: S.dispatchReady,
        dispatchLogs: S.dispatchLogs,
        dispatchStats: S.dispatchStats,
        dispatchSubmitting: S.dispatchSubmitting,
        dispatchToast: S.dispatchToast,
        dispatchToastTone: S.dispatchToastTone,
        dispatchForm: S.dispatchForm,
        submitDispatch: S.submitDispatch,

        // --- 格式化 ---
        f: window.MR.fmt,
        num: window.MR.fmt.num,
      };
    },
  });

  // 注册全局组件（<status-block> / <kpi-card> / <panel-shell> / <prov-badge> / <method-chips> / <method-drawer>）
  window.MR.ui.register(app);
  window.MR.ui.registerMethodComponents(app);

  app.mount("#app");

  // 先接路由（决定首屏在哪一页），再把数据灌进来
  window.MR.router.start(window.MR.store.applyRoute);
  window.MR.store.init();
})();
