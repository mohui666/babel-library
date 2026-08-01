<script setup lang="ts">
import { computed, nextTick, ref, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import {
  validateQuery,
  textPagePath,
  search,
  randomPage,
  splitIntoChunks,
  codePointLen,
  MAX_CHUNKS,
  type SearchResult,
} from '../core/search';
import { POOLS } from '../core/pools';
import { CLASSICS } from '../classics/books';
import { PAGE_LEN } from '../core/codec';
import { coordsOfAddress, formatAddress } from '../core/address';
import { bytesToB64u, b64uToBytes } from '../core/base64';
import { HERO_QUOTES, RESULT_APHORISMS, pickRandom } from '../core/aphorisms';
import { dailyPath } from '../core/daily';
import { loadShelf, removeFromShelf, type ShelfItem } from '../core/shelf';

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

/** 乱码填充的语言池（默认全选 = 全字符集均匀；选择持久化到本地） */
const pools = POOLS;
const POOLS_STORAGE_KEY = 'babel:pools';

function loadPools(): string[] {
  try {
    const raw = localStorage.getItem(POOLS_STORAGE_KEY);
    if (raw) {
      const arr = JSON.parse(raw);
      if (
        Array.isArray(arr) &&
        arr.length > 0 &&
        arr.every((id) => POOLS.some((p) => p.id === id))
      ) {
        return arr;
      }
    }
  } catch {}
  return POOLS.map((p) => p.id);
}

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

/** 限定文本：乱码只使用其中出现过的字符（优先于语言池） */
const CUSTOM_FILL_KEY = 'babel:custom-fill';
const customFill = ref<string>(
  (() => {
    try {
      return localStorage.getItem(CUSTOM_FILL_KEY) ?? '';
    } catch {
      return '';
    }
  })(),
);
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
 *  首次完整仪式；后续快速（约 0.6s）；reduced-motion 即时；点击可跳过 */
let revealCount = 0;
let skipReveal = false;
const resultEl = ref<HTMLElement>();
const reducedMotion =
  typeof window !== 'undefined' &&
  window.matchMedia('(prefers-reduced-motion: reduce)').matches;

async function reveal(r: SearchResult, id: number) {
  chunkResults.value = [];
  currentResult.value = null;
  const fast = revealCount > 0;
  revealCount++;
  if (reducedMotion) {
    currentResult.value = r;
    resultAphorism.value = pickRandom(RESULT_APHORISMS);
    nextTickScroll('auto'); // 关动画但仍把结果带入视野
    return;
  }
  revealing.value = true;
  skipReveal = false;
  revealSteps.value = [];
  const steps = fast
    ? ['正在确定坐标']
    : ['正在确定馆', '正在确定楼层', '正在确定室', '正在确定架', '正在确定册', '正在确定页'];
  for (const s of steps) {
    if (id !== runId || skipReveal) break;
    revealSteps.value.push(`${s}……`);
    await sleep(fast ? 350 : 240);
  }
  if (id !== runId) return;
  if (!skipReveal) {
    revealSteps.value.push('找到了。');
    await sleep(fast ? 250 : 360);
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
  if (r.shortPath) return r.shortPath;
  return `/v1/page/${r.key}?q=${encodeURIComponent(r.query)}`;
}

// ---------------------------------------------------------------------------
// 主题入口 / 合著接写 / 辩护书 / 今日之页 / 馆员标记 / 我的藏书
// ---------------------------------------------------------------------------

/** 每日轮换的主题人格测试 */
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
const themeIdx = ref(Math.floor(Date.now() / 86400000) % THEMES.length);
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

/** 无限接龙：#/?chain=<base64url(JSON 段落数组)>，每位馆员一段、归属保留 */
const chain = ref<string[]>([]);
const resultChain = ref<string[] | null>(null);
const copiedChain = ref(false);
const chainFallbackUrl = ref('');

function encodeChain(segs: string[]): string {
  return bytesToB64u(new TextEncoder().encode(JSON.stringify(segs)));
}

function decodeChain(b64: string): string[] | null {
  try {
    const arr = JSON.parse(new TextDecoder().decode(b64uToBytes(b64)));
    if (
      Array.isArray(arr) &&
      arr.length > 0 &&
      arr.every((s) => typeof s === 'string' && s.length > 0)
    ) {
      return arr;
    }
  } catch {}
  return null;
}

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

/** 分享接龙链接（优先系统面板，失败回退剪贴板，再失败亮出链接） */
async function shareChain(segs: string[], body: string) {
  const url = `${window.location.origin}${window.location.pathname}#/?chain=${encodeChain(segs)}`;
  const full = `${body}\n${url}`;
  const nav = navigator as Navigator & { share?: (d: ShareData) => Promise<void> };
  if (nav.share) {
    try {
      await nav.share({ title: '巴别图书馆 · 接龙', text: full });
      return;
    } catch (e) {
      if ((e as DOMException)?.name === 'AbortError') return;
    }
  }
  if (await copyTextShim(full)) {
    copiedChain.value = true;
    setTimeout(() => (copiedChain.value = false), 2500);
  } else {
    chainFallbackUrl.value = url;
  }
}

/** 发起接龙（第一棒） */
async function inviteCowrite() {
  const text = query.value.normalize('NFC').trim();
  if (!text) {
    error.value = '先写下一句话，再开龙。';
    return;
  }
  if (codePointLen(text) > 200) {
    error.value = '第一棒请控制在 200 字以内，邀请链接才不至于过长。';
    return;
  }
  error.value = '';
  await shareChain([text], `这句话我只写了开头，等你来续：${text}\n点开接着写 →`);
}

/** 接着传下去：把自己这段入链，生成下一棒链接 */
async function passChain() {
  const t = query.value.normalize('NFC').trim();
  if (!t) {
    error.value = '写下你的那一段，再传给下一位。';
    return;
  }
  if (codePointLen(t) > 200) {
    error.value = '每一棒请控制在 200 字以内。';
    return;
  }
  error.value = '';
  const segs = [...chain.value, t];
  chain.value = segs;
  query.value = '';
  await shareChain(
    segs,
    `巴别图书馆 · 接龙第 ${segs.length} 棒——前面已有 ${segs.length - 1} 段，等你续下一段 →`,
  );
}

function dropChain() {
  chain.value = [];
  resultChain.value = null;
}

const heroQuote = pickRandom(HERO_QUOTES);

const vname = ref('');
const vindication = ref<SearchResult | null>(null);

function findVindication() {
  if (selectedPools.value.length === 0 && !customFillActive.value) {
    error.value = '请至少选择一种书写体系，或输入一段限定字符集。';
    return;
  }
  error.value = '';
  const raw = vname.value.trim();
  // 短输入视为名字（馆方模板）；长输入视为你自己写下的辩词，直接定位
  const q = raw.length === 0 ? '无名者的一生，已经得到辩护。'
    : codePointLen(raw) <= 10 ? `${raw}的一生，已经得到辩护。`
    : raw;
  const f = fillArgs();
  const [r] = search(q, 1, f.poolIds, f.customText);
  vindication.value = r;
}

const dailyLink = dailyPath();

/** 反向定位（馆员索引）：已有一页文字 → 直接算坐标 */
const revRaw = ref('');
const revErr = ref('');
const revBad = ref<string[]>([]);
const revLink = ref('');
const revAddr = ref('');

function revLocate() {
  revErr.value = '';
  revBad.value = [];
  revLink.value = '';
  const prepared = revRaw.value.normalize('NFC').replace(/\r\n?/g, '\n');
  const v = validateQuery(prepared.replace(/\n/g, ''));
  if (!v.ok) {
    revErr.value = v.message;
    revBad.value = v.badChars;
    return;
  }
  if (codePointLen(v.query) > PAGE_LEN) {
    revErr.value = `反向定位只处理一整页以内的文字（${PAGE_LEN} 字），你的文字更长——请用上方输入框分段定位。`;
    return;
  }
  const { path, address } = textPagePath(v.query);
  revLink.value = path;
  revAddr.value = formatAddress(coordsOfAddress(address));
}

function revStrip() {
  const set = new Set(revBad.value);
  revRaw.value = [...revRaw.value].filter((ch) => !set.has(ch)).join('');
  revLocate();
}

/** 馆员已经标记的几页（首页只示三） */
const markedPages = CLASSICS.filter((b) =>
  ['daodejing', 'sunzi', 'tang-shi'].includes(b.id),
);

const shelfItems = ref<ShelfItem[]>(loadShelf());

function removeShelfItem(path: string) {
  shelfItems.value = removeFromShelf(shelfItems.value, path);
}

const showExamples = computed(
  () => !currentResult.value && !revealing.value && chunkResults.value.length === 0 && !chunkProgress.value,
);
</script>

<template>
  <section class="hero">
    <blockquote class="quote">
      <p>「{{ heroQuote.text }}」</p>
      <footer>—— {{ heroQuote.cite }}</footer>
    </blockquote>
    <p class="intro">你写下的任何一句话，都早已存在于某一页。</p>
    <p class="theme-line">
      今日开放：《{{ theme.name }}》 <span class="hint">{{ theme.hint }}</span>
    </p>
  </section>

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
      :placeholder="theme.hint"
      aria-label="写下你要定位的文字"
      @keydown.ctrl.enter.prevent="runSearch"
      @keydown.meta.enter.prevent="runSearch"
    ></textarea>
    <div class="search-actions">
      <button class="btn primary" @click="runSearch">
        {{ chain.length ? '完成接龙并定位' : '定位这句话' }}
      </button>
      <button v-if="chain.length" class="btn" @click="passChain">
        {{ copiedChain ? '链接已复制 ✓' : '接着传下去' }}
      </button>
      <button class="btn weak" @click="roam">随意翻开一页</button>
      <button v-if="query.trim() && !chain.length" class="btn weak" @click="inviteCowrite">
        {{ copiedChain ? '邀请链接已复制 ✓' : '开龙，邀朋友接写' }}
      </button>
      <span class="hint submit-hint">Ctrl + Enter 定位</span>
    </div>
    <p v-if="chainFallbackUrl" class="invite-fallback">
      剪贴板不可用，请手动复制接龙链接：
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
    <div v-if="showExamples" class="examples">
      <span class="hint">换个主题：</span>
      <button
        v-for="(t, i) in THEMES"
        :key="t.name"
        class="example-chip"
        :class="{ active: themeIdx === i }"
        @click="pickTheme(i)"
      >
        {{ t.name }}
      </button>
    </div>
  </section>

  <div v-if="revealing" class="reveal" title="点击跳过" @click="skipReveal = true">
    <p v-for="(s, i) in revealSteps" :key="i" class="reveal-step">{{ s }}</p>
  </div>

  <article v-if="currentResult" ref="resultEl" class="card result single-result" aria-live="polite">
    <p class="aphorism">{{ resultAphorism }}</p>
    <p v-if="resultChain" class="cowrite-mark">
      <template v-for="(s, i) in resultChain.slice(0, 8)" :key="i">
        <span class="cowrite-who">第 {{ i + 1 }} 位馆员：</span>{{ s }}<br />
      </template>
      <span v-if="resultChain.length > 8" class="hint">……共 {{ resultChain.length }} 段</span>
    </p>
    <p class="snippet">
      <template v-for="(seg, i) in [segments(currentResult)]" :key="i"
        >{{ seg[0] }}<mark>{{ seg[1] }}</mark
        >{{ seg[2] }}</template
      >
    </p>
    <div class="result-foot">
      <span class="addr">{{ currentResult.addressText }}</span>
      <div class="result-actions">
        <RouterLink class="btn primary" :to="resultLink(currentResult)">翻开这一页</RouterLink>
        <button class="btn small" @click="runSearch">在图书馆的另一处寻找同一句话</button>
      </div>
    </div>
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

  <section class="index-librorum">
    <h2 class="index-title">馆员索引</h2>

    <div class="index-item">
      <p class="index-name">辩护书</p>
      <p class="hint">凡可被写下的辩护，必然写在某一页上——包括为你的那一份。</p>
      <div class="vindication">
        <input
          v-model="vname"
          class="vname-input"
          type="text"
          placeholder="写下你的名字，或一句希望图书馆替你保存的辩词"
          @keydown.enter.prevent="findVindication"
        />
        <button class="btn small" @click="findVindication">寻找辩护书</button>
      </div>
      <article v-if="vindication" class="card vindication-card">
        <p class="vindication-line">它并非刚刚写成——自无始以来，就在那一页上。</p>
        <p class="snippet">
          <template v-for="(seg, i) in [segments(vindication)]" :key="i"
            >{{ seg[0] }}<mark>{{ seg[1] }}</mark
            >{{ seg[2] }}</template
          >
        </p>
        <div class="result-foot">
          <span class="addr">{{ vindication.addressText }}</span>
          <RouterLink class="btn small" :to="resultLink(vindication)">翻开这一页</RouterLink>
        </div>
      </article>
    </div>

    <div class="index-item">
      <p class="index-name">今日之页</p>
      <p class="hint">今日全馆共同开放此页，零点更替。</p>
      <RouterLink class="btn small" :to="dailyLink">翻开今日之页</RouterLink>
    </div>

    <div class="index-item">
      <p class="index-name">反向定位</p>
      <p class="hint">
        手中已有一页文字？直接算出它的坐标，不必检索。不足一页以空格补足，换行不计入。
      </p>
      <textarea
        v-model="revRaw"
        rows="2"
        class="rev-input"
        :placeholder="`粘贴一整页文字（不超过 ${PAGE_LEN} 字）……`"
        aria-label="粘贴一整页文字"
      ></textarea>
      <div class="search-actions">
        <button class="btn small" @click="revLocate">算出坐标</button>
      </div>
      <p v-if="revErr" class="error">
        {{ revErr }}
        <button v-if="revBad.length" class="btn small" @click="revStrip">剔除这些符号并重试</button>
      </p>
      <p v-if="revLink" class="rev-result">
        它的坐标：<RouterLink :to="revLink">{{ revAddr }}</RouterLink>
      </p>
    </div>

    <div class="index-item">
      <p class="index-name">馆员已经标记的几页</p>
      <p class="hint">在不可计数的书页中，馆员留下了少量可辨认的坐标。</p>
      <div class="classic-list">
        <RouterLink
          v-for="b in markedPages"
          :key="b.id"
          class="card classic-card"
          :to="`/classic/${b.id}`"
        >
          <span class="classic-name">《{{ b.title }}》</span>
          <span class="classic-meta">{{ b.author }} · {{ b.chapters.length }} 页</span>
        </RouterLink>
      </div>
    </div>
  </section>

  <section v-if="shelfItems.length" class="shelf">
    <h2 class="index-title">我的藏书</h2>
    <div class="shelf-list">
      <div v-for="item in shelfItems" :key="item.path" class="card shelf-item">
        <RouterLink :to="item.path" class="shelf-label">{{ item.label }}</RouterLink>
        <span class="addr">{{ item.addressText }}</span>
        <button class="shelf-remove" @click="removeShelfItem(item.path)">移出</button>
      </div>
    </div>
  </section>
</template>
