import { describe, it, expect } from 'vitest';
import { bigIntToB64u, b64uToBigInt } from '../src/core/base64';
import { SPACE_SIZE, textOfAddress, PAGE_LEN, permuteInv } from '../src/core/codec';
import { keyToAddr } from '../src/core/address';
import {
  search,
  randomPage,
  packRecipe,
  unpackRecipe,
  pageFromRecipe,
  addressFromRecipeDelta,
  textPagePath,
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
      const recipe = unpackRecipe(r.shortPath!.slice('/v1/s/'.length));
      expect(recipe.query).toBe(query);
      expect(pageFromRecipe(recipe).address).toBe(keyToAddr(r.key));
    }
  });

  it('带语言池与限定文本时不变量同样成立', () => {
    for (const r of search('明月光', 3, ['cjk'])) {
      expect(pageFromRecipe(unpackRecipe(r.shortPath!.slice('/v1/s/'.length))).address).toBe(keyToAddr(r.key));
    }
    for (const r of search('疑是地上霜', 3, undefined, '床前明月光疑是地上霜')) {
      expect(pageFromRecipe(unpackRecipe(r.shortPath!.slice('/v1/s/'.length))).address).toBe(keyToAddr(r.key));
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
    const recipe = unpackRecipe(rp.shortPath.slice('/v1/s/'.length));
    expect(recipe.query).toBe('');
    expect(pageFromRecipe(recipe).address).toBe(rp.address);
  });

  it('重建出的页面逐字包含检索词', () => {
    const query = '短链接里的那句话';
    const [r] = search(query, 1);
    const recipe = unpackRecipe(r.shortPath!.slice('/v1/s/'.length));
    const text = [...textOfAddress(pageFromRecipe(recipe).address)];
    expect(text).toHaveLength(PAGE_LEN);
    expect(text.slice(recipe.offset, recipe.offset + [...query].length).join('')).toBe(query);
  });

  it('相对短链接：delta 解析与越界', () => {
    const [r] = search('测试相对链接', 1);
    const recipe = unpackRecipe(r.shortPath!.slice('/v1/s/'.length));
    const base = addressFromRecipeDelta(recipe, 0n);
    expect(base).toBe(keyToAddr(r.key));
    const next = addressFromRecipeDelta(recipe, 1n);
    expect(permuteInv(next)).toBe(permuteInv(base) + 1n);
    const prev = addressFromRecipeDelta(recipe, -1n);
    expect(permuteInv(prev)).toBe(permuteInv(base) - 1n);
    // 越出图书馆边界应抛错
    expect(() => addressFromRecipeDelta(recipe, -permuteInv(base) - 1n)).toThrow();
    expect(() =>
      addressFromRecipeDelta(recipe, SPACE_SIZE - permuteInv(base)),
    ).toThrow();
  });

  it('文字页链接：短文本走 /v1/t/，解码后地址一致', () => {
    const text = '这是一段由用户写定的文字，其余部分留白。';
    const { path, address } = textPagePath(text);
    expect(path.startsWith('/v1/t/')).toBe(true);
    expect(path.length).toBeLessThan(200);
    // 页面以原文开头
    expect(textOfAddress(address).startsWith(text)).toBe(true);
  });

  it('文字页链接：超长文本回退为地址编码（取较短者）', () => {
    const text = '长'.repeat(4000);
    const { path } = textPagePath(text);
    expect(path.startsWith('/v1/page/')).toBe(true);
  });
});
