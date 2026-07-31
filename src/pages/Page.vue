<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, watch, watchEffect } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { PAGE_LEN, SPACE_SIZE, permute, permuteInv, textOfAddress } from '../core/codec';
import { addrToKey, keyToAddr, decompose, formatAddress } from '../core/address';
import { unpackRecipe, pageFromRecipe } from '../core/search';
import { PAGE_APHORISMS, pickByAddress } from '../core/aphorisms';

const route = useRoute();
const router = useRouter();

/** 解析两类链接：短链接（配方重建）与规范长链接（直接解码地址） */
const resolved = computed<{ address: bigint; q: string } | null>(() => {
  try {
    if (route.name === 'recipe') {
      const r = unpackRecipe(route.params.payload as string);
      return { address: pageFromRecipe(r).address, q: r.query };
    }
    const q = typeof route.query.q === 'string' ? route.query.q : '';
    return { address: keyToAddr(route.params.key as string), q };
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

const prevKey = computed(() => {
  if (!state.value.ok || state.value.pageNumber <= 0n) return null;
  return addrToKey(permute(state.value.pageNumber - 1n));
});
const nextKey = computed(() => {
  if (!state.value.ok || state.value.pageNumber >= SPACE_SIZE - 1n) return null;
  return addrToKey(permute(state.value.pageNumber + 1n));
});
const bookKey = computed(() => {
  if (!state.value.ok) return null;
  const bookBase = state.value.pageNumber - BigInt(state.value.coords.page);
  return addrToKey(permute(bookBase));
});

// ---------------------------------------------------------------------------
// 「只看原句」聚焦模式：乱码淡出，只剩检索词
// ---------------------------------------------------------------------------

const focus = ref(false);

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
// 键盘翻页（←/→）；动态标题
// ---------------------------------------------------------------------------

function onKey(e: KeyboardEvent) {
  if (e.key === 'ArrowLeft' && prevKey.value) router.push(`/page/${prevKey.value}`);
  else if (e.key === 'ArrowRight' && nextKey.value) router.push(`/page/${nextKey.value}`);
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
      <p class="addr full">{{ formatAddress(state.coords) }}</p>
      <details class="hall-detail">
        <summary>完整馆编号</summary>
        <p class="hall-digits">{{ (state.coords.hall + 1n).toString(10) }}</p>
      </details>
      <p v-if="!query && wandered > 0" class="pilgrimage">
        此行你已途经 {{ wandered }} 页无意义的文字——馆员称之为「朝圣」。
      </p>
      <div class="page-nav">
        <RouterLink v-if="prevKey" class="btn small" :to="`/page/${prevKey}`">← 上一页</RouterLink>
        <span v-else class="btn small disabled">← 上一页</span>
        <span class="page-pos">第 {{ state.coords.page + 1 }} / 1000 页</span>
        <RouterLink v-if="nextKey" class="btn small" :to="`/page/${nextKey}`">下一页 →</RouterLink>
        <span v-else class="btn small disabled">下一页 →</span>
      </div>
      <div class="page-nav">
        <RouterLink v-if="bookKey" class="btn small" :to="`/book/${bookKey}`">所属书籍</RouterLink>
        <button v-if="hasMark" class="btn small" @click="focus = !focus">
          {{ focus ? '显示全页' : '只看原句' }}
        </button>
        <button class="btn small" @click="copyLink">
          {{ copiedLink ? '已复制 ✓' : '复制本页链接' }}
        </button>
        <button class="btn small" @click="copyShare">
          {{ copiedShare ? '已复制 ✓' : '复制分享文案' }}
        </button>
        <RouterLink class="btn small" to="/">回到检索</RouterLink>
      </div>
    </header>

    <article class="card sheet" :class="{ 'focus-mode': focus && hasMark }">
      <p v-for="(line, i) in lines" :key="i" class="sheet-line">
        <template v-for="(seg, j) in line" :key="j"
          ><mark v-if="seg.marked">{{ seg.t }}</mark
          ><template v-else>{{ seg.t }}</template></template
        >
      </p>
    </article>

    <div class="print-seal">巴別圖書館<br />藏書票</div>

    <p class="aphorism center no-print">{{ aphorism }}</p>

    <p class="hint center no-print">
      这一页共有 {{ PAGE }} 个字符。它从不存在于任何服务器上——你看到的每个字，都由它的地址推演而来。
    </p>
  </template>
</template>
