/* ============================================================
 *  会员与积分（用户端）
 *  ------------------------------------------------------------
 *  展示：当前等级与当日额度 / 积分余额 / 今日消耗 / 充值档位 /
 *        消费明细 / 邀请奖励规则
 *  所有数字来自 points.js 的本地账本；充值走人工（客服开通）。
 * ============================================================ */
import { h, toast } from '../ui.js';
import { store, auth } from '../store.js';
import { fmtDate, KIND_LABEL, dayKey } from '../ops.js';
import {
  TIERS, TIER_ORDER, YEAR_PRICE, RECHARGE, INVITE_REWARD, TEXT_COST_LABEL,
  tierOf, tierInfo, balanceOf, limitsOf, logOf, todaySpentOf
} from '../points.js';
import { usageOf } from '../usage.js';
import { openSupport, copyText } from '../support.js';

const PILL = { class: 'pill', style: { background: 'var(--brand)', color: '#fff' } };

function quotaLine(used, limits, k, label) {
  const l = limits[k];
  return `${label} ${used[k]}/${l === 0 ? '不限' : l}`;
}

/* 概览：四张统计卡 */
function statsCards(account, t, tier, bal, spentToday, used, lim, wallet) {
  const c1 = h('div', { class: 'adm-stat brand' });
  c1.append(
    h('div', { class: 'adm-stat-label' }, '当前等级'),
    h('div', { class: 'adm-stat-value' }, t.name)
  );
  const sub = tier === 'free'
    ? '注册即得，每日 5 张图 + 1 段视频'
    : (wallet.tierUntil ? '到期：' + fmtDate(wallet.tierUntil) : '长期有效');
  c1.append(h('div', { class: 'adm-stat-sub' }, sub));

  const c2 = h('div', { class: 'adm-stat' });
  c2.append(
    h('div', { class: 'adm-stat-label' }, '积分余额'),
    h('div', { class: 'adm-stat-value' }, String(bal)),
    h('div', { class: 'adm-stat-sub' }, '约合 ' + (bal / 10).toFixed(1) + ' 元')
  );

  const c3 = h('div', { class: 'adm-stat' });
  c3.append(
    h('div', { class: 'adm-stat-label' }, '今日已用积分'),
    h('div', { class: 'adm-stat-value' }, String(spentToday)),
    h('div', { class: 'adm-stat-sub' }, '额度内生成不扣积分')
  );

  const c4 = h('div', { class: 'adm-stat' });
  const v = h('div', { class: 'adm-stat-value', style: { fontSize: '15px', lineHeight: '1.6' } });
  v.append(
    h('div', {}, quotaLine(used, lim, 'image', '图')),
    h('div', {}, quotaLine(used, lim, 'video', '视频')),
    h('div', {}, quotaLine(used, lim, 'text', '文本'))
  );
  c4.append(h('div', { class: 'adm-stat-label' }, '今日额度'), v);

  return h('div', { class: 'adm-stats' }, c1, c2, c3, c4);
}

/* 等级权益表 */
function tiersCard(account, tier) {
  const card = h('div', { class: 'adm-card' });
  card.append(h('div', { class: 'adm-card-title' }, '等级与权益'));
  const list = h('div', { class: 'adm-users' });

  for (const k of TIER_ORDER) {
    const x = TIERS[k];
    const on = k === tier;
    const row = h('div', {
      class: 'adm-user',
      style: on ? { borderColor: 'var(--brand)', background: 'var(--brand-soft)' } : {}
    });
    const info = h('div', { class: 'adm-user-info' });
    const name = h('div', { class: 'adm-user-name' }, x.name);
    if (on) name.append(h('span', PILL, '当前'));
    name.append(
      h('div', { class: 'adm-user-meta' },
        h('span', {}, '图 ' + (x.imgDays === 0 ? '不限' : x.imgDays + ' 张/天')),
        h('span', {}, '视频 ' + (x.vidDays === 0 ? '不限' : x.vidDays + ' 段/天')),
        h('span', {}, x.watermark ? '带水印' : '无水印'),
        h('span', {}, '分辨率上限 ' + x.maxEdge + 'px'))
    );
    info.append(name);

    const acts = h('div', { class: 'adm-user-acts' });
    if (x.price > 0) {
      acts.append(h('button', {
        class: 'node-btn',
        onclick: () => openSupport({
          account,
          title: x.name + '开通',
          note: x.name + '：' + x.price + ' 元/月，年付 ' + (YEAR_PRICE[k] || x.price * 10) + ' 元。'
        })
      }, '¥' + x.price + '/月'));
    } else {
      acts.append(h('span', { class: 'hint' }, '免费'));
    }

    row.append(h('div', { class: 'adm-user-main' }, info), acts);
    list.append(row);
  }
  card.append(list);
  return card;
}

