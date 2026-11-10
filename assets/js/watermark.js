/* ============================================================
 *  体验版水印（运营文档 3.1）
 *  ------------------------------------------------------------
 *  · 体验用户（free 等级）下载图片/视频时叠加平台水印
 *  · 会员 / 团队 / 管理员：无水印
 *  · 「不改原图」：只在下载那一刻合成一份带水印的副本，素材库里仍是原图
 *  图片：canvas 烘焙；视频：ffmpeg.wasm overlay 一张 canvas 生成的水印图
 *  注意：跨域图片若不允许 CORS，canvas 会被污染，此时只能退回原图并明确提示。
 * ============================================================ */
import { h, toast, download } from './ui.js';
import { store } from './store.js';
import { tierInfo } from './points.js';

export const WM_TEXT = '林的视频工作台 · 体验版';

const acct = () => store.state.session?.account || '';

/* 当前账号下载时是否需要加水印 */
export function needsWatermark(account = acct()) {
  if (!account) return false;
  if (store.state.session?.role === 'admin') return false;
  return !!tierInfo(account).watermark;
}

/* 水印文案 + 角标尺寸按画面宽度自适应 */
function drawMark(ctx, W, H) {
  const pad = Math.round(Math.max(14, W * 0.022));
  const fs = Math.round(Math.max(15, Math.min(W, H) * 0.032));
  const text = WM_TEXT;
  ctx.font = `600 ${fs}px -apple-system, "PingFang SC", "Microsoft YaHei", sans-serif`;
  ctx.textBaseline = 'middle';
  const tw = ctx.measureText(text).width;
  const bw = Math.round(tw + fs * 1.5);
  const bh = Math.round(fs * 2.1);
  const x = W - bw - pad;
  const y = H - bh - pad;

  ctx.globalAlpha = 0.62;
  ctx.fillStyle = '#0B1220';
  const r = Math.round(bh / 2.6);
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + bw, y, x + bw, y + bh, r);
  ctx.arcTo(x + bw, y + bh, x, y + bh, r);
  ctx.arcTo(x, y + bh, x, y, r);
  ctx.arcTo(x, y, x + bw, y, r);
  ctx.closePath();
  ctx.fill();

  ctx.globalAlpha = 0.96;
  ctx.fillStyle = '#FFFFFF';
  ctx.fillText(text, x + fs * 0.75, y + bh / 2 + 1);
  ctx.globalAlpha = 1;
}

function loadImg(src) {
  return new Promise((res, rej) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';          /* 先按 CORS 取，成功才能安全写 canvas */
    img.onload = () => res(img);
    img.onerror = () => {
      const plain = new Image();            /* CORS 失败再退回普通加载（可能污染 canvas） */
      plain.onload = () => res(plain);
      plain.onerror = () => rej(new Error('图片加载失败，可能是链接过期或跨域被拒'));
      plain.src = src;
    };
    img.src = src;
  });
}

function canvasToBlob(canvas, type = 'image/png') {
  return new Promise((res, rej) => {
    try {
      canvas.toBlob(b => b ? res(b) : rej(new Error('合成失败')), type, 0.95);
    } catch (e) {
      rej(e);
    }
  });
}

/* 给图片叠水印，返回 Blob；canvas 被跨域污染时抛 WM_TAINTED */
export async function watermarkImageBlob(src) {
  const img = await loadImg(src);
  const W = img.naturalWidth || img.width;
  const H = img.naturalHeight || img.height;
  if (!W || !H) throw new Error('这张图没有可用的尺寸');
  const c = document.createElement('canvas');
  c.width = W; c.height = H;
  const ctx = c.getContext('2d');
  ctx.drawImage(img, 0, 0, W, H);
  drawMark(ctx, W, H);
  try {
    return await canvasToBlob(c);
  } catch (e) {
    const err = new Error('WM_TAINTED');
    err.code = 'WM_TAINTED';
    throw err;
  }
}

