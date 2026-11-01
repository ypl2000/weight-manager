// 临时探针:习惯 checkbox 点击后本地/服务端写入链路
import { ensureChrome, connect, ev, goto } from './cdp.mjs';

await ensureChrome();
const c = await connect();
const h1 = await goto(c, 'http://127.0.0.1:8000/#/');
console.log('h1:', h1);
const r = await ev(c, `(async () => {
  const box = [...document.querySelectorAll('.card')].find(x => x.querySelector('h2') && x.querySelector('h2').textContent.includes('今日打卡'));
  if (!box) return { box: false };
  const cbs = [...box.querySelectorAll('input[type=checkbox]')];
  const cb = cbs.find(x => !x.checked);
  if (!cb) return { allChecked: true, n: cbs.length };
  cb.click();
  await new Promise(r => setTimeout(r, 800));
  return { clicked: true, nowChecked: cb.checked, total: cbs.length, syncDot: (document.querySelector('.sync-dot') || {}).textContent };
})()`);
console.log('tap:', JSON.stringify(r));
await new Promise((r) => setTimeout(r, 4000));
const logs = await (await fetch('http://127.0.0.1:8000/api/tables/habit_logs')).json();
console.log('server habit_logs:', JSON.stringify(logs.filter((d) => !d.deleted).map((d) => ({ id: d.id, data: d.data }))));
process.exit(0);
