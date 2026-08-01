<script setup lang="ts">
import { computed, watchEffect } from 'vue';
import { useRoute } from 'vue-router';
import { SPACE_SIZE, permute, permuteInv } from '../core/codec';
import { addrToKey, keyToAddr, decompose, formatBook, BOOK_PAGES } from '../core/address';
import { unpackRecipe, pageFromRecipe } from '../core/search';

const route = useRoute();

const GROUP = 100;

/**
 * 书籍页两种入口：
 * - 配方上下文（/s/:payload/book）：页格保持相对短链接
 * - 规范长链接（/book/:key）
 */
const state = computed(() => {
  try {
    if (route.name === 'recipeBook') {
      const payload = route.params.payload as string;
      const r = unpackRecipe(payload);
      const pageNumber = permuteInv(pageFromRecipe(r).address);
      const coords = decompose(pageNumber);
      const bookBase = pageNumber - BigInt(coords.page);
      return { ok: true as const, coords, bookBase, pageNumber, payload };
    }
    const address = keyToAddr(route.params.key as string);
    if (address < 0n || address >= SPACE_SIZE) return { ok: false as const };
    const pageNumber = permuteInv(address);
    const coords = decompose(pageNumber);
    const bookBase = pageNumber - BigInt(coords.page);
    return { ok: true as const, coords, bookBase, pageNumber, payload: null };
  } catch {
    return { ok: false as const };
  }
});

const from = computed(() => {
  const raw = Number(route.query.from);
  if (!Number.isInteger(raw) || raw < 0) return 0;
  return Math.min(raw, BOOK_PAGES - 1);
});

const pages = computed(() => {
  if (!state.value.ok) return [];
  const s = state.value;
  const list: { no: number; to: string }[] = [];
  const end = Math.min(from.value + GROUP, BOOK_PAGES);
  for (let i = from.value; i < end; i++) {
    const target = s.bookBase + BigInt(i);
    const to = s.payload
      ? (() => {
          const d = target - s.pageNumber;
          return d === 0n ? `/v1/s/${s.payload}` : `/v1/s/${s.payload}/d/${d}`;
        })()
      : `/v1/page/${addrToKey(permute(target))}`;
    list.push({ no: i + 1, to });
  }
  return list;
});

const prevFrom = computed(() => (from.value >= GROUP ? from.value - GROUP : null));
const nextFrom = computed(() =>
  from.value + GROUP < BOOK_PAGES ? from.value + GROUP : null,
);

watchEffect(() => {
  document.title = state.value.ok
    ? `${formatBook(state.value.coords)} · 巴别图书馆`
    : '巴别图书馆';
});
</script>

<template>
  <div v-if="!state.ok" class="error-page">
    <p>这本书不属于本馆。</p>
    <RouterLink class="btn" to="/">回到检索</RouterLink>
  </div>

  <template v-else>
    <header class="page-head">
      <p class="addr full">{{ formatBook(state.coords) }}</p>
      <p class="hint">全书共 {{ BOOK_PAGES }} 页。每一页都早已写好，从创世之初就是如此。</p>
    </header>

    <div class="page-index">
      <RouterLink v-for="p in pages" :key="p.no" class="page-cell" :to="p.to">
        {{ p.no }}
      </RouterLink>
    </div>

    <div class="page-nav center-nav">
      <RouterLink
        v-if="prevFrom !== null"
        class="btn small"
        :to="`${route.path}?from=${prevFrom}`"
        >← 前 {{ GROUP }} 页</RouterLink
      >
      <span class="page-pos">{{ from + 1 }} – {{ Math.min(from + GROUP, BOOK_PAGES) }}</span>
      <RouterLink
        v-if="nextFrom !== null"
        class="btn small"
        :to="`${route.path}?from=${nextFrom}`"
        >后 {{ GROUP }} 页 →</RouterLink
      >
    </div>

    <div class="center-nav">
      <RouterLink class="btn small" to="/">回到检索</RouterLink>
    </div>
  </template>
</template>
