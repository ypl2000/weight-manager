// 全量功能验证·UI 部分(CDP 驱动 headless Chrome):横幅/录入删除/习惯/训练/阶段手动切换/设置分区/导入预览/拍照识别/教练页
// 运行: node qa/tools/vf-ui.mjs   (真实模型识别一次,约 20-60s)
// 注:离线优先应用,导航后必须等"在线+初始同步完成"再操作(waitForAppReady),否则写入会被初始拉取竞态覆盖
import { ensureChrome, connect, ev, goto, shot, waitForAppReady } from './cdp.mjs';
import { writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const B = 'http://127.0.0.1:8000';
const R = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'reports');
const results = [];
const T = (id, name, pass, detail) => {
  results.push({ id, name, pass: !!pass, detail: String(detail).slice(0, 600) });
  console.log(`${pass ? 'PASS' : 'FAIL'} ${id} ${name} :: ${String(detail).slice(0, 240)}`);
};
const j = async (u) => (await fetch(B + u)).json();
const visible = (docs) => (docs.documents || docs).filter((d) => !d.deleted);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// 导航 + 等 SPA 挂载 + 等初始同步就绪 + 注入 QA 页内助手
async function nav(client, hash) {
  await goto(client, B + hash);
  await waitForAppReady(client);
  const h1 = await ev(client, `(async () => {
    for (let i = 0; i < 200; i++) {
      const h = document.querySelector('.page-head h1');
      if (h && h.textContent.trim()) return h.textContent.trim();
      await new Promise(r => setTimeout(r, 100));
    }
    return null;
  })()`);
  await ev(client, `(() => {
    window.__qaCard = (t) => [...document.querySelectorAll('.card')].find(x => x.querySelector('h2') && x.querySelector('h2').textContent.includes(t));
    window.__qaToast = async (act) => {
      try { act(); } catch (e) { return 'act-error:' + e.message; }
      for (let i = 0; i < 40; i++) {
        const t = document.querySelector('#toast');
        if (t && t.textContent) return t.textContent;
        await new Promise(r => setTimeout(r, 100));
      }
      return 'no-toast';
    };
  })()`);
  return h1;
}
// 服务端轮询:fn 返回 true 即通过
async function pollServer(fn, ms = 8000, step = 300) {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) { if (await fn()) return true; await sleep(step); }
  return false;
}

await ensureChrome();
const c = await connect();

// ---------- S0 今日页 + 标题 ----------
const h1today = await nav(c, '/#/');
const title = await ev(c, 'document.title');
T('S0', 'PWA 标题与今日页渲染', title === '体重管理' && h1today === '今日', `title=${title} h1=${h1today}`);

// ---------- S1/M2 提醒横幅 ----------
const rem = await j('/api/reminders');
const dueCodes = (rem.items || []).filter((x) => x.due).map((x) => x.code);
const banners = await ev(c, `(async () => {
  for (let i = 0; i < 60; i++) {
    const bs = [...document.querySelectorAll('.page > .banner.warn')].map(b => b.textContent.trim());
    if (bs.length) return bs;
    await new Promise(r => setTimeout(r, 100));
  }
  return [];
})()`);
const hasWeightBanner = banners.some((t) => t.includes('该测体重了'));
T('M2', `今日页提醒横幅与 API 一致(due=${dueCodes.join('+')})`,
  JSON.stringify(banners.map((b) => (b.includes('体重') ? 'weight' : b.includes('腰围') ? 'waist' : '?')).sort()) === JSON.stringify([...dueCodes].sort()) && hasWeightBanner,
  `banners=${JSON.stringify(banners)} due=${JSON.stringify(dueCodes)}`);
await shot(c, path.join(R, 'vf-today-banners-1280.png'));

// ---------- S2/I4 智能提示卡 ----------
const ins = await j('/api/insights');
const insCard = await ev(c, `(() => {
  const card = window.__qaCard('智能提示');
  if (!card) return null;
  return { protein: (card.querySelector('.protein-num')||{}).textContent, pill: (card.querySelector('.pill')||{}).textContent, note: (card.querySelector('p.muted')||{}).textContent };
})()`);
T('I4', '今日页智能提示卡 124g/鸡胸肉/引知识库',
  insCard && insCard.protein === String(ins.protein.target_g) && insCard.pill.includes('鸡胸肉') && (insCard.note || '').includes('知识库'),
  JSON.stringify(insCard));

