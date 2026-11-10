/* ============ 本地存储 & 全局状态 ============ */
import { LS_LIMIT, MAX_INLINE_MEDIA, compressImage, shrinkUntilUnder, estimateBytes } from './storage.js';

const KEY = 'pavo.v1';

/* 内置管理员（唯一授权账号） */
export const ADMIN = {
  account: '18882632073',
  nick: '林',
  passHash: '27014b785f0a4afa2012ccfe0c4062d9ba6a12956dcc94ce10b8ad489fbcc70e', // 110110nm
  role: 'admin'
};

const DEFAULT = {
  users: [],                 // 注册用户（需管理员授权才能登录，除内置管理员）
  session: null,             // {account, nick, role}
  providers: [],             // 用户手动接入的模型
  projects: [],              // 画布项目
  assets: [],                // 资产库
  works: [],                 // 作品
  series: [],                // 短剧
  points: {},                // 积分钱包：{account: {balance, tier, tierUntil, spent}}
  pointsLog: [],             // 积分变动明细（含邀请/充值/消费）
  proxy: {                   // Supabase 后端
    url: '',                 // 例 https://xxx.functions.supabase.co/pavo-proxy
    anon: '',                // 可选：匿名 key
    enabled: false
  },
  settings: { style: '', ratio: '16:9', duration: 5, autoCleanAt: 0.85 }  // 存储超此比例自动清理旧素材（0=关闭）
};

let S = load();

function load() {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return structuredClone(DEFAULT);
    return Object.assign(structuredClone(DEFAULT), JSON.parse(raw));
  } catch { return structuredClone(DEFAULT); }
}
function notifyClean(count, freed) {
  try {
    window.dispatchEvent(new CustomEvent('pavo-autoclean', { detail: { count, freed } }));
  } catch { /* ignore */ }
}

function persist() {
  const hardCap = Math.round(LS_LIMIT * 0.97);          // 写入失败线
  const at = Number(S.settings?.autoCleanAt ?? 0.85);   // 预防线（0 = 关闭自动清理）

  /* 预防：估算体积超过阈值时，先自动清理旧素材再写 */
  if (at > 0 && estimateBytes(S) > hardCap * at) {
    const n = shrinkUntilUnder(S, Math.round(hardCap * at));
    if (n > 0) {
      const freed = estimateBytes(S);
      notifyClean(n, freed);
    }
  }

  try {
    localStorage.setItem(KEY, JSON.stringify(S));
  } catch (e) {
    /* 兜底：已经写失败了，强清到 60% 再试一次 */
    try {
      const n = shrinkUntilUnder(S, Math.round(LS_LIMIT * 0.6));
      if (n > 0) {
        localStorage.setItem(KEY, JSON.stringify(S));
        notifyClean(n, estimateBytes(S));
        return;
      }
      /* 一个都没有可清的了：找出最大单块再删 */
      console.warn('存储失败：没有可自动清理的素材', e);
    } catch (e2) {
      console.warn('存储失败（清理后仍失败）', e2);
    }
  }
}

export const store = {
  get state() { return S; },
  save() { persist(); },
  set(patch) { Object.assign(S, patch); persist(); },
  reset() { S = structuredClone(DEFAULT); persist(); },

  /* ---- 集合操作 ---- */
  list(k) { return S[k] || []; },
  add(k, item) { S[k].unshift(item); persist(); return item; },
  update(k, id, patch) {
    const i = S[k].findIndex(x => x.id === id);
    if (i >= 0) { S[k][i] = { ...S[k][i], ...patch }; persist(); }
    return S[k][i];
  },
  remove(k, id) { S[k] = S[k].filter(x => x.id !== id); persist(); },
  find(k, id) { return S[k].find(x => x.id === id); }
};

/* ---- 工具 ---- */
export const uid = (p = 'id') => p + '_' + Math.random().toString(36).slice(2, 9) + Date.now().toString(36).slice(-4);

export async function sha256(str) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(str));
  return [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, '0')).join('');
}

/* ---- 认证 ---- */
const INVITE_DAY = 86400000;

/* 邀请码直接读本地运营数据，避免 store ↔ ops 互相 import 成环 */
function findInvite(code) {
  const list = (S.ops && S.ops.invites) || [];
  const c = String(code || '').trim().toUpperCase();
  if (!c) return null;
  return list.find(x => String(x.code || '').toUpperCase() === c) || null;
}

