import QRCode from 'qrcode';

// ---------------------------------------------------------------------------
// 收录证 / 藏书票：canvas 绘制分享图卡（三种装帧）
//   certificate 宇宙收录证：句子为绝对主角，附二维码与行动文案
//   epitaph    未来墓志铭：深色戏剧化装帧
//   ticket     原始藏书票：文学书页标本（高亮句藏于乱码）
// ---------------------------------------------------------------------------

export interface TicketSeg {
  t: string;
  marked: boolean;
}

export type TicketTheme = 'certificate' | 'epitaph' | 'ticket';

export interface TicketData {
  /** 用户的句子（可为空，空时以页首文字代替） */
  query: string;
  /** 书页片段（行 × 段），用作乱码纹理 */
  lines: TicketSeg[][];
  addressText: string;
  /** 完整短链接（二维码指向；接龙作品时被 continueUrl 取代） */
  url: string;
  host: string;
  theme: TicketTheme;
  /** 接龙作品：人数、续棒链接与署名（如有） */
  chain?: {
    count: number;
    continueUrl: string;
    names?: string[];
  };
  /** 分享文案（复制图文时使用） */
  shareBody?: string;
  /** 动态预览链接（经预览服务；可选） */
  previewUrl?: string;
}

const SERIF = 'Georgia,"Songti SC","STSong","Noto Serif SC","SimSun",serif';

interface Palette {
  bg: string;
  frame: string;
  ink: string;
  soft: string;
  accent: string;
  sealBg: string;
  sealInk: string;
  qrDark: string;
  qrLight: string;
}

const LIGHT: Palette = {
  bg: '#f4efe3',
  frame: '#8a7f66',
  ink: '#2b2a25',
  soft: '#6b675c',
  accent: '#9e2b1b',
  sealBg: 'rgba(158,43,27,0.92)',
  sealInk: '#f4efe3',
  qrDark: '#2b2a25',
  qrLight: '#f4efe3',
};

const DARK: Palette = {
  bg: '#171410',
  frame: '#4a4234',
  ink: '#e8e2d4',
  soft: '#a29881',
  accent: '#cf5f45',
  sealBg: 'rgba(207,95,69,0.92)',
  sealInk: '#171410',
  qrDark: '#e8e2d4',
  qrLight: '#171410',
};

function drawFrame(ctx: CanvasRenderingContext2D, W: number, H: number, p: Palette) {
  ctx.fillStyle = p.bg;
  ctx.fillRect(0, 0, W, H);
  ctx.strokeStyle = p.frame;
  ctx.lineWidth = 3;
  ctx.strokeRect(36, 36, W - 72, H - 72);
  ctx.lineWidth = 1;
  ctx.strokeRect(52, 52, W - 104, H - 104);
}

function drawSeal(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  p: Palette,
  chars = ['巴', '別', '藏', '書'],
) {
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate((-8 * Math.PI) / 180);
  ctx.fillStyle = p.sealBg;
  ctx.fillRect(0, 0, 150, 150);
  ctx.fillStyle = p.sealInk;
  ctx.font = `56px ${SERIF}`;
  ctx.textAlign = 'center';
  ctx.fillText(chars[0], 44, 66);
  ctx.fillText(chars[1], 106, 66);
  ctx.fillText(chars[2], 44, 132);
  ctx.fillText(chars[3], 106, 132);
  ctx.restore();
}

function drawQr(
  ctx: CanvasRenderingContext2D,
  url: string,
  x: number,
  y: number,
  size: number,
  p: Palette,
) {
  const qr = QRCode.create(url, { errorCorrectionLevel: 'M' });
  const n = qr.modules.size;
  const cell = size / n;
  ctx.fillStyle = p.qrLight;
  ctx.fillRect(x - 8, y - 8, size + 16, size + 16);
  ctx.fillStyle = p.qrDark;
  for (let r = 0; r < n; r++) {
    for (let c = 0; c < n; c++) {
      if (qr.modules.get(r, c)) ctx.fillRect(x + c * cell, y + r * cell, cell + 0.5, cell + 0.5);
    }
  }
}

