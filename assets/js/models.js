/* ============ 模型接入层（BYOK） ============ */
import { store, uid } from './store.js';

/* 预设：用户一键填充，也可完全自定义 */
export const PRESETS = [
  { key: 'agnes', name: 'Agnes AI', type: 'text', baseUrl: 'https://api.agnes-ai.cn/v1', model: 'agnes-2.0-flash' },
  { key: 'agnes-3', name: 'Agnes 3.0 Flash', type: 'text', baseUrl: 'https://api.agnes-ai.cn/v1', model: 'agnes-3.0-flash' },
  { key: 'agnes-pro', name: 'Agnes 2.5 Pro', type: 'text', baseUrl: 'https://api.agnes-ai.cn/v1', model: 'agnes-2.5-pro' },
  { key: 'ds', name: 'DeepSeek', type: 'text', baseUrl: 'https://api.deepseek.com/v1', model: 'deepseek-chat' },
  { key: 'zp', name: '智谱 GLM', type: 'text', baseUrl: 'https://open.bigmodel.cn/api/paas/v4', model: 'glm-4.6' },
  { key: 'sf', name: '硅基流动', type: 'text', baseUrl: 'https://api.siliconflow.cn/v1', model: 'Qwen/Qwen2.5-72B-Instruct' },
  { key: 'ms', name: 'Moonshot', type: 'text', baseUrl: 'https://api.moonshot.cn/v1', model: 'moonshot-v1-32k' },
  { key: 'oai', name: 'OpenAI', type: 'text', baseUrl: 'https://api.openai.com/v1', model: 'gpt-4o' },
  { key: 'volc', name: '火山方舟', type: 'text', baseUrl: 'https://ark.cn-beijing.volces.com/api/v3', model: 'doubao-pro-32k' },
  { key: 'agnes-img', name: 'Agnes Image', type: 'image', baseUrl: 'https://api.agnes-ai.cn/v1', model: 'agnes-image-2.1-flash' },
  { key: 'agnes-img2', name: 'Agnes Image 2.5', type: 'image', baseUrl: 'https://api.agnes-ai.cn/v1', model: 'agnes-image-2.5-flash' },
  { key: 'zp-img', name: '智谱 CogView', type: 'image', baseUrl: 'https://open.bigmodel.cn/api/paas/v4', model: 'cogview-4' },
  { key: 'sf-img', name: '硅基流动 图像', type: 'image', baseUrl: 'https://api.siliconflow.cn/v1', model: 'black-forest-labs/FLUX.1-schnell' },
  { key: 'oai-img', name: 'OpenAI 图像', type: 'image', baseUrl: 'https://api.openai.com/v1', model: 'gpt-image-1' },
  { key: 'agnes-vid', name: 'Agnes Video', type: 'video', baseUrl: 'https://api.agnes-ai.cn/v1', model: 'agnes-video-2.5-flash' },
  { key: 'agnes-vid2', name: 'Agnes Video 2.5 标准版', type: 'video', baseUrl: 'https://api.agnes-ai.cn/v1', model: 'agnes-video-2.5' },
  { key: 'sf-vid', name: '硅基流动 视频', type: 'video', baseUrl: 'https://api.siliconflow.cn/v1', model: 'Wan-AI/Wan2.2-T2V-A14B' },
  { key: 'custom', name: '自定义', type: 'text', baseUrl: '', model: '' }
];

export const TYPE_LABEL = { text: '文本/剧情', image: '图像', video: '视频', audio: '音频/TTS（预留）' };

export const providers = {
  all: () => store.list('providers'),
  byType: t => store.list('providers').filter(p => p.type === t && p.enabled !== false),
  defaultOf: t => providers.byType(t)[0] || null,
  add(p) { return store.add('providers', { id: uid('pv'), enabled: true, ...p }); },
  update(id, patch) { return store.update('providers', id, patch); },
  remove(id) { store.remove('providers', id); },
  get(id) { return store.find('providers', id); }
};

/* ---------- 请求核心：直连或经 Supabase 代理 ---------- */
/* 任何请求都必须有超时，否则网络层静默挂起时 UI 会永远停在「进行中」 */
const DEFAULT_TIMEOUT = 60000;

