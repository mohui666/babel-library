import { permuteInv } from './codec';
import { bigIntToB64u, b64uToBigInt } from './base64';

/** 地址分层：馆 > 层 > 室 > 架 > 册 > 页（馆数无限） */
export const BOOK_PAGES = 1000;
export const SHELF_BOOKS = 32;
export const ROOM_SHELVES = 5;
export const FLOOR_ROOMS = 4;
export const HALL_FLOORS = 6;

export interface Coords {
  hall: bigint;
  floor: number;
  room: number;
  shelf: number;
  book: number;
  page: number;
}

/** 页编号 → 层级坐标（均为 0 起；展示时 +1） */
export function decompose(pageNumber: bigint): Coords {
  let rest = pageNumber;
  const take = (radix: number): number => {
    const r = rest % BigInt(radix);
    rest /= BigInt(radix);
    return Number(r);
  };
  const page = take(BOOK_PAGES);
  const book = take(SHELF_BOOKS);
  const shelf = take(ROOM_SHELVES);
  const room = take(FLOOR_ROOMS);
  const floor = take(HALL_FLOORS);
  return { hall: rest, floor, room, shelf, book, page };
}

/** 层级坐标 → 页编号 */
export function compose(c: Coords): bigint {
  let n = c.hall;
  n = n * BigInt(HALL_FLOORS) + BigInt(c.floor);
  n = n * BigInt(FLOOR_ROOMS) + BigInt(c.room);
  n = n * BigInt(ROOM_SHELVES) + BigInt(c.shelf);
  n = n * BigInt(SHELF_BOOKS) + BigInt(c.book);
  n = n * BigInt(BOOK_PAGES) + BigInt(c.page);
  return n;
}

/** 地址 → 层级坐标 */
export function coordsOfAddress(address: bigint): Coords {
  return decompose(permuteInv(address));
}

/** 馆编号的十进制展示：过长时首尾截断 */
export function formatHall(hall: bigint, maxDigits = 14): string {
  const digits = (hall + 1n).toString(10); // 展示为 1 起
  if (digits.length <= maxDigits) return digits;
  const head = digits.slice(0, 6);
  const tail = digits.slice(-4);
  return `${head}…${tail}（共 ${digits.length} 位）`;
}

/** 「第 X 馆 · 第 X 层 · 第 X 室 · 第 X 架 · 第 X 册 · 第 X 页」 */
export function formatAddress(c: Coords): string {
  return (
    `第 ${formatHall(c.hall)} 馆 · 第 ${c.floor + 1} 层 · ` +
    `第 ${c.room + 1} 室 · 第 ${c.shelf + 1} 架 · ` +
    `第 ${c.book + 1} 册 · 第 ${c.page + 1} 页`
  );
}

/** 书籍坐标（不含页） */
export function formatBook(c: Coords): string {
  return (
    `第 ${formatHall(c.hall)} 馆 · 第 ${c.floor + 1} 层 · ` +
    `第 ${c.room + 1} 室 · 第 ${c.shelf + 1} 架 · 第 ${c.book + 1} 册`
  );
}

// ---------------------------------------------------------------------------
// 地址 ⇔ URL key：base64url 编码（约 1.15 万字符，较 hex 短 1/3）
// ---------------------------------------------------------------------------

export function addrToKey(address: bigint): string {
  return bigIntToB64u(address);
}

export function keyToAddr(key: string): bigint {
  return b64uToBigInt(key); // 内部已做字符与填充校验
}