/** 按句长选择大字号并折行绘制，返回结束 y */
function drawBigText(
  ctx: CanvasRenderingContext2D,
  text: string,
  cx: number,
  y0: number,
  maxWidth: number,
  maxLines: number,
  p: Palette,
): number {
  const len = [...text].length;
  const fontSize = len <= 18 ? 76 : len <= 36 ? 60 : len <= 72 ? 44 : 32;
  const lineH = Math.round(fontSize * 1.55);
  ctx.font = `bold ${fontSize}px ${SERIF}`;
  ctx.fillStyle = p.ink;
  ctx.textAlign = 'center';

  const lines: string[] = [];
  let cur = '';
  for (const ch of text) {
    if (ctx.measureText(cur + ch).width > maxWidth && cur) {
      lines.push(cur);
      cur = ch;
    } else cur += ch;
  }
  if (cur) lines.push(cur);

  let truncated = false;
  const shown = lines.slice(0, maxLines);
  if (lines.length > maxLines) truncated = true;

  let y = y0;
  for (const line of shown) {
    ctx.fillText(line, cx, y);
    y += lineH;
  }
  if (truncated) ctx.fillText('……', cx, y - lineH);
  return y;
}

function drawNoiseLines(
  ctx: CanvasRenderingContext2D,
  lines: TicketSeg[][],
  x0: number,
  y0: number,
  maxWidth: number,
  p: Palette,
) {
  ctx.textAlign = 'left';
  ctx.font = `22px ${SERIF}`;
  let y = y0;
  for (const segs of lines) {
    let x = x0;
    for (const seg of segs) {
      ctx.fillStyle = seg.marked ? p.accent : p.soft;
      ctx.globalAlpha = seg.marked ? 0.95 : 0.5;
      for (const ch of seg.t) {
        const w = ctx.measureText(ch).width;
        if (x + w > x0 + maxWidth) break;
        ctx.fillText(ch, x, y);
        x += w;
      }
    }
    ctx.globalAlpha = 1;
    y += 40;
  }
}

function dateStr(): string {
  const t = new Date();
  return `${t.getFullYear()} 年 ${t.getMonth() + 1} 月 ${t.getDate()} 日`;
}

/** 中部省略号截断（按码位） */
function ellipsizeMiddle(s: string, maxChars: number): string {
  const a = [...s];
  if (a.length <= maxChars) return s;
  const keep = maxChars - 1;
  return `${a.slice(0, Math.ceil(keep / 2)).join('')}…${a.slice(-Math.floor(keep / 2)).join('')}`;
}

/** 居中绘制文本：先缩字号（至 minSize），仍超宽则中部截断 */
function fitCenteredText(
  ctx: CanvasRenderingContext2D,
  text: string,
  cx: number,
  y: number,
  maxWidth: number,
  startSize: number,
  p: Palette,
  minSize = 18,
) {
  let size = startSize;
  let t = text;
  ctx.textAlign = 'center';
  ctx.fillStyle = p.soft;
  for (;;) {
    ctx.font = `${size}px ${SERIF}`;
    if (ctx.measureText(t).width <= maxWidth) break;
    if (size > minSize) {
      size -= 2;
    } else {
      t = ellipsizeMiddle(t, [...t].length - 4);
    }
  }
  ctx.fillText(t, cx, y);
}

// ---------------------------------------------------------------------------

