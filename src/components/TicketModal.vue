<script setup lang="ts">
import { nextTick, onMounted, onUnmounted, ref, watch } from 'vue';
import QRCode from 'qrcode';
import { renderTicket, type TicketData, type TicketTheme } from '../core/ticket';

const props = defineProps<{ data: TicketData | null }>();
const emit = defineEmits<{ close: [] }>();

const ticketUrl = ref('');
const qrUrl = ref('');
const theme = ref<TicketTheme>(props.data?.theme ?? 'certificate');
const closeBtn = ref<HTMLButtonElement>();
const box = ref<HTMLDivElement>();
const copiedBody = ref(false);
const copiedPreview = ref(false);

function render() {
  if (!props.data) return;
  ticketUrl.value = renderTicket({ ...props.data, theme: theme.value }).toDataURL('image/png');
}

watch(
  () => props.data,
  async (d) => {
    if (d) {
      theme.value = d.theme;
      render();
      qrUrl.value = await QRCode.toDataURL(d.url, {
        width: 360,
        margin: 1,
        color: { dark: '#2b2a25', light: '#f4efe3' },
      });
      nextTick(() => closeBtn.value?.focus());
    }
  },
  { immediate: true },
);
watch(theme, render);

const THEMES: [TicketTheme, string][] = [
  ['certificate', '宇宙收录证'],
  ['epitaph', '未来墓志铭'],
  ['ticket', '原始藏书票'],
];

async function copyText(t: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(t);
    return true;
  } catch {}
  try {
    const ta = document.createElement('textarea');
    ta.value = t;
    document.body.appendChild(ta);
    ta.select();
    document.execCommand('copy');
    ta.remove();
    return true;
  } catch {
    return false;
  }
}

/** 复制图文：句子 + 文案 + 链接，粘贴到任何聊天里即完成分享 */
async function copyBody() {
  const d = props.data;
  if (!d) return;
  const body = `${d.shareBody ?? '巴别图书馆的一页。'}\n${d.url}`;
  if (await copyText(body)) {
    copiedBody.value = true;
    setTimeout(() => (copiedBody.value = false), 2000);
  }
}

async function copyPreview() {
  const d = props.data;
  if (!d?.previewUrl) return;
  if (await copyText(d.previewUrl)) {
    copiedPreview.value = true;
    setTimeout(() => (copiedPreview.value = false), 2000);
  }
}

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
  const focusables = [...el.querySelectorAll<HTMLElement>('button, a[href], input')];
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
    aria-label="分享这一页"
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

      <div class="share-qr">
        <img :src="qrUrl" alt="扫码打开这一页" />
        <p class="hint">微信 / 浏览器扫一扫，直达这一页</p>
      </div>

      <div class="ticket-actions">
        <button class="btn primary" @click="copyBody">
          {{ copiedBody ? '已复制 ✓' : '复制图文' }}
        </button>
        <a class="btn ticket-download" :href="ticketUrl" download="巴别图书馆收录证.png">保存图片</a>
        <button v-if="data.previewUrl" class="btn" @click="copyPreview">
          {{ copiedPreview ? '已复制 ✓' : '复制预览链接' }}
        </button>
        <button ref="closeBtn" class="btn" @click="emit('close')">收起</button>
      </div>
    </div>
  </div>
</template>
