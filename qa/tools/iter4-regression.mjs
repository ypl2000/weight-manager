// 迭代4 QA:回归冒烟(c1 stage-suggestion / f PWA 资源 / coach ask 坏入参 error 事件)+ 收尾基线核对
// 记录增删(UI)在 iter4-ui.mjs 内已完成(a1/a2/b1/b3)
import { apiSync } from './cdp.mjs';

const B = 'http://127.0.0.1:8000';
const out = {};

// ---- c1:stage-suggestion ----
const sug = await (await fetch(B + '/api/stage-suggestion')).json();
out.c1 = {
  suggested: sug.suggested,
  stageCount: (sug.items || []).length,
  s3WaistRule: (() => {
    const s3 = (sug.items || []).find((i) => i.stage_id === 's3');
    const r = s3 && (sug.items || s3.rules || []).find ? (s3.rules || []).find((r) => (r.text || '').includes('85')) : null;
    return r ? { ok: r.ok, detail: r.detail } : null;
  })(),
};

// ---- f:PWA 资源 ----
out.pwa = {};
for (const [k, p] of [['manifest', '/manifest.webmanifest'], ['sw', '/sw.js'], ['icon', '/icons/icon-192.png']]) {
  const r = await fetch(B + p);
  out.pwa[k] = { status: r.status, ctype: r.headers.get('content-type') };
}

// ---- coach ask 坏入参(D3 口径:HTTP 200 + SSE error 事件,零模型调用) ----
async function askBad(label, body, raw) {
  const t0 = Date.now();
  const r = await fetch(B + '/api/coach/ask', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: raw !== undefined ? raw : JSON.stringify(body),
  });
  const text = await r.text();
  const ms = Date.now() - t0;
  const events = text.split('\n').filter((l) => l.startsWith('data:')).map((l) => l.slice(5).trim());
  let err = null, delta = 0, done = 0;
  for (const e of events) {
    try { const j = JSON.parse(e); if (j.error) err = j.error; if (j.delta) delta++; if (j.done) done++; } catch {}
  }
  return { label, http: r.status, ms, error: err, deltaEvents: delta, doneEvents: done };
}
out.ask = [];
out.ask.push(await askBad('no-body', undefined, undefined));
out.ask.push(await askBad('bad-json', undefined, 'not-json{{'));
out.ask.push(await askBad('question-number', { question: 123 }));
out.ask.push(await askBad('question-blank', { question: '   ' }));
out.ask.push(await askBad('question-501', { question: '问'.repeat(501) }));
// 不留档核对:坏入参不应新增 coach_qa
const cqa = (await (await fetch(B + '/api/tables/coach_qa')).json()).filter((d) => !d.deleted);
out.coachQaVisibleCount = cqa.length;

// ---- z:收尾基线核对 ----
const tbl = async (t) => (await (await fetch(B + '/api/tables/' + t)).json());
await new Promise((r) => setTimeout(r, 1500));
const recs = await tbl('records');
const vis = recs.filter((d) => !d.deleted);
out.baseline = {
  records: { visible: vis.length, values: vis.map((d) => `${d.data.metric_code}:${d.data.value}`).sort() },
  workouts: (await tbl('workouts')).filter((d) => !d.deleted).length,
  habit_logs: (await tbl('habit_logs')).filter((d) => !d.deleted).length,
  coach_qa: (await tbl('coach_qa')).filter((d) => !d.deleted).map((d) => d.id),
  coach_reports: (await tbl('coach_reports')).filter((d) => !d.deleted).length,
  profile_stage: ((await tbl('profile'))[0] || {}).data?.current_stage_id,
  waistMetricActive: (await tbl('metrics')).find((d) => d.data.code === 'waist')?.data?.active,
  qaResidueVisible: vis.filter((d) => String(d.id).startsWith('qa-')).length,
};
// reminders 终态与迭代4预期一致
const rem = await (await fetch(B + '/api/reminders')).json();
out.remindersFinal = rem.items.map((i) => `${i.code}:due=${i.due}:${i.reason}`);

console.log(JSON.stringify(out, null, 1));
process.exit(0);
