/**
 * Hash 路由。
 *
 * 格式： #/<tab>?region=<region_id>&ag=<age_group>&drawer=<key>
 * 例：   #/index?region=naqu-seni&ag=calf&drawer=spi
 *
 * 设计要点：
 *   - hashchange 是**唯一真源**。所有导航最终都落到改 hash，再由 onRoute 统一解析。
 *     旧实现有两份逐字重复的分发逻辑（switchTab 与 onRegionChange 各一份），
 *     分裂成两份之后必然漂移；这里只有一份。
 *   - 县域下拉框的变更用 replaceState 写 URL（不污染浏览器历史）；
 *     地图点击、跨页跳转用，hashchange 正常入栈，前进/后退可用。
 *   - 深链可复制：演示时把地址栏给评委即可直达某县某页某抽屉。
 */
(function (MR) {
  "use strict";

  var TABS = ["cockpit", "datasource", "index", "forecast", "decision"];
  var handler = null;
  var started = false;

  function parse(hash) {
    var raw = String(hash || "").replace(/^#\/?/, "");
    var qi = raw.indexOf("?");
    var tabPart = qi >= 0 ? raw.slice(0, qi) : raw;
    var queryPart = qi >= 0 ? raw.slice(qi + 1) : "";
    var tab = TABS.indexOf(tabPart) >= 0 ? tabPart : "";
    var out = { tab: tab, region: "", ag: "", drawer: "" };
    if (queryPart) {
      queryPart.split("&").forEach(function (kv) {
        if (!kv) return;
        var i = kv.indexOf("=");
        var k = i >= 0 ? kv.slice(0, i) : kv;
        var v = i >= 0 ? kv.slice(i + 1) : "";
        try {
          v = decodeURIComponent(v);
        } catch (e) {
          /* 保留原值 */
        }
        if (k === "region" || k === "ag" || k === "drawer") out[k] = v;
      });
    }
    return out;
  }

  function build(state) {
    var s = state || {};
    var tab = TABS.indexOf(s.tab) >= 0 ? s.tab : "cockpit";
    var parts = [];
    if (s.region) parts.push("region=" + encodeURIComponent(s.region));
    if (s.ag && s.ag !== "all") parts.push("ag=" + encodeURIComponent(s.ag));
    if (s.drawer) parts.push("drawer=" + encodeURIComponent(s.drawer));
    return "#/" + tab + (parts.length ? "?" + parts.join("&") : "");
  }

  function currentState() {
    return parse(window.location.hash);
  }

  function fire() {
    if (!handler) return;
    handler(parse(window.location.hash));
  }

  function start(onRoute) {
    handler = onRoute;
    if (!started) {
      started = true;
      window.addEventListener("hashchange", fire);
    }
    fire();
  }

  /**
   * 导航（入栈）。
   * @param {{tab?:string, region?:string, ag?:string, drawer?:string}} patch
   *        只写需要改的键；未提供的键沿用当前 URL 的值。
   */
  function go(patch) {
    var next = Object.assign(currentState(), patch || {});
    if (patch && patch.drawer === null) next.drawer = "";
    var target = build(next);
    if (target === window.location.hash) {
      fire(); // 同址重入也要重新渲染（例如从别的页点同一深链）
      return;
    }
    window.location.hash = target;
  }

  /** 只更新地址栏，不触发导航（用于同步 store 内部变更，如县域下拉框）。 */
  function sync(state) {
    var target = build(Object.assign(currentState(), state || {}));
    if (target === window.location.hash) return;
    try {
      history.replaceState(null, "", target);
    } catch (e) {
      /* file:// 下 replaceState 可能受限，退化为直接改 hash 但不触发处理 */
      window.location.hash = target;
    }
  }

  function openDrawer(key) {
    if (!key) return;
    go({ drawer: key });
  }

  function closeDrawer() {
    var cur = currentState();
    if (!cur.drawer) return;
    go({ drawer: "" });
  }

  MR.router = {
    TABS: TABS,
    parse: parse,
    build: build,
    current: currentState,
    start: start,
    go: go,
    sync: sync,
    openDrawer: openDrawer,
    closeDrawer: closeDrawer,
    /** 供「下一页」页脚深链使用 */
    nextOf: function (tab) {
      var i = TABS.indexOf(tab);
      return i >= 0 && i < TABS.length - 1 ? TABS[i + 1] : "";
    },
  };
})(window.MR);
