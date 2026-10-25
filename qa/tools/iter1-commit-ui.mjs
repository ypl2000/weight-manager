// 迭代1-3 补充:UI 点击"确认导入全部 2 行"(重复导入 → 幂等,应 toast 导入0条跳过2条)
import { ensureChrome, connect, ev, goto, shot } from './cdp.mjs';

const CSV = 'C:/Users/11645/Desktop/体重管理/qa/tools/import-test.csv';
const out = {};

await ensureChrome();
const c = await connect();
out.pageTitle = await goto(c, 'http://127.0.0.1:8000/#/settings');

// 展开导入分区 + 注入文件
await ev(c, `(async () => {
  const s = [...document.querySelectorAll('details.sec > summary')].find(x => x.textContent.includes('批量导入历史数据'));
  s.scrollIntoView({ block: 'center' }); s.click();
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
out.previewShown = await ev(c, `(async () => {
  for (let i = 0; i < 100; i++) {
    const det = [...document.querySelectorAll('details.sec')].find(d => d.textContent.includes('批量导入历史数据'));
    if (det && det.querySelector('.cand')) return true;
    await new Promise(r => setTimeout(r, 100));
  }
  return false;
})()`);

// 点击确认导入
out.commit = await ev(c, `(async () => {
  const det = [...document.querySelectorAll('details.sec')].find(d => d.textContent.includes('批量导入历史数据'));
  const btn = [...det.querySelectorAll('button')].find(b => b.textContent.includes('确认导入全部'));
  btn.click();
  for (let i = 0; i < 150; i++) {
    const toast = document.querySelector('#toast');
    if (toast && toast.textContent.trim()) return { toast: toast.textContent.trim() };
    const err = det.querySelector('.banner.warn');
    if (err) return { error: err.textContent.trim() };
    await new Promise(r => setTimeout(r, 100));
  }
  return { toast: null };
})()`);

console.log(JSON.stringify(out, null, 1));
process.exit(0);
