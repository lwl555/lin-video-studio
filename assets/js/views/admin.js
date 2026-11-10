/* ============================================================
 *  管理后台（仅管理员可见）
 *  ------------------------------------------------------------
 *  6 个分区：概览 / 用户与额度 / 用量统计 / 公告 / 邀请奖励 / 默认模型
 *  数据全部读写本地 store.state.ops 与 usage，切换账号登录立刻生效。
 * ============================================================ */
import { h, $, toast, modal, confirm, download } from '../ui.js';
import { icon } from '../icons.js';
import { store, auth, ADMIN } from '../store.js';
import { notices, invites, defaultModels, quota, fmtDate, KIND_LABEL, QUOTA_KINDS, dayKey } from '../ops.js';
import { overview, dailySeries, resetToday } from '../usage.js';
import { openSupport, copyText, inviteMessage } from '../support.js';
import { backendProvider } from '../backend.js';
import { TIERS, TIER_ORDER, RECHARGE, adminRows, costBoard, grant, setTier } from '../points.js';

const TABS = [
  { k: 'overview', label: '概览' },
  { k: 'users', label: '用户与额度' },
  { k: 'points', label: '积分与成本' },
  { k: 'usage', label: '用量统计' },
  { k: 'notice', label: '公告' },
  { k: 'invite', label: '邀请奖励' },
  { k: 'models', label: '默认模型' }
];

const KIND_ICON = { text: 'agent', image: 'image', video: 'video' };
const sum = o => QUOTA_KINDS.reduce((a, k) => a + (o?.[k] || 0), 0);
const fmtDay = () => { const d = new Date(); return `${d.getMonth() + 1}月${d.getDate()}日`; };

