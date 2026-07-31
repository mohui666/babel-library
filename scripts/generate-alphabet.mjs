// 生成 Unicode 可打印字符的码位区间表 → src/core/alphabet-data.ts
//
// 「可打印」= 一般类别不属于 Cc(控制) Cf(格式) Cs(代理) Co(私用) Cn(未分配) Zl/Zp(分行分段)。
// 产物是当前运行环境 Unicode 版本的快照，提交仓库后永久固定——
// 字符集一旦变化，所有既有书页地址都会失效，因此本表只可在明知后果时重新生成。
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const EXCLUDED = /[\p{Cc}\p{Cf}\p{Cn}\p{Co}\p{Zl}\p{Zp}]/u;
const SURROGATE_LO = 0xd800;
const SURROGATE_HI = 0xdfff;
const MAX_CP = 0x10ffff;

const ranges = [];
let start = -1;
for (let cp = 0; cp <= MAX_CP; cp++) {
  if (cp >= SURROGATE_LO && cp <= SURROGATE_HI) {
    if (start >= 0) {
      ranges.push([start, cp - 1]);
      start = -1;
    }
    continue;
  }
  const printable = !EXCLUDED.test(String.fromCodePoint(cp));
  if (printable && start < 0) start = cp;
  if (!printable && start >= 0) {
    ranges.push([start, cp - 1]);
    start = -1;
  }
}
if (start >= 0) ranges.push([start, MAX_CP]);

const size = ranges.reduce((s, [a, b]) => s + (b - a + 1), 0);

// 基本健全性检查
const has = (cp) => ranges.some(([a, b]) => cp >= a && cp <= b);
const mustContain = [0x20, 0x41, 0x4e2d, 0x1f600, 0xa0, 0x3042, 0x20ac];
const mustExclude = [0x09, 0x7f, 0xe000, 0x378, 0x200d, 0xfffe, 0x2028];
for (const cp of mustContain) {
  if (!has(cp)) throw new Error(`区间表缺少应收字符 U+${cp.toString(16)}`);
}
for (const cp of mustExclude) {
  if (has(cp)) throw new Error(`区间表错误收录了 U+${cp.toString(16)}`);
}

const unicode = process.versions.unicode;
const body = ranges.map(([a, b]) => `[${a},${b}]`).join(',');
const out = `// 本文件由 scripts/generate-alphabet.mjs 自动生成，请勿手改。
// Unicode ${unicode} 可打印字符快照。重新生成会改变字符集，使所有既有书页地址失效。
export const UNICODE_VERSION = '${unicode}';
export const RANGES: readonly (readonly [number, number])[] = [${body}];
export const ALPHABET_SIZE = ${size};
`;

const here = dirname(fileURLToPath(import.meta.url));
writeFileSync(join(here, '..', 'src', 'core', 'alphabet-data.ts'), out);
console.log(`Unicode ${unicode}: ${ranges.length} 个区间, ${size} 个可打印字符`);
