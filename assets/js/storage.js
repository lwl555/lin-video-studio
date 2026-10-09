/* ============ 存储容量管理：检测 · 自动清理 · 手动清理 · 压缩 ============ */

/** localStorage 常规上限（Chrome/Edge 5MB，按 UTF-16 计） */
export const LS_LIMIT = 5 * 1024 * 1024;

/** 本地直存时，单个视频/音频文件上限（再大必然写不下，提前拦截） */
export const MAX_INLINE_MEDIA = 6 * 1024 * 1024;

export const fmtMB = b => (b / 1048576).toFixed(2) + ' MB';
export const fmtKB = b => b > 1048576 ? fmtMB(b) : Math.max(1, Math.round(b / 1024)) + ' KB';

/** 全库估算字节数（JSON 序列化 × UTF-16） */
export function estimateBytes(state) {
  return JSON.stringify(state).length * 2 + 400;
}

/** 当前 localStorage 实际占用 */
export function lsBytes() {
  let n = 0;
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      n += ((localStorage.getItem(k) || '').length + k.length) * 2;
    }
  } catch { /* ignore */ }
  return n;
}

const isData = v => typeof v === 'string' && v.startsWith('data:');

/**
 * 收集所有本地 base64 素材的"引用点"
 * 返回 [{ts, kind, name, get(), set(v)}]，按时间从旧到新排序
 */
export function collectMediaSpots(state) {
  const spots = [];
  const add = (ts, kind, name, get, set) => spots.push({ ts: ts || 0, kind, name: name || '未命名', get, set });

  for (const w of state.works || [])
    if (isData(w.url)) add(w.createdAt, '作品', w.title, () => w.url, v => { w.url = v; });

  for (const a of state.assets || [])
    if (isData(a.url)) add(a.createdAt, '资产', a.name, () => a.url, v => { a.url = v; });

  for (const p of state.projects || [])
    for (const n of p.nodes || [])
      if (n.media && isData(n.media.url))
        add(p.updatedAt || p.createdAt, '画布素材', n.title, () => n.media?.url, v => { if (n.media) n.media.url = v; });

  for (const s of state.series || []) {
    for (const sb of s.storyboard || []) {
      if (isData(sb.frame)) add(s.createdAt, '分镜关键帧', '镜头 ' + sb.n, () => sb.frame, v => { sb.frame = v; });
      if (isData(sb.video)) add(s.createdAt, '分镜视频', '镜头 ' + sb.n, () => sb.video, v => { sb.video = v; });
    }
    for (const c of [...(s.outline?.characters || []), ...(s.outline?.scenes || [])])
      if (isData(c.image)) add(s.createdAt, '角色场景图', c.name, () => c.image, v => { c.image = v; });
  }
  return spots.sort((a, b) => a.ts - b.ts);
}

/** 用量报告：总量 / 上限 / 百分比 / 按类统计 */
export function usageReport(state) {
  const spots = collectMediaSpots(state);
  const total = lsBytes();
  const byKind = {};
  for (const s of spots) {
    const b = (s.get() || '').length * 2;
    const e = byKind[s.kind] || (byKind[s.kind] = { count: 0, bytes: 0 });
    e.count++; e.bytes += b;
  }
  return {
    total,
    limit: LS_LIMIT,
    percent: Math.min(100, Math.round(total / LS_LIMIT * 100)),
    spots,
    byKind,
    mediaBytes: spots.reduce((a, s) => a + (s.get() || '').length * 2, 0)
  };
}

/**
 * 自动清理：从最旧的素材开始置空，直到估算体积降到 targetBytes 以下
 * 返回清掉的数量（只清数据，不动元信息，界面会显示"素材已清理"占位）
 */
export function shrinkUntilUnder(state, targetBytes) {
  let freed = 0;
  for (const s of collectMediaSpots(state)) {
    if (estimateBytes(state) <= targetBytes) break;
    s.set(null); freed++;
  }
  return freed;
}

/** 手动清理：保留最新 keepN 个素材，其余清掉。返回清理数量 */
export function clearOldest(state, keepN = 20) {
  const spots = collectMediaSpots(state).slice().reverse();
  let n = 0;
  spots.forEach((s, i) => { if (i >= keepN) { s.set(null); n++; } });
  return n;
}

/** 手动清理：清空某一类素材 */
export function clearKind(state, kind) {
  let n = 0;
  for (const s of collectMediaSpots(state)) if (s.kind === kind) { s.set(null); n++; }
  return n;
}

/** 手动清理：清空全部素材（保留所有元数据） */
export function clearAllMedia(state) {
  const spots = collectMediaSpots(state);
  spots.forEach(s => s.set(null));
  return spots.length;
}

/**
 * 图片压缩：长边压到 maxSide、转 JPEG（透明区先铺白底）
 * 已经够小就原样返回
 */
export function compressImage(dataUrl, { maxSide = 1280, quality = 0.82 } = {}) {
  return new Promise(resolve => {
    if (!dataUrl.startsWith('data:image')) return resolve(dataUrl);
    const img = new Image();
    img.onload = () => {
      try {
        const scale = Math.min(1, maxSide / Math.max(img.width, img.height));
        const estBytes = dataUrl.length * 0.75;
        if (scale >= 1 && estBytes < 260 * 1024) return resolve(dataUrl);
        const c = document.createElement('canvas');
        c.width = Math.max(1, Math.round(img.width * scale));
        c.height = Math.max(1, Math.round(img.height * scale));
        const ctx = c.getContext('2d');
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(0, 0, c.width, c.height);
        ctx.drawImage(img, 0, 0, c.width, c.height);
        const out = c.toDataURL('image/jpeg', quality);
        resolve(out.length < dataUrl.length ? out : dataUrl);
      } catch { resolve(dataUrl); }
    };
    img.onerror = () => resolve(dataUrl);
    img.src = dataUrl;
  });
}

/** 一键压缩全部图片素材，返回节省的字节数 */
export async function compressAllImages(state, onProgress = () => { }) {
  const spots = collectMediaSpots(state).filter(s => (s.get() || '').startsWith('data:image'));
  let saved = 0, done = 0;
  for (const s of spots) {
    done++;
    onProgress(`压缩中 ${done}/${spots.length}…`);
    try {
      const before = (s.get() || '').length * 2;
      const out = await compressImage(s.get(), { maxSide: 1024, quality: 0.78 });
      if (out.length * 2 < before) { s.set(out); saved += before - out.length * 2; }
    } catch { /* 跳过坏的 */ }
    await new Promise(r => setTimeout(r, 0)); // 让 UI 喘口气
  }
  return saved;
}
