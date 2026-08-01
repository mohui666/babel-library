import { pageFromRecipe, packRecipe, type Recipe } from './search';

// ---------------------------------------------------------------------------
// 今日之页：日期 → 确定性种子 → 全馆同日同一页，零点更替。
// ---------------------------------------------------------------------------

/** FNV-1a 64 位散列（稳定、简单，足敷日期映射） */
function fnv1a64(s: string): bigint {
  const MASK = 0xffffffffffffffffn;
  const PRIME = 0x100000001b3n;
  let h = 0xcbf29ce484222325n;
  for (const ch of s) {
    h ^= BigInt(ch.codePointAt(0)!);
    h = (h * PRIME) & MASK;
  }
  return h;
}

export function dailyKey(date = new Date()): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

export function dailyRecipe(date = new Date()): Recipe {
  return { seed: fnv1a64(dailyKey(date)), offset: 0, poolMask: 0xff, customText: '', query: '' };
}

/** 今日之页的短链接路径（同一天内所有人一致） */
export function dailyPath(date?: Date): string {
  return `/v1/s/${packRecipe(dailyRecipe(date))}`;
}

/** 今日之页的地址 */
export function dailyAddress(date?: Date): bigint {
  return pageFromRecipe(dailyRecipe(date)).address;
}
