/* ============ 短剧剧场 ============ */
import { h, toast, timeAgo, confirm } from '../ui.js';
import { icon } from '../icons.js';
import { store } from '../store.js';
import { go } from '../app.js';

export function render(root) {
  const list = store.list('series');
  const page = h('div', { class: 'page' });
  root.append(page);

  page.append(h('div', { style: { display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' } },
    h('div', {},
      h('div', { class: 'page-title' }, '短剧'),
      h('div', { class: 'page-sub' }, '按剧本批量产出分集内容 · 资产库统一沉淀角色与场景')),
    h('div', { style: { display: 'flex', gap: '10px' } },
      h('button', { class: 'btn-ghost', onclick: () => go('assets') }, '资产库'),
      h('button', { class: 'btn-primary', onclick: () => go('studio') }, '＋ 新建短剧'))));

  if (!list.length) {
    page.append(h('div', { class: 'empty' }, h('div', { class: 'empty-icon', html: icon('film', 40) }),
      '还没有短剧项目', h('div', { style: { marginTop: '14px' } },
        h('button', { class: 'btn-primary', onclick: () => go('studio') }, '用一句话开始'))));
    return;
  }

  for (const s of list) {
    const shots = s.storyboard?.length || 0;
    const frames = s.storyboard?.filter(x => x.frame).length || 0;
    const videos = s.storyboard?.filter(x => x.video).length || 0;
    const pct = shots ? Math.round((videos / shots) * 100) : 0;
    page.append(h('div', { class: 'card', style: { padding: '16px', marginBottom: '12px' } },
      h('div', { style: { display: 'flex', alignItems: 'center', gap: '14px' } },
        h('div', { class: 'list-cover' }, s.storyboard?.find(x => x.frame) ? h('img', { src: s.storyboard.find(x => x.frame).frame }) : h('div', { class: 'flow-ph', html: icon('video', 36) })),
        h('div', { class: 'list-main' },
          h('div', { class: 'list-title' }, s.req?.title || s.logline?.slice(0, 20) || '未命名短剧'),
          h('div', { class: 'list-meta' }, `${shots} 个分镜 · 关键帧 ${frames} · 片段 ${videos} · ${timeAgo(s.createdAt)}`),
          h('div', { style: { height: '4px', background: 'var(--bg)', borderRadius: '4px', marginTop: '8px', overflow: 'hidden' } },
            h('div', { style: { height: '100%', width: pct + '%', background: 'var(--brand)', borderRadius: '4px' } }))),
        h('div', { style: { display: 'flex', gap: '8px' } },
          h('button', { class: 'btn-ghost', onclick: () => go('studio', { id: s.id }) }, '继续创作'),
          h('button', { class: 'btn-ghost btn-danger', onclick: async () => {
            if (await confirm('删除这个短剧项目？')) { store.remove('series', s.id); render(root); }
          } }, '删除')))));
  }
}