async function request(url, { method = 'POST', headers = {}, body, timeout = DEFAULT_TIMEOUT } = {}) {
  const px = store.state.proxy;
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), timeout);
  const secs = Math.round(timeout / 1000);
  try {
    if (px.enabled && px.url) {
      const r = await fetch(px.url.replace(/\/$/, '') + '/fetch', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...(px.anon ? { Authorization: `Bearer ${px.anon}` } : {}) },
        body: JSON.stringify({ url, method, headers, body }),
        signal: ctl.signal
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok || j.error) throw new Error(j.error || `代理请求失败 ${r.status}`);
      return j;   // {status, body}
    }
    const r = await fetch(url, {
      method,
      headers: { 'Content-Type': 'application/json', ...headers },
      body: body ? JSON.stringify(body) : undefined,
      signal: ctl.signal
    });
    const txt = await r.text();
    if (!r.ok) {
      let hint = '';
      if (r.status === 401 || r.status === 403) hint = '（API Key 无效或没有该模型权限）';
      else if (r.status === 404) hint = '（模型名或 Base URL 路径不对）';
      else if (r.status === 429) hint = '（触发限流，等 1 分钟再试）';
      throw new Error(`HTTP ${r.status}${hint} ${txt.slice(0, 240)}`);
    }
    let j; try { j = JSON.parse(txt); } catch { j = { raw: txt }; }
    return { status: r.status, body: j };
  } catch (e) {
    if (e?.name === 'AbortError') {
      throw new Error(`请求超时（${secs} 秒无响应）。检查网络，或在下方「后端代理」里填一个转发地址。`);
    }
    /* 浏览器对 CORS 预检失败 / DNS 失败 / 断网 统一抛 TypeError，这里翻译成人话 */
    if (e instanceof TypeError) {
      throw new Error(`连不上模型服务（${e.message || '网络错误'}）。常见原因：① Base URL 写错；② 该服务未开放浏览器跨域（CORS），需在下方配置后端代理。`);
    }
    throw e;
  } finally {
    clearTimeout(timer);
  }
}

function authHeaders(key) {
  return key ? { Authorization: `Bearer ${key}` } : {};
}
const norm = b => (b && b.baseUrl ? b.baseUrl.replace(/\/$/, '') : '');

/* ---------- 文本 ---------- */
export async function chat(prompt, { provider, system = '', json = false, temperature = 0.8, images = [], timeout } = {}) {
  const p = provider || providers.defaultOf('text');
  if (!p) throw new Error('尚未接入文本模型，请到「模型接入」添加');
  const url = `${norm(p)}/chat/completions`;
  const content = images.length
    ? [{ type: 'text', text: prompt }, ...images.map(u => ({ type: 'image_url', image_url: { url: u } }))]
    : prompt;
  const body = {
    model: p.model,
    messages: [...(system ? [{ role: 'system', content: system }] : []), { role: 'user', content }],
    temperature,
    stream: false
  };
  if (json) body.response_format = { type: 'json_object' };
  const res = await request(url, { headers: authHeaders(p.apiKey), body, timeout });
  const b = res.body || {};
  const text = b?.choices?.[0]?.message?.content
    ?? b?.choices?.[0]?.text
    ?? b?.output?.text
    ?? (typeof b.raw === 'string' ? b.raw : '');
  if (!text) throw new Error('模型返回为空：' + JSON.stringify(b).slice(0, 200));
  if (json) {
    const m = String(text).match(/\{[\s\S]*\}|\[[\s\S]*\]/);
    if (!m) throw new Error('模型未返回 JSON');
    try { return JSON.parse(m[0]); } catch { throw new Error('JSON 解析失败'); }
  }
  return String(text).trim();
}

/* ---------- 图像 ---------- */
export async function genImage(prompt, { provider, size = '1024x1024', n = 1, images = [] } = {}) {
  const p = provider || providers.defaultOf('image');
  if (!p) throw new Error('尚未接入图像模型，请到「模型接入」添加');
  const base = norm(p);
  // 图生图：部分兼容接口用 /images/edits 或直接在 generations 传 image
  const path = images.length ? (p.editPath || '/images/generations') : '/images/generations';
  const body = { model: p.model, prompt, n, size };
  if (images.length) body.image = images[0];
  const res = await request(base + path, { headers: authHeaders(p.apiKey), body, timeout: 180000 });
  const b = res.body || {};
  let url = b?.data?.[0]?.url || b?.data?.[0]?.image_url || b?.output?.url || b?.url;
  if (!url && b?.data?.[0]?.b64_json) url = 'data:image/png;base64,' + b.data[0].b64_json;
  if (!url && b?.images?.[0]?.url) url = b.images[0].url;
  if (!url) throw new Error('图像生成失败：' + JSON.stringify(b).slice(0, 250));
  return { url, raw: b };
}

