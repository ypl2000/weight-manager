// 迭代3-3b:重拍 iter3-coach-ask.png(问教练卡 + 问答历史同框,整页截图)
// 注:测试问答已在 3-3 步骤删除,本图问答历史为基线条目;问教练卡保留上次问答的输入与回答。
import { ensureChrome, connect, ev, goto, waitForAppReady, shot, sleep } from './cdp.mjs';

const R = 'C:/Users/11645/Desktop/体重管理/qa/reports/';
await ensureChrome();
const c = await connect();

const title = await goto(c, 'http://127.0.0.1:8000/#/coach');
await waitForAppReady(c);
await sleep(1000); // 等数据从服务端同步
console.log('TITLE ' + title);

const state = await ev(c, `(async () => {
  const secs = [...document.querySelectorAll('section.card')];
  const ask = secs.find(s => s.querySelector('h2') && s.querySelector('h2').textContent.includes('问教练'));
  const qaHist = secs.find(s => s.querySelector('h2') && s.querySelector('h2').textContent.includes('问答历史'));
  if (!ask || !qaHist) return { ok: false, body: document.body.innerText.slice(0, 200) };
  // 展开问答历史第一条,让回答入镜
  const first = qaHist.querySelector('.hist-item .hist-head');
  if (first && !qaHist.querySelector('.hist-item .report')) first.click();
  await new Promise(r => setTimeout(r, 300));
  ask.scrollIntoView({ block: 'start' });
  return {
    ok: true,
    askHead: ask.querySelector('h2').textContent.trim(),
    qaHistItems: qaHist.querySelectorAll('.hist-item').length,
  };
})()`);
console.log('STATE ' + JSON.stringify(state));
await sleep(400);

// 整页截图(captureBeyondViewport):问教练卡 + 问答历史同框
const r = await c.send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: true });
const { writeFileSync } = await import('node:fs');
writeFileSync(R + 'iter3-coach-ask.png', Buffer.from(r.data, 'base64'));
console.log('SAVED iter3-coach-ask.png (full page)');
process.exit(0);
