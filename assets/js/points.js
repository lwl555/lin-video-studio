/* ============================================================
 *  积分 · 会员等级 · 扣费规则（按《运营文档 V2》落地）
 *  ------------------------------------------------------------
 *  规则摘要：
 *    · 1 元 = 10 积分
 *    · 四个等级：体验 / 普通 19 / 高级 39 / 团队 99
 *    · 每日额度内不扣积分；额度用完自动转积分扣费；余额不足则拦截
 *    · 生成成功才扣（失败天然不扣）＝文档里的「失败自动返还」
 *    · 图片按分辨率计价，图生图 +50%
 *    · 视频按秒计价，首尾帧 +20%，多参考图 +30%
 *    · 文本：AI 优化 1 / 剧情脚本 5 / 分镜 10
 *  数据落在 store.state.points[account] 与 store.state.pointsLog[]
 *  注：纯前端架构，这套账只用于「内部记账 + 人工收费」，
 *      真要对外收钱必须把账户迁到云端（见运营文档第 9 节的风险）。
 * ============================================================ */
import { store, uid } from './store.js';

const DAY = 86400000;
const LOG_KEEP = 800;                      /* 明细最多留 800 条，避免 localStorage 长胖 */

/* ---------- 等级表：日常额度 0 表示不限 ---------- */
export const TIERS = {
  free: { key: 'free', name: '体验用户', price: 0, imgDays: 5, vidDays: 1, txtDays: 20, maxEdge: 1024, watermark: true, priority: 0 },
  basic: { key: 'basic', name: '普通会员', price: 19, imgDays: 30, vidDays: 10, txtDays: 200, maxEdge: 2048, watermark: false, priority: 1 },
  pro: { key: 'pro', name: '高级会员', price: 39, imgDays: 0, vidDays: 50, txtDays: 0, maxEdge: 4096, watermark: false, priority: 2 },
  team: { key: 'team', name: '团队版', price: 99, imgDays: 0, vidDays: 200, txtDays: 0, maxEdge: 4096, watermark: false, priority: 3 }
};
export const TIER_ORDER = ['free', 'basic', 'pro', 'team'];

/* 年付价（文档 4.1） */
export const YEAR_PRICE = { basic: 199, pro: 399, team: 999 };

/* 充值档位（文档 4.2）：1 元 = 10 积分 */
export const RECHARGE = [
  { yuan: 10, points: 100 },
  { yuan: 30, points: 330 },
  { yuan: 50, points: 600 },
  { yuan: 100, points: 1250 }
];

/* 邀请裂变（文档 6.2） */
export const INVITE_REWARD = { inviter: 20, invitee: 30, monthlyCap: 20 };

/* 文本类扣费（文档 5.3） */
export const TEXT_COST = { optimize: 1, script: 5, storyboard: 10 };
export const TEXT_COST_LABEL = { optimize: 'AI 优化提示词', script: '剧情脚本生成', storyboard: '分镜故事板' };

/* ---------- 底层存储 ---------- */
const acct = () => store.state.session?.account || '';
const isAdmin = () => store.state.session?.role === 'admin';

function bank() {
  const s = store.state;
  if (!s.points || typeof s.points !== 'object' || Array.isArray(s.points)) s.points = {};
  return s.points;
}
function logs() {
  const s = store.state;
  if (!Array.isArray(s.pointsLog)) s.pointsLog = [];
  return s.pointsLog;
}

/* 取钱包（必要时创建）。返回活引用 */
export function walletOf(account) {
  if (!account) return { balance: 0, tier: 'free', tierUntil: 0, spent: 0, createdAt: 0 };
  const b = bank();
  if (!b[account] || typeof b[account] !== 'object') {
    b[account] = { balance: 0, tier: 'free', tierUntil: 0, spent: 0, createdAt: Date.now() };
    store.save();
  }
  const w = b[account];
  w.balance = Math.round(Number(w.balance) || 0);
  return w;
}

export function tierOf(account = acct()) {
  if (!account) return 'free';
  if (isAdmin() && account === store.state.session?.account) return 'team';
  const w = walletOf(account);
  const t = TIERS[w.tier] ? w.tier : 'free';
  if (t !== 'free' && w.tierUntil && w.tierUntil < Date.now()) {
    w.tier = 'free';                 /* 会员到期自动回落 */
    w.tierUntil = 0;
    store.save();
    return 'free';
  }
  return t;
}

export function tierInfo(account = acct()) { return TIERS[tierOf(account)]; }

export function balanceOf(account = acct()) { return walletOf(account).balance; }

/* 每日额度：0 = 不限 */
export function limitsOf(account = acct()) {
  const t = tierInfo(account);
  return { image: t.imgDays, video: t.vidDays, text: t.txtDays };
}

