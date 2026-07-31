<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { useRouter } from 'vue-router';
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
import { CLASSICS } from '../classics/books';
import { PAGE_LEN } from '../core/codec';
import {
  HERO_QUOTES,
  RESULT_APHORISMS,
  pickRandom,
} from '../core/aphorisms';

const router = useRouter();
const query = ref('');
const error = ref('');
const badChars = ref<string[]>([]);
const results = ref<SearchResult[]>([]);
const searched = ref(false);
const lastQuery = ref('');

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

/** 首屏例句 */
const examples = [
  '一句你从未说出口的话',
  '你明天将会说的第一句话',
  '宇宙终极问题的答案',
];

/** 馆藏名著 */
const classics = CLASSICS;

/** 首页轮换引言与检索结果点破句 */
const heroQuote = pickRandom(HERO_QUOTES);
const resultAphorism = ref('');

/** 辩护书：馆中必有为你一生辩护的一页 */
const vname = ref('');
const vindication = ref<SearchResult | null>(null);

function findVindication() {
  if (selectedPools.value.length === 0 && !customFillActive.value) {
    error.value = '请至少选择一种填充文字，或输入一段限定文本。';
    return;
  }
  error.value = '';
  const name = vname.value.trim() || '无名者';
  const q = `${name}的一生，已经得到辩护。`;
  const f = fillArgs();
  const [r] = search(q, 1, f.poolIds, f.customText);
  vindication.value = r;
}

function tryExample(s: string) {
  query.value = s;
  runSearch();
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

/** 递增的运行号：开始新检索作废旧的分段循环 */
let runId = 0;

/** 全选时 poolIds 传 undefined，走全字符集均匀采样；限定文本优先于语言池 */
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

function clearOutputs() {
  results.value = [];
  chunkResults.value = [];
  chunkProgress.value = '';
  searched.value = false;
}

function runSearch() {
  const id = ++runId;
  if (selectedPools.value.length === 0 && !customFillActive.value) {
    error.value = '请至少选择一种填充文字，或输入一段限定文本。';
    badChars.value = [];
    clearOutputs();
    return;
  }
  const prepared = query.value.normalize('NFC').replace(/\r\n?/g, '\n').trim();
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
    // 单页检索：返回 10 处藏书
    chunkResults.value = [];
    lastQuery.value = chunks[0];
    const f = fillArgs();
    results.value = search(chunks[0], 10, f.poolIds, f.customText);
    resultAphorism.value = pickRandom(RESULT_APHORISMS);
    vindication.value = null;
    searched.value = true;
    return;
  }
  if (chunks.length > MAX_CHUNKS) {
    error.value = `本馆一次最多为 ${MAX_CHUNKS} 段文字定位，你的文本可分为 ${chunks.length} 段。请分卷提交。`;
    clearOutputs();
    return;
  }
  locateChunks(chunks, id);
}

/** 分段定位：每段各算出一页真实坐标，逐段报告进度 */
async function locateChunks(chunks: string[], id: number) {
  results.value = [];
  searched.value = false;
  chunkResults.value = [];
  chunkTotalChars.value = chunks.reduce((s, c) => s + codePointLen(c), 0);
  const { poolIds, customText } = fillArgs();
  for (let i = 0; i < chunks.length; i++) {
    if (id !== runId) return; // 已被更新的检索取代
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
    await new Promise((resolve) => setTimeout(resolve, 0)); // 让出主线程刷新进度
  }
  chunkProgress.value = '';
}

