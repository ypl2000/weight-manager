// 迭代2-5:POST /api/coach/report {"days":7} SSE 流验证
import { sleep } from './cdp.mjs';

const B = 'http://127.0.0.1:8000';
const before = await (await fetch(B + '/api/tables/coach_reports')).json();
console.log('coach_reports before:', before.filter(x => !x.deleted).length, 'visible /', before.length, 'total');

const t0 = Date.now();
const r = await fetch(B + '/api/coach/report', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ days: 7 }),
});
console.log('HTTP', r.status, r.headers.get('content-type'));

const reader = r.body.getReader();
const dec = new TextDecoder();
let buf = '', deltas = 0, chars = 0, doneEv = null, errEv = null, firstDeltaMs = null, events = [];
while (true) {
  const { done, value } = await reader.read();
  if (done) break;
  buf += dec.decode(value, { stream: true });
  let i;
  while ((i = buf.indexOf('\n\n')) >= 0) {
    const chunk = buf.slice(0, i); buf = buf.slice(i + 2);
    for (const line of chunk.split('\n')) {
      if (!line.startsWith('data:')) continue;
      let obj;
      try { obj = JSON.parse(line.slice(5).trim()); } catch { continue; }
      events.push(obj);
      if ('delta' in obj) {
        deltas++;
        chars += obj.delta.length;
        if (firstDeltaMs == null) firstDeltaMs = Date.now() - t0;
      }
      if (obj.error) errEv = obj.error;
      if (obj.done) doneEv = obj;
    }
  }
}
const totalMs = Date.now() - t0;
console.log(JSON.stringify({
  httpStatus: r.status,
  eventCount: events.length,
  deltaEvents: deltas,
  totalChars: chars,
  firstDeltaMs,
  totalMs,
  done: doneEv,
  error: errEv,
}, null, 1));

const after = await (await fetch(B + '/api/tables/coach_reports')).json();
const visAfter = after.filter(x => !x.deleted);
console.log('coach_reports after:', visAfter.length, 'visible /', after.length, 'total');
const mine = doneEv && visAfter.find(x => x.id === doneEv.report_id);
console.log('archived report found:', !!mine, mine ? JSON.stringify({ id: mine.id, days: mine.data.days, model: mine.data.model, at: mine.data.at, contentLen: (mine.data.content || '').length, device: mine.device, contentHead: (mine.data.content || '').slice(0, 120) }) : '');
process.exit(0);
