// 生成站点级 OG 分享图 public/og.png（1200×630，headless Edge 截图）
// 运行：node scripts/make-og.mjs
import { spawn } from 'node:child_process';
import { writeFileSync, rmSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const EDGE = 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
const OUT = resolve('public/og.png');

const HTML = `<!DOCTYPE html>
<html><head><meta charset="utf-8"><style>
  * { margin: 0; box-sizing: border-box; }
  body {
    width: 1200px; height: 630px; background: #f4efe3; color: #2b2a25;
    font-family: Georgia, 'Songti SC', 'SimSun', serif;
    position: relative; overflow: hidden;
  }
  .frame { position: absolute; inset: 26px; border: 3px solid #8a7f66; }
  .frame2 { position: absolute; inset: 36px; border: 1px solid #8a7f66; }
  .inner { position: absolute; inset: 0; display: flex; flex-direction: column;
    align-items: center; justify-content: center; text-align: center; padding: 0 90px; }
  h1 { font-size: 84px; letter-spacing: 0.28em; font-weight: 700; }
  .line { margin-top: 34px; font-size: 34px; color: #6b675c; letter-spacing: 0.08em; }
  .addr { margin-top: 46px; font-size: 24px; color: #9e2b1b; letter-spacing: 0.12em; }
  .seal { position: absolute; right: 90px; bottom: 70px; width: 120px; height: 120px;
    background: rgba(158,43,27,.92); transform: rotate(-8deg);
    display: grid; grid-template-columns: 1fr 1fr; align-items: center; justify-items: center; }
  .seal span { color: #f4efe3; font-size: 44px; }
</style></head><body>
  <div class="frame"></div><div class="frame2"></div>
  <div class="inner">
    <h1>巴別圖書館</h1>
    <p class="line">你写下的任何一句话，都早已存在于某一页。</p>
    <p class="addr">检索不是寻找，是定位 · 一座包含所有可能文本的无限图书馆</p>
  </div>
  <div class="seal"><span>巴</span><span>別</span><span>藏</span><span>書</span></div>
</body></html>`;

const dir = mkdtempSync(join(tmpdir(), 'og-'));
const htmlPath = join(dir, 'og.html');
writeFileSync(htmlPath, HTML);

const args = [
  '--headless=new',
  '--disable-gpu',
  '--no-first-run',
  '--no-default-browser-check',
  `--user-data-dir=${join(dir, 'profile')}`,
  `--screenshot=${OUT}`,
  '--window-size=1200,630',
  '--hide-scrollbars',
  `file:///${htmlPath.replace(/\\/g, '/')}`,
];

const p = spawn(EDGE, args, { stdio: 'ignore' });
p.on('exit', (code) => {
  rmSync(dir, { recursive: true, force: true });
  if (code === 0) console.log(`已生成 ${OUT}`);
  else {
    console.error(`截图失败，退出码 ${code}`);
    process.exit(1);
  }
});