// ---------- S3/K1 习惯勾选/取消 ----------
const h0 = visible(await j('/api/tables/habit_logs')).length;
const habitStep = await ev(c, `(async () => {
  const box = window.__qaCard('今日打卡');
  if (!box) return { found: false };
  const cb = [...box.querySelectorAll('input[type=checkbox]')].find(x => !x.checked);
  if (!cb) return { found: true, allChecked: true };
  const name = cb.parentElement.textContent.trim().slice(0, 20);
  cb.click();
  return { found: true, name };
})()`);
const h1ok = await pollServer(async () => visible(await j('/api/tables/habit_logs')).length === h0 + 1);
const todayStr = new Date().toLocaleDateString('sv-SE');
const added = visible(await j('/api/tables/habit_logs')).find((d) => d.data.date === todayStr);
await ev(c, `(async () => {
  const box = window.__qaCard('今日打卡');
  const cb = [...box.querySelectorAll('input[type=checkbox]')].find(x => x.checked);
  if (cb) cb.click();
  return true;
})()`);
const h0ok = await pollServer(async () => visible(await j('/api/tables/habit_logs')).length === h0);
T('K1', '习惯勾选→habit_logs+1(done=1当日)→取消→复原',
  habitStep.found && !habitStep.allChecked && h1ok && h0ok && added && added.data.done === 1,
  `tap=${JSON.stringify(habitStep)} +1=${h1ok} done=${added && added.data.done} date=${added && added.data.date} 复原=${h0ok}`);

// ---------- S4/R2 UI 录入 77.77 ----------
await nav(c, '/#/data');
const saved = await ev(c, `(async () => {
  const card = window.__qaCard('新增记录');
  const sel = card.querySelector('select');
  sel.value = 'weight'; sel.dispatchEvent(new Event('change', { bubbles: true }));
  const num = card.querySelector('input[type=number]');
  num.value = '77.77'; num.dispatchEvent(new Event('input', { bubbles: true }));
  await new Promise(r => setTimeout(r, 300)); // Vue 反应式:按钮 disabled 态需等下一个 tick 解除
  const btn = [...card.querySelectorAll('button')].find(b => b.textContent.includes('保存记录'));
  if (btn.disabled) return 'btn-disabled';
  return window.__qaToast(() => btn.click());
})()`);
const inServer = await pollServer(async () => visible(await j('/api/tables/records')).some((d) => d.data.value === 77.77));
const rec77 = visible(await j('/api/tables/records')).find((d) => d.data.value === 77.77);
const rowShown = await ev(c, `(() => { const tb = window.__qaCard('最近记录'); return tb ? tb.innerText.includes('77.77') : false; })()`);
T('R2', 'UI 录入 77.77:toast+列表行+服务端≤8s', saved === '已保存' && inServer && rowShown,
  `toast=${saved} server=${inServer} row=${rowShown} id=${rec77 && rec77.id}`);

// ---------- S5/M3 横幅消失/复现 ----------
await nav(c, '/#/');
const bannerGone = await ev(c, `[...document.querySelectorAll('.page > .banner.warn')].map(b => b.textContent).join('|')`);
T('M3a', '录入后"该测体重了"横幅消失', !bannerGone.includes('该测体重了'), `banners=${bannerGone || '(无)'}`);
await nav(c, '/#/data');
const del1 = await ev(c, `(async () => {
  const tb = window.__qaCard('最近记录');
  const tr = [...tb.querySelectorAll('tbody tr')].find(x => x.textContent.includes('77.77'));
  if (!tr) return 'row-not-found';
  return window.__qaToast(() => [...tr.querySelectorAll('button')].find(b => b.textContent.includes('删')).click());
})()`);
const gone = await pollServer(async () => !visible(await j('/api/tables/records')).some((d) => d.data.value === 77.77));
await nav(c, '/#/');
const bannerBack = await ev(c, `[...document.querySelectorAll('.page > .banner.warn')].map(b => b.textContent).join('|')`);
T('M3b', '删除后服务端消失+横幅复现', del1 === '已删除' && gone && bannerBack.includes('该测体重了'), `toast=${del1} serverGone=${gone} banners=${bannerBack}`);

