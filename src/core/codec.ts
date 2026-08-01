// ---------------------------------------------------------------------------
// v1 链接契约（冻结）。/v1 前缀下所有链接的解码依赖以下常量与算法，
// 一经发布不得变更；任何变更只能以 /v2 引入，且 /v1 解码器永久保留：
//   - 字符集：Unicode 16.0 可打印字符快照（alphabet-data.ts，154,826 字符）
//   - PAGE_LEN = 4000；地址分层（address.ts：1000/32/5/4/6 进制）
//   - CONTENT_K / PERMUTATION_K 及其种子、splitmix64 全宽常数生成
//   - 配方随机流（search.ts SeededSource 的取数格式）、语言池定义与顺序
//   - base64url 编码（base64.ts）
// ---------------------------------------------------------------------------
import { ALPHABET_SIZE, codePointAtIndex, indexOfCodePoint } from './alphabet';

/** 每页字符数（50 字 × 80 行） */
export const PAGE_LEN = 4000;
/** 字符集大小，即页编号的进制 */
export const BASE = BigInt(ALPHABET_SIZE);
/** 全部可能页的总数 M = |Σ|^PAGE_LEN */
export const SPACE_SIZE = BASE ** BigInt(PAGE_LEN);

// ---------------------------------------------------------------------------
// 两层可逆置换（均为「乘互素常数再取模」，靠扩展欧几里得求逆）：
//
// 1) CONTENT_K —— 内容打乱：contentNumber = pageNumber * CONTENT_K mod M。
//    没有它时页内容是页编号的直接进制展开，相邻页只相差末尾几个字符
//    （翻页像没翻）；乘上全宽常数后，相邻页的内容几乎逐位不同。
// 2) PERMUTATION_K —— 地址打乱：address = pageNumber * K mod M。
//    让 URL 里的地址看起来均匀随机，不暴露坐标的连续性。
//
// 常数由固定种子确定性求得（递增到与 M 互素为止），所有环境结果一致。
// ---------------------------------------------------------------------------

function gcd(a: bigint, b: bigint): bigint {
  let x = a < 0n ? -a : a;
  let y = b < 0n ? -b : b;
  while (y !== 0n) {
    const t = x % y;
    x = y;
    y = t;
  }
  return x;
}

/** 扩展欧几里得：求 K 在模 M 下的逆元（要求 gcd(K, M) = 1） */
function modInverse(k: bigint, m: bigint): bigint {
  let [oldR, r] = [k % m, m];
  let [oldS, s] = [1n, 0n];
  while (r !== 0n) {
    const q = oldR / r;
    [oldR, r] = [r, oldR - q * r];
    [oldS, s] = [s, oldS - q * s];
  }
  if (oldR !== 1n) throw new Error('K 与 M 不互素，无逆元');
  return ((oldS % m) + m) % m;
}

/** splitmix64 确定性随机流（BigInt 实现） */
function* splitmix64(seed: bigint): Generator<bigint> {
  const MASK = 0xffffffffffffffffn;
  let s = seed & MASK;
  while (true) {
    s = (s + 0x9e3779b97f4a7c15n) & MASK;
    let z = s;
    z = ((z ^ (z >> 30n)) * 0xbf58476d1ce4e5b9n) & MASK;
    z = ((z ^ (z >> 27n)) * 0x94d049bb133111ebn) & MASK;
    yield z ^ (z >> 31n);
  }
}

/**
 * 从种子确定性生成一个与 M 互素的「全宽」常数（位数与 M 相当）。
 * 全宽是关键：只有足够大的乘数才能让相邻页编号的内容逐位打乱；
 * 小常数只会让乘积的低位变化，高位（页面的开头部分）依然纹丝不动。
 */
function fullWidthCoprime(seed: bigint): bigint {
  const gen = splitmix64(seed);
  const bits = SPACE_SIZE.toString(2).length;
  const words = Math.ceil(bits / 64) + 1;
  let k = 0n;
  for (let i = 0; i < words; i++) {
    k |= gen.next().value << BigInt(64 * i);
  }
  k = (k % SPACE_SIZE) | 1n;
  while (gcd(k, SPACE_SIZE) !== 1n) k += 2n;
  return k;
}

