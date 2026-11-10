/* ============ 应用入口：认证 + 路由 ============ */
import { store, auth, ADMIN } from './store.js';
import { $, $$, toast, h, modal } from './ui.js';
import { icon } from './icons.js';
import { usageReport } from './storage.js';
import { openSupport } from './support.js';
import { openNotices } from './notice-ui.js';
import { notices } from './ops.js';
import { todaySummary, QUOTA_KINDS, KIND_LABEL } from './usage.js';
import { tierInfo, balanceOf } from './points.js';
import * as Home from './views/home.js';
import * as Canvas from './views/canvas.js';
import * as ImageWs from './views/image.js';
import * as VideoWs from './views/video.js';
import * as Studio from './views/studio.js';
import * as AgentChat from './views/agentchat.js';
import * as Series from './views/series.js';
import * as Assets from './views/assets.js';
import * as Works from './views/works.js';
import * as Inspire from './views/inspire.js';
import * as Settings from './views/settings.js';
import * as Member from './views/member.js';
import * as Admin from './views/admin.js';

/* ---------- 认证门禁 ---------- */
/* 防重入：万一 app.js 被当成两个模块各求值一次（历史上 script 标签带 ?v= 就踩过），
   initAuth / bootApp 都只允许真正执行一次，否则事件会绑两遍 */
let didInit = false, didBoot = false;

function initAuth() {
  if (didInit) return;
  didInit = true;
  const screen = $('#auth-screen'), app = $('#app');

  if (auth.user) { screen.classList.add('hidden'); app.classList.remove('hidden'); bootApp(); return; }
  screen.classList.remove('hidden'); app.classList.add('hidden');

  const show = which => {
    $('#form-login').classList.toggle('hidden', which !== 'login');
    $('#form-register').classList.toggle('hidden', which !== 'register');
    $('#auth-error').textContent = ''; $('#reg-error').textContent = '';
  };
  $('#auth-go-register').addEventListener('click', () => show('register'));
  $('#auth-go-login').addEventListener('click', () => show('login'));

  const eye = $('#auth-eye');
  eye?.addEventListener('click', () => {
    const p = $('#auth-pass');
    p.type = p.type === 'password' ? 'text' : 'password';
  });

  function fail(el, msg) {
    const e = $(el);
    e.textContent = msg;
    e.classList.remove('shake'); void e.offsetWidth; e.classList.add('shake');
  }

  async function doLogin() {
    const a = $('#auth-account').value.trim(), p = $('#auth-pass').value;
    if (!a || !p) return fail('#auth-error', '请输入账号和密码');
    const btn = $('#auth-submit'); btn.disabled = true;
    try {
      const r = await auth.login(a, p);
      if (!r.ok) {
        fail('#auth-error', r.msg);
        /* 账号类问题不是「打错字」，光给一行红字解决不了，直接给出下一步 + 客服入口 */
        if (r.code === 'NO_USER') {
          openSupport({
            title: '还没有开通账号',
            account: a,
            reason: '我还没有账号，想申请开通一个，用来做短剧。'
          });
        } else if (r.code === 'PENDING') {
          openSupport({
            title: '账号正在等授权',
            account: a,
            reason: '我已经提交过申请了，麻烦帮我通过一下授权。'
          });
        }
        return;
      }
      screen.classList.add('hidden'); app.classList.remove('hidden');
      bootApp();
      toast(`欢迎回来，${r.user.nick}`, 'ok');
    } finally { btn.disabled = false; }
  }

  async function doRegister() {
    const a = $('#reg-account').value.trim(), n = $('#reg-nick').value.trim(), p = $('#reg-pass').value;
    const invite = ($('#reg-invite')?.value || '').trim();
    if (!a || !n || !p) return fail('#reg-error', '请填写完整信息');
    if (p.length < 6) return fail('#reg-error', '密码至少 6 位');
    if (invite && !/^[A-Za-z0-9-]{4,24}$/.test(invite)) {
      return fail('#reg-error', '邀请码格式不对，一般是 LIN-XXXXXX 这种');
    }
    const btn = $('#reg-submit'); btn.disabled = true;
    try {
      const r = await auth.register(a, n, p, invite);
      if (!r.ok) return fail('#reg-error', r.msg);

      if (r.invited) {
        /* 邀请码直接开通：回到登录页、账号已预填，点一下就进 */
        show('login');
        $('#auth-account').value = a;
        $('#auth-pass').value = '';
        $('#auth-pass').focus();
        toast('邀请码已生效，账号开通了，直接登录就行', 'ok', 4200);
        let m1;
        m1 = modal({
          title: '开通成功 🎉',
          body: h('div', { class: 'auth-welcome' },
            h('div', { class: 'auth-welcome-h' }, `欢迎，${n}`),
            h('div', { class: 'hint', style: { margin: '6px 0 0', lineHeight: '1.75' } },
              r.bonus
                ? `邀请码已核销，账号立刻可用；接下来 ${r.bonus.extra} 天每天额外多 ${r.bonus.extra} 次生成额度。`
                : '邀请码已核销，账号立刻可用，直接用手机号和密码登录就行。')),
          foot: [h('button', { class: 'btn-primary', onclick: () => m1.close() }, '去登录')]
        });
      } else {
        show('login');
        $('#auth-account').value = a;
        let m2;
        m2 = modal({
          title: '申请已提交',
          body: h('div', { class: 'auth-welcome' },
            h('div', { class: 'auth-welcome-h' }, '收到啦，接下来交给我'),
            h('ol', { class: 'auth-steps' },
              h('li', {}, '管理员会在后台看到你的申请，通过后就能登录。'),
              h('li', {}, '想马上开通？加客服微信，把账号发过去，通常几分钟就好。'),
              h('li', {}, '或者下次带邀请码注册，可以免审核直接开通。')),
            h('div', { class: 'auth-account-chip' }, `我的账号：${a}`)),
          foot: [
            h('button', { class: 'btn-ghost', onclick: () => openSupport({ account: a, reason: '我刚提交了注册申请，想尽快开通。' }) }, '联系客服催一下'),
            h('button', { class: 'btn-primary', onclick: () => m2.close() }, '好')
          ]
        });
      }
    } finally { btn.disabled = false; }
  }

  $('#auth-submit').addEventListener('click', doLogin);
  $('#auth-pass').addEventListener('keydown', e => e.key === 'Enter' && doLogin());
  $('#auth-account').addEventListener('keydown', e => e.key === 'Enter' && $('#auth-pass').focus());
  $('#reg-submit').addEventListener('click', doRegister);
  $('#reg-invite')?.addEventListener('keydown', e => e.key === 'Enter' && doRegister());

  /* ---- 客服入口：登录页两个 + 忘记密码 ---- */
  $('#auth-support')?.addEventListener('click', () => openSupport({
    account: $('#auth-account').value.trim(),
    reason: '登录遇到问题，想请人帮我看一下。'
  }));
  $('#reg-support')?.addEventListener('click', () => openSupport({
    account: $('#reg-account').value.trim(),
    reason: '我想开通账号，但还没有邀请码。'
  }));
  $('#auth-forgot')?.addEventListener('click', e => {
    e.preventDefault();
    openSupport({
      account: $('#auth-account').value.trim(),
      title: '忘记密码',
      reason: '我忘记密码了，需要重置一下，账号是上面这个。'
    });
  });
}