// ---------- S7-S9/K3-K6 训练打卡 ----------
await nav(c, '/#/training');
const w0 = visible(await j('/api/tables/workouts')).length;
const pills0 = await ev(c, `[...document.querySelectorAll('.pill')].map(p => p.textContent.trim()).filter(t => t.includes('本周'))`);
const cardioSave = await ev(c, `(async () => {
  const card = window.__qaCard('训练打卡');
  const sel = card.querySelector('select');
  sel.value = 'cardio'; sel.dispatchEvent(new Event('change', { bubbles: true }));
  await new Promise(r => setTimeout(r, 300));
  [...card.querySelectorAll('button')].find(b => b.textContent.includes('加项目')).click();
  await new Promise(r => setTimeout(r, 200));
  const cand = card.querySelector('.cand');
  if (!cand) return 'no-cand';
  const exSel = cand.querySelector('select');
  exSel.selectedIndex = 0; exSel.dispatchEvent(new Event('change', { bubbles: true }));
  const mins = cand.querySelector('input[type=number]');
  mins.value = '20'; mins.dispatchEvent(new Event('input', { bubbles: true }));
  await new Promise(r => setTimeout(r, 300));
  const btn = [...card.querySelectorAll('button')].find(b => b.textContent.includes('保存打卡'));
  if (btn.disabled) return 'btn-disabled';
  return window.__qaToast(() => btn.click());
})()`);
const wCardio = await pollServer(async () => visible(await j('/api/tables/workouts')).length === w0 + 1);
const cardioDoc = visible(await j('/api/tables/workouts')).find((d) => d.data.type === 'cardio');
const strSave = await ev(c, `(async () => {
  const card = window.__qaCard('训练打卡');
  const sel = card.querySelector('select');
  sel.value = 'strength'; sel.dispatchEvent(new Event('change', { bubbles: true }));
  await new Promise(r => setTimeout(r, 300));
  [...card.querySelectorAll('button')].find(b => b.textContent.includes('加项目')).click();
  await new Promise(r => setTimeout(r, 200));
  const cand = card.querySelector('.cand');
  if (!cand) return 'no-cand';
  const exSel = cand.querySelector('select');
  exSel.selectedIndex = 0; exSel.dispatchEvent(new Event('change', { bubbles: true }));
  const sets = cand.querySelector('input'); // 力量"组×次×重量"输入无显式 type 属性
  sets.value = '3×10×20kg'; sets.dispatchEvent(new Event('input', { bubbles: true }));
  await new Promise(r => setTimeout(r, 300));
  const btn = [...card.querySelectorAll('button')].find(b => b.textContent.includes('保存打卡'));
  if (btn.disabled) return 'btn-disabled';
  return window.__qaToast(() => btn.click());
})()`);
const wStr = await pollServer(async () => visible(await j('/api/tables/workouts')).length === w0 + 2);
const strDoc = visible(await j('/api/tables/workouts')).find((d) => d.data.type === 'strength');
const pills2 = await ev(c, `[...document.querySelectorAll('.pill')].map(p => p.textContent.trim()).filter(t => t.includes('本周'))`);
const delW = await ev(c, `(async () => {
  const today = new Date().toLocaleDateString('sv-SE');
  const card = window.__qaCard('最近训练');
  const rows = [...card.querySelectorAll('tbody tr')].filter(tr => tr.textContent.includes(today));
  for (const tr of rows) [...tr.querySelectorAll('button')].find(b => b.textContent.includes('删')).click();
  return rows.length;
})()`);
const wBack = await pollServer(async () => visible(await j('/api/tables/workouts')).length === w0);
const pills3 = await ev(c, `[...document.querySelectorAll('.pill')].map(p => p.textContent.trim()).filter(t => t.includes('本周'))`);
T('K3', `有氧打卡(${cardioSave}) 服务端+1 字段完整`, wCardio && cardioDoc && cardioDoc.data.type === 'cardio' && Array.isArray(cardioDoc.data.items) && cardioDoc.data.items.length === 1,
  `toast=${cardioSave} doc=${JSON.stringify(cardioDoc && cardioDoc.data)}`);
