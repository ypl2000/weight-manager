// 迭代3-1:GET /api/insights 规则造数验证
// 场景:真实数据基线 → 快降(rate_alert) → 平台+腰围平(true_plateau) → 腰围降(maybe_water) → 清理复原
// 造数一律 qa-rd-* id,测后全部 DELETE,记录数回到 8。
const B = 'http://127.0.0.1:8000';
const DAY = 86400_000;

async function insights() {
  const r = await fetch(B + '/api/insights');
  return { status: r.status, body: await r.json() };
}
async function records() {
  return (await (await fetch(B + '/api/tables/records')).json()).filter((d) => !d.deleted);
}
async function push(id, metric_code, value, unit, agoMs) {
  const at = new Date(Date.now() - agoMs).toISOString();
  const doc = {
    table: 'records', id,
    data: { metric_code, value, unit, at, source: 'manual', note: 'qa-iter3' },
    updated_at: new Date().toISOString(), deleted: false,
  };
  const r = await fetch(B + '/api/sync', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ device: 'qa-iter3', cursor: 1_000_000_000, changes: [doc] }),
  });
  return r.status;
}
async function del(id) {
  const r = await fetch(`${B}/api/tables/records/${id}`, { method: 'DELETE' });
  return r.status;
}
const fmt = (x) => JSON.stringify(x);

const made = []; // 造出来的 doc id,确保清理
const out = {};

// ---- 0) 真实数据基线:protein 应有值(88.5kg、s1 → 124g),rate_alert/plateau 应无 ----
const base = await insights();
out.baseline = {
  status: base.status,
  rate_alert: base.body.rate_alert,
  plateau: base.body.plateau,
  protein: base.body.protein,
};
out.baselineChecks = {
  rateAlertNull: base.body.rate_alert === null,
  plateauNull: base.body.plateau === null,
  proteinTarget124: base.body.protein?.target_g === 124,
  proteinWeight88_5: base.body.protein?.weight_kg === 88.5,
  proteinStageS1: base.body.protein?.stage_id === 's1',
  proteinRangeNormal: JSON.stringify(base.body.protein?.range) === '[1.2,1.6]',
  proteinFoodHint: (base.body.protein?.food_hint || '').includes('564'), // 124/22*100≈563.6→564
  proteinNoteKB: (base.body.protein?.note || '').includes('知识库'),
};

// ---- 1) 快降数据:12天内 92→85(叠加真实种子数据后合成斜率仍应远超上限) ----
const fast = [
  ['qa-rd-f0', 92.0, 12.0], ['qa-rd-f1', 90.0, 9.0], ['qa-rd-f2', 88.0, 6.0],
  ['qa-rd-f3', 86.5, 3.0], ['qa-rd-f4', 85.0, 1.0],
];
for (const [id, v, d] of fast) { await push(id, 'weight', v, 'kg', d * DAY); made.push(id); }
const ra = await insights();
out.rateAlert = {
  triggered: !!ra.body.rate_alert,
  detail: ra.body.rate_alert && {
    weekly_loss_kg: ra.body.rate_alert.weekly_loss_kg,
    window_days: ra.body.rate_alert.window_days,
    message_head: ra.body.rate_alert.message.slice(0, 60),
    message_has_kb: ra.body.rate_alert.message.includes('依据知识库'),
    message_has_advice: ra.body.rate_alert.message.includes('蛋白质') && ra.body.rate_alert.message.includes('力量训练'),
  },
  plateauStillNull: ra.body.plateau === null,
  proteinUnchanged: ra.body.protein?.target_g, // 最新体重仍 88.5(造数最新 85 在1天前,种子88.5在1.66天前? 需实测)
};
out.rateAlertChecks = {
  triggered: !!ra.body.rate_alert,
  weeklyLossAbove1: (ra.body.rate_alert?.weekly_loss_kg ?? 0) > 1,
  citesKB: !!(ra.body.rate_alert?.message || '').includes('依据知识库'),
};

// ---- 清理快降 ----
for (const id of fast.map((f) => f[0])) await del(id);

