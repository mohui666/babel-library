import { describe, it, expect } from 'vitest';
import { CLASSICS } from '../src/classics/books';
import { fullPageAddress, codePointLen } from '../src/core/search';
import { PAGE_LEN, textOfAddress } from '../src/core/codec';
import { indexOfCodePoint } from '../src/core/alphabet';

describe('fullPageAddress', () => {
  it('整页文本往返：解码后前缀为原文、其余为空格', () => {
    const text = '道可道，非常道。';
    const address = fullPageAddress(text);
    const decoded = textOfAddress(address);
    expect(decoded.startsWith(text)).toBe(true);
    expect([...decoded].every((c, i) => i < [...text].length || c === ' ')).toBe(true);
    expect([...decoded]).toHaveLength(PAGE_LEN);
  });

  it('超过一页抛错', () => {
    expect(() => fullPageAddress('字'.repeat(PAGE_LEN + 1))).toThrow();
  });
});

describe('馆藏名著数据', () => {
  it('每章非空、不超一页、全部为收录字符', () => {
    for (const b of CLASSICS) {
      const titles = new Set<string>();
      for (const c of b.chapters) {
        expect(c.text.length, `${b.id}/${c.title}`).toBeGreaterThan(0);
        expect(codePointLen(c.text), `${b.id}/${c.title}`).toBeLessThanOrEqual(PAGE_LEN);
        expect(titles.has(c.title), `${b.id}/${c.title} 标题重复`).toBe(false);
        titles.add(c.title);
        for (const ch of c.text) {
          expect(
            indexOfCodePoint(ch.codePointAt(0)!) >= 0,
            `${b.id}/${c.title} 含不收录字符 ${ch}`,
          ).toBe(true);
        }
      }
    }
  });

  it('关键文本抽样正确', () => {
    const ddj = CLASSICS.find((b) => b.id === 'daodejing')!;
    expect(ddj.chapters).toHaveLength(81);
    expect(ddj.chapters[0].text).toContain('道可道');
    const sunzi = CLASSICS.find((b) => b.id === 'sunzi')!;
    expect(sunzi.chapters).toHaveLength(13);
    const sonnets = CLASSICS.find((b) => b.id === 'sonnets')!;
    expect(sonnets.chapters[0].text).toContain('Shall I compare thee');
  });

  it('静夜思定位到的页面以诗文开头', () => {
    const ts = CLASSICS.find((b) => b.id === 'tang-shi')!;
    const poem = ts.chapters[0];
    const address = fullPageAddress(poem.text);
    expect(textOfAddress(address).startsWith('床前明月光，疑是地上霜。')).toBe(true);
  });
});
