// 双端页面适配矩阵:6 页面 × 6 视口 = 36 格,全部以 DOM/computed style 断言(不靠目测截图)
// 检查项:V1 无横向溢出 / V2 底栏形态 / V3 Today·Coach 双列与列底差 / V4 设置页两列 /
//         V5 提醒横幅通栏 / V6 导入预览 6 列(窄屏注入) / V7 趋势图自适应 / V8 卡片完整 / V9 中文渲染
// 运行: node qa/tools/vf-matrix.mjs
import { ensureChrome, connect, ev, waitForAppReady } from './cdp.mjs';
import { writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const B = 'http://127.0.0.1:8000';
const R = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'reports');
const VIEWPORTS = [
  { w: 414, h: 896, name: '414x896' },
  { w: 768, h: 900, name: '768x900' },
  { w: 900, h: 900, name: '900x900' },
  { w: 1024, h: 900, name: '1024x900' },
  { w: 1280, h: 900, name: '1280x900' },
  { w: 1920, h: 1080, name: '1920x1080' },
];
const PAGES = [
  { name: '今日', hash: '/#/' },
  { name: '数据', hash: '/#/data' },
  { name: '阶段', hash: '/#/stage' },
  { name: '训练', hash: '/#/training' },
  { name: '设置', hash: '/#/settings' },
  { name: '教练', hash: '/#/coach' },
];
const CSVF = 'C:/Users/11645/Desktop/体重管理/backend/tests/fixtures/chinese.csv';

await ensureChrome();
const c = await connect();

async function setViewport(v) {
  await c.send('Emulation.setDeviceMetricsOverride', {
    width: v.w, height: v.h, deviceScaleFactor: 1, mobile: false,
  });
}
async function openPage(hash) {
  // 用完整导航(哈希路由下 location.hash 变化不会 reload,直接 navigate 保证干净状态)
  await c.send('Page.navigate', { url: B + hash });
  await new Promise((r) => setTimeout(r, 400));
  await waitForAppReady(c);
  await ev(c, `(async () => {
    for (let i = 0; i < 200; i++) {
      const h = document.querySelector('.page-head h1');
      if (h && h.textContent.trim()) return h.textContent.trim();
      await new Promise(r => setTimeout(r, 100));
    }
    return null;
  })()`);
  await ev(c, `document.fonts ? document.fonts.ready.then(() => true) : true`);
  await new Promise((r) => setTimeout(r, 600)); // balance.js 补量时点(500ms 兜底)
}

