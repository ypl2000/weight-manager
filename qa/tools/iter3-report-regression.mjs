// 迭代3-5:周报回归 POST /api/coach/report {"days":7} → 流式+done+归档;测后删除归档报告
const B = 'http://127.0.0.1:8000';
const before = (await (await fetch(B + '/api/tables/coach_reports')).json()).filter((d) => !d.deleted);
console.log('reports before:', before.length);

const t0 = Date.now();
const r = await fetch(B + '/api/coach/report', {
  method: 'POST', headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ days: 7 }),
});
const reader = r.body.getReader();
const dec = new TextDecoder();
let buf = '', deltas = 0, chars = 0, doneEv = null, errEv = null, firstDeltaMs = null;
while (true) {
  const { done, value } = await reader.read();
  if (done) break;
  buf += dec.decode(value, { stream: true });
  let i;
  while ((i = buf.indexOf('\n\n')) >= 0) {
    const chunk = buf.slice(0, i); buf = buf.slice(i + 2);
    for (const line of chunk.split('\n')) {
      if (!line.startsWith('data:')) continue;
      let obj; try { obj = JSON.parse(line.slice(5).trim()); } catch { continue; }
      if ('delta' in obj) { deltas++; chars += obj.delta.length; if (firstDeltaMs == null) firstDeltaMs = Date.now() - t0; }
      if (obj.error) errEv = obj.error;
      if (obj.done) doneEv = obj;
    }
  }
}
console.log(JSON.stringify({
  status: r.status, ctype: r.headers.get('content-type'), deltas, chars,
  firstDeltaMs, totalMs: Date.now() - t0, done: doneEv, error: errEv,
}));

let archived = null;
if (doneEv && doneEv.report_id) {
  const docs = await (await fetch(B + '/api/tables/coach_reports')).json();
  const mine = docs.find((d) => d.id === doneEv.report_id);
  archived = mine && { found: true, days: mine.data.days, model: mine.data.model, contentLen: (mine.data.content || '').length, device: mine.device };
  // 清理:删除本次生成的报告,coach_reports 回到基线
  const dr = await fetch(`${B}/api/tables/coach_reports/${doneEv.report_id}`, { method: 'DELETE' });
  const after = (await (await fetch(B + '/api/tables/coach_reports')).json()).filter((d) => !d.deleted);
  console.log('ARCHIVED ' + JSON.stringify(archived));
  console.log('CLEANUP delete=' + dr.status, 'visible_after=' + after.length, 'back_to_baseline=' + (after.length === before.length));
}
process.exit(0);
