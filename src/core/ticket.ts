// ---------------------------------------------------------------------------
// 藏书票：canvas 绘制分享图卡（无依赖，纯 2D canvas）
// ---------------------------------------------------------------------------

export interface TicketSeg {
  t: string;
  marked: boolean;
}

export interface TicketData {
  /** 书页片段（行 × 段），高亮段以朱砂呈现 */
  lines: TicketSeg[][];
  addressText: string;
  url: string;
}

const SERIF = '"Songti SC","STSong","Noto Serif SC","SimSun",serif';

interface FlatChar {
  ch: string;
  marked: boolean;
}

export function renderTicket(d: TicketData): HTMLCanvasElement {
  const W = 1080;
  const H = 1350;
  const canvas = document.createElement('canvas');
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext('2d')!;

  // 纸面
  ctx.fillStyle = '#f4efe3';
  ctx.fillRect(0, 0, W, H);

  // 双层边框
  ctx.strokeStyle = '#8a7f66';
  ctx.lineWidth = 3;
  ctx.strokeRect(36, 36, W - 72, H - 72);
  ctx.lineWidth = 1;
  ctx.strokeRect(52, 52, W - 104, H - 104);

  // 抬头
  ctx.textAlign = 'center';
  ctx.fillStyle = '#2b2a25';
  ctx.font = `64px ${SERIF}`;
  ctx.fillText('巴 別 圖 書 館', W / 2, 168);
  ctx.fillStyle = '#9e2b1b';
  ctx.font = `32px ${SERIF}`;
  ctx.fillText('藏 書 票', W / 2, 224);

  // 分隔线
  ctx.strokeStyle = '#c9bfa4';
  ctx.beginPath();
  ctx.moveTo(160, 262);
  ctx.lineTo(W - 160, 262);
  ctx.stroke();

  // 正文：按宽度折行，高亮段加粗并下划
  const flat: FlatChar[] = [];
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
  ctx.font = `30px ${SERIF}`;

  for (let i = 0; i < flat.length; i++) {
    const { ch, marked } = flat[i];
    ctx.font = `${marked ? 'bold ' : ''}30px ${SERIF}`;
    const w = ctx.measureText(ch).width;
    if (x + w > X1) {
      x = X0;
      y += LINE_H;
      lines++;
      if (lines > MAX_LINES) {
        truncated = true;
        break;
      }
    }
    ctx.fillStyle = marked ? '#9e2b1b' : 'rgba(43,42,37,0.58)';
    ctx.fillText(ch, x, y);
    if (marked) ctx.fillRect(x, y + 10, w, 3);
    x += w;
  }
  if (truncated) {
    ctx.fillStyle = 'rgba(43,42,37,0.58)';
    ctx.fillText('……', x, y);
  }

  // 坐标
  ctx.textAlign = 'center';
  ctx.fillStyle = '#6b675c';
  ctx.font = `26px ${SERIF}`;
  ctx.fillText(d.addressText, W / 2, 1160);

  // 印章（巴別藏書，2×2）
  ctx.save();
  ctx.translate(W - 240, H - 260);
  ctx.rotate((-8 * Math.PI) / 180);
  ctx.fillStyle = 'rgba(158,43,27,0.92)';
  ctx.fillRect(0, 0, 150, 150);
  ctx.fillStyle = '#f4efe3';
  ctx.font = `56px ${SERIF}`;
  ctx.fillText('巴', 44, 66);
  ctx.fillText('別', 106, 66);
  ctx.fillText('藏', 44, 132);
  ctx.fillText('書', 106, 132);
  ctx.restore();

  // 落款
  ctx.fillStyle = '#6b675c';
  ctx.font = `22px ${SERIF}`;
  const today = new Date();
  const dateStr = `${today.getFullYear()} 年 ${today.getMonth() + 1} 月 ${today.getDate()} 日`;
  ctx.fillText(`${d.url} · ${dateStr}`, W / 2, H - 78);

  return canvas;
}
