<script setup lang="ts">
import { ref, watchEffect } from 'vue';
import { CLASSICS } from '../classics/books';
import { PAGE_LEN } from '../core/codec';
import { coordsOfAddress, formatAddress } from '../core/address';
import { search, textPagePath, validateQuery, codePointLen, type SearchResult } from '../core/search';
import { fillArgsFromStorage } from '../core/fill';
import { dailyPath } from '../core/daily';

watchEffect(() => {
  document.title = '馆员索引 · 巴别图书馆';
});

const dailyLink = dailyPath();

// ---------------------------------------------------------------------------
// 辩护书
// ---------------------------------------------------------------------------

const vname = ref('');
const vindication = ref<SearchResult | null>(null);
const verr = ref('');

function findVindication() {
  verr.value = '';
  const raw = vname.value.trim();
  const q =
    raw.length === 0
      ? '无名者的一生，已经得到辩护。'
      : codePointLen(raw) <= 10
        ? `${raw}的一生，已经得到辩护。`
        : raw;
  const f = fillArgsFromStorage();
  const [r] = search(q, 1, f.poolIds, f.customText);
  vindication.value = r;
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

function resultLink(r: SearchResult): string {
  return r.shortPath ?? `/v1/page/${r.key}?q=${encodeURIComponent(r.query)}`;
}

// ---------------------------------------------------------------------------
// 反向定位
// ---------------------------------------------------------------------------

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
    revErr.value = `反向定位只处理一整页以内的文字（${PAGE_LEN} 字），你的文字更长——请用首页的分段定位。`;
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

/** 馆员已经标记的几页 */
const markedPages = CLASSICS.filter((b) =>
  ['daodejing', 'sunzi', 'tang-shi'].includes(b.id),
);
</script>

<template>
  <article class="about index-page">
    <h1>馆员索引</h1>
    <p class="hint">馆方提供的几件小工具，以及少量已被辨认的坐标。</p>

    <div class="index-item">
      <p class="index-name">今日之页</p>
      <p class="hint">今日全馆共同开放此页，零点更替。</p>
      <RouterLink class="btn small" :to="dailyLink">翻开今日之页</RouterLink>
    </div>

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
      <p v-if="verr" class="error">{{ verr }}</p>
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

    <div class="center-nav">
      <RouterLink class="btn" to="/">回到检索</RouterLink>
    </div>
  </article>
</template>
