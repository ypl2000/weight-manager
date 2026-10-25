// 迭代4 QA 补测:通知开关点击的 toast 文案(用 #toast 正确选择器;先拒绝始态,再同会话 CDP 授权)
import { ensureChrome, connect, ev, waitForAppReady, sleep } from './cdp.mjs';
const B = 'http://127.0.0.1:8000';
await ensureChrome();
const c = await connect();
await ev(c, `location.href = '${B}/#/settings'`);
await sleep(1500);
await waitForAppReady(c);
await ev(c, `location.reload()`);
await sleep(1500);
await waitForAppReady(c);
const r1 = await ev(c, `(async () => {
  const details = [...document.querySelectorAll('.settings-page details.sec')].find(d => d.querySelector('summary')?.textContent.includes('测量提醒'));
  const sum = details.querySelector('summary');
  if (!details.open) sum.click();
  await new Promise(r => setTimeout(r, 300));
  const btn = [...details.querySelectorAll('button')].find(b => b.textContent.includes('桌面通知'));
  const grabToast = () => document.querySelector('#toast')?.textContent.trim() || '';
  const permNow = Notification.permission;
  btn.click();
  let openToast = '';
  for (let i = 0; i < 30; i++) { openToast = grabToast(); if (openToast) break; await new Promise(r => setTimeout(r, 100)); }
  const after = { perm: Notification.permission, wmNotify: localStorage.getItem('wmNotify'), btnText: btn.textContent.trim() };
  return { permNow, openToast, after };
})()`);
console.log('denied-path:', JSON.stringify(r1));
await sleep(2400); // 等 toast 消失

// 同一会话内 CDP 授权(Node 侧发送)→ 再点开启 → 拿"桌面通知已开启"文案
let r2 = null;
try {
  await c.send('Browser.grantPermissions', { permissions: ['notifications'], origin: B });
  r2 = await ev(c, `(async () => {
    const details = [...document.querySelectorAll('.settings-page details.sec')].find(d => d.querySelector('summary')?.textContent.includes('测量提醒'));
    const btn = [...details.querySelectorAll('button')].find(b => b.textContent.includes('桌面通知'));
    if (Notification.permission !== 'granted') return { err: 'perm not granted: ' + Notification.permission };
    btn.click();
    let t = '';
    for (let i = 0; i < 30; i++) { t = document.querySelector('#toast')?.textContent.trim() || ''; if (t) break; await new Promise(r => setTimeout(r, 100)); }
    const out = { toast: t, perm: Notification.permission, wmNotify: localStorage.getItem('wmNotify'), btnText: btn.textContent.trim() };
    // 再点一次关闭 → "桌面通知已关闭"
    await new Promise(r => setTimeout(r, 2400));
    btn.click();
    let t2 = '';
    for (let i = 0; i < 30; i++) { t2 = document.querySelector('#toast')?.textContent.trim() || ''; if (t2) break; await new Promise(r => setTimeout(r, 100)); }
    out.closeToast = t2;
    out.afterClose = { perm: Notification.permission, wmNotify: localStorage.getItem('wmNotify'), btnText: btn.textContent.trim() };
    return out;
  })()`);
} catch (e) { r2 = { err: 'grant-failed: ' + e.message }; }
console.log('granted-path:', JSON.stringify(r2));
// 清理 QA 档案标记
await ev(c, `localStorage.removeItem('wmNotify'); localStorage.removeItem('wmNotified_weight'); 'cleaned'`);
process.exit(0);
