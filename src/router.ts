import { createRouter, createWebHashHistory } from 'vue-router';
import Home from './pages/Home.vue';

// ---------------------------------------------------------------------------
// 路由版本契约：/v1 前缀下的所有链接永久有效。
// v1 冻结内容见 src/core/codec.ts 顶部注释；未来变更只能以 /v2 引入，
// /v1 解码器永久保留。未带版本前缀的旧链接重定向到 /v1 等价路径。
// 非首页路由按需懒加载。
// ---------------------------------------------------------------------------
export const router = createRouter({
  history: createWebHashHistory(), // 地址极长时放 fragment 中，不经服务器
  routes: [
    { path: '/', name: 'home', component: Home },
    { path: '/v1/page/:key', name: 'page', component: () => import('./pages/Page.vue') },
    { path: '/v1/s/:payload', name: 'recipe', component: () => import('./pages/Page.vue') },
    { path: '/v1/s/:payload/d/:delta', name: 'delta', component: () => import('./pages/Page.vue') },
    {
      path: '/v1/s/:payload/book',
      name: 'recipeBook',
      component: () => import('./pages/Book.vue'),
    },
    { path: '/v1/t/:data', name: 'textPage', component: () => import('./pages/Page.vue') },
    { path: '/v1/book/:key', name: 'book', component: () => import('./pages/Book.vue') },
    { path: '/classic/:id', name: 'classic', component: () => import('./pages/Classic.vue') },
    { path: '/classic/:id/:ch', name: 'classicPage', component: () => import('./pages/Page.vue') },
    { path: '/index', name: 'index', component: () => import('./pages/Index.vue') },
    { path: '/shelf', name: 'shelf', component: () => import('./pages/Shelf.vue') },
    { path: '/about', name: 'about', component: () => import('./pages/About.vue') },
    // 旧链接（v1 之前的未版本化格式）→ /v1 等价路径
    { path: '/s/:payload', redirect: (to) => `/v1/s/${to.params.payload}` },
    {
      path: '/s/:payload/d/:delta',
      redirect: (to) => `/v1/s/${to.params.payload}/d/${to.params.delta}`,
    },
    { path: '/s/:payload/book', redirect: (to) => `/v1/s/${to.params.payload}/book` },
    { path: '/page/:key', redirect: (to) => `/v1/page/${to.params.key}` },
    { path: '/book/:key', redirect: (to) => `/v1/book/${to.params.key}` },
    { path: '/:pathMatch(.*)*', redirect: '/' },
  ],
  scrollBehavior: () => ({ top: 0 }),
});

// 默认标题；书页/书籍页由组件用具体坐标覆盖
router.afterEach((to) => {
  if (to.name === 'home') document.title = '巴别图书馆';
  else if (to.name === 'about') document.title = '关于 · 巴别图书馆';
});
