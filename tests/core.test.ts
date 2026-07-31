import { describe, it, expect } from 'vitest';
import {
  ALPHABET_SIZE,
  indexOfCodePoint,
  codePointAtIndex,
  isInAlphabet,
} from '../src/core/alphabet';
import {
  PAGE_LEN,
  SPACE_SIZE,
  permute,
  permuteInv,
  textToIndices,
  indicesToText,
  indicesToNumber,
  numberToIndices,
  addressOfIndices,
  textOfAddress,
} from '../src/core/codec';
import {
  decompose,
  compose,
  coordsOfAddress,
  addrToKey,
  keyToAddr,
  BOOK_PAGES,
} from '../src/core/address';
import { validateQuery, search, randomPage, splitIntoChunks, codePointLen } from '../src/core/search';

const SPACE_IDX = indexOfCodePoint(0x20);

/** 把短文本补空格填满一页（模拟实际页内容） */
function padToPage(text: string): number[] {
  const indices = textToIndices(text);
  while (indices.length < PAGE_LEN) indices.push(SPACE_IDX);
  return indices;
}

describe('字符集', () => {
  it('常见字符均已收录', () => {
    for (const ch of ['A', '中', '😀', ' ', 'あ', '€', 'é', '𠮷']) {
      expect(isInAlphabet(ch.codePointAt(0)!), ch).toBe(true);
    }
  });

  it('控制符 / 私用区 / 未分配 / 格式符均已排除', () => {
    for (const cp of [0x09, 0x7f, 0xe000, 0x378, 0x200d, 0x2028]) {
      expect(isInAlphabet(cp), `U+${cp.toString(16)}`).toBe(false);
    }
  });

  it('序号 ⇔ 码位往返一致', () => {
    for (const i of [0, 1, 12345, ALPHABET_SIZE - 1]) {
      expect(indexOfCodePoint(codePointAtIndex(i))).toBe(i);
    }
  });
});

describe('双射：页内容 ⇔ 页编号 ⇔ 地址', () => {
  const samples = [
    '我今天中午吃了火锅',
    'Hello, world! The Library of Babel.',
    '😀📚 emoji 混合 テスト',
    'é'.normalize('NFC') + ' 与 ' + 'é'.normalize('NFD'),
  ];

  it('任意页 → 地址 → 解码回来逐字一致', () => {
    for (const s of samples) {
      const page = padToPage(s);
      const address = addressOfIndices(page);
      expect(textOfAddress(address)).toBe(indicesToText(page));
      expect([...textOfAddress(address)].slice(0, [...s].length).join('')).toBe(s);
    }
  });

  it('页编号 ⇔ 序号数组往返一致', () => {
    const page = padToPage('边界测试');
    expect(numberToIndices(indicesToNumber(page))).toEqual(page);
  });

  it('置换可逆', () => {
    for (const x of [0n, 1n, 42n, SPACE_SIZE - 1n, SPACE_SIZE / 7n]) {
      expect(permuteInv(permute(x))).toBe(x);
    }
  });

  it('相邻页内容充分扩散（翻页能看到完全不同的内容）', () => {
    const pn = 987654321n;
    const a = [...textOfAddress(permute(pn))];
    const b = [...textOfAddress(permute(pn + 1n))];
    let same = 0;
    for (let i = 0; i < PAGE_LEN; i++) if (a[i] === b[i]) same++;
    expect(same).toBeLessThan(PAGE_LEN / 10);
  });

  it('同一内容永远得到同一地址（确定性）', () => {
    const page = padToPage('同一句话');
    expect(addressOfIndices(page)).toBe(addressOfIndices(page));
  });
});

describe('地址分层', () => {
  it('分解 ⇔ 重组往返一致', () => {
    const page = padToPage('坐标测试');
    const address = addressOfIndices(page);
    const coords = coordsOfAddress(address);
    expect(compose(coords)).toBe(permuteInv(address));
  });

  it('页码进位：第 1000 页的下一页属于下一册', () => {
    const last = compose({ hall: 0n, floor: 0, room: 0, shelf: 0, book: 0, page: BOOK_PAGES - 1 });
    const next = decompose(last + 1n);
    expect(next.book).toBe(1);
    expect(next.page).toBe(0);
  });

  it('URL key ⇔ 地址往返一致', () => {
    const address = addressOfIndices(padToPage('链接测试'));
    expect(keyToAddr(addrToKey(address))).toBe(address);
  });

  it('非法 key 报错', () => {
    expect(() => keyToAddr('不是十六进制!')).toThrow();
  });
});

