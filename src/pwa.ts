// ---------------------------------------------------------------------------
// PWA 更新流程：
// - 注册 Service Worker；页面从后台恢复时主动检查更新
// - 新 Worker 接管（controllerchange）→ 通知调用方展示「发现新版本」
// - 用户确认后再刷新；刷新前暂存未提交的输入，刷新后自动恢复
// ---------------------------------------------------------------------------

export function initPwa(onUpdate: (reload: () => void) => void) {
  if (!import.meta.env.PROD || !('serviceWorker' in navigator)) return;

  // 恢复上一次「刷新体验」前暂存的输入
  try {
    const saved = sessionStorage.getItem('babel:restore-query');
    if (saved) {
      sessionStorage.removeItem('babel:restore-query');
      queueMicrotask(() => {
        const ta = document.querySelector<HTMLTextAreaElement>('#query-input');
        if (ta) {
          ta.value = saved;
          ta.dispatchEvent(new Event('input', { bubbles: true }));
        }
      });
    }
  } catch {}

  let prompted = false;
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (prompted) return;
    prompted = true;
    onUpdate(() => {
      try {
        const ta = document.querySelector<HTMLTextAreaElement>('#query-input');
        if (ta?.value) sessionStorage.setItem('babel:restore-query', ta.value);
      } catch {}
      window.location.reload();
    });
  });

  window.addEventListener('load', () => {
    navigator.serviceWorker
      .register('./sw.js')
      .then((reg) => {
        document.addEventListener('visibilitychange', () => {
          if (document.visibilityState === 'visible') {
            reg.update().catch(() => {});
          }
        });
      })
      .catch(() => {});
  });
}
