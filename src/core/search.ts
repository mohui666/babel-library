import { ALPHABET_SIZE, indexOfCodePoint } from './alphabet';
import { PAGE_LEN, addressOfIndices, indicesToText, textToIndices } from './codec';
import { addrToKey, coordsOfAddress, formatAddress } from './address';
import { POOLS, poolsForIds, poolFromText, idsToMask, maskToIds } from './pools';
import { bytesToB64u, b64uToBytes } from './base64';

// ---------------------------------------------------------------------------
// 检索：不是「找到」这句话，而是算出它必然所在的坐标。
// 做法：把查询放在随机位置，前后用随机字符填满整页，再编码成真实地址。
//
// 短链接原理：乱码填充由「种子确定性随机流」生成，因此检索结果和随机页
// 可以用一个几十字符的「配方」（种子+位置+池状态+检索词）完整重建——
// 配方算法与字符集一样，是永久链接契约的一部分，一经发布不可变更。
// ---------------------------------------------------------------------------

export interface ValidQuery {
  ok: true;
  query: string;
}

export interface InvalidQuery {
  ok: false;
  message: string;
  /** 不收录的字符（去重后），便于界面提供「剔除」操作 */
  badChars: string[];
}

export type QueryValidation = ValidQuery | InvalidQuery;

/** 不收录字符的展示形式：不可见字符（控制/格式/分行分段）只显示码位 */
function displayBadChar(ch: string): string {
  const cp = ch.codePointAt(0)!;
  const hex = `U+${cp.toString(16).toUpperCase()}`;
  if (/[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]/u.test(ch)) return `${hex}（不可见字符）`;
  return `${ch}（${hex}）`;
}

/** NFC 规范化 + 字符集校验（长度由调用方按「分段定位」处理，此处不设上限） */
export function validateQuery(raw: string): QueryValidation {
  const query = raw.normalize('NFC').trim();
  if (query.length === 0) {
    return { ok: false, message: '请先写下你要寻找的文字。', badChars: [] };
  }
  const chars = [...query];
  const bad: string[] = [];
  const seen = new Set<number>();
  for (const ch of chars) {
    const cp = ch.codePointAt(0)!;
    if (indexOfCodePoint(cp) < 0 && !seen.has(cp)) {
      seen.add(cp);
      bad.push(ch);
    }
  }
  if (bad.length > 0) {
    const preview = bad.slice(0, 10).map(displayBadChar).join('、');
    const more = bad.length > 10 ? ` 等 ${bad.length} 种` : '';
    return {
      ok: false,
      message: `本馆不收录这些符号：${preview}${more}。请删去后再检索。`,
      badChars: bad,
    };
  }
  return { ok: true, query };
}

// ---------------------------------------------------------------------------
// 随机流：24 位随机数 + 拒绝采样，避免取模偏差
// ---------------------------------------------------------------------------

const RAND_BITS = 1 << 24; // 3 字节
const RAND_LIMIT = Math.floor(RAND_BITS / ALPHABET_SIZE) * ALPHABET_SIZE;
const MASK64 = 0xffffffffffffffffn;

interface Uint24Source {
  nextUint24(): number;
}

function sourceIndex(src: Uint24Source): number {
  let v = src.nextUint24();
  while (v >= RAND_LIMIT) v = src.nextUint24();
  return v % ALPHABET_SIZE;
}

function sourceBelow(src: Uint24Source, n: number): number {
  return sourceIndex(src) % n; // n 远小于 ALPHABET_SIZE，偏差可忽略
}

/** 加密随机 64 位种子 */
function cryptoSeed(): bigint {
  const buf = new Uint8Array(8);
  crypto.getRandomValues(buf);
  let s = 0n;
  for (const b of buf) s = (s << 8n) | BigInt(b);
  return s;
}

/**
 * 种子确定性随机流（splitmix64，逐次取 64 位输出的高 24 位分块）。
 * 该流的格式属于短链接契约：变更会使所有既有短链接重建出不同的页面。
 */
export class SeededSource {
  private state: bigint;
  private reservoir = 0n;
  private bitsLeft = 0;

  constructor(seed: bigint) {
    this.state = seed & MASK64;
  }

  private next64(): bigint {
    this.state = (this.state + 0x9e3779b97f4a7c15n) & MASK64;
    let z = this.state;
    z = ((z ^ (z >> 30n)) * 0xbf58476d1ce4e5b9n) & MASK64;
    z = ((z ^ (z >> 27n)) * 0x94d049bb133111ebn) & MASK64;
    return z ^ (z >> 31n);
  }

  nextUint24(): number {
    if (this.bitsLeft < 24) {
      this.reservoir = this.next64();
      this.bitsLeft = 64;
    }
    this.bitsLeft -= 24;
    return Number((this.reservoir >> BigInt(this.bitsLeft)) & 0xffffffn);
  }
}

