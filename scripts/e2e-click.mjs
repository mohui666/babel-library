// 端到端复现（带诊断）：真实浏览器走「检索 → 翻开 → 下一页 → 上一页」，
// 并用核心算法在脚本侧独立解码 URL，比对页面实际渲染是否一致。
// 运行：npx vite-node scripts/e2e-click.mjs （需 dev server 在 5173）
import { spawn } from 'node:child_process';
import { rmSync } from 'node:fs';
import { resolve } from 'node:path';
import CDP from 'chrome-remote-interface';
import { textOfAddress } from '../src/core/codec';
import { keyToAddr } from '../src/core/address';
import { unpackRecipe, pageFromRecipe } from '../src/core/search';

const EDGE = 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
const BASE = 'http://localhost:5173/';
const PORT = 9333;
const PROFILE = resolve('.e2e-profile');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const browser = spawn(EDGE, [
  '--headless=new',
  '--disable-gpu',
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

/** 从 location.hash 解析出页地址（支持短链接 /s/ 与规范链接 /page/） */
function addressOfHash(hash) {
  const clean = hash.split('?')[0];
  if (clean.startsWith('#/s/')) return pageFromRecipe(unpackRecipe(clean.slice(4))).address;
  if (clean.startsWith('#/page/')) return keyToAddr(clean.slice(7));
  throw new Error(`未知路由: ${hash.slice(0, 50)}`);
}

/** 从 location.hash 算出这页「应该有」的第一行文本 */
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
    consoleMsgs.push(`[exception] ${e.exceptionDetails?.exception?.description ?? e.exceptionDetails?.text}`.slice(0, 300));
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

  async function waitFor(expr, timeout = 10000) {
    const t0 = Date.now();
    while (Date.now() - t0 < timeout) {
      if (await evalJs(`!!(${expr})`)) return true;
      await sleep(200);
    }
    throw new Error(`等待超时: ${expr}`);
  }

  async function snapshot(label) {
    const hash = await evalJs(`location.hash`);
    const pos = await evalJs(`document.querySelector('.page-pos')?.textContent ?? '(无)'`);
    const domLine = await evalJs(`document.querySelector('.sheet-line')?.textContent ?? '(无)'`);
    let expect = '(无法解码)';
    let match = false;
    try {
      expect = expectedLine(hash);
      match = domLine === expect;
    } catch (e) {
      expect = `(解码出错: ${e.message})`;
    }
    console.log(`--- 快照 ${label}`);
    console.log(`    hash(尾部): …${hash.slice(-24)}`);
    console.log(`    页码: ${pos.trim()}`);
    console.log(`    页面渲染首行: ${domLine.slice(0, 30)}…`);
    console.log(`    地址应有首行: ${expect.slice(0, 30)}…`);
    console.log(`    渲染与地址一致: ${match}`);
    return { hash, pos: pos.trim(), domLine, match };
  }

  // 1. 检索
  await Page.navigate({ url: BASE });
  await Page.loadEventFired();
  await waitFor(`document.querySelector('textarea')`);
  await evalJs(`(() => {
    const ta = document.querySelector('textarea');
    ta.value = '我今天中午吃了火锅';
    ta.dispatchEvent(new Event('input', { bubbles: true }));
    return true;
  })()`);
  await evalJs(`[...document.querySelectorAll('button')].find(b => b.textContent.includes('检索全馆')).click(), true`);
  await waitFor(`document.querySelectorAll('.result').length === 10`);

  // 2. 打开第一个结果（应为一个很短的链接）
  const href = await evalJs(
    `[...document.querySelectorAll('.result a')].find(a => a.textContent.includes('翻开这一页')).getAttribute('href')`,
  );
  check(
    '检索结果为短链接',
    href.includes('#/s/') && href.length < 200,
    `链接长度 ${href.length}`,
  );
  await evalJs(`[...document.querySelectorAll('a')].find(a => a.textContent.includes('翻开这一页')).click(), true`);
  await waitFor(`document.querySelector('.sheet')`);
  const s1 = await snapshot('打开检索结果');

  // 3. 下一页
  await evalJs(`[...document.querySelectorAll('a')].find(a => a.textContent.includes('下一页')).click(), true`);
  await sleep(800);
  const s2 = await snapshot('点击下一页后');

  check('下一页：URL 变化', s1.hash !== s2.hash);
  check('下一页：页码 +1', s1.pos !== s2.pos, `${s1.pos} → ${s2.pos}`);
  check('下一页：正文与地址一致', s2.match);
  check('下一页：正文确实变化', s1.domLine !== s2.domLine);

  // 4. 上一页应回到原页
  await evalJs(`[...document.querySelectorAll('a')].find(a => a.textContent.includes('上一页')).click(), true`);
  await sleep(800);
  const s3 = await snapshot('点击上一页后');
  check(
    '上一页：回到原地址',
    addressOfHash(s3.hash) === addressOfHash(s1.hash),
    `期望地址 …${addressOfHash(s1.hash).toString(16).slice(-16)} 实际 …${addressOfHash(s3.hash).toString(16).slice(-16)}`,
  );
  check('上一页：正文与地址一致', s3.match);

  // 5. 分段定位：粘贴超过一页的文本
  await Page.navigate({ url: BASE });
  await Page.loadEventFired();
  await waitFor(`document.querySelector('textarea')`);
  await evalJs(`(() => {
    const ta = document.querySelector('textarea');
    ta.value = '分段定位测试文。'.repeat(600); // 4800 字，超过一页
    ta.dispatchEvent(new Event('input', { bubbles: true }));
    return true;
  })()`);
  await evalJs(`[...document.querySelectorAll('button')].find(b => b.textContent.includes('检索全馆')).click(), true`);
  await waitFor(`[...document.querySelectorAll('.result')].some(r => r.textContent.includes('第 2 段'))`, 30000);
  check('超长文本自动分段定位（≥2 段）', true);
  await evalJs(`[...document.querySelectorAll('.result a')].find(a => a.textContent.includes('翻开这一页')).click(), true`);
  await waitFor(`document.querySelector('.sheet')`);
  const chunkPageText = await evalJs(`document.querySelector('.sheet')?.textContent ?? ''`);
  check('分段结果打开后页面包含原文', chunkPageText.includes('分段定位测试文'));

  // 6. 语言池筛选：只勾选「汉字」，填充应全部为汉字
  await Page.navigate({ url: BASE });
  await Page.loadEventFired();
  await waitFor(`document.querySelector('textarea')`);
  await evalJs(`(() => {
    const ta = document.querySelector('textarea');
    ta.value = '我今天中午吃了火锅';
    ta.dispatchEvent(new Event('input', { bubbles: true }));
    return true;
  })()`);
  // 逐个取消勾选「汉字」以外的池（分次执行，让 Vue 完成每轮更新）
  const poolCount = await evalJs(`document.querySelectorAll('.pool-item input').length`);
  for (let i = 0; i < poolCount; i++) {
    const label = await evalJs(
      `document.querySelectorAll('.pool-item')[${i}].textContent`,
    );
    if (label.includes('汉字')) continue;
    await evalJs(`(() => {
      const box = document.querySelectorAll('.pool-item input')[${i}];
      if (box.checked) box.click();
      return true;
    })()`);
  }
  await evalJs(`[...document.querySelectorAll('button')].find(b => b.textContent.includes('检索全馆')).click(), true`);
  await waitFor(`document.querySelectorAll('.result').length === 10`);
  const checkedLabels = await evalJs(
    `[...document.querySelectorAll('.pool-item input:checked')].map(c => c.parentElement.textContent.trim()).join(',')`,
  );
  console.log('    [诊断] 检索时勾选的池:', checkedLabels);
  await evalJs(`[...document.querySelectorAll('.result a')].find(a => a.textContent.includes('翻开这一页')).click(), true`);
  await waitFor(`document.querySelector('.sheet')`);
  const cjkRatio = await evalJs(`(() => {
    const text = document.querySelector('.sheet')?.textContent ?? '';
    const chars = [...text].filter(c => c.trim() !== '');
    const cjk = /[\\u{3400}-\\u{4DBF}\\u{4E00}-\\u{9FFF}\\u{F900}-\\u{FAFF}\\u{20000}-\\u{2EBEF}\\u{2F800}-\\u{2FA1F}\\u{30000}-\\u{3134F}]/u;
    const hit = chars.filter(c => cjk.test(c)).length;
    return hit / chars.length;
  })()`);
  check('只勾汉字时页面几乎全为汉字', cjkRatio > 0.95, `汉字占比 ${(cjkRatio * 100).toFixed(1)}%`);

  // 7. 例句引导：点击例句直接出结果
  await Page.navigate({ url: BASE });
  await Page.loadEventFired();
  await waitFor(`document.querySelector('.example-chip')`);
  await evalJs(`document.querySelector('.example-chip').click(), true`);
  await waitFor(`document.querySelectorAll('.result').length === 10`);
  check('例句点击可直接检索', true);

  // 8. 聚焦模式 + 动态标题：打开结果 → 只看原句 → 标题含坐标
  await evalJs(`[...document.querySelectorAll('.result a')].find(a => a.textContent.includes('翻开这一页')).click(), true`);
  await waitFor(`document.querySelector('.sheet mark')`);
  await evalJs(`[...document.querySelectorAll('button')].find(b => b.textContent.includes('只看原句')).click(), true`);
  await sleep(300);
  check('「只看原句」聚焦模式生效', await evalJs(`!!document.querySelector('.sheet.focus-mode')`));
  const title = await evalJs(`document.title`);
  check('动态标题含坐标', title.includes('馆') && title.includes('巴别图书馆'), title.slice(0, 60));

  // 9. 限定文本：乱码只使用《静夜思》的字符
  await Page.navigate({ url: BASE });
  await Page.loadEventFired();
  await waitFor(`document.querySelector('textarea')`);
  await evalJs(`(() => {
    const cf = document.querySelector('.custom-fill-input');
    cf.value = '床前明月光疑是地上霜';
    cf.dispatchEvent(new Event('input', { bubbles: true }));
    const ta = document.querySelector('textarea');
    ta.value = '明月光';
    ta.dispatchEvent(new Event('input', { bubbles: true }));
    return true;
  })()`);
  await evalJs(`[...document.querySelectorAll('button')].find(b => b.textContent.includes('检索全馆')).click(), true`);
  await waitFor(`document.querySelectorAll('.result').length === 10`);
  await evalJs(`[...document.querySelectorAll('.result a')].find(a => a.textContent.includes('翻开这一页')).click(), true`);
  await waitFor(`document.querySelector('.sheet')`);
  const customOk = await evalJs(`(() => {
    const text = document.querySelector('.sheet')?.textContent ?? '';
    const allowed = new Set([...'床前明月光疑是地上霜\\n']);
    return [...text].every(c => allowed.has(c));
  })()`);
  check('限定文本：整页只含《静夜思》字符', customOk);

  // 10. 暗色模式切换
  await Page.navigate({ url: BASE });
  await Page.loadEventFired();
  await waitFor(`document.querySelector('.theme-toggle')`);
  const t1 = await evalJs(`document.documentElement.dataset.theme || 'light'`);
  await evalJs(`document.querySelector('.theme-toggle').click(), true`);
  const t2 = await evalJs(`document.documentElement.dataset.theme`);
  check('暗色模式切换', t1 !== t2, `${t1} → ${t2}`);

  // 11. 所属书籍：检索 → 打开结果 → 所属书籍 → 打开页格
  await Page.navigate({ url: BASE });
  await Page.loadEventFired();
  await waitFor(`document.querySelector('textarea')`);
  await evalJs(`(() => {
    const ta = document.querySelector('textarea');
    ta.value = '我今天中午吃了火锅';
    ta.dispatchEvent(new Event('input', { bubbles: true }));
    return true;
  })()`);
  await evalJs(`[...document.querySelectorAll('button')].find(b => b.textContent.includes('检索全馆')).click(), true`);
  await waitFor(`document.querySelectorAll('.result').length === 10`);
  await evalJs(`[...document.querySelectorAll('.result a')].find(a => a.textContent.includes('翻开这一页')).click(), true`);
  await waitFor(`document.querySelector('.sheet')`);
  await evalJs(`[...document.querySelectorAll('a')].find(a => a.textContent.includes('所属书籍')).click(), true`);
  await waitFor(`document.querySelector('.page-cell')`);
  const bookTitle = await evalJs(`document.querySelector('.addr.full')?.textContent ?? ''`);
  check('所属书籍页打开', bookTitle.includes('册'), bookTitle.slice(0, 50));
  const cellCount = await evalJs(`document.querySelectorAll('.page-cell').length`);
  check('书籍页列出页码', cellCount === 100, `${cellCount} 个页格`);
  await evalJs(`document.querySelector('.page-cell').click(), true`);
  await waitFor(`document.querySelector('.sheet')`);
  check('从书籍页打开书页', true);

  // 12. 反向定位：多行文本应自动忽略换行并给出坐标
  await Page.navigate({ url: `${BASE}#/about` });
  await Page.loadEventFired();
  await waitFor(`document.querySelector('.rev-input')`);
  await evalJs(`(() => {
    const ta = document.querySelector('.rev-input');
    ta.value = '第一行文字\\n第二行文字\\n第三行文字';
    ta.dispatchEvent(new Event('input', { bubbles: true }));
    return true;
  })()`);
  await evalJs(`[...document.querySelectorAll('button')].find(b => b.textContent.includes('算出坐标')).click(), true`);
  await waitFor(`document.querySelector('.rev-result a')`);
  check('反向定位接受多行文本', true);
  await evalJs(`document.querySelector('.rev-result a').click(), true`);
  await waitFor(`document.querySelector('.sheet')`);
  const revText = await evalJs(`document.querySelector('.sheet')?.textContent ?? ''`);
  check('反向定位的页包含原文（换行已忽略）', revText.startsWith('第一行文字第二行文字第三行文字'));

  // 13. 馆藏名著：首页 → 道德经 → 第一章 → 页面包含原文
  await Page.navigate({ url: BASE });
  await Page.loadEventFired();
  await waitFor(`document.querySelector('.classic-card')`);
  await evalJs(`[...document.querySelectorAll('.classic-card')].find(a => a.textContent.includes('道德经')).click(), true`);
  await waitFor(`document.querySelector('.chapter-row')`);
  const chapCount = await evalJs(`document.querySelectorAll('.chapter-row').length`);
  check('名著章节列表（道德经 81 章）', chapCount === 81, `${chapCount} 章`);
  await evalJs(`document.querySelector('.chapter-row').click(), true`);
  await waitFor(`document.querySelector('.sheet')`);
  const ddjText = await evalJs(`document.querySelector('.sheet')?.textContent ?? ''`);
  check('名著页包含原文', ddjText.includes('道可道，非常道'));

  // 14. 辩护书：输入名字 → 找到为你一生辩护的一页
  await Page.navigate({ url: BASE });
  await Page.loadEventFired();
  await waitFor(`document.querySelector('.vname-input')`);
  await evalJs(`(() => {
    const vi = document.querySelector('.vname-input');
    vi.value = '张三';
    vi.dispatchEvent(new Event('input', { bubbles: true }));
    return true;
  })()`);
  await evalJs(`[...document.querySelectorAll('button')].find(b => b.textContent.includes('寻找我的辩护书')).click(), true`);
  await waitFor(`document.querySelector('.vindication-card')`);
  check('辩护书卡片出现', true);
  await evalJs(`[...document.querySelectorAll('.vindication-card a')].find(a => a.textContent.includes('翻开你的辩护书')).click(), true`);
  await waitFor(`document.querySelector('.sheet')`);
  const vText = await evalJs(`document.querySelector('.sheet')?.textContent ?? ''`);
  check('辩护书页包含辩护句', vText.includes('张三的一生，已经得到辩护。'));

  // 15. 朝圣计数：随意翻阅后显示途经页数
  await Page.navigate({ url: BASE });
  await Page.loadEventFired();
  await waitFor(`document.querySelector('textarea')`);
  await evalJs(`[...document.querySelectorAll('button')].find(b => b.textContent.includes('随意翻阅')).click(), true`);
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
