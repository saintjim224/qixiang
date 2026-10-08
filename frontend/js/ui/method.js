/**
 * 方法论披露组件：<method-chips> + <method-drawer>。
 *
 * 原实现把大段口径说明以 10px 小灰字直接铺在页面上，构成"小灰字墙"：既有阅读负担，
 * 又因为字太小而实际上没人会读。现在改为「≤5 条关键胶囊 + 展开口径」：
 * 胶囊给出可扫读的关键事实，完整披露文字一个字都不删，只是折叠进右侧抽屉。
 *
 * 抽屉内容用**具名插槽**写在 index.html 里（而不是搬进 JS 字符串），
 * 这样与页面同作用域，{{ }} 绑定依然是活的。
 */
(function (MR) {
  "use strict";

  // --- <method-chips> -------------------------------------------------------
  var MethodChips = {
    name: "method-chips",
    props: {
      chips: { type: Array, default: function () { return []; } },
      drawer: { type: String, default: "" },
      moreLabel: { type: String, default: "展开口径与来源说明" },
    },
    methods: {
      open: function () {
        if (this.drawer) MR.router.openDrawer(this.drawer);
      },
    },
    template:
      '<div class="method-chips">' +
      '  <span v-for="c in chips" :key="c.k" class="mchip">' +
      '    <span class="mchip-k">{{ c.k }}</span>' +
      '    <span class="mchip-v">{{ c.v }}</span>' +
      "  </span>" +
      '  <button v-if="drawer" class="mchip-more" @click="open">{{ moreLabel }} →</button>' +
      "</div>",
  };

  // --- <method-drawer> ------------------------------------------------------
  var MethodDrawer = {
    name: "method-drawer",
    props: {
      activeKey: { type: String, default: "" },
    },
    computed: {
      open: function () {
        return !!this.activeKey;
      },
    },
    methods: {
      close: function () {
        MR.router.closeDrawer();
      },
    },
    template:
      '<div v-if="open" class="method-drawer" @click.self="close">' +
      '  <aside class="drawer-panel" role="dialog" aria-modal="true">' +
      '    <header class="drawer-head">' +
      '      <h4>方法论、口径与来源披露</h4>' +
      '      <button class="drawer-close" @click="close" aria-label="关闭">✕</button>' +
      "    </header>" +
      '    <div class="drawer-body"><slot :name="activeKey"></slot></div>' +
      "  </aside>" +
      "</div>",
  };

  MR.ui = MR.ui || {};
  MR.ui.MethodChips = MethodChips;
  MR.ui.MethodDrawer = MethodDrawer;
  MR.ui.registerMethodComponents = function (app) {
    app.component(MethodChips.name, MethodChips);
    app.component(MethodDrawer.name, MethodDrawer);
  };
})(window.MR);