/* ---------- 变动 ---------- */
export function grant(account, n, reason = '') {
  if (!account || !n) return balanceOf(account);
  const w = walletOf(account);
  w.balance += Math.round(Number(n) || 0);
  const why = reason || '增加积分';
  pushLog({
    account, kind: 'grant', reason: why, label: why,
    delta: Math.round(Number(n) || 0), cost: 0, balanceAfter: w.balance
  });
  store.save();
  emit();
  return w.balance;
}

export function setTier(account, tier, days = 30) {
  if (!account) return;
  const t = TIERS[tier] ? tier : 'free';
  const w = walletOf(account);
  w.tier = t;
  w.tierUntil = t === 'free' ? 0 : Date.now() + Math.max(1, Math.round(Number(days) || 30)) * DAY;
  w.tierSince = Date.now();
  store.save();
  emit();
  return w;
}

function pushLog(entry) {
  const l = logs();
  l.unshift({ id: uid('px'), at: Date.now(), ...entry });
  if (l.length > LOG_KEEP) l.length = LOG_KEEP;
}

function emit() {
  try { window.dispatchEvent(new CustomEvent('pavo-points', { detail: { balance: balanceOf(acct()) } })); } catch { /* ignore */ }
}

/* ---------- 计价（文档 5.1 / 5.2 / 5.3） ---------- */
export function quoteImage(size = '1024x1024', { withRef = false, n = 1 } = {}) {
  const [w, h] = String(size).split('x').map(x => Number(x) || 0);
  const edge = Math.max(w || 1024, h || 1024);
  let cost = edge >= 2048 ? 5 : edge >= 1500 ? 3 : 2;
  if (withRef) cost = Math.ceil(cost * 1.5);          /* 图生图 +50% */
  return cost * Math.max(1, Math.round(n) || 1);
}

export function quoteVideo(seconds = 5, { resolution = '768P', keyframe = false, ref = false } = {}) {
  const per = /480/i.test(resolution) ? 3 : /2k|1080/i.test(resolution) ? 15 : 8;
  let cost = per * Math.max(1, Math.round(Number(seconds) || 5));
  if (keyframe) cost = Math.ceil(cost * 1.2);         /* 首尾帧 +20% */
  if (ref) cost = Math.ceil(cost * 1.3);              /* 多参考图 +30% */
  return cost;
}

export function quoteText(kind = 'optimize') {
  return TEXT_COST[kind] ?? TEXT_COST.optimize;
}

/* ---------- 计费闸门 ----------
   返回 { viaQuota, cost, balance }：额度内 → viaQuota=true 不扣积分；
   额度外 → 要求余额 ≥ cost，否则抛错误（按钮会因此置灰/提示充值） */
export function assertAffordable(kind, cost) {
  const account = acct();
  const zero = { viaQuota: true, cost: 0, balance: 0 };
  if (!account) return zero;
  if (isAdmin()) return zero;                          /* 管理员不计量不扣费 */
  const balance = balanceOf(account);
  const limits = limitsOf(account);
  const limit = limits[kind];
  if (limit === 0) return { viaQuota: true, cost: 0, balance };   /* 该等级不限量 */
  const used = (store.state.usage || {})[`${account}|${todayKey()}`]?.[kind] || 0;
  if (used < limit) return { viaQuota: true, cost: 0, balance };
  if (balance >= cost) return { viaQuota: false, cost, balance };
  const t = tierInfo(account);
  const err = new Error(`今日${t.name}额度已用完（${used}/${limit}），积分余额 ${balance}，本次需要 ${cost} 积分。去「会员与积分」充值后即可继续。`);
  err.needPoints = cost;
  err.balance = balance;
  throw err;
}

/* 生成成功后结算：额度内不扣，额度外扣积分并记明细 */
export function settle(kind, bill, label = '') {
  const account = acct();
  if (!account || isAdmin() || !bill || bill.viaQuota || !bill.cost) return null;
  const w = walletOf(account);
  const cost = Math.max(0, Math.round(bill.cost));
  if (!cost) return null;
  w.balance -= cost;
  w.spent = Math.round(Number(w.spent) || 0) + cost;
  pushLog({ account, kind, label: label || KIND_TEXT[kind] || kind, delta: -cost, cost, balanceAfter: w.balance });
  store.save();
  emit();
  return w.balance;
}

const KIND_TEXT = { image: '图片生成', video: '视频生成', text: '文本生成' };

/* ---------- 查询 ---------- */
export function logOf(account = acct(), limit = 50) {
  return logs().filter(x => x.account === account).slice(0, Math.max(1, limit));
}

export function todaySpentOf(account = acct()) {
  const day = todayKey();
  return logs().reduce((a, x) => {
    if (x.account !== account) return a;
    const d = new Date(x.at || 0);
    const k = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    return k === day ? a + Math.max(0, x.cost || 0) : a;
  }, 0);
}

