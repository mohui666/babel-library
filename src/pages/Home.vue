<script setup lang="ts">
import { computed, nextTick, ref, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import {
  validateQuery,
  search,
  randomPage,
  splitIntoChunks,
  codePointLen,
  MAX_CHUNKS,
  type SearchResult,
} from '../core/search';
import { POOLS } from '../core/pools';
import { b64uToBytes } from '../core/base64';
import {
  encodeChain,
  decodeChain,
  CHAIN_MAX_SEGS,
  CHAIN_SEG_MAX_CHARS,
} from '../core/chain';
import {
  loadPools,
  loadCustomFill,
  POOLS_STORAGE_KEY,
  CUSTOM_FILL_KEY,
} from '../core/fill';
import { HERO_QUOTES, RESULT_APHORISMS, pickRandom } from '../core/aphorisms';
import { type TicketData, type TicketSeg } from '../core/ticket';
import TicketModal from '../components/TicketModal.vue';

const route = useRoute();
const router = useRouter();
const query = ref('');
const error = ref('');
const badChars = ref<string[]>([]);

// ---------------------------------------------------------------------------
// 单结果揭示：一次只定位一页，坐标逐层揭晓
// ---------------------------------------------------------------------------

const currentResult = ref<SearchResult | null>(null);
const revealing = ref(false);
const revealSteps = ref<string[]>([]);
const lastQuery = ref('');
const resultAphorism = ref('');

/** 书写体系语言池（默认全选 = 全字符集均匀；选择持久化到本地） */
const pools = POOLS;
const selectedPools = ref<string[]>(loadPools());
watch(
  selectedPools,
  (v) => {
    try {
      localStorage.setItem(POOLS_STORAGE_KEY, JSON.stringify(v));
    } catch {}
  },
  { deep: true },
);

/** 限定字符集：乱码只使用其中出现过的字符（优先于语言池） */
const customFill = ref<string>(loadCustomFill());
watch(customFill, (v) => {
  try {
    localStorage.setItem(CUSTOM_FILL_KEY, v);
  } catch {}
});

const customFillActive = computed(() => customFill.value.trim().length > 0);

function fillArgs(): { poolIds?: string[]; customText?: string } {
  if (customFillActive.value) return { customText: customFill.value.trim() };
  return {
    poolIds:
      selectedPools.value.length === POOLS.length ? undefined : [...selectedPools.value],
  };
}

/** 分段定位状态 */
interface ChunkEntry {
  no: number;
  chars: number;
  key: string;
  shortPath?: string;
  addressText: string;
  preview: string;
  query: string;
}
const chunkResults = ref<ChunkEntry[]>([]);
const chunkProgress = ref('');
const chunkTotalChars = ref(0);
const fileInput = ref<HTMLInputElement>();

/** 递增的运行号：开始新检索作废旧流程 */
let runId = 0;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function clearOutputs() {
  currentResult.value = null;
  revealing.value = false;
  revealSteps.value = [];
  chunkResults.value = [];
  chunkProgress.value = '';
}

function runSearch() {
  const id = ++runId;
  resultChain.value = null;
  if (selectedPools.value.length === 0 && !customFillActive.value) {
    error.value = '请至少选择一种书写体系，或输入一段限定字符集。';
    badChars.value = [];
    clearOutputs();
    return;
  }
  // 接龙：链上各段 + 当前输入（若有）拼成全句
  const segs =
    chain.value.length > 0
      ? [...chain.value, ...(query.value.trim() ? [query.value] : [])]
      : null;
  const combined = segs ? segs.join('') : query.value;
  const prepared = combined.normalize('NFC').replace(/\r\n?/g, '\n').trim();
  // 换行不收录于字符集，仅作分段边界，校验时排除
  const v = validateQuery(prepared.replace(/\n/g, ''));
  if (!v.ok) {
    error.value = v.message;
    badChars.value = v.badChars;
    clearOutputs();
    return;
  }
  error.value = '';
  badChars.value = [];

  const chunks = splitIntoChunks(prepared);
  if (chunks.length === 0) {
    error.value = '请先写下你要寻找的文字。';
    return;
  }
  if (chunks.length === 1) {
    lastQuery.value = chunks[0];
    resultChain.value = segs;
    const f = fillArgs();
    const [r] = search(chunks[0], 1, f.poolIds, f.customText);
    reveal(r, id);
    return;
  }
  if (chunks.length > MAX_CHUNKS) {
    error.value = `本馆一次最多为 ${MAX_CHUNKS} 段文字定位，你的文本可分为 ${chunks.length} 段。请分卷提交。`;
    clearOutputs();
    return;
  }
  locateChunks(chunks, id);
}

/** 坐标逐层揭晓，然后呈现唯一结果。
 *  每次定位（含「另一处」）都是完整仪式；reduced-motion 即时；点击可跳过 */
let skipReveal = false;
const resultEl = ref<HTMLElement>();
const reducedMotion =
  typeof window !== 'undefined' &&
  window.matchMedia('(prefers-reduced-motion: reduce)').matches;

async function reveal(r: SearchResult, id: number) {
  chunkResults.value = [];
  currentResult.value = null;
  if (reducedMotion) {
    currentResult.value = r;
    resultAphorism.value = pickRandom(RESULT_APHORISMS);
    nextTickScroll('auto');
    return;
  }
  revealing.value = true;
  skipReveal = false;
  revealSteps.value = [];
  // 真实坐标逐行出现：馆 → 层 → 室 → 架 → 册 → 页
  const coords = r.addressText.split(' · ');
  for (const s of coords) {
    if (id !== runId || skipReveal) break;
    revealSteps.value.push(s);
    await sleep(260);
  }
  if (id !== runId) return;
  if (!skipReveal) {
    revealSteps.value.push('找到了。');
    await sleep(400);
  }
  if (id !== runId) return;
  revealing.value = false;
  currentResult.value = r;
  resultAphorism.value = pickRandom(RESULT_APHORISMS);
  nextTickScroll();
}

function nextTickScroll(behavior: ScrollBehavior = 'smooth') {
  setTimeout(() => resultEl.value?.scrollIntoView({ behavior, block: 'center' }), 50);
}

/** 分段定位：每段各算出一页真实坐标，逐段报告进度 */
async function locateChunks(chunks: string[], id: number) {
  currentResult.value = null;
  revealing.value = false;
  chunkResults.value = [];
  chunkTotalChars.value = chunks.reduce((s, c) => s + codePointLen(c), 0);
  const { poolIds, customText } = fillArgs();
  for (let i = 0; i < chunks.length; i++) {
    if (id !== runId) return;
    chunkProgress.value = `正在定位 ${i + 1} / ${chunks.length} 段…`;
    const [r] = search(chunks[i], 1, poolIds, customText);
    chunkResults.value.push({
      no: i + 1,
      chars: codePointLen(chunks[i]),
      key: r.key,
      shortPath: r.shortPath,
      addressText: r.addressText,
      preview: [...chunks[i]].slice(0, 60).join(''),
      query: chunks[i],
    });
    await sleep(0);
  }
  chunkProgress.value = '';
}

/** 剔除报错中列出的字符后重试（只剔除报错项，换行等结构保留） */
function stripBadChars() {
  const set = new Set(badChars.value);
  query.value = [...query.value].filter((ch) => !set.has(ch)).join('');
  runSearch();
}

/** 读取文本文件：优先 UTF-8，失败则按 GBK 解码（兼容旧文本） */
async function readFileText(file: File): Promise<string> {
  const buf = await file.arrayBuffer();
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(buf);
  } catch {
    try {
      return new TextDecoder('gbk').decode(buf);
    } catch {
      return new TextDecoder('utf-8').decode(buf);
    }
  }
}

