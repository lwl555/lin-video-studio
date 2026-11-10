/* ============================================================
 *  用量统计与每日配额
 *  ------------------------------------------------------------
 *  每次真正发起的模型调用（文本 / 图像 / 视频）成功后计一次，
 *  按「账号 + 日期」累加，存在 store.state.usage：
 *    { '18882632073|2026-11-10': { text: 12, image: 3, video: 1 } }
 *  配额优先级：管理员不限 → 单人覆盖 → 全局默认；邀请奖励在有效期内叠加。
 *  0 表示不限。
 * ============================================================ */
import { store } from './store.js';
import { opsData, quota, QUOTA_KINDS, KIND_LABEL, dayKey, DAY_MS } from './ops.js';
import { limitsOf } from './points.js';

/* 保留多少天的明细，避免 localStorage 无限长胖 */
const KEEP_DAYS = 90;

const account = () => store.state.session?.account || '';
const isAdmin = () => store.state.session?.role === 'admin';

function usageStore() {
  const s = store.state;
  if (!s.usage || typeof s.usage !== 'object') s.usage = {};
  return s.usage;
}

const keyOf = (acct, day) => `${acct}|${day}`;

/* 某账号某天的用量（缺省全部为 0） */
export function usageOf(acct, day = dayKey()) {
  const u = usageStore()[keyOf(acct, day)];
  const out = { text: 0, image: 0, video: 0 };
  if (u) for (const k of QUOTA_KINDS) out[k] = Math.max(0, Number(u[k]) || 0);
  return out;
}

/* 累计 n 天（含今天） */
export function usageRange(acct, days = 7) {
  const out = { text: 0, image: 0, video: 0 };
  const now = new Date();
  for (let i = 0; i < days; i++) {
    const d = new Date(now.getFullYear(), now.getMonth(), now.getDate() - i);
    const u = usageOf(acct, dayKey(d));
    for (const k of QUOTA_KINDS) out[k] += u[k];
  }
  return out;
}

/* 全部历史累计 */
export function usageTotal(acct) {
  const out = { text: 0, image: 0, video: 0 };
  const pre = acct + '|';
  const us = usageStore();
  for (const k of Object.keys(us)) {
    if (!k.startsWith(pre)) continue;
    const u = us[k] || {};
    for (const t of QUOTA_KINDS) out[t] += Math.max(0, Number(u[t]) || 0);
  }
  return out;
}

const sumOf = o => QUOTA_KINDS.reduce((a, k) => a + (o[k] || 0), 0);

/* 邀请奖励：有效期内每天额外额度 */
function bonusOf(acct) {
  const u = (store.list('users') || []).find(x => x.account === acct);
  const b = u?.bonus;
  if (!b || !b.until || b.until < Date.now()) return 0;
  return Math.max(0, Number(b.extra) || 0);
}

/* 某账号某类型的每日上限；0 = 不限
   取值优先级：单人覆盖 → 等级额度（运营文档 V2）→ 全局默认
   ops.useTierLimits 设为 false 时回退到旧的全局默认口径 */
export function quotaFor(acct, kind) {
  if (!acct) return 0;
  const u = (store.list('users') || []).find(x => x.account === acct);
  if (u?.role === 'admin') return 0;
  const own = quota.userOf(acct)[kind];
  let base;
  if (own !== undefined && own !== null) base = Math.max(0, Number(own) || 0);
  else if (opsData().useTierLimits !== false) base = limitsOf(acct)[kind];
  else base = quota.get(kind);
  if (base === 0) return 0;                     // 不限，奖励无意义
  return base + bonusOf(acct);
}

/* 生成前调用：超限就抛错，错误文案直接给用户看 */
export function ensureQuota(kind) {
  const acct = account();
  if (!acct || isAdmin()) return;               // 未登录 / 管理员：不拦
  const limit = quotaFor(acct, kind);
  if (!limit) return;                           // 0 = 不限
  const used = usageOf(acct)[kind] || 0;
  if (used < limit) return;
  const label = KIND_LABEL[kind] || '生成';
  const err = new Error(`今天的${label}次数已经用完（${used}/${limit} 次），明天 0 点自动重置。需要更多次数请联系管理员开通。`);
  err.quotaExceeded = true;
  err.quota = { kind, used, limit };
  throw err;
}