/* ---------- 路由 ---------- */
const ROUTES = {
  home: Home.render, inspire: Inspire.render,
  canvas: Canvas.renderList, 'canvas-edit': Canvas.renderEditor,
  image: ImageWs.render, video: VideoWs.render,
  studio: Studio.render, series: Series.render,
  agent: AgentChat.render,
  assets: Assets.render, works: Works.render, settings: Settings.render,
  member: Member.render,
  admin: Admin.render
};
const NAV_OF = { home: 'inspire', inspire: 'inspire', series: 'series', canvas: 'canvas', 'canvas-edit': 'canvas',
  works: 'works', assets: 'assets', settings: 'settings', image: 'image', video: 'video', studio: 'series',
  agent: 'series', admin: 'admin', member: 'member' };
let current = 'home';

/* 移动端侧栏抽屉：go() 里切页时自动收起（由 bootApp 赋值） */
let closeDrawer = () => { };

export function go(route, params = {}) {
  if (!ROUTES[route]) route = 'home';
  if (route === 'admin' && !auth.isAdmin) route = 'home';   /* 非管理员不给进后台 */
  current = route;
  closeDrawer();
  try { history.replaceState(null, '', '#' + route); } catch { /* ignore */ }
  const view = $('#view');
  view.innerHTML = '';
  $('#btn-back').classList.toggle('hidden', route === 'home');
  $$('.nav-item').forEach(n => n.classList.toggle('active', n.dataset.route === NAV_OF[route]));
  try {
    ROUTES[route](view, params);
  } catch (e) {
    console.error(e);
    view.innerHTML = `<div class="page"><div class="empty"><div class="empty-icon">${icon('warn', 40)}</div>页面出错：${e.message}</div></div>`;
  }
}
window.__go = go;

