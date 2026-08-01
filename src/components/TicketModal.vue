<script setup lang="ts">
import { nextTick, onMounted, onUnmounted, ref, watch } from 'vue';
import { renderTicket, type TicketData, type TicketTheme } from '../core/ticket';

const props = defineProps<{ data: TicketData | null }>();
const emit = defineEmits<{ close: [] }>();

const ticketUrl = ref('');
const theme = ref<TicketTheme>(props.data?.theme ?? 'certificate');
const closeBtn = ref<HTMLButtonElement>();
const box = ref<HTMLDivElement>();

function render() {
  if (!props.data) return;
  ticketUrl.value = renderTicket({ ...props.data, theme: theme.value }).toDataURL('image/png');
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
        <a class="btn primary ticket-download" :href="ticketUrl" download="巴别图书馆收录证.png">保存图片</a>
        <button ref="closeBtn" class="btn" @click="emit('close')">收起</button>
      </div>
    </div>
  </div>
</template>
