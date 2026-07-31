import { ref } from 'vue';

// ---------------------------------------------------------------------------
// 昼夜主题：localStorage 记忆，未选择时跟随系统偏好
// ---------------------------------------------------------------------------

const THEME_KEY = 'babel:theme';
export type Theme = 'light' | 'dark';

function initTheme(): Theme {
  try {
    const stored = localStorage.getItem(THEME_KEY);
    if (stored === 'light' || stored === 'dark') return stored;
  } catch {}
  try {
    return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  } catch {
    return 'light';
  }
}

export const theme = ref<Theme>(initTheme());

export function applyTheme() {
  document.documentElement.dataset.theme = theme.value;
}

export function toggleTheme() {
  theme.value = theme.value === 'dark' ? 'light' : 'dark';
  try {
    localStorage.setItem(THEME_KEY, theme.value);
  } catch {}
  applyTheme();
}
