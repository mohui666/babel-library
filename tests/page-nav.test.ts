// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import { mount, flushPromises } from '@vue/test-utils';
import { createRouter, createMemoryHistory } from 'vue-router';
import Page from '../src/pages/Page.vue';
import { PAGE_LEN, addressOfIndices, permuteInv, textToIndices } from '../src/core/codec';
import { indexOfCodePoint } from '../src/core/alphabet';
import { addrToKey, keyToAddr } from '../src/core/address';

function pageKeyOf(text: string): { key: string; pageNumber: bigint } {
  const idx = textToIndices(text);
  while (idx.length < PAGE_LEN) idx.push(indexOfCodePoint(0x20));
  const key = addrToKey(addressOfIndices(idx));
  return { key, pageNumber: permuteInv(keyToAddr(key)) };
}

describe('书页翻页', () => {
  it('点击「下一页」后 URL、内容与页码都应变更为相邻页', async () => {
    const { key, pageNumber } = pageKeyOf('第一页的内容');
    const expectedPos = Number(pageNumber % 1000n) + 1;

    const router = createRouter({
      history: createMemoryHistory(),
      routes: [{ path: '/page/:key', component: Page }],
    });
    router.push(`/page/${key}`);
    await router.isReady();

    const wrapper = mount(Page, { global: { plugins: [router] } });
    await flushPromises();

    expect(wrapper.text()).toContain('第一页的内容');
    expect(wrapper.text()).toContain(`第 ${expectedPos} / 1000 页`);

    const before = wrapper.text();
    const next = wrapper.findAll('a').find((a) => a.text().includes('下一页'));
    expect(next).toBeTruthy();
    await next!.trigger('click');
    await flushPromises();

    // URL 应已变化，且指向页编号 +1 的地址
    const newKey = router.currentRoute.value.params.key as string;
    expect(newKey).not.toBe(key);
    expect(permuteInv(keyToAddr(newKey))).toBe(pageNumber + 1n);
    // 组件内容应已更新
    expect(wrapper.text()).not.toBe(before);
    expect(wrapper.text()).toContain('/ 1000 页');
  });
});
