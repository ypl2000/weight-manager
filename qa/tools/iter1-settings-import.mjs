// 迭代1-3:设置页"批量导入历史数据"分区 UI 验证
// - 分区可展开、文件选择后出现预览(DOM.setFileInputFiles 注入本地 CSV)
// - 离线态:input disabled + 离线横幅
import { ensureChrome, connect, ev, goto, shot, sleep } from './cdp.mjs';

const CSV = 'C:/Users/11645/Desktop/体重管理/qa/tools/import-test.csv';
const out = {};

await ensureChrome();
const c = await connect();

// 1) 打开设置页
out.pageTitle = await goto(c, 'http://127.0.0.1:8000/#/settings');

// 2) 展开"批量导入历史数据"分区
out.expanded = await ev(c, `(async () => {
  const sums = [...document.querySelectorAll('details.sec > summary')];
  const s = sums.find(x => x.textContent.includes('批量导入历史数据'));
  if (!s) return { found: false };
  s.scrollIntoView({ block: 'center' });
  s.click();
  for (let i = 0; i < 30; i++) {
    await new Promise(r => setTimeout(r, 100));
    if (s.parentElement.open) break;
  }
  const det = s.parentElement;
  const input = det.querySelector('input[type=file]');
  return {
    found: true,
    open: det.open,
    descText: (det.querySelector('.body p.muted') || {}).textContent?.slice(0, 60) || '',
    fileInputPresent: !!input,
    accept: input ? input.getAttribute('accept') : null,
    disabledOnline: input ? input.disabled : null,
  };
})()`);

// 3) 注入文件 → 等预览出现
out.preview = await ev(c, `(async () => {
  const done = window.__qaFileSet;
  return 'armed';
})()`);

// 用 CDP DOM.setFileInputFiles 注入(导入分区的 input 带 accept=".zip,.csv,.txt,.json")
const doc = await c.send('DOM.getDocument', {});
const q = await c.send('DOM.querySelectorAll', {
  nodeId: doc.root.nodeId,
  selector: 'details.sec input[type=file]',
});
let target = null;
for (const nid of q.nodeIds) {
  const n = await c.send('DOM.describeNode', { nodeId: nid });
  const attrs = n.node.attributes || [];
  const acc = attrs[attrs.indexOf('accept') + 1] || '';
  if (acc.includes('.zip')) { target = nid; break; }
}
if (target == null) throw new Error('import section file input not found');
out.injectTargetFound = true;
await c.send('DOM.setFileInputFiles', { files: [CSV], nodeId: target });
// 等待预览渲染
const prev = await ev(c, `(async () => {
  for (let i = 0; i < 100; i++) {
    const det = [...document.querySelectorAll('details.sec')].find(d => d.textContent.includes('批量导入历史数据'));
    const cand = det && det.querySelector('.cand');
    if (cand) {
      const chips = [...cand.querySelectorAll('.chip')].map(x => x.textContent.trim());
      const pills = [...cand.querySelectorAll('.pill')].map(x => x.textContent.trim());
      const rows = [...cand.querySelectorAll('tbody tr')].map(tr => tr.textContent.trim().replace(/\\s+/g, ' '));
      const btn = [...cand.querySelectorAll('button')].map(b => b.textContent.trim());
      return { previewShown: true, chips, pills, rows, buttons: btn, tableText: cand.innerText.slice(0, 400) };
    }
    await new Promise(r => setTimeout(r, 100));
  }
  return { previewShown: false };
})()`);
out.preview = prev;
await shot(c, 'C:/Users/11645/Desktop/体重管理/qa/reports/iter1-import-section.png');

// 4) 离线态:模拟断网后重进设置页
await c.send('Network.enable', {});
await c.send('Network.emulateNetworkConditions', {
  offline: true, latency: 0, downloadThroughput: -1, uploadThroughput: -1,
});
await sleep(300);
out.offline = await ev(c, `(async () => {
  location.hash = '#/data';           // 先离开设置页,确保回来是全新渲染
  await new Promise(r => setTimeout(r, 600));
  location.hash = '#/settings';
  for (let i = 0; i < 50; i++) {
    const det = [...document.querySelectorAll('details.sec')].find(d => d.textContent.includes('批量导入历史数据'));
    if (det && !det.open) {
      det.querySelector('summary').click();
      for (let j = 0; j < 30; j++) { await new Promise(r => setTimeout(r, 100)); if (det.open) break; }
    }
    if (det && det.open) {
      const input = det.querySelector('input[type=file]');
      const banner = det.querySelector('.banner.warn');
      const commitBtn = [...det.querySelectorAll('button')].map(b => b.textContent.trim());
      return {
        navigatorOnLine: navigator.onLine,
        inputDisabled: input ? input.disabled : null,
        bannerText: banner ? banner.textContent.trim() : null,
        buttons: commitBtn,
      };
    }
    await new Promise(r => setTimeout(r, 100));
  }
  return { sectionFound: false };
})()`);
await shot(c, 'C:/Users/11645/Desktop/体重管理/qa/reports/iter1-import-offline.png');

// 恢复在线
await c.send('Network.emulateNetworkConditions', {
  offline: false, latency: 0, downloadThroughput: -1, uploadThroughput: -1,
});

console.log(JSON.stringify(out, null, 1));
process.exit(0);
