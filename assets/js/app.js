/* ============ 应用入口：认证 + 路由 ============ */
import { store, auth, ADMIN } from './store.js';
import { $, $$, toast } from './ui.js';
import * as Home from './views/home.js';
import * as Canvas from './views/canvas.js';
import * as ImageWs from './views/image.js';
import * as VideoWs from './views/video.js';
import * as Studio from './views/studio.js';
import * as Series from './views/series.js';
import * as Assets from './views/assets.js';
import * as Works from './views/works.js';
import * as Inspire from './views/inspire.js';
import * as Settings from './views/settings.js';

/* ---------- 认证门禁 ---------- */
function initAuth() {
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
  assets: Assets.render, works: Works.render, settings: Settings.render
};
const NAV_OF = { home: 'inspire', inspire: 'inspire', series: 'series', canvas: 'canvas', 'canvas-edit': 'canvas',
  works: 'works', assets: 'assets', settings: 'settings', image: 'inspire', video: 'inspire', studio: 'series' };
let current = 'home';

export function go(route, params = {}) {
  if (!ROUTES[route]) route = 'home';
  current = route;
  try { history.replaceState(null, '', '#' + route); } catch { /* ignore */ }
  const view = $('#view');
  view.innerHTML = '';
  $('#btn-back').classList.toggle('hidden', route === 'home');
  $$('.nav-item').forEach(n => n.classList.toggle('active', n.dataset.route === NAV_OF[route]));
  try {
    ROUTES[route](view, params);
  } catch (e) {
    console.error(e);
    view.innerHTML = `<div class="page"><div class="empty"><div class="empty-icon">⚠️</div>页面出错：${e.message}</div></div>`;
  }
}
window.__go = go;

/* ---------- 启动 ---------- */
function bootApp() {
  const u = auth.user;
  $('#user-name').textContent = u.nick;
  $('#user-plan').textContent = u.role === 'admin' ? '管理员' : '创作者';
  $('#user-avatar').textContent = u.nick.slice(0, 1);
  $('#top-avatar').textContent = u.nick.slice(0, 1);

  $$('.nav-item').forEach(n => n.addEventListener('click', () => go(n.dataset.route)));
  $('#btn-back').addEventListener('click', () => go('home'));
  $('#btn-new').addEventListener('click', () => go('home'));
  $('#btn-logout').addEventListener('click', () => {
    if (confirm('确定退出登录？')) { auth.logout(); location.reload(); }
  });
  $('#top-avatar').addEventListener('click', () => go('settings'));
  $('#btn-notice').addEventListener('click', () => toast('暂无新通知'));
  $('#global-search').addEventListener('keydown', e => {
    if (e.key === 'Enter') go('works', { q: e.target.value.trim() });
  });

  const n = store.list('providers').length;
  $('#credit-num').textContent = n ? `${n} 个模型` : 'BYOK';

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

initAuth();
