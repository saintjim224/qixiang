/**
 * 五级数据可信度徽章体系。
 *
 * 把"零伪造"从一条隐性纪律变成页面上可见的体系：每张 KPI 卡与图表标题都可以挂一个
 * <prov-badge>，读者不必相信我们的话，可以直接看这个数字属于哪一级事实。
 *
 * 分级与后端 /api/datasource/provenance 的 tiers 一一对应：
 *   A 公开数据产品     ECMWF ERA5 / NASA MODIS / TPDC CMFD / Open-Meteo 预报
 *   B 已标注来源记录   县域、时间和气象关联仍需核验
 *   C 未标注背景样本   1373 条 —— **严禁**被称为负样本或"无灾害"
 *   D 科学模型派生     国标分级 / SPI / GDI / 载畜量精算
 *   E 下游应用模拟     饲草调配吨数 / 资产敞口 / 信贷额度建议
 *   S 脱敏样例         演示用样例记录（非真实业务数据）
 */
(function (MR) {
  "use strict";

  var TIERS = {
    A: {
      code: "A",
      label: "公开数据",
      title: "公开数据产品",
      tone: "obs",
      desc: "来自公开数据集或预报接口，包括再分析、遥感产品和天气预报；具体类型与时效见来源说明。",
    },
    B: {
      code: "B",
      label: "凭证",
      title: "带来源的已标注事件",
      tone: "verified",
      desc: "附来源链接的事件标签。县域归属、金额单位和气象关联仍需逐条核验。",
    },
    C: {
      code: "C",
      label: "未标注",
      title: "未标注背景样本",
      tone: "unlabeled",
      desc: "无报道记录的月份。它是「未标注」，不是「无灾害」，绝不可当作负样本。",
    },
    D: {
      code: "D",
      label: "模型派生",
      title: "模型派生指标",
      tone: "derived",
      desc: "依据公开数据产品、模型与参考阈值推导的指标；适用条件与验证边界见口径说明。",
    },
    E: {
      code: "E",
      label: "模拟测算",
      title: "产业下游应用模拟",
      tone: "sim",
      desc: "在下游业务场景中按假设参数测算的建议值，不是观测事实。",
    },
    S: {
      code: "S",
      label: "样例",
      title: "脱敏样例数据",
      tone: "sim",
      desc: "用于演示业务闭环的样例记录，非真实业务流水。",
    },
  };

  /**
   * 由后端字段推断可信度等级。
   * @param {string} dataSource  后端 data_source 字段
   * @param {string} tier        后端 confidence_tier 字段
   */
  function resolve(dataSource, tier) {
    var ds = String(dataSource || "").toLowerCase();
    var t = String(tier || "").toLowerCase();

    if (ds === "sample" || ds === "demo") return TIERS.S;
    if (t === "realtime_forecast" || ds === "open-meteo" || ds === "open_meteo") return TIERS.A;
    if (t === "climatological_projection" || ds === "climatological") return TIERS.D;
    if (ds === "runtime_operator_input" || ds === "runtime_simulation") return TIERS.E;
    if (ds === "verified_events") return TIERS.B;
    return TIERS.D;
  }

  MR.prov = {
    TIERS: TIERS,
    resolve: resolve,
    byCode: function (code) {
      return TIERS[String(code || "").toUpperCase()] || null;
    },
    /** 供 <prov-badge> 直接取用的 props 组合 */
    fromResponse: function (resp) {
      var r = resp || {};
      var tier = resolve(r.data_source, r.confidence_tier);
      return { code: tier.code, note: r.provenance_note || "" };
    },
  };
})(window.MR);