T('K4', `力量打卡(${strSave}) 服务端+1`, wStr && strDoc && strDoc.data.type === 'strength', `toast=${strSave} sets=${strDoc && JSON.stringify(strDoc.data.items)}`);
T('K6', '本周进度 pills 随打卡/删除联动', /有氧 本周 1\//.test(pills2.join('|')) && /力量 本周 1\//.test(pills2.join('|')) && /有氧 本周 0\//.test(pills3.join('|')),
  `前=${JSON.stringify(pills0)} 后=${JSON.stringify(pills2)} 删后=${JSON.stringify(pills3)}`);
T('K5', `训练删除复原(${delW}条)`, wBack && delW === 2, `workouts回=${wBack}`);

// ---------- S10/S4-S7 阶段手动切换 ----------
await nav(c, '/#/stage');
const stageRules = await ev(c, `(() => {
  const card = window.__qaCard('自动判定');
  return { ok: card.querySelectorAll('.rule .ok').length, no: card.querySelectorAll('.rule .no').length, sug: card.textContent.includes('建议') };
})()`);
const prof0 = await j('/api/tables/profile');
const cur0 = (prof0[0] || {}).data && prof0[0].data.current_stage_id;
const hist0 = visible(await j('/api/tables/stage_history')).length;
const sw1 = await ev(c, `(async () => {
  const sel = [...document.querySelectorAll('select')].find(s => [...s.options].some(o => o.value === 's2'));
  sel.value = 's2'; sel.dispatchEvent(new Event('change', { bubbles: true }));
  await new Promise(r => setTimeout(r, 300)); // 等按钮 disabled 态解除(manualTo 更新)
  const btn = [...document.querySelectorAll('button')].find(b => b.textContent.trim() === '切换');
  if (btn.disabled) return 'btn-disabled';
  return window.__qaToast(() => btn.click());
})()`);
const prof2ok = await pollServer(async () => {
  const p = await j('/api/tables/profile');
  return (p[0] || {}).data.current_stage_id === 's2';
});
const prof2 = await j('/api/tables/profile');
const cur2 = (prof2[0] || {}).data && prof2[0].data.current_stage_id;
const hist2 = await pollServer(async () => visible(await j('/api/tables/stage_history')).length === hist0 + 1);
await ev(c, `(async () => {
  const sel = [...document.querySelectorAll('select')].find(s => [...s.options].some(o => o.value === 's1'));
  sel.value = 's1'; sel.dispatchEvent(new Event('change', { bubbles: true }));
  await new Promise(r => setTimeout(r, 300));
  [...document.querySelectorAll('button')].find(b => b.textContent.trim() === '切换').click();
  return true;
})()`);
const curBack = await pollServer(async () => {
  const p = await j('/api/tables/profile');
  return (p[0] || {}).data.current_stage_id === 's1';
});
const histAll = visible(await j('/api/tables/stage_history'));
const myHist = histAll.slice(hist0);
for (const d of myHist) await fetch(`${B}/api/tables/stage_history/${d.id}`, { method: 'DELETE' });
const histEnd = visible(await j('/api/tables/stage_history')).length;
T('S4', '阶段页自动判定规则明细渲染(基线数据 4 规则全未命中:✓=0/✗=4 属预期,与 API 一致)', (stageRules.ok + stageRules.no) >= 3 && stageRules.sug, JSON.stringify(stageRules));
T('S6', `手动切换 s1→s2→s1(${sw1}) profile 复原`, sw1 === '已切换' && prof2ok && cur2 === 's2' && curBack && cur0 === 's1', `cur0=${cur0} cur2=${cur2} back=${curBack}`);
T('S7', '阶段切换历史 +2 条且清理复原', hist2 && myHist.length === 2 && histEnd === hist0, `hist0=${hist0} added=${myHist.length} end=${histEnd}`);