/** 回车检索（输入法组词中按回车是选字，不触发） */
function onEnter(e: KeyboardEvent) {
  if (e.isComposing) return;
  e.preventDefault();
  runSearch();
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
  input.value = ''; // 允许重复选择同一文件
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
    error.value = '请至少选择一种填充文字，或输入一段限定文本。';
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

/** 分段结果的打开链接：优先短链接；否则长链接按段长决定是否带高亮 */
function chunkLink(c: ChunkEntry): string {
  if (c.shortPath) return c.shortPath;
  const base = `/page/${c.key}`;
  return c.chars <= 2000 ? `${base}?q=${encodeURIComponent(c.query)}` : base;
}

const singleResult = computed(() => searched.value && results.value.length > 0);
const showExamples = computed(
  () => !singleResult.value && chunkResults.value.length === 0 && !chunkProgress.value,
);
</script>

<template>
  <section class="hero">
    <blockquote class="quote">
      <p>「{{ heroQuote.text }}」</p>
      <footer>—— {{ heroQuote.cite }}</footer>
    </blockquote>
    <p class="intro">
      这座图书馆收藏着所有可能写出的文字。你此刻想到的任何一句话——说过的话、未说出的话、
      明天才会写下的话——都早已端坐在某本书的某一页上。写下它，或呈上一整卷文稿，我带你去那一页。
    </p>
    <details class="canon">
      <summary>馆中都有些什么？</summary>
      <p>
        「未来的详尽历史、大天使们的自传、图书馆的真实目录、成千上万的假目录、
        对真目录之谬误的证明、巴西里德斯的诺斯替福音、对该福音的评注、对该福音评注的评注、
        你死亡的真实记录、每一本书在所有语言中的译本、每一本书在所有书中的插页——一切。」
      </p>
      <footer>—— 博尔赫斯《巴别图书馆》</footer>
    </details>
  </section>

  <section class="search-box">
    <textarea
      v-model="query"
      rows="3"
      :placeholder="`写下任意文字（超过 ${PAGE_LEN} 字将自动分段定位）……`"
      @keydown.enter="onEnter"
    ></textarea>
    <div class="search-actions">
      <button class="btn primary" @click="runSearch">检索全馆</button>
      <button class="btn" @click="fileInput?.click()">上传文本</button>
      <button class="btn" @click="roam">随意翻阅</button>
      <input
        ref="fileInput"
        type="file"
        accept=".txt,.md,.text,.log"
        class="hidden-file"
        @change="onFile"
      />
    </div>
    <div class="pool-picker" :class="{ dimmed: customFillActive }">
      <span class="pool-label">乱码填充：</span>
      <label v-for="p in pools" :key="p.id" class="pool-item">
        <input type="checkbox" v-model="selectedPools" :value="p.id" />
        {{ p.label }}
      </label>
    </div>
    <div class="custom-fill">
      <span class="pool-label">或限定为：</span>
      <input
        v-model="customFill"
        class="custom-fill-input"
        type="text"
        placeholder="输入一段文字，乱码只使用其中的字符（如《静夜思》）"
      />
    </div>
    <p class="hint pool-hint">
      只决定检索结果中乱码部分的语言，不限制你能检索的文字；填写限定文本时优先于上方勾选。
    </p>
    <p v-if="error" class="error">
      {{ error }}
      <button v-if="badChars.length" class="btn small" @click="stripBadChars">
        剔除这些符号并检索
      </button>
    </p>
    <div class="vindication">
      <input
        v-model="vname"
        class="vname-input"
        type="text"
        placeholder="写下你的名字……"
        @keydown.enter.prevent="findVindication"
      />
      <button class="btn" @click="findVindication">寻找我的辩护书</button>
    </div>
    <p class="hint pool-hint">
      馆中有一页为你的一生辩护。它必然存在——凡可被写下的辩护，自无始以来俱在馆中。
    </p>
    <div v-if="showExamples" class="examples">
      <span class="hint">不知从何找起？</span>
      <button v-for="e in examples" :key="e" class="example-chip" @click="tryExample(e)">
        {{ e }}
      </button>
    </div>
  </section>

  <article v-if="vindication" class="card vindication-card">
    <p class="vindication-line">
      你的辩护书找到了。它并非刚刚写成——自无始以来，它就在那一页上。
    </p>
    <p class="snippet">
      <template v-for="(seg, i) in [segments(vindication)]" :key="i"
        >{{ seg[0] }}<mark>{{ seg[1] }}</mark
        >{{ seg[2] }}</template
      >
    </p>
    <div class="result-foot">
      <span class="addr">{{ vindication.addressText }}</span>
      <RouterLink
        class="btn small"
        :to="vindication.shortPath ?? `/page/${vindication.key}?q=${encodeURIComponent(vindication.query)}`"
      >
        翻开你的辩护书
      </RouterLink>
    </div>
  </article>

  <section v-if="singleResult" class="results">
    <p class="results-head">
      「{{ lastQuery }}」——在馆中寻得 {{ results.length }} 处藏书，每一处都真实存在：
    </p>
    <p class="aphorism">{{ resultAphorism }}</p>
    <article v-for="r in results" :key="r.key" class="card result">
      <p class="snippet">
        <template v-for="(seg, i) in [segments(r)]" :key="i"
          >{{ seg[0] }}<mark>{{ seg[1] }}</mark
          >{{ seg[2] }}</template
        >
      </p>
      <div class="result-foot">
        <span class="addr">{{ r.addressText }}</span>
        <RouterLink
          class="btn small"
          :to="r.shortPath ?? `/page/${r.key}?q=${encodeURIComponent(r.query)}`"
        >
          翻开这一页
        </RouterLink>
      </div>
    </article>
    <div class="results-more">
      <button class="btn" @click="runSearch">换一批</button>
      <p class="hint">同一句话在馆中还有无数处藏书，每次更换都是另一批真实的坐标。</p>
    </div>
  </section>

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
        <RouterLink class="btn small" :to="chunkLink(c)">翻开这一页</RouterLink>
      </div>
    </article>
  </section>

  <section class="classics">
    <h2 class="classics-title">馆藏名著</h2>
    <p class="hint">这些书并非被人写下，而是早已在馆中，如今不过是被发现。</p>
    <div class="classic-list">
      <RouterLink
        v-for="b in classics"
        :key="b.id"
        class="card classic-card"
        :to="`/classic/${b.id}`"
      >
        <span class="classic-name">{{ b.id === 'sonnets' ? b.title : `《${b.title}》` }}</span>
        <span class="classic-meta">{{ b.author }} · {{ b.chapters.length }} 页</span>
      </RouterLink>
    </div>
  </section>
</template>
