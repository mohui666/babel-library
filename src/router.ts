import { createRouter, createWebHashHistory } from 'vue-router';
import Home from './pages/Home.vue';
import Page from './pages/Page.vue';
import Book from './pages/Book.vue';
import Classic from './pages/Classic.vue';
import About from './pages/About.vue';

// 采用 hash 路由：书页地址极长（数千个十六进制字符），放在 fragment 中
// 不经过任何服务器，纯静态托管也能保证永久链接可用。
export const router = createRouter({
  history: createWebHashHistory(),
  routes: [
    { path: '/', name: 'home', component: Home },
    { path: '/page/:key', name: 'page', component: Page },
    { path: '/s/:payload', name: 'recipe', component: Page }, // 短链接（配方）
    { path: '/book/:key', name: 'book', component: Book },
    { path: '/classic/:id', name: 'classic', component: Classic },
    { path: '/about', name: 'about', component: About },
    { path: '/:pathMatch(.*)*', redirect: '/' },
  ],
  scrollBehavior: () => ({ top: 0 }),
});

// 默认标题；书页/书籍页由组件用具体坐标覆盖
router.afterEach((to) => {
  if (to.name === 'home') document.title = '巴别图书馆';
  else if (to.name === 'about') document.title = '关于 · 巴别图书馆';
});
