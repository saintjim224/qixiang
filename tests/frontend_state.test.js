const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

function deferred() {
  let resolve;
  const promise = new Promise(r => { resolve = r; });
  return { promise, resolve };
}

function createStore(get) {
  const Vue = {
    ref: value => ({ value }),
    reactive: value => value,
    computed: getter => ({ get value() { return getter(); } }),
    nextTick: callback => Promise.resolve().then(callback),
  };
  // fmt 必须给出真实现（store.js 的派生量会用它折算与格式化），
  // 否则测试会因为空对象而报 TypeError，掩盖真正要验证的算法。
  const fmt = {
    round: (n, d) => { const f = Math.pow(10, d); return Math.round(n * f) / f; },
    num: (v, d) => {
      if (v === null || v === undefined || !Number.isFinite(Number(v))) return '—';
      return d === undefined ? String(v) : Number(v).toFixed(d);
    },
  };
  const MR = { api: { get }, fmt: fmt, router: { sync() {} }, bus: { emit() {} } };
  const context = { Vue, window: { Vue, MR }, console };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../frontend/js/state/store.js'), 'utf8'), context);
  return MR.store;
}

test('concurrent method chart loads share a request instead of cancelling each other', async () => {
  const request = deferred();
  let calls = 0;
  const store = createStore(() => { calls++; return request.promise; });
  const first = store.loadMethodCompare(false);
  const second = store.loadMethodCompare(false);
  assert.equal(calls, 1);
  request.resolve({ ok: true, data: { counties: [], spi_summary: { level_changed: 1 }, gdi_summary: {} } });
  await Promise.all([first, second]);
  assert.equal(store.meta.methodCompare, 'ok');
  assert.equal(store.spiSummary.value.level_changed, 1);
  await store.loadMethodCompare(false);
  assert.equal(calls, 1);
});

test('a ready NPP report never hides PU failure, and retry reloads only the failed report', async () => {
  const firstPu = deferred();
  const requests = [];
  let puAttempts = 0;
  const puReport = { benchmark_results: {}, evaluation: { name: 'temporal' } };
  const store = createStore((url, options) => {
    requests.push({ url, timeout: options.timeout });
    if (url.includes('/index/')) {
      puAttempts++;
      return puAttempts === 1 ? firstPu.promise : Promise.resolve({ ok: true, data: puReport });
    }
    return Promise.resolve({ ok: true, data: { loyo_protocol: {}, loro_protocol: {} } });
  });
  const first = store.loadBenchmarks();
  const concurrent = store.loadBenchmarks();
  await Promise.resolve();
  assert.equal(requests.length, 2);
  assert.equal(store.meta.nppBenchmark, 'ok');
  assert.equal(store.meta.puBenchmark, 'loading');
  firstPu.resolve({ ok: false, error: 'timeout' });
  await Promise.all([first, concurrent]);
  assert.equal(store.meta.puBenchmark, 'error');
  assert.equal(store.meta.nppBenchmark, 'ok');
  assert.equal(store.meta.benchmarks, 'error');
  assert.equal(store.puBenchmark.value, null);
  await store.loadBenchmarks();
  assert.equal(requests.length, 3);
  assert.equal(store.meta.puBenchmark, 'ok');
  assert.equal(store.puBenchmark.value, puReport);
  assert.ok(requests.every(r => r.timeout === 60000));
});

test('an incomplete successful HTTP response stays unavailable', async () => {
  const store = createStore(() => Promise.resolve({ ok: true, data: {} }));
  await store.loadBenchmarks();
  assert.equal(store.meta.puBenchmark, 'error');
  assert.equal(store.meta.nppBenchmark, 'error');
  assert.equal(store.puBenchmark.value, null);
  assert.equal(store.nppBenchmark.value, null);
});

