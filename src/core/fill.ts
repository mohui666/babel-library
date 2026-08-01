import { POOLS } from './pools';

// ---------------------------------------------------------------------------
// 书写体系/限定字符集的读取与持久化（Home 编辑，其他页面按存储值调用）
// ---------------------------------------------------------------------------

export const POOLS_STORAGE_KEY = 'babel:pools';
export const CUSTOM_FILL_KEY = 'babel:custom-fill';

export function loadPools(): string[] {
  try {
    const raw = localStorage.getItem(POOLS_STORAGE_KEY);
    if (raw) {
      const arr = JSON.parse(raw);
      if (
        Array.isArray(arr) &&
        arr.length > 0 &&
        arr.every((id) => POOLS.some((p) => p.id === id))
      ) {
        return arr;
      }
    }
  } catch {}
  return POOLS.map((p) => p.id);
}

export function loadCustomFill(): string {
  try {
    return localStorage.getItem(CUSTOM_FILL_KEY) ?? '';
  } catch {
    return '';
  }
}

/** 供无设置界面的页面（如馆员索引）按存储值取填充参数 */
export function fillArgsFromStorage(): { poolIds?: string[]; customText?: string } {
  const custom = loadCustomFill().trim();
  if (custom) return { customText: custom };
  const pools = loadPools();
  return { poolIds: pools.length === POOLS.length ? undefined : pools };
}