function renderCertificate(d: TicketData, dark = false): HTMLCanvasElement {
  const W = 1080;
  const H = 1350;
  const canvas = document.createElement('canvas');
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext('2d')!;
  const p = dark ? DARK : LIGHT;
  drawFrame(ctx, W, H, p);

  // 印章居右上内框，远离正文
  drawSeal(ctx, W - 226, 84, p);

  ctx.textAlign = 'center';
  ctx.fillStyle = p.soft;
  ctx.font = `30px ${SERIF}`;
  ctx.fillText(
    d.chain
      ? `宇宙接龙檔案 · 由 ${d.chain.count} 位館員共同找到`
      : dark
        ? '巴別圖書館 · 未來墓誌銘'
        : '巴別圖書館 · 宇宙收錄證',
    W / 2,
    140,
  );
  if (d.chain?.names?.length) {
    ctx.font = `24px ${SERIF}`;
    ctx.fillText(ellipsizeMiddle(`署名：${d.chain.names.join('、')}`, 30), W / 2, 186);
  }

  const big = d.query || [...(d.lines[0]?.map((s) => s.t).join('') ?? '')].slice(0, 30).join('');
  const endY = drawBigText(ctx, big, W / 2, 330, W - 220, 8, p);

  ctx.fillStyle = p.accent;
  ctx.font = `italic 28px ${SERIF}`;
  ctx.fillText(
    dark ? '它终将被人读到——正如它早已被写下。' : '此句并非刚刚生成——它一直存在于这里。',
    W / 2,
    endY + 50,
  );

  drawNoiseLines(ctx, d.lines.slice(0, 3), 130, endY + 130, W - 260, p);

  // 坐标与日期：超宽自动缩字号/截断
  fitCenteredText(ctx, d.addressText, W / 2, 1032, W - 240, 26, p);
  ctx.textAlign = 'center';
  ctx.fillStyle = p.soft;
  ctx.font = `24px ${SERIF}`;
  ctx.fillText(dateStr(), W / 2, 1074);

  // 底部带：左二维码、右行动文案，均在内框（y ≤ 1298）之内
  ctx.textAlign = 'left';
  ctx.fillStyle = p.soft;
  ctx.font = `22px ${SERIF}`;
  ctx.fillText(d.chain ? '扫码续写下一棒' : '扫码打开这一页', 110, 1106);
  drawQr(ctx, d.chain?.continueUrl ?? d.url, 110, 1130, 150, p);

  ctx.textAlign = 'right';
  ctx.fillStyle = p.accent;
  ctx.font = `bold 28px ${SERIF}`;
  ctx.fillText('写下你的那一句 →', W - 110, 1206);
  ctx.fillStyle = p.soft;
  ctx.font = `22px ${SERIF}`;
  ctx.fillText(d.host, W - 110, 1246);

  return canvas;
}

function renderClassicTicket(d: TicketData): HTMLCanvasElement {
  const W = 1080;
  const H = 1350;
  const canvas = document.createElement('canvas');
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext('2d')!;
  const p = LIGHT;
  drawFrame(ctx, W, H, p);

  ctx.textAlign = 'center';
  ctx.fillStyle = p.ink;
  ctx.font = `64px ${SERIF}`;
  ctx.fillText('巴 別 圖 書 館', W / 2, 168);
  ctx.fillStyle = p.accent;
  ctx.font = `32px ${SERIF}`;
  ctx.fillText('藏 書 票', W / 2, 224);

  // 印章居右上内框，避开标题与坐标行
  drawSeal(ctx, W - 226, 84, p);

  ctx.strokeStyle = '#c9bfa4';
  ctx.beginPath();
  ctx.moveTo(160, 262);
  ctx.lineTo(W - 160, 262);
  ctx.stroke();

  // 正文折行（高亮加粗下划）
  const flat: { ch: string; marked: boolean }[] = [];
  for (const line of d.lines) for (const seg of line) for (const ch of seg.t) flat.push({ ch, marked: seg.marked });

  const X0 = 120;
  const X1 = W - 120;
  const LINE_H = 58;
  const MAX_LINES = 12;
  let y = 356;
  let x = X0;
  let lines = 1;
  let truncated = false;
  ctx.textAlign = 'left';

  for (const { ch, marked } of flat) {
    ctx.font = `${marked ? 'bold ' : ''}30px ${SERIF}`;
    const w = ctx.measureText(ch).width;
    if (x + w > X1) {
      x = X0;
      y += LINE_H;
      if (++lines > MAX_LINES) {
        truncated = true;
        break;
      }
    }
    ctx.fillStyle = marked ? p.accent : 'rgba(43,42,37,0.58)';
    ctx.fillText(ch, x, y);
    if (marked) ctx.fillRect(x, y + 10, w, 3);
    x += w;
  }
  if (truncated) {
    ctx.fillStyle = 'rgba(43,42,37,0.58)';
    ctx.fillText('……', x, y);
  }

  ctx.textAlign = 'center';
  fitCenteredText(ctx, d.addressText, W / 2, 1160, W - 240, 26, p);

  ctx.font = `22px ${SERIF}`;
  ctx.fillText(`${d.host} · ${dateStr()}`, W / 2, H - 78);
  return canvas;
}

export function renderTicket(d: TicketData): HTMLCanvasElement {
  if (d.theme === 'epitaph') return renderCertificate(d, true);
  if (d.theme === 'certificate') return renderCertificate(d, false);
  return renderClassicTicket(d);
}
