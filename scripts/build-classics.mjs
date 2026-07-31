// 从抓取的公版源（维基文库 wikitext / Gutenberg 纯文本）提取章节，
// 校验（长度、字符集合规）后生成 src/classics/books.ts。
// 运行：npx vite-node scripts/build-classics.mjs <tmpdir>
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { indexOfCodePoint } from '../src/core/alphabet';
import { PAGE_LEN } from '../src/core/codec';

const TMP = process.argv[2];

// ---------------------------------------------------------------------------
// wikitext 清理
// ---------------------------------------------------------------------------

/** 异文模板 {{另|正文|异文}} / {{另2|正文|异文}} → 取正文 */
function resolveVariants(s) {
  return s.replace(/\{\{另2?\|([^{}|]*)\|[^{}]*\}\}/g, '$1');
}

/** 嵌套感知的 {{...}} 移除 */
function stripTemplates(s) {
  let out = '';
  let depth = 0;
  for (let i = 0; i < s.length; i++) {
    if (s[i] === '{' && s[i + 1] === '{') {
      depth++;
      i++;
      continue;
    }
    if (s[i] === '}' && s[i + 1] === '}' && depth > 0) {
      depth--;
      i++;
      continue;
    }
    if (depth === 0) out += s[i];
  }
  return out;
}

function stripLinks(s) {
  return s
    .replace(/\[\[[^\]|]*\|([^\]]*)\]\]/g, '$1')
    .replace(/\[\[([^\]]*)\]\]/g, '$1');
}

