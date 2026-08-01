<script setup lang="ts">
import { ref, watchEffect } from 'vue';
import { loadShelf, removeFromShelf, toggleShelf, type ShelfItem } from '../core/shelf';
import { loadHistory, clearHistory, type HistoryItem } from '../core/history';

watchEffect(() => {
  document.title = '我的藏书 · 巴别图书馆';
});

const shelfItems = ref<ShelfItem[]>(loadShelf());
const historyItems = ref<HistoryItem[]>(loadHistory());
const importInput = ref<HTMLInputElement>();
const importErr = ref('');

function removeItem(path: string) {
  shelfItems.value = removeFromShelf(shelfItems.value, path);
}

function clearAll() {
  clearHistory();
  historyItems.value = [];
}

/** 导出藏书为 JSON 文件 */
function exportShelf() {
  const blob = new Blob([JSON.stringify(shelfItems.value, null, 2)], {
    type: 'application/json',
  });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = '巴别图书馆藏书.json';
  a.click();
  URL.revokeObjectURL(a.href);
}

/** 导入藏书（按 path 去重合并，已有条目优先） */
async function importShelf(e: Event) {
  const input = e.target as HTMLInputElement;
  const file = input.files?.[0];
  input.value = '';
  importErr.value = '';
  if (!file) return;
  try {
    const arr = JSON.parse(await file.text());
    if (
      !Array.isArray(arr) ||
      !arr.every((x) => x && typeof x.path === 'string' && typeof x.label === 'string')
    ) {
      throw new Error('bad format');
    }
    let items = shelfItems.value;
    for (const x of arr) {
      items = toggleShelf(items, {
        path: x.path,
        label: x.label,
        addressText: typeof x.addressText === 'string' ? x.addressText : '',
        addedAt: typeof x.addedAt === 'number' ? x.addedAt : Date.now(),
      });
    }
    shelfItems.value = items;
  } catch {
    importErr.value = '这份文件不是有效的藏书导出（JSON 格式不符）。';
  }
}
</script>

<template>
  <article class="about">
    <h1>我的藏书</h1>

    <div class="shelf-actions">
      <button v-if="shelfItems.length" class="btn small" @click="exportShelf">导出藏书</button>
      <button class="btn small" @click="importInput?.click()">导入藏书</button>
      <input
        ref="importInput"
        type="file"
        accept=".json,application/json"
        class="hidden-file"
        @change="importShelf"
      />
    </div>
    <p v-if="importErr" class="error">{{ importErr }}</p>

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

    <template v-if="historyItems.length">
      <h2 class="index-title history-title">最近翻过</h2>
      <div class="shelf-list">
        <div v-for="item in historyItems" :key="item.path" class="card shelf-item">
          <RouterLink :to="item.path" class="shelf-label">{{ item.label }}</RouterLink>
          <span class="addr">{{ item.addressText }}</span>
        </div>
      </div>
      <div class="center-nav">
        <button class="btn small" @click="clearAll">清空最近翻过</button>
      </div>
    </template>

    <div class="center-nav">
      <RouterLink class="btn" to="/">回到检索</RouterLink>
    </div>
  </article>
</template>
