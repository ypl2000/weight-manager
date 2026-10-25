// 迭代2-7:coach 缺 body 错误路径探测(收到首个事件即 abort,避免完整生成)
import { sleep } from './cdp.mjs';

const B = 'http://127.0.0.1:8000';
const count = async () => {
  const d = await (await fetch(B + '/api/tables/coach_reports')).json();
  return { vis: d.filter(x => !x.deleted).length, total: d.length };
};
const before = await count();
console.log('before:', JSON.stringify(before));

async function probe(name, opts) {
  const t0 = Date.now();
  const ctl = new AbortController();
  const r = await fetch(B + '/api/coach/report', { ...opts, signal: ctl.signal }).catch(e => ({ err: String(e) }));
  if (r.err) return console.log(name, '-> fetch error:', r.err);
  const reader = r.body.getReader();
  const dec = new TextDecoder();
  let buf = '', firstEvents = [];
  try {
    while (firstEvents.length < 2 && Date.now() - t0 < 20000) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += dec.decode(value, { stream: true });
      let i;
      while ((i = buf.indexOf('\n\n')) >= 0) {
        const c = buf.slice(0, i); buf = buf.slice(i + 2);
        for (const line of c.split('\n')) if (line.startsWith('data:')) firstEvents.push(line.slice(5).trim().slice(0, 200));
      }
    }
  } catch (e) {
    firstEvents.push('[read aborted: ' + e.name + ']');
  }
  console.log(name, '-> HTTP', r.status, r.headers.get('content-type'), '| first events:', JSON.stringify(firstEvents));
  ctl.abort();          // 立即断开,避免完整生成
  await reader.cancel().catch(() => {});
}

await probe('no-body      ', { method: 'POST' });
await probe('invalid-json ', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: 'not-json{{' });
await probe('days-wrong-typ', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ days: 'abc' }) });

await sleep(5000);  // 等服务端侧生成器被取消/落库
const after = await count();
console.log('after:', JSON.stringify(after), '(若与 before 相同 → 未产生归档)');
process.exit(0);
