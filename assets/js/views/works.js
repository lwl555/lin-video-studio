/* ============ 作品库 ============ */
import { h, toast, download, confirm, timeAgo } from '../ui.js';
import { icon } from '../icons.js';
import { store } from '../store.js';

export function render(root, params = {}) {
  let filter = 'all';
  let q = params.q || '';
  const page = h('div', { class: 'page' });
  root.append(page);

  const filterRow = h('div', { class: 'filter-row' });
  const grid = h('div', { class: 'flow-grid' });

  const drawFilters = () => {
    filterRow.innerHTML = '';
    const all = store.list('works');
    for (const [k, label] of [['all', '全部'], ['image', '图片'], ['video', '视频']]) {
      const n = k === 'all' ? all.length : all.filter(w => w.type === k).length;
      filterRow.append(h('button', {
        class: 'filter-btn' + (k === filter ? ' active' : ''),
        onclick: () => { filter = k; drawFilters(); drawGrid(); }
      }, `${label} ${n}`));
    }
  };

  const drawGrid = () => {
    const list = store.list('works')
      .filter(w => filter === 'all' || w.type === filter)
      .filter(w => !q || (w.title || '').toLowerCase().includes(q.toLowerCase()));
    grid.innerHTML = '';
    if (!list.length) {
      grid.append(h('div', { class: 'empty', style: { gridColumn: '1/-1' } },
        h('div', { class: 'empty-icon', html: icon('grid', 40) }), q ? `没有匹配「${q}」的作品` : '还没有作品，去首页创作吧'));
      return;
    }
    for (const w of list) {
      const thumb = w.type === 'video'
        ? h('video', { src: w.url, muted: true, playsinline: true, onmouseover: e => e.target.play?.(), onmouseout: e => e.target.pause?.() })
        : h('img', { src: w.url, loading: 'lazy' });
      grid.append(h('div', { class: 'flow-card' },
        h('div', { class: 'flow-thumb', onclick: () => window.open(w.url, '_blank') }, thumb,
          h('span', { class: 'flow-badge' }, w.type === 'video' ? '视频' : '图片')),
        h('div', { class: 'flow-body' },
          h('div', { class: 'flow-title' }, w.title || '未命名'),
          h('div', { class: 'flow-meta' }, timeAgo(w.createdAt)),
          h('div', { style: { display: 'flex', gap: '6px', marginTop: '8px' } },
            h('button', { class: 'node-btn', onclick: () => download(w.url, (w.title || 'work') + (w.type === 'video' ? '.mp4' : '.png')) }, '下载'),
            h('button', { class: 'node-btn', onclick: () => navigator.clipboard?.writeText(w.url).then(() => toast('链接已复制', 'ok')) }, '复制链接'),
            h('button', { class: 'node-btn', onclick: async () => { if (await confirm('删除这个作品？')) { store.remove('works', w.id); drawFilters(); drawGrid(); } } }, '删除')))));
    }
  };

  page.append(h('div', {},
    h('div', { class: 'page-title' }, '作品'),
    h('div', { class: 'page-sub' }, '所有生成结果都收在这里，可下载、可复制链接'),
    filterRow, grid));

  drawFilters(); drawGrid();
}
