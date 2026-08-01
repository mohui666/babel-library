// 端到端回归：真实浏览器（Edge headless + CDP）覆盖全部核心场景。
// 运行：npx vite-node scripts/e2e-click.mjs （需 dev server 在 5173 端口运行）
import { spawn } from 'node:child_process';
import { rmSync } from 'node:fs';
import { resolve } from 'node:path';
import CDP from 'chrome-remote-interface';
import { textOfAddress } from '../src/core/codec';
import { keyToAddr } from '../src/core/address';
import { b64uToBytes } from '../src/core/base64';
import {
  unpackRecipe,
  addressFromRecipeDelta,
  fullPageAddress,
} from '../src/core/search';
import { CLASSICS } from '../src/classics/books';

const EDGE = 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
const BASE = process.env.E2E_BASE ?? 'http://localhost:5173/';
// 端口与档案目录按进程唯一化：避免僵尸实例残留导致 CDP 连到旧浏览器
const PORT = 20000 + (process.pid % 20000);
const PROFILE = resolve(`.e2e-profile-${process.pid}`);

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const browser = spawn(EDGE, [
  '--headless=new',
  '--disable-gpu',
  '--disable-extensions',
  '--disable-component-extensions-with-background-pages',
  '--no-first-run',
  '--no-default-browser-check',
  `--remote-debugging-port=${PORT}`,
  `--user-data-dir=${PROFILE}`,
  'about:blank',
]);

let client;
const failures = [];
function check(name, cond, detail = '') {
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${detail ? `\n      ${detail}` : ''}`);
  if (!cond) failures.push(name);
}

/** 从 location.hash 解析出页地址（/v1 各型链接与 /classic/） */
function addressOfHash(hash) {
  const clean = hash.split('?')[0];
  if (clean.startsWith('#/v1/s/')) {
    const m = clean.match(/^#\/v1\/s\/([^/]+)(?:\/d\/(-?\d+))?$/);
    if (!m) throw new Error(`未知短链接: ${clean.slice(0, 60)}`);
    return addressFromRecipeDelta(unpackRecipe(m[1]), m[2] ? BigInt(m[2]) : 0n);
  }
  if (clean.startsWith('#/v1/page/')) return keyToAddr(clean.slice('#/v1/page/'.length));
  if (clean.startsWith('#/v1/t/')) {
    const text = new TextDecoder().decode(b64uToBytes(clean.slice('#/v1/t/'.length)));
    return fullPageAddress(text);
  }
  if (clean.startsWith('#/classic/')) {
    const [, id, ch] = clean.split('/');
    const book = CLASSICS.find((b) => b.id === id);
    return fullPageAddress(book.chapters[Number(ch)].text);
  }
  throw new Error(`未知路由: ${hash.slice(0, 50)}`);
}

function expectedLine(hash) {
  return [...textOfAddress(addressOfHash(hash))].slice(0, 50).join('');
}

async function waitDebugPort(timeout = 15000) {
  const t0 = Date.now();
  while (Date.now() - t0 < timeout) {
    try {
      const res = await fetch(`http://localhost:${PORT}/json/version`);
      if (res.ok) return;
    } catch {}
    await sleep(300);
  }
  throw new Error('浏览器调试端口未就绪');
}

