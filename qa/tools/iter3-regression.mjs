// 迭代3-4:回归冒烟(按 qa/smoke-checklist.md 抽核心链路)+ 基线核对
// a1/a2 UI 录入 77.77 → b1 服务端 3 秒内可见 → b3 UI 删除 → 服务端墓碑
// c1 stage-suggestion → f1-f3 PWA 资源 → z 基线核对
import { ensureChrome, connect, ev, goto, waitForAppReady, apiSync, sleep } from './cdp.mjs';

const B = 'http://127.0.0.1:8000';
const out = {};
await ensureChrome();
const c = await connect();

// ---- a1/a2:UI 录入 77.77 ----
out.pageTitle = await goto(c, 'http://127.0.0.1:8000/#/data');
await waitForAppReady(c);
out.add = await ev(c, `(async () => {
  // 录入子标签(默认即 data;若在趋势子标签则切回)
  const tab = [...document.querySelectorAll('button,a')].find(b => b.textContent.trim() === '录入');
  if (tab) tab.click();
  await new Promise(r => setTimeout(r, 500));
  // 选指标"体重"
  const chip = [...document.querySelectorAll('button,.chip,[class*=metric] *')].find(b => b.textContent.trim() === '体重');
  if (chip) chip.click();
  await new Promise(r => setTimeout(r, 300));
  const inp = document.querySelector('input[type=number], input[inputmode=decimal], input');
  if (!inp) return { ok: false, why: 'no input' };
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
  setter.call(inp, '77.77');
  inp.dispatchEvent(new Event('input', { bubbles: true }));
  await new Promise(r => setTimeout(r, 200));
  const btn = [...document.querySelectorAll('button')].find(b => b.textContent.includes('保存记录'));
  if (!btn) return { ok: false, why: 'no save btn' };
  btn.click();
  let toast = false;
  for (let i = 0; i < 40; i++) {
    if (document.body.innerText.includes('已保存')) { toast = true; break; }
    await new Promise(r => setTimeout(r, 100));
  }
  await new Promise(r => setTimeout(r, 500));
  const row = [...document.querySelectorAll('.list tbody tr')].map(tr => tr.innerText.replace(/\\s+/g, ' ')).find(t => t.includes('77.77'));
  return { ok: toast, toast, row: row || null };
})()`);

// ---- b1:服务端 3 秒内可见 ----
let seen = null;
for (let i = 0; i < 30; i++) {
  const docs = await (await fetch(B + '/api/tables/records')).json();
  const hit = docs.find((d) => !d.deleted && d.data.value === 77.77);
  if (hit) { seen = hit; break; }
  await sleep(100);
}
out.b1 = seen && { visibleInMs: true, id: seen.id, value: seen.data.value, metric: seen.data.metric_code, at: seen.data.at };
const newId = seen && seen.id;

// ---- b3:UI 删除 → 服务端墓碑 ----
out.b3 = await ev(c, `(async () => {
  const tr = [...document.querySelectorAll('.list tbody tr')].find(x => x.innerText.includes('77.77'));
  if (!tr) return { ok: false, why: 'no row' };
  const btn = tr.querySelector('button.small.danger');
  if (!btn) return { ok: false, why: 'no del btn' };
  btn.click();
  let toast = false;
  for (let i = 0; i < 40; i++) {
    if (document.body.innerText.includes('已删除')) { toast = true; break; }
    await new Promise(r => setTimeout(r, 100));
  }
  return { ok: toast, toast };
})()`);
let tomb = null, gone = false;
for (let i = 0; i < 80; i++) {
  const docs = await (await fetch(B + '/api/tables/records')).json();
  if (!docs.some((d) => d.id === newId)) { gone = true; break; }
  await sleep(100);
}
const pull = await apiSync({ device: 'qa-iter3-pull', cursor: 0, changes: [] });
tomb = pull.changes.find((d) => d.id === newId);
out.b3server = { goneFromGet: gone, tombstone: tomb ? { deleted: tomb.deleted } : null };

// ---- c1:stage-suggestion ----
const sug = await (await fetch(B + '/api/stage-suggestion')).json();
out.c1 = {
  suggested: sug.suggested,
  stageCount: (sug.items || []).length,
  s3WaistRule: (() => {
    const s3 = (sug.items || []).find((i) => i.stage_id === 's3');
    const r = s3 && (s3.rules || []).find((r) => (r.text || '').includes('85'));
    return r ? { ok: r.ok, detail: r.detail } : null;
  })(),
};

// ---- f1-f3:PWA 资源 ----
out.pwa = {};
for (const [k, p] of [['manifest', '/manifest.webmanifest'], ['sw', '/sw.js'], ['icon', '/icons/icon-192.png']]) {
  const r = await fetch(B + p);
  out.pwa[k] = { status: r.status, ctype: r.headers.get('content-type') };
}

// ---- f4:今日页正常加载 ----
out.today = await goto(c, 'http://127.0.0.1:8000/#/');

// ---- z:基线核对 ----
await sleep(2500); // 等 UI 删除同步沉淀
const tbl = async (t) => (await (await fetch(B + '/api/tables/' + t)).json());
const recs = await tbl('records');
const vis = recs.filter((d) => !d.deleted);
out.baseline = {
  records: { visible: vis.length, values: vis.map((d) => `${d.data.metric_code}:${d.data.value}`).sort() },
  workouts: (await tbl('workouts')).filter((d) => !d.deleted).length,
  habit_logs: (await tbl('habit_logs')).filter((d) => !d.deleted).length,
  coach_qa: (await tbl('coach_qa')).filter((d) => !d.deleted).map((d) => d.id),
  coach_reports: (await tbl('coach_reports')).filter((d) => !d.deleted).length,
  profile_stage: ((await tbl('profile'))[0] || {}).data,
};

console.log(JSON.stringify(out, null, 1));
process.exit(0);
