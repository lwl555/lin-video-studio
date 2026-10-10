/* ============ 通用 UI 组件 ============ */

/* 素材被清理后的占位图 + img 兜底 */
export const IMG_PLACEHOLDER = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(
  '<svg xmlns="http://www.w3.org/2000/svg" width="320" height="200"><rect width="320" height="200" fill="#F2F3F5"/><svg x="140" y="34" width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="#C3C8D2" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4.5" width="18" height="15" rx="3"/><circle cx="8.5" cy="9.7" r="1.6" fill="#C3C8D2" stroke="none"/><path d="M3.9 16.7l4.5-4.5a1.3 1.3 0 011.85 0l3 3"/><path d="M12.4 16.1l2.1-2.1a1.3 1.3 0 011.85 0l3.75 3.75"/></svg><text x="160" y="128" font-size="13" text-anchor="middle" fill="#AEB4BF" font-family="sans-serif">素材已清理（元数据保留）</text></svg>'
);
export function imgErr(e) {
  const t = e.target;
  if (t.dataset.pavoErr) return;
  t.dataset.pavoErr = '1';
  t.src = IMG_PLACEHOLDER;
}

/* DOM 构建助手 */
export function h(tag, props = {}, ...children) {
  const el = document.createElement(tag);
  if (String(tag).toLowerCase() === 'img') el.addEventListener('error', imgErr);
  for (const [k, v] of Object.entries(props || {})) {
    if (v == null || v === false) continue;
    if (k === 'class') el.className = v;
    else if (k === 'html') el.innerHTML = v;
    else if (k === 'style') Object.assign(el.style, v);
    else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2).toLowerCase(), v);
    else if (k === 'dataset') Object.assign(el.dataset, v);
    else el.setAttribute(k, v === true ? '' : v);
  }
  for (const c of children.flat()) {
    if (c == null || c === false) continue;
    el.append(c.nodeType ? c : document.createTextNode(String(c)));
  }
  return el;
}
export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];
export const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

/* Toast */
/* 容器缺失时自建，避免在缺少 #toast-root 骨架的页面里静默抛错、把调用方后续逻辑一起带崩 */
export function toast(msg, type = '', ms = 2600) {
  let root = $('#toast-root');
  if (!root) { root = h('div', { id: 'toast-root', class: 'toast-root' }); document.body.append(root); }
  const t = h('div', { class: 'toast ' + type }, msg);
  root.append(t);
  setTimeout(() => { t.style.opacity = '0'; t.style.transition = '.25s'; setTimeout(() => t.remove(), 260); }, ms);
}

/* Modal */
export function modal({ title, body, foot, large = false, onClose } = {}) {
  const mask = h('div', { class: 'modal-mask' });
  const box = h('div', { class: 'modal' + (large ? ' modal-lg' : '') });
  const close = () => { mask.remove(); onClose?.(); };
  mask.append(box);
  box.append(
    h('div', { class: 'modal-head' },
      h('div', { class: 'modal-title' }, title || ''),
      h('button', { class: 'icon-btn', onclick: close, html: '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2"><path d="M18 6L6 18M6 6l12 12"/></svg>' })
    ),
    h('div', { class: 'modal-body' }, body),
    foot ? h('div', { class: 'modal-foot' }, foot) : null
  );
  mask.addEventListener('mousedown', e => { if (e.target === mask) close(); });
  let mroot = $('#modal-root');
  if (!mroot) { mroot = h('div', { id: 'modal-root' }); document.body.append(mroot); }
  mroot.append(mask);
  return { close, box, body: $('.modal-body', box) };
}

/* 确认框 */
export function confirm(msg, title = '确认') {
  return new Promise(res => {
    const m = modal({
      title,
      body: h('div', { style: { fontSize: '13.5px', color: 'var(--txt-2)' } }, msg),
      foot: [
        h('button', { class: 'btn-ghost', onclick: () => { m.close(); res(false); } }, '取消'),
        h('button', { class: 'btn-primary', onclick: () => { m.close(); res(true); } }, '确定')
      ]
    });
  });
}

/* 右键菜单 */
export function ctxMenu(x, y, items) {
  const menu = $('#context-menu');
  menu.innerHTML = '';
  for (const it of items) {
    if (it === '-') { menu.append(h('div', { class: 'cm-sep' })); continue; }
    if (it.label) { menu.append(h('div', { class: 'cm-label' }, it.label)); continue; }
    menu.append(h('button', {
      class: 'cm-item',
      onclick: () => { hideCtx(); it.onClick?.(); }
    }, it.icon ? h('span', { html: it.icon }) : null, it.text));
  }
  menu.classList.remove('hidden');
  const r = menu.getBoundingClientRect();
  menu.style.left = Math.min(x, innerWidth - r.width - 8) + 'px';
  menu.style.top = Math.min(y, innerHeight - r.height - 8) + 'px';
}
export function hideCtx() { $('#context-menu').classList.add('hidden'); }
document.addEventListener('mousedown', e => { if (!e.target.closest('#context-menu')) hideCtx(); });
document.addEventListener('contextmenu', e => { if (!e.target.closest('.node')) hideCtx(); });

/* 文件选择 */
export function pickFile(accept = 'image/*') {
  return new Promise(res => {
    const inp = h('input', { type: 'file', accept, style: { display: 'none' } });
    inp.addEventListener('change', () => res(inp.files?.[0] || null));
    document.body.append(inp);
    inp.click();
    setTimeout(() => inp.remove(), 1000);
  });
}

/* 模型选择器（列出某类型 provider） */
import { providers, TYPE_LABEL } from './models.js';
export function modelSelect(type, value, onChange) {
  const list = providers.byType(type);
  const sel = h('select', { class: 'form-select', onchange: e => onChange(e.target.value) });
  if (!list.length) {
    sel.append(h('option', { value: '' }, `未接入${TYPE_LABEL[type]}模型`));
    sel.disabled = true;
  } else {
    for (const p of list) sel.append(h('option', { value: p.id, selected: p.id === value }, `${p.name} · ${p.model}`));
  }
  return sel;
}
export function modelChip(type) {
  const p = providers.defaultOf(type);
  return p ? `${p.name} · ${p.model}` : `未接入${TYPE_LABEL[type]}`;
}

/* 时间格式化 */
export function timeAgo(ts) {
  const d = (Date.now() - ts) / 1000;
  if (d < 60) return '刚刚';
  if (d < 3600) return Math.floor(d / 60) + ' 分钟前';
  if (d < 86400) return Math.floor(d / 3600) + ' 小时前';
  if (d < 2592000) return Math.floor(d / 86400) + ' 天前';
  return new Date(ts).toLocaleDateString('zh-CN');
}

/* 下载 */
export function download(url, name) {
  const a = h('a', { href: url, download: name || 'download', target: '_blank' });
  document.body.append(a); a.click(); a.remove();
}
