import { bytesToB64u, b64uToBytes } from './base64';

// ---------------------------------------------------------------------------
// 接龙链接：#/?chain=<base64url(JSON 段落数组)>，每位馆员一段、归属保留。
// 私密模式下的现实约束：棒数与单棒长度均设上限（链接即全部存储）。
// ---------------------------------------------------------------------------

export const CHAIN_MAX_SEGS = 12;
export const CHAIN_SEG_MAX_CHARS = 200;

export function encodeChain(segs: string[]): string {
  return bytesToB64u(new TextEncoder().encode(JSON.stringify(segs)));
}

export function decodeChain(b64: string): string[] | null {
  try {
    const arr = JSON.parse(new TextDecoder().decode(b64uToBytes(b64)));
    if (
      Array.isArray(arr) &&
      arr.length > 0 &&
      arr.length <= CHAIN_MAX_SEGS &&
      arr.every((s) => typeof s === 'string' && s.length > 0)
    ) {
      return arr;
    }
  } catch {}
  return null;
}
