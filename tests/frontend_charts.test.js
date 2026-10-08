const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

function chartHarness(file, store, get) {
  const options = {};
  const MR = {
    store: { registerRenderer() {}, ...store },
    api: { get },
    tokens: { viz: { seq: ['#000', '#555', '#aaa'], neutral: '#999', down: '#0a8' } },
    fmt: { inkOn: () => '#fff', seqColorAt: () => '#555', cjkWidth: s => s.length * 12 },
    theme: { grid: value => value, axisName: (name, value) => ({ name, ...value }), emptyTitle: text => ({ text }) },
    charts: { acquire: name => ({ clear() {}, setOption: option => { options[name] = option; } }) },
  };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../frontend/js/charts', file), 'utf8'), {
    window: { MR }, document: { getElementById: () => ({}) },
  });
  return { MR, options };
}

const settle = () => new Promise(resolve => setImmediate(resolve));

test('matrix distinguishes within-grass seasonal range and within-season grass range', async () => {
  const store = { selectedRegionId: { value: 'county' }, currentAgeGroup: { value: 'all' }, matrixInsight: {} };
  const matrix = [
    { grassland_name: 'A', season_code: 'spring', risk_score: 10 },
    { grassland_name: 'A', season_code: 'winter', risk_score: 40 },
    { grassland_name: 'B', season_code: 'spring', risk_score: 16 },
    { grassland_name: 'B', season_code: 'winter', risk_score: 46 },
  ];
  const { MR, options } = chartHarness('indexCharts.js', store, () => Promise.resolve({ ok: true, data: { matrix } }));
  MR.charts.indexCharts.renderHeatmap();
  await settle();
  assert.match(store.matrixInsight.value.seasonSpread, /^30/);
  assert.match(store.matrixInsight.value.grassSpread, /^6/);
  const chart = options.indexHeatmap;
  assert.match(chart.tooltip.formatter({ data: chart.series[0].data[0] }), /A · 春季/);
});

test('a downgraded snow chart never labels any day as a live forecast', () => {
  const data = [2, 3, 4];
  const { MR, options } = chartHarness('forecastCharts.js', {
    currentDisaster: { value: { is_realtime: false, forecast_series: {
      days_30: ['D+1', 'D+2', 'D+3'], snow_depth_30: data,
      ci_upper_30: [4, 5, 6], ci_lower_30: [0, 1, 2], boundary_index: 2,
    } } },
  });
  MR.charts.forecastCharts.renderSnow30();
  const chart = options.multiDisaster;
  assert.ok(chart.series[2].data.every(v => v === null));
  assert.equal(chart.series[2].markLine, undefined);
  assert.equal(JSON.stringify(chart.series[3].data), JSON.stringify(data));
  assert.doesNotMatch(chart.tooltip.formatter([{ dataIndex: 0 }]), /实时预报/);
});

function nppResponse(value) {
  return { ok: true, data: {
    recent_history: { years: [2025], pred: [0.35], baseline: [0.3] },
    target_year: 2026, npp_forecast: value,
    baselines_comparison: { b1_climatological_mean: 0.3 },
  } };
}

test('NPP chart keeps annual units, historical fits and the future forecast separate', async () => {
  const { MR, options } = chartHarness('forecastCharts.js', {
    selectedRegionId: { value: 'county' }, nppAnnual: { value: { 2024: 0.3, 2025: 0.4 } },
  }, () => Promise.resolve(nppResponse(0.5)));
  MR.charts.forecastCharts.renderNpp();
  await settle();
  const chart = options.nppCompare;
  assert.equal(chart.xAxis.data.at(-1), '2026');
  assert.match(chart.yAxis.name, /\/年/);
  assert.equal(chart.series.find(s => s.name === '历史拟合').data.at(-1), null);
  assert.equal(chart.series.find(s => s.name === '目标年情景预测').data.at(-1), 0.5);
  assert.equal(chart.series.find(s => s.name === '遥感参考值').data.at(-1), null);
});

test('a late NPP response from the previous county cannot replace the current chart', async () => {
  let resolveOld;
  const previous = new Promise(resolve => { resolveOld = resolve; });
  const region = { value: 'old' };
  const { MR, options } = chartHarness('forecastCharts.js', {
    selectedRegionId: region, nppAnnual: { value: { 2025: 0.4 } },
  }, url => url.endsWith('/old') ? previous : Promise.resolve(nppResponse(0.7)));
  MR.charts.forecastCharts.renderNpp();
  region.value = 'new';
  MR.charts.forecastCharts.renderNpp();
  await settle();
  resolveOld(nppResponse(0.1));
  await settle();
  assert.equal(options.nppCompare.series.find(s => s.name === '目标年情景预测').data.at(-1), 0.7);
});