try {
  await waitDebugPort();
  client = await CDP({ port: PORT });
  const { Page, Runtime } = client;
  await Page.enable();
  await Runtime.enable();

  const consoleMsgs = [];
  Runtime.consoleAPICalled((e) => {
    const text = (e.args ?? []).map((a) => a.value ?? a.description ?? '').join(' ');
    consoleMsgs.push(`[${e.type}] ${text}`.slice(0, 300));
  });
  Runtime.exceptionThrown((e) => {
    consoleMsgs.push(`[exception] ${JSON.stringify(e.exceptionDetails).slice(0, 400)}`);
  });

  async function evalJs(expression) {
    const { result, exceptionDetails } = await Runtime.evaluate({
      expression,
      awaitPromise: true,
      returnByValue: true,
    });
    if (exceptionDetails) {
      throw new Error(`页面内执行出错: ${exceptionDetails.text} ${exceptionDetails.exception?.description ?? ''}`);
    }
    return result.value;
  }

  /** 导航期间执行上下文会短暂销毁，轮询需容忍 */
  async function evalJsSafe(expression) {
    try {
      return await evalJs(expression);
    } catch {
      return undefined;
    }
  }

  async function waitFor(expr, timeout = 12000) {
    const t0 = Date.now();
    while (Date.now() - t0 < timeout) {
      if (await evalJsSafe(`!!(${expr})`)) return true;
      await sleep(250);
    }
    throw new Error(`等待超时: ${expr}`);
  }

  async function goHome() {
    await Page.navigate({ url: BASE });
    await waitFor(`document.querySelector('textarea')`);
  }

  async function setTextarea(text) {
    await evalJs(`(() => {
      const ta = document.querySelector('textarea');
      ta.value = ${JSON.stringify(text)};
      ta.dispatchEvent(new Event('input', { bubbles: true }));
      return true;
    })()`);
  }

  async function clickButton(text) {
    await evalJs(`[...document.querySelectorAll('button')].find(b => b.textContent.includes(${JSON.stringify(text)}))?.click(), true`);
  }

  async function clickLink(text) {
    await evalJs(`[...document.querySelectorAll('a')].find(a => a.textContent.includes(${JSON.stringify(text)}))?.click(), true`);
  }

  async function snapshot(label) {
    const hash = await evalJs(`location.hash`);
    const domLine = await evalJs(`document.querySelector('.sheet-line')?.textContent ?? '(无)'`);
    const collapsed = await evalJs(`!!document.querySelector('.expand-row')`);
    let expect = '(无法解码)';
    let match = false;
    try {
      const full = textOfAddress(addressOfHash(hash));
      expect = [...full].slice(0, 50).join('');
      // 折叠视图下首行是上下文窗口的首行，改为校验它确实出现在整页中
      match = collapsed ? full.includes(domLine) : domLine === expect;
    } catch (e) {
      expect = `(解码出错: ${e.message})`;
    }
    console.log(`--- 快照 ${label}  页码: ${(await evalJs(`document.querySelector('.page-pos')?.textContent ?? ''`)).trim()}`);
    console.log(`    渲染首行: ${domLine.slice(0, 30)}…  地址应有: ${expect.slice(0, 30)}…  一致: ${match}`);
    return { hash, domLine, match };
  }

  // 1. 检索 → 坐标揭示 → 单结果（短链接）
  await goHome();
  await setTextarea('我今天中午吃了火锅');
  await clickButton('定位这句话');
  await waitFor(`document.querySelector('.reveal')`);
  await waitFor(`document.querySelector('.single-result')`, 15000);
  check('坐标揭示后呈现唯一结果', true);
  const resultHref = await evalJs(
    `document.querySelector('.single-result a.btn.primary')?.getAttribute('href') ?? ''`,
  );
  check('结果为 /v1/s/ 短链接', resultHref.includes('#/v1/s/') && resultHref.length < 200, `长度 ${resultHref.length}`);

  // 2. 打开结果：默认聚焦原句 + 上下文折叠 + 展开整页
  await evalJs(`document.querySelector('.single-result a.btn.primary').click(), true`);
  await waitFor(`document.querySelector('.sheet')`);
  check('默认聚焦原句', await evalJs(`!!document.querySelector('.sheet.focus-mode')`));
  const collapsedLines = await evalJs(`document.querySelectorAll('.sheet-line').length`);
  check('默认只显示上下文（≤5 行）', collapsedLines > 0 && collapsedLines <= 5, `${collapsedLines} 行`);
  check('高亮在上下文中', await evalJs(`document.querySelectorAll('.sheet mark').length > 0`));
  await clickButton('展开完整书页');
  await sleep(300);
  const fullLines = await evalJs(`document.querySelectorAll('.sheet-line').length`);
  check('展开后为完整书页', fullLines === 80, `${fullLines} 行`);

  // 3. 翻页保持短链接且内容一致
  const s1 = await snapshot('检索结果页');
  await clickLink('下一页');
  await sleep(700);
  const s2 = await snapshot('下一页');
  check('下一页：URL 变化', s1.hash !== s2.hash);
  check('下一页：仍是短链接', s2.hash.length < 200, `长度 ${s2.hash.length}`);
  check('下一页：渲染与地址一致', s2.match);
  check('下一页：正文确实变化', s1.domLine !== s2.domLine);
  await clickLink('上一页');
  await sleep(700);
  const s3 = await snapshot('上一页');
  check('上一页：回到原地址', addressOfHash(s3.hash) === addressOfHash(s1.hash));

  // 4. Enter 换行；Ctrl+Enter 提交
  await goHome();
  await setTextarea('第一行');
  await evalJs(`(() => {
    const ta = document.querySelector('textarea');
    ta.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
    return true;
  })()`);
  await sleep(400);
  const afterEnter = await evalJs(`({
    v: document.querySelector('textarea').value,
    searching: !!document.querySelector('.reveal') || !!document.querySelector('.single-result'),
  })`);
  check('Enter 不触发定位', !afterEnter.searching && afterEnter.v === '第一行');
  await evalJs(`(() => {
    const ta = document.querySelector('textarea');
    ta.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', ctrlKey: true, bubbles: true, cancelable: true }));
    return true;
  })()`);
  await waitFor(`document.querySelector('.reveal') || document.querySelector('.single-result') || document.querySelector('.error')`, 8000);
  check('Ctrl+Enter 触发定位', true);

  // 5. 分段定位（超长粘贴）
  await goHome();
  await setTextarea('分段定位测试文。'.repeat(600));
  await clickButton('定位这句话');
  await waitFor(`[...document.querySelectorAll('.result')].some(r => r.textContent.includes('第 2 段'))`, 30000);
  check('超长文本自动分段定位（≥2 段）', true);
  await evalJs(`[...document.querySelectorAll('.result a')].find(a => a.textContent.includes('翻开这一页')).click(), true`);
  await waitFor(`document.querySelector('.sheet')`);
  check('分段结果打开后页面包含原文', await evalJs(`(document.querySelector('.sheet')?.textContent ?? '').includes('分段定位测试文')`));

  // 6. 语言池：只勾汉字
  await goHome();
  const poolCount = await evalJs(`document.querySelectorAll('.pool-item input').length`);
  for (let i = 0; i < poolCount; i++) {
    const label = await evalJs(`document.querySelectorAll('.pool-item')[${i}].textContent`);
    if (label.includes('汉字')) continue;
    await evalJs(`(() => {
      const box = document.querySelectorAll('.pool-item input')[${i}];
      if (box.checked) box.click();
      return true;
    })()`);
  }
  await setTextarea('我今天中午吃了火锅');
  await clickButton('定位这句话');
  await waitFor(`document.querySelector('.single-result')`, 15000);
  await evalJs(`document.querySelector('.single-result a.btn.primary').click(), true`);
  await waitFor(`document.querySelector('.sheet')`);
  const cjkRatio = await evalJs(`(() => {
    const text = document.querySelector('.sheet')?.textContent ?? '';
    const chars = [...text].filter(c => c.trim() !== '');
    const cjk = /[\\u{3400}-\\u{4DBF}\\u{4E00}-\\u{9FFF}\\u{F900}-\\u{FAFF}\\u{20000}-\\u{2EBEF}\\u{2F800}-\\u{2FA1F}\\u{30000}-\\u{3134F}]/u;
    return chars.filter(c => cjk.test(c)).length / chars.length;
  })()`);
  check('只勾汉字时上下文几乎全为汉字', cjkRatio > 0.9, `占比 ${(cjkRatio * 100).toFixed(1)}%`);

  // 7. 例句可直接定位
  await goHome();
  await waitFor(`document.querySelector('.example-chip')`);
  await evalJs(`document.querySelector('.example-chip').click(), true`);
  await waitFor(`document.querySelector('.single-result')`, 15000);
  check('例句点击可直接定位', true);

  // 8. 限定文本
  await goHome();
  await evalJs(`(() => {
    const cf = document.querySelector('.custom-fill-input');
    cf.value = '床前明月光疑是地上霜';
    cf.dispatchEvent(new Event('input', { bubbles: true }));
    return true;
  })()`);
  await setTextarea('明月光');
  await clickButton('定位这句话');
  await waitFor(`document.querySelector('.single-result')`, 15000);
  await evalJs(`document.querySelector('.single-result a.btn.primary').click(), true`);
  await waitFor(`document.querySelector('.sheet')`);
  const customOk = await evalJs(`(() => {
    const text = [...document.querySelectorAll('.sheet-line')].map(e => e.textContent).join('');
    const allowed = new Set([...'床前明月光疑是地上霜']);
    return [...text].every(c => allowed.has(c));
  })()`);
  check('限定文本：上下文只含《静夜思》字符', customOk);

  // 9. 暗色模式切换
  await goHome();
  const t1 = await evalJs(`document.documentElement.dataset.theme || 'light'`);
  await evalJs(`document.querySelector('.theme-toggle').click(), true`);
  const t2 = await evalJs(`document.documentElement.dataset.theme`);
  check('暗色模式切换', t1 !== t2, `${t1} → ${t2}`);
  await evalJs(`document.querySelector('.theme-toggle').click(), true`); // 还原

  // 10. 所属书籍
  await goHome();
  await setTextarea('我今天中午吃了火锅');
  await clickButton('定位这句话');
  await waitFor(`document.querySelector('.single-result')`, 15000);
  await evalJs(`document.querySelector('.single-result a.btn.primary').click(), true`);
  await waitFor(`document.querySelector('.sheet')`);
  await clickLink('所属书籍');
  await waitFor(`document.querySelector('.page-cell')`);
  const cellCount = await evalJs(`document.querySelectorAll('.page-cell').length`);
  check('书籍页列出页码', cellCount === 100, `${cellCount} 个页格`);
  await evalJs(`document.querySelector('.page-cell').click(), true`);
  await waitFor(`document.querySelector('.sheet')`);
  const cellHash = await evalJs(`location.hash`);
  check('页格为短链接', cellHash.length < 200, `长度 ${cellHash.length}`);

  // 11. 反向定位 → /v1/t/ 文字链接
  await Page.navigate({ url: `${BASE}#/about` });
  await waitFor(`document.querySelector('.rev-input')`);
  await evalJs(`(() => {
    const ta = document.querySelector('.rev-input');
    ta.value = '第一行文字\\n第二行文字\\n第三行文字';
    ta.dispatchEvent(new Event('input', { bubbles: true }));
    return true;
  })()`);
  await clickButton('算出坐标');
  await waitFor(`document.querySelector('.rev-result a')`);
  const revHref = await evalJs(`document.querySelector('.rev-result a').getAttribute('href')`);
  check('反向定位为 /v1/t/ 短链接', revHref.includes('#/v1/t/') && revHref.length < 200, revHref.slice(0, 40));
  await evalJs(`document.querySelector('.rev-result a').click(), true`);
  await waitFor(`document.querySelector('.sheet')`);
  check('文字页以原文开头', await evalJs(`(document.querySelector('.sheet')?.textContent ?? '').startsWith('第一行文字第二行文字第三行文字')`));

  // 12. 名著：连读 + 馆中此页（短路由）+ 章际导航
  await goHome();
  await waitFor(`document.querySelector('.classic-card')`);
  await evalJs(`[...document.querySelectorAll('.classic-card')].find(a => a.textContent.includes('道德经')).click(), true`);
  await waitFor(`document.querySelector('.reader-chapter')`);
  const readerCount = await evalJs(`document.querySelectorAll('.reader-chapter').length`);
  check('连读模式呈现全书', readerCount === 81, `${readerCount} 章`);
  await evalJs(`document.querySelector('.chapter-goto').click(), true`);
  await waitFor(`document.querySelector('.sheet')`);
  const classicHash = await evalJs(`location.hash`);
  check('名著章节为短路由', classicHash.startsWith('#/classic/') && classicHash.length < 60, classicHash.slice(0, 50));
  check('馆中此页包含该章原文', await evalJs(`(document.querySelector('.sheet')?.textContent ?? '').includes('道可道，非常道')`));
  await clickButton('下一章');
  await sleep(600);
  check('章际导航到第二章', await evalJs(`(document.querySelector('.sheet')?.textContent ?? '').includes('天下皆知美之為美')`));

  // 13. 辩护书（馆员索引）
  await goHome();
  await evalJs(`(() => {
    const vi = document.querySelector('.vname-input');
    vi.value = '张三';
    vi.dispatchEvent(new Event('input', { bubbles: true }));
    return true;
  })()`);
  await clickButton('寻找辩护书');
  await waitFor(`document.querySelector('.vindication-card')`);
  await evalJs(`[...document.querySelectorAll('.vindication-card a')].find(a => a.textContent.includes('翻开这一页')).click(), true`);
  await waitFor(`document.querySelector('.sheet')`);
  check('辩护书页包含辩护句', await evalJs(`(document.querySelector('.sheet')?.textContent ?? '').includes('张三的一生，已经得到辩护。')`));

  // 14. 今日之页：同日同一页
  await goHome();
  const dailyHref1 = await evalJs(`[...document.querySelectorAll('a')].find(a => a.textContent.includes('翻开今日之页'))?.getAttribute('href') ?? ''`);
  check('今日之页为 /v1/s/ 链接', dailyHref1.includes('#/v1/s/'), `href = ${dailyHref1.slice(0, 90)}`);
  await evalJs(`[...document.querySelectorAll('a')].find(a => a.textContent.includes('翻开今日之页')).click(), true`);
  await waitFor(`document.querySelector('.sheet')`);
  const dailyHash = await evalJs(`location.hash`);
  check('今日之页可打开', dailyHash.includes(dailyHref1.replace(/^#/, '')));

  // 15. 藏书夹
  await goHome();
  await setTextarea('藏书夹测试句子');
  await clickButton('定位这句话');
  await waitFor(`document.querySelector('.single-result')`, 15000);
  await evalJs(`document.querySelector('.single-result a.btn.primary').click(), true`);
  await waitFor(`document.querySelector('.sheet')`);
  await clickButton('收入藏书夹');
  await sleep(300);
  check('收藏后按钮变化', await evalJs(`[...document.querySelectorAll('button')].some(b => b.textContent.includes('移出藏书夹'))`));
  await clickLink('回到检索');
  await waitFor(`document.querySelector('.shelf-item')`);
  check('首页出现藏书条目', true);
  await evalJs(`document.querySelector('.shelf-item a').click(), true`);
  await waitFor(`document.querySelector('.sheet')`);
  check('藏书条目可打开', await evalJs(`(document.querySelector('.sheet')?.textContent ?? '').includes('藏书夹测试句子')`));

  // 16. 藏书票
  await clickButton('藏书票');
  await waitFor(`document.querySelector('.ticket-modal')`);
  const ticketSrc = await evalJs(`document.querySelector('.ticket-img')?.src ?? ''`);
  check('藏书票生成（PNG）', ticketSrc.startsWith('data:image/png'), ticketSrc.slice(0, 30));
  const ticketDl = await evalJs(`document.querySelector('.ticket-download')?.getAttribute('href') ?? ''`);
  check('藏书票可下载', ticketDl.startsWith('data:image/png'));
  await clickButton('收起');

  // 17. 真目录彩蛋
  await goHome();
  await setTextarea('图书馆是一个球体，它精确的中心是任何一个六边形，它的圆周是远不可及的。');
  await clickButton('定位这句话');
  await waitFor(`document.querySelector('.single-result')`, 15000);
  await evalJs(`document.querySelector('.single-result a.btn.primary').click(), true`);
  await waitFor(`document.querySelector('.sheet')`);
  const tcText = await evalJs(`document.querySelector('.true-catalogue-addr')?.textContent ?? ''`);
  check('真目录彩蛋：编号异常', tcText.includes('真目录'), tcText);
  const tcAphorism = await evalJs(`document.querySelector('.aphorism')?.textContent ?? ''`);
  check('真目录彩蛋：箴言异常', tcAphorism.includes('派生'), tcAphorism.trim());

  // 18. 朝圣计数
  await goHome();
  await clickButton('随意翻开一页');
  await waitFor(`document.querySelector('.sheet')`);
  const pilgrim = await evalJs(`document.querySelector('.pilgrimage')?.textContent ?? ''`);
  check('朝圣计数显示', pilgrim.includes('途经') && pilgrim.includes('朝圣'), pilgrim.trim().slice(0, 50));

  const errors = consoleMsgs.filter((m) => m.startsWith('[error]') || m.startsWith('[exception]') || m.startsWith('[warn]'));
  check('无 Vue 警告/异常', errors.length === 0, errors.slice(0, 5).join('\n'));
} catch (e) {
  failures.push('执行异常');
  console.error('E2E 执行异常:', e.message);
} finally {
  if (client) await client.close();
  browser.kill();
  await sleep(500);
  rmSync(PROFILE, { recursive: true, force: true });
}

console.log(failures.length === 0 ? '\n全部通过' : `\n${failures.length} 项失败`);
process.exit(failures.length === 0 ? 0 : 1);