function cleanWikiText(s) {
  s = resolveVariants(s);
  s = stripTemplates(s);
  s = stripLinks(s);
  s = s.replace(/<[^>]+>/g, '');
  s = s.replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&nbsp;/g, ' ');
  const lines = s
    .split('\n')
    .map((l) => l.trim().replace(/^[:;*#]+\s*/, '').trim())
    .filter((l) => l.length > 0);
  return lines.join('');
}

function readWikiText(file) {
  return JSON.parse(readFileSync(file, 'utf-8')).parse.wikitext;
}

/** 按 == 标题 == 切章，标题需匹配 pattern（捕获组为章名） */
function splitByHeadings(wiki, pattern) {
  const re = /^==\s*(.+?)\s*==$/gm;
  const heads = [];
  let m;
  while ((m = re.exec(wiki)) !== null) {
    const hm = m[1].match(pattern);
    if (hm) heads.push({ title: hm[1], end: m.index, start: m.index + m[0].length });
  }
  return heads.map((h, i) => ({
    title: h.title,
    text: cleanWikiText(wiki.slice(h.start, i + 1 < heads.length ? heads[i + 1].end : wiki.length)),
  }));
}

// ---------------------------------------------------------------------------
// 三份维基文库源
// ---------------------------------------------------------------------------

const ddjWiki = readWikiText(join(TMP, 'ddj.json'));
const daodejing = splitByHeadings(ddjWiki, /^([一二三四五六七八九十]+章)$/);

const sunziWiki = readWikiText(join(TMP, 'sunzi.json'));
const sunzi = splitByHeadings(sunziWiki, /^(\S+第[一二三四五六七八九十]+)$/);

const lunyuWiki = readWikiText(join(TMP, 'lunyu.json'));
const lunyu = (() => {
  const re = /<div id="(一之[一二三四五六七八九十]+)"[^>]*>'''[^']*'''<\/div>/g;
  const marks = [];
  let m;
  while ((m = re.exec(lunyuWiki)) !== null) {
    marks.push({ title: m[1], start: m.index + m[0].length, end: m.index });
  }
  return marks.map((mk, i) => ({
    title: mk.title,
    text: cleanWikiText(lunyuWiki.slice(mk.start, i + 1 < marks.length ? marks[i + 1].end : lunyuWiki.length)),
  }));
})();

// ---------------------------------------------------------------------------
// Gutenberg 莎士比亚十四行诗（按罗马数字序号切分）
// ---------------------------------------------------------------------------

const sonnets = (() => {
  const raw = readFileSync(join(TMP, 'sonnets.txt'), 'utf-8');
  const re = /^\s*([IVXLCDM]+)\s*$/gm;
  const marks = [];
  let m;
  while ((m = re.exec(raw)) !== null) marks.push({ start: m.index + m[0].length });
  const all = marks.map((mk, i) => {
    const body = raw.slice(mk.start, i + 1 < marks.length ? marks[i + 1].start : raw.length);
    const lines = body.split('\n').map((l) => l.trim()).filter((l) => l.length > 0);
    return lines.join(' / ');
  });
  if (all.length !== 154) throw new Error(`十四行诗应切出 154 首，实际 ${all.length}`);
  return [18, 29, 55, 116, 130].map((n) => ({ title: `Sonnet ${n}`, text: all[n - 1] }));
})();

// ---------------------------------------------------------------------------
// 唐诗十二首（通行本）
// ---------------------------------------------------------------------------

const tangPoems = [
  ['静夜思 · 李白', '床前明月光，疑是地上霜。举头望明月，低头思故乡。'],
  ['春晓 · 孟浩然', '春眠不觉晓，处处闻啼鸟。夜来风雨声，花落知多少。'],
  ['登鹳雀楼 · 王之涣', '白日依山尽，黄河入海流。欲穷千里目，更上一层楼。'],
  ['相思 · 王维', '红豆生南国，春来发几枝。愿君多采撷，此物最相思。'],
  ['鹿柴 · 王维', '空山不见人，但闻人语响。返景入深林，复照青苔上。'],
  ['绝句 · 杜甫', '两个黄鹂鸣翠柳，一行白鹭上青天。窗含西岭千秋雪，门泊东吴万里船。'],
  ['枫桥夜泊 · 张继', '月落乌啼霜满天，江枫渔火对愁眠。姑苏城外寒山寺，夜半钟声到客船。'],
  ['黄鹤楼送孟浩然之广陵 · 李白', '故人西辞黄鹤楼，烟花三月下扬州。孤帆远影碧空尽，唯见长江天际流。'],
  ['早发白帝城 · 李白', '朝辞白帝彩云间，千里江陵一日还。两岸猿声啼不住，轻舟已过万重山。'],
  ['望庐山瀑布 · 李白', '日照香炉生紫烟，遥看瀑布挂前川。飞流直下三千尺，疑是银河落九天。'],
  ['悯农 · 李绅', '锄禾日当午，汗滴禾下土。谁知盘中餐，粒粒皆辛苦。'],
  ['江雪 · 柳宗元', '千山鸟飞绝，万径人踪灭。孤舟蓑笠翁，独钓寒江雪。'],
].map(([title, text]) => ({ title, text }));

// ---------------------------------------------------------------------------
// 汇总与校验
// ---------------------------------------------------------------------------

const books = [
  {
    id: 'daodejing',
    title: '道德经',
    author: '老子（传）· 王弼本',
    note: '八十一章，每章一页。繁体原文，文本来自中文维基文库。',
    chapters: daodejing,
  },
  {
    id: 'sunzi',
    title: '孙子兵法',
    author: '孙武',
    note: '十三篇，每篇一页。繁体原文，文本来自中文维基文库。',
    chapters: sunzi,
  },
  {
    id: 'lunyu-xueer',
    title: '论语 · 学而第一',
    author: '孔子弟子及再传弟子',
    note: '十六章，每章一页。繁体原文，文本来自中文维基文库。',
    chapters: lunyu,
  },
  {
    id: 'tang-shi',
    title: '唐诗十二首',
    author: '李白、杜甫、王维 等',
    note: '通行本，每首一页。',
    chapters: tangPoems,
  },
  {
    id: 'sonnets',
    title: 'Shakespeare Sonnets',
    author: 'William Shakespeare',
    note: '十四行诗五首（18 / 29 / 55 / 116 / 130），每首一页。文本来自 Project Gutenberg。',
    chapters: sonnets,
  },
];

let bad = 0;
for (const b of books) {
  if (b.chapters.length === 0) {
    console.error(`✗ ${b.id}: 没有章节`);
    bad++;
    continue;
  }
  for (const c of b.chapters) {
    const len = [...c.text].length;
    if (len === 0 || len > PAGE_LEN) {
      console.error(`✗ ${b.id}/${c.title}: 长度 ${len} 越界`);
      bad++;
    }
    const invalid = new Set();
    for (const ch of c.text) {
      if (indexOfCodePoint(ch.codePointAt(0)) < 0) {
        invalid.add(`U+${ch.codePointAt(0).toString(16)}(${ch})`);
      }
    }
    if (invalid.size > 0) {
      console.error(`✗ ${b.id}/${c.title}: 不收录字符 ${[...invalid].slice(0, 8).join(' ')}`);
      bad++;
    }
  }
  console.log(`${bad ? '?' : '✓'} ${b.id}: ${b.chapters.length} 章`);
}
if (bad > 0) {
  console.error(`\n${bad} 处数据问题，中止`);
  process.exit(1);
}

const out = `// 本文件由 scripts/build-classics.mjs 生成，文本均为公版（维基文库 / Project Gutenberg）。
// 每章对应馆中一页；不足一页的部分在展示时以空白补足（fullPageAddress）。

export interface ClassicChapter {
  title: string;
  text: string;
}

export interface ClassicBook {
  id: string;
  title: string;
  author: string;
  note: string;
  chapters: ClassicChapter[];
}

export const CLASSICS: ClassicBook[] = ${JSON.stringify(books, null, 2)};
`;

const outFile = fileURLToPath(new URL('../src/classics/books.ts', import.meta.url));
mkdirSync(dirname(outFile), { recursive: true });
writeFileSync(outFile, out);
console.log('\n已生成 src/classics/books.ts');