/* 充值档位（人工开通） */
function rechargeCard(account) {
  const card = h('div', { class: 'adm-card' });
  card.append(
    h('div', { class: 'adm-card-title' }, '积分充值'),
    h('div', { class: 'hint', style: { marginBottom: '10px' } }, '目前由客服人工开通：付款后告知账号，管理员在后台加积分。')
  );
  const list = h('div', { class: 'adm-users' });
  for (const r of RECHARGE) {
    const row = h('div', { class: 'adm-user' });
    const info = h('div', { class: 'adm-user-info' });
    info.append(
      h('div', { class: 'adm-user-name' }, r.yuan + ' 元 → ' + r.points + ' 积分'),
      h('div', { class: 'adm-user-meta' },
        h('span', {}, '单价 ' + (r.yuan / r.points).toFixed(3) + ' 元/积分'),
        r.points > r.yuan * 10 ? h('span', { style: { color: 'var(--brand-2)' } }, '多送 ' + (r.points - r.yuan * 10)) : null)
    );
    const acts = h('div', { class: 'adm-user-acts' });
    acts.append(h('button', {
      class: 'node-btn',
      onclick: () => openSupport({ account, title: '充值 ' + r.yuan + ' 元' })
    }, '联系客服'));
    row.append(h('div', { class: 'adm-user-main' }, info), acts);
    list.append(row);
  }
  card.append(list);
  card.append(h('div', { class: 'adm-acts' },
    h('button', { class: 'btn-ghost', onclick: () => openSupport({ account, title: '充值 / 开通会员' }) }, '客服二维码')));
  return card;
}

/* 消费明细 */
function logCard(rows) {
  const card = h('div', { class: 'adm-card' });
  card.append(h('div', { class: 'adm-card-head' },
    h('div', { class: 'adm-card-title', style: { marginBottom: 0 } }, '消费明细'),
    h('div', { class: 'hint' }, '最近 ' + rows.length + ' 条')));

  if (!rows.length) {
    card.append(h('div', { class: 'hint' }, '还没有积分变动记录。额度内生成不产生积分消耗。'));
    return card;
  }
  const list = h('div', { class: 'adm-users' });
  for (const x of rows) {
    const row = h('div', { class: 'adm-user' });
    const info = h('div', { class: 'adm-user-info' });
    info.append(
      h('div', { class: 'adm-user-name' }, x.label || TEXT_COST_LABEL[x.kind] || KIND_LABEL[x.kind] || '积分变动'),
      h('div', { class: 'adm-user-meta' }, h('span', {}, fmtDate(x.at)))
    );
    const acts = h('div', { class: 'adm-user-acts' });
    acts.append(
      h('span', {
        style: {
          fontVariantNumeric: 'tabular-nums',
          fontWeight: '600',
          color: x.delta > 0 ? 'var(--ok)' : 'var(--txt)'
        }
      }, (x.delta > 0 ? '+' : '') + x.delta),
      h('span', { class: 'hint' }, '余额 ' + x.balanceAfter)
    );
    row.append(h('div', { class: 'adm-user-main' }, info), acts);
    list.append(row);
  }
  card.append(list);
  return card;
}

/* 邀请奖励 */
function inviteCard(account) {
  const card = h('div', { class: 'adm-card' });
  card.append(
    h('div', { class: 'adm-card-title' }, '邀请奖励'),
    h('div', { class: 'hint', style: { marginBottom: '10px' } },
      '每邀请 1 位新用户：你得 ' + INVITE_REWARD.inviter + ' 积分，对方多得 ' + INVITE_REWARD.invitee +
      ' 积分；每月最多计 ' + INVITE_REWARD.monthlyCap + ' 人。'),
    h('div', { class: 'adm-acts' },
      h('button', {
        class: 'btn-ghost',
        onclick: () => {
          copyText('我在用「林的视频工作台」做 AI 图片和视频，注册时填我的手机号 ' + account + ' 可以多拿 ' + INVITE_REWARD.invitee + ' 积分。');
          toast('邀请话术已复制', 'ok');
        }
      }, '复制邀请话术'),
      h('button', { class: 'btn-ghost', onclick: () => window.__go && window.__go('settings') }, '去账号管理'))
  );
  return card;
}

export function render(root) {
  const me = auth.user;
  if (!me) {
    root.append(h('div', { class: 'page' }, h('div', { class: 'empty' }, '请先登录')));
    return;
  }
  const account = me.account;
  const page = h('div', { class: 'page' });
  root.append(page);

  function draw() {
    page.innerHTML = '';
    const tier = tierOf(account);
    const t = tierInfo(account);
    const bal = balanceOf(account);
    const used = usageOf(account, dayKey());
    const lim = limitsOf(account);
    const spentToday = todaySpentOf(account);
    const wallet = (store.state.points || {})[account] || {};
    const rows = logOf(account, 60);

    page.append(
      h('div', { class: 'page-title' }, '会员与积分'),
      h('div', { class: 'page-sub' }, '每日额度内的生成不扣积分；额度用完自动按价目表扣积分。1 元 = 10 积分。'),
      statsCards(account, t, tier, bal, spentToday, used, lim, wallet),
      tiersCard(account, tier),
      rechargeCard(account),
      logCard(rows),
      inviteCard(account)
    );
  }

  draw();
  window.addEventListener('pavo-points', draw);
}
