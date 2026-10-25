// 重摄 iter1-import-section.png:展开分区+注入文件+滚动到预览
import { ensureChrome, connect, ev, goto, shot, sleep } from './cdp.mjs';

const CSV = 'C:/Users/11645/Desktop/体重管理/qa/tools/import-test.csv';
await ensureChrome();
const c = await connect();
await goto(c, 'http://127.0.0.1:8000/#/settings');
await ev(c, `(async () => {
  const s = [...document.querySelectorAll('details.sec > summary')].find(x => x.textContent.includes('批量导入历史数据'));
  s.scrollIntoView({ block: 'start' }); s.click();
  for (let i = 0; i < 30; i++) { await new Promise(r => setTimeout(r, 100)); if (s.parentElement.open) break; }
  return s.parentElement.open;
})()`);
const doc = await c.send('DOM.getDocument', {});
const q = await c.send('DOM.querySelectorAll', { nodeId: doc.root.nodeId, selector: 'details.sec input[type=file]' });
let target = null;
for (const nid of q.nodeIds) {
  const n = await c.send('DOM.describeNode', { nodeId: nid });
  const attrs = n.node.attributes || [];
  if ((attrs[attrs.indexOf('accept') + 1] || '').includes('.zip')) { target = nid; break; }
}
await c.send('DOM.setFileInputFiles', { files: [CSV], nodeId: target });
const ok = await ev(c, `(async () => {
  for (let i = 0; i < 100; i++) {
    const det = [...document.querySelectorAll('details.sec')].find(d => d.textContent.includes('批量导入历史数据'));
    if (det && det.querySelector('.cand')) { det.scrollIntoView({ block: 'start' }); return true; }
    await new Promise(r => setTimeout(r, 100));
  }
  return false;
})()`);
await sleep(500);
await shot(c, 'C:/Users/11645/Desktop/体重管理/qa/reports/iter1-import-section.png');
console.log('preview:', ok, '— screenshot saved');
process.exit(0);
