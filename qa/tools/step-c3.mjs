// c3: #/stage 自动判定分区展示建议与 ✓/✗ 规则明细（截图为证）
import { ensureChrome, connect, ev, goto, shot, BASE } from './cdp.mjs';

await ensureChrome();
const c = await connect();
const title = await goto(c, BASE + '/#/stage');

// 等待自动判定内容渲染
const card = await ev(c, `(async () => {
  for (let i = 0; i < 100; i++) {
    const cards = [...document.querySelectorAll('.card')];
    const el = cards.find(x => x.querySelector('h2') && x.querySelector('h2').textContent.includes('自动判定'));
    if (el && el.innerText.includes('建议')) return el.innerText;
    await new Promise(r => setTimeout(r, 100));
  }
  return null;
})()`);

const file = await shot(c, 'C:/Users/11645/Desktop/体重管理/qa/reports/iter0-c-stage-auto.png');

const assertions = {
  hasS1Suggest: /阶段①[\s\S]*?✅ 建议/.test(card || ''),
  hasWaistRule: (card || '').includes('腰围 ≤ 85 cm'),
  hasWaistFail: /✗[\s\S]*?腰围 ≤ 85 cm[\s\S]*?当前 96 cm/.test(card || ''),
  hasWorkoutRule: (card || '').includes('运动打卡'),
  hasCross: (card || '').includes('✗'),
};
console.log(JSON.stringify({ title, card: card && card.slice(0, 700), assertions, file }, null, 2));
process.exit(0);
