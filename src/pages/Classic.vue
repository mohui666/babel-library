<script setup lang="ts">
import { computed, watchEffect } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { CLASSICS } from '../classics/books';
import { fullPageAddress } from '../core/search';
import { addrToKey } from '../core/address';
import { codePointLen } from '../core/search';

const route = useRoute();
const router = useRouter();

const book = computed(() => CLASSICS.find((b) => b.id === route.params.id) ?? null);

watchEffect(() => {
  document.title = book.value ? `《${book.value.title}》 · 巴别图书馆` : '巴别图书馆';
});

/** 点击时才计算该章的地址（每次约几十毫秒，避免整书预计算） */
function openChapter(index: number) {
  if (!book.value) return;
  const key = addrToKey(fullPageAddress(book.value.chapters[index].text));
  router.push(`/page/${key}`);
}
</script>

<template>
  <div v-if="!book" class="error-page">
    <p>本馆没有收录这部书。</p>
    <RouterLink class="btn" to="/">回到检索</RouterLink>
  </div>

  <template v-else>
    <header class="page-head">
      <h1 class="classic-heading">{{ book.title }}</h1>
      <p class="classic-author">{{ book.author }} · 共 {{ book.chapters.length }} 页</p>
      <p class="hint">{{ book.note }}</p>
      <p class="hint">每一章对应馆中真实的一页，不足一页的部分以空白补足。</p>
    </header>

    <div class="chapter-list">
      <button
        v-for="(c, i) in book.chapters"
        :key="c.title"
        class="chapter-row"
        @click="openChapter(i)"
      >
        <span class="chapter-title">{{ c.title }}</span>
        <span class="chapter-meta">{{ codePointLen(c.text) }} 字</span>
      </button>
    </div>

    <div class="center-nav">
      <RouterLink class="btn small" to="/">回到检索</RouterLink>
    </div>
  </template>
</template>
