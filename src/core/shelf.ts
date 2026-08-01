// ---------------------------------------------------------------------------
// 我的藏书夹：本地 localStorage 书架，无账号、不上传。
// ---------------------------------------------------------------------------

export interface ShelfItem {
  /** 打开路径（优先短链接） */
  path: string;
  /** 展示名（检索词或页首若干字） */
  label: string;
  addressText: string;
  addedAt: number;
}

const SHELF_KEY = 'babel:shelf';
const SHELF_MAX = 100;

export function loadShelf(): ShelfItem[] {
  try {
    const raw = localStorage.getItem(SHELF_KEY);
    if (!raw) return [];
    const arr = JSON.parse(raw);
    if (!Array.isArray(arr)) return [];
    return arr.filter(
      (x) => x && typeof x.path === 'string' && typeof x.label === 'string',
    );
  } catch {
    return [];
  }
}

function saveShelf(items: ShelfItem[]) {
  try {
    localStorage.setItem(SHELF_KEY, JSON.stringify(items.slice(0, SHELF_MAX)));
  } catch {}
}

export function inShelf(items: ShelfItem[], path: string): boolean {
  return items.some((i) => i.path === path);
}

/** 切换收藏状态，返回更新后的列表（新条目置顶） */
export function toggleShelf(items: ShelfItem[], item: ShelfItem): ShelfItem[] {
  const next = items.filter((i) => i.path !== item.path);
  if (next.length === items.length) next.unshift(item);
  saveShelf(next);
  return next;
}

export function removeFromShelf(items: ShelfItem[], path: string): ShelfItem[] {
  const next = items.filter((i) => i.path !== path);
  saveShelf(next);
  return next;
}
