<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, watch, watchEffect } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { PAGE_LEN, SPACE_SIZE, permute, permuteInv, textOfAddress } from '../core/codec';
import { addrToKey, keyToAddr, decompose, formatAddress } from '../core/address';
import { b64uToBytes } from '../core/base64';
import { encodeChain, decodeChain } from '../core/chain';
import {
  unpackRecipe,
  addressFromRecipeDelta,
  fullPageAddress,
} from '../core/search';
import { PAGE_APHORISMS, pickByAddress } from '../core/aphorisms';
import { CLASSICS } from '../classics/books';
import { renderTicket, type TicketData } from '../core/ticket';
import TicketModal from '../components/TicketModal.vue';
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
// 收录证（分享图卡，三种装帧）与藏书夹
// ---------------------------------------------------------------------------

const modalData = ref<TicketData | null>(null);

function openTicket() {
  modalData.value = buildTicketData();
}

function buildTicketData(): TicketData | null {
  if (!state.value.ok) return null;
  const ls = lines.value;
  const center = firstMarkLine.value;
  const from = Math.max(0, center - 4);
  const to = Math.min(ls.length, center + 5);
  return {
    query: query.value,
    lines: ls.slice(from, to),
    addressText: formatAddress(state.value.coords),
    url: withShareSrc(window.location.href),
    host: window.location.host,
    theme: 'certificate',
    chain: chainSegs.value.length
      ? { count: chainSegs.value.length, continueUrl: chainContinueUrl.value }
      : undefined,
  };
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

/** 接收者来源：分享链接带 src=share 时 CTA 更突出 */
const fromShare = computed(() => route.query.src === 'share');

/** CTA 回首页：带来源标记并继承当前主题 */
const ctaHome = computed(() => {
  let t = '';
  try {
    t = localStorage.getItem('babel:theme-idx') ?? '';
  } catch {}
  return `/?src=share${t !== '' ? `&theme=${t}` : ''}`;
});

/** 宇宙接龙档案：链接携带各棒归属（来自首页接龙定位） */
const chainSegs = computed<string[]>(() => {
  const c = route.query.chain;
  if (typeof c !== 'string' || !c) return [];
  return decodeChain(c) ?? [];
});

/** 续棒链接：扫码回到首页接着写 */
const chainContinueUrl = computed(() =>
  chainSegs.value.length
    ? `${window.location.origin}${window.location.pathname}#/?chain=${encodeChain(chainSegs.value)}`
    : '',
);

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

/** 分享链接带来源标记：接收者打开时展示更明显的「我也找一句」 */
function withShareSrc(href: string): string {
  return href.includes('?') ? `${href}&src=share` : `${href}?src=share`;
}

function shareText(): string {
  if (!state.value.ok) return '';
  if (chainSegs.value.length > 0) {
    return `我们 ${chainSegs.value.length} 个人在巴别图书馆合著了一页，现在轮到你。`;
  }
  const addr = formatAddress(state.value.coords);
  return query.value
    ? `我在巴别图书馆找到了「${query.value}」——它不是刚刚生成的，从一开始，它就在${addr}等着我。你也去找一句：`
    : `巴别图书馆的一页——${addr}。你也去找一句：`;
}

/** 主分享动作：优先系统分享面板（可带收录证图），不支持则复制文案+链接 */
async function sharePage() {
  if (!state.value.ok) return;
  const url = withShareSrc(window.location.href);
  const body = `${shareText()}\n${url}`;
  const nav = navigator as Navigator & {
    share?: (d: ShareData) => Promise<void>;
    canShare?: (d: ShareData) => boolean;
  };
  if (nav.share) {
    try {
      const d = buildTicketData();
      if (d && nav.canShare) {
        const blob = await new Promise<Blob | null>((r) =>
          renderTicket(d).toBlob(r, 'image/png'),
        );
        if (blob) {
          const file = new File([blob], '宇宙收录证.png', { type: 'image/png' });
          if (nav.canShare({ files: [file] })) {
            await nav.share({ files: [file], title: '巴别图书馆', text: body });
            return;
          }
        }
      }
      await nav.share({ title: '巴别图书馆', text: body });
      return;
    } catch (e) {
      if ((e as DOMException)?.name === 'AbortError') return; // 用户取消
    }
  }
  await copyText(body);
  copiedShare.value = true;
  setTimeout(() => (copiedShare.value = false), 2000);
}

async function copyShare() {
  await copyText(`${shareText()}\n${withShareSrc(window.location.href)}`);
  copiedShare.value = true;
  setTimeout(() => (copiedShare.value = false), 2000);
}

// ---------------------------------------------------------------------------
// 键盘翻页（←/→；名著上下文按章翻）；动态标题
// ---------------------------------------------------------------------------

function onKey(e: KeyboardEvent) {
  // 收录证弹窗开启时：方向键不翻页（Esc/Tab 由弹窗组件自理）
  if (modalData.value && (e.key === 'ArrowLeft' || e.key === 'ArrowRight')) return;
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
      <div class="page-nav main-actions">
        <button class="btn primary" @click="sharePage">
          {{ copiedShare ? '已复制文案 ✓' : '分享这句话' }}
        </button>
        <button class="btn" @click="openTicket">收录证</button>
        <button class="btn" @click="toggleSave">
          {{ saved ? '移出藏书夹' : '收入藏书夹' }}
        </button>
        <details class="more-actions">
          <summary class="btn small">更多</summary>
          <div class="more-actions-body">
            <RouterLink v-if="bookLink" class="btn small" :to="bookLink">所属书籍</RouterLink>
            <button v-if="hasMark" class="btn small" @click="focus = !focus">
              {{ focus ? '显示全页' : '只看原句' }}
            </button>
            <button class="btn small" @click="copyLink">
              {{ copiedLink ? '已复制 ✓' : '复制本页链接' }}
            </button>
            <button class="btn small" @click="copyShare">复制分享文案</button>
            <RouterLink class="btn small" to="/">回到检索</RouterLink>
          </div>
        </details>
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

    <div v-if="chainSegs.length" class="chain-archive">
      <p class="chain-archive-title">
        宇宙接龙档案 · 本页由 {{ chainSegs.length }} 位馆员共同写就
      </p>
      <p v-for="(s, i) in chainSegs" :key="i" class="chain-archive-seg">
        <span class="cowrite-who">第 {{ i + 1 }} 位馆员</span>{{ s }}
      </p>
    </div>

    <div class="cta-find" :class="{ big: fromShare }">
      <p>{{ fromShare ? '这句话属于朋友。你的那一句在哪里？' : '你的下一句话，会在哪里？' }}</p>
      <RouterLink class="btn primary" :to="ctaHome">也给我的话找一个地址</RouterLink>
    </div>

    <p class="aphorism center no-print">
      {{ isTrueCatalogue ? '一切目录皆从此页派生。' : aphorism }}
    </p>

    <p class="hint center no-print">
      这一页共有 {{ PAGE }} 个字符。它从不存在于任何服务器上——你看到的每个字，都由它的地址推演而来。
    </p>

    <TicketModal :data="modalData" @close="modalData = null" />
  </template>
</template>
