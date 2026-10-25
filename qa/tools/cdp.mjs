// QA 冒烟测试 CDP 驱动：Chrome headless + DevTools 协议（替代不可用的子代理浏览器）
// 只读服务/写 qa/**；不改任何业务代码。
import { spawn } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export const PORT = 9333;
export const BASE = 'http://127.0.0.1:8000';
const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
export const PROFILE = path.join(os.tmpdir(), 'qa-wm-profile');

export async function ensureChrome() {
  try {
    const r = await fetch(`http://127.0.0.1:${PORT}/json/version`);
    if (r.ok) return 'already-running';
  } catch {}
  mkdirSync(PROFILE, { recursive: true });
  const proc = spawn(
    CHROME,
    [
      '--headless=new',
      `--remote-debugging-port=${PORT}`,
      `--user-data-dir=${PROFILE}`,
      '--no-first-run',
      '--no-default-browser-check',
      '--disable-background-timer-throttling',
      '--disable-backgrounding-occluded-windows',
      '--disable-renderer-backgrounding',
      '--window-size=1280,900',
      '--hide-scrollbars',
      'about:blank',
    ],
    { stdio: 'ignore' },
  );
  proc.unref();
  for (let i = 0; i < 80; i++) {
    await new Promise((r) => setTimeout(r, 250));
    try {
      const r = await fetch(`http://127.0.0.1:${PORT}/json/version`);
      if (r.ok) return 'launched';
    } catch {}
  }
  throw new Error('chrome devtools port not up');
}

export async function connect() {
  const list = await (await fetch(`http://127.0.0.1:${PORT}/json`)).json();
  const page = list.find((t) => t.type === 'page');
  if (!page) throw new Error('no page target');
  const ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((res, rej) => {
    ws.onopen = res;
    ws.onerror = () => rej(new Error('ws error'));
  });
  let id = 0;
  const pending = new Map();
  const events = [];
  ws.onmessage = (ev) => {
    const m = JSON.parse(ev.data);
    if (m.id && pending.has(m.id)) {
      pending.get(m.id)(m);
      pending.delete(m.id);
    } else if (m.method) {
      events.push(m);
    }
  };
  const send = (method, params = {}) =>
    new Promise((res, rej) => {
      const i = ++id;
      pending.set(i, (m) =>
        m.error ? rej(new Error(`${method}: ${JSON.stringify(m.error)}`)) : res(m.result),
      );
      ws.send(JSON.stringify({ id: i, method, params }));
    });
  await send('Page.enable');
  await send('Runtime.enable');
  return {
    ws,
    send,
    events,
    waitEvent(method, timeout = 10000) {
      const t0 = Date.now();
      return new Promise((res, rej) => {
        const iv = setInterval(() => {
          const i = events.findIndex((e) => e.method === method);
          if (i >= 0) {
            const e = events.splice(i, 1)[0];
            clearInterval(iv);
            res(e);
          } else if (Date.now() - t0 > timeout) {
            clearInterval(iv);
            rej(new Error('timeout waiting ' + method));
          }
        }, 50);
      });
    },
  };
}

// 页面内 JS 求值（等价 tab.playwright.evaluate）
export async function ev(client, expression) {
  const r = await client.send('Runtime.evaluate', {
    expression,
    awaitPromise: true,
    returnByValue: true,
  });
  if (r.exceptionDetails) {
    throw new Error('page JS error: ' + JSON.stringify(r.exceptionDetails).slice(0, 800));
  }
  return r.result.value;
}

export async function goto(client, url) {
  const nav = client.send('Page.navigate', { url });
  await client.waitEvent('Page.loadEventFired', 15000).catch(() => {});
  await nav;
  // 等待 SPA 挂载（页面出现 h1 标题）
  await ev(
    client,
    `(async () => {
      for (let i = 0; i < 150; i++) {
        const h = document.querySelector('.page-head h1');
        if (h && h.textContent.trim()) return h.textContent.trim();
        await new Promise(r => setTimeout(r, 100));
      }
      return null;
    })()`,
  );
}

export async function waitForAppReady(client) {
  return ev(
    client,
    `(async () => {
      for (let i = 0; i < 150; i++) {
        const t = document.body ? document.body.innerText : '';
        if (t.includes('在线') && t.length > 50) return 'ready';
        await new Promise(r => setTimeout(r, 100));
      }
      return 'timeout:' + (document.body ? document.body.innerText.slice(0, 200) : 'no body');
    })()`,
  );
}

export async function shot(client, file) {
  const r = await client.send('Page.captureScreenshot', { format: 'png' });
  writeFileSync(file, Buffer.from(r.data, 'base64'));
  return file;
}

// ---- 服务端 API 助手（Node 侧） ----
export async function apiGet(table) {
  const r = await fetch(`${BASE}/api/tables/${table}`);
  return r.json();
}
export async function apiSync(body) {
  const r = await fetch(`${BASE}/api/sync`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  return r.json();
}
export async function apiHistory(params = '') {
  const r = await fetch(`${BASE}/api/history${params}`);
  return r.json();
}
export function visible(docs) {
  return docs.filter((d) => !d.deleted);
}
export function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}