/* ---------- 启动 ---------- */
function bootApp() {
  if (didBoot) return;
  didBoot = true;
  const u = auth.user;
  $('#user-name').textContent = u.nick;
  const drawPlan = () => {
    const t = tierInfo(u.account);
    $('#user-plan').textContent = u.role === 'admin'
      ? `管理员 · ${balanceOf(u.account)} 积分`
      : `${t.name} · ${balanceOf(u.account)} 积分`;
  };
  drawPlan();
  window.addEventListener('pavo-points', drawPlan);
  $('#user-avatar').textContent = u.nick.slice(0, 1);
  $('#top-avatar').textContent = u.nick.slice(0, 1);

  /* 管理后台入口只给管理员看，其他角色连路由都进不去 */
  $$('.nav-admin').forEach(el => el.classList.toggle('hidden', !auth.isAdmin));

  $$('.nav-item').forEach(n => n.addEventListener('click', () => go(n.dataset.route)));
  $('#btn-back').addEventListener('click', () => go('home'));
  $('#btn-new').addEventListener('click', () => go('home'));

  /* ---------- 移动端：侧栏改成抽屉 ---------- */
  const sidebar = $('.sidebar');
  const sbMask = $('#sb-mask');
  closeDrawer = () => {
    sidebar.classList.remove('open');
    sbMask.classList.add('hidden');
  };
  $('#btn-menu')?.addEventListener('click', () => {
    if (sidebar.classList.contains('open')) return closeDrawer();
    sidebar.classList.add('open');
    sbMask.classList.remove('hidden');
  });
  sbMask.addEventListener('click', () => closeDrawer());
  /* 抽屉里点导航 / 开始创作 / 退出，都顺手收起 */
  sidebar.addEventListener('click', e => {
    if (e.target.closest('.nav-item') || e.target.closest('#btn-new')) closeDrawer();
  });
  /* 竖屏↔横屏切换时别留着半开的抽屉 */
  window.addEventListener('resize', () => { if (innerWidth > 900) closeDrawer(); });
  $('#btn-logout').addEventListener('click', () => {
    if (confirm('确定退出登录？')) { auth.logout(); location.reload(); }
  });
  $('#top-avatar').addEventListener('click', () => go('settings'));

  /* ---------- 公告：未读红点 + 通知弹窗 ---------- */
  const noticeBtn = $('#btn-notice');
  const dot = h('i', { class: 'notice-dot' });
  noticeBtn.append(dot);
  const refreshNoticeDot = () => {
    const n = notices.unread(auth.user?.account || '');
    dot.classList.toggle('on', n > 0);
    noticeBtn.title = n ? `${n} 条未读公告` : '通知';
    noticeBtn.classList.toggle('has-new', n > 0);
  };
  refreshNoticeDot();
  window.addEventListener('pavo-notices', refreshNoticeDot);
  noticeBtn.addEventListener('click', () => { openNotices(); refreshNoticeDot(); });

  /* ---------- 今日用量胶囊（管理员设了每日上限才出现） ---------- */
  const qChip = h('button', { class: 'quota-chip hidden', title: '查看今日用量', onclick: () => openQuota() });
  $('.topbar-right')?.prepend(qChip);

  function drawQuotaChip() {
    if (auth.isAdmin) { qChip.classList.add('hidden'); return; }
    const s = todaySummary();
    const limited = QUOTA_KINDS.filter(k => s[k].limit > 0);
    if (!limited.length) { qChip.classList.add('hidden'); return; }
    const used = limited.reduce((a, k) => a + s[k].used, 0);
    const total = limited.reduce((a, k) => a + s[k].limit, 0);
    qChip.classList.remove('hidden');
    qChip.classList.toggle('warn', used >= total);
    qChip.textContent = `今日 ${used}/${total}`;
  }
  function openQuota() {
    const s = todaySummary();
    const rows = QUOTA_KINDS.filter(k => s[k].limit > 0).map(k => {
      const { used, limit } = s[k];
      const pct = Math.min(100, Math.round(used / Math.max(1, limit) * 100));
      return h('div', { class: 'quota-row' },
        h('div', { class: 'quota-row-top' },
          h('span', { class: 'quota-k' }, KIND_LABEL[k]),
          h('span', { class: 'quota-v' + (used >= limit ? ' full' : '') }, `${used} / ${limit} 次`)),
        h('div', { class: 'quota-bar' },
          h('i', { style: { width: pct + '%', background: used >= limit ? 'var(--err)' : pct >= 80 ? 'var(--warn)' : 'var(--brand)' } })));
    });
    let m;
    m = modal({
      title: '今日生成额度',
      body: h('div', {},
        h('div', { class: 'hint', style: { margin: '0 0 12px' } },
          '每天 0 点自动重置。额度由管理员分配，不够用可以找管理员加。'),
        rows.length ? h('div', {}, ...rows) : h('div', { class: 'hint' }, '当前没有设置上限，可以放心用。')),
      foot: [
        h('button', { class: 'btn-ghost', onclick: () => { m.close(); openSupport({ account: auth.user?.account, reason: '我今天的生成额度用完了，想申请加一点。' }); } }, '找管理员加额度'),
        h('button', { class: 'btn-primary', onclick: () => m.close() }, '知道了')
      ]
    });
  }
  drawQuotaChip();
  window.addEventListener('pavo-usage', drawQuotaChip);
  window.addEventListener('pavo-quota', drawQuotaChip);
  /* 顶栏全局搜索：实时浮层，跨作品/短剧/资产/画布检索（参考 Pavo 顶栏搜索） */
  const sb = $('#global-search');
  const sbBox = sb.closest('.search-box');
  sbBox.style.position = 'relative';
  const panel = h('div', { class: 'search-panel hidden' });
  sbBox.append(panel);
  const doSearch = q => {
    q = (q || '').trim().toLowerCase();
    if (!q) { panel.classList.add('hidden'); return; }
    const res = [];
    for (const w of store.list('works')) if ((w.title || '').toLowerCase().includes(q)) res.push({ t: w.title || '未命名', sub: w.type === 'video' ? '视频' : '图片', route: 'works', id: w.id });
    for (const s of store.list('series')) if ((s.title || '').toLowerCase().includes(q)) res.push({ t: s.title || '未命名', sub: '短剧', route: 'series', id: s.id });
    for (const a of store.list('assets')) if ((a.name || '').toLowerCase().includes(q)) res.push({ t: a.name || '未命名', sub: '资产', route: 'assets', id: a.id });
    for (const p of store.list('projects')) if ((p.name || '').toLowerCase().includes(q)) res.push({ t: p.name || '未命名', sub: '画布', route: 'canvas-edit', id: p.id });
    if (!res.length) { panel.innerHTML = '<div class="sp-empty">没有匹配「' + q + '」的结果</div>'; panel.classList.remove('hidden'); return; }
    panel.innerHTML = '';
    for (const r of res.slice(0, 12)) panel.append(
      h('div', { class: 'sp-item', onclick: () => { panel.classList.add('hidden'); sb.value = ''; go(r.route, { id: r.id }); } },
        h('span', { class: 'sp-tag' }, r.sub), h('span', { class: 'sp-title' }, r.t)));
    panel.classList.remove('hidden');
  };
  sb.addEventListener('input', e => doSearch(e.target.value));
  sb.addEventListener('focus', e => doSearch(e.target.value));
  document.addEventListener('click', e => { if (!sbBox.contains(e.target)) panel.classList.add('hidden'); });

  const n = store.list('providers').length;
  $('#credit-num').textContent = n ? `${n} 个模型` : 'BYOK';

  /* 存储自动清理提醒 + 启动体检 */
  window.addEventListener('pavo-autoclean', e => {
    const { count = 0 } = e.detail || {};
    if (count > 0) toast(`存储空间不足，已自动清理 ${count} 个最旧素材（策略可在「模型接入 → 存储管理」调整）`, '', 5200);
  });
  try {
    const rep = usageReport(store.state);
    if (rep.percent >= 85) setTimeout(() =>
      toast(`本机存储已用 ${rep.percent}%，建议去「模型接入 → 存储管理」清理或压缩`, '', 5200), 1500);
  } catch { /* ignore */ }

  /* 支持 #路由 链接（可分享） */
  const hash = location.hash.replace(/^#\/?/, '');
  const [r, qs] = hash.split('?');
  const initParams = {};
  if (qs) for (const kv of qs.split('&')) { const [k, v] = kv.split('='); if (k) initParams[k] = decodeURIComponent(v || ''); }
  go(ROUTES[r] ? r : 'home', initParams);

  window.addEventListener('hashchange', () => {
    const hh = location.hash.replace(/^#\/?/, '').split('?')[0];
    if (hh && ROUTES[hh] && hh !== current) go(hh, {});
  });
}

/* 等模块图求值完成再启动：views/* 与 app.js 之间存在循环 import，
   直接在模块顶层启动会在 home.js 还没求值完时渲染，读到 TDZ 里的常量（MODES）报错。 */
queueMicrotask(initAuth);
