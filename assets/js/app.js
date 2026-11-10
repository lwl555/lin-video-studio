/* ============ 应用入口：认证 + 路由 ============ */
import { store, auth, ADMIN } from './store.js';
import { $, $$, toast, h } from './ui.js';
import { icon } from './icons.js';
import { usageReport } from './storage.js';
import * as Home from './views/home.js?v=20261110e';
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
      if (!r.ok) return fail('#auth-error', r.msg);
      screen.classList.add('hidden'); app.classList.remove('hidden');
      bootApp();
      toast(`欢迎回来，${r.user.nick}`, 'ok');
    } finally { btn.disabled = false; }
  }
  async function doRegister() {
    const a = $('#reg-account').value.trim(), n = $('#reg-nick').value.trim(), p = $('#reg-pass').value;
    if (!a || !n || !p) return fail('#reg-error', '请填写完整信息');
    if (p.length < 6) return fail('#reg-error', '密码至少 6 位');
    const r = await auth.register(a, n, p);
    if (!r.ok) return fail('#reg-error', r.msg);
    toast(r.msg, 'ok', 4000); show('login');
  }

  $('#auth-submit').addEventListener('click', doLogin);
  $('#auth-pass').addEventListener('keydown', e => e.key === 'Enter' && doLogin());
  $('#auth-account').addEventListener('keydown', e => e.key === 'Enter' && $('#auth-pass').focus());
  $('#reg-submit').addEventListener('click', doRegister);
}

/* ---------- 路由 ---------- */
const ROUTES = {
  home: Home.render, inspire: Inspire.render,
  canvas: Canvas.renderList, 'canvas-edit': Canvas.renderEditor,
  image: ImageWs.render, video: VideoWs.render,
  studio: Studio.render, series: Series.render,
  agent: AgentChat.render,
  assets: Assets.render, works: Works.render, settings: Settings.render
};
const NAV_OF = { home: 'inspire', inspire: 'inspire', series: 'series', canvas: 'canvas', 'canvas-edit': 'canvas',
  works: 'works', assets: 'assets', settings: 'settings', image: 'image', video: 'video', studio: 'series', agent: 'series' };
let current = 'home';

/* 移动端侧栏抽屉：go() 里切页时自动收起（由 bootApp 赋值） */
let closeDrawer = () => { };

export function go(route, params = {}) {
  if (!ROUTES[route]) route = 'home';
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
  $('#user-plan').textContent = u.role === 'admin' ? '管理员' : '创作者';
  $('#user-avatar').textContent = u.nick.slice(0, 1);
  $('#top-avatar').textContent = u.nick.slice(0, 1);

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
  $('#btn-notice').addEventListener('click', () => toast('暂无新通知'));
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
