// 迭代4 QA:UI 层验证(Chrome headless CDP)
// 1) 今日页提醒横幅(真实数据:体重 due → 显示;腰围 not due → 不显示)
// 2) 宽屏 ≥1024: .page 1080 / .cols 双列 / 底栏悬浮胶囊居中;900 与 414 保持旧单列;1023/1024 边界
// 3) 设置页两列 + 测量提醒(桌面通知)分区 + requestPermission 真点(headless 如实记录)
// 4) 顺带回归 a1/a2/b1/b3:UI 录入 77.77 → 服务端 ≤3s 可见 → UI 删除 → 服务端墓碑
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { ensureChrome, connect, ev, goto, waitForAppReady, sleep } from './cdp.mjs';

const B = 'http://127.0.0.1:8000';
const OUT = new URL('../reports/', import.meta.url).pathname; // not used directly for write
const outDir = fileURLToPath(new URL('../reports/', import.meta.url));
const out = { viewportChecks: {} };
const flags = {};

await ensureChrome();
const c = await connect();

async function setViewport(width, height, mobile = false) {
  await c.send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile });
  await ev(c, `location.reload()`);
  await sleep(1200);
  await waitForAppReady(c);
}
async function shotFull(file) {
  const r = await c.send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: true });
  writeFileSync(outDir + file, Buffer.from(r.data, 'base64'));
  return file;
}
const goHash = async (hash, title) => {
  await ev(c, `location.hash = '${hash}'`);
  for (let i = 0; i < 60; i++) {
    const h = await ev(c, `document.querySelector('.page-head h1')?.textContent.trim() || ''`);
    if (h === title) break;
    await sleep(100);
  }
  await sleep(400);
};
const layout = () => ev(c, `(() => {
  const cs = (sel) => { const el = document.querySelector(sel); if (!el) return null; const s = getComputedStyle(el); const r = el.getBoundingClientRect(); return { display: s.display, maxWidth: s.maxWidth, borderRadius: s.borderRadius, transform: s.transform, boxShadow: s.boxShadow !== 'none', left: Math.round(r.left), top: Math.round(r.top), width: Math.round(r.width), height: Math.round(r.height), right: Math.round(r.right), bottom: Math.round(r.bottom), centerX: Math.round(r.left + r.width / 2) }; };
  const cols = document.querySelector('.cols');
  const colEls = [...document.querySelectorAll('.cols > .col')];
  const stacked = colEls.length >= 2 ? (colEls[1].getBoundingClientRect().top >= colEls[0].getBoundingClientRect().bottom - 2) : null;
  const sideBySide = colEls.length >= 2 ? (colEls[1].getBoundingClientRect().left >= colEls[0].getBoundingClientRect().right - 2) : null;
  const vw = document.documentElement.clientWidth;
  const tab = cs('.tabbar');
  return { vw, page: cs('.page'), cols: cols ? { display: getComputedStyle(cols).display, gtc: getComputedStyle(cols).gridTemplateColumns } : null, colCount: colEls.length, stacked, sideBySide, tabbar: tab, tabbarCentered: tab ? Math.abs(tab.centerX - vw / 2) <= 8 : null };
})()`);
const banners = () => ev(c, `[...document.querySelectorAll('.page > .banner.warn')].map(b => b.textContent.trim())`);
const waitBanners = async (wantWeight, timeout = 12000) => {
  const t0 = Date.now();
  for (;;) {
    const bs = await banners();
    const hasW = bs.some((t) => t.includes('该测体重了'));
    const hasWa = bs.some((t) => t.includes('该测腰围了'));
    if (hasW === wantWeight && !hasWa) return { ms: Date.now() - t0, banners: bs };
    if (Date.now() - t0 > timeout) return { timeout: true, banners: bs };
    await sleep(300);
  }
};

// ================= 1280 宽屏 =================
await setViewport(1280, 900);
out.pageTitle = await goto(c, B + '/#/');
out.todayH1 = await ev(c, `document.querySelector('.page-head h1')?.textContent.trim()`);
out.banner1280 = await waitBanners(true);
out.layout1280 = await layout();
await shotFull('iter4-desktop-1280.png');

