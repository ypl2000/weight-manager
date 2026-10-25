// g2/g3 视觉证据: 滚动到 同步/数据安全 分区并截图
import { ensureChrome, connect, ev, shot, sleep, BASE } from './cdp.mjs';

await ensureChrome();
const c = await connect();
await ev(c, `location.hash = '#/settings'`);
await sleep(800);
await ev(c, `(async () => {
  for (const kw of ['同步(手机', '数据安全']) {
    const d = [...document.querySelectorAll('details.sec')].find(x => x.querySelector('summary') && x.querySelector('summary').textContent.includes(kw));
    if (d) d.open = true;
  }
  const sec = [...document.querySelectorAll('details.sec')].find(x => x.querySelector('summary') && x.querySelector('summary').textContent.includes('同步(手机'));
  sec.scrollIntoView({ block: 'start' });
})()`);
await sleep(400);
const f1 = await shot(c, 'C:/Users/11645/Desktop/体重管理/qa/reports/iter0-g-settings-sync.png');
await ev(c, `(async () => {
  const sec = [...document.querySelectorAll('details.sec')].find(x => x.querySelector('summary') && x.querySelector('summary').textContent.includes('数据安全'));
  sec.scrollIntoView({ block: 'start' });
})()`);
await sleep(400);
const f2 = await shot(c, 'C:/Users/11645/Desktop/体重管理/qa/reports/iter0-g-settings-security.png');
console.log(JSON.stringify({ f1, f2 }));
process.exit(0);
