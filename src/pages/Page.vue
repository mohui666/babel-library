<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, watch, watchEffect } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { PAGE_LEN, SPACE_SIZE, permute, permuteInv, textOfAddress } from '../core/codec';
import { addrToKey, keyToAddr, decompose, formatAddress } from '../core/address';
import { b64uToBytes } from '../core/base64';
import {
  unpackRecipe,
  addressFromRecipeDelta,
  fullPageAddress,
} from '../core/search';
import { PAGE_APHORISMS, pickByAddress } from '../core/aphorisms';
import { CLASSICS } from '../classics/books';
import { renderTicket } from '../core/ticket';
import { loadShelf, toggleShelf, inShelf, type ShelfItem } from '../core/shelf';

const route = useRoute();
const router = useRouter();

// ---------------------------------------------------------------------------
// 链接解析：配方、配方+delta、名著章节、文字页（/v1/t/）、规范长链接（均 /v1）
// ---------------------------------------------------------------------------

type Ctx =
  | { kind: 'recipe'; payload: string; delta: bigint }
  | { kind: 'classic'; bookId: string; ch: number }
  | { kind: 'canonical' };

const resolved = computed<{ address: bigint; q: string; ctx: Ctx } | null>(() => {
  try {
    if (route.name === 'recipe' || route.name === 'delta') {
      const payload = route.params.payload as string;
      const r = unpackRecipe(payload);
      const delta = route.name === 'delta' ? BigInt(route.params.delta as string) : 0n;
      return {
        address: addressFromRecipeDelta(r, delta),
        q: delta === 0n ? r.query : '',
        ctx: { kind: 'recipe', payload, delta },
      };
    }
    if (route.name === 'classicPage') {
      const bookId = route.params.id as string;
      const ch = Number(route.params.ch);
      const book = CLASSICS.find((b) => b.id === bookId);
      if (!book || !Number.isInteger(ch) || ch < 0 || ch >= book.chapters.length) return null;
      return {
        address: fullPageAddress(book.chapters[ch].text),
        q: '',
        ctx: { kind: 'classic', bookId, ch },
      };
    }
    if (route.name === 'textPage') {
      const text = new TextDecoder().decode(b64uToBytes(route.params.data as string));
      return { address: fullPageAddress(text), q: '', ctx: { kind: 'canonical' } };
    }
    const q = typeof route.query.q === 'string' ? route.query.q : '';
    return { address: keyToAddr(route.params.key as string), q, ctx: { kind: 'canonical' } };
  } catch {
    return null;
  }
});

const query = computed(() => resolved.value?.q ?? '');

const state = computed(() => {
  const r = resolved.value;
  if (!r) return { ok: false as const };
  try {
    const address = r.address;
    if (address < 0n || address >= SPACE_SIZE) return { ok: false as const };
    const pageNumber = permuteInv(address);
    const coords = decompose(pageNumber);
    const text = textOfAddress(address);
    return { ok: true as const, address, pageNumber, coords, text };
  } catch {
    return { ok: false as const };
  }
});

/** 名著章际导航 */
const classicInfo = computed(() => {
  const c = resolved.value?.ctx;
  if (!c || c.kind !== 'classic') return null;
  const book = CLASSICS.find((b) => b.id === c.bookId)!;
  return { book, ch: c.ch };
});

function gotoChapter(index: number) {
  const info = classicInfo.value;
  if (!info) return;
  router.push(`/classic/${info.book.id}/${index}`);
}

// ---------------------------------------------------------------------------
// 翻页与书籍导航：配方上下文中保持短链接（delta），否则用规范长链接
// ---------------------------------------------------------------------------

const prevLink = computed(() => {
  if (!state.value.ok || state.value.pageNumber <= 0n) return null;
  const c = resolved.value!.ctx;
  if (c.kind === 'classic') return null;
  if (c.kind === 'recipe') {
    const d = c.delta - 1n;
    return d === 0n ? `/v1/s/${c.payload}` : `/v1/s/${c.payload}/d/${d}`;
  }
  return `/v1/page/${addrToKey(permute(state.value.pageNumber - 1n))}`;
});

