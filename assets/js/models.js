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
  { key: 'agnes-vid2', name: 'Agnes Video 2.5', type: 'video', baseUrl: 'https://api.agnes-ai.cn/v1', model: 'agnes-video-2.5-flash' },
  { key: 'sf-vid', name: '硅基流动 视频', type: 'video', baseUrl: 'https://api.siliconflow.cn/v1', model: 'Wan-AI/Wan2.2-T2V-A14B' },
  { key: 'custom', name: '自定义', type: 'text', baseUrl: '', model: '' }
];

export const TYPE_LABEL = { text: '文本/剧情', image: '图像', video: '视频', audio: '音频/TTS（预留）' };

/* 当列表为空（用户不再手动配置模型）时，用预配置后台充当默认 provider，
   这样首页 / 图像 / 视频 / 画布等原有的「模型选择器」不会退化成「未接入」 */
function backendAsProvider(t) {
  /* 模型名是公开标识（agnes-3.0-flash 等），不是密钥也不是地址，可放心展示，
     这样首页模型条 / 图像·视频下拉能直接看到平台当前用的是哪个模型 */
  const m = backendProvider(t).model || '已连接';
  return { id: '__backend', name: '平台 AI 后台', type: t, model: m, enabled: true, apiKey: '', baseUrl: '' };
}
export const providers = {
  all: () => { const a = store.list('providers'); return a.length ? a : [backendAsProvider('text'), backendAsProvider('image'), backendAsProvider('video')]; },
  /* 平台后台永远排第一位（默认可用、开箱即用）；用户自带的模型排在其后，可在下拉里自行切换 */
  byType: t => [backendAsProvider(t), ...store.list('providers').filter(p => p.type === t && p.enabled !== false)],
  defaultOf: t => providers.byType(t)[0] || null,
  add(p) { return store.add('providers', { id: uid('pv'), enabled: true, ...p }); },
  update(id, patch) { return store.update('providers', id, patch); },
  remove(id) { store.remove('providers', id); },
  get(id) { return store.find('providers', id); }
};

/* ---------- 后端通道：平台预配置，用户完全不可见 ---------- */
import { BACKEND, backendProvider } from './backend.js';
const DEFAULT_TIMEOUT = 60000;

/* 后台是否启用（用户可在「设置」开关，持久化在 store.state.backend.enabled） */
function backendOn() {
  const b = store.state.backend;
  return b ? b.enabled !== false : BACKEND.enabled;
}

/* 把一个「视图里选中的模型」解析成真正要连的通道：
   - 用户自己添加的模型（有 Base URL / Key）→ 走他自己的地址与 Key
   - 平台占位 provider / 未选 → 走平台预配置后台（配置对用户不可见） */
function resolveConn(sel, type) {
  if (sel && sel.id && sel.id !== '__backend' && (sel.baseUrl || sel.apiKey)) {
    const base = String(sel.baseUrl || '').replace(/\/+$/, '');
    if (!base) throw new Error('这个模型没填 Base URL，去「模型接入 → 我的模型」补全');
    if (!sel.apiKey) throw new Error('这个模型没填 API Key，去「模型接入 → 我的模型」补全');
    return { baseUrl: base, apiKey: sel.apiKey, model: sel.model || '', own: true };
  }
  const b = backendProvider(type);
  return { baseUrl: String(b.baseUrl).replace(/\/+$/, ''), apiKey: b.apiKey || '', model: b.model, own: false, proxy: !!b.proxy };
}

async function request(path, { base, own = false, method = 'POST', headers = {}, body, timeout = DEFAULT_TIMEOUT } = {}) {
  if (!backendOn()) throw new Error('AI 后台未启用，请到「设置 → AI 后台服务」开启');
  /* 走服务端代理时，前端只把请求发到代理地址，密钥由代理侧注入，前端零暴露 */
  const _base = String(base || BACKEND.proxyUrl || BACKEND.agnes.baseUrl).replace(/\/$/, '');
  /* path 传绝对 URL 时（如 Agnes 视频轮询 /agnesapi）直接使用；平台走服务端代理时仍强制经代理 */
  const abs = /^https?:\/\//.test(path);
  const url = abs
    ? ((BACKEND.proxyUrl && !base) ? _base + new URL(path).pathname + new URL(path).search : path)
    : _base + path;
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), timeout);
  const secs = Math.round(timeout / 1000);
  try {
    const r = await fetch(url, {
      method,
      headers: { 'Content-Type': 'application/json', ...headers },
      body: body ? JSON.stringify(body) : undefined,
      signal: ctl.signal
    });
    const txt = await r.text();
    if (!r.ok) {
      let hint = '';
      if (r.status === 401 || r.status === 403) hint = own
        ? '（你的 Key 无效、或该模型你没权限 → 去「模型接入 → 我的模型」检查）'
        : '（后端密钥无效或模型无权限，请联系平台）';
      else if (r.status === 404) hint = '（模型名或路径不对）';
      else if (r.status === 429) hint = '（触发限流，等 1 分钟再试）';
      throw new Error(`HTTP ${r.status}${hint} ${txt.slice(0, 240)}`);
    }
    let j; try { j = JSON.parse(txt); } catch { j = { raw: txt }; }
    return { status: r.status, body: j };
  } catch (e) {
    if (e?.name === 'AbortError') throw new Error(`请求超时（${secs} 秒无响应）`);
    if (e instanceof TypeError) throw new Error(`连不上模型服务（${e.message || '网络错误'}）`);
    throw e;
  } finally {
    clearTimeout(timer);
  }
}

