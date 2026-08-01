<script setup lang="ts">
import { computed, ref, watchEffect } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { CLASSICS } from '../classics/books';
import { codePointLen } from '../core/search';

const route = useRoute();
const router = useRouter();

const book = computed(() => CLASSICS.find((b) => b.id === route.params.id) ?? null);

/** 默认连读：一本书是一个整体；「馆中目录」可逐章查看坐标 */
const mode = ref<'read' | 'toc'>('read');

watchEffect(() => {
  document.title = book.value ? `《${book.value.title}》 · 巴别图书馆` : '巴别图书馆';
});

/** 名著章节为语义化短路由；真实坐标由阅读页解析时现算 */
function openChapter(index: number) {
  if (!book.value) return;
  router.push(`/classic/${book.value.id}/${index}`);
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
      <p class="classic-author">{{ book.author }} · 共 {{ book.chapters.length }} 章</p>
      <p class="hint">{{ book.note }}</p>
      <p class="hint">每章都真实存在于馆中某处——连读是顺读全书，「馆中此页」带你去那一页。</p>
      <div class="mode-switch">
        <button :class="{ active: mode === 'read' }" @click="mode = 'read'">连读全书</button>
        <button :class="{ active: mode === 'toc' }" @click="mode = 'toc'">馆中目录</button>
      </div>
    </header>

    <div v-if="mode === 'read'" class="reader">
      <section v-for="(c, i) in book.chapters" :key="c.title" class="reader-chapter">
        <h3 class="reader-title">{{ c.title }}</h3>
        <p class="reader-text">{{ c.text }}</p>
        <button class="btn small chapter-goto" @click="openChapter(i)">馆中此页 →</button>
      </section>
    </div>

    <div v-else class="chapter-list">
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
