/* ============ 资产库 ============ */
import { h, $, toast, pickFile, modal, confirm, download, timeAgo } from '../ui.js';
import { store, uid, saveMedia } from '../store.js';

const TYPES = { all: '全部', character: '角色', scene: '场景', prop: '道具' };

export function render(root) {
  let filter = 'all';
  const page = h('div', { class: 'page' });
  root.append(page);

  const grid = h('div', { class: 'asset-cards' });
  const filterRow = h('div', { class: 'filter-row' });

  const drawFilters = () => {
    filterRow.innerHTML = '';
    for (const [k, label] of Object.entries(TYPES)) {
      const n = k === 'all' ? store.list('assets').length : store.list('assets').filter(a => a.type === k).length;
      filterRow.append(h('button', {
        class: 'filter-btn' + (k === filter ? ' active' : ''),
        onclick: () => { filter = k; drawFilters(); drawGrid(); }
      }, `${label} ${n}`));
    }
  };

  const drawGrid = () => {
    const list = store.list('assets').filter(a => filter === 'all' || a.type === filter);
    grid.innerHTML = '';
    if (!list.length) {
      grid.append(h('div', { class: 'empty', style: { gridColumn: '1/-1' } },
        h('div', { class: 'empty-icon' }, '🧩'), '还没有资产。在画布或剧情短片里点「存为资产」即可沉淀。'));
      return;
    }
    for (const a of list) {
      grid.append(h('div', { class: 'asset-card' },
        h('div', { style: { cursor: 'zoom-in' }, onclick: () => modal({ title: a.name, large: true, body: h('img', { src: a.url, style: { width: '100%', borderRadius: '12px' } }) }) },
          h('img', { src: a.url, loading: 'lazy' })),
        h('div', { class: 'asset-body' },
          h('div', { class: 'asset-name' }, a.name),
          h('div', { style: { display: 'flex', gap: '6px', margin: '4px 0' } },
            h('span', { class: 'badge' }, TYPES[a.type] || '素材'),
            h('span', { class: 'tag' }, timeAgo(a.createdAt))),
          h('div', { class: 'asset-desc' }, a.desc || '—'),
          h('div', { style: { display: 'flex', gap: '6px', marginTop: '8px' } },
            h('button', { class: 'node-btn', onclick: () => navigator.clipboard?.writeText(a.desc || a.name).then(() => toast('描述已复制', 'ok')) }, '复制描述'),
            h('button', { class: 'node-btn', onclick: () => download(a.url, a.name + '.png') }, '下载'),
            h('button', { class: 'node-btn', onclick: async () => { if (await confirm(`删除资产「${a.name}」？`)) { store.remove('assets', a.id); drawFilters(); drawGrid(); } } }, '删除')))));
    }
  };

  async function upload() {
    const f = await pickFile('image/*');
    if (!f) return;
    const url = await saveMedia(f);
    const m = modal({
      title: '新建资产',
      body: h('div', {},
        h('img', { src: url, style: { width: '100%', borderRadius: '10px', marginBottom: '14px' } }),
        h('div', { class: 'form-group' }, h('label', { class: 'form-label' }, '名称'), (() => { const i = h('input', { class: 'form-input' }); i.id = 'na-name'; i.value = f.name.replace(/\.[^.]+$/, ''); return i; })()),
        h('div', { class: 'form-group' }, h('label', { class: 'form-label' }, '类型'), (() => {
          const s = h('select', { class: 'form-select' }); s.id = 'na-type';
          Object.entries(TYPES).filter(([k]) => k !== 'all').forEach(([k, v]) => s.append(h('option', { value: k }, v)));
          return s;
        })()),
        h('div', { class: 'form-group' }, h('label', { class: 'form-label' }, '描述'), (() => { const a = h('textarea', { class: 'form-area' }); a.id = 'na-desc'; return a; })())),
      foot: [h('button', { class: 'btn-ghost', onclick: () => m.close() }, '取消'),
        h('button', { class: 'btn-primary', onclick: () => {
          store.add('assets', { id: uid('a'), name: $('#na-name').value || '未命名', type: $('#na-type').value, desc: $('#na-desc').value, url, createdAt: Date.now() });
          m.close(); drawFilters(); drawGrid(); toast('已添加', 'ok');
        } }, '保存')]
    });
  }

  page.append(h('div', { style: { display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' } },
    h('div', {},
      h('div', { class: 'page-title' }, '资产库'),
      h('div', { class: 'page-sub' }, '角色 · 场景 · 道具 沉淀在这里，任何镜头都能复用，这是不崩脸的关键')),
    h('button', { class: 'btn-primary', onclick: upload }, '＋ 上传资产')),
    filterRow, grid);

  drawFilters(); drawGrid();
}
