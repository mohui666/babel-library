// 验证收录证布局：打开一张检索结果页 → 收录证 → 导出 PNG 到 /tmp/ticket-check.png
import { spawn } from 'node:child_process';
import { writeFileSync, rmSync } from 'node:fs';
import { resolve } from 'node:path';
import CDP from 'chrome-remote-interface';

const EDGE = 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
const BASE = process.env.E2E_BASE ?? 'http://localhost:4173/';
const PORT = 20000 + (process.pid % 20000);
const PROFILE = resolve(`.e2e-profile-${process.pid}`);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const browser = spawn(EDGE, [
  '--headless=new', '--disable-gpu', '--disable-extensions',
  '--no-first-run', '--no-default-browser-check',
  `--remote-debugging-port=${PORT}`, `--user-data-dir=${PROFILE}`, 'about:blank',
]);

async function waitDebugPort(timeout = 15000) {
  const t0 = Date.now();
  while (Date.now() - t0 < timeout) {
    try {
      const res = await fetch(`http://localhost:${PORT}/json/version`);
      if (res.ok) return;
    } catch {}
    await sleep(300);
  }
  throw new Error('调试端口未就绪');
}

let client;
try {
  await waitDebugPort();
  client = await CDP({ port: PORT });
  const { Page, Runtime } = client;
  await Page.enable();
  const evalJs = async (expression) =>
    (await Runtime.evaluate({ expression, awaitPromise: true, returnByValue: true })).result.value;
  const waitFor = async (expr, timeout = 12000) => {
    const t0 = Date.now();
    while (Date.now() - t0 < timeout) {
      try {
        if (await evalJs(`!!(${expr})`)) return;
      } catch {}
      await sleep(250);
    }
    throw new Error(`等待超时: ${expr}`);
  };

  await Page.navigate({ url: BASE });
  await waitFor(`document.querySelector('textarea')`);
  await evalJs(`(() => {
    const ta = document.querySelector('textarea');
    ta.value = '我今天中午吃了火锅';
    ta.dispatchEvent(new Event('input', { bubbles: true }));
    return true;
  })()`);
  await evalJs(`[...document.querySelectorAll('button')].find(b => b.textContent.includes('定位这句话')).click(), true`);
  await waitFor(`document.querySelector('.single-result')`, 15000);
  await evalJs(`document.querySelector('.single-result a.btn.primary').click(), true`);
  await waitFor(`document.querySelector('.sheet')`);
  await evalJs(`[...document.querySelectorAll('button')].find(b => b.textContent.includes('收录证')).click(), true`);
  await waitFor(`document.querySelector('.ticket-img')`);
  await sleep(600);
  const src = await evalJs(`document.querySelector('.ticket-img').src`);
  writeFileSync('/tmp/ticket-check.png', Buffer.from(src.split(',')[1], 'base64'));
  console.log('saved /tmp/ticket-check.png');
} finally {
  if (client) {
    try { await client.Browser.close(); } catch {}
    try { await client.close(); } catch {}
  }
  try { await Promise.race([new Promise((r) => browser.once('exit', r)), sleep(6000)]); } catch {}
  if (browser.exitCode === null && !browser.killed) browser.kill();
  rmSync(PROFILE, { recursive: true, force: true, maxRetries: 10, retryDelay: 300 });
}