// ---- 2) 平台数据:20天 88.0±0.1 + 腰围走平 → true_plateau ----
const flatW = [
  ['qa-rd-p0', 88.0, 19.5], ['qa-rd-p1', 88.05, 17], ['qa-rd-p2', 88.0, 14.5],
  ['qa-rd-p3', 88.1, 12], ['qa-rd-p4', 88.0, 9.5], ['qa-rd-p5', 88.05, 7],
  ['qa-rd-p6', 88.1, 4.5], ['qa-rd-p7', 88.0, 2],
];
const flatWaist = [
  ['qa-rd-aw0', 96.0, 18], ['qa-rd-aw1', 96.1, 12], ['qa-rd-aw2', 96.0, 6], ['qa-rd-aw3', 96.05, 1],
];
for (const [id, v, d] of flatW) { await push(id, 'weight', v, 'kg', d * DAY); made.push(id); }
for (const [id, v, d] of flatWaist) { await push(id, 'waist', v, 'cm', d * DAY); made.push(id); }
const tp = await insights();
out.truePlateau = {
  type: tp.body.plateau?.type,
  detail: tp.body.plateau && {
    weight_slope_per_week: tp.body.plateau.weight_slope_per_week,
    waist_slope_per_week: tp.body.plateau.waist_slope_per_week,
    message_has_kb: tp.body.plateau.message.includes('依据知识库'),
    message_flat_waist: tp.body.plateau.message.includes('腰围也走平'),
  },
  rateAlertStillNull: tp.body.rate_alert === null,
};
out.truePlateauChecks = {
  typeTruePlateau: tp.body.plateau?.type === 'true_plateau',
  waistFlatSlope: Math.abs(tp.body.plateau?.waist_slope_per_week ?? 9) <= 0.2,
  weightFlatSlope: Math.abs(tp.body.plateau?.weight_slope_per_week ?? 9) <= 0.15,
  citesKB: !!(tp.body.plateau?.message || '').includes('依据知识库'),
};

// ---- 3) 腰围换成下降曲线 → maybe_water(体重数据不变) ----
for (const id of flatWaist.map((w) => w[0])) await del(id);
const fallWaist = [
  ['qa-rd-dw0', 96.5, 18], ['qa-rd-dw1', 95.0, 12], ['qa-rd-dw2', 93.5, 6], ['qa-rd-dw3', 92.0, 1],
];
for (const [id, v, d] of fallWaist) { await push(id, 'waist', v, 'cm', d * DAY); made.push(id); }
const mw = await insights();
out.maybeWater = {
  type: mw.body.plateau?.type,
  detail: mw.body.plateau && {
    weight_slope_per_week: mw.body.plateau.weight_slope_per_week,
    waist_slope_per_week: mw.body.plateau.waist_slope_per_week,
    message_has_kb: mw.body.plateau.message.includes('依据知识库'),
    message_water: mw.body.plateau.message.includes('水分'),
  },
};
out.maybeWaterChecks = {
  typeMaybeWater: mw.body.plateau?.type === 'maybe_water',
  waistFalling: (mw.body.plateau?.waist_slope_per_week ?? 0) <= -0.2,
  citesKB: !!(mw.body.plateau?.message || '').includes('依据知识库'),
};

// ---- 4) 清理全部造数 → 复原 ----
for (const id of flatW.map((w) => w[0])) await del(id); // 平台体重造数(前面场景仍需在库,最后统一删)
for (const id of fallWaist.map((w) => w[0])) await del(id);
await new Promise((r) => setTimeout(r, 300));
const recAfter = await records();
const fin = await insights();
out.cleanup = {
  madeCount: made.length,
  recordsVisibleAfter: recAfter.length,
  allGone: !recAfter.some((r) => made.includes(r.id)),
  insightsBackToBaseline: {
    rate_alert: fin.body.rate_alert, plateau: fin.body.plateau,
    protein_target: fin.body.protein?.target_g,
  },
};
out.cleanupChecks = {
  recordsBackTo8: recAfter.length === 8,
  insightsRestored: fin.body.rate_alert === null && fin.body.plateau === null && fin.body.protein?.target_g === 124,
};

console.log('MADE_IDS ' + made.join(','));
console.log('BASELINE ' + fmt({ checks: out.baselineChecks, protein: out.baseline.protein }));
console.log('RATE_ALERT ' + fmt({ checks: out.rateAlertChecks, detail: out.rateAlert.detail }));
console.log('TRUE_PLATEAU ' + fmt({ checks: out.truePlateauChecks, detail: out.truePlateau.detail }));
console.log('MAYBE_WATER ' + fmt({ checks: out.maybeWaterChecks, detail: out.maybeWater.detail }));
console.log('CLEANUP ' + fmt({ checks: out.cleanupChecks, raw: out.cleanup }));
process.exit(0);