// ---- 回归 a1/a2/b1:通过 #/data 录入 77.77(UI 全口径) ----
await goHash('#/data', '数据');
out.a1 = await ev(c, `(async () => {
  window.confirm = () => true;
  const tab = [...document.querySelectorAll('button,a')].find(b => b.textContent.trim() === '录入');
  if (tab) tab.click();
  await new Promise(r => setTimeout(r, 500));
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

// b1:服务端 3 秒内可见
let t0 = Date.now(), newId = null;
for (; Date.now() - t0 < 3000;) {
  const docs = await (await fetch(B + '/api/tables/records')).json();
  const hit = docs.find((d) => !d.deleted && d.data.value === 77.77);
  if (hit) { newId = hit.id; break; }
  await sleep(100);
}
out.b1 = newId ? { ok: true, ms: Date.now() - t0, id: newId } : { ok: false };

// ---- 今日页横幅消失(体重已录) ----
await goHash('#/', '今日');
out.bannerGone = await waitBanners(false);
out.layout1280NoBanner = await layout();

// ---- b3:UI 删除 → 服务端墓碑 ----
await goHash('#/data', '数据');
out.b3 = await ev(c, `(async () => {
  window.confirm = () => true;
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
let gone = false;
for (let i = 0; i < 80; i++) {
  const docs = await (await fetch(B + '/api/tables/records')).json();
  if (!docs.some((d) => d.id === newId)) { gone = true; break; }
  await sleep(100);
}
const pull = await (await fetch(B + '/api/sync', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ device: 'qa-iter4-pull', cursor: 0, changes: [] }) })).json();
out.b3server = { goneFromGet: gone, tombstone: !!(pull.changes || []).find((d) => d.id === newId && d.deleted) };

// ---- 横幅回归(体重删除后应重新出现) ----
await goHash('#/', '今日');
out.bannerBack = await waitBanners(true);

// ================= 900 平板(应保持旧单列) =================
await setViewport(900, 1000);
await goHash('#/', '今日');
out.layout900 = await layout();
out.banner900 = await banners();
await shotFull('iter4-tablet-900.png');

// ---- 1023/1024 边界 ----
for (const w of [1023, 1024]) {
  await c.send('Emulation.setDeviceMetricsOverride', { width: w, height: 900, deviceScaleFactor: 1, mobile: false });
  await sleep(600);
  out.viewportChecks['w' + w] = await ev(c, `(() => {
    const cols = document.querySelector('.cols');
    const page = document.querySelector('.page');
    return { vw: document.documentElement.clientWidth, colsDisplay: getComputedStyle(cols).display, pageMaxWidth: getComputedStyle(page).maxWidth };
  })()`);
}

// ================= 414 手机 =================
await setViewport(414, 896, true);
await goHash('#/', '今日');
out.layout414 = await layout();
out.banner414 = await banners();
await shotFull('iter4-mobile-414.png');

// ================= 设置页(1280 两列 + 桌面通知分区) =================
await setViewport(1280, 900);
await goHash('#/settings', '设置');
out.settings = await ev(c, `(async () => {
  window.confirm = () => true;
  const grid = getComputedStyle(document.querySelector('.settings-page'));
  const secs = [...document.querySelectorAll('.settings-page > details.sec')];
  // 展开"测量提醒(桌面通知)"分区
  const sum = [...document.querySelectorAll('.settings-page summary')].find(s => s.textContent.includes('测量提醒'));
  if (!sum) return { ok: false, why: 'no notify summary' };
  sum.click();
  await new Promise(r => setTimeout(r, 400));
  const details = sum.closest('details');
  const btn = [...details.querySelectorAll('button')].find(b => b.textContent.includes('桌面通知'));
  const bannerTexts = [...details.querySelectorAll('.banner')].map(b => b.textContent.trim());
  return {
    ok: !!btn,
    sectionTitle: sum.textContent.trim(),
    gridDisplay: grid.display, gridGTC: grid.gridTemplateColumns,
    secCount: secs.length,
    lastSecSpansFull: (() => { const s = getComputedStyle(secs[secs.length - 1]); return s.gridColumnStart === '1' && s.gridColumnEnd === '-1'; })(),
    btnText: btn ? btn.textContent.trim() : null,
    descSnippet: (details.querySelector('.body p.muted')?.textContent || '').slice(0, 60),
    preBanners: bannerTexts,
  };
})()`);
await shotFull('iter4-settings-notify.png');

// ---- 桌面通知:requestPermission 真点(headless 如实记录) ----
out.notify = await ev(c, `(async () => {
  const details = [...document.querySelectorAll('.settings-page details.sec')].find(d => d.querySelector('summary')?.textContent.includes('测量提醒'));
  const btn = [...details.querySelectorAll('button')].find(b => b.textContent.includes('桌面通知'));
  const permBefore = (typeof Notification !== 'undefined') ? Notification.permission : 'unsupported';
  btn.click();
  let toastTxt = '';
  for (let i = 0; i < 60; i++) {
    const t = document.querySelector('.toast, [class*=toast]');
    if (t && t.textContent.trim()) { toastTxt = t.textContent.trim(); break; }
    await new Promise(r => setTimeout(r, 100));
  }
  await new Promise(r => setTimeout(r, 300));
  const permAfter = (typeof Notification !== 'undefined') ? Notification.permission : 'unsupported';
  const bannersNow = [...details.querySelectorAll('.banner')].map(b => b.textContent.trim());
  return { permBefore, permAfter, toast: toastTxt, banners: bannersNow, wmNotify: localStorage.getItem('wmNotify'), btnText: btn.textContent.trim() };
})()`);

