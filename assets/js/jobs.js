/* ============ 常驻生成任务 ============
   生成任务放在页面之外跑：切到别的页面也会继续，结果与进度写进 store；
   回到图片 / 视频页时自动恢复历史记录和进行中的状态。
   ========================================== */
import { store, uid } from './store.js';
import { genImage, genVideo } from './models.js';

const EVT = 'pavo-job';
const running = { image: false, video: false };

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
  if (running.image) return;
  running.image = true;
  wsPatch('image', { busy: true, startedAt: Date.now(), error: '' });
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
    emit('image');
  }
}

export async function runVideo({ provider, prompt, images, ratio, duration, title } = {}) {
  if (running.video) return;
  running.video = true;
  wsPatch('video', { busy: true, startedAt: Date.now(), error: '', progress: '提交任务…' });
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
    emit('video');
  }
}
