/* ============ 图标库 ============
   统一 24×24 网格 · 1.7 描边 · 圆头圆角 · 主体跟随 currentColor
   实心点缀元素加 class="ic-f"（填充品牌青绿），"ic-f ic-dim" 为半透
   用法：icon('image', 20)  → SVG 字符串；iconEl('image', 20) → DOM
   ================================= */

const ICONS = {
  /* 图片生成：相框 + 太阳 + 远山 */
  image: '<rect x="3" y="4.5" width="18" height="15" rx="3"/>'
    + '<circle cx="8.5" cy="9.7" r="1.6" class="ic-f"/>'
    + '<path d="M3.9 16.7l4.5-4.5a1.3 1.3 0 011.85 0l3 3"/>'
    + '<path d="M12.4 16.1l2.1-2.1a1.3 1.3 0 011.85 0l3.75 3.75"/>',

  /* 视频生成：画框 + 播放键 */
  video: '<rect x="3" y="5" width="18" height="14" rx="3"/>'
    + '<path d="M10.4 9.35l4.5 2.65-4.5 2.65z" class="ic-f"/>',

  /* 剧情短片：场记板 */
  film: '<rect x="3.4" y="8.5" width="17.2" height="11.2" rx="2.2"/>'
    + '<path d="M3.4 8.5L5.7 4.4h13.6l2.3 4.1z"/>'
    + '<path d="M8.6 4.4L6.3 8.5"/><path d="M13.4 4.4l-2.3 4.1"/><path d="M18.2 4.4l-2.3 4.1"/>',

  /* Agent：星芒 */
  agent: '<path d="M11.5 3.1c.5 3.95 2.45 5.9 6.4 6.4-3.95.5-5.9 2.45-6.4 6.4-.5-3.95-2.45-5.9-6.4-6.4 3.95-.5 5.9-2.45 6.4-6.4z" class="ic-f"/>'
    + '<path d="M17.9 14.7c.23 1.75 1.08 2.6 2.83 2.83-1.75.23-2.6 1.08-2.83 2.83-.23-1.75-1.08-2.6-2.83-2.83 1.75-.23 2.6-1.08 2.83-2.83z" class="ic-f ic-dim"/>',

  /* 画布：节点连线 */
  canvas: '<rect x="2.8" y="3.6" width="8.6" height="6.2" rx="1.8"/>'
    + '<rect x="12.6" y="14.2" width="8.6" height="6.2" rx="1.8"/>'
    + '<path d="M7.1 9.8v4.2a2.4 2.4 0 002.4 2.4h3.1"/>',

  /* 资产：层叠 */
  layers: '<path d="M12 3.2l8.7 4.4L12 12 3.3 7.6z"/>'
    + '<path d="M3.3 12.3L12 16.7l8.7-4.4"/>'
    + '<path d="M3.3 16.6L12 21l8.7-4.4"/>',

  /* 作品：网格 */
  grid: '<rect x="3.2" y="3.2" width="7.6" height="7.6" rx="2"/>'
    + '<rect x="13.2" y="3.2" width="7.6" height="7.6" rx="2"/>'
    + '<rect x="3.2" y="13.2" width="7.6" height="7.6" rx="2"/>'
    + '<rect x="13.2" y="13.2" width="7.6" height="7.6" rx="2"/>',

  /* 模型接入：插头 */
  plug: '<path d="M9.2 2.8v5M14.8 2.8v5"/>'
    + '<path d="M6.2 7.8h11.6v3.6a5.8 5.8 0 01-11.6 0z"/>'
    + '<path d="M12 17.2v4"/>',

  /* 警告 */
  warn: '<path d="M12 3.4l9.4 16.2H2.6z"/>'
    + '<path d="M12 9.7v4.6" stroke-width="2"/>'
    + '<circle cx="12" cy="17.2" r="1.05" fill="currentColor" stroke="none"/>',

  /* 音乐 / 配音 */
  music: '<path d="M9.2 17.8V6.6l10-2.1v11"/>'
    + '<ellipse cx="6.7" cy="17.9" rx="2.5" ry="2.3"/>'
    + '<ellipse cx="16.7" cy="15.5" rx="2.5" ry="2.3"/>',

  /* 对白 */
  chat: '<path d="M20.4 12.4c0 3.8-3.8 6.9-8.4 6.9-1 0-2-.15-2.9-.42L4.3 20.3l1.35-3.4A6.5 6.5 0 013.6 12.4c0-3.8 3.8-6.9 8.4-6.9s8.4 3.1 8.4 6.9z"/>',

  /* 上传 */
  upload: '<path d="M12 15.6V4.4M7.4 9L12 4.4 16.6 9"/>'
    + '<path d="M4.4 15.2v2.8a2.4 2.4 0 002.4 2.4h10.4a2.4 2.4 0 002.4-2.4v-2.8"/>',

  /* 生成 / 闪光 */
  spark: '<path d="M12 3.6l1.75 4.65L18.4 10l-4.65 1.75L12 16.4l-1.75-4.65L5.6 10l4.65-1.75z" class="ic-f"/>',

  /* 空状态：空盒子 */
  box: '<path d="M3.6 7.6L12 3.4l8.4 4.2v8.8L12 20.6l-8.4-4.2z"/>'
    + '<path d="M3.6 7.6L12 11.8l8.4-4.2M12 11.8v8.8"/>'
};

export const ICON_NAMES = Object.keys(ICONS);

/** 返回 SVG 字符串 */
export function icon(name, size = 20, cls = '') {
  const body = ICONS[name] || ICONS.box;
  return `<svg viewBox="0 0 24 24" width="${size}" height="${size}" fill="none" `
    + `stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"`
    + (cls ? ` class="${cls}"` : '') + `>${body}</svg>`;
}

/** 返回 DOM 节点（<span class="ico">） */
export function iconEl(name, size = 20, cls = '') {
  const span = document.createElement('span');
  span.className = 'ico' + (cls ? ' ' + cls : '');
  span.innerHTML = icon(name, size);
  return span;
}