async function onFile(e: Event) {
  const input = e.target as HTMLInputElement;
  const file = input.files?.[0];
  input.value = '';
  if (!file) return;
  try {
    query.value = await readFileText(file);
  } catch {
    error.value = '这份文件无法按文本读取。本馆只收录纯文本。';
    return;
  }
  runSearch();
}

function roam() {
  if (selectedPools.value.length === 0 && !customFillActive.value) {
    error.value = '请至少选择一种书写体系，或输入一段限定字符集。';
    return;
  }
  const f = fillArgs();
  const { shortPath } = randomPage(f.poolIds, f.customText);
  router.push(shortPath);
}

/** 把片段按高亮区间切成三段（码位安全） */
function segments(r: SearchResult): [string, string, string] {
  const chars = [...r.snippet];
  return [
    chars.slice(0, r.markStart).join(''),
    chars.slice(r.markStart, r.markStart + r.markLen).join(''),
    chars.slice(r.markStart + r.markLen).join(''),
  ];
}

function resultLink(r: SearchResult | ChunkEntry): string {
  const base = r.shortPath ?? `/v1/page/${r.key}?q=${encodeURIComponent(r.query)}`;
  // 接龙作品：把各棒归属带进正式书页（宇宙接龙档案）
  if (resultChain.value && resultChain.value.length > 0) {
    return `${base}${base.includes('?') ? '&' : '?'}chain=${encodeChain(resultChain.value)}`;
  }
  return base;
}

