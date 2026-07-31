<script setup lang="ts">
import { ref } from 'vue';
import { UNICODE_VERSION, ALPHABET_SIZE } from '../core/alphabet';
import { PAGE_LEN } from '../core/codec';
import { addrToKey, coordsOfAddress, formatAddress } from '../core/address';
import { validateQuery, codePointLen, fullPageAddress } from '../core/search';

// ---------------------------------------------------------------------------
// 反向定位：已有一页文字 → 直接算出坐标（不足一页以空格补足，换行忽略）
// ---------------------------------------------------------------------------

const raw = ref('');
const err = ref('');
const badChars = ref<string[]>([]);
const link = ref('');
const addrText = ref('');

function locate() {
  err.value = '';
  badChars.value = [];
  link.value = '';
  // 换行不收录于字符集，仅作边界，定位时忽略（与首页检索口径一致）
  const prepared = raw.value.normalize('NFC').replace(/\r\n?/g, '\n');
  const v = validateQuery(prepared.replace(/\n/g, ''));
  if (!v.ok) {
    err.value = v.message;
    badChars.value = v.badChars;
    return;
  }
  if (codePointLen(v.query) > PAGE_LEN) {
    err.value = `反向定位只处理一整页以内的文字（${PAGE_LEN} 字），你的文字更长——请用首页的分段检索。`;
    return;
  }
  const address = fullPageAddress(v.query);
  link.value = `/page/${addrToKey(address)}`;
  addrText.value = formatAddress(coordsOfAddress(address));
}

/** 剔除报错中列出的字符后重试 */
function stripBadChars() {
  const set = new Set(badChars.value);
  raw.value = [...raw.value].filter((ch) => !set.has(ch)).join('');
  locate();
}
</script>

<template>
  <article class="about">
    <h1>关于这座图书馆</h1>

    <blockquote class="quote">
      <p>
        「La biblioteca es una esfera cuyo centro cabal es cualquier hexágono, cuya
        circunferencia es inaccesible.」
      </p>
      <p>「图书馆是一个球体，它精确的中心是任何一个六边形，它的圆周是远不可及的。」</p>
      <footer>—— 豪尔赫·路易斯·博尔赫斯《巴别图书馆》（1941）</footer>
    </blockquote>

    <h2>这里有什么</h2>
    <p>
      本馆收藏一切可能写出的书页：每页 {{ PAGE_LEN }} 个字符，字符取自 Unicode
      {{ UNICODE_VERSION }} 的全部 {{ ALPHABET_SIZE.toLocaleString() }}
      个可打印符号——汉字、字母、假名、圣书体、楔形文字、数学符号、emoji，无一遗漏。
      所有可能的页面共有 {{ ALPHABET_SIZE.toLocaleString() }}<sup>{{ PAGE_LEN }}</sup> 种。
      这个数字是有限的，却远远超过可观测宇宙的原子总数：你说过的每一句话、你未曾说出的每一句话、
      每一部尚未写成的小说连同它全部的错字版本，都在馆中各就其位。
    </p>

    <h2>检索不是寻找，是定位</h2>
    <p>
      本馆没有数据库，也不存储任何文本。每一页的内容由其地址唯一决定：
      把一页的 {{ PAGE_LEN }} 个字符看作一个 {{ ALPHABET_SIZE.toLocaleString() }}
      进制的大整数，再经过固定的可逆换算，便得到这页的坐标。你输入一句话时，
      我们并非去「寻找」它，而是算出它必然所在的坐标——它一直在那里，
      在你到访之前如此，在你离开之后亦如此。因此每个结果都真实、永久有效：
      凭地址再回到同一页，看到的字一个也不会变。
    </p>

    <h2>辩护书与朝圣</h2>
    <p>
      在原作里，无数馆员耗尽一生在六边形之间游荡，寻找两样东西：有意义的文字，
      和为自己一生辩护的那一卷。首页的「寻找我的辩护书」正是为此而设——
      凡可被写下的辩护，必然写在某一页上，包括为你的那一份。这不是修辞，是计数的事实。
    </p>
    <p>
      而当你无目的地翻阅，页头会记下你的途经：「此行你已途经 N 页无意义的文字。」
      绝大多数馆员终其一生，所见也不过这个数字。原作管这样的游荡，叫朝圣。
    </p>

    <h2>反向定位</h2>
    <p>
      若你手中已有一页文字，也可以直接算出它的坐标，而不必检索。不足一页的部分将以空格补足，
      换行不计入。
    </p>
    <textarea
      v-model="raw"
      rows="4"
      class="rev-input"
      :placeholder="`粘贴一整页文字（不超过 ${PAGE_LEN} 字）……`"
    ></textarea>
    <div class="search-actions">
      <button class="btn small" @click="locate">算出坐标</button>
    </div>
    <p v-if="err" class="error">
      {{ err }}
      <button v-if="badChars.length" class="btn small" @click="stripBadChars">
        剔除这些符号并重试
      </button>
    </p>
    <p v-if="link" class="rev-result">
      它的坐标：<RouterLink :to="link">{{ addrText }}</RouterLink>
    </p>

    <h2>为什么大部分页面像天书</h2>
    <p>
      在几乎所有可能的书页里，字符都是纯粹偶然的堆积。你检索到的那一页之所以 meaningful，
      是因为它是全馆仅有的、为你的那句话而存在的几页之一。其余页面上写着的，
      是一切语言的葬礼与一切语言的黎明——有些符号你的设备甚至没有字体可以显示，
      它们将以「豆腐块」的形态静卧，如同失传文明的碑铭。
    </p>

    <h2>技术附记</h2>
    <p>
      本站为纯前端静态页面：全部推演（大整数进制转换与可逆换算）在你的浏览器内完成，
      不经过服务器，不收集任何数据。字符集固定为 Unicode {{ UNICODE_VERSION }}
      的快照，永不随版本升级而变动，故地址永久有效。
    </p>
    <p>
      检索结果与随机漫游的短链接是「配方」而非坐标——凭一枚种子即可精确重建同一页，
      配方算法与字符集一样，自此不再变更。本站可安装为应用，并支持离线访问。
    </p>

    <div class="center-nav">
      <RouterLink class="btn" to="/">回到检索</RouterLink>
    </div>
  </article>
</template>