const nextLink = computed(() => {
  if (!state.value.ok || state.value.pageNumber >= SPACE_SIZE - 1n) return null;
  const c = resolved.value!.ctx;
  if (c.kind === 'classic') return null;
  if (c.kind === 'recipe') {
    const d = c.delta + 1n;
    return d === 0n ? `/v1/s/${c.payload}` : `/v1/s/${c.payload}/d/${d}`;
  }
  return `/v1/page/${addrToKey(permute(state.value.pageNumber + 1n))}`;
});

const bookLink = computed(() => {
  if (!state.value.ok) return null;
  const c = resolved.value!.ctx;
  if (c.kind === 'classic') return null;
  if (c.kind === 'recipe') return `/v1/s/${c.payload}/book`;
  const bookBase = state.value.pageNumber - BigInt(state.value.coords.page);
  return `/v1/book/${addrToKey(permute(bookBase))}`;
});

/** 检索词在页内的码位区间（无检索词或未命中为 null） */
const markRange = computed<[number, number] | null>(() => {
  if (!state.value.ok || !query.value) return null;
  const idx = state.value.text.indexOf(query.value);
  if (idx < 0) return null;
  const start = [...state.value.text.slice(0, idx)].length;
  return [start, start + [...query.value].length];
});

const hasMark = computed(() => markRange.value !== null);

/** 镇页箴言：按地址确定，同一页永远是同一句 */
const aphorism = computed(() =>
  state.value.ok ? pickByAddress(PAGE_APHORISMS, state.value.address) : '',
);

/** 朝圣计数：无检索词地途经一页（漫游/翻页），累计记入本地 */
const wandered = ref(0);

function bumpWandered() {
  try {
    const n = Number(localStorage.getItem('babel:wandered') ?? '0') + 1;
    localStorage.setItem('babel:wandered', String(n));
    wandered.value = n;
  } catch {
    wandered.value = 1;
  }
}

watch(
  () => (state.value.ok ? state.value.address : null),
  (addr) => {
    if (addr !== null && !query.value) bumpWandered();
  },
  { immediate: true },
);

interface Seg {
  t: string;
  marked: boolean;
}

/** 把整页按 50 字一行切开，同时标注高亮区间 */
const lines = computed<Seg[][]>(() => {
  if (!state.value.ok) return [];
  const chars = [...state.value.text];
  const range = markRange.value;

  const LINE = 50;
  const out: Seg[][] = [];
  for (let l = 0; l * LINE < chars.length; l++) {
    const segs: Seg[] = [];
    let cur = '';
    let curMarked = false;
    for (let i = 0; i < LINE; i++) {
      const g = l * LINE + i;
      if (g >= chars.length) break;
      const marked = range !== null && g >= range[0] && g < range[1];
      if (i === 0) {
        curMarked = marked;
        cur = chars[g];
      } else if (marked === curMarked) {
        cur += chars[g];
      } else {
        segs.push({ t: cur, marked: curMarked });
        cur = chars[g];
        curMarked = marked;
      }
    }
    if (cur) segs.push({ t: cur, marked: curMarked });
    out.push(segs);
  }
  return out;
});

// ---------------------------------------------------------------------------
// 检索进入默认聚焦原句、只显示上下文；完整书页折叠（漫游则默认全页）
// ---------------------------------------------------------------------------

const focus = ref(false);
const expanded = ref(false);

watch(
  hasMark,
  (v) => {
    focus.value = v;
    expanded.value = false;
  },
  { immediate: true },
);

const firstMarkLine = computed(() => {
  const ls = lines.value;
  for (let i = 0; i < ls.length; i++) {
    if (ls[i].some((s) => s.marked)) return i;
  }
  return 0;
});

const view = computed<{ rows: Seg[][]; truncated: boolean }>(() => {
  const ls = lines.value;
  if (!hasMark.value || expanded.value) return { rows: ls, truncated: false };
  const from = Math.max(0, firstMarkLine.value - 2);
  const to = Math.min(ls.length, firstMarkLine.value + 3);
  return { rows: ls.slice(from, to), truncated: true };
});

