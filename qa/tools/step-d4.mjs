// d4 补做: UI 删除被恢复的 R2 → 服务端墓碑 → records 可见回到 8
import { ensureChrome, connect, ev, apiGet, apiSync, sleep, BASE } from './cdp.mjs';

const R2 = '3870f5b1-db8e-4327-a3f7-5e0ca82968b1';

await ensureChrome();
const c = await connect();
await ev(c, `location.hash = '#/data'`);

// 等待页面本地拉到 R2（30s 周期同步），DOM 出现 77.77 行
let appeared = false;
for (let i = 0; i < 400; i++) {
  const has = await ev(c, `!![...document.querySelectorAll('.list tbody tr')].find(x => x.innerText.includes('77.77'))`);
  if (has) { appeared = true; break; }
  await sleep(100);
}
const clicked = await ev(c, `(() => {
  const tr = [...document.querySelectorAll('.list tbody tr')].find(x => x.innerText.includes('77.77'));
  if (!tr) return 'no-row';
  const btn = tr.querySelector('button.small.danger');
  if (!btn) return 'no-btn';
  btn.click();
  return 'clicked';
})()`);

let gone = false;
let waitedMs = 0;
const t0 = Date.now();
while (Date.now() - t0 < 12000) {
  const docs = await apiGet('records');
  if (!docs.some((d) => d.id === R2)) { gone = true; waitedMs = Date.now() - t0; break; }
  await sleep(100);
}

const pull = await apiSync({ device: 'qa-pull-check', cursor: 0, changes: [] });
const tombR2 = pull.changes.find((d) => d.id === R2);
const tombR1 = pull.changes.find((d) => d.id === 'f55e1170-eb81-4f2f-ba93-4e13b3795beb');
const vis = pull.changes.filter((d) => d.table === 'records' && !d.deleted);

console.log(JSON.stringify({
  appeared, clicked, gone, waitedMs,
  tombR2: tombR2 && { deleted: tombR2.deleted },
  tombR1: tombR1 && { deleted: tombR1.deleted },
  visibleRecords: vis.length,
  values: vis.map((d) => `${d.data.metric_code}:${d.data.value}`).sort(),
}, null, 2));
process.exit(0);
