// 用 headless Chrome canvas 生成一张模拟体重秤读数截图(含"77.77"),供拍照识别真实模型测试
// 输出: qa/tools/vf-scale.png ; node qa/tools/vf-mkpng.mjs
import { ensureChrome, connect, ev } from './cdp.mjs';
import { writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const OUT = path.join(path.dirname(fileURLToPath(import.meta.url)), 'vf-scale.png');
await ensureChrome();
const c = await connect();
const b64 = await ev(c, `(() => {
  const cv = document.createElement('canvas');
  cv.width = 480; cv.height = 300;
  const g = cv.getContext('2d');
  g.fillStyle = '#0f172a'; g.fillRect(0, 0, 480, 300);
  g.fillStyle = '#e2e8f0'; g.font = '16px sans-serif'; g.fillText('智能体脂秤  今日', 30, 50);
  g.fillStyle = '#ffffff'; g.font = 'bold 84px Consolas, monospace';
  g.fillText('77.77', 90, 160);
  g.font = '28px sans-serif'; g.fillText('kg', 350, 160);
  g.fillStyle = '#94a3b8'; g.font = '18px sans-serif';
  g.fillText('2026-10-25 07:30', 140, 240);
  return cv.toDataURL('image/png').split(',')[1];
})()`);
writeFileSync(OUT, Buffer.from(b64, 'base64'));
console.log('written', OUT);
process.exit(0); // DevTools WebSocket 会吊住事件循环,必须显式退出
