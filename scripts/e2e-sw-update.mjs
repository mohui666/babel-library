// SW 升级 E2E：旧构建打开 → 换上新构建 → 出现「发现新版本」→ 刷新后版本号变更
// 运行：node scripts/e2e-sw-update.mjs
import { spawn, execSync } from 'node:child_process';
import {
  readdirSync,
  statSync,
  mkdirSync,
  copyFileSync,
  rmSync,
  mkdtempSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import CDP from 'chrome-remote-interface';

const EDGE = 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
const PORT = 20000 + (process.pid % 20000);
const PROFILE = resolve(`.e2e-profile-${process.pid}`);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function build(version) {
  execSync('npx vite build', { env: { ...process.env, APP_VERSION: version }, stdio: 'ignore' });
}

/** 手写递归复制（本机 Node 的 fs.cpSync 会原生崩溃，见调试记录） */
function copyDir(src, dst) {
  mkdirSync(dst, { recursive: true });
  for (const e of readdirSync(src)) {
    const s = join(src, e);
    const d = join(dst, e);
    if (statSync(s).isDirectory()) copyDir(s, d);
    else copyFileSync(s, d);
  }
}

const serveDir = mkdtempSync(join(tmpdir(), 'sw-e2e-'));
let server;
let client;
let browser;
const failures = [];
const check = (name, cond, detail = '') => {
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${detail ? ` —— ${detail}` : ''}`);
  if (!cond) failures.push(name);
};

try {
  console.log('构建 e2eAAAA …');
  build('e2eAAAA');
  copyDir('dist', serveDir);
  server = spawn(
    process.execPath,
    ['node_modules/vite/bin/vite.js', 'preview', '--port', '4199', '--strictPort', '--outDir', serveDir],
    { stdio: 'ignore' },
  );
  await sleep(2500);

  browser = spawn(EDGE, [
    '--headless=new', '--disable-gpu', '--disable-extensions',
    '--no-first-run', '--no-default-browser-check',
    `--remote-debugging-port=${PORT}`, `--user-data-dir=${PROFILE}`, 'about:blank',
  ]);
  await sleep(2500);
  client = await CDP({ port: PORT });
  const { Page, Runtime } = client;
  await Page.enable();
  const evalJs = async (expression) =>
    (await Runtime.evaluate({ expression, awaitPromise: true, returnByValue: true })).result.value;

  await Page.navigate({ url: 'http://localhost:4199/' });
  await sleep(2000);
  // 等 SW 激活
  const t0 = Date.now();
  while (!(await evalJs(`navigator.serviceWorker.controller ? true : false`).catch(() => false))) {
    if (Date.now() - t0 > 15000) throw new Error('SW 未激活');
    await sleep(300);
  }
  check('旧构建 SW 已接管', true);
  check('页脚显示旧版本号', await evalJs(`document.body.textContent.includes('e2eAAAA')`));

  console.log('构建 e2eBBBB 并热替换 …');
  build('e2eBBBB');
  copyDir('dist', serveDir);

  await evalJs(`navigator.serviceWorker.getRegistration().then(r => r.update()), true`);
  const t1 = Date.now();
  while (!(await evalJs(`!!document.querySelector('.update-toast')`).catch(() => false))) {
    if (Date.now() - t1 > 15000) throw new Error('未出现更新提示');
    await sleep(300);
  }
  check('出现「发现新版本」提示', true);

  await evalJs(`document.querySelector('.update-toast button').click(), true`);
  await sleep(2500);
  check('刷新后页脚为新版本号', await evalJs(`document.body.textContent.includes('e2eBBBB')`));
} catch (e) {
  failures.push('执行异常');
  console.error('执行异常:', e.message);
} finally {
  if (client) {
    try {
      await client.Browser.close();
    } catch {}
    try {
      await client.close();
    } catch {}
  }
  if (browser) {
    try {
      await Promise.race([new Promise((r) => browser.once('exit', r)), sleep(6000)]);
    } catch {}
    if (browser.exitCode === null && !browser.killed) browser.kill();
  }
  if (server) server.kill();
  rmSync(PROFILE, { recursive: true, force: true, maxRetries: 10, retryDelay: 300 });
  rmSync(serveDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 300 });
  // 恢复正式构建（不带自定义版本号）
  build(process.env.APP_VERSION ?? '');
}

console.log(failures.length === 0 ? '全部通过' : `${failures.length} 项失败`);
process.exit(failures.length === 0 ? 0 : 1);
