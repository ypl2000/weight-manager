// 迭代4 QA:/api/reminders 规则验证(纯 API,不依赖 UI)
// 规则:weight 当天没录→due / 已录→"今天已记录";waist 距上次≥7天→due / <7天→"N 天前测过";停用指标不出现
// 测试数据 77.77/77.7 全部测后清理;真实腰围 96 记录短暂软删后按原数据恢复(值与测量时间不变)
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { apiSync, sleep } from './cdp.mjs';

const B = 'http://127.0.0.1:8000';
const DEV = 'qa-iter4';
const now = () => new Date().toISOString();
const get = async (p) => (await fetch(B + p)).json();
const reminders = async () => (await get('/api/reminders'));
const itemOf = (r, code) => (r.items || []).find((i) => i.code === code) || null;

const seq = [];
function step(name, expect, got) {
  const ok = JSON.stringify(expect) === JSON.stringify(got);
  seq.push({ step: name, pass: ok, expect, got });
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}`);
  if (!ok) console.log('  expect:', JSON.stringify(expect), '\n  got   :', JSON.stringify(got));
  return ok;
}
// 只断言关键字段,reason 之外不比
const brief = (r, code) => {
  const it = itemOf(r, code);
  return it ? { due: it.due, reason: it.reason, rule: it.rule } : null;
};
const codes = (r) => (r.items || []).map((i) => i.code);

// ---- 前置快照 ----
const allRecords = await get('/api/tables/records');
const realWaist = allRecords.find((d) => !d.deleted && d.data.metric_code === 'waist');
if (!realWaist) throw new Error('baseline waist record not found');
const metricsDocs = await get('/api/tables/metrics');
const waistMetric = metricsDocs.find((d) => d.data.code === 'waist');
if (!waistMetric) throw new Error('waist metric not found');

const baseline = await reminders();
const baselineBrief = { weight: brief(baseline, 'weight'), waist: brief(baseline, 'waist'), codes: codes(baseline) };
console.log('baseline:', JSON.stringify(baselineBrief, null, 1));
step('S0 基线:体重今日未录→due / 腰围1天前→not due',
  { weight: { due: true, reason: '今天还没有记录', rule: '每天 1 次' },
    waist: { due: false, reason: '1 天前测过（10-25）', rule: '每周 1 次' }, codes: ['weight', 'waist'] },
  baselineBrief);

let allOk = true;
const push = async (table, id, data, deleted = false, updated = now()) => {
  const r = await apiSync({ device: DEV, cursor: 0, changes: [{ table, id, data, updated_at: updated, deleted }] });
  if (!r || typeof r.applied !== 'number') throw new Error('sync failed: ' + JSON.stringify(r).slice(0, 200));
  return r;
};

try {
  // S1 体重今日已录 → due=false
  await push('records', 'qa-iter4-weight', { metric_code: 'weight', value: 77.77, at: now(), note: 'qa' });
  await sleep(150);
  let r = await reminders();
  allOk &= step('S1 体重今天已录(77.77) → due=false "今天已记录"',
    { due: false, reason: '今天已记录', rule: '每天 1 次' }, brief(r, 'weight'));

  // S2 腰围加一条 10 天前的测试记录:真实 96(昨天)仍在 → latest 取最近一条 → 仍 not due
  await push('records', 'qa-iter4-waist-old', { metric_code: 'waist', value: 77.7, at: '2026-10-16T01:00:00.000Z', note: 'qa' });
  await sleep(150);
  r = await reminders();
  allOk &= step('S2 加10天前腰围测试记录,最近一条仍是昨天96 → not due "1 天前测过"',
    { due: false, reason: '1 天前测过（10-25）', rule: '每周 1 次' }, brief(r, 'waist'));

  // S3 软删真实腰围 96 → latest 变为 10 天前测试记录 → ≥7天 → due
  await push('records', realWaist.id, {}, true);
  await sleep(150);
  r = await reminders();
  allOk &= step('S3 软删真实腰围后,最近一条=10天前 → due=true "距上次测量已 10 天"',
    { due: true, reason: '距上次测量已 10 天', rule: '每周 1 次' }, brief(r, 'waist'));

  // S4 再删测试腰围 → 无任何腰围记录 → due "还没有记录过"
  await push('records', 'qa-iter4-waist-old', {}, true);
  await sleep(150);
  r = await reminders();
  allOk &= step('S4 腰围无任何记录 → due=true "还没有记录过"',
    { due: true, reason: '还没有记录过', rule: '每周 1 次' }, brief(r, 'waist'));

  // S5 恢复真实腰围(原 data + 新 updated_at) → 回到 "1 天前测过（10-25）"
  await push('records', realWaist.id, realWaist.data, false);
  await sleep(150);
  r = await reminders();
  allOk &= step('S5 恢复真实腰围96 → due=false "1 天前测过（10-25）"',
    { due: false, reason: '1 天前测过（10-25）', rule: '每周 1 次' }, brief(r, 'waist'));

  // S6 删除测试体重 → weight 回 due
  await push('records', 'qa-iter4-weight', {}, true);
  await sleep(150);
  r = await reminders();
  allOk &= step('S6 删除测试体重77.77 → due=true "今天还没有记录"',
    { due: true, reason: '今天还没有记录', rule: '每天 1 次' }, brief(r, 'weight'));

  // S7 停用腰围指标 → items 不含 waist;weight 不受影响
  await push('metrics', waistMetric.id, { ...waistMetric.data, active: false });
  await sleep(150);
  r = await reminders();
  allOk &= step('S7 腰围指标停用 → items 只有 weight',
    ['weight'], codes(r));
  allOk &= step('S7b 停用期间 weight 规则不受影响',
    { due: true, reason: '今天还没有记录', rule: '每天 1 次' }, brief(r, 'weight'));

  // S8 恢复腰围指标 → 两项齐全
  await push('metrics', waistMetric.id, waistMetric.data);
  await sleep(150);
  r = await reminders();
  allOk &= step('S8 恢复腰围指标 → items 回到 [weight, waist]',
    ['weight', 'waist'], codes(r));
} finally {
  // 兜底清理(幂等):任何异常也要把真实数据恢复原状
  await push('records', 'qa-iter4-weight', {}, true).catch(() => {});
  await push('records', 'qa-iter4-waist-old', {}, true).catch(() => {});
  await push('records', realWaist.id, realWaist.data, false).catch(() => {});
  await push('metrics', waistMetric.id, waistMetric.data).catch(() => {});
}

// ---- 终态核对 ----
await sleep(200);
const finR = await reminders();
const finRecords = (await get('/api/tables/records')).filter((d) => !d.deleted);
const finMetrics = (await get('/api/tables/metrics')).find((d) => d.data.code === 'waist');
const fin = {
  reminders: { weight: brief(finR, 'weight'), waist: brief(finR, 'waist'), codes: codes(finR) },
  recordsVisible: finRecords.length,
  recordsValues: finRecords.map((d) => `${d.data.metric_code}:${d.data.value}`).sort(),
  waistMetricActive: finMetrics.data.active,
  waistDataEqualsOriginal: JSON.stringify(finMetrics.data) === JSON.stringify(waistMetric.data),
  realWaistRestored: JSON.stringify(finRecords.find((d) => d.id === realWaist.id)?.data) === JSON.stringify(realWaist.data),
  qaResidue: finRecords.filter((d) => String(d.id).startsWith('qa-')).length,
};
console.log('final:', JSON.stringify(fin, null, 1));

const report = {
  captured_at: now(),
  endpoint: 'GET /api/reminders',
  baseline: baselineBrief,
  sequence: seq,
  final_state: fin,
  all_pass: allOk && fin.recordsVisible === 8 && fin.qaResidue === 0 && fin.waistMetricActive === true,
};
writeFileSync(fileURLToPath(new URL('../reports/iter4-reminders-api.json', import.meta.url)), JSON.stringify(report, null, 2));
console.log('ALL_PASS=' + report.all_pass);
process.exit(0);
