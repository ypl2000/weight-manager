// 迭代3-3:UI 验证(今日页智能提示卡 / 教练页问教练卡+问答历史 / 真点提问流式渲染 / UI 删除)
// 截图:qa/reports/iter3-insights-card.png、iter3-coach-ask.png
import { ensureChrome, connect, ev, goto, shot, sleep } from './cdp.mjs';

const R = 'C:/Users/11645/Desktop/体重管理/qa/reports/';
const out = {};
await ensureChrome();
const c = await connect();

// ---- 1) 今日页:智能提示卡(蛋白质目标 124g) ----
out.todayTitle = await goto(c, 'http://127.0.0.1:8000/#/');
out.insightsCard = await ev(c, `(async () => {
  for (let i = 0; i < 100; i++) {
    const sec = [...document.querySelectorAll('section.card')].find(s => s.querySelector('h2') && s.querySelector('h2').textContent.includes('智能提示'));
    if (sec) {
      sec.scrollIntoView({ block: 'center' });
      const num = sec.querySelector('.protein-num');
      const pill = sec.querySelector('.pill');
      const note = [...sec.querySelectorAll('p.muted')].map(p => p.textContent.trim());
      const banners = [...sec.querySelectorAll('.banner')].map(b => b.innerText.replace(/\\s+/g, ' ').slice(0, 60));
      return {
        found: true,
        h2: sec.querySelector('h2').textContent.trim(),
        proteinH3: !!sec.querySelector('h3') && sec.querySelector('h3').textContent.includes('今日蛋白质目标'),
        targetG: num ? num.textContent.trim() : null,
        unitText: sec.querySelector('.protein-line span') ? sec.querySelector('.protein-line span').innerText.replace(/\\s+/g, ' ') : '',
        foodHint: pill ? pill.textContent.trim() : null,
        note, banners,
      };
    }
    await new Promise(r => setTimeout(r, 100));
  }
  return { found: false, body: document.body.innerText.slice(0, 300) };
})()`);
await sleep(400);
await shot(c, R + 'iter3-insights-card.png');

// ---- 2) 教练页:问教练卡 + 问答历史初始态 ----
out.coachTitle = await goto(c, 'http://127.0.0.1:8000/#/coach');
out.coachCards = await ev(c, `(async () => {
  for (let i = 0; i < 100; i++) {
    const secs = [...document.querySelectorAll('section.card')];
    const ask = secs.find(s => s.querySelector('h2') && s.querySelector('h2').textContent.includes('问教练'));
    const qaHist = secs.find(s => s.querySelector('h2') && s.querySelector('h2').textContent.includes('问答历史'));
    if (ask && qaHist) {
      const ta = ask.querySelector('textarea');
      const btn = [...ask.querySelectorAll('button')].find(b => b.textContent.includes('提问'));
      const items = [...qaHist.querySelectorAll('.hist-item')];
      return {
        askCard: true, hasTextarea: !!ta, placeholder: ta ? ta.placeholder : null,
        btnText: btn ? btn.textContent.trim() : null, btnDisabled: btn ? btn.disabled : null,
        qaHistCard: true, histItems: items.length,
        firstQ: items[0] ? (items[0].querySelector('.q-text') || {}).textContent : null,
      };
    }
    await new Promise(r => setTimeout(r, 100));
  }
  return { found: false };
})()`);

