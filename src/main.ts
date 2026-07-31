import { createApp } from 'vue';
import App from './App.vue';
import { router } from './router';
import { applyTheme } from './theme';
import './style.css';

applyTheme();
createApp(App).use(router).mount('#app');

// PWA：仅生产环境注册 Service Worker（开发期避免缓存干扰）
if (import.meta.env.PROD && 'serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('./sw.js').catch(() => {});
  });
}
