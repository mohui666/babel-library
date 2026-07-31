import { RANGES } from './alphabet-data';
import { indexOfCodePoint } from './alphabet';

// ---------------------------------------------------------------------------
// 语言池：检索结果中「乱码填充」部分的字符来源。
// 每个池用 Unicode 码位区间定义，与可打印字符集求交后得到字符序号区间。
// 检索词本身不受池限制——池只影响填充，不影响你能找什么。
// ---------------------------------------------------------------------------

export interface PoolDef {
  id: string;
  label: string;
  cpRanges: readonly (readonly [number, number])[];
}

export const POOL_DEFS: PoolDef[] = [
  {
    id: 'cjk',
    label: '汉字',
    cpRanges: [
      [0x3400, 0x4dbf], // 扩展 A
      [0x4e00, 0x9fff], // 基本区
      [0xf900, 0xfaff], // 兼容
      [0x20000, 0x2a6df], // 扩展 B
      [0x2a700, 0x2b73f],
      [0x2b740, 0x2b81f],
      [0x2b820, 0x2ceaf],
      [0x2ceb0, 0x2ebef],
      [0x30000, 0x3134f], // 扩展 G/H
      [0x2f800, 0x2fa1f], // 兼容补充
    ],
  },
  {
    id: 'latin',
    label: '拉丁字母',
    cpRanges: [
      [0x41, 0x5a],
      [0x61, 0x7a],
      [0xc0, 0xff], // 拉丁-1 补充（跳过 ×÷）
      [0x100, 0x17f], // 扩展 A
      [0x180, 0x24f], // 扩展 B
      [0x1e00, 0x1eff], // 扩展增补
    ],
  },
  {
    id: 'kana',
    label: '日文假名',
    cpRanges: [
      [0x3040, 0x309f], // 平假名
      [0x30a0, 0x30ff], // 片假名
      [0x31f0, 0x31ff], // 扩展片假名
      [0xff66, 0xff9d], // 半角片假名
    ],
  },
  {
    id: 'hangul',
    label: '韩文',
    cpRanges: [
      [0x1100, 0x11ff], // 字母
      [0x3130, 0x318f], // 兼容字母
      [0xac00, 0xd7af], // 音节
      [0xa960, 0xa97f],
      [0xd7b0, 0xd7fb],
    ],
  },
  {
    id: 'cyrillic',
    label: '西里尔文',
    cpRanges: [
      [0x400, 0x52f],
      [0x1c80, 0x1c8f],
      [0x2de0, 0x2dff],
      [0xa640, 0xa69f],
    ],
  },
  {
    id: 'arabic',
    label: '阿拉伯文',
    cpRanges: [
      [0x600, 0x6ff],
      [0x750, 0x77f],
      [0x870, 0x89f],
      [0x8a0, 0x8ff],
      [0xfb50, 0xfdff],
      [0xfe70, 0xfeff],
    ],
  },
  {
    id: 'punct',
    label: '数字与标点',
    cpRanges: [
      [0x20, 0x40], // 空格、常用标点、数字
      [0x5b, 0x60],
      [0x7b, 0x7e],
      [0x2000, 0x206f], // 广义标点
      [0x3000, 0x303f], // CJK 标点
      [0xff01, 0xff65], // 全角标点与全角英数
    ],
  },
  {
    id: 'emoji',
    label: 'emoji 与符号',
    cpRanges: [
      [0x2190, 0x2bff], // 箭头、数学、技术符号、装饰符
      [0x1f000, 0x1faff], // emoji 各区块
    ],
  },
];

export interface Pool {
  id: string;
  label: string;
  /** 在字符集中的序号区间（已按字符集求交并合并） */
  indexRanges: [number, number][];
  size: number;
}

function mergeRanges(ranges: [number, number][]): [number, number][] {
  const sorted = [...ranges].sort((x, y) => x[0] - y[0]);
  const out: [number, number][] = [];
  for (const [s, e] of sorted) {
    const last = out[out.length - 1];
    if (last && s <= last[1] + 1) last[1] = Math.max(last[1], e);
    else out.push([s, e]);
  }
  return out;
}

/** 池码位区间 ∩ 字符集区间 → 字符序号区间 */
function toIndexRanges(cpRanges: readonly (readonly [number, number])[]): [number, number][] {
  const out: [number, number][] = [];
  let startIndex = 0;
  for (const [rs, re] of RANGES) {
    for (const [ps, pe] of cpRanges) {
      const s = Math.max(rs, ps);
      const e = Math.min(re, pe);
      if (s <= e) out.push([startIndex + (s - rs), startIndex + (e - rs)]);
    }
    startIndex += re - rs + 1;
  }
  return mergeRanges(out);
}

export const POOLS: Pool[] = POOL_DEFS.map((d) => {
  const indexRanges = toIndexRanges(d.cpRanges);
  return {
    id: d.id,
    label: d.label,
    indexRanges,
    size: indexRanges.reduce((s, [a, b]) => s + (b - a + 1), 0),
  };
});

export function poolsForIds(ids: string[]): Pool[] {
  return POOLS.filter((p) => ids.includes(p.id));
}

export function isIndexInPools(index: number, pools: Pool[]): boolean {
  return pools.some((p) => p.indexRanges.some(([a, b]) => index >= a && index <= b));
}

// ---------------------------------------------------------------------------
// 池选择 ⇔ 位掩码（打进短链接配方；池顺序即契约，新增池只能追加）
// ---------------------------------------------------------------------------

export function idsToMask(ids: string[]): number {
  let mask = 0;
  POOLS.forEach((p, i) => {
    if (ids.includes(p.id)) mask |= 1 << i;
  });
  return mask;
}

export function maskToIds(mask: number): string[] {
  return POOLS.filter((_, i) => (mask & (1 << i)) !== 0).map((p) => p.id);
}

/** 从用户给定文本构造自定义池：取其中被字符集收录的不同字符 */
export function poolFromText(text: string, label = '限定文本'): Pool | null {
  const indices = new Set<number>();
  for (const ch of text.normalize('NFC')) {
    const idx = indexOfCodePoint(ch.codePointAt(0)!);
    if (idx >= 0) indices.add(idx);
  }
  if (indices.size === 0) return null;
  const sorted = [...indices].sort((a, b) => a - b);
  const indexRanges: [number, number][] = [];
  let s = sorted[0];
  let prev = sorted[0];
  for (let i = 1; i < sorted.length; i++) {
    if (sorted[i] === prev + 1) {
      prev = sorted[i];
      continue;
    }
    indexRanges.push([s, prev]);
    s = sorted[i];
    prev = sorted[i];
  }
  indexRanges.push([s, prev]);
  return { id: 'custom', label, indexRanges, size: indices.size };
}