// ---------------------------------------------------------------------------
// 藏书票（分享图卡）与藏书夹
// ---------------------------------------------------------------------------

const showTicket = ref(false);
const ticketUrl = ref('');

function makeTicket() {
  if (!state.value.ok) return;
  const ls = lines.value;
  const center = firstMarkLine.value;
  const from = Math.max(0, center - 4);
  const to = Math.min(ls.length, center + 5);
  const canvas = renderTicket({
    lines: ls.slice(from, to),
    addressText: formatAddress(state.value.coords),
    url: window.location.host,
  });
  ticketUrl.value = canvas.toDataURL('image/png');
  showTicket.value = true;
}

const shelf = ref<ShelfItem[]>(loadShelf());
const currentPath = computed(() => route.fullPath);
const saved = computed(() => inShelf(shelf.value, currentPath.value));

function toggleSave() {
  if (!state.value.ok) return;
  const label = query.value || [...state.value.text].slice(0, 12).join('') + '…';
  shelf.value = toggleShelf(shelf.value, {
    path: currentPath.value,
    label,
    addressText: formatAddress(state.value.coords),
    addedAt: Date.now(),
  });
}

// ---------------------------------------------------------------------------
// 真目录彩蛋：寻得原句者，页面装帧与编号发生异常（无任何提示）
// ---------------------------------------------------------------------------

const SPHERE = '图书馆是一个球体，它精确的中心是任何一个六边形，它的圆周是远不可及的。';
const isTrueCatalogue = computed(() => query.value === SPHERE);

// ---------------------------------------------------------------------------
// 复制：本页链接 / 分享文案
// ---------------------------------------------------------------------------

async function copyText(t: string) {
  try {
    await navigator.clipboard.writeText(t);
  } catch {
    const ta = document.createElement('textarea');
    ta.value = t;
    document.body.appendChild(ta);
    ta.select();
    document.execCommand('copy');
    ta.remove();
  }
}

const copiedLink = ref(false);
const copiedShare = ref(false);

async function copyLink() {
  await copyText(window.location.href);
  copiedLink.value = true;
  setTimeout(() => (copiedLink.value = false), 2000);
}

async function copyShare() {
  if (!state.value.ok) return;
  const addr = formatAddress(state.value.coords);
  const text = query.value
    ? `我在巴别图书馆找到了「${query.value}」——它写在${addr}：${window.location.href}`
    : `巴别图书馆的一页——${addr}：${window.location.href}`;
  await copyText(text);
  copiedShare.value = true;
  setTimeout(() => (copiedShare.value = false), 2000);
}

// ---------------------------------------------------------------------------
// 键盘翻页（←/→；名著上下文按章翻）；动态标题
// ---------------------------------------------------------------------------

function onKey(e: KeyboardEvent) {
  const info = classicInfo.value;
  if (e.key === 'ArrowLeft') {
    if (info && info.ch > 0) gotoChapter(info.ch - 1);
    else if (!info && prevLink.value) router.push(prevLink.value);
  } else if (e.key === 'ArrowRight') {
    if (info && info.ch + 1 < info.book.chapters.length) gotoChapter(info.ch + 1);
    else if (!info && nextLink.value) router.push(nextLink.value);
  }
}

onMounted(() => window.addEventListener('keydown', onKey));
onUnmounted(() => window.removeEventListener('keydown', onKey));

watchEffect(() => {
  document.title = state.value.ok
    ? `${formatAddress(state.value.coords)} · 巴别图书馆`
    : '巴别图书馆';
});

const PAGE = PAGE_LEN;
</script>