function todayKey() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/* 后台：所有账号的钱包行 */
export function adminRows() {
  return (store.list('users') || []).map(u => {
    const w = walletOf(u.account);
    return {
      account: u.account,
      nick: u.nick || u.account,
      approved: !!u.approved,
      createdAt: u.createdAt || 0,
      tier: tierOf(u.account),
      tierName: TIERS[tierOf(u.account)].name,
      tierUntil: w.tierUntil || 0,
      balance: w.balance,
      spent: w.spent || 0,
      todaySpent: todaySpentOf(u.account)
    };
  }).sort((a, b) => b.spent - a.spent || b.balance - a.balance);
}

/* 后台：成本与预警（文档 7.3） */
export function costBoard() {
  const rows = adminRows();
  const day = todayKey();
  let todayPoints = 0, monthPoints = 0;
  const perAcct = {};
  const now = new Date();
  for (const x of logs()) {
    const cost = Math.max(0, x.cost || 0);
    if (!cost) continue;
    const d = new Date(x.at || 0);
    const k = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    if (k === day) { todayPoints += cost; perAcct[x.account] = (perAcct[x.account] || 0) + cost; }
    if (d.getFullYear() === now.getFullYear() && d.getMonth() === now.getMonth()) monthPoints += cost;
  }
  const worst = Object.entries(perAcct).sort((a, b) => b[1] - a[1])[0] || ['', 0];

  /* Agnes 免费额度占用（文档 2.3：4000 图/天、500 秒视频/天） */
  const us = store.state.usage || {};
  let imgToday = 0, vidToday = 0;
  for (const k of Object.keys(us)) {
    if (!k.endsWith('|' + day)) continue;
    imgToday += Math.max(0, Number(us[k].image) || 0);
    vidToday += Math.max(0, Number(us[k].video) || 0);
  }
  const agnes = {
    imgToday, imgCap: 4000, imgPct: Math.round(imgToday / 40),
    vidToday, vidCap: Math.round(500 / 5), vidPct: Math.round(vidToday / (500 / 5) * 100)
  };

  const alerts = [];
  if (agnes.imgPct >= 80) alerts.push({ level: 'warn', text: `今日图片已用 ${imgToday}/${agnes.imgCap} 张（${agnes.imgPct}%），接近 Agnes 免费额度，建议分流到备用模型` });
  if (agnes.vidPct >= 80) alerts.push({ level: 'warn', text: `今日视频已用约 ${vidToday * 5}/${500} 秒（${agnes.vidPct}%），接近 Agnes 免费额度` });
  if (todayPoints > 1000) alerts.push({ level: 'warn', text: `今日积分消耗 ${todayPoints}（约 ${(todayPoints / 10).toFixed(0)} 元），超过 100 元预警线` });
  if (worst[1] > 200) alerts.push({ level: 'warn', text: `单用户 ${worst[0]} 今日消耗 ${worst[1]} 积分（约 ${(worst[1] / 10).toFixed(0)} 元），超过 20 元风控线` });
  if (!alerts.length) alerts.push({ level: 'ok', text: '暂无预警：免费额度与单用户消耗都在安全线内' });

  return {
    rows,
    todayPoints, monthPoints,
    todayYuan: (todayPoints / 10).toFixed(1),
    monthYuan: (monthPoints / 10).toFixed(1),
    issuePoints: rows.reduce((a, r) => a + Math.max(0, r.balance), 0),
    agnes, alerts
  };
}

/* ---------- 注册发放（由 store.auth.register 调用） ---------- */
export function openAccount(account, { invitedBy = '', viaInvite = false } = {}) {
  if (!account) return;
  walletOf(account);
  if (viaInvite) grant(account, INVITE_REWARD.invitee, '邀请码奖励（被邀请人）');
  if (invitedBy) rewardInviter(invitedBy, account);
}

/* 邀请人奖励：每月最多 N 人（文档 6.2 防刷单） */
function rewardInviter(invitedBy, newAccount) {
  if (!invitedBy) return;
  const l = logs();
  const monthStart = (() => {
    const d = new Date();
    return new Date(d.getFullYear(), d.getMonth(), 1).getTime();
  })();
  const count = l.filter(x => x.account === invitedBy && x.kind === 'invite' && (x.at || 0) >= monthStart).length;
  if (count >= INVITE_REWARD.monthlyCap) {
    pushLog({ account: invitedBy, kind: 'invite-capped', label: '本月邀请奖励已达上限', delta: 0, cost: 0, balanceAfter: balanceOf(invitedBy) });
    store.save();
    return;
  }
  const w = walletOf(invitedBy);
  w.balance += INVITE_REWARD.inviter;
  pushLog({ account: invitedBy, kind: 'invite', label: `邀请 ${newAccount} 注册`, reason: `邀请 ${newAccount}`, delta: INVITE_REWARD.inviter, cost: 0, balanceAfter: w.balance });
  store.save();
  emit();
}