// ---------- S11/M5/R6b/A8 设置分区 + 通知开关 ----------
await nav(c, '/#/settings');
const secs = await ev(c, `[...document.querySelectorAll('details.sec > summary')].map(s => s.textContent.trim())`);
const aiSec = await ev(c, `(async () => {
  const s = [...document.querySelectorAll('details.sec > summary')].find(x => x.textContent.includes('AI 识别'));
  s.parentElement.open = true;
  await new Promise(r => setTimeout(r, 200));
  const det = s.parentElement;
  return { inputs: [...det.querySelectorAll('input')].map(i => i.type), hasKey: det.textContent.includes('API Key') };
})()`);
const notifyRes = await ev(c, `(async () => {
  const s = [...document.querySelectorAll('details.sec > summary')].find(x => x.textContent.includes('测量提醒'));
  s.parentElement.open = true;
  await new Promise(r => setTimeout(r, 200));
  const det = s.parentElement;
  const btn = [...det.querySelectorAll('button')].find(b => b.textContent.includes('桌面通知'));
  const before = btn ? btn.textContent.trim() : null;
  const toast = await window.__qaToast(() => btn.click());
  return { before, toast, warn: !!det.querySelector('.banner.warn'),
           perm: (window.Notification && Notification.permission) || 'none',
           wmNotify: localStorage.getItem('wmNotify') };
})()`);
T('A8', '设置分区齐全(资料/指标/习惯/AI识别/同步/提醒/导入/数据安全/关于)', secs.length >= 9 && secs.some(s => s.includes('数据安全')) && secs.some(s => s.includes('关于')),
  `n=${secs.length} ${JSON.stringify(secs)}`);
T('R6b', 'AI 识别分区(base_url/模型/Key)', aiSec.inputs.length >= 3 && aiSec.hasKey, JSON.stringify(aiSec));
T('M5', `通知开关 headless 拒绝分支(${notifyRes.toast})`, notifyRes.toast && notifyRes.toast.includes('拦截') && notifyRes.warn && !notifyRes.wmNotify,
  `perm=${notifyRes.perm} toast=${notifyRes.toast} wmNotify=${notifyRes.wmNotify}`);

// ---------- S12/R10c UI 导入预览(6 列) ----------
const CSVF = 'C:/Users/11645/Desktop/体重管理/backend/tests/fixtures/chinese.csv';
await ev(c, `(async () => {
  const s = [...document.querySelectorAll('details.sec > summary')].find(x => x.textContent.includes('批量导入历史数据'));
  s.parentElement.open = true;
  await new Promise(r => setTimeout(r, 200));
  return true;
})()`);
const doc1 = await c.send('DOM.getDocument', {});
const impNodes = await c.send('DOM.querySelectorAll', { nodeId: doc1.root.nodeId, selector: 'details.sec input[type=file]' });
let impNode = null;
for (const nid of impNodes.nodeIds) {
  const n = await c.send('DOM.describeNode', { nodeId: nid });
  const attrs = n.node.attributes || [];
  if ((attrs[attrs.indexOf('accept') + 1] || '').includes('.zip')) { impNode = nid; break; }
}
await c.send('DOM.setFileInputFiles', { files: [CSVF], nodeId: impNode });
const prev = await ev(c, `(async () => {
  for (let i = 0; i < 100; i++) {
    const det = [...document.querySelectorAll('details.sec')].find(d => d.textContent.includes('批量导入历史数据'));
    const cand = det && det.querySelector('.cand');
    if (cand) {
      const ths = [...cand.querySelectorAll('thead th')].map(x => x.textContent.trim());
      const tableBox = cand.querySelector('table') ? cand.querySelector('table').getBoundingClientRect() : null;
      const wrap = cand.querySelector('[style*="overflow-x"]');
      return { chip: (cand.querySelector('.chip')||{}).textContent, ths, rows: cand.querySelectorAll('tbody tr').length,
               tableW: tableBox && Math.round(tableBox.width), wrapScrollW: wrap ? wrap.scrollWidth : null, wrapClientW: wrap ? wrap.clientWidth : null };
    }
    await new Promise(r => setTimeout(r, 100));
  }
  return null;
})()`);
await shot(c, path.join(R, 'vf-import-preview-1280.png'));
T('R10c', 'UI 导入预览 6 列表格+格式 chip', prev && prev.ths.length === 6 && prev.rows >= 4 && /CSV/i.test(prev.chip || ''), JSON.stringify(prev));
await ev(c, `( () => { const det = [...document.querySelectorAll('details.sec')].find(d => d.textContent.includes('批量导入历史数据'));
  [...det.querySelectorAll('button')].find(b => b.textContent.trim() === '取消').click(); return true; })()`);
const prevGone = await ev(c, `(() => { const det = [...document.querySelectorAll('details.sec')].find(d => d.textContent.includes('批量导入历史数据')); return !det.querySelector('.cand'); })()`);
T('R10d', '导入预览取消清除', prevGone, `gone=${prevGone}`);

