import { RANGES, ALPHABET_SIZE, UNICODE_VERSION } from './alphabet-data';

export { ALPHABET_SIZE, UNICODE_VERSION };

// 每个区间的起始码位与起始序号（前缀和），供二分查找
const rangeStartCp: number[] = new Array(RANGES.length);
const rangeStartIndex: number[] = new Array(RANGES.length);
let acc = 0;
for (let i = 0; i < RANGES.length; i++) {
  rangeStartCp[i] = RANGES[i][0];
  rangeStartIndex[i] = acc;
  acc += RANGES[i][1] - RANGES[i][0] + 1;
}

/** 码位 → 字符集序号；不在字符集内返回 -1 */
export function indexOfCodePoint(cp: number): number {
  let lo = 0;
  let hi = RANGES.length - 1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    const s = RANGES[mid][0];
    const e = RANGES[mid][1];
    if (cp < s) hi = mid - 1;
    else if (cp > e) lo = mid + 1;
    else return rangeStartIndex[mid] + (cp - s);
  }
  return -1;
}

/** 字符集序号 → 码位；越界返回 -1 */
export function codePointAtIndex(index: number): number {
  if (index < 0 || index >= ALPHABET_SIZE) return -1;
  let lo = 0;
  let hi = RANGES.length - 1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (index < rangeStartIndex[mid]) hi = mid - 1;
    else if (mid === RANGES.length - 1 || index < rangeStartIndex[mid + 1]) {
      return rangeStartCp[mid] + (index - rangeStartIndex[mid]);
    } else lo = mid + 1;
  }
  return -1;
}

export function isInAlphabet(cp: number): boolean {
  return indexOfCodePoint(cp) >= 0;
}
