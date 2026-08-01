// ---------------------------------------------------------------------------
// 最近翻过（仅本地，自动记录，上限 12 条）
// ---------------------------------------------------------------------------

export interface HistoryItem {
  path: string;
  label: string;
  addressText: string;
  at: number;
}

const KEY = 'babel:history';
const MAX = 12;

export function loadHistory(): HistoryItem[] {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return [];
    const arr = JSON.parse(raw);
    if (!Array.isArray(arr)) return [];
    return arr.filter((x) => x && typeof x.path === 'string' && typeof x.label === 'string');
  } catch {
    return [];
  }
}

export function recordHistory(item: Omit<HistoryItem, 'at'>) {
  const list = loadHistory().filter((x) => x.path !== item.path);
  list.unshift({ ...item, at: Date.now() });
  try {
    localStorage.setItem(KEY, JSON.stringify(list.slice(0, MAX)));
  } catch {}
}

export function clearHistory() {
  try {
    localStorage.removeItem(KEY);
  } catch {}
}
