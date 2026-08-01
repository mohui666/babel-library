<script setup lang="ts">
import { nextTick, onMounted, onUnmounted, ref, watch } from 'vue';
import { renderTicket, type TicketData, type TicketTheme } from '../core/ticket';

const props = defineProps<{ data: TicketData | null }>();
const emit = defineEmits<{ close: [] }>();

const ticketUrl = ref('');
const theme = ref<TicketTheme>(props.data?.theme ?? 'certificate');
const closeBtn = ref<HTMLButtonElement>();
const box = ref<HTMLDivElement>();
const sharedTicket = ref(false);

function render() {
  if (!props.data) return;
  ticketUrl.value = renderTicket({ ...props.data, theme: theme.value }).toDataURL('image/png');
}

/** 直接分享当前装帧的收录证（优先带图系统面板，回退复制链接） */
async function shareTicket() {
  const d = props.data;
  if (!d) return;
  const text = d.query ? `「${d.query}」——早已写在巴别图书馆的某一页。` : '巴别图书馆的一页。';
  const nav = navigator as Navigator & {
    share?: (x: ShareData) => Promise<void>;
    canShare?: (x: ShareData) => boolean;
  };
  try {
    const blob = await (await fetch(ticketUrl.value)).blob();
    const file = new File([blob], '巴别图书馆收录证.png', { type: 'image/png' });
    if (nav.share && nav.canShare?.({ files: [file] })) {
      await nav.share({ files: [file], title: '巴别图书馆', text: `${text}\n${d.url}` });
      return;
    }
    if (nav.share) {
      await nav.share({ title: '巴别图书馆', text: `${text}\n${d.url}` });
      return;
    }
  } catch (e) {
    if ((e as DOMException)?.name === 'AbortError') return;
  }
  try {
    await navigator.clipboard.writeText(`${text}\n${d.url}`);
    sharedTicket.value = true;
    setTimeout(() => (sharedTicket.value = false), 2000);
  } catch {}
}

watch(
  () => props.data,
  (d) => {
    if (d) {
      theme.value = d.theme;
      render();
      nextTick(() => closeBtn.value?.focus());
    }
  },
);
watch(theme, render);

const THEMES: [TicketTheme, string][] = [
  ['certificate', '宇宙收录证'],
  ['epitaph', '未来墓志铭'],
  ['ticket', '原始藏书票'],
];

function onKey(e: KeyboardEvent) {
  if (!props.data) return;
  if (e.key === 'Escape') {
    emit('close');
    return;
  }
  if (e.key !== 'Tab') return;
  // 焦点陷阱
  const el = box.value;
  if (!el) return;
  const focusables = [...el.querySelectorAll<HTMLElement>('button, a[href]')];
  if (focusables.length === 0) return;
  const first = focusables[0];
  const last = focusables[focusables.length - 1];
  const active = document.activeElement as HTMLElement | null;
  if (e.shiftKey && (active === first || !el.contains(active))) {
    e.preventDefault();
    last.focus();
  } else if (!e.shiftKey && (active === last || !el.contains(active))) {
    e.preventDefault();
    first.focus();
  }
}

onMounted(() => window.addEventListener('keydown', onKey));
onUnmounted(() => window.removeEventListener('keydown', onKey));
</script>

<template>
  <div
    v-if="data"
    class="ticket-modal"
    role="dialog"
    aria-modal="true"
    aria-label="收录证"
    @click.self="emit('close')"
  >
    <div ref="box" class="ticket-box">
      <div class="ticket-themes">
        <button
          v-for="t in THEMES"
          :key="t[0]"
          :class="{ active: theme === t[0] }"
          :aria-pressed="theme === t[0]"
          @click="theme = t[0]"
        >
          {{ t[1] }}
        </button>
      </div>
      <img :src="ticketUrl" alt="收录证图卡" class="ticket-img" />
      <div class="ticket-actions">
        <button class="btn primary" @click="shareTicket">
          {{ sharedTicket ? '已复制链接 ✓' : '直接分享' }}
        </button>
        <a class="btn ticket-download" :href="ticketUrl" download="巴别图书馆收录证.png">保存图片</a>
        <button ref="closeBtn" class="btn" @click="emit('close')">收起</button>
      </div>
    </div>
  </div>
</template>