// ---------------------------------------------------------------------------
// 填充字符采样：默认全字符集均匀；勾选语言池子集时，
// 每个字符等概率先选池、池内按区间大小均匀（视觉上各语言都有存在感）。
// 若给定「限定文本」，乱码只使用该文本中出现过的字符（优先于语言池）。
// ---------------------------------------------------------------------------

function makeFillPicker(
  rng: Uint24Source,
  poolIds?: string[],
  customText?: string,
): () => number {
  const custom = customText?.trim() ? poolFromText(customText) : null;
  const pools = custom
    ? [custom]
    : poolIds && poolIds.length > 0 && poolIds.length < POOLS.length
      ? poolsForIds(poolIds).filter((p) => p.size > 0)
      : [];
  if (pools.length === 0) return () => sourceIndex(rng);
  return () => {
    const pool = pools[sourceBelow(rng, pools.length)];
    let v = sourceBelow(rng, pool.size);
    for (const [a, b] of pool.indexRanges) {
      const len = b - a + 1;
      if (v < len) return a + v;
      v -= len;
    }
    return pool.indexRanges[pool.indexRanges.length - 1][1]; // 不可达
  };
}

// ---------------------------------------------------------------------------
// 短链接「配方」：种子(8B) + 偏移(2B) + 池掩码(1B) + 限定文本长度(2B) +
// 限定文本(utf8) + 检索词(utf8) → base64url。几十字符即可完整重建一页。
// ---------------------------------------------------------------------------

export interface Recipe {
  seed: bigint;
  offset: number;
  poolMask: number;
  customText: string;
  query: string;
}

export function packRecipe(r: Recipe): string {
  const ct = new TextEncoder().encode(r.customText);
  const q = new TextEncoder().encode(r.query);
  const buf = new Uint8Array(13 + ct.length + q.length);
  let s = r.seed;
  for (let i = 7; i >= 0; i--) {
    buf[i] = Number(s & 0xffn);
    s >>= 8n;
  }
  buf[8] = (r.offset >> 8) & 0xff;
  buf[9] = r.offset & 0xff;
  buf[10] = r.poolMask & 0xff;
  buf[11] = (ct.length >> 8) & 0xff;
  buf[12] = ct.length & 0xff;
  buf.set(ct, 13);
  buf.set(q, 13 + ct.length);
  return bytesToB64u(buf);
}

export function unpackRecipe(packed: string): Recipe {
  const buf = b64uToBytes(packed);
  if (buf.length < 13) throw new Error('非法短链接');
  let seed = 0n;
  for (let i = 0; i < 8; i++) seed = (seed << 8n) | BigInt(buf[i]);
  const offset = (buf[8] << 8) | buf[9];
  const poolMask = buf[10];
  const ctLen = (buf[11] << 8) | buf[12];
  if (buf.length < 13 + ctLen) throw new Error('非法短链接');
  const customText = new TextDecoder().decode(buf.slice(13, 13 + ctLen));
  const query = new TextDecoder().decode(buf.slice(13 + ctLen));
  return { seed, offset, poolMask, customText, query };
}

/**
 * 由配方重建页面地址。取数顺序与 search/randomPage 完全一致
 * （先一次偏移取数、后整页填充），是短链接契约的核心。
 */
export function pageFromRecipe(r: Recipe): { address: bigint } {
  const qIdx = [...r.query].map((ch) => {
    const i = indexOfCodePoint(ch.codePointAt(0)!);
    if (i < 0) throw new Error('链接包含本馆不收录的字符');
    return i;
  });
  if (r.offset < 0 || r.offset + qIdx.length > PAGE_LEN) throw new Error('非法短链接');
  const src = new SeededSource(r.seed);
  const maxOffset = PAGE_LEN - qIdx.length;
  sourceBelow(src, maxOffset + 1); // 消耗偏移取数（结果即 r.offset）
  const pick = makeFillPicker(src, maskToIds(r.poolMask), r.customText || undefined);
  const page = new Array<number>(PAGE_LEN);
  for (let i = 0; i < PAGE_LEN; i++) page[i] = pick();
  for (let i = 0; i < qIdx.length; i++) page[r.offset + i] = qIdx[i];
  return { address: addressOfIndices(page) };
}

export interface SearchResult {
  /** 页地址的 URL key（规范长链接用） */
  key: string;
  /** 短链接路径（比规范链接短时提供） */
  shortPath?: string;
  /** 分层坐标文本 */
  addressText: string;
  /** 片段文本（含查询上下文） */
  snippet: string;
  /** 查询在片段内的起点与长度（码位下标） */
  markStart: number;
  markLen: number;
  /** 查询在整页内的起点（码位下标） */
  offset: number;
  query: string;
}

