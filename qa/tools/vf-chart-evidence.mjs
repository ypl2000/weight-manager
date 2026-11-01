// 趋势图自适应宽度取证:414 与 1280 两个视口下 canvas 宽度应跟随容器
import { ensureChrome, connect, ev, waitForAppReady } from './cdp.mjs';

await ensureChrome();
const c = await connect();
const out = {};
for (const [name, w, h] of [['414x896', 414, 896], ['1280x900', 1280, 900]]) {
  await c.send('Emulation.setDeviceMetricsOverride', { width: w, height: h, deviceScaleFactor: 1, mobile: false });
  await c.send('Page.navigate', { url: 'http://127.0.0.1:8000/#/data' });
  await new Promise((r) => setTimeout(r, 400));
  await waitForAppReady(c);
  out[name] = await ev(c, `(async () => {
    const segBtn = [...document.querySelectorAll('.seg button')].find(b => b.textContent.includes('趋势'));
    segBtn.click();
    for (let i = 0; i < 60; i++) {
      const cv = document.querySelector('.card canvas');
      if (cv) {
        const r = cv.getBoundingClientRect();
        const card = cv.closest('.card');
        return { canvasW: +r.width.toFixed(1), attrW: cv.width, cardInnerW: +(card.clientWidth - 28).toFixed(1) };
      }
      await new Promise(r2 => setTimeout(r2, 100));
    }
    return { found: false };
  })()`);
}
console.log(JSON.stringify(out));
process.exit(0);
