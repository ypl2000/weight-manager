// b2: LWW 旧版本推送不回滚；b3: UI 删除 → 服务端软删除墓碑
import { ensureChrome, connect, ev, apiGet, apiSync, apiHistory, sleep, BASE } from './cdp.mjs';

const R2 = { id: '3870f5b1-db8e-4327-a3f7-5e0ca82968b1' };

// ---------- b2: LWW ----------
const before = (await apiGet('records')).find((d) => d.id === R2.id);
const histBefore = await apiHistory(`?table=records&doc_id=${R2.id}`);

const oldVersion = {
  table: 'records',
  id: R2.id,
  data: { ...before.data, value: 55.55, unit: 'kg' },
  updated_at: new Date(new Date(before.updated_at).getTime() - 3600_000).toISOString(),
  deleted: false,
};
const pushRes = await apiSync({ device: 'qa-lww-probe', cursor: 1_000_000_000, changes: [oldVersion] });

const after = (await apiGet('records')).find((d) => d.id === R2.id);
const histAfter = await apiHistory(`?table=records&doc_id=${R2.id}`);

const lww = {
  pushedUpdated_at: oldVersion.updated_at,
  pushedValue: 55.55,
  serverValueAfter: after.data.value,
  serverUpdatedAtAfter: after.updated_at,
  notRolledBack:
    after.data.value === 77.77 && after.updated_at === before.updated_at,
  historyCountBefore: histBefore.length,
  historyCountAfter: histAfter.length,
  rejectedNoHistory: histBefore.length === histAfter.length,
};
console.log('B2_LWW ' + JSON.stringify(lww));

// ---------- b3: UI 删除 ----------
await ensureChrome();
const c = await connect();
await ev(c, `location.hash = '#/data'`);
await sleep(800);

const rows = await ev(c, `(() => {
  return [...document.querySelectorAll('.list tbody tr')].map(tr => tr.innerText.replace(/\\s+/g, ' ').trim());
})()`);
const del = await ev(c, `(() => {
  const tr = [...document.querySelectorAll('.list tbody tr')].find(x => x.innerText.includes('77.77'));
  if (!tr) return 'no-row';
  const btn = tr.querySelector('button.small.danger');
  if (!btn) return 'no-btn';
  btn.click();
  return 'clicked';
})()`);

const toastDel = await ev(c, `(async () => {
  for (let i = 0; i < 40; i++) {
    if (document.body.innerText.includes('已删除')) return true;
    await new Promise(r => setTimeout(r, 100));
  }
  return false;
})()`);

// 服务端:GET 列表不再出现
let goneFromList = false;
for (let i = 0; i < 80; i++) {
  const docs = await apiGet('records');
  if (!docs.some((d) => d.id === R2.id)) {
    goneFromList = true;
    break;
  }
  await sleep(100);
}

// cursor=0 全量拉取可见墓碑
const pull = await apiSync({ device: 'qa-pull-check', cursor: 0, changes: [] });
const tombstone = pull.changes.find((d) => d.id === R2.id);

const uiListAfter = await ev(c, `(() => {
  return [...document.querySelectorAll('.list tbody tr')].map(tr => tr.innerText.replace(/\\s+/g, ' ').trim());
})()`);

console.log(
  'B3_DELETE ' +
    JSON.stringify(
      {
        rowsBefore: rows,
        del,
        toastDel,
        goneFromList,
        tombstone: tombstone && { deleted: tombstone.deleted, updated_at: tombstone.updated_at },
        uiListAfter,
      },
      null,
      2,
    ),
);