const SNIPPET_CONTEXT = 100;

export function search(
  query: string,
  count = 10,
  poolIds?: string[],
  customText?: string,
): SearchResult[] {
  const queryIndices: number[] = [];
  for (const ch of query) queryIndices.push(indexOfCodePoint(ch.codePointAt(0)!));
  const qLen = queryIndices.length;
  const maxOffset = PAGE_LEN - qLen;
  const poolMask = idsToMask(poolIds ?? POOLS.map((p) => p.id));
  const ct = customText?.trim() ?? '';

  const results: SearchResult[] = [];
  for (let r = 0; r < count; r++) {
    const seed = cryptoSeed();
    const src = new SeededSource(seed);
    const offset = maxOffset === 0 ? 0 : sourceBelow(src, maxOffset + 1);
    const pick = makeFillPicker(src, poolIds, customText);
    const page = new Array<number>(PAGE_LEN);
    for (let i = 0; i < PAGE_LEN; i++) page[i] = pick();
    for (let i = 0; i < qLen; i++) page[offset + i] = queryIndices[i];

    const address = addressOfIndices(page);
    const start = Math.max(0, offset - SNIPPET_CONTEXT);
    const end = Math.min(PAGE_LEN, offset + qLen + SNIPPET_CONTEXT);
    const key = addrToKey(address);
    const shortPath = `/s/${packRecipe({ seed, offset, poolMask, customText: ct, query })}`;
    results.push({
      key,
      shortPath: shortPath.length < `/page/${key}`.length ? shortPath : undefined,
      addressText: formatAddress(coordsOfAddress(address)),
      snippet: indicesToText(page.slice(start, end)),
      markStart: offset - start,
      markLen: qLen,
      offset,
      query,
    });
  }
  return results;
}

/** 整页文本 → 地址（不足一页以空格补足；超限或含不收录字符则抛错） */
export function fullPageAddress(text: string): bigint {
  const indices = textToIndices(text.normalize('NFC'));
  if (indices.length > PAGE_LEN) throw new Error(`超过一页（${PAGE_LEN} 字）`);
  while (indices.length < PAGE_LEN) indices.push(indexOfCodePoint(0x20));
  return addressOfIndices(indices);
}

/** 随机一页：与检索共用配方机制（空检索词），返回短链接 */
export function randomPage(
  poolIds?: string[],
  customText?: string,
): { key: string; shortPath: string; address: bigint } {
  const poolMask = idsToMask(poolIds ?? POOLS.map((p) => p.id));
  const ct = customText?.trim() ?? '';
  const seed = cryptoSeed();
  const src = new SeededSource(seed);
  sourceBelow(src, PAGE_LEN + 1); // 与 pageFromRecipe 空查询路径保持一致的取数顺序
  const pick = makeFillPicker(src, poolIds, customText);
  const page = new Array<number>(PAGE_LEN);
  for (let i = 0; i < PAGE_LEN; i++) page[i] = pick();
  const address = addressOfIndices(page);
  return {
    key: addrToKey(address),
    shortPath: `/s/${packRecipe({ seed, offset: 0, poolMask, customText: ct, query: '' })}`,
    address,
  };
}

// ---------------------------------------------------------------------------
// 分段定位：超过一页的文本切成若干段，每段各自定位到馆中一页。
// 换行符不收录于字符集，因此作为天然的分段边界（不计入任何一页）。
// ---------------------------------------------------------------------------

/** 单次分段定位的段数上限（防止浏览器被超长文本拖死） */
export const MAX_CHUNKS = 100;

export function codePointLen(s: string): number {
  let n = 0;
  for (const _ of s) n++;
  return n;
}

/**
 * 把长文本切成每段不超过 size 个码位的若干段。
 * 优先按行组装；单行超过 size 时按码位硬切。空行被跳过。
 * 注意：\n 仅作分段边界，不出现在任何段中。
 */
export function splitIntoChunks(text: string, size = PAGE_LEN): string[] {
  const lines = text.split('\n');
  const chunks: string[] = [];
  let current: string[] = [];
  let currentLen = 0;

  const flush = () => {
    if (current.length > 0) {
      chunks.push(current.join(''));
      current = [];
      currentLen = 0;
    }
  };

  for (const line of lines) {
    const chars = [...line];
    if (chars.length === 0) continue; // 空行
    if (chars.length > size) {
      // 超长单行：先结算当前段，再按码位硬切
      flush();
      for (let i = 0; i < chars.length; i += size) {
        chunks.push(chars.slice(i, i + size).join(''));
      }
      continue;
    }
    if (currentLen + chars.length > size) flush();
    current.push(line);
    currentLen += chars.length;
  }
  flush();
  return chunks;
}