// 页内量测(一个 ev 返回全部断言原始数据)
const MEASURE = `(() => {
  const out = {};
  const de = document.documentElement;
  out.v1 = { sw: de.scrollWidth, cw: de.clientWidth, bsw: document.body ? document.body.scrollWidth : 0, bcw: document.body ? document.body.clientWidth : 0, iw: innerWidth };
  const tb = document.querySelector('.tabbar');
  if (tb) {
    const s = getComputedStyle(tb); const r = tb.getBoundingClientRect();
    out.v2 = { pos: s.position, left: +r.left.toFixed(1), width: +r.width.toFixed(1), bottom: +r.bottom.toFixed(1),
               radius: s.borderRadius, centerX: +(r.left + r.width / 2).toFixed(1), shadow: s.boxShadow !== 'none', iw: innerWidth };
  }
  const cols = document.querySelector('.cols');
  if (cols) {
    const colEls = [...cols.children].filter(el => el.classList.contains('col'));
    const a = colEls[0] && colEls[0].getBoundingClientRect();
    const b = colEls[1] && colEls[1].getBoundingClientRect();
    const cards = [...cols.querySelectorAll('.card')].map(cc => cc.getBoundingClientRect());
    const tallest = cards.length ? Math.max(...cards.map(x => x.height)) : 0;
    out.v3 = { display: getComputedStyle(cols).display, cols: colEls.length,
      aBottom: a && +a.bottom.toFixed(1), bBottom: b && +b.bottom.toFixed(1),
      aTop: a && +a.top.toFixed(1), bTop: b && +b.top.toFixed(1),
      aRight: a && +a.right.toFixed(1), bLeft: b && +b.left.toFixed(1),
      tallest: +tallest.toFixed(1),
      bottomDiff: (a && b) ? +Math.abs(a.bottom - b.bottom).toFixed(1) : 0 };
  }
  const sp = document.querySelector('.settings-page');
  if (sp) {
    const s = getComputedStyle(sp);
    const secs = [...sp.querySelectorAll('details.sec')];
    const about = secs[secs.length - 1];
    const sec0 = secs[0] && secs[0].getBoundingClientRect();
    const ab = about && about.getBoundingClientRect();
    const pr = sp.getBoundingClientRect();
    out.v4 = { display: s.display, tracks: s.gridTemplateColumns,
      secW: sec0 && +sec0.width.toFixed(1), aboutW: ab && +ab.width.toFixed(1), pageInnerW: +(pr.width - 64).toFixed(1) };
  }
  const banner = document.querySelector('.page > .banner.warn');
  if (banner) {
    const br = banner.getBoundingClientRect();
    const page = document.querySelector('.page');
    const pr = page.getBoundingClientRect();
    const ps = getComputedStyle(page);
    out.v5 = { bx: +br.left.toFixed(1), bw: +br.width.toFixed(1),
               px: +(pr.left + parseFloat(ps.paddingLeft)).toFixed(1),
               pw: +(pr.width - parseFloat(ps.paddingLeft) - parseFloat(ps.paddingRight)).toFixed(1), text: banner.textContent.trim().slice(0, 20) };
  }
  // V8 卡片完整性
  const bad = [];
  for (const card of document.querySelectorAll('.card')) {
    const r = card.getBoundingClientRect();
    if (r.right > innerWidth + 1 || r.left < -1) bad.push({ why: '超出视口', t: (card.querySelector('h2') || {}).textContent || card.className, right: +r.right.toFixed(1) });
    const allowInnerScroll = !!card.querySelector('[style*="overflow-x"]');
    if (!allowInnerScroll && card.scrollWidth > card.clientWidth + 3) bad.push({ why: '卡内横向溢出', t: (card.querySelector('h2') || {}).textContent || card.className, sw: card.scrollWidth, cw: card.clientWidth });
  }
  out.v8 = { badCount: bad.length, bad: bad.slice(0, 4) };
  // V9 中文渲染
  const h1 = document.querySelector('.page-head h1');
  out.v9 = { text: h1 ? h1.textContent.trim() : null, w: h1 ? +h1.getBoundingClientRect().width.toFixed(1) : 0,
             font: getComputedStyle(document.body).fontFamily.slice(0, 60) };
  return out;
})()`;

// 趋势图量测(数据页:切到趋势子标签)
const CHART = `(async () => {
  const segBtn = [...document.querySelectorAll('.seg button')].find(b => b.textContent.includes('趋势'));
  if (!segBtn) return { found: false };
  segBtn.click();
  for (let i = 0; i < 60; i++) {
    const cv = document.querySelector('.card canvas');
    if (cv) {
      const r = cv.getBoundingClientRect();
      const card = cv.closest('.card');
      return { found: true, cw: +r.width.toFixed(1), cardInnerW: +(card.clientWidth - 28).toFixed(1), attrW: cv.width };
    }
    await new Promise(r2 => setTimeout(r2, 100));
  }
  return { found: false };
})()`;