/* 生成一张水印 PNG（给 ffmpeg overlay 用），返回 dataURL */
async function watermarkPngDataUrl(size = 640) {
  const c = document.createElement('canvas');
  c.width = size;
  c.height = Math.round(size * 0.22);
  const ctx = c.getContext('2d');
  ctx.font = '600 34px -apple-system, "PingFang SC", "Microsoft YaHei", sans-serif';
  ctx.textBaseline = 'middle';
  const tw = ctx.measureText(WM_TEXT).width;
  const pad = 16, bh = 58, bw = Math.round(tw + 40);
  const x = c.width - bw - pad, y = c.height - bh - pad;
  ctx.globalAlpha = 0.62;
  ctx.fillStyle = '#0B1220';
  const r = bh / 2.6;
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + bw, y, x + bw, y + bh, r);
  ctx.arcTo(x + bw, y + bh, x, y + bh, r);
  ctx.arcTo(x, y + bh, x, y, r);
  ctx.arcTo(x, y, x + bw, y, r);
  ctx.closePath();
  ctx.fill();
  ctx.globalAlpha = 0.96;
  ctx.fillStyle = '#FFFFFF';
  ctx.fillText(WM_TEXT, x + 20, y + bh / 2 + 1);
  return c.toDataURL('image/png');
}

async function toBlobUrl(url) {
  const r = await fetch(url);
  if (!r.ok) throw new Error('下载素材失败 HTTP ' + r.status);
  return await r.blob();
}

function saveBlob(blob, name) {
  const u = URL.createObjectURL(blob);
  download(u, name);
  setTimeout(() => URL.revokeObjectURL(u), 20000);
}

/* 视频：ffmpeg 叠加水印后另存，原片不动 */
async function watermarkVideo(url, name) {
  const { getFFmpeg } = await import('./media.js');
  toast('正在给视频加水印（首次需加载合成内核，约 30MB）…', '', 6000);
  const ff = await getFFmpeg(() => { });
  const wmUrl = await watermarkPngDataUrl();
  const wmBin = await (await fetch(wmUrl)).arrayBuffer();
  const inBin = new Uint8Array(await (await toBlobUrl(url)).arrayBuffer());

  const stamp = 'wm' + Date.now();
  const inName = stamp + '-in.mp4';
  const wmName = stamp + '-wm.png';
  const outName = stamp + '-out.mp4';
  await ff.writeFile(inName, inBin);
  await ff.writeFile(wmName, new Uint8Array(wmBin));
  await ff.exec([
    '-i', inName,
    '-i', wmName,
    '-filter_complex', '[0:v][1:v]overlay=W-w-20:H-h-20',
    '-c:a', 'copy',
    '-y', outName
  ]);
  const out = await ff.readFile(outName);
  const blob = new Blob([out.buffer ? out.buffer : out], { type: 'video/mp4' });
  saveBlob(blob, name);
  try {
    await ff.deleteFile(inName); await ff.deleteFile(wmName); await ff.deleteFile(outName);
  } catch { /* 清理失败不影响下载 */ }
}

/* 统一下载入口：体验版自动加水印，会员直出 */
export async function downloadMedia(url, name = 'download', kind = 'image') {
  const need = needsWatermark();
  if (!need) { download(url, name); return { watermarked: false }; }

  if (kind === 'image') {
    try {
      const blob = await watermarkImageBlob(url);
      saveBlob(blob, name);
      toast('体验版已加平台水印，升级会员可下载无水印原图', '', 4200);
      return { watermarked: true };
    } catch (e) {
      if (e.code === 'WM_TAINTED') {
        toast('这张图所在的图床不允许跨域合成水印，已按原图下载', 'err', 5200);
        download(url, name);
        return { watermarked: false, reason: 'cors' };
      }
      toast('加水印失败：' + e.message + '，已按原图下载', 'err', 5200);
      download(url, name);
      return { watermarked: false, reason: 'error' };
    }
  }

  /* 视频 */
  try {
    await watermarkVideo(url, name);
    toast('体验版已加平台水印，升级会员可下载无水印原片', '', 4200);
    return { watermarked: true };
  } catch (e) {
    toast('视频加水印失败：' + (e?.message || e) + '。可重试，或升级会员直接下载原片', 'err', 6000);
    return { watermarked: false, reason: 'error' };
  }
}
