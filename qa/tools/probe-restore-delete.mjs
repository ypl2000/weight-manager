// 缺陷探针: 恢复"删除"类型历史行 → 是否产生 data 为空的可见记录（随后清理）
import { apiGet, apiHistory, apiSync, BASE } from './cdp.mjs';

const R2 = '3870f5b1-db8e-4327-a3f7-5e0ca82968b1';

const hist = await apiHistory(`?table=records&doc_id=${R2}`);
const delRow = hist.find((h) => h.action === 'delete');
console.log('DEL_ROW ' + JSON.stringify({ seq: delRow.seq, action: delRow.action, data: delRow.data }));

const res = await fetch(`${BASE}/api/history/${delRow.seq}/restore`, { method: 'POST' });
console.log('RESTORE ' + JSON.stringify({ status: res.status, body: await res.json() }));

const doc = (await apiGet('records')).find((d) => d.id === R2);
console.log('AFTER ' + JSON.stringify(doc));

// 清理:再推墓碑
const push = await apiSync({
  device: 'qa-probe-cleanup',
  cursor: 1_000_000_000,
  changes: [{ table: 'records', id: R2, data: {}, updated_at: new Date().toISOString(), deleted: true }],
});
const now = (await apiGet('records')).some((d) => d.id === R2);
const vis = (await apiGet('records')).filter((d) => !d.deleted).length;
console.log('CLEANUP ' + JSON.stringify({ stillVisible: now, visibleRecords: vis }));
process.exit(0);
