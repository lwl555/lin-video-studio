/* ============================================================
 *  运营数据层：公告 · 邀请码 · 平台默认模型 · 每日配额
 *  ------------------------------------------------------------
 *  这套平台是纯本地（localStorage）架构，没有服务端账号库，
 *  所以运营数据也就存放在 store.state.ops 里：
 *    notices   [{id,title,body,level,pinned,createdAt,by}]
 *    invites   [{id,code,note,extra,days,createdAt,usedBy,usedAt}]
 *    defaults  {text|image|video: {model, baseUrl, apiKey}}
 *    quota     {text,image,video}     单位「次/天」，0 = 不限
 *    userQuota {account: {text,image,video}}   单人覆盖
 *    reads     {account: lastReadAt}
 *  同一浏览器下多个账号共用这份数据，所以管理员在自己的浏览器里
 *  发布公告 / 设配额 / 看用量，切换到别的账号登录时立刻生效。
 * ============================================================ */
import { store, uid } from './store.js';

export const QUOTA_KINDS = ['text', 'image', 'video'];
export const KIND_LABEL = { text: '文本', image: '图像', video: '视频' };

const DAY = 86400000;

/* 取（必要时补齐）运营数据对象。返回的是活引用，直接改完 store.save() 即可 */
export function opsData() {
  const s = store.state;
  let created = false;
  if (!s.ops || typeof s.ops !== 'object') { s.ops = {}; created = true; }
  const o = s.ops;
  if (!Array.isArray(o.notices)) { o.notices = []; created = true; }
  if (!Array.isArray(o.invites)) { o.invites = []; created = true; }
  if (!o.defaults || typeof o.defaults !== 'object') { o.defaults = {}; created = true; }
  if (!o.quota || typeof o.quota !== 'object') { o.quota = { text: 0, image: 0, video: 0 }; created = true; }
  if (!o.userQuota || typeof o.userQuota !== 'object') { o.userQuota = {}; created = true; }
  if (!o.reads || typeof o.reads !== 'object') { o.reads = {}; created = true; }
  if (!Array.isArray(o.dismissed)) { o.dismissed = []; created = true; }
  if (created) store.save();
  return o;
}

/* ---------------- 公告 ---------------- */
export const notices = {
  list() {
    return opsData().notices.slice().sort((a, b) =>
      (b.pinned ? 1 : 0) - (a.pinned ? 1 : 0) || (b.createdAt || 0) - (a.createdAt || 0));
  },
  add({ title, body, level = 'info', pinned = false, by = '' }) {
    const n = {
      id: uid('nt'),
      title: String(title || '').trim(),
      body: String(body || '').trim(),
      level: ['info', 'ok', 'warn'].includes(level) ? level : 'info',
      pinned: !!pinned,
      createdAt: Date.now(),
      by
    };
    opsData().notices.unshift(n);
    store.save();
    return n;
  },
  update(id, patch) {
    const n = opsData().notices.find(x => x.id === id);
    if (n) { Object.assign(n, patch); store.save(); }
    return n;
  },
  remove(id) {
    const o = opsData();
    o.notices = o.notices.filter(x => x.id !== id);
    store.save();
  },
  unread(account) {
    if (!account) return 0;
    const since = opsData().reads[account] || 0;
    return opsData().notices.filter(n => (n.createdAt || 0) > since).length;
  },
  markRead(account) {
    if (!account) return;
    opsData().reads[account] = Date.now();
    store.save();
  },
  /* 首页横幅用：取最新一条置顶公告（没有置顶则取最新一条） */
  banner() {
    const l = notices.list();
    return l.find(n => n.pinned) || l[0] || null;
  }
};

/* ---------------- 邀请码 ---------------- */
function makeCode() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';   // 去掉易混淆的 I/O/0/1
  let s = '';
  for (let i = 0; i < 6; i++) s += chars[Math.floor(Math.random() * chars.length)];
  return `LIN-${s}`;
}

export const invites = {
  list() {
    return opsData().invites.slice().sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
  },
  /* extra：激活后每天额外增加多少次额度（三类通用）；days：奖励有效天数 */
  create({ note = '', extra = 20, days = 30 } = {}) {
    const o = opsData();
    let code = makeCode();
    while (o.invites.some(x => x.code === code)) code = makeCode();
    const it = {
      id: uid('iv'),
      code,
      note: String(note || '').trim(),
      extra: Math.max(0, Math.round(Number(extra) || 0)),
      days: Math.max(1, Math.round(Number(days) || 30)),
      createdAt: Date.now(),
      usedBy: '',
      usedAt: 0
    };
    o.invites.unshift(it);
    store.save();
    return it;
  },
  find(code) {
    const c = String(code || '').trim().toUpperCase();
    return opsData().invites.find(x => x.code.toUpperCase() === c) || null;
  },
  remove(id) {
    const o = opsData();
    o.invites = o.invites.filter(x => x.id !== id);
    store.save();
  },
  /* 注册时核销：标记已用，并把奖励额度挂到该用户身上 */
  consume(code, account) {
    const it = invites.find(code);
    if (!it) return { ok: false, msg: '邀请码不存在，请核对后重试' };
    if (it.usedBy) return { ok: false, msg: `这个邀请码已被使用（${it.usedBy}）` };
    it.usedBy = account;
    it.usedAt = Date.now();
    store.save();
    return { ok: true, invite: it };
  },
  stats() {
    const l = invites.list();
    return {
      total: l.length,
      used: l.filter(x => x.usedBy).length,
      available: l.filter(x => !x.usedBy).length
    };
  }
};

/* ---------------- 平台默认模型 ---------------- */
/* 只存「覆盖项」：模型名为空就用内置默认，Base URL / Key 为空就沿用内置通道 */
export const defaultModels = {
  get(type) {
    const d = opsData().defaults[type] || {};
    return { model: d.model || '', baseUrl: d.baseUrl || '', apiKey: d.apiKey || '' };
  },
  set(type, patch) {
    const o = opsData();
    o.defaults[type] = { ...(o.defaults[type] || {}), ...patch };
    store.save();
  },
  clear(type) {
    const o = opsData();
    delete o.defaults[type];
    store.save();
  },
  isCustom(type) {
    const d = defaultModels.get(type);
    return !!(d.model || d.baseUrl || d.apiKey);
  }
};

/* ---------------- 每日配额 ---------------- */
export const quota = {
  /* 全局兜底值（0 = 不限） */
  get(kind) {
    const q = opsData().quota || {};
    return Math.max(0, Math.round(Number(q[kind]) || 0));
  },
  set(kind, n) {
    const o = opsData();
    o.quota[kind] = Math.max(0, Math.round(Number(n) || 0));
    store.save();
  },
  /* 单账号覆盖：n 传 null / '' 表示恢复跟随全局 */
  setUser(account, kind, n) {
    const o = opsData();
    if (n === null || n === undefined || n === '') {
      if (o.userQuota[account]) {
        delete o.userQuota[account][kind];
        if (!Object.keys(o.userQuota[account]).length) delete o.userQuota[account];
      }
    } else {
      (o.userQuota[account] = o.userQuota[account] || {})[kind] = Math.max(0, Math.round(Number(n) || 0));
    }
    store.save();
  },
  userOf(account) {
    return opsData().userQuota[account] || {};
  }
};

/* ---------------- 时间工具 ---------------- */
export const pad2 = n => String(n).padStart(2, '0');
export const dayKey = (d = new Date()) => `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
export const fmtDate = ts => {
  const d = new Date(ts || 0);
  return `${d.getMonth() + 1}月${d.getDate()}日 ${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
};
export const DAY_MS = DAY;
