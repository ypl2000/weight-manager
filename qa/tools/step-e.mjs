// e1: 今日页勾选/取消习惯 → habit_logs 增/软删; e2: 训练打卡增删 + 动作库清理
import { ensureChrome, connect, ev, goto, apiGet, apiSync, sleep, BASE } from './cdp.mjs';

const out = {};

// ============ e1 ============
await ensureChrome();
const c = await connect();
const title = await goto(c, BASE + '/#/');

const beforeLogs = (await apiGet('habit_logs')).filter((d) => !d.deleted);

const check1 = await ev(c, `(() => {
  const lb = [...document.querySelectorAll('label.check')].find(x => x.innerText.includes('蔬菜量'));
  if (!lb) return 'no-label';
  const cb = lb.querySelector('input[type=checkbox]');
  if (!cb) return 'no-checkbox';
  if (cb.checked) return 'already-checked';
  cb.click();
  return 'checked';
})()`);

let logAfterCheck = null;
{
  const t0 = Date.now();
  while (Date.now() - t0 < 12000) {
    const logs = (await apiGet('habit_logs')).filter((d) => !d.deleted);
    const hit = logs.find((d) => d.id === 'h_d2_2026-10-25' && d.data.done === 1);
    if (hit) { logAfterCheck = { elapsedMs: Date.now() - t0, doc: hit }; break; }
    await sleep(100);
  }
}

const check2 = await ev(c, `(() => {
  const lb = [...document.querySelectorAll('label.check')].find(x => x.innerText.includes('蔬菜量'));
  if (!lb) return 'no-label';
  const cb = lb.querySelector('input[type=checkbox]');
  if (!cb.checked) return 'already-unchecked';
  cb.click();
  return 'unchecked';
})()`);

let goneAfterUncheck = false;
let tombE1 = null;
{
  const t0 = Date.now();
  while (Date.now() - t0 < 12000) {
    const logs = (await apiGet('habit_logs')).filter((d) => !d.deleted);
    if (!logs.some((d) => d.id === 'h_d2_2026-10-25')) { goneAfterUncheck = true; break; }
    await sleep(100);
  }
  const pull = await apiSync({ device: 'qa-pull-check', cursor: 0, changes: [] });
  tombE1 = pull.changes.find((d) => d.table === 'habit_logs' && d.id === 'h_d2_2026-10-25');
}

const afterLogs = (await apiGet('habit_logs')).filter((d) => !d.deleted);
out.e1 = {
  pageTitle: title,
  visibleBefore: beforeLogs.map((d) => d.id).sort(),
  check1,
  logAfterCheck,
  check2,
  goneAfterUncheck,
  tombstone: tombE1 && { deleted: tombE1.deleted },
  visibleAfter: afterLogs.map((d) => d.id).sort(),
};

// ============ e2 ============
await ev(c, `location.hash = '#/training'`);
await sleep(1000);

// 添加动作库条目 测试-压腿
const addEx = await ev(c, `(async () => {
  const d = [...document.querySelectorAll('details.sec')].find(x => x.querySelector('summary') && x.querySelector('summary').textContent.includes('动作库管理'));
  if (!d) return 'no-details';
  d.open = true;
  await new Promise(r => setTimeout(r, 200));
  const inp = d.querySelector('input[placeholder="新动作名称"]');
  if (!inp) return 'no-input';
  const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
  setter.call(inp, '测试-压腿');
  inp.dispatchEvent(new Event('input', { bubbles: true }));
  await new Promise(r => setTimeout(r, 100));
  const sel = d.querySelector('select');
  setter.call; // noop
  const selSetter = Object.getOwnPropertyDescriptor(window.HTMLSelectElement.prototype, 'value').set;
  selSetter.call(sel, 'cardio');
  sel.dispatchEvent(new Event('change', { bubbles: true }));
  await new Promise(r => setTimeout(r, 100));
  const btn = [...d.querySelectorAll('button')].find(b => b.textContent.trim() === '添加');
  if (!btn) return 'no-add-btn';
  btn.click();
  return 'added';
})()`);

// 等动作库条目同步可见（本地写即刻可见）
await sleep(500);

