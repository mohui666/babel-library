import { describe, it, expect } from 'vitest';
import { bigIntToB64u, b64uToBigInt } from '../src/core/base64';
import { SPACE_SIZE, textOfAddress, PAGE_LEN } from '../src/core/codec';
import { keyToAddr } from '../src/core/address';
import {
  search,
  randomPage,
  packRecipe,
  unpackRecipe,
  pageFromRecipe,
} from '../src/core/search';
import { idsToMask, maskToIds, POOLS } from '../src/core/pools';

describe('base64url', () => {
  it('大整数往返一致', () => {
    for (const n of [0n, 1n, 255n, 256n, SPACE_SIZE - 1n, SPACE_SIZE / 3n]) {
      expect(b64uToBigInt(bigIntToB64u(n))).toBe(n);
    }
  });

  it('比 hex 短约三分之一', () => {
    const n = SPACE_SIZE - 1n;
    expect(bigIntToB64u(n).length).toBeLessThan(n.toString(16).length * 0.7);
  });

  it('非法输入报错', () => {
    expect(() => b64uToBigInt('含非法字符!')).toThrow();
    expect(() => b64uToBigInt('AB')).toThrow(); // 填充位非零
  });
});

describe('配方与短链接', () => {
  it('配方打包/解包往返一致（含特殊字符）', () => {
    const r = {
      seed: 0xdeadbeefcafe1234n,
      offset: 1234,
      poolMask: idsToMask(['cjk', 'emoji']),
      customText: '',
      query: '带点.带横线-带emoji😀与中文',
    };
    expect(unpackRecipe(packRecipe(r))).toEqual(r);
  });

  it('池掩码往返一致', () => {
    for (const ids of [[], ['cjk'], ['latin', 'emoji', 'punct'], POOLS.map((p) => p.id)]) {
      expect(maskToIds(idsToMask(ids)).sort()).toEqual([...ids].sort());
    }
  });

  it('核心不变量：短链接重建的页与原结果完全一致', () => {
    const query = '我今天中午吃了火锅';
    for (const r of search(query, 5)) {
      expect(r.shortPath).toBeTruthy();
      const recipe = unpackRecipe(r.shortPath!.slice('/s/'.length));
      expect(recipe.query).toBe(query);
      expect(pageFromRecipe(recipe).address).toBe(keyToAddr(r.key));
    }
  });

  it('带语言池与限定文本时不变量同样成立', () => {
    for (const r of search('明月光', 3, ['cjk'])) {
      expect(pageFromRecipe(unpackRecipe(r.shortPath!.slice(3))).address).toBe(keyToAddr(r.key));
    }
    for (const r of search('疑是地上霜', 3, undefined, '床前明月光疑是地上霜')) {
      expect(pageFromRecipe(unpackRecipe(r.shortPath!.slice(3))).address).toBe(keyToAddr(r.key));
    }
  });

  it('短链接确实短', () => {
    const [r] = search('一句很短的话', 1);
    expect(r.shortPath!.length).toBeLessThan(120);
  });

  it('超长检索词回退为规范链接（配方反而更长时不提供短链）', () => {
    const [r] = search('长'.repeat(3000), 1);
    expect(r.shortPath).toBeUndefined();
  });

  it('随意翻阅的短链接也能完整重建', () => {
    const rp = randomPage();
    const recipe = unpackRecipe(rp.shortPath.slice('/s/'.length));
    expect(recipe.query).toBe('');
    expect(pageFromRecipe(recipe).address).toBe(rp.address);
  });

  it('重建出的页面逐字包含检索词', () => {
    const query = '短链接里的那句话';
    const [r] = search(query, 1);
    const recipe = unpackRecipe(r.shortPath!.slice(3));
    const text = [...textOfAddress(pageFromRecipe(recipe).address)];
    expect(text).toHaveLength(PAGE_LEN);
    expect(text.slice(recipe.offset, recipe.offset + [...query].length).join('')).toBe(query);
  });
});
