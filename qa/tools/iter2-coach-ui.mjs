// 迭代2-6:教练页 UI 验证
// 今日页入口卡 → #/coach 初始态(截图) → 历史展开 → 真点"生成"验证流式渲染 → UI 删除本次生成
import { ensureChrome, connect, ev, goto, shot, sleep } from './cdp.mjs';

const R = 'C:/Users/11645/Desktop/体重管理/qa/reports/';
const out = {};
await ensureChrome();
const c = await connect();

// ---- 1) 今日页入口卡 ----
out.today = await goto(c, 'http://127.0.0.1:8000/#/');
out.entryCard = await ev(c, `(async () => {
  for (let i = 0; i < 80; i++) {
    const el = [...document.querySelectorAll('section')].find(s => s.textContent.includes('AI 教练解读'));
    if (el) {
      const a = el.querySelector('a[href*="coach"], a[href*="/coach"]');
      return { found: true, text: el.innerText.replace(/\\s+/g, ' ').slice(0, 120), href: a ? a.getAttribute('href') : null };
    }
    await new Promise(r => setTimeout(r, 100));
  }
  return { found: false };
})()`);
await shot(c, R + 'iter2-today-entry.png');

// ---- 2) 教练页初始态 ----
out.coachTitle = await goto(c, 'http://127.0.0.1:8000/#/coach');
out.coachInitial = await ev(c, `(async () => {
  for (let i = 0; i < 80; i++) {
    const h1 = document.querySelector('.page-head h1');
    if (h1 && h1.textContent.includes('AI 教练')) {
      const genBtn = [...document.querySelectorAll('button')].find(b => b.textContent.includes('生成 AI 解读'));
      const chips = [...document.querySelectorAll('button')].filter(b => /^近\\d+天$/.test(b.textContent.trim())).map(b => b.textContent.trim());
      const hist = document.querySelectorAll('.hist-item').length;
      const offlineBanner = [...document.querySelectorAll('p')].some(p => p.textContent.includes('当前离线'));
      return { h1: h1.textContent.trim(), genBtnText: genBtn ? genBtn.textContent.trim() : null, genBtnDisabled: genBtn ? genBtn.disabled : null, chips, histItems: hist, offlineBanner, sub: (document.querySelector('.page-head .sub') || {}).textContent };
    }
    await new Promise(r => setTimeout(r, 100));
  }
  return { found: false, body: document.body.innerText.slice(0, 200) };
})()`);
await shot(c, R + 'iter2-coach-page.png');

// ---- 3) 展开最新历史(应为 API 步骤生成的 days=7 报告) ----
out.histExpand = await ev(c, `(async () => {
  const items = [...document.querySelectorAll('.hist-item')];
  if (!items.length) return { found: false };
  const head = items[0].querySelector('.hist-head');
  const label = head ? head.textContent.replace(/\\s+/g, ' ').slice(0, 80) : '';
  head.click();
  for (let i = 0; i < 20; i++) {
    await new Promise(r => setTimeout(r, 100));
    const body = items[0].innerText;
    if (body.includes('趋势解读') || body.length > label.length + 50) {
      return { found: true, headLabel: label, expandedLen: body.length, hasSections: ['趋势解读','亮点','风险','下周建议'].map(s => body.includes(s)) };
    }
  }
  return { found: true, headLabel: label, expanded: false };
})()`);

// ---- 4) 真点"生成 AI 解读",验证流式渲染 ----
out.gen = await ev(c, `(async () => {
  const btn = [...document.querySelectorAll('button')].find(b => b.textContent.includes('生成 AI 解读'));
  if (!btn) return { btn: false };
  window.confirm = () => true;   // 便于后续删除步骤
  btn.click();
  const t0 = Date.now();
  let firstLen = null, firstAt = null, lastLen = 0, snaps = [];
  while (Date.now() - t0 < 90000) {
    const box = document.querySelector('.report');
    const len = box ? box.innerText.length : 0;
    const busy = [...document.querySelectorAll('button')].some(b => b.textContent.includes('生成中'));
    if (len > 0 && firstLen === null) { firstLen = len; firstAt = Date.now() - t0; }
    if (len > 0 && len !== lastLen) { snaps.push({ t: Date.now() - t0, len }); lastLen = len; }
    if (!busy && len > 0 && snaps.length > 1 && Date.now() - t0 > 3000) break;
    if (!busy && len === 0 && Date.now() - t0 > 5000) return { btn: true, stalled: true, err: (document.querySelector('.page') || {}).innerText?.slice(0, 300) };
    await new Promise(r => setTimeout(r, 250));
  }
  const box = document.querySelector('.report');
  return {
    btn: true,
    firstDeltaMs: firstAt, firstLen,
    snapCount: snaps.length,
    growthProof: [snaps[0], snaps[Math.floor(snaps.length / 2)], snaps[snaps.length - 1]],
    finalLen: box ? box.innerText.length : 0,
    finalHead: box ? box.innerText.slice(0, 80) : '',
    sections: ['趋势解读','亮点','风险','下周建议'].map(s => box ? box.innerText.includes(s) : false),
  };
})()`);
await sleep(1500); // 等归档+历史刷新按钮可用

// ---- 5) 历史列表 +1,刷新后可见新报告;然后 UI 删除它 ----
out.afterGen = await ev(c, `(async () => {
  const refresh = [...document.querySelectorAll('button')].find(b => b.textContent.includes('刷新'));
  if (refresh) refresh.click();
  for (let i = 0; i < 50; i++) {
    await new Promise(r => setTimeout(r, 100));
    const n = document.querySelectorAll('.hist-item').length;
    if (n >= 1) {
      const first = document.querySelector('.hist-item .hist-head');
      return { histItems: n, firstHead: first ? first.textContent.replace(/\\s+/g, ' ').slice(0, 90) : '' };
    }
  }
  return { histItems: 0 };
})()`);

out.uiDelete = await ev(c, `(async () => {
  const first = document.querySelector('.hist-item');
  if (!first) return { deleted: false, reason: 'no item' };
  const before = first.innerText.slice(0, 60);
  const del = [...first.querySelectorAll('button')].find(b => b.textContent.trim() === '删');
  if (!del) return { deleted: false, reason: 'no del btn' };
  del.click();   // window.confirm 已在生成步骤被覆写为 true
  for (let i = 0; i < 50; i++) {
    await new Promise(r => setTimeout(r, 100));
    if (!document.body.innerText.includes(before.slice(0, 30))) break;
  }
  return { deleted: true, removedHead: before, histNow: document.querySelectorAll('.hist-item').length, toast: (document.querySelector('#toast') || {}).textContent };
})()`);

console.log(JSON.stringify(out, null, 1));
process.exit(0);