/* ---------- 视频（异步任务轮询，兼容主流结构） ---------- */
export async function genVideo(prompt, { provider, images = [], duration = 5, ratio = '16:9', motion, firstFrame, lastFrame, onProgress } = {}) {
  const p = provider || providers.defaultOf('video');
  if (!p) throw new Error('尚未接入视频模型，请到「模型接入」添加');
  const base = norm(p);
  const submitPath = p.submitPath || '/video/generations';
  const queryPath = p.queryPath || '/video/status';
  let full = prompt || 'cinematic shot';
  if (motion) full += `（运镜要求：${motion}）`;
  const body = { model: p.model, prompt: full };
  /* 首尾帧作为参考图注入：图生视频补间最常用 */
  const imgs = [...images];
  if (firstFrame) imgs.unshift(firstFrame);
  if (lastFrame) imgs.push(lastFrame);
  if (imgs.length) body.images = imgs;
  /* 实测 Agnes 拒绝 duration 等字段，默认不注入；时长/画幅写进 prompt 即可。需要额外参数时在模型接入里填 extra（JSON） */
  if (p.extra) {
    try { Object.assign(body, typeof p.extra === 'string' ? JSON.parse(p.extra) : p.extra); } catch { /* 忽略 */ }
  }

  onProgress?.('提交任务…');
  const res = await request(base + submitPath, { headers: authHeaders(p.apiKey), body, timeout: 90000 });
  const b = res.body || {};

  const direct = b?.video_url || b?.url || b?.data?.video_url || b?.data?.url || b?.output?.video_url;
  if (direct) return { url: direct, raw: b };

  const id = b?.id || b?.task_id || b?.data?.id || b?.data?.task_id || b?.output?.id;
  if (!id) throw new Error('视频任务提交失败（未取到任务 ID）：' + JSON.stringify(b).slice(0, 250));

  for (let i = 0; i < 120; i++) {
    await new Promise(r => setTimeout(r, 4000));
    onProgress?.(`生成中… ${Math.min(100, Math.round(i * 100 / 60))}%`);
    let s;
    try {
      s = await request(`${base}${queryPath}?id=${encodeURIComponent(id)}`, {
        method: 'GET', headers: authHeaders(p.apiKey), timeout: 30000
      });
    } catch (e) { continue; }
    const sb = s.body || {};
    const st = String(sb?.status || sb?.data?.status || sb?.state || '').toLowerCase();
    const done = ['success', 'succeeded', 'completed', 'done', 'finished'].includes(st);
    const fail = ['failed', 'error', 'cancelled'].includes(st);
    const url = sb?.video_url || sb?.url || sb?.data?.video_url || sb?.data?.url || sb?.output?.video_url
      || sb?.result?.video_url || (Array.isArray(sb?.data?.videos) ? sb.data.videos[0]?.url : null);
    if (done || url) {
      if (!url) throw new Error('任务完成但未返回视频地址：' + JSON.stringify(sb).slice(0, 200));
      return { url, raw: sb };
    }
    if (fail) throw new Error('视频生成失败：' + JSON.stringify(sb).slice(0, 200));
  }
  throw new Error('视频生成超时，请到提供商后台查看任务结果');
}

/* ---------- 连通性自检 ---------- */
export async function testProvider(p) {
  /* 先做本地校验，省掉一次注定失败的请求 */
  if (!p.baseUrl) return { ok: false, msg: '还没填 Base URL' };
  if (!p.model) return { ok: false, msg: '还没填模型名' };
  if (p.type !== 'video' && !p.apiKey) return { ok: false, msg: '还没填 API Key' };
  const t0 = Date.now();
  try {
    if (p.type === 'text') {
      const t = await chat('回复OK两个字', { provider: p, timeout: 30000 });
      return { ok: true, msg: `连通正常（${Date.now() - t0}ms）：` + String(t).replace(/\s+/g, ' ').slice(0, 30) };
    }
    if (p.type === 'image') {
      const r = await genImage('a small white cat', { provider: p, size: '512x512' });
      return { ok: true, msg: `图像可用（${Date.now() - t0}ms）`, url: r.url };
    }
    if (p.type === 'video') {
      return { ok: true, msg: '配置已保存（视频测试会消耗额度，已跳过实际生成）' };
    }
  } catch (e) { return { ok: false, msg: String(e?.message || e) }; }
  return { ok: false, msg: '未知类型' };
}
