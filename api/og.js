// Vercel Serverless Function：动态分享预览（显式路由版，由 vercel.json rewrites 驱动）
// /api/og?type=s|t&payload=... —— 爬虫得 OG HTML，人类 302 回 hash 页，?preview=1 强制卡片
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
    const { type, payload } = req.query;
    if ((type !== 's' && type !== 't') || typeof payload !== 'string' || !payload) {
      res.status(404).send('not found');
      return;
    }
    const query =
      type === 's' ? queryFromRecipe(payload) : new TextDecoder().decode(b64uToBytes(payload));

    const proto = req.headers['x-forwarded-proto'] ?? 'https';
    const site = `${proto}://${req.headers.host}`;
    const target = `${site}/#/v1/${type}/${payload}`;

    const forceCard = req.query.preview === '1';
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
