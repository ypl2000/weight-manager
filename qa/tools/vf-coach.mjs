// 全量功能验证·AI 教练(真实模型):周报 SSE+存档、问教练知识库优先/库外标注、坏入参零模型、历史管理清理
// 运行: node qa/tools/vf-coach.mjs  (真实模型调用,总耗时约 1-2 分钟)
const B = 'http://127.0.0.1:8000';
const results = [];
const T = (id, name, pass, detail) => {
  results.push({ id, name, pass: !!pass, detail: String(detail).slice(0, 600) });
  console.log(`${pass ? 'PASS' : 'FAIL'} ${id} ${name} :: ${String(detail).slice(0, 260)}`);
};
const j = async (u, opt) => (await fetch(B + u, opt)).json();
const visible = (docs) => (docs.documents || docs).filter((d) => !d.deleted);

// SSE POST:逐事件收集
async function sse(url, body, raw) {
  const t0 = Date.now();
  const res = await fetch(B + url, {
    method: 'POST',
    headers: raw ? { 'Content-Type': 'application/json' } : { 'Content-Type': 'application/json' },
    body: raw !== undefined ? raw : JSON.stringify(body),
  });
  const text = await res.text();
  const events = text.split('\n\n').filter((s) => s.startsWith('data: ')).map((s) => { try { return JSON.parse(s.slice(6)); } catch { return { parse_error: s }; } });
  return { status: res.status, events, ms: Date.now() - t0, text };
}
const deltas = (r) => r.events.filter((e) => typeof e.delta === 'string');
const errs = (r) => r.events.filter((e) => e.error);

// ---------- 基线 ----------
let base = {
  reports: visible(await j('/api/tables/coach_reports')).length,
  qa: visible(await j('/api/tables/coach_qa')).length,
};
console.log(`基线: coach_reports=${base.reports} coach_qa=${base.qa}`);

// ---------- C1 周报 SSE 流式 + C2 存档 ----------
const rep = await sse('/api/coach/report', {});
const repText = deltas(rep).map((e) => e.delta).join('');
const doneEv = rep.events.find((e) => e.done);
T('C1', '周报 SSE 流式(delta 多条 + done+report_id)',
  rep.status === 200 && deltas(rep).length > 3 && doneEv && doneEv.report_id && repText.length > 200,
  `status=${rep.status} events=${rep.events.length} deltas=${deltas(rep).length} chars=${repText.length} done=${JSON.stringify(doneEv)} ${rep.ms}ms`);
const reports1 = await j('/api/tables/coach_reports');
const newRep = visible(reports1).find((d) => d.id === (doneEv && doneEv.report_id));
T('C2', '周报存档 coach_reports +1 且正文完整',
  visible(reports1).length === base.reports + 1 && newRep && (newRep.data.content || newRep.data.report || '').length > 200,
  `n=${visible(reports1).length} id=${doneEv && doneEv.report_id} keys=${newRep && Object.keys(newRep.data)}`);

// ---------- C3 周报坏入参(D3 回归) ----------
const bads = [
  ['无body', undefined, undefined],
  ['坏JSON', 'not-json{{', undefined],
  ['days:"abc"', { days: 'abc' }, undefined],
  ['days:true', { days: true }, undefined],
  ['days:0', { days: 0 }, undefined],
];
for (const [name, body] of bads) {
  const r = await sse('/api/coach/report', body, body === undefined && name === '无body' ? undefined : (typeof body === 'string' ? body : JSON.stringify(body)));
  const ok = r.status === 200 && errs(r).length === 1 && deltas(r).length === 0 && !r.events.some((e) => e.done) && r.ms < 3000;
  T('C3', `周报坏入参[${name}] 单条error零模型`, ok, `${r.ms}ms events=${JSON.stringify(r.events)}`);
}

// ---------- C4 问教练-库内 ----------
const q1 = '平台期体重不动了怎么办？腰围还在降说明什么？';
const a1 = await sse('/api/coach/ask', { question: q1 });
const a1Text = deltas(a1).map((e) => e.delta).join('');
const a1Done = a1.events.find((e) => e.done);
T('C4', '问教练-库内引"依据知识库·"', a1.status === 200 && a1Text.includes('依据知识库·') && a1Done && a1Done.qa_id,
  `${a1.ms}ms deltas=${deltas(a1).length} chars=${a1Text.length} 引用=${(a1Text.match(/依据知识库·[^,。;:)）]*/g) || []).slice(0, 3)}`);

// ---------- C5 问教练-库外 ----------
const q2 = '光合作用的暗反应发生在细胞的哪个结构？';
const a2 = await sse('/api/coach/ask', { question: q2 });
const a2Text = deltas(a2).map((e) => e.delta).join('');
const a2Done = a2.events.find((e) => e.done);
T('C5', '问教练-库外标"知识库之外的补充"', a2.status === 200 && a2Text.includes('知识库之外的补充') && a2Done && a2Done.qa_id,
  `${a2.ms}ms 开头=${a2Text.slice(0, 80)}`);

// ---------- C6 问教练坏入参 ----------
const qbads = [
  ['无body', 'undefined'],
  ['坏JSON', 'not-json{{'],
  ['question:123', JSON.stringify({ question: 123 })],
  ['空白串', JSON.stringify({ question: '   ' })],
  ['501字', JSON.stringify({ question: '长'.repeat(501) })],
];
for (const [name, raw] of qbads) {
  const r = await sse('/api/coach/ask', null, raw === 'undefined' ? undefined : raw);
  const ok = r.status === 200 && errs(r).length === 1 && deltas(r).length === 0 && r.ms < 3000;
  T('C6', `问教练坏入参[${name}] 单条error零模型`, ok, `${r.ms}ms ${JSON.stringify(r.events).slice(0, 120)}`);
}

// ---------- C7/C8 历史管理(清理测试产生项,复原基线) ----------
const qaNow = await j('/api/tables/coach_qa');
const myQa = visible(qaNow).filter((d) => [q1, q2].includes(d.data.question));
T('C7', '问答存档 coach_qa 两条且可列', myQa.length === 2 && myQa.every((d) => (d.data.answer || '').length > 50), `qa可见=${visible(qaNow).length} 我的=${myQa.length}`);
for (const d of myQa) await fetch(`${B}/api/tables/coach_qa/${d.id}`, { method: 'DELETE' });
if (doneEv && doneEv.report_id) await fetch(`${B}/api/tables/coach_reports/${doneEv.report_id}`, { method: 'DELETE' });
const qaEnd = visible(await j('/api/tables/coach_qa')).length;
const repEnd = visible(await j('/api/tables/coach_reports')).length;
T('C8', '历史删除后基线复原(软删墓碑)', qaEnd === base.qa && repEnd === base.reports, `coach_qa=${qaEnd}/${base.qa} coach_reports=${repEnd}/${base.reports}`);

// ---------- 汇总 ----------
const fails = results.filter((x) => !x.pass);
console.log(`\n== 教练段: ${results.length - fails.length}/${results.length} pass ==`);
if (fails.length) { console.log('FAILS:', fails.map((f) => f.id).join(',')); process.exitCode = 1; }