/* 生成成功后调用：计一次 */
export function addUsage(kind, n = 1) {
  const acct = account();
  if (!acct) return;
  const us = usageStore();
  const k = keyOf(acct, dayKey());
  const u = us[k] || (us[k] = { text: 0, image: 0, video: 0 });
  u[kind] = Math.max(0, Number(u[kind]) || 0) + n;
  prune();
  store.save();
  try {
    window.dispatchEvent(new CustomEvent('pavo-usage', { detail: { kind, used: u[kind], limit: quotaFor(acct, kind) } }));
  } catch { /* ignore */ }
}

/* 当前账号今日概览（给界面显示「今日 3/30」用） */
export function todaySummary() {
  const acct = account();
  const used = usageOf(acct);
  const out = {};
  for (const k of QUOTA_KINDS) out[k] = { used: used[k], limit: quotaFor(acct, k) };
  return out;
}

/* 管理员：清空某账号今日用量 */
export function resetToday(acct) {
  const us = usageStore();
  delete us[keyOf(acct, dayKey())];
  store.save();
}

/* 只保留最近 KEEP_DAYS 天的明细 */
export function prune() {
  const us = usageStore();
  const cutoff = dayKey(new Date(Date.now() - KEEP_DAYS * DAY_MS));
  let changed = false;
  for (const k of Object.keys(us)) {
    const day = k.split('|')[1] || '';
    if (day && day < cutoff) { delete us[k]; changed = true; }
  }
  return changed;
}

/* 管理员：所有账号的用量总览
   返回 [{account, nick, role, approved, today, week, total, quota, bonus}] */
export function overview() {
  const users = store.list('users') || [];
  const rows = users.map(u => ({
    account: u.account,
    nick: u.nick || u.account,
    role: 'user',
    approved: !!u.approved,
    createdAt: u.createdAt || 0,
    today: usageOf(u.account),
    week: usageRange(u.account, 7),
    total: usageTotal(u.account),
    quota: {
      text: quotaFor(u.account, 'text'),
      image: quotaFor(u.account, 'image'),
      video: quotaFor(u.account, 'video')
    },
    own: quota.userOf(u.account),
    bonus: bonusOf(u.account)
  }));

  /* 管理员自己也算一行，方便看平台总调用量 */
  const adminAcct = store.state.session?.role === 'admin' ? store.state.session.account : '';
  if (adminAcct && !rows.some(r => r.account === adminAcct)) {
    rows.unshift({
      account: adminAcct,
      nick: store.state.session.nick || '管理员',
      role: 'admin',
      approved: true,
      createdAt: 0,
      today: usageOf(adminAcct),
      week: usageRange(adminAcct, 7),
      total: usageTotal(adminAcct),
      quota: { text: 0, image: 0, video: 0 },
      own: {},
      bonus: 0
    });
  }

  const totals = { text: 0, image: 0, video: 0 };
  const todayTotals = { text: 0, image: 0, video: 0 };
  for (const r of rows) {
    for (const k of QUOTA_KINDS) {
      totals[k] += r.total[k];
      todayTotals[k] += r.today[k];
    }
  }
  return {
    rows: rows.sort((a, b) => sumOf(b.today) - sumOf(a.today) || b.createdAt - a.createdAt),
    totals,
    todayTotals,
    grand: sumOf(totals),
    todayGrand: sumOf(todayTotals),
    activeToday: rows.filter(r => sumOf(r.today) > 0).length,
    pending: rows.filter(r => r.role === 'user' && !r.approved).length
  };
}

/* 最近 n 天平台每天的总调用量（画小柱状图用） */
export function dailySeries(days = 7) {
  const out = [];
  const now = new Date();
  const us = usageStore();
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth(), now.getDate() - i);
    const day = dayKey(d);
    const row = { day, label: `${d.getMonth() + 1}/${d.getDate()}`, text: 0, image: 0, video: 0, total: 0 };
    for (const k of Object.keys(us)) {
      if (!k.endsWith('|' + day)) continue;
      const u = us[k] || {};
      for (const t of QUOTA_KINDS) row[t] += Math.max(0, Number(u[t]) || 0);
    }
    row.total = sumOf(row);
    out.push(row);
  }
  return out;
}

/* 供 ops 侧复用，避免重复实现 */
export { QUOTA_KINDS, KIND_LABEL, opsData };