// ---- 3) 真点"提问":输入知识库内问题,验证流式渲染 ----
out.uiAsk = await ev(c, `(async () => {
  const secs = [...document.querySelectorAll('section.card')];
  const ask = secs.find(s => s.querySelector('h2') && s.querySelector('h2').textContent.includes('问教练'));
  const ta = ask.querySelector('textarea');
  const btn = [...ask.querySelectorAll('button')].find(b => b.textContent.includes('提问'));
  const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set;
  setter.call(ta, '平台期怎么办');
  ta.dispatchEvent(new Event('input', { bubbles: true }));
  window.confirm = () => true; // 便于后续删除
  const t0 = Date.now();
  btn.click();
  let firstLen = null, firstAt = null, lastLen = 0, snaps = [], busySeen = false;
  while (Date.now() - t0 < 100000) {
    const box = ask.querySelector('.report');
    const len = box ? box.innerText.length : 0;
    const busy = [...ask.querySelectorAll('button')].some(b => b.textContent.includes('思考中'));
    if (busy) busySeen = true;
    if (len > 0 && firstLen === null) { firstLen = len; firstAt = Date.now() - t0; }
    if (len > 0 && len !== lastLen) { snaps.push({ t: Date.now() - t0, len }); lastLen = len; }
    if (busySeen && !busy && snaps.length > 1) break;
    if (!busy && !busySeen && Date.now() - t0 > 8000) {
      const err = ask.querySelector('.banner.warn');
      return { asked: true, stalled: true, err: err ? err.textContent : null };
    }
    await new Promise(r => setTimeout(r, 250));
  }
  const box = ask.querySelector('.report');
  const txt = box ? box.innerText : '';
  return {
    asked: true, busySeen,
    firstDeltaMs: firstAt, snapCount: snaps.length,
    growthProof: [snaps[0], snaps[Math.floor(snaps.length / 2)], snaps[snaps.length - 1]],
    finalLen: txt.length, finalHead: txt.slice(0, 100),
    citesKB: txt.includes('知识库'),
    btnBackToNormal: [...ask.querySelectorAll('button')].some(b => b.textContent.trim() === '提问'),
  };
})()`);
await sleep(1500);

// ---- 4) 问答历史刷新后 +1,截图(问教练卡含答案 + 问答历史) ----
out.histAfter = await ev(c, `(async () => {
  const secs = [...document.querySelectorAll('section.card')];
  const qaHist = secs.find(s => s.querySelector('h2') && s.querySelector('h2').textContent.includes('问答历史'));
  const refresh = [...qaHist.querySelectorAll('button')].find(b => b.textContent.includes('刷新'));
  if (refresh) refresh.click();
  for (let i = 0; i < 50; i++) {
    await new Promise(r => setTimeout(r, 100));
    const items = [...qaHist.querySelectorAll('.hist-item')];
    if (items.length >= 2) {
      const qs = items.map(it => ((it.querySelector('.q-text') || {}).textContent || '').slice(0, 40));
      return { histItems: items.length, questions: qs };
    }
  }
  return { histItems: qaHist.querySelectorAll('.hist-item').length };
})()`);
// 展开新问答使其入镜
await ev(c, `(async () => {
  const secs = [...document.querySelectorAll('section.card')];
  const qaHist = secs.find(s => s.querySelector('h2') && s.querySelector('h2').textContent.includes('问答历史'));
  const item = [...qaHist.querySelectorAll('.hist-item')].find(it => it.textContent.includes('平台期怎么办'));
  if (item) { item.querySelector('.hist-head').click(); await new Promise(r => setTimeout(r, 300)); }
})()`);
const askSec = await ev(c, `(() => {
  const secs = [...document.querySelectorAll('section.card')];
  const ask = secs.find(s => s.querySelector('h2') && s.querySelector('h2').textContent.includes('问教练'));
  ask.scrollIntoView({ block: 'start' });
  return true;
})()`);
await sleep(400);
await shot(c, R + 'iter3-coach-ask.png');

// ---- 5) UI 删除本次测试问答,服务端回到基线 1 条 ----
out.uiDelete = await ev(c, `(async () => {
  const secs = [...document.querySelectorAll('section.card')];
  const qaHist = secs.find(s => s.querySelector('h2') && s.querySelector('h2').textContent.includes('问答历史'));
  const item = [...qaHist.querySelectorAll('.hist-item')].find(it => it.textContent.includes('平台期怎么办'));
  if (!item) return { deleted: false, reason: 'no item' };
  const del = [...item.querySelectorAll('button')].find(b => b.textContent.trim() === '删');
  if (!del) return { deleted: false, reason: 'no del btn' };
  del.click(); // confirm 已覆写
  for (let i = 0; i < 50; i++) {
    await new Promise(r => setTimeout(r, 100));
    if (!qaHist.innerText.includes('平台期怎么办')) break;
  }
  return { deleted: true, histNow: qaHist.querySelectorAll('.hist-item').length };
})()`);

// 服务端核对
await sleep(2500);
const server = await fetch('http://127.0.0.1:8000/api/tables/coach_qa').then((r) => r.json());
const vis = server.filter((d) => !d.deleted);
out.serverAfter = { visible: vis.length, ids: vis.map((d) => d.id) };

console.log(JSON.stringify(out, null, 1));
process.exit(0);
