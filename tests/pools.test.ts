import { describe, it, expect } from 'vitest';
import { POOLS, poolsForIds, poolFromText, isIndexInPools } from '../src/core/pools';
import { search, randomPage } from '../src/core/search';
import { PAGE_LEN, indicesOfAddress, textOfAddress } from '../src/core/codec';
import { keyToAddr } from '../src/core/address';

/** 取出页内除查询外的填充字符序号 */
function fillIndices(query: string, key: string, offset: number): number[] {
  const page = indicesOfAddress(keyToAddr(key));
  const qLen = [...query].length;
  return page.filter((_, i) => i < offset || i >= offset + qLen);
}

describe('语言池', () => {
  it('每个池都与字符集有非空交集', () => {
    for (const p of POOLS) {
      expect(p.size, p.id).toBeGreaterThan(0);
    }
  });

  it('只勾选汉字：填充字符全部来自汉字池', () => {
    const results = search('我今天中午吃了火锅', 3, ['cjk']);
    const cjk = poolsForIds(['cjk']);
    for (const r of results) {
      for (const idx of fillIndices(r.query, r.key, r.offset)) {
        expect(isIndexInPools(idx, cjk)).toBe(true);
      }
    }
  });

  it('勾选多个池：填充字符来自所选池的并集', () => {
    const results = search('hello world', 3, ['latin', 'emoji']);
    const pools = poolsForIds(['latin', 'emoji']);
    for (const r of results) {
      for (const idx of fillIndices(r.query, r.key, r.offset)) {
        expect(isIndexInPools(idx, pools)).toBe(true);
      }
    }
  });

  it('随意翻阅也遵循语言池', () => {
    const { key } = randomPage(['kana']);
    const kana = poolsForIds(['kana']);
    const page = indicesOfAddress(keyToAddr(key));
    expect(page).toHaveLength(PAGE_LEN);
    for (const idx of page) {
      expect(isIndexInPools(idx, kana)).toBe(true);
    }
  });

  it('池选择不影响双射：检索结果仍逐字包含原句', () => {
    const query = '筛选语言后的定位';
    const [r] = search(query, 1, ['cyrillic', 'arabic']);
    const page = [...textOfAddress(keyToAddr(r.key))];
    expect(page.slice(r.offset, r.offset + [...query].length).join('')).toBe(query);
  });

  it('限定文本：乱码只使用文本中出现过的字符', () => {
    const poem = '床前明月光疑是地上霜';
    const pool = poolFromText(poem)!;
    const results = search('明月光', 3, undefined, poem);
    for (const r of results) {
      for (const idx of fillIndices(r.query, r.key, r.offset)) {
        expect(isIndexInPools(idx, [pool])).toBe(true);
      }
    }
  });

  it('poolFromText：去重、忽略不收录字符、无有效字符返回 null', () => {
    const p = poolFromText('天天天天向上\t')!; // \t 不收录
    expect(p.size).toBe(3); // 天、向、上
    expect(poolFromText('\t\n')).toBeNull();
  });
});