describe('检索', () => {
  it('校验：正常输入通过', () => {
    const v = validateQuery('  我今天中午吃了火锅  ');
    expect(v.ok).toBe(true);
    if (v.ok) expect(v.query).toBe('我今天中午吃了火锅');
  });

  it('校验：空输入、控制符被拒绝；超长不再拒绝（走分段定位）', () => {
    expect(validateQuery('   ').ok).toBe(false);
    expect(validateQuery('有\t tab').ok).toBe(false);
    expect(validateQuery('字'.repeat(PAGE_LEN + 1)).ok).toBe(true);
    const bad = validateQuery('含\t控制符');
    if (!bad.ok) {
      expect(bad.message).toContain('本馆不收录');
      expect(bad.message).toContain('U+9'); // 不可见字符显示为码位而非空白
      expect(bad.badChars).toEqual(['\t']);
    }
    const zwsp = validateQuery('和一位​');
    if (!zwsp.ok) {
      expect(zwsp.badChars).toEqual(['​']);
      expect(zwsp.message).toContain('U+200B');
    }
  });

  it('每个结果都逐字包含原句，且位置正确', () => {
    const query = '我今天中午吃了火锅';
    const results = search(query, 10);
    expect(results).toHaveLength(10);
    const keys = new Set(results.map((r) => r.key));
    expect(keys.size).toBe(10); // 结果互不重复

    for (const r of results) {
      const page = [...textOfAddress(keyToAddr(r.key))];
      expect(page).toHaveLength(PAGE_LEN);
      expect(page.slice(r.offset, r.offset + [...query].length).join('')).toBe(query);
      // 片段内高亮位置同样正确
      const snippet = [...r.snippet];
      expect(snippet.slice(r.markStart, r.markStart + r.markLen).join('')).toBe(query);
    }
  });

  it('恰好一页长的检索词也能定位', () => {
    const query = '永'.repeat(PAGE_LEN);
    const [r] = search(query, 1);
    expect(r.offset).toBe(0);
    expect(textOfAddress(keyToAddr(r.key))).toBe(query);
  });

  it('检索 10 条在可接受时间内完成', () => {
    const t0 = performance.now();
    search('性能测试', 10);
    expect(performance.now() - t0).toBeLessThan(2000);
  });
});

describe('随机漫游', () => {
  it('随机页可正常解码，长度恰为一页', () => {
    const { key } = randomPage();
    const text = textOfAddress(keyToAddr(key));
    expect([...text]).toHaveLength(PAGE_LEN);
  });
});


describe('分段定位', () => {
  it('短文本保持单段', () => {
    expect(splitIntoChunks('你好，图书馆')).toEqual(['你好，图书馆']);
  });

  it('多行合并为一段（换行仅作边界，不计入内容）', () => {
    expect(splitIntoChunks('第一行\n第二行\n第三行')).toEqual(['第一行第二行第三行']);
  });

  it('空行被跳过', () => {
    expect(splitIntoChunks('甲\n\n\n乙')).toEqual(['甲乙']);
  });

  it('超过一页的单行按码位硬切，且不丢字', () => {
    const text = '字'.repeat(PAGE_LEN + 10);
    const chunks = splitIntoChunks(text);
    expect(chunks).toHaveLength(2);
    expect(codePointLen(chunks[0])).toBe(PAGE_LEN);
    expect(codePointLen(chunks[1])).toBe(10);
    expect(chunks.join('')).toBe(text);
  });

  it('行优先组装：装不下整行时换段', () => {
    const text = `${'行'.repeat(PAGE_LEN - 1)}\n末尾`;
    const chunks = splitIntoChunks(text);
    expect(chunks).toHaveLength(2);
    expect(codePointLen(chunks[0])).toBe(PAGE_LEN - 1);
    expect(chunks[1]).toBe('末尾');
  });

  it('emoji 等多码位字符硬切时不会被劈开', () => {
    const text = '😀'.repeat(PAGE_LEN + 1);
    const chunks = splitIntoChunks(text);
    expect(chunks.join('')).toBe(text);
    expect(codePointLen(chunks[0])).toBe(PAGE_LEN);
  });

  it('每一段的定位结果都逐字包含该段', () => {
    const text = `${'第一段内容'.repeat(500)}\n${'第二段内容'.repeat(500)}`;
    const chunks = splitIntoChunks(text);
    expect(chunks.length).toBeGreaterThan(1);
    for (const c of chunks) {
      const [r] = search(c, 1);
      const page = [...textOfAddress(keyToAddr(r.key))];
      expect(page.slice(r.offset, r.offset + codePointLen(c)).join('')).toBe(c);
    }
  });
});