export const auth = {
  async login(account, pass) {
    const hash = await sha256(pass);
    if (account === ADMIN.account) {
      if (hash !== ADMIN.passHash) return { ok: false, code: 'BAD_PASS', msg: '密码不太对，再核对一下' };
      const s = { account: ADMIN.account, nick: ADMIN.nick, role: 'admin' };
      store.set({ session: s });
      return { ok: true, user: s };
    }
    const u = S.users.find(x => x.account === account);
    if (!u) return { ok: false, code: 'NO_USER', msg: '这个手机号还没有开通账号' };
    if (u.passHash !== hash) return { ok: false, code: 'BAD_PASS', msg: '密码不太对，再核对一下' };
    if (!u.approved) return { ok: false, code: 'PENDING', msg: '账号还在等管理员授权' };
    const s = { account: u.account, nick: u.nick, role: u.role === 'admin' ? 'admin' : 'user' };
    store.set({ session: s });
    return { ok: true, user: s };
  },

  /* inviteCode 可选：带了有效邀请码 → 直接开通，并发放奖励额度 */
  async register(account, nick, pass, inviteCode = '') {
    if (S.users.some(x => x.account === account)) {
      return { ok: false, code: 'EXISTS', msg: '这个手机号已经申请过了，直接登录或找管理员' };
    }
    const u = {
      account,
      nick,
      passHash: await sha256(pass),
      approved: false,
      createdAt: Date.now(),
      invitedBy: '',
      inviteCode: ''
    };

    const code = String(inviteCode || '').trim();
    if (code) {
      const it = findInvite(code);
      if (!it) return { ok: false, code: 'BAD_INVITE', msg: '邀请码不对，检查一下大小写和字母' };
      if (it.usedBy) return { ok: false, code: 'USED_INVITE', msg: `这个邀请码已经被用掉了（${it.usedBy}）` };
      it.usedBy = account;
      it.usedAt = Date.now();
      u.approved = true;
      u.invitedBy = ADMIN.account;
      u.inviteCode = it.code;
      if (Number(it.extra) > 0) {
        u.bonus = { extra: Math.round(Number(it.extra)), until: Date.now() + Math.max(1, Number(it.days) || 30) * INVITE_DAY };
      }
    }

    S.users.push(u); persist();

    /* 开户 + 邀请奖励（动态 import 避免 store ↔ points 循环依赖） */
    try {
      const { openAccount } = await import('./points.js');
      openAccount(u.account, { invitedBy: u.invitedBy || '', viaInvite: !!u.inviteCode });
    } catch (e) { console.warn('积分开户失败', e); }

    return u.approved
      ? { ok: true, invited: true, bonus: u.bonus || null, msg: '邀请码已生效，账号直接开通了' }
      : { ok: true, invited: false, msg: '申请已提交，管理员授权后即可登录' };
  },

  logout() { store.set({ session: null }); },
  get user() { return S.session; },
  get isAdmin() { return S.session?.role === 'admin'; }
};

/* ---- 媒体存储：优先 Supabase Storage，否则本地 base64（图片自动压缩） ---- */
export async function saveMedia(file) {
  const p = S.proxy;
  if (p.enabled && p.url && p.anon) {
    try {
      const ext = (file.name.split('.').pop() || 'png').toLowerCase();
      const path = `u/${Date.now()}_${Math.random().toString(36).slice(2, 7)}.${ext}`;
      const r = await fetch(`${p.url.replace(/\/$/, '')}/storage?path=${encodeURIComponent(path)}`, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${p.anon}`, 'Content-Type': file.type || 'application/octet-stream' },
        body: file
      });
      const j = await r.json();
      if (j?.url) return j.url;
    } catch (e) { console.warn('远程存储失败，回退本地', e); }
  }

  const isImg = (file.type || '').startsWith('image/');
  if (!isImg && file.size > MAX_INLINE_MEDIA) {
    throw new Error(`文件 ${(file.size / 1048576).toFixed(1)} MB 太大，本地存不下（视频/音频上限 ${MAX_INLINE_MEDIA / 1048576} MB）。部署后端代理后可存云端。`);
  }
  let dataUrl = await fileToDataURL(file);
  if (isImg) dataUrl = await compressImage(dataUrl);
  return dataUrl;
}

export function fileToDataURL(file) {
  return new Promise((res, rej) => {
    const fr = new FileReader();
    fr.onload = () => res(fr.result);
    fr.onerror = rej;
    fr.readAsDataURL(file);
  });
}
