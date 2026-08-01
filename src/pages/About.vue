<script setup lang="ts">
import { UNICODE_VERSION, ALPHABET_SIZE } from '../core/alphabet';
import { PAGE_LEN } from '../core/codec';
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
      这个数字是有限的，却远远超出可观测宇宙的原子总数：
      你说过的每一句话、你未曾说出口的每一句话、每一部尚未写成的小说连同它全部的错字版本，
      都早已在馆中各就其位。
    </p>

    <h2>检索不是寻找，是定位</h2>
    <p>
      本馆没有数据库，也不存储任何文本。每一页的内容由其地址唯一决定：
      把一页的 {{ PAGE_LEN }} 个字符看作一个 {{ ALPHABET_SIZE.toLocaleString() }}
      进制的大整数，再经过一次固定的可逆换算，便是这页的坐标。
      你输入一句话时，我们并非去「寻找」它，而是算出它必然所在的坐标，然后带你去那一页。
      它一直在那里——在你到访之前如此，在你离开之后亦如此。
      因此每个结果都真实、永久有效：凭地址再回到同一页，看到的字一个也不会变。
    </p>

    <h2>为什么大部分页面像天书</h2>
    <p>
      在几乎所有可能的书页里，字符都是纯粹偶然的堆积。你检索到的那一页之所以有意义，
      是因为它是全馆仅有的、为你的那句话而存在的几页之一。其余页面上写着的，
      是一切语言的葬礼与一切语言的黎明——有些符号你的设备甚至没有字体可以显示，
      它们以「豆腐块」的形态静卧，如同失传文明的碑铭。
    </p>
    <p>
      原作里，馆员们因此耗尽一生在六边形之间游荡，寻找两样东西：
      有意义的文字，和为自己一生辩护的那一卷书。
      首页的「辩护书」与翻页时的「朝圣」计数，正是向这场无尽的寻访致意——
      你翻过的每一页无意义的文字，他们都曾翻过。
    </p>

    <h2>技术附记</h2>
    <p>
      本站为纯前端静态页面：全部推演（大整数进制换算与可逆置换）在你的浏览器内完成，
      不经过服务器，不收集任何数据。字符集固定为 Unicode {{ UNICODE_VERSION }}
      的快照，永不随版本升级而变动；字符集、页面规格与链接算法冻结为 v1 契约，
      旧地址永久可解码。检索与漫游的短链接是「配方」而非坐标——
      凭一枚种子即可精确重建同一页。本站可安装为应用，并支持离线访问。
    </p>

    <div class="center-nav">
      <RouterLink class="btn" to="/">回到检索</RouterLink>
    </div>
  </article>
</template>