test('county selection clears old values and loads the selected county', async () => {
  const pending = deferred();
  const urls = [];
  const store = createStore(url => { urls.push(url); return pending.promise; });
  store.currentPuRisk.value = { region_id: 'naqu-seni' };
  store.nppAnnual.value = { 2025: 0.1 };
  const change = store.onRegionChange('linzhi-bayi');
  assert.equal(store.selectedRegionId.value, 'linzhi-bayi');
  assert.equal(store.currentPuRisk.value, null);
  assert.equal(Object.keys(store.nppAnnual.value).length, 0);
  assert.equal(store.meta.pu, 'loading');
  assert.equal(urls.length, 6);
  assert.ok(urls.every(url => url.includes('linzhi-bayi')));
  pending.resolve({ ok: true, data: { region_id: 'linzhi-bayi', npp_annual: { 2025: 0.2 } } });
  await change;
  assert.equal(store.currentPuRisk.value.region_id, 'linzhi-bayi');
  assert.equal(store.nppAnnual.value[2025], 0.2);
});

test('late county series and indices cannot overwrite a newer selection', async () => {
  const old = deferred();
  const store = createStore(url => url.includes('old-county') ? old.promise : Promise.resolve({
    ok: true, data: { region_id: 'new-county', npp_annual: { 2025: 0.8 } },
  }));
  const first = store.onRegionChange('old-county');
  await store.onRegionChange('new-county');
  old.resolve({ ok: true, data: { region_id: 'old-county', npp_annual: { 2025: 0.1 } } });
  await first;
  assert.equal(store.currentPuRisk.value.region_id, 'new-county');
  assert.equal(store.nppAnnual.value[2025], 0.8);
});

// --- 新增派生量的口径测试 -------------------------------------------------
// 这些数字全部取自 tools/out/aic_value_metrics.json（2026-10-08 实跑），
// 用来锁死前端折算口径与后端一致；改了常数、改了公式，这里必须先红。

function rankingPayload(overrides) {
  const counties = [];
  for (let i = 0; i < 26; i++) {
    counties.push({
      region_id: 'r' + i,
      hay_tons: i < 8 ? 30 : 5.2,
      credit_quota_wan: i === 0 ? 127.5 : (i === 25 ? 137.18 : 130 + i * 0.1),
    });
  }
  const row = {
    herd_size_yak: 1000,
    forecast_days: 14,
    counties: counties,
    totals: {
      county_count: 26,
      hay_tons: 358.4,
      grain_tons: 71.3,
      feed_cost_wan: 56.16,
      loss_exposure_wan: 225.25,
      credit_quota_wan: 3399.26,
    },
    coverage: { p50: 5, p80: 11, p90: 13 },
  };
  return Object.assign(row, overrides || {});
}

test('投放效益测算沿用后端口径：满额兜底 1528.8 吨、减少 1170.4 吨、折 99.5 万元', () => {
  const store = createStore(() => Promise.resolve({ ok: true, data: {} }));
  store.priorityRanking.value = rankingPayload();
  const s = store.prioritySummary.value;
  assert.equal(s.herdSize, 1000);
  assert.equal(s.feedDays, 14);
  // 4.0 kg 干草 × 1.05 牛群均值系数 × 1000 头 × 14 天 × 26 县 / 1000
  assert.equal(s.fullRationTons, 1528.8);
  assert.equal(s.savingsTons, 1170.4);
  assert.equal(s.savingsWan, 99.5);
  assert.equal(s.hayPriceYuanPerKg, 0.85);
  assert.equal(s.creditRange, '127.5–137.18');
});

test('分级口径不低于满额兜底时不给出“减少量”，避免负数被读成节省', () => {
  const store = createStore(() => Promise.resolve({ ok: true, data: {} }));
  store.priorityRanking.value = rankingPayload({
    totals: { county_count: 26, hay_tons: 2200.0, credit_quota_wan: 3399.26 },
  });
  const s = store.prioritySummary.value;
  assert.equal(s.fullRationTons, 1528.8);
  assert.equal(s.savingsTons, null);
  assert.equal(s.savingsWan, null);
  assert.equal(s.creditRange, '127.5–137.18');
});

