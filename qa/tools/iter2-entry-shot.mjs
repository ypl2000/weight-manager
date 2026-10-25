// 重摄 iter2-today-entry.png(滚动到 AI 教练入口卡) + 复核"上次体重"在服务端删除导入记录后是否自愈
import { ensureChrome, connect, ev, goto, shot, sleep } from './cdp.mjs';

const out = {};
await ensureChrome();
const c = await connect();
out.title = await goto(c, 'http://127.0.0.1:8000/#/');
// 等 sync 完成后读"快捷记录"区的上次体重
out.lastWeight = await ev(c, `(async () => {
  for (let i = 0; i < 100; i++) {
    const t = document.body.innerText;
    const m = t.match(/上次:([\\d.]+) kg · ([^\\n]+)/);
    if (m && i > 20) return { last: m[1], at: m[2], raw: m[0] };
    await new Promise(r => setTimeout(r, 100));
  }
  const m2 = document.body.innerText.match(/上次:[^\\n]+|还没有体重记录/);
  return { staleOrNone: m2 ? m2[0] : null };
})()`);
// 滚动到 AI 教练入口卡并截图
out.entry = await ev(c, `(async () => {
  for (let i = 0; i < 80; i++) {
    const el = [...document.querySelectorAll('section')].find(s => s.textContent.includes('AI 教练解读'));
    if (el) { el.scrollIntoView({ block: 'center' }); return el.innerText.replace(/\\s+/g, ' ').slice(0, 100); }
    await new Promise(r => setTimeout(r, 100));
  }
  return null;
})()`);
await sleep(400);
await shot(c, 'C:/Users/11645/Desktop/体重管理/qa/reports/iter2-today-entry.png');
console.log(JSON.stringify(out, null, 1));
process.exit(0);