// 设置页导入预览注入与量测(窄屏)
async function importPreviewCheck() {
  await ev(c, `(async () => {
    const s = [...document.querySelectorAll('details.sec > summary')].find(x => x.textContent.includes('批量导入历史数据'));
    s.parentElement.open = true;
    await new Promise(r => setTimeout(r, 200));
    return true;
  })()`);
  const doc = await c.send('DOM.getDocument', {});
  const nodes = await c.send('DOM.querySelectorAll', { nodeId: doc.root.nodeId, selector: 'details.sec input[type=file]' });
  let target = null;
  for (const nid of nodes.nodeIds) {
    const n = await c.send('DOM.describeNode', { nodeId: nid });
    const attrs = n.node.attributes || [];
    if ((attrs[attrs.indexOf('accept') + 1] || '').includes('.zip')) { target = nid; break; }
  }
  if (target == null) return { error: 'input-not-found' };
  await c.send('DOM.setFileInputFiles', { files: [CSVF], nodeId: target });
  return ev(c, `(async () => {
    for (let i = 0; i < 100; i++) {
      const det = [...document.querySelectorAll('details.sec')].find(d => d.textContent.includes('批量导入历史数据'));
      const cand = det && det.querySelector('.cand');
      if (cand) {
        const ths = cand.querySelectorAll('thead th').length;
        const wrap = cand.querySelector('[style*="overflow-x"]');
        const card = cand.closest('details.sec') || cand.parentElement; // 导入分区无 .card 包装
        const cr = card.getBoundingClientRect();
        return { ths, wrapScrollW: wrap ? wrap.scrollWidth : null, wrapClientW: wrap ? wrap.clientWidth : null,
                 cardRight: +cr.right.toFixed(1), cardW: +cr.width.toFixed(1), iw: innerWidth };
      }
      await new Promise(r => setTimeout(r, 100));
    }
    return { error: 'preview-not-shown' };
  })()`);
}
async function importPreviewCancel() {
  await ev(c, `( () => {
    const det = [...document.querySelectorAll('details.sec')].find(d => d.textContent.includes('批量导入历史数据'));
    const btn = [...det.querySelectorAll('button')].find(b => b.textContent.trim() === '取消');
    if (btn) btn.click();
    return true;
  })()`);
}

// ---- 断言器 ----
function judge(pageName, vpName, m, preview, chart) {
  const fails = [];
  const wide = parseInt(vpName) >= 1024;
  // V1
  if (m.v1.sw > m.v1.cw + 1 || m.v1.bsw > m.v1.bcw + 1) fails.push(`V1横向溢出:${JSON.stringify(m.v1)}`);
  // V2
  if (!m.v2) fails.push('V2底栏缺失');
  else if (wide) {
    if (!(m.v2.radius === '999px' && Math.abs(m.v2.centerX - m.v2.iw / 2) <= 2 && m.v2.bottom <= innerH(vpName) && m.v2.pos === 'fixed' && m.v2.shadow)) {
      fails.push(`V2宽屏应为悬浮居中胶囊:${JSON.stringify(m.v2)}`);
    }
  } else {
    if (!(m.v2.radius === '0px' && m.v2.left <= 0.5 && Math.abs(m.v2.width - m.v2.iw) <= 1 && m.v2.pos === 'fixed')) {
      fails.push(`V2窄屏应为通栏底栏:${JSON.stringify(m.v2)}`);
    }
  }
  // V3(仅今日/教练)
  if (m.v3) {
    if (wide) {
      const sideBySide = m.v3.bLeft >= m.v3.aRight - 1;
      const balanced = m.v3.bottomDiff <= m.v3.tallest + 2;
      if (!(m.v3.display === 'flex' && sideBySide && balanced)) {
        fails.push(`V3宽屏双列(flex+并排+底差≤最高卡高${m.v3.tallest}):${JSON.stringify({ display: m.v3.display, bLeft: m.v3.bLeft, aRight: m.v3.aRight, diff: m.v3.bottomDiff })}`);
      }
    } else {
      const stacked = m.v3.bTop >= m.v3.aBottomOfCol || true; // 单列:colB 顶部应≥colA 顶部(顺序堆叠)
      if (!(m.v3.display === 'block' && m.v3.bTop >= m.v3.aTop)) {
        fails.push(`V3窄屏应单列堆叠:${JSON.stringify({ display: m.v3.display, aTop: m.v3.aTop, bTop: m.v3.bTop })}`);
      }
    }
  }
  // V4(仅设置)
  if (m.v4) {
    if (wide) {
      const twoCols = m.v4.display === 'grid' && m.v4.tracks.split(' ').length === 2;
      const aboutFull = Math.abs(m.v4.aboutW - m.v4.pageInnerW) <= 2;
      const secHalf = Math.abs(m.v4.secW - (m.v4.pageInnerW - 14) / 2) <= 3; // 两列间 gap 14px
      if (!(twoCols && aboutFull && secHalf)) fails.push(`V4宽屏设置两列(grid两轨道+关于通栏):${JSON.stringify(m.v4)}`);
    } else {
      if (m.v4.display === 'grid') fails.push(`V4窄屏设置不应为grid:${JSON.stringify(m.v4)}`);
    }
  }
  // V5(仅今日)
  if (m.v5) {
    if (!(Math.abs(m.v5.bx - m.v5.px) <= 1 && Math.abs(m.v5.bw - m.v5.pw) <= 1)) {
      fails.push(`V5横幅应通栏:${JSON.stringify(m.v5)}`);
    }
  }
  // V6(窄屏设置注入时)
  if (preview) {
    if (preview.error) fails.push(`V6导入预览失败:${preview.error}`);
    else if (preview.ths !== 6) fails.push(`V6预览表非6列:${preview.ths}`);
    else if (!(preview.cardRight <= preview.iw + 1)) fails.push(`V6卡片被撑破:${JSON.stringify(preview)}`);
  }
  // V7(数据页)
  if (chart) {
    if (!chart.found) fails.push('V7趋势图未渲染');
    else if (Math.abs(chart.cw - chart.cardInnerW) > 3) fails.push(`V7图宽未随容器:${JSON.stringify(chart)}`);
  }
  // V8
  if (m.v8.badCount > 0) fails.push(`V8卡片问题:${JSON.stringify(m.v8.bad)}`);
  // V9
  if (!m.v9.text || m.v9.w <= 0) fails.push(`V9中文渲染异常:${JSON.stringify(m.v9)}`);
  return fails;
}
function innerH(vpName) { return vpName === '1920x1080' ? 1080 : 900; }

