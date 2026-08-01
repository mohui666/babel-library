<script setup lang="ts">
import { RouterView, RouterLink } from 'vue-router';
import { theme, toggleTheme } from './theme';
import { dailyPath } from './core/daily';

const dailyLink = dailyPath();
</script>

<template>
  <div class="shell">
    <header class="site-header">
      <RouterLink to="/" class="site-title">巴别图书馆</RouterLink>
      <nav class="site-nav">
        <RouterLink to="/">检索</RouterLink>
        <RouterLink :to="dailyLink">今日</RouterLink>
        <RouterLink to="/index">索引</RouterLink>
        <RouterLink to="/shelf">藏书</RouterLink>
        <RouterLink to="/about">关于</RouterLink>
        <button
          class="theme-toggle"
          :title="theme === 'dark' ? '切换为白昼' : '切换为黑夜'"
          @click="toggleTheme"
        >
          {{ theme === 'dark' ? '☀ 昼' : '☾ 夜' }}
        </button>
      </nav>
    </header>
    <main>
      <RouterView />
    </main>
    <footer class="site-footer">
      <p>每页内容均由其地址唯一决定 · 本馆不存储任何文本</p>
    </footer>
  </div>
</template>