export function render(root) {
  if (!auth.isAdmin) {
    root.append(h('div', { class: 'page' },
      h('div', { class: 'empty' },
        h('div', { class: 'empty-icon', html: icon('warn', 40) }),
        '这个页面只有管理员能打开')));
    return;
  }

  let tab = 'overview';
  let editingNoticeId = '';
  const page = h('div', { class: 'page admin-page' });
  root.append(page);

  function draw() {
    page.innerHTML = '';
    page.append(
      h('div', { class: 'adm-head' },
        h('div', {},
          h('div', { class: 'page-title' }, '管理后台'),
          h('div', { class: 'page-sub' }, `管理员 ${ADMIN.account} · 公告、邀请、默认模型、每日额度与用量都在这里`)),
        h('div', { class: 'adm-head-acts' },
          h('button', { class: 'btn-ghost', onclick: () => openSupport({ account: ADMIN.account, title: '客服二维码' }) }, '客服二维码'))),
      h('div', { class: 'adm-tabs' },
        ...TABS.map(t => h('button', {
          class: 'adm-tab' + (tab === t.k ? ' active' : ''),
          onclick: () => { tab = t.k; draw(); }
        }, t.label))),
      h('div', { class: 'adm-body' }, section())
    );
  }

  function section() {
    switch (tab) {
      case 'users': return usersSection();
      case 'points': return pointsSection();
      case 'usage': return usageSection();
      case 'notice': return noticeSection();
      case 'invite': return inviteSection();
      case 'models': return modelsSection();
      default: return overviewSection();
    }
  }

  /* ---------------- 积分与成本（运营文档 V2） ---------------- */
  function pointsSection() {
    const b = costBoard();
    const rows = b.rows;

    /* 预警 */
    const alertList = h('div', { class: 'adm-users' });
    for (const a of b.alerts) {
      const info = h('div', { class: 'adm-user-info' });
      info.append(
        h('div', { class: 'adm-user-name' }, a.level === 'warn' ? '⚠ 预警' : '✓ 正常'),
        h('div', { class: 'adm-user-meta' }, h('span', {}, a.text))
      );
      alertList.append(h('div', { class: 'adm-user' }, h('div', { class: 'adm-user-main' }, info)));
    }
    const alertCard = h('div', { class: 'adm-card' },
      h('div', { class: 'adm-card-title' }, '成本预警'), alertList);

    /* 账号与积分 */
    const userList = h('div', { class: 'adm-users' });
    if (!rows.length) userList.append(h('div', { class: 'hint' }, '还没有注册用户。'));
    for (const r of rows) {
      const info = h('div', { class: 'adm-user-info' });
      const nm = h('div', { class: 'adm-user-name' }, r.nick);
      nm.append(h('span', {
        class: 'pill',
        style: {
          background: r.tier === 'free' ? 'var(--bg)' : 'var(--brand-soft)',
          color: r.tier === 'free' ? 'var(--txt-3)' : 'var(--brand-2)'
        }
      }, r.tierName));
      if (!r.approved) nm.append(h('span', { class: 'pill', style: { background: '#FDECEC', color: '#c0392b' } }, '待授权'));
      info.append(nm);
      const meta = h('div', { class: 'adm-user-meta' });
      meta.append(
        h('span', {}, '余额 ' + r.balance + ' 积分'),
        h('span', {}, '今日消耗 ' + r.todaySpent),
        h('span', {}, '累计消耗 ' + r.spent)
      );
      if (r.tierUntil) meta.append(h('span', {}, '到期 ' + fmtDate(r.tierUntil)));
      info.append(meta);

      const acts = h('div', { class: 'adm-user-acts' });
      for (const n of [10, 50, 100]) {
        acts.append(h('button', {
          class: 'node-btn sm',
          onclick: () => {
            grant(r.account, n, '管理员手动充值');
            toast('+' + n + ' 积分 → ' + r.nick, 'ok');
            draw();
          }
        }, '+' + n));
      }
      acts.append(h('button', {
        class: 'node-btn sm',
        onclick: () => { setTier(r.account, 'basic', 30); toast(r.nick + ' 已开通普通会员 30 天', 'ok'); draw(); }
      }, '普通月'));
      acts.append(h('button', {
        class: 'node-btn sm',
        onclick: () => { setTier(r.account, 'pro', 30); toast(r.nick + ' 已开通高级会员 30 天', 'ok'); draw(); }
      }, '高级月'));
      acts.append(h('button', {
        class: 'node-btn sm',
        onclick: () => { setTier(r.account, 'free', 0); toast(r.nick + ' 已回落体验用户', 'ok'); draw(); }
      }, '降级'));

      userList.append(h('div', { class: 'adm-user' }, h('div', { class: 'adm-user-main' }, info), acts));
    }

    function manualRecharge() {
      const acct = prompt('给哪个账号加积分？（输手机号）');
      if (!acct) return;
      const n = Number(prompt('加多少积分？（1 元 = 10 积分）', '100') || 0);
      if (!n) return;
      grant(String(acct).trim(), n, '管理员手动充值');
      toast('已加 ' + n + ' 积分', 'ok');
      draw();
    }

    const head = h('div', { class: 'adm-card-head' },
      h('div', { class: 'adm-card-title', style: { marginBottom: 0 } }, '账号与积分'),
      h('div', { class: 'adm-acts', style: { marginTop: 0 } },
        h('button', { class: 'node-btn', onclick: manualRecharge }, '手动充值')));
    const userCard = h('div', { class: 'adm-card' }, head, userList);

    /* 价目表 */
    const priceCard = h('div', { class: 'adm-card' },
      h('div', { class: 'adm-card-title' }, '价目表（用户端自动生效）'),
      h('div', { class: 'adm-legend' },
        h('span', {}, '图片：1024 = 2 积分 / 1536 = 3 / 2048 = 5，图生图 +50%'),
        h('span', {}, '视频：480P 3/秒 · 720P 8/秒 · 2K 15/秒，首尾帧 +20%，参考图 +30%'),
        h('span', {}, '文本：AI 优化 1 / 剧情脚本 5 / 分镜 10'),
        h('span', {}, '充值：' + RECHARGE.map(x => x.yuan + ' 元 = ' + x.points + ' 积分').join(' · '))));

    return h('div', {},
      h('div', { class: 'adm-stats' },
        statCard('今日消耗积分', b.todayPoints, '约合 ' + b.todayYuan + ' 元', 'brand'),
        statCard('本月消耗积分', b.monthPoints, '约合 ' + b.monthYuan + ' 元'),
        statCard('未消费余额', b.issuePoints, '约合 ' + Math.round(b.issuePoints / 10) + ' 元（已发未用）'),
        statCard('今日出图 / 出片', b.agnes.imgToday + ' / ' + b.agnes.vidToday,
          'Agnes 额度占用 ' + b.agnes.imgPct + '% / ' + b.agnes.vidPct + '%',
          b.agnes.imgPct >= 80 ? 'warn' : '')),
      alertCard, userCard, priceCard);
  }

  function statCard(label, value, sub, tone = '') {
    return h('div', { class: 'adm-stat ' + tone },
      h('div', { class: 'adm-stat-label' }, label),
      h('div', { class: 'adm-stat-value' }, String(value)),
      sub ? h('div', { class: 'adm-stat-sub' }, sub) : null);
  }

  function overviewSection() {
    const o = overview();
    const series = dailySeries(7);
    const max = Math.max(1, ...series.map(s => s.total));
    const userCount = store.list('users').length;
    const unread = notices.unread(auth.user?.account || '');

    return h('div', {},
      h('div', { class: 'adm-stats' },
        statCard('今日调用', o.todayGrand, `活跃 ${o.activeToday} 人`, 'brand'),
        statCard('累计调用', o.grand, `文本 ${o.totals.text} · 图 ${o.totals.image} · 视频 ${o.totals.video}`),
        statCard('用户', userCount, o.pending ? `待授权 ${o.pending} 人` : '全部已授权', o.pending ? 'warn' : ''),
        statCard('公告', notices.list().length, unread ? `你有 ${unread} 条未读` : '没有未读')),

      h('div', { class: 'adm-card' },
        h('div', { class: 'adm-card-title' }, '最近 7 天平台调用'),
        series.every(s => !s.total)
          ? h('div', { class: 'adm-chart-empty' },
            '这 7 天还没有调用记录。用户生成文本 / 图片 / 视频之后，这里会出现柱状图。')
          : h('div', { class: 'adm-chart' },
            ...series.map(s => h('div', { class: 'adm-bar-wrap', title: `${s.label}：${s.total} 次` },
              h('i', {
                class: 'adm-bar',
                style: { height: Math.max(3, Math.round(s.total / max * 100)) + '%' }
              }),
              h('span', { class: 'adm-bar-label' }, s.label)))),
        h('div', { class: 'adm-legend' },
          h('span', {}, '文本'), h('span', {}, '图像'), h('span', {}, '视频'),
          h('span', { style: { marginLeft: 'auto' } }, `今日 ${sum(o.todayTotals)} 次`))),

      h('div', { class: 'adm-card' },
        h('div', { class: 'adm-card-title' }, '常用操作'),
        h('div', { class: 'adm-acts' },
          h('button', { class: 'btn-primary', onclick: () => { tab = 'notice'; draw(); } }, '发布公告'),
          h('button', { class: 'btn-ghost', onclick: () => { tab = 'invite'; draw(); } }, '生成邀请码'),
          h('button', { class: 'btn-ghost', onclick: () => { tab = 'users'; draw(); } }, '设置每日额度'),
          h('button', { class: 'btn-ghost', onclick: () => { tab = 'usage'; draw(); } }, '看用量明细')))
    );
  }

  /* ---------------- 用户与额度 ---------------- */
  function usersSection() {
    const list = store.list('users');
    const o = overview();

    /* 全局默认额度 */
    const globalRow = h('div', { class: 'adm-global' },
      h('div', { class: 'adm-global-label' },
        h('div', { class: 'adm-card-title', style: { margin: '0' } }, '默认每日额度'),
        h('div', { class: 'hint', style: { margin: '4px 0 0' } }, '对所有账号生效，0 = 不限；下面可以单独给某个人改。每天 0 点重置。')),
      ...QUOTA_KINDS.map(k => {
        const inp = h('input', {
          class: 'form-input adm-num', type: 'number', min: '0', step: '1',
          value: String(quota.get(k))
        });
        inp.addEventListener('change', () => {
          quota.set(k, inp.value);
          toast(`${KIND_LABEL[k]}每日额度：${Number(inp.value) || 0}（0 = 不限）`, 'ok');
          draw();
        });
        return h('label', { class: 'adm-num-wrap' },
          h('span', {}, KIND_LABEL[k]), inp);
      }));

    /* 单用户行 */
    const rows = o.rows.map(r => {
      const isAdminRow = r.role === 'admin';
      const statusBadge = isAdminRow
        ? h('span', { class: 'badge ok' }, '管理员')
        : h('span', { class: 'badge' + (r.approved ? ' ok' : ' warn') }, r.approved ? '已授权' : '待授权');

      const quotaInputs = isAdminRow
        ? h('div', { class: 'adm-user-quota' }, h('span', { class: 'hint', style: { margin: '0' } }, '不限'))
        : h('div', { class: 'adm-user-quota' }, ...QUOTA_KINDS.map(k => {
          const own = r.own[k];
          const inp = h('input', {
            class: 'form-input adm-num',
            type: 'number', min: '0', step: '1',
            placeholder: String(quota.get(k)),
            value: own === undefined ? '' : String(own),
            title: `${KIND_LABEL[k]}：留空=跟随默认（${quota.get(k) || '不限'}）`
          });
          inp.addEventListener('change', () => {
            quota.setUser(r.account, k, inp.value === '' ? null : inp.value);
            toast(`${r.nick} 的${KIND_LABEL[k]}额度已更新`, 'ok');
            draw();
          });
          return h('label', { class: 'adm-num-wrap' }, h('span', {}, KIND_LABEL[k]), inp);
        }));

      return h('div', { class: 'adm-user' },
        h('div', { class: 'adm-user-main' },
          h('span', { class: 'avatar' }, (r.nick || '?').slice(0, 1)),
          h('div', { class: 'adm-user-info' },
            h('div', { class: 'adm-user-name' }, r.nick, statusBadge),
            h('div', { class: 'adm-user-meta' },
              r.account,
              r.bonus ? h('span', { class: 'badge ok' }, `邀请奖励 +${r.bonus}`) : null,
              h('span', {}, `今日 ${sum(r.today)} 次`)))),
        quotaInputs,
        h('div', { class: 'adm-user-acts' },
          isAdminRow ? null : h('button', {
            class: 'node-btn' + (r.approved ? '' : ' primary'),
            onclick: async () => {
              const u = store.list('users').find(x => x.account === r.account);
              if (!u) return;
              u.approved = !u.approved; store.save();
              toast(u.approved ? `已授权 ${u.nick}` : `已撤销 ${u.nick} 的授权`, 'ok');
              draw();
            }
          }, r.approved ? '撤销授权' : '通过授权'),
          isAdminRow ? null : h('button', {
            class: 'node-btn',
            onclick: () => { resetToday(r.account); toast(`已清空 ${r.nick} 今日用量`, 'ok'); draw(); }
          }, '清空今日'),
          isAdminRow ? null : h('button', {
            class: 'node-btn',
            onclick: async () => {
              if (!await confirm(`删除账号「${r.nick}」（${r.account}）？历史用量会保留。`)) return;
              const arr = store.list('users');
              const i = arr.findIndex(x => x.account === r.account);
              if (i >= 0) { arr.splice(i, 1); store.save(); }
              toast('已删除', 'ok'); draw();
            }
          }, '删除')));
    });

    return h('div', {},
      h('div', { class: 'adm-card' }, globalRow),
      h('div', { class: 'adm-card' },
        h('div', { class: 'adm-card-title' }, `账号列表（${list.length} 个用户）`),
        h('div', { class: 'hint', style: { margin: '0 0 12px' } },
          '授权状态、每日额度都能单独调。留空表示跟随上面的默认值。'),
        rows.length ? h('div', { class: 'adm-users' }, ...rows.filter(Boolean))
          : h('div', { class: 'adm-empty' }, '还没有其他账号。让朋友在登录页点「申请授权」注册，或用邀请码注册。')),
      h('div', { class: 'adm-card' },
        h('div', { class: 'hint', style: { margin: '0' } },
          '说明：这套工作台是本地运行、数据存在本机浏览器里的。如果有人换了一台电脑，需要在那台机器上重新申请账号；用量统计也只统计本机发生过的调用。')));
  }

  /* ---------------- 用量统计 ---------------- */
  function usageSection() {
    const o = overview();
    const series = dailySeries(14);
    const max = Math.max(1, ...series.map(s => s.total));

    const head = h('div', { class: 'adm-tr adm-tr-head' },
      h('span', {}, '账号'),
      ...QUOTA_KINDS.map(k => h('span', {}, KIND_LABEL[k] + '·今日')),
      h('span', {}, '今日合计'),
      h('span', {}, '近 7 日'),
      h('span', {}, '累计'));

    const rows = o.rows.map(r => h('div', { class: 'adm-tr' },
      h('span', { class: 'adm-td-acc' },
        h('b', {}, r.nick),
        h('i', {}, r.account.slice(-4).padStart(r.account.length, '·'))),
      ...QUOTA_KINDS.map(k => h('span', {
        class: r.today[k] && r.quota[k] && r.today[k] >= r.quota[k] ? 'adm-td full' : 'adm-td'
      }, `${r.today[k]}${r.quota[k] ? '/' + r.quota[k] : ''}`)),
      h('span', { class: 'adm-td strong' }, String(sum(r.today))),
      h('span', { class: 'adm-td' }, String(sum(r.week))),
      h('span', { class: 'adm-td' }, String(sum(r.total)))));

    return h('div', {},
      h('div', { class: 'adm-stats' },
        statCard('今日总调用', o.todayGrand, fmtDay()),
        statCard('近 7 日', o.rows.reduce((a, r) => a + sum(r.week), 0), '所有账号'),
        statCard('历史累计', o.grand, '文本/图像/视频合计')),

      h('div', { class: 'adm-card' },
        h('div', { class: 'adm-card-title' }, '近 14 天趋势'),
        series.every(s => !s.total)
          ? h('div', { class: 'adm-chart-empty tall' }, '还没有调用记录，等平台开始被使用就有数据了。')
          : h('div', { class: 'adm-chart tall' },
            ...series.map(s => h('div', { class: 'adm-bar-wrap', title: `${s.label}：${s.total} 次` },
              h('i', { class: 'adm-bar', style: { height: Math.max(2, Math.round(s.total / max * 100)) + '%' } }),
              h('span', { class: 'adm-bar-label' }, s.label))))),

      h('div', { class: 'adm-card' },
        h('div', { class: 'adm-card-head' },
          h('div', { class: 'adm-card-title', style: { margin: '0' } }, '每个账号的用量'),
          h('button', { class: 'btn-ghost', onclick: () => exportCsv(o) }, '导出 CSV')),
        h('div', { class: 'adm-table' },
          head, ...rows,
          h('div', { class: 'adm-tr adm-tr-total' },
            h('span', {}, '合计'),
            ...QUOTA_KINDS.map(k => h('span', {}, String(o.todayTotals[k]))),
            h('span', {}, String(o.todayGrand)),
            h('span', {}, String(o.rows.reduce((a, r) => a + sum(r.week), 0))),
            h('span', {}, String(o.grand)))),
        h('div', { class: 'hint', style: { margin: '12px 0 0' } },
          '带斜杠的是「今日/每日上限」。统计口径：一次真正的模型调用算 1 次，图像按张数、视频按条数。')));
  }

  function exportCsv(o) {
    const lines = [['账号', '昵称', '今日文本', '今日图像', '今日视频', '近7日', '累计', '文本上限', '图像上限', '视频上限']];
    for (const r of o.rows) {
      lines.push([r.account, r.nick, r.today.text, r.today.image, r.today.video, sum(r.week), sum(r.total),
        r.quota.text || '不限', r.quota.image || '不限', r.quota.video || '不限']);
    }
    const csv = '\ufeff' + lines.map(l => l.map(x => `"${String(x).replace(/"/g, '""')}"`).join(',')).join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
    download(URL.createObjectURL(blob), `用量统计-${dayKey()}.csv`);
    toast('已导出 CSV', 'ok');
  }

  /* ---------------- 公告 ---------------- */
  function noticeSection() {
    const editing = editingNoticeId ? notices.list().find(n => n.id === editingNoticeId) : null;

    const titleInp = h('input', { class: 'form-input', placeholder: '标题，例如：今晚 22:00 维护 10 分钟', value: editing?.title || '' });
    const bodyInp = h('textarea', { class: 'form-area', rows: '4', placeholder: '正文：说明影响范围、要用户做什么、什么时候恢复…' });
    bodyInp.value = editing?.body || '';
    const levelSel = h('select', { class: 'form-select' },
      [['info', '普通公告'], ['ok', '好消息 / 通知'], ['warn', '重要提醒']]
        .map(([v, l]) => h('option', { value: v, selected: (editing?.level || 'info') === v }, l)));
    const pinInp = h('input', { type: 'checkbox', checked: !!editing?.pinned });
    const pin = h('label', { class: 'adm-check' }, pinInp, h('span', {}, '置顶到首页顶部'));

    const publish = () => {
      const title = titleInp.value.trim();
      const body = bodyInp.value.trim();
      if (!title) return toast('公告得有个标题', 'err');
      if (!body) return toast('写点正文吧，不然大家不知道发生了什么', 'err');
      if (editing) {
        notices.update(editing.id, { title, body, level: levelSel.value, pinned: pinInp.checked });
        editingNoticeId = '';
        toast('公告已更新', 'ok');
      } else {
        notices.add({ title, body, level: levelSel.value, pinned: pinInp.checked, by: ADMIN.account });
        toast('公告已发布，所有账号都能看到', 'ok');
      }
      window.dispatchEvent(new CustomEvent('pavo-notices'));
      draw();
    };

    const list = notices.list();

    return h('div', {},
      h('div', { class: 'adm-card' },
        h('div', { class: 'adm-card-title' }, editing ? '编辑公告' : '发布公告'),
        h('div', { class: 'form-group' }, h('label', { class: 'form-label' }, '标题'), titleInp),
        h('div', { class: 'form-group' }, h('label', { class: 'form-label' }, '正文'), bodyInp),
        h('div', { class: 'adm-row2' },
          h('div', { class: 'form-group' }, h('label', { class: 'form-label' }, '类型'), levelSel),
          h('div', { class: 'form-group' }, h('label', { class: 'form-label' }, '显示'), pin)),
        h('div', { class: 'adm-acts' },
          h('button', { class: 'btn-primary', onclick: publish }, editing ? '保存修改' : '发布公告'),
          editing ? h('button', { class: 'btn-ghost', onclick: () => { editingNoticeId = ''; draw(); } }, '取消编辑') : null),
        h('div', { class: 'hint', style: { margin: '12px 0 0' } },
          '公告会出现在所有账号的「通知」里；置顶的还会显示在首页顶部，用户可以手动收起。')),

      h('div', { class: 'adm-card' },
        h('div', { class: 'adm-card-title' }, `已发布（${list.length}）`),
        list.length ? h('div', { class: 'adm-notices' }, ...list.map(n => h('div', { class: 'adm-notice' },
          h('div', { class: 'adm-notice-head' },
            h('span', { class: 'badge' + (n.level === 'warn' ? ' warn' : n.level === 'ok' ? ' ok' : '') },
              n.pinned ? '置顶' : (n.level === 'warn' ? '重要' : n.level === 'ok' ? '通知' : '公告')),
            h('b', {}, n.title),
            h('span', { class: 'adm-notice-time' }, fmtDate(n.createdAt))),
          h('div', { class: 'adm-notice-body' }, n.body),
          h('div', { class: 'adm-acts' },
            h('button', { class: 'node-btn', onclick: () => { editingNoticeId = n.id; draw(); window.scrollTo({ top: 0, behavior: 'smooth' }); } }, '编辑'),
            h('button', {
              class: 'node-btn', onclick: () => { notices.update(n.id, { pinned: !n.pinned }); draw(); }
            }, n.pinned ? '取消置顶' : '置顶'),
            h('button', {
              class: 'node-btn', onclick: async () => {
                if (!await confirm(`删除公告「${n.title}」？`)) return;
                notices.remove(n.id); draw(); toast('已删除', 'ok');
              }
            }, '删除')))))
          : h('div', { class: 'adm-empty' }, '还没发过公告。'))
    );
  }

  /* ---------------- 邀请奖励 ---------------- */
  function inviteSection() {
    const st = invites.stats();
    const noteInp = h('input', { class: 'form-input', placeholder: '备注，例如：给阿杰的开通码' });
    const extraInp = h('input', { class: 'form-input', type: 'number', min: '0', step: '5', value: '20' });
    const daysInp = h('input', { class: 'form-input', type: 'number', min: '1', step: '1', value: '30' });

    const create = () => {
      const extra = Math.max(0, Math.round(Number(extraInp.value) || 0));
      const days = Math.max(1, Math.round(Number(daysInp.value) || 30));
      const it = invites.create({ note: noteInp.value, extra, days });
      toast(`已生成邀请码 ${it.code}`, 'ok', 3200);
      draw();
    };

    const list = invites.list();

    return h('div', {},
      h('div', { class: 'adm-stats' },
        statCard('已生成', st.total, '邀请码总数'),
        statCard('已使用', st.used, '有人用它注册了', 'brand'),
        statCard('可用', st.available, '还没被用掉')),

      h('div', { class: 'adm-card' },
        h('div', { class: 'adm-card-title' }, '生成邀请码'),
        h('div', { class: 'adm-row3' },
          h('div', { class: 'form-group' }, h('label', { class: 'form-label' }, '备注（只你自己看）'), noteInp),
          h('div', { class: 'form-group' }, h('label', { class: 'form-label' }, '额外每日额度'), extraInp),
          h('div', { class: 'form-group' }, h('label', { class: 'form-label' }, '奖励有效天数'), daysInp)),
        h('div', { class: 'adm-acts' }, h('button', { class: 'btn-primary', onclick: create }, '生成邀请码')),
        h('div', { class: 'hint', style: { margin: '12px 0 0' } },
          '被邀请人注册时填这个码，可以免审核直接开通，同时在有效期内每天多拿上面这个额度。')),

      h('div', { class: 'adm-card' },
        h('div', { class: 'adm-card-title' }, `邀请码（${list.length}）`),
        list.length ? h('div', { class: 'adm-invites' }, ...list.map(it => h('div', { class: 'adm-invite' + (it.usedBy ? ' used' : '') },
          h('div', { class: 'adm-invite-code' }, it.code),
          h('div', { class: 'adm-invite-info' },
            h('div', { class: 'adm-invite-line' },
              it.usedBy
                ? h('span', { class: 'badge' }, `已被 ${it.usedBy} 使用`)
                : h('span', { class: 'badge ok' }, '可用'),
              h('span', { class: 'hint', style: { margin: '0' } },
                `+${it.extra} 次/天 · ${it.days} 天`),
              it.note ? h('span', { class: 'hint', style: { margin: '0' } }, it.note) : null),
            h('div', { class: 'adm-invite-time' }, fmtDate(it.createdAt) + (it.usedAt ? ` · 使用于 ${fmtDate(it.usedAt)}` : ''))),
          h('div', { class: 'adm-user-acts' },
            h('button', {
              class: 'node-btn', onclick: async () => {
                const ok = await copyText(inviteMessage(it.code, it.extra, it.days));
                toast(ok ? '邀请文案已复制，直接发给对方' : '复制失败', ok ? 'ok' : 'err');
              }
            }, '复制邀请文案'),
            h('button', {
              class: 'node-btn', onclick: async () => {
                const ok = await copyText(it.code);
                toast(ok ? `已复制 ${it.code}` : '复制失败', ok ? 'ok' : 'err');
              }
            }, '复制码'),
            h('button', {
              class: 'node-btn', onclick: async () => {
                if (!await confirm(`删除邀请码 ${it.code}？`)) return;
                invites.remove(it.id); draw(); toast('已删除', 'ok');
              }
            }, '删除')))))
          : h('div', { class: 'adm-empty' }, '还没生成邀请码。'))
    );
  }

  /* ---------------- 平台默认模型 ---------------- */
  function modelsSection() {
    const presetModels = {
      text: ['agnes-3.0-flash', 'agnes-2.0-flash', 'agnes-2.5-pro', 'deepseek-chat', 'glm-4.6'],
      image: ['agnes-image-2.5-flash', 'agnes-image-2.1-flash', 'cogview-4'],
      video: ['agnes-video-2.5-flash']
    };

    return h('div', {},
      h('div', { class: 'adm-card' },
        h('div', { class: 'adm-card-title' }, '平台默认模型'),
        h('div', { class: 'hint', style: { margin: '0 0 6px' } },
          '这里决定「平台默认」到底走哪个模型。用户端看不到这些配置，只能看到模型名。留空 = 沿用内置通道（Agnes）。'),
        ...QUOTA_KINDS.map(k => {
          const cur = defaultModels.get(k);
          const active = backendProvider(k).model;
          const modelInp = h('input', {
            class: 'form-input', list: 'mdl-' + k,
            placeholder: active, value: cur.model
          });
          const urlInp = h('input', { class: 'form-input', placeholder: 'https://api.agnes-ai.cn/v1（留空即内置）', value: cur.baseUrl });
          const keyInp = h('input', { class: 'form-input', type: 'password', placeholder: '留空即用内置 Key', value: cur.apiKey });
          const dl = h('datalist', { id: 'mdl-' + k }, ...(presetModels[k] || []).map(m => h('option', { value: m })));

          return h('div', { class: 'adm-model' },
            h('div', { class: 'adm-model-head' },
              h('span', { class: 'adm-model-kind', html: icon(KIND_ICON[k], 16) }),
              h('b', {}, KIND_LABEL[k]),
              h('span', { class: 'badge' + (defaultModels.isCustom(k) ? ' ok' : '') }, `当前：${active}`)),
            h('div', { class: 'adm-row3' },
              h('div', { class: 'form-group' }, h('label', { class: 'form-label' }, '模型名'), modelInp, dl),
              h('div', { class: 'form-group' }, h('label', { class: 'form-label' }, 'Base URL'), urlInp),
              h('div', { class: 'form-group' }, h('label', { class: 'form-label' }, 'API Key'), keyInp)),
            h('div', { class: 'adm-acts' },
              h('button', {
                class: 'btn-primary', onclick: () => {
                  defaultModels.set(k, {
                    model: modelInp.value.trim(),
                    baseUrl: urlInp.value.trim(),
                    apiKey: keyInp.value.trim()
                  });
                  toast(`${KIND_LABEL[k]}默认模型已更新：${modelInp.value.trim() || '内置默认'}`, 'ok');
                  draw();
                }
              }, '保存'),
              h('button', {
                class: 'btn-ghost', onclick: async () => {
                  if (!await confirm(`把${KIND_LABEL[k]}恢复成内置默认模型？`)) return;
                  defaultModels.clear(k); toast('已恢复内置默认', 'ok'); draw();
                }
              }, '恢复内置')));
        })),
      h('div', { class: 'adm-card' },
        h('div', { class: 'hint', style: { margin: '0' } },
          'Key 只存在这台电脑的浏览器里，不会上传。用户端的「功能模型」里选「平台默认」就会走到这里配置的模型。')));
  }

  draw();
}