test('接口缺参数或县域全无量时，折算量一律留空而不是回落为 0', () => {
  const store = createStore(() => Promise.resolve({ ok: true, data: {} }));
  store.priorityRanking.value = rankingPayload({ herd_size_yak: null, forecast_days: null });
  const s = store.prioritySummary.value;
  assert.equal(s.fullRationTons, null);
  assert.equal(s.savingsTons, null);
  assert.equal(s.savingsWan, null);

  store.priorityRanking.value = rankingPayload({ counties: [] });
  const empty = store.prioritySummary.value;
  assert.equal(empty.fullRationTons, null, '未纳入任何县域时满额口径无从谈起');
  assert.equal(empty.creditRange, null, '无县域时不拼出额度区间');

  store.priorityRanking.value = rankingPayload({
    counties: [{ region_id: 'r0', hay_tons: 0, credit_quota_wan: null }],
  });
  const oneMissing = store.prioritySummary.value;
  // 满额口径按纳入的县域逐县计，因此单县也有值（58.8 = 4.2×1000×14/1000）
  assert.equal(oneMissing.fullRationTons, 58.8);
  assert.equal(oneMissing.creditRange, null, '逐县额度全缺测时不拼出区间');
});

test('雪灾首触阈值的日序取自 16 天序列，且只在序列真实存在时给出', () => {
  const store = createStore(() => Promise.resolve({ ok: true, data: {} }));
  store.currentDisaster.value = {
    is_realtime: false,
    forecast_series: { snow_16: [0, 1.2, 3.0, 4.9, 5.0, 6.1] },
  };
  const lead = store.currentLeadTime.value;
  assert.equal(lead.days, 5, '第 5 个元素首次达到 5 cm，日序应为 5');
  assert.equal(lead.thresholdCm, 5.0);
  assert.equal(lead.windowDays, 6);
  assert.equal(lead.realtime, false);

  store.currentDisaster.value = { is_realtime: true, forecast_series: { snow_16: [0, 4.9, 4.9] } };
  assert.equal(store.currentLeadTime.value, null, '全程未达阈值时不给日序');

  store.currentDisaster.value = { is_realtime: true, forecast_series: { snow_16: [] } };
  assert.equal(store.currentLeadTime.value, null, '空序列不给日序');

  store.currentDisaster.value = null;
  assert.equal(store.currentLeadTime.value, null, '数据未到达时不给日序，更不给 0');
});

test('覆盖范围与分析单元全部由在手数据派生，不写死规模数字', () => {
  const store = createStore(() => Promise.resolve({ ok: true, data: {} }));
  assert.equal(store.coverageScope.value.microGrids, null, '县域数未知时不臆造微切片总数');
  assert.equal(store.coverageScope.value.provinceCount, null);

  store.regions.value = [
    { region_id: 'a', province: '西藏自治区', pasture_type: '高寒草甸' },
    { region_id: 'b', province: '西藏自治区', pasture_type: '高寒草原' },
    { region_id: 'c', province: '青海省', pasture_type: '高寒草甸' },
  ];
  store.macroStats.value.totalCounties = 26;
  store.dataTiers.value = [{ tier_name: '公开数据产品 (Public Data Products)', data_sources: [{ name: 'X', range: '2020-2025' }] }];
  const scope = store.coverageScope.value;
  assert.equal(scope.counties, 26);
  assert.equal(scope.provinceCount, 2);
  assert.equal(scope.pastureCount, 2);
  // vm 沙箱里造出来的数组原型与 Node 的不同，strict deepEqual 会因原型不等而失败；
  // 这里比字符串序列，测的是取值顺序而不是原型链。
  assert.equal(scope.pastureTypes.join(' / '), '高寒草甸 / 高寒草原');
  assert.equal(scope.microGrids, 26 * 4 * 4 * 5);
  assert.equal(scope.productCount, 1);
});
