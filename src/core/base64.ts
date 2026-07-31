// base64url 编解码（不依赖 btoa/Buffer，浏览器与 Node 通用）
// 编码格式属于永久链接契约的一部分，不可变更。

const B64_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';
const B64_REV = new Map<string, number>([...B64_ALPHABET].map((c, i) => [c, i]));

export function bytesToB64u(bytes: Uint8Array): string {
  let out = '';
  for (let i = 0; i < bytes.length; i += 3) {
    const b0 = bytes[i];
    const b1 = i + 1 < bytes.length ? bytes[i + 1] : 0;
    const b2 = i + 2 < bytes.length ? bytes[i + 2] : 0;
    out += B64_ALPHABET[b0 >> 2];
    out += B64_ALPHABET[((b0 & 3) << 4) | (b1 >> 4)];
    if (i + 1 < bytes.length) out += B64_ALPHABET[((b1 & 15) << 2) | (b2 >> 6)];
    if (i + 2 < bytes.length) out += B64_ALPHABET[b2 & 63];
  }
  return out;
}

export function b64uToBytes(s: string): Uint8Array {
  if (!/^[A-Za-z0-9_-]+$/.test(s)) throw new Error('非法 base64url 编码');
  const out: number[] = [];
  let acc = 0;
  let bits = 0;
  for (const ch of s) {
    acc = (acc << 6) | B64_REV.get(ch)!;
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      out.push((acc >> bits) & 0xff);
    }
  }
  // 末尾填充位必须为零，否则为非法编码
  if (bits > 0 && (acc & ((1 << bits) - 1)) !== 0) {
    throw new Error('非法 base64url 填充');
  }
  return new Uint8Array(out);
}

/** 大整数 → base64url（大端、最短字节序列；0 编码为 'A'） */
export function bigIntToB64u(n: bigint): string {
  if (n < 0n) throw new RangeError('负数无法编码');
  const bytes: number[] = [];
  let rest = n;
  while (rest > 0n) {
    bytes.push(Number(rest & 0xffn));
    rest >>= 8n;
  }
  if (bytes.length === 0) bytes.push(0);
  return bytesToB64u(new Uint8Array(bytes.reverse()));
}

export function b64uToBigInt(s: string): bigint {
  const bytes = b64uToBytes(s);
  let n = 0n;
  for (const b of bytes) n = (n << 8n) | BigInt(b);
  return n;
}
