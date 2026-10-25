// b1: UI 保存 77.77 → 服务端 3 秒内可见（顺带复核 a1 的“已保存”提示）
import { ensureChrome, connect, ev, goto, waitForAppReady, apiGet, BASE } from './cdp.mjs';

const R1 = 'f55e1170-eb81-4f2f-ba93-4e13b3795beb'; // 上轮遗留的 77.77 测试记录

await ensureChrome();
const c = await connect();
const title = await goto(c, BASE + '/#/data');
const ready = await waitForAppReady(c);

const fill = await ev(c, `(() => {
  const inp = [...document.querySelectorAll('input[type=number]')].find(i => i.placeholder === '如 72.5');
  if (!inp) return 'no-input';
  const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
  setter.call(inp, '77.77');
  inp.dispatchEvent(new Event('input', { bubbles: true }));
  return 'filled';
})()`);

const t0 = Date.now();
const clicked = await ev(c, `(() => {
  const btn = [...document.querySelectorAll('button')].find(b => b.textContent.trim() === '保存记录');
  if (!btn) return 'no-btn';
  btn.click();
  return 'clicked';
})()`);

const toast = await ev(c, `(async () => {
  for (let i = 0; i < 40; i++) {
    if (document.body.innerText.includes('已保存')) return true;
    await new Promise(r => setTimeout(r, 100));
  }
  return false;
})()`);

let record = null;
let elapsedMs = null;
while (Date.now() - t0 < 12000) {
  const docs = await apiGet('records');
  const hit = docs.find((d) => !d.deleted && d.data.value === 77.77 && d.id !== R1);
  if (hit) {
    record = hit;
    elapsedMs = Date.now() - t0;
    break;
  }
  await new Promise((r) => setTimeout(r, 100));
}
console.log(
  JSON.stringify({ title, ready, fill, clicked, toast, elapsedMs, record }, null, 2),
);
