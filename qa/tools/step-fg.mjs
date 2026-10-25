// f4 首页渲染 + g1-g3 设置页三分区展开（f1-f3 静态资源在 bash curl 单独验证）
import { ensureChrome, connect, ev, goto, waitForAppReady, shot, sleep, BASE } from './cdp.mjs';

const out = {};

await ensureChrome();
const c = await connect();
const homeTitle = await goto(c, BASE + '/#/');
const homeReady = await waitForAppReady(c);
const homeText = await ev(c, `document.querySelector('.page-head h1') ? document.querySelector('.page-head h1').textContent.trim() : ''`);
const hasCards = await ev(c, `document.querySelectorAll('.card').length`);
const f4shot = await shot(c, 'C:/Users/11645/Desktop/体重管理/qa/reports/iter0-f-home-today.png');
out.f4 = { homeTitle, homeReady, homeText, cardCount: hasCards, shot: f4shot };

await goto(c, BASE + '/#/settings');
await sleep(800);

async function expandSection(keyword) {
  return ev(c, `(async () => {
    const d = [...document.querySelectorAll('details.sec')].find(x => x.querySelector('summary') && x.querySelector('summary').textContent.includes('${keyword}'));
    if (!d) return 'no-section';
    d.open = true;
    await new Promise(r => setTimeout(r, 300));
    return { summary: d.querySelector('summary').textContent.trim(), bodyText: d.querySelector('.body') ? d.querySelector('.body').innerText.slice(0, 400) : d.innerText.slice(0, 400), isOpen: d.open };
  })()`);
}

out.g1_ai = await expandSection('AI 识别');
out.g2_sync = await expandSection('同步(手机');
out.g3_security = await expandSection('数据安全');

out.g1_assert = {
  hasBaseUrl: (out.g1_ai.bodyText || '').includes('接口地址'),
  hasModel: (out.g1_ai.bodyText || '').includes('模型名'),
  hasApiKey: (out.g1_ai.bodyText || '').includes('API Key'),
};
out.g2_assert = {
  hasSyncNow: (out.g2_sync.bodyText || '').includes('立即同步'),
  hasResetCursor: (out.g2_sync.bodyText || '').includes('重置游标'),
};
out.g3_assert = {
  hasPin: (out.g3_security.bodyText || '').includes('访问码'),
  hasHistory: (out.g3_security.bodyText || '').includes('历史回滚'),
  hasSnapshot: (out.g3_security.bodyText || '').includes('快照'),
};

out.g_shots = [];
for (const [kw, name] of [['AI 识别', 'ai'], ['同步(手机', 'sync'], ['数据安全', 'security']]) {
  await ev(c, `(async () => {
    const d = [...document.querySelectorAll('details.sec')].find(x => x.querySelector('summary') && x.querySelector('summary').textContent.includes('${kw}'));
    if (d) { d.open = true; }
  })()`);
  await sleep(150);
}
// 三个分区都展开后截图（数据安全滚动到可见处）
out.g_shots.push(await shot(c, 'C:/Users/11645/Desktop/体重管理/qa/reports/iter0-g-settings-all-open.png'));

console.log(JSON.stringify(out, null, 2));
process.exit(0);
