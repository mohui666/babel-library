// Vercel Serverless Function：动态分享预览（零配置，随站点部署自动生效）
//
// 路由：/api/share/v1/s/<配方> 或 /api/share/v1/t/<文字>（catch-all）
//   - 爬虫：得到带个性化 og:title / og:description 的 HTML（图片用站点静态 og.png）
//   - 人类：302 到真实的 hash 页面
//   - ?preview=1：强制查看卡片 HTML（调试用）
//
// 隐私：本函数只是「丰富预览」的可选增强——默认分享永远是不过服务器的 hash 链接。
// 链接文字会经过本函数但不主动存储（无数据库、无日志写入）。
// 域名取自请求头，无需任何环境变量。

function b64uToBytes(s) {
  const REV = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';
  const out = [];
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

function queryFromRecipe(payload) {
  const buf = b64uToBytes(payload);
  if (buf.length < 13) throw new Error('bad recipe');
  const ctLen = (buf[11] << 8) | buf[12];
  return new TextDecoder().decode(buf.slice(13 + ctLen));
}

function escapeHtml(s) {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

export default function handler(req, res) {
  try {
    const seg = [].concat(req.query.path ?? []);
    if (seg[0] !== 'v1' || (seg[1] !== 's' && seg[1] !== 't') || !seg[2]) {
      res.status(404).send('not found');
      return;
    }
    const query =
      seg[1] === 's'
        ? queryFromRecipe(seg[2])
        : new TextDecoder().decode(b64uToBytes(seg[2]));

    const proto = req.headers['x-forwarded-proto'] ?? 'https';
    const host = req.headers.host;
    const site = `${proto}://${host}`;
    const target = `${site}/#/v1/${seg[1]}/${seg[2]}`;

    const url = new URL(req.url, site);
    const forceCard = url.searchParams.get('preview') === '1';
    const ua = req.headers['user-agent'] ?? '';
    const isCrawler =
      /bot|crawler|spider|facebookexternal|twitterbot|wechat|whatsapp|telegram|slack|discord/i.test(
        ua,
      );
    if (!isCrawler && !forceCard) {
      res.redirect(302, target);
      return;
    }

    const q = query || '一页无名的文字';
    const title = `「${q.slice(0, 40)}」——早已写在巴别图书馆的某一页`;
    const desc = '它不是刚刚生成的，从一开始它就在那里。凭坐标，任何人都能重新找到它。';
    res.setHeader('content-type', 'text/html; charset=utf-8');
    res.setHeader('cache-control', 'public, max-age=3600');
    res.send(`<!DOCTYPE html>
<html lang="zh-CN"><head>
<meta charset="utf-8" />
<meta property="og:title" content="${escapeHtml(title)}" />
<meta property="og:description" content="${escapeHtml(desc)}" />
<meta property="og:image" content="${site}/og.png" />
<meta property="og:type" content="article" />
<meta http-equiv="refresh" content="0;url=${escapeHtml(target)}" />
<title>${escapeHtml(title)}</title>
</head><body>
<p>正在带你去那一页…… <a href="${escapeHtml(target)}">如果久未响应，请点击这里</a></p>
</body></html>`);
  } catch {
    res.status(400).send('bad link');
  }
}
