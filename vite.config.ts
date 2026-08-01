import { defineConfig } from 'vite';
import vue from '@vitejs/plugin-vue';
import { execSync } from 'node:child_process';

// 构建版本号：优先环境变量（Vercel 提供 VERCEL_GIT_COMMIT_SHA），本地取 git 短哈希
const APP_VERSION =
  process.env.APP_VERSION ??
  process.env.VERCEL_GIT_COMMIT_SHA?.slice(0, 7) ??
  (() => {
    try {
      return execSync('git rev-parse --short HEAD').toString().trim();
    } catch {
      return 'dev';
    }
  })();

export default defineConfig({
  plugins: [vue()],
  base: './',
  define: {
    __APP_VERSION__: JSON.stringify(APP_VERSION),
  },
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
  },
} as Parameters<typeof defineConfig>[0]);