// ---- 执行 ----
const matrix = [];
for (const vp of VIEWPORTS) {
  await setViewport(vp);
  for (const pg of PAGES) {
    await openPage(pg.hash);
    const m = await ev(c, MEASURE);
    let preview = null;
    if (pg.name === '设置' && vp.w < 1024) {
      preview = await importPreviewCheck();
      await importPreviewCancel();
      await openPage(pg.hash); // 取消后重开,保证 V8 在干净状态量测
      const m2 = await ev(c, MEASURE);
      Object.assign(m, m2);
    }
    let chart = null;
    if (pg.name === '数据') chart = await ev(c, CHART);
    const fails = judge(pg.name, vp.name, m, preview, chart);
    matrix.push({ viewport: vp.name, page: pg.name, pass: fails.length === 0, fails, measure: m, preview });
    console.log(`${fails.length === 0 ? 'PASS' : 'FAIL'} [${pg.name} @ ${vp.name}]${fails.length ? ' :: ' + fails.join(' | ') : ''}`);
    // 代表视口整页截图(414/1280):六页各一张
    if (vp.w === 414 || vp.w === 1280) {
      const shot = await c.send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: true });
      const fs = await import('node:fs');
      fs.writeFileSync(path.join(R, `vf-matrix-${vp.name}-${pg.name}.png`), Buffer.from(shot.data, 'base64'));
    }
  }
}
writeFileSync(path.join(R, 'vf-matrix-results.json'), JSON.stringify(matrix, null, 2));
const fails = matrix.filter((x) => !x.pass);
console.log(`\n== 适配矩阵: ${matrix.length - fails.length}/${matrix.length} 格 pass ==`);
if (fails.length) { console.log('FAIL cells:', fails.map((f) => `${f.page}@${f.viewport}`).join(', ')); process.exitCode = 1; }
process.exit(0);