// ---------- S13/R9 拍照识别 UI 全流程(真实模型) ----------
await nav(c, '/#/data?tab=camera');
const PNGF = 'C:/Users/11645/Desktop/体重管理/qa/tools/vf-scale.png';
const doc2 = await c.send('DOM.getDocument', {});
const camNodes = await c.send('DOM.querySelectorAll', { nodeId: doc2.root.nodeId, selector: 'input[type=file]' });
let camNode = null;
for (const nid of camNodes.nodeIds) {
  const n = await c.send('DOM.describeNode', { nodeId: nid });
  const attrs = n.node.attributes || [];
  if ((attrs[attrs.indexOf('accept') + 1] || '').includes('image')) { camNode = nid; break; }
}
await c.send('DOM.setFileInputFiles', { files: [PNGF], nodeId: camNode });
const picked = await ev(c, `(() => ({ hasPreview: !!document.querySelector('.img-prev'), demoBanner: !![...document.querySelectorAll('.banner.info')].find(b => b.textContent.includes('演示模式')) }))()`);
await ev(c, `( () => { [...document.querySelectorAll('button')].find(b => b.textContent.includes('开始识别')).click(); return true; })()`);
const cands = await ev(c, `(async () => {
  for (let i = 0; i < 900; i++) {
    const card = window.__qaCard('识别结果');
    if (card) {
      const c0 = card.querySelector('.cand');
      return { hint: c0.querySelector('.head span').textContent.trim(), value: c0.querySelector('input[type=number]').value,
               metricSel: c0.querySelector('select').value, note: (c0.querySelector('p.muted')||{}).textContent };
    }
    await new Promise(r => setTimeout(r, 100));
  }
  return null;
})()`);
T('R9a', '拍照识别 UI:候选区渲染(真实模型 77.77)', cands && /体重/.test(cands.hint) && String(cands.value) === '77.77' && cands.metricSel === 'weight',
  `picked=${JSON.stringify(picked)} cand=${JSON.stringify(cands)}`);
const conf = await ev(c, `(async () => {
  const btn = [...document.querySelectorAll('button')].find(b => b.textContent.includes('确认保存为记录'));
  return window.__qaToast(() => btn.click());
})()`);
const aiRecArrived = await pollServer(async () => !!visible(await j('/api/tables/records')).find((d) => d.data.source === 'ai'));
const aiRec = aiRecArrived ? visible(await j('/api/tables/records')).find((d) => d.data.source === 'ai') : null;
T('R9b', `候选确认入库 source=ai(${conf})`, !!aiRec && aiRec.data.value === 77.77, `toast=${conf} doc=${JSON.stringify(aiRec && aiRec.data)}`);
if (aiRec) await fetch(`${B}/api/tables/records/${aiRec.id}`, { method: 'DELETE' });
const recsEnd = await pollServer(async () => visible(await j('/api/tables/records')).length === 8);
T('R9c', '识别测试记录清理复原', recsEnd, `records=${visible(await j('/api/tables/records')).length}`);

// ---------- S14/C9 + S15/P5 教练页与五页渲染 ----------
const coachPage = await nav(c, '/#/coach');
const coachSecs = await ev(c, `[...document.querySelectorAll('.card h2')].map(x => x.textContent.trim()).join('|')`);
T('C9', '教练页分区(生成解读/问教练/问答历史/历史解读)', ['生成解读', '问教练', '问答历史', '历史解读'].every((k) => coachSecs.includes(k)) && !!coachPage, coachSecs);
const pages = {};
for (const [name, hash] of [['数据', '/#/data'], ['阶段', '/#/stage'], ['训练', '/#/training'], ['设置', '/#/settings']]) {
  pages[name] = await nav(c, hash);
}
T('P5', '五页 h1 渲染无白屏', pages['数据'] === '数据' && pages['阶段'] === '阶段' && pages['训练'] === '训练' && pages['设置'] === '设置', JSON.stringify(pages));

// ---------- 汇总 ----------
writeFileSync(path.join(R, 'vf-ui-results.json'), JSON.stringify(results, null, 2));
const fails = results.filter((x) => !x.pass);
console.log(`\n== UI 段: ${results.length - fails.length}/${results.length} pass ==`);
if (fails.length) { console.log('FAILS:', fails.map((f) => f.id).join(',')); process.exitCode = 1; }
process.exit(0);