const PERMUTATION_SEED = BigInt(
  '0x9e3779b97f4a7c15f39cc0605cedc8341082276bf3a27251f86c6a11d0c18e95',
);
const CONTENT_SEED = BigInt(
  '0xc2b2ae3d27d4eb4f1da9781a46f6b7c5829f1b3a1e0e1e57b0c0ffee15a5a5a5',
);

export const PERMUTATION_K: bigint = fullWidthCoprime(PERMUTATION_SEED);
const PERMUTATION_K_INV = modInverse(PERMUTATION_K, SPACE_SIZE);

const CONTENT_K: bigint = fullWidthCoprime(CONTENT_SEED);
const CONTENT_K_INV = modInverse(CONTENT_K, SPACE_SIZE);

export function permute(pageNumber: bigint): bigint {
  return (pageNumber * PERMUTATION_K) % SPACE_SIZE;
}

export function permuteInv(address: bigint): bigint {
  return (address * PERMUTATION_K_INV) % SPACE_SIZE;
}

/** 页编号 → 内容编号（打乱：相邻页内容几乎逐位不同） */
function contentNumber(pageNumber: bigint): bigint {
  return (pageNumber * CONTENT_K) % SPACE_SIZE;
}

/** 内容编号 → 页编号（contentNumber 的逆运算） */
function pageNumberOfContent(contentNum: bigint): bigint {
  return (contentNum * CONTENT_K_INV) % SPACE_SIZE;
}

// ---------------------------------------------------------------------------
// 页内容 ⇔ 页编号：一页的 PAGE_LEN 个字符即一个 |Σ| 进制的 PAGE_LEN 位大整数
// ---------------------------------------------------------------------------

export function indicesToNumber(indices: number[]): bigint {
  if (indices.length !== PAGE_LEN) {
    throw new Error(`一页必须是 ${PAGE_LEN} 个字符，得到 ${indices.length}`);
  }
  let n = 0n;
  for (const i of indices) {
    if (i < 0 || i >= ALPHABET_SIZE) throw new Error(`非法字符序号 ${i}`);
    n = n * BASE + BigInt(i);
  }
  return n;
}

export function numberToIndices(n: bigint): number[] {
  if (n < 0n || n >= SPACE_SIZE) throw new RangeError('页编号超出范围');
  const indices = new Array<number>(PAGE_LEN);
  let rest = n;
  for (let i = PAGE_LEN - 1; i >= 0; i--) {
    indices[i] = Number(rest % BASE);
    rest /= BASE;
  }
  return indices;
}

/** 文本 → 字符序号数组（按码位迭代）；含字符集外字符时抛出 */
export function textToIndices(text: string): number[] {
  const indices: number[] = [];
  for (const ch of text) {
    const cp = ch.codePointAt(0)!;
    const idx = indexOfCodePoint(cp);
    if (idx < 0) {
      throw new Error(`字符集外字符 U+${cp.toString(16)}（${ch}）`);
    }
    indices.push(idx);
  }
  return indices;
}

export function indicesToText(indices: number[]): string {
  let out = '';
  for (const i of indices) {
    const cp = codePointAtIndex(i);
    if (cp < 0) throw new Error(`非法字符序号 ${i}`);
    out += String.fromCodePoint(cp);
  }
  return out;
}

// ---------------------------------------------------------------------------
// 对外组合接口：地址（置换后的页编号）⇔ 页内容
// ---------------------------------------------------------------------------

/** 页内容（序号数组）→ 地址 */
export function addressOfIndices(indices: number[]): bigint {
  return permute(pageNumberOfContent(indicesToNumber(indices)));
}

/** 地址 → 页内容（序号数组） */
export function indicesOfAddress(address: bigint): number[] {
  return numberToIndices(contentNumber(permuteInv(address)));
}

/** 地址 → 页文本 */
export function textOfAddress(address: bigint): string {
  return indicesToText(indicesOfAddress(address));
}

/** 整页文本（必须恰好 PAGE_LEN 个码位）→ 地址 */
export function addressOfText(text: string): bigint {
  return addressOfIndices(textToIndices(text));
}