function authHeaders(key) {
  return key ? { Authorization: `Bearer ${key}` } : {};
}

/* ---------- 文本 ---------- */
export async function chat(prompt, { provider, system = '', json = false, temperature = 0.8, images = [], timeout } = {}) {
  const p = resolveConn(provider, 'text');
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
  const res = await request('/chat/completions', { base: p.baseUrl, own: p.own, headers: authHeaders(p.apiKey), body, timeout });
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
  const p = resolveConn(provider, 'image');
  const body = { model: p.model, prompt, n, size };
  if (images.length) body.image = images[0];
  const res = await request('/images/generations', { base: p.baseUrl, own: p.own, headers: authHeaders(p.apiKey), body, timeout: 180000 });
  const b = res.body || {};
  let url = b?.data?.[0]?.url || b?.data?.[0]?.image_url || b?.output?.url || b?.url;
  if (!url && b?.data?.[0]?.b64_json) url = 'data:image/png;base64,' + b.data[0].b64_json;
  if (!url && b?.images?.[0]?.url) url = b.images[0].url;
  if (!url) throw new Error('图像生成失败：' + JSON.stringify(b).slice(0, 250));
  return { url, raw: b };
}

/* ---------- 视频（Agnes 异步任务：POST /v1/videos → GET /agnesapi?video_id=） ---------- */
export async function genVideo(prompt, { provider, images = [], duration = 5, ratio = '16:9', motion, firstFrame, lastFrame, onProgress } = {}) {
  const p = resolveConn(provider, 'video');
  const base = p.baseUrl;                                          // 例如 https://api.agnes-ai.cn/v1
  /* Agnes Video 2.5：创建在 {base}/videos，轮询在 {origin}/agnesapi（注意不带 /v1）；
     其它家（用户自带）走通用的 /video/generations + /video/status */
  const isAgnes = p.own ? /agnes-ai\.(cn|com)/i.test(base) : true;
  const origin = base.replace(/\/(?:v1|v3|api\/v3)\/?$/, '');
  const submitPath = isAgnes ? '/videos' : '/video/generations';
  const pollUrl = id => isAgnes
    ? `${origin}/agnesapi?video_id=${encodeURIComponent(id)}&model_name=${encodeURIComponent(p.model)}`
    : `${base}/video/status?id=${encodeURIComponent(id)}`;

  let full = prompt || 'cinematic shot';
  if (motion) full += `（运镜要求：${motion}）`;

  const body = {
    model: p.model,
    prompt: full,
    seconds: String(Math.min(12, Math.max(4, Math.round(duration) || 5))),
    size: '720P',
    aspect_ratio: ratio || '16:9'
  };

  /* mode：有首/尾帧 → keyframe；有多参考图 → reference；否则 text */
  if (firstFrame || lastFrame) {
    body.mode = 'keyframe';
    if (firstFrame) body.first_frame = firstFrame;
    if (lastFrame) body.last_frame = lastFrame;
  } else {
    const imgs = [...images].filter(Boolean);
    if (imgs.length) { body.mode = 'reference'; body.images = imgs; }
    else body.mode = 'text';
  }

  onProgress?.('提交视频任务…');
  const res = await request(submitPath, { base, own: p.own, headers: authHeaders(p.apiKey), body, timeout: 90000 });
  const b = res.body || {};
  const direct = b?.video_url || b?.url || b?.data?.url;
  if (direct) return { url: direct, raw: b };
  const id = b?.video_id || b?.id || b?.task_id || b?.data?.video_id || b?.data?.id;
  if (!id) throw new Error('视频任务提交失败（未取到任务 ID）：' + JSON.stringify(b).slice(0, 250));

  for (let i = 0; i < 150; i++) {
    await new Promise(r => setTimeout(r, 4000));
    onProgress?.(`生成中… ${Math.min(99, Math.round(i * 100 / 40))}%`);
    let s;
    try {
      s = await request(pollUrl(id), { base, own: p.own, method: 'GET', headers: authHeaders(p.apiKey), timeout: 30000 });
    } catch (e) { continue; }
    const sb = s.body || {};
    const st = String(sb?.status || sb?.internal_status || sb?.data?.status || '').toLowerCase();
    const done = ['completed', 'succeeded', 'success', 'done', 'finished'].includes(st);
    const fail = ['failed', 'error', 'cancelled'].includes(st);
    const url = sb?.url || sb?.video_url || sb?.data?.url || sb?.result?.url;
    if (done) {
      if (!url) throw new Error('任务完成但未返回视频地址：' + JSON.stringify(sb).slice(0, 200));
      return { url, raw: sb };
    }
    if (url) return { url, raw: sb };
    if (fail) throw new Error('视频生成失败：' + JSON.stringify(sb.error || sb).slice(0, 200));
  }
  throw new Error('视频生成超时，请稍后重试');
}

/* ---------- 后端连通性自检（供设置页「测试连接」） ---------- */
export async function testBackend() {
  if (!backendOn()) return { ok: false, msg: 'AI 后台已关闭' };
  const t0 = Date.now();
  try {
    const t = await chat('回复OK两个字', { timeout: 30000 });
    return { ok: true, msg: `连通正常（${Date.now() - t0}ms）：` + String(t).replace(/\s+/g, ' ').slice(0, 30) };
  } catch (e) { return { ok: false, msg: String(e?.message || e) }; }
}
