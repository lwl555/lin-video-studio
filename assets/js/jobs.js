/* ============ 常驻生成任务 ============
   生成任务放在页面之外跑：切到别的页面也会继续，结果与进度写进 store；
   回到图片 / 视频页时自动恢复历史记录和进行中的状态。
   ========================================== */
import { store, uid } from './store.js';
import { genImage, genVideo } from './models.js';

const EVT = 'pavo-job';
const running = { image: false, video: false };

/* 并发闸门：文档 7.2「单用户并发任务上限 2 个」。
   超出的任务排队等待，而不是静默丢弃（旧逻辑点击第二次会毫无反应）。 */
const MAX_CONCURRENT = 2;
let activeCount = 0;
const waiters = [];
async function acquire() {
  if (activeCount < MAX_CONCURRENT) { activeCount++; return; }
  await new Promise(res => waiters.push(res));
  activeCount++;
}
function release() {
  activeCount = Math.max(0, activeCount - 1);
  const next = waiters.shift();
  if (next) next();
}

function rootWS() {
  const s = store.state;
  s.ws = s.ws || {};
  s.ws.image = s.ws.image || {};
  s.ws.video = s.ws.video || {};
  if (!Array.isArray(s.ws.image.results)) s.ws.image.results = [];
  if (!Array.isArray(s.ws.video.results)) s.ws.video.results = [];
  return s.ws;
}

export function wsGet(kind) { return rootWS()[kind]; }

export function wsPatch(kind, patch) {
  Object.assign(rootWS()[kind], patch);
  store.save();
  emit(kind);
}

export function isBusy(kind) { return !!running[kind]; }

/* ---------- 卡死自愈 ----------
   busy / startedAt / progress 是写进 localStorage 的，但真正在跑的任务只在内存里。
   手机切后台被系统挂起、关掉页面、断网重连之后，busy 会永远停在 true，
   按钮一直禁用、点生成毫无反应（实测出现过「已等待 30816s」）。
   这里在启动时和每次回到前台时对账：内存里没有任务、或等待时间已经远超正常上限，
   就把状态复位，并告诉用户发生了什么。 */
const STALE_MS = 20 * 60 * 1000;          // 视频最长约 11 分钟，20 分钟还在转一定是死了
const KINDS = ['image', 'video'];

export function reconcile() {
  let changed = false;
  for (const k of KINDS) {
    const s = rootWS()[k];
    if (!s || !s.busy) continue;
    const wait = Date.now() - (Number(s.startedAt) || 0);
    const dead = !running[k] || wait > STALE_MS;
    if (!dead) continue;
    Object.assign(s, {
      busy: false,
      queued: false,
      progress: '',
      error: '上次生成被中断了（刷新页面 / 切到后台太久 / 网络断开），已经自动复位。直接重新生成即可。'
    });
    changed = true;
    emit(k);
  }
  if (changed) store.save();
  return changed;
}

/* 用户手动点「卡住了？点这里复位」时调用：只复位界面状态，不假装取消已发出的请求 */
export function forceReset(kind) {
  const s = rootWS()[kind];
  if (!s) return;
  running[kind] = false;
  Object.assign(s, { busy: false, queued: false, progress: '', error: '' });
  store.save();
  emit(kind);
}

/* 启动即对账一次；手机从后台回到前台再对账一次 */
reconcile();
if (typeof document !== 'undefined') {
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) reconcile();
  });
  window.addEventListener('focus', () => reconcile());
}

function emit(kind) {
  try { window.dispatchEvent(new CustomEvent(EVT, { detail: { kind } })); } catch { /* ignore */ }
}

/* 订阅任务状态变化；返回取消订阅函数 */
export function onJob(fn) {
  const handler = e => fn(e.detail && e.detail.kind);
  window.addEventListener(EVT, handler);
  return () => window.removeEventListener(EVT, handler);
}

export async function runImage({ provider, prompt, size, images, title } = {}) {
  running.image = true;
  wsPatch('image', { busy: true, queued: activeCount >= MAX_CONCURRENT, startedAt: Date.now(), error: '' });
  await acquire();
  wsPatch('image', { queued: false });
  try {
    const r = await genImage(prompt, { provider, size, images: images || [], feature: 'image' });
    const cur = wsGet('image');
    wsPatch('image', {
      busy: false,
      results: [r.url, ...(cur.results || [])].slice(0, 16),
      lastAt: Date.now(),
    });
    store.add('works', {
      id: uid('w'), title: (title || prompt || '图片').slice(0, 24),
      type: 'image', url: r.url, createdAt: Date.now(),
    });
  } catch (e) {
    wsPatch('image', { busy: false, error: String((e && e.message) || e) });
  } finally {
    running.image = false;
    release();
    emit('image');
  }
}

export async function runVideo({ provider, prompt, images, ratio, duration, title } = {}) {
  running.video = true;
  wsPatch('video', { busy: true, queued: activeCount >= MAX_CONCURRENT, startedAt: Date.now(), error: '', progress: '提交任务…' });
  await acquire();
  wsPatch('video', { queued: false, progress: '提交任务…' });
  try {
    const r = await genVideo(prompt, {
      provider, images: images || [], ratio, duration, feature: 'video',
      onProgress: s => wsPatch('video', { progress: s }),
    });
    const cur = wsGet('video');
    wsPatch('video', {
      busy: false,
      progress: '',
      results: [r.url, ...(cur.results || [])].slice(0, 12),
      lastAt: Date.now(),
    });
    store.add('works', {
      id: uid('w'), title: (title || prompt || '视频').slice(0, 24),
      type: 'video', url: r.url, createdAt: Date.now(),
    });
  } catch (e) {
    wsPatch('video', { busy: false, progress: '', error: String((e && e.message) || e) });
  } finally {
    running.video = false;
    release();
    emit('video');
  }
}
