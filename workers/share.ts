// Cloudflare Worker：动态分享预览（备用件，部署后才生效）
//
// 目的：微信/X/Facebook 的抓取器不读取 hash 路由，所有分享链接的预览都一样。
// 本 Worker 提供 /share/v1/s/<配方> 与 /share/v1/t/<文字> 两个入口：
//   - 爬虫：得到带个性化 og:title / og:description 的 HTML（图片暂用静态 og.png）
//   - 人类：立即 302 到真实的 hash 页面
// 不存储任何数据——配方里的检索词直接从 URL 解码，与全站「无数据库」承诺一致。
//
// 部署：
//   npm i -g wrangler && wrangler login
//   wrangler deploy workers/share.ts --name babel-share --compatibility-date 2026-01-01
//   然后把分享按钮/复制文案里的链接域名换成 https://<worker 域名>/share/v1/...

const SITE = 'https://your-domain.example'; // 部署后改为站点域名

function b64uToBytes(s: string): Uint8Array {
  const REV = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';
  const out: number[] = [];
  let acc = 0;
  let bits = 0;
  for (const ch of s) {
    const v = REV.indexOf(ch);
    if (v < 0) throw new Error('bad b64');
    acc = (acc << 6) | v;
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      out.push((acc >> bits) & 0xff);
    }
  }
  return new Uint8Array(out);
}

/** 从配方取出检索词（布局见 src/core/search.ts：13 字节头 + 限定文本 + 检索词） */
function queryFromRecipe(payload: string): string {
  const buf = b64uToBytes(payload);
  if (buf.length < 13) throw new Error('bad recipe');
  const ctLen = (buf[11] << 8) | buf[12];
  return new TextDecoder().decode(buf.slice(13 + ctLen));
}

function htmlFor(query: string, target: string): string {
  const q = query || '一页无名的文字';
  const title = `「${q.slice(0, 40)}」——早已写在巴别图书馆的某一页`;
  const desc = '它不是刚刚生成的，从一开始它就在那里。凭坐标，任何人都能重新找到它。';
  return `<!DOCTYPE html>
<html lang="zh-CN"><head>
<meta charset="utf-8" />
<meta property="og:title" content="${escapeHtml(title)}" />
<meta property="og:description" content="${escapeHtml(desc)}" />
<meta property="og:image" content="${SITE}/og.png" />
<meta property="og:type" content="article" />
<meta http-equiv="refresh" content="0;url=${escapeHtml(target)}" />
<title>${escapeHtml(title)}</title>
</head><body>
<p>正在带你去那一页…… <a href="${escapeHtml(target)}">如果久未响应，请点击这里</a></p>
</body></html>`;
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

export default {
  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    const m = url.pathname.match(/^\/share\/v1\/(s|t)\/(.+)$/);
    if (!m) return new Response('not found', { status: 404 });
    try {
      const query =
        m[1] === 's' ? queryFromRecipe(m[2]) : new TextDecoder().decode(b64uToBytes(m[2]));
      const target = `${SITE}/#/v1/${m[1]}/${m[2]}`;
      const ua = request.headers.get('user-agent') ?? '';
      const isCrawler = /bot|crawler|spider|facebookexternal|twitterbot|wechat|whatsapp|telegram|slack|discord/i.test(ua);
      if (!isCrawler) return Response.redirect(target, 302);
      return new Response(htmlFor(query, target), {
        headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'public, max-age=3600' },
      });
    } catch {
      return new Response('bad link', { status: 400 });
    }
  },
};