<template>
  <div v-if="!state.ok" class="error-page">
    <p>这个地址不属于本馆。它指向图书馆之外——或某一册假目录所虚构的所在。</p>
    <RouterLink class="btn" to="/">回到检索</RouterLink>
  </div>

  <template v-else>
    <header class="page-head">
      <div v-if="classicInfo" class="page-nav classic-nav">
        <button v-if="classicInfo.ch > 0" class="btn small" @click="gotoChapter(classicInfo.ch - 1)">
          ← 上一章
        </button>
        <span class="page-pos">
          《{{ classicInfo.book.title }}》第 {{ classicInfo.ch + 1 }} /
          {{ classicInfo.book.chapters.length }} 章
        </span>
        <button
          v-if="classicInfo.ch + 1 < classicInfo.book.chapters.length"
          class="btn small"
          @click="gotoChapter(classicInfo.ch + 1)"
        >
          下一章 →
        </button>
        <RouterLink class="btn small" :to="`/classic/${classicInfo.book.id}`">返回此书</RouterLink>
      </div>

      <p v-if="isTrueCatalogue" class="addr full true-catalogue-addr">真目录 · 第一页</p>
      <p v-else class="addr full">{{ formatAddress(state.coords) }}</p>
      <details v-if="!isTrueCatalogue" class="hall-detail">
        <summary>完整馆编号</summary>
        <p class="hall-digits">{{ (state.coords.hall + 1n).toString(10) }}</p>
      </details>
      <p v-else class="hall-detail">本页没有编号。或者说，它的编号就是整座图书馆。</p>

      <p v-if="!query && wandered > 0" class="pilgrimage">
        此行你已途经 {{ wandered }} 页无意义的文字——馆员称之为「朝圣」。
      </p>
      <div class="page-nav">
        <RouterLink v-if="prevLink" class="btn small" :to="prevLink">← 上一页</RouterLink>
        <span v-else class="btn small disabled">← 上一页</span>
        <span class="page-pos">第 {{ state.coords.page + 1 }} / 1000 页</span>
        <RouterLink v-if="nextLink" class="btn small" :to="nextLink">下一页 →</RouterLink>
        <span v-else class="btn small disabled">下一页 →</span>
      </div>
      <div class="page-nav">
        <RouterLink v-if="bookLink" class="btn small" :to="bookLink">所属书籍</RouterLink>
        <button v-if="hasMark" class="btn small" @click="focus = !focus">
          {{ focus ? '显示全页' : '只看原句' }}
        </button>
        <button class="btn small" @click="toggleSave">
          {{ saved ? '移出藏书夹' : '收入藏书夹' }}
        </button>
        <button class="btn small" @click="makeTicket">藏书票</button>
        <button class="btn small" @click="copyLink">
          {{ copiedLink ? '已复制 ✓' : '复制本页链接' }}
        </button>
        <button class="btn small" @click="copyShare">
          {{ copiedShare ? '已复制 ✓' : '复制分享文案' }}
        </button>
        <RouterLink class="btn small" to="/">回到检索</RouterLink>
      </div>
    </header>

    <article class="card sheet" :class="{ 'focus-mode': focus && hasMark, 'true-catalogue': isTrueCatalogue }">
      <p v-for="(line, i) in view.rows" :key="i" class="sheet-line">
        <template v-for="(seg, j) in line" :key="j"
          ><mark v-if="seg.marked">{{ seg.t }}</mark
          ><template v-else>{{ seg.t }}</template></template
        >
      </p>
      <div v-if="view.truncated" class="expand-row">
        <button class="btn small" @click="expanded = true">展开完整书页（共 {{ PAGE }} 字）</button>
      </div>
      <div v-else-if="hasMark && lines.length > 5" class="expand-row">
        <button class="btn small" @click="expanded = false; focus = true">收起</button>
      </div>
    </article>

    <div class="print-seal">巴別圖書館<br />藏書票</div>

    <p class="aphorism center no-print">
      {{ isTrueCatalogue ? '一切目录皆从此页派生。' : aphorism }}
    </p>

    <p class="hint center no-print">
      这一页共有 {{ PAGE }} 个字符。它从不存在于任何服务器上——你看到的每个字，都由它的地址推演而来。
    </p>

    <div v-if="showTicket" class="ticket-modal" @click.self="showTicket = false">
      <div class="ticket-box">
        <img :src="ticketUrl" alt="藏书票" class="ticket-img" />
        <div class="ticket-actions">
          <a class="btn primary ticket-download" :href="ticketUrl" download="巴别图书馆藏书票.png">下载藏书票</a>
          <button class="btn" @click="showTicket = false">收起</button>
        </div>
      </div>
    </div>
  </template>
</template>