// ---------------------------------------------------------------------------
// 无限接龙：#/?chain=<base64url(JSON 段落数组)>，每位馆员一段、归属保留
// ---------------------------------------------------------------------------

const chain = ref<string[]>([]);
const resultChain = ref<string[] | null>(null);
const copiedChain = ref(false);
const chainFallbackUrl = ref('');

watch(
  () => [route.query.chain, route.query.draft] as const,
  ([c, d]) => {
    let segs: string[] | null = null;
    if (typeof c === 'string' && c) segs = decodeChain(c);
    else if (typeof d === 'string' && d) {
      // 旧格式 ?draft= 兼容：视为一棒
      try {
        const t = new TextDecoder().decode(b64uToBytes(d));
        if (t) segs = [t];
      } catch {}
    }
    if (segs) {
      chain.value = segs;
      query.value = '';
      nextTick(() => textareaEl.value?.focus());
    } else if (chain.value.length > 0) {
      // URL 已无接龙参数（如点击馆名回首页）：清除接龙状态
      chain.value = [];
      resultChain.value = null;
    }
  },
  { immediate: true },
);

const chainTotalLen = computed(() => chain.value.reduce((s, x) => s + codePointLen(x), 0));

/** 复制到剪贴板（含 execCommand 回退），返回是否成功 */
async function copyTextShim(t: string): Promise<boolean> {
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

type ShareOutcome = 'shared' | 'copied' | 'cancelled';

/** 分享接龙链接；返回结果供调用方决定是否提交这一棒 */
async function shareChain(segs: string[], body: string): Promise<ShareOutcome> {
  const url = `${window.location.origin}${window.location.pathname}#/?chain=${encodeChain(segs)}`;
  const full = `${body}\n${url}`;
  const nav = navigator as Navigator & { share?: (d: ShareData) => Promise<void> };
  if (nav.share) {
    try {
      await nav.share({ title: '巴别图书馆 · 接龙', text: full });
      return 'shared';
    } catch (e) {
      if ((e as DOMException)?.name === 'AbortError') {
        chainFallbackUrl.value = url; // 取消也亮出链接，这一棒不会被吞
        return 'cancelled';
      }
    }
  }
  if (await copyTextShim(full)) {
    copiedChain.value = true;
    setTimeout(() => (copiedChain.value = false), 2500);
    return 'copied';
  }
  chainFallbackUrl.value = url;
  return 'cancelled';
}

/** 发起接龙（第一棒） */
async function inviteCowrite() {
  const text = query.value.normalize('NFC').trim();
  if (!text) {
    error.value = '先写下一句话，再开龙。';
    return;
  }
  if (codePointLen(text) > CHAIN_SEG_MAX_CHARS) {
    error.value = `第一棒请控制在 ${CHAIN_SEG_MAX_CHARS} 字以内，邀请链接才不至于过长。`;
    return;
  }
  error.value = '';
  await shareChain([text], `这句话我只写了开头，等你来续：${text}\n点开接着写 →`);
}

/** 接着传下去：分享成功后才把这一棒入链；取消不吞字 */
async function passChain() {
  const t = query.value.normalize('NFC').trim();
  if (!t) {
    error.value = '写下你的那一段，再传给下一位。';
    return;
  }
  if (chain.value.length >= CHAIN_MAX_SEGS) {
    error.value = `已接满 ${CHAIN_MAX_SEGS} 棒，该完成接龙并定位了。`;
    return;
  }
  if (codePointLen(t) > CHAIN_SEG_MAX_CHARS) {
    error.value = `每一棒请控制在 ${CHAIN_SEG_MAX_CHARS} 字以内。`;
    return;
  }
  error.value = '';
  const segs = [...chain.value, t];
  const outcome = await shareChain(
    segs,
    `巴别图书馆 · 接龙第 ${segs.length} 棒——前面已有 ${segs.length - 1} 段，等你续下一段 →`,
  );
  if (outcome === 'cancelled') return; // 文字留在输入框，链接已亮出
  chain.value = segs;
  query.value = '';
}

/** 重新分享当前接龙（不新增段落） */
async function reshareChain() {
  await shareChain(
    chain.value,
    `巴别图书馆 · 接龙第 ${chain.value.length} 棒——等你续下一段 →`,
  );
}

function dropChain() {
  chain.value = [];
  resultChain.value = null;
}

// ---------------------------------------------------------------------------
// 主题入口（按本地日期轮换；?theme= 可继承主题）
// ---------------------------------------------------------------------------

const THEMES = [
  {
    name: '未来墓志铭',
    hint: '如果宇宙只替你保留一句话，你会写什么？',
    example: '这里躺着的人，终于读完了整座图书馆。',
  },
  {
    name: '一句从未说出口的话',
    hint: '有些话说不出，就先存在馆里。',
    example: '我其实一直后悔那天的沉默。',
  },
  {
    name: '写给十年后的自己',
    hint: '图书馆比任何信箱都长久。',
    example: '十年后的我，你过得比今天好吗？',
  },
];

const themeIdx = ref(
  (() => {
    const n = new Date();
    return (n.getFullYear() * 10000 + (n.getMonth() + 1) * 100 + n.getDate()) % THEMES.length;
  })(),
);

// 分享回流的主题继承：?theme=N 预选主题
if (typeof route.query.theme === 'string') {
  const i = Number(route.query.theme);
  if (Number.isInteger(i) && i >= 0 && i < THEMES.length) themeIdx.value = i;
}
watch(themeIdx, (v) => {
  try {
    localStorage.setItem('babel:theme-idx', String(v));
  } catch {}
});

const theme = computed(() => THEMES[themeIdx.value]);
const textareaEl = ref<HTMLTextAreaElement>();

function pickTheme(i: number) {
  themeIdx.value = i;
  query.value = THEMES[i].example;
  // 只填入示例并全选，由用户改完后自己定位——避免满屏雷同的"系统分享"
  nextTick(() => {
    textareaEl.value?.focus();
    textareaEl.value?.select();
  });
}

// ---------------------------------------------------------------------------
// 收录证前置：结果卡直接领取
// ---------------------------------------------------------------------------

const modalData = ref<TicketData | null>(null);

/** 把检索片段按 50 字一行切成带高亮标记的行（用作图卡纹理） */
function snippetLines(r: SearchResult): TicketSeg[][] {
  const chars = [...r.snippet];
  const out: TicketSeg[][] = [];
  for (let l = 0; l * 50 < chars.length; l++) {
    const segs: TicketSeg[] = [];
    let cur = '';
    let curM = false;
    for (let i = 0; i < 50; i++) {
      const g = l * 50 + i;
      if (g >= chars.length) break;
      const m = g >= r.markStart && g < r.markStart + r.markLen;
      if (i === 0) {
        curM = m;
        cur = chars[g];
      } else if (m === curM) {
        cur += chars[g];
      } else {
        segs.push({ t: cur, marked: curM });
        cur = chars[g];
        curM = m;
      }
    }
    if (cur) segs.push({ t: cur, marked: curM });
    out.push(segs);
  }
  return out;
}

function openResultTicket() {
  const r = currentResult.value;
  if (!r) return;
  modalData.value = {
    query: lastQuery.value,
    lines: snippetLines(r).slice(0, 9),
    addressText: r.addressText,
    url: `${window.location.origin}${window.location.pathname}#${resultLink(r)}`,
    host: window.location.host,
    theme: 'certificate',
    chain: resultChain.value?.length
      ? {
          count: resultChain.value.length,
          continueUrl: `${window.location.origin}${window.location.pathname}#/?chain=${encodeChain(resultChain.value)}`,
        }
      : undefined,
  };
}

/** 供「分享这句话」复用的图卡数据已内联于 openResultTicket */

// ---------------------------------------------------------------------------
// 接收者回流横幅
// ---------------------------------------------------------------------------

const fromShare = computed(() => route.query.src === 'share');

const heroQuote = pickRandom(HERO_QUOTES);
const showExamples = computed(
  () => !currentResult.value && !revealing.value && chunkResults.value.length === 0 && !chunkProgress.value,
);
</script>

<template>
  <section v-if="!chain.length" class="hero">
    <blockquote class="quote">
      <p>「{{ heroQuote.text }}」</p>
      <footer>—— {{ heroQuote.cite }}</footer>
    </blockquote>
    <p class="intro">写下一句你不想被遗忘的话——它早已存在于某一页。</p>
    <p class="theme-line">
      今日开放：《{{ theme.name }}》 <span class="hint">{{ theme.hint }}</span>
    </p>
  </section>

  <p v-else class="chain-landing">朋友把第 {{ chain.length + 1 }} 棒交给你。</p>

  <p v-if="fromShare && !chain.length" class="share-banner">
    朋友留下了这句话。现在，轮到你了。
  </p>

  <section class="search-box">
    <div v-if="chain.length" class="cowrite">
      <p class="cowrite-label">
        接龙第 {{ chain.length + 1 }} 棒 · 已有 {{ chain.length }} 段（共 {{ chainTotalLen }} 字）
        <button class="chain-drop" @click="dropChain">放弃接龙</button>
      </p>
      <blockquote v-for="(s, i) in chain" :key="i" class="cowrite-a chain-seg">
        <span class="cowrite-who">第 {{ i + 1 }} 位馆员</span>{{ s }}
      </blockquote>
      <p class="cowrite-label">请你（第 {{ chain.length + 1 }} 位馆员）接写：</p>
      <p v-if="chainTotalLen > 1200" class="hint">链接已较长，建议早日完成接龙。</p>
    </div>
    <label class="sr-only" for="query-input">写下你要定位的文字</label>
    <textarea
      id="query-input"
      ref="textareaEl"
      v-model="query"
      rows="3"
      :placeholder="chain.length ? '写下你的那一段……' : theme.hint"
      aria-label="写下你要定位的文字"
      @keydown.ctrl.enter.prevent="runSearch"
      @keydown.meta.enter.prevent="runSearch"
    ></textarea>
    <div class="search-actions">
      <button class="btn primary" @click="runSearch">
        {{ chain.length ? '完成接龙并定位' : '定位这句话' }}
      </button>
      <button v-if="chain.length" class="btn" @click="passChain">接着传下去</button>
      <button v-if="chain.length" class="btn weak" @click="reshareChain">
        {{ copiedChain ? '链接已复制 ✓' : '分享当前接龙' }}
      </button>
      <button v-if="!chain.length" class="btn weak" @click="roam">随意翻开一页</button>
      <button v-if="query.trim() && !chain.length" class="btn weak" @click="inviteCowrite">
        {{ copiedChain ? '邀请链接已复制 ✓' : '开龙，邀朋友接写' }}
      </button>
      <span class="hint submit-hint">Ctrl + Enter 定位</span>
    </div>
    <p v-if="chainFallbackUrl" class="invite-fallback">
      接龙链接（可手动复制）：
      <input
        readonly
        :value="chainFallbackUrl"
        class="invite-url"
        @focus="($event.target as HTMLInputElement).select()"
      />
    </p>
    <p v-if="error" class="error">
      {{ error }}
      <button v-if="badChars.length" class="btn small" @click="stripBadChars">
        剔除这些符号并定位
      </button>
    </p>
    <div v-if="showExamples && !chain.length" class="examples">
      <span class="hint">换个主题：</span>
      <button
        v-for="(t, i) in THEMES"
        :key="t.name"
        class="example-chip"
        :class="{ active: themeIdx === i }"
        :aria-pressed="themeIdx === i"
        @click="pickTheme(i)"
      >
        {{ t.name }}
      </button>
    </div>
  </section>

  <div v-if="revealing" class="reveal" title="点击跳过" @click="skipReveal = true">
    <p v-for="(s, i) in revealSteps" :key="i" class="reveal-step">{{ s }}</p>
  </div>

  <article
    v-if="currentResult"
    ref="resultEl"
    class="card result single-result found-card"
    aria-live="polite"
  >
    <p class="found-line">它早已写在这里</p>
    <p class="found-query">「{{ lastQuery }}」</p>
    <p class="addr found-addr">{{ currentResult.addressText }}</p>
    <div class="result-actions">
      <button class="btn primary" @click="openResultTicket">领取宇宙收录证</button>
      <RouterLink class="btn" :to="resultLink(currentResult)">翻开完整书页</RouterLink>
      <button class="btn weak" @click="runSearch">在另一处寻找同一句话</button>
    </div>
    <p v-if="resultChain" class="cowrite-mark">
      <template v-for="(s, i) in resultChain.slice(0, 8)" :key="i">
        <span class="cowrite-who">第 {{ i + 1 }} 位馆员：</span>{{ s }}<br />
      </template>
      <span v-if="resultChain.length > 8" class="hint">……共 {{ resultChain.length }} 段</span>
    </p>
    <p class="snippet found-proof">
      <template v-for="(seg, i) in [segments(currentResult)]" :key="i"
        >{{ seg[0] }}<mark>{{ seg[1] }}</mark
        >{{ seg[2] }}</template
      >
    </p>
    <p class="aphorism">{{ resultAphorism }}</p>
  </article>

  <section v-if="chunkProgress || chunkResults.length" class="results">
    <p v-if="chunkProgress" class="results-head">{{ chunkProgress }}</p>
    <template v-else>
      <p class="results-head">
        你的文本共 {{ chunkTotalChars }} 字，篇幅超过一页，
        已分为 {{ chunkResults.length }} 段，各自定位到馆中真实的一页：
      </p>
      <p class="hint">换行不收录于本馆字符集，仅作分段边界。</p>
    </template>
    <article v-for="c in chunkResults" :key="c.no" class="card result">
      <p class="snippet">第 {{ c.no }} 段（{{ c.chars }} 字）：{{ c.preview }}……</p>
      <div class="result-foot">
        <span class="addr">{{ c.addressText }}</span>
        <RouterLink class="btn small" :to="resultLink(c)">翻开这一页</RouterLink>
      </div>
    </article>
  </section>

  <details class="more-ways">
    <summary>更多定位方式</summary>
    <div class="more-body">
      <div class="more-row">
        <button class="btn small" @click="fileInput?.click()">呈上一卷文稿</button>
        <span class="hint">.txt / .md（UTF-8 或 GBK），超过一页自动分段定位</span>
        <input
          ref="fileInput"
          type="file"
          accept=".txt,.md,.text,.log"
          class="hidden-file"
          @change="onFile"
        />
      </div>
      <div class="pool-picker" :class="{ dimmed: customFillActive }">
        <span class="pool-label">页面书写体系：</span>
        <label v-for="p in pools" :key="p.id" class="pool-item">
          <input type="checkbox" v-model="selectedPools" :value="p.id" />
          {{ p.label }}
        </label>
      </div>
      <div class="custom-fill">
        <span class="pool-label">限定字符集：</span>
        <input
          v-model="customFill"
          class="custom-fill-input"
          type="text"
          placeholder="输入一段文字，书页只使用其中的字符（如《静夜思》）"
        />
      </div>
      <p class="hint pool-hint">以上只决定书页其余部分的文字面貌，不限制你能定位的内容。</p>
    </div>
  </details>

  <TicketModal :data="modalData" @close="modalData = null" />
</template>
