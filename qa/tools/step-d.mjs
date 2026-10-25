// d1: history 审计存在; d2/d3: 恢复 R2 创建版本 → 可见 + device=restore; d4: UI 再删除恢复基线; 附带清理上轮遗留 R1
import { ensureChrome, connect, ev, apiGet, apiHistory, sleep, BASE } from './cdp.mjs';

const R2 = '3870f5b1-db8e-4327-a3f7-5e0ca82968b1';
const R1 = 'f55e1170-eb81-4f2f-ba93-4e13b3795beb';

// d1
const histHead = await apiHistory('?limit=3');
console.log('D1_HEAD ' + JSON.stringify(histHead.map((h) => ({ seq: h.seq, table: h.table, doc_id: h.doc_id, action: h.action, device: h.device }))));

// d2: 找 R2 的创建版本（action=update 且 data 非空）
const r2hist = await apiHistory(`?table=records&doc_id=${R2}`);
const createRow = r2hist.find((h) => h.action !== 'delete' && h.data && h.data.value === 77.77);
console.log('D2_HIST ' + JSON.stringify(r2hist.map((h) => ({ seq: h.seq, action: h.action, device: h.device, value: h.data && h.data.value }))));
const res = await fetch(`${BASE}/api/history/${createRow.seq}/restore`, { method: 'POST' });
const restoreRes = { status: res.status, body: await res.json() };

// d3: 服务端可见 + history 新增 device=restore
const visibleAgain = (await apiGet('records')).find((d) => d.id === R2);
const histAfterRestore = await apiHistory(`?table=records&doc_id=${R2}`);
console.log('D3_RESTORE ' + JSON.stringify({
  restoreRes,
  visibleAgain: visibleAgain && { value: visibleAgain.data.value, unit: visibleAgain.data.unit, updated_at: visibleAgain.updated_at },
  newestHist: histAfterRestore[0] && { seq: histAfterRestore[0].seq, device: histAfterRestore[0].device, action: histAfterRestore[0].action },
}));

// d4: UI 删除恢复出来的 R2，再清理 R1
await ensureChrome();
const c = await connect();
await ev(c, `location.hash = '#/data'`);
await sleep(800);

async function uiDeleteFirst77() {
  const clicked = await ev(c, `(() => {
    const tr = [...document.querySelectorAll('.list tbody tr')].find(x => x.innerText.includes('77.77'));
    if (!tr) return 'no-row';
    const btn = tr.querySelector('button.small.danger');
    if (!btn) return 'no-btn';
    btn.click();
    return 'clicked';
  })()`);
  for (let i = 0; i < 80; i++) {
    await sleep(100);
    const docs = await apiGet('records');
    return { clicked, docNow: docs.find((d) => d.data && d.data.value === 77.77 && !d.deleted) };
  }
}

const delR2 = await (async () => {
  const r = await uiDeleteFirst77();
  // 确认删掉的是 R2（恢复出来的行更新时间最新，应排最前）
  return r;
})();
const delR1 = await uiDeleteFirst77();

const finalVisible77 = (await apiGet('records')).filter((d) => !d.deleted && d.data.value === 77.77);
const totalVisible = (await apiGet('records')).filter((d) => !d.deleted).length;
console.log('D4_CLEANUP ' + JSON.stringify({ delR2, delR1, finalVisible77: finalVisible77.map((d) => d.id), totalVisible }));
process.exit(0);
