/* ============================================================
 *  公告展示（用户端）：顶栏通知弹窗 + 首页横幅
 * ============================================================ */
import { h, modal } from './ui.js';
import { notices, fmtDate, opsData } from './ops.js';
import { store } from './store.js';
import { openSupport } from './support.js';

const LEVEL_META = {
  info: { label: '公告', cls: 'info' },
  ok: { label: '通知', cls: 'ok' },
  warn: { label: '重要', cls: 'warn' }
};

const account = () => store.state.session?.account || '';

/* 已关闭的横幅（同一个公告只提示一次，避免老是挡着） */
function isDismissed(id) {
  const o = opsData();
  if (!Array.isArray(o.dismissed)) o.dismissed = [];
  return o.dismissed.includes(id);
}
function dismiss(id) {
  const o = opsData();
  if (!Array.isArray(o.dismissed)) o.dismissed = [];
  if (!o.dismissed.includes(id)) o.dismissed.push(id);
  /* 只留最近 50 条记录 */
  o.dismissed = o.dismissed.slice(-50);
  store.save();
}

/* ---------- 首页横幅 ---------- */
export function noticeBanner() {
  const n = notices.banner();
  if (!n || isDismissed(n.id)) return null;
  const meta = LEVEL_META[n.level] || LEVEL_META.info;
  return h('div', { class: 'notice-banner ' + meta.cls },
    h('span', { class: 'notice-tag' }, n.pinned ? '置顶' : meta.label),
    h('div', { class: 'notice-body' },
      h('div', { class: 'notice-title' }, n.title),
      n.body ? h('div', { class: 'notice-text' }, n.body) : null),
    h('button', { class: 'notice-close', title: '收起', onclick: e => {
      dismiss(n.id);
      e.currentTarget.closest('.notice-banner')?.remove();
    } }, '×'));
}

/* ---------- 顶栏通知弹窗 ---------- */
export function openNotices() {
  const list = notices.list();
  const acct = account();

  const m = modal({
    title: '平台公告',
    body: list.length
      ? h('div', { class: 'notice-list' }, ...list.map(n => {
        const meta = LEVEL_META[n.level] || LEVEL_META.info;
        return h('div', { class: 'notice-item ' + meta.cls },
          h('div', { class: 'notice-item-head' },
            h('span', { class: 'notice-tag' }, n.pinned ? '置顶' : meta.label),
            h('div', { class: 'notice-title' }, n.title),
            h('span', { class: 'notice-time' }, fmtDate(n.createdAt))),
          n.body ? h('div', { class: 'notice-text' }, n.body) : null);
      }))
      : h('div', { class: 'notice-empty' },
        h('div', { style: { fontSize: '15px', fontWeight: '600', marginBottom: '6px' } }, '还没有公告'),
        h('div', { class: 'hint', style: { margin: '0' } },
          '管理员发布新公告后，这里会有未读小红点提醒。有急事可以直接找客服。'),
        h('div', { style: { marginTop: '14px' } },
          h('button', { class: 'btn-ghost', onclick: () => { m.close(); openSupport({ account: acct }); } }, '联系客服'))),
    foot: [
      h('button', { class: 'btn-ghost', onclick: () => { m.close(); openSupport({ account: acct }); } }, '联系客服'),
      h('button', { class: 'btn-primary', onclick: () => m.close() }, '知道了')
    ]
  });

  /* 打开即视为已读，红点消失 */
  notices.markRead(acct);
  window.dispatchEvent(new CustomEvent('pavo-notices'));
  return m;
}
