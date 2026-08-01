import { bytesToB64u, b64uToBytes } from './base64';

// ---------------------------------------------------------------------------
// 接龙链接：#/?chain=<base64url(JSON)>，每位馆员一段、归属保留。
// 段落可为纯文本（旧格式字符串）或 { t, n? }（带署名）。
// 私密模式下的现实约束：棒数与单棒长度均设上限（链接即全部存储）。
// ---------------------------------------------------------------------------

export const CHAIN_MAX_SEGS = 12;
export const CHAIN_SEG_MAX_CHARS = 200;

export interface ChainSegment {
  t: string;
  n?: string;
}

export function encodeChain(segs: ChainSegment[]): string {
  return bytesToB64u(new TextEncoder().encode(JSON.stringify(segs)));
}

export function decodeChain(b64: string): ChainSegment[] | null {
  try {
    const arr = JSON.parse(new TextDecoder().decode(b64uToBytes(b64)));
    if (!Array.isArray(arr) || arr.length === 0 || arr.length > CHAIN_MAX_SEGS) return null;
    const out: ChainSegment[] = [];
    for (const x of arr) {
      if (typeof x === 'string' && x.length > 0) {
        out.push({ t: x });
      } else if (x && typeof x === 'object' && typeof x.t === 'string' && x.t.length > 0) {
        out.push({ t: x.t, n: typeof x.n === 'string' && x.n ? x.n : undefined });
      } else {
        return null;
      }
    }
    return out;
  } catch {
    return null;
  }
}

export function joinChain(segs: ChainSegment[]): string {
  return segs.map((s) => s.t).join('');
}