// 表单:加项目 → 选 测试-压腿 → 7 分钟 → 保存打卡
const fillForm = await ev(c, `(async () => {
  const setterI = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
  const setterS = Object.getOwnPropertyDescriptor(window.HTMLSelectElement.prototype, 'value').set;
  const addBtn = [...document.querySelectorAll('button')].find(b => b.textContent.includes('加项目'));
  if (!addBtn) return 'no-add-item-btn';
  addBtn.click();
  await new Promise(r => setTimeout(r, 300));
  const cand = document.querySelector('.cand');
  if (!cand) return 'no-cand';
  const sel = cand.querySelector('select');
  const opt = [...sel.options].find(o => o.value === '测试-压腿' || o.textContent === '测试-压腿');
  if (!opt) return 'no-option';
  setterS.call(sel, '测试-压腿');
  sel.dispatchEvent(new Event('change', { bubbles: true }));
  await new Promise(r => setTimeout(r, 100));
  const min = cand.querySelector('input[type=number]');
  setterI.call(min, '7');
  min.dispatchEvent(new Event('input', { bubbles: true }));
  await new Promise(r => setTimeout(r, 100));
  const save = [...document.querySelectorAll('button')].find(b => b.textContent.trim() === '保存打卡');
  if (!save) return 'no-save-btn';
  save.click();
  return 'saved-clicked';
})()`);

const toastW = await ev(c, `(async () => {
  for (let i = 0; i < 40; i++) {
    if (document.body.innerText.includes('打卡成功')) return true;
    await new Promise(r => setTimeout(r, 100));
  }
  return false;
})()`);

let workoutNew = null;
{
  const t0 = Date.now();
  while (Date.now() - t0 < 12000) {
    const wks = (await apiGet('workouts')).filter((d) => !d.deleted);
    const hit = wks.find((d) => d.data.items && d.data.items.some((it) => it.name === '测试-压腿'));
    if (hit) { workoutNew = { elapsedMs: Date.now() - t0, doc: hit }; break; }
    await sleep(100);
  }
}

// UI 删除该训练
const delW = await ev(c, `(() => {
  const tr = [...document.querySelectorAll('.list tbody tr')].find(x => x.innerText.includes('测试-压腿'));
  if (!tr) return 'no-row';
  const btn = tr.querySelector('button.small.danger');
  if (!btn) return 'no-btn';
  btn.click();
  return 'clicked';
})()`);

let workoutsBackTo1 = false;
let tombW = null;
{
  const t0 = Date.now();
  while (Date.now() - t0 < 12000) {
    const wks = (await apiGet('workouts')).filter((d) => !d.deleted);
    if (wks.length === 1) { workoutsBackTo1 = true; break; }
    await sleep(100);
  }
  const pull = await apiSync({ device: 'qa-pull-check', cursor: 0, changes: [] });
  tombW = pull.changes.find((d) => d.table === 'workouts' && d.data && d.data.items && d.data.items.some((it) => it.name === '测试-压腿'));
}

// 清理动作库:删除 测试-压腿
const delEx = await ev(c, `(async () => {
  const d = [...document.querySelectorAll('details.sec')].find(x => x.querySelector('summary') && x.querySelector('summary').textContent.includes('动作库管理'));
  if (!d) return 'no-details';
  d.open = true;
  await new Promise(r => setTimeout(r, 200));
  const tr = [...d.querySelectorAll('tbody tr')].find(x => x.innerText.includes('测试-压腿'));
  if (!tr) return 'no-row';
  const btn = tr.querySelector('button.small.danger');
  if (!btn) return 'no-btn';
  btn.click();
  return 'clicked';
})()`);

let exClean = false;
let exTomb = null;
{
  const t0 = Date.now();
  while (Date.now() - t0 < 12000) {
    const pull = await apiSync({ device: 'qa-pull-check', cursor: 0, changes: [] });
    const t = pull.changes.find((d) => d.table === 'exercises' && d.data && d.data.name === '测试-压腿');
    if (t && t.deleted) { exTomb = t; exClean = true; break; }
    await sleep(200);
  }
}

out.e2 = {
  addEx, fillForm, toastW,
  workoutNew: workoutNew && {
    elapsedMs: workoutNew.elapsedMs,
    type: workoutNew.doc.data.type,
    date: workoutNew.doc.data.date,
    items: workoutNew.doc.data.items,
    duration_min: workoutNew.doc.data.duration_min,
    feel: workoutNew.doc.data.feel,
  },
  delW, workoutsBackTo1,
  tombW: tombW && { deleted: tombW.deleted },
  delEx, exClean,
  exTombstone: exTomb && { deleted: exTomb.deleted },
};

console.log(JSON.stringify(out, null, 2));
process.exit(0);