// headless 若默认拒绝 → 用 CDP Browser.grantPermissions 授予后再真点一次
if (out.notify.permAfter !== 'granted') {
  try {
    await c.send('Browser.grantPermissions', { permissions: ['notifications'], origin: B });
    out.notify.cdpGrant = 'applied';
  } catch (e) { out.notify.cdpGrant = 'failed: ' + e.message; }
  out.notify.grantedFlow = await ev(c, `(async () => {
    const details = [...document.querySelectorAll('.settings-page details.sec')].find(d => d.querySelector('summary')?.textContent.includes('测量提醒'));
    const btn = [...details.querySelectorAll('button')].find(b => b.textContent.includes('桌面通知'));
    const permBefore = Notification.permission;
    btn.click();
    let toastTxt = '';
    for (let i = 0; i < 60; i++) {
      const t = document.querySelector('.toast, [class*=toast]');
      if (t && t.textContent.trim()) { toastTxt = t.textContent.trim(); break; }
      await new Promise(r => setTimeout(r, 100));
    }
    await new Promise(r => setTimeout(r, 300));
    return { permBefore, permAfter: Notification.permission, toast: toastTxt, wmNotify: localStorage.getItem('wmNotify'), btnText: btn.textContent.trim(), banners: [...details.querySelectorAll('.banner')].map(b => b.textContent.trim()) };
  })()`);
}

// ---- App.vue 挂载即检查 + 每日去重:授权+开关开启状态下重载页面 ----
if (out.notify.wmNotify === '1' || (out.notify.grantedFlow || {}).wmNotify === '1') {
  await ev(c, `location.reload()`);
  await sleep(1500);
  await waitForAppReady(c);
  await sleep(2500); // 留出 onMounted 里 checkReminders 的 fetch 时间
  out.pollOnMount = await ev(c, `(() => ({
    wmNotify: localStorage.getItem('wmNotify'),
    notifiedWeight: localStorage.getItem('wmNotified_weight'),
    today: (() => { const d = new Date(); const p = n => String(n).padStart(2, '0'); return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate()); })(),
  }))()`);
  // 再重载一次验证同一指标当天不重复(键值保持今天不变即可)
  await ev(c, `location.reload()`);
  await sleep(1500);
  await waitForAppReady(c);
  await sleep(2000);
  out.pollOnRemount = await ev(c, `(() => ({ notifiedWeight: localStorage.getItem('wmNotified_weight') }))()`);
  // 清理 QA 档案里的通知标记
  await ev(c, `localStorage.removeItem('wmNotify'); localStorage.removeItem('wmNotified_weight'); 'cleaned'`);
}

// ---- 汇总判定 ----
const L = out.layout1280, N9 = out.layout900, M = out.layout414;
flags.desktop = L.page.maxWidth === '1080px' && L.cols.display === 'grid' && L.cols.gtc.split(' ').length === 2 && L.sideBySide === true && L.tabbar.borderRadius.startsWith('999') && L.tabbarCentered === true && L.tabbar.boxShadow === true;
flags.bannerShown = !out.banner1280.timeout && out.banner1280.banners.length === 1 && out.banner1280.banners[0].includes('该测体重了') && !out.banner1280.banners[0].includes('腰围');
flags.bannerGone = !out.bannerGone.timeout && out.bannerGone.banners.length === 0;
flags.bannerBack = !out.bannerBack.timeout && out.bannerBack.banners.some(t => t.includes('该测体重了'));
flags.tabletOld = N9.page.maxWidth === '760px' && N9.cols.display === 'block' && N9.stacked === true && N9.tabbar.borderRadius === '0px' && N9.tabbar.width === 900 && N9.tabbar.transform === 'none';
flags.boundary = out.viewportChecks.w1023.colsDisplay === 'block' && out.viewportChecks.w1023.pageMaxWidth === '760px' && out.viewportChecks.w1024.colsDisplay === 'grid' && out.viewportChecks.w1024.pageMaxWidth === '1080px';
flags.mobile = M.page.maxWidth === '760px' && M.cols.display === 'block' && M.stacked === true && M.sideBySide === false && M.tabbar.width === 414 && M.tabbar.borderRadius === '0px' && M.tabbar.transform === 'none';
flags.settingsGrid = out.settings.gridDisplay === 'grid' && out.settings.gridGTC.split(' ').length === 2 && out.settings.ok === true;
flags.a1b1b3 = out.a1.ok === true && out.b1.ok === true && out.b3.ok === true && out.b3server.goneFromGet === true && out.b3server.tombstone === true;
out.flags = flags;
console.log(JSON.stringify(out, null, 1));
process.exit(0);
