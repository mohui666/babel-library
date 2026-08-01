<script setup lang="ts">
import { ref, watchEffect } from 'vue';
import { loadShelf, removeFromShelf, type ShelfItem } from '../core/shelf';

watchEffect(() => {
  document.title = '我的藏书 · 巴别图书馆';
});

const shelfItems = ref<ShelfItem[]>(loadShelf());

function removeItem(path: string) {
  shelfItems.value = removeFromShelf(shelfItems.value, path);
}
</script>

<template>
  <article class="about">
    <h1>我的藏书</h1>
    <p v-if="!shelfItems.length" class="hint">
      书架还空着。找到心仪的一页后，点「收入藏书夹」，它会出现在这里（只保存在本机）。
    </p>
    <div v-else class="shelf-list">
      <div v-for="item in shelfItems" :key="item.path" class="card shelf-item">
        <RouterLink :to="item.path" class="shelf-label">{{ item.label }}</RouterLink>
        <span class="addr">{{ item.addressText }}</span>
        <button class="shelf-remove" @click="removeItem(item.path)">移出</button>
      </div>
    </div>
    <div class="center-nav">
      <RouterLink class="btn" to="/">回到检索</RouterLink>
    </div>
  </article>
</template>
