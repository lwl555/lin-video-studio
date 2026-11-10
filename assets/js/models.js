/* ============ 模型接入层（BYOK） ============ */
import { store, uid } from './store.js';
import { ensureQuota, addUsage, modelUsageOf, addModelUsage } from './usage.js';
import { quoteImage, quoteVideo, quoteText, assertAffordable, settle, TEXT_COST_LABEL } from './points.js';

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

/* 当列表为空时，用预配置后台充当默认 provider，
   这样首页 / 图像 / 视频 / 画布等原有的「模型选择器」不会退化成「未接入」 */
function backendAsProvider(t) {
  const m = backendProvider(t).model || '已连接';
  return { id: '__backend', name: '平台 AI 后台', type: t, model: m, enabled: true, apiKey: '', baseUrl: '', platform: true };
}

/* 平台模型列表：管理后台配了几条就有几条；一条都没配时给一个内置兜底条目，
   保证老用户的下拉和「生成」按钮不会突然空掉 */
function platformList(t) {
  const list = platformProviders(t);
  return list.length ? list : [backendAsProvider(t)];
}

export const providers = {
  all: () => [...platformList('text'), ...platformList('image'), ...platformList('video'), ...store.list('providers')],
  /* 平台配的模型永远排前面（开箱即用）；用户自带的 BYOK 排后面 */
  byType: t => [...platformList(t), ...store.list('providers').filter(p => p.type === t && p.enabled !== false)],
  defaultOf: t => providers.byType(t)[0] || null,
  add(p) { return store.add('providers', { id: uid('pv'), enabled: true, ...p }); },
  update(id, patch) { return store.update('providers', id, patch); },
  remove(id) { store.remove('providers', id); },
  get(id) { return store.find('providers', id); }
};

/* ---------- 功能 → 模型 路由（设置页可配置，随时切换） ---------- */
export const FEATURES = [
  { key: 'image',      label: '图片生成',        type: 'image', hint: '图片工作台' },
  { key: 'video',      label: '视频生成',        type: 'video', hint: '视频工作台' },
  { key: 'agentText',  label: '剧情 / Agent · 文本', type: 'text',  hint: '方案、角色场景、分镜、自然语言调整' },
  { key: 'agentImage', label: '剧情 / Agent · 图像', type: 'image', hint: '定妆图、关键帧' },
  { key: 'agentVideo', label: '剧情 / Agent · 视频', type: 'video', hint: '镜头视频' },
];

/* 取某功能配置的模型；没配或配的模型被删了 → 返回 null，走平台默认 */
export function featureProvider(feature) {
  if (!feature) return null;
  const id = (store.state.modelRoute || {})[feature];
  if (!id || id === '__default') return null;
  const p = store.find('providers', id);
  return p && p.enabled !== false ? p : null;
}

/* ---------- 失败自动重试 ---------- */
const sleepMs = ms => new Promise(r => setTimeout(r, ms));
function autoRetryOn() { return (store.state.settings || {}).autoRetry !== false; }

async function withRetry(fn, { tries = 3, base = 800 } = {}) {
  const n = autoRetryOn() ? Math.max(1, tries) : 1;
  let last;
  for (let i = 0; i < n; i++) {
    try { return await fn(i); }
    catch (e) {
      last = e;
      if (i < n - 1) await sleepMs(base * (i + 1));
    }
  }
  throw last;
}

/* ---------- 后端通道：平台预配置，用户完全不可见 ---------- */
import { BACKEND, backendProvider, platformProviders, entryConfig } from './backend.js';
import { platformModels } from './ops.js';
const DEFAULT_TIMEOUT = 60000;

/* ---------- 平台模型「每人每天额度」（管理后台逐条配） ----------
   meter=count：按次；meter=points：按价目表的积分口径
   管理员不受限，但照样计数，方便后台看真实消耗 */
function assertModelQuota(conn) {
  const e = conn && conn.entry;
  if (!e || !e.daily) return;
  if (store.state.session?.role === 'admin') return;
  const acct = store.state.session?.account || '';
  if (!acct) return;
  const used = modelUsageOf(acct, e.id);
  if (used < e.daily) return;
  const unit = e.meter === 'points' ? '积分' : '次';
  const err = new Error(`「${e.name || e.model}」今天的额度已用完（${used}/${e.daily} ${unit}），明天 0 点重置。可以在模型下拉里换一个模型继续。`);
  err.modelQuotaExceeded = true;
  throw err;
}

function chargeModelQuota(conn, amount) {
  const e = conn && conn.entry;
  if (!e || !e.daily) return;
  const acct = store.state.session?.account || '';
  if (!acct) return;
  addModelUsage(acct, e.id, e.meter === 'points' ? Math.max(0, Math.round(Number(amount) || 0)) : 1);
}

/* 后台是否启用（用户可在「设置」开关，持久化在 store.state.backend.enabled） */
function backendOn() {
  const b = store.state.backend;
  return b ? b.enabled !== false : BACKEND.enabled;
}

/* 把一个「视图里选中的模型」解析成真正要连的通道：
   - 用户自己添加的模型（有 Base URL / Key）→ 走他自己的地址与 Key
   - 平台占位 provider / 未选 → 走平台预配置后台（配置对用户不可见） */
function resolveConn(sel, type) {
  /* 1) 管理后台配置的平台模型条目（用户在下拉里选中的那一条） */
  if (sel && sel.entryId) {
    const e = platformModels.byId(sel.entryId);
    if (e) return entryConfig(e);
  }
  /* 2) 用户自己添加的模型（有 Base URL / Key）→ 走他自己的地址与 Key */
  if (sel && sel.id && sel.id !== '__backend' && (sel.baseUrl || sel.apiKey)) {
    const base = String(sel.baseUrl || '').replace(/\/+$/, '');
    if (!base) throw new Error('这个模型没填 Base URL，去「模型接入 → 我的模型」补全');
    if (!sel.apiKey) throw new Error('这个模型没填 API Key，去「模型接入 → 我的模型」补全');
    return { baseUrl: base, apiKey: sel.apiKey, model: sel.model || '', own: true, entry: null };
  }
  /* 3) 平台默认：第一条平台模型，或内置 Agnes 通道 */
  const b = backendProvider(type);
  return {
    baseUrl: String(b.baseUrl).replace(/\/+$/, ''),
    apiKey: b.apiKey || '',
    model: b.model,
    own: false,
    proxy: !!b.proxy,
    entry: b.entry || null
  };
}

async function request(path, { base, own = false, method = 'POST', headers = {}, body, timeout = DEFAULT_TIMEOUT, __alt = false } = {}) {
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
    if (e instanceof TypeError) {
      /* 网络层失败。注意：视频端点 /v1/videos 在限流时会给「无 CORS 头的 429」，
         浏览器同样表现为 TypeError，所以这里要允许上层按 .network 重试。 */
      const altBase = !__alt && /api\.agnes-ai\.cn/.test(String(base || ''))
        ? String(base).replace('api.agnes-ai.cn', 'apihub.agnes-ai.com')
        : '';
      if (altBase) {
        try {
          return await request(path, { base: altBase, own, method, headers, body, timeout, __alt: true });
        } catch (e2) { /* 备用也失败，落到下面统一报错 */ }
      }
      const err = new Error(`连不上模型服务：可能 ①手机网络/DNS 解析不了 api.agnes-ai.cn（已自动试过备用域名）；` +
        `②服务端限流/排队时返回的头不完整，浏览器会误报成跨域失败（视频通道最常见）；` +
        `③浏览器插件拦截；④代理未生效。`);
      err.network = true;
      throw err;
    }
    throw e;
  } finally {
    clearTimeout(timer);
  }
}

function authHeaders(key) {
  return key ? { Authorization: `Bearer ${key}` } : {};
}

/* ---------- 文本 ---------- */
/* temperature 0.7：结构化输出（方案 / 分镜 / JSON）比 0.8 更稳，文案又不至于干瘪 */
export async function chat(prompt, { provider, feature, system = '', json = false, temperature = 0.7, images = [], timeout, metering = true, costKind = 'optimize' } = {}) {
  let bill = null;
  if (metering) { ensureQuota('text'); bill = assertAffordable('text', quoteText(costKind)); }
  const p = resolveConn(provider || featureProvider(feature), 'text');
  if (metering) assertModelQuota(p);          /* 该模型的每人每天额度 */
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
  const res = await withRetry(
    () => request('/chat/completions', { base: p.baseUrl, own: p.own, headers: authHeaders(p.apiKey), body, timeout }),
    { tries: 3 });
  const b = res.body || {};
  const text = b?.choices?.[0]?.message?.content
    ?? b?.choices?.[0]?.text
    ?? b?.output?.text
    ?? (typeof b.raw === 'string' ? b.raw : '');
  if (!text) throw new Error('模型返回为空：' + JSON.stringify(b).slice(0, 200));
  if (metering) {
    addUsage('text');
    settle('text', bill, TEXT_COST_LABEL[costKind] || '文本生成');
    chargeModelQuota(p, quoteText(costKind));
  }   /* 拿到了内容才算一次用量+扣费 */
  if (json) {
    const m = String(text).match(/\{[\s\S]*\}|\[[\s\S]*\]/);
    if (!m) throw new Error('模型未返回 JSON');
    try { return JSON.parse(m[0]); } catch { throw new Error('JSON 解析失败'); }
  }
  return String(text).trim();
}

/* ---------- 图像 ---------- */
export async function genImage(prompt, { provider, feature, size = '1024x1024', n = 1, images = [] } = {}) {
  ensureQuota('image');
  /* 额度内不扣积分；额度外要求余额够，否则抛错（按钮据此提示充值） */
  const imgCost = quoteImage(size, { withRef: images.length > 0, n });
  const bill = assertAffordable('image', imgCost);
  const p = resolveConn(provider || featureProvider(feature), 'image');
  assertModelQuota(p);                        /* 该模型的每人每天额度 */
  const body = { model: p.model, prompt, n, size };
  const refs = (images || []).filter(Boolean).slice(0, 3);
  if (refs.length) body.image = refs[0];          /* 主参考图：所有图生图模型都认 */
  /* 多参考字段默认不发：实测 Agnes 文生图队列会直接 400（"images 不是文生图队列支持的字段"）。
     换成支持 images 数组的服务后，把 settings.multiRefImages 设为 true 即可开启 */
  const multiRef = (store.state.settings || {}).multiRefImages === true;
  if (refs.length > 1 && multiRef) body.images = refs;

  let res;
  try {
    res = await withRetry(
      () => request('/images/generations', { base: p.baseUrl, own: p.own, headers: authHeaders(p.apiKey), body, timeout: 180000 }),
      { tries: 2, base: 1200 });
  } catch (e) {
    /* 多图字段一旦被拒（4xx）或直接把连接打崩（TypeError），退回只发主参考图再试一次 */
    if (body.images) {
      const b2 = { ...body };
      delete b2.images;
      res = await withRetry(
        () => request('/images/generations', { base: p.baseUrl, own: p.own, headers: authHeaders(p.apiKey), body: b2, timeout: 180000 }),
        { tries: 2, base: 1200 });
    } else throw e;
  }
  const b = res.body || {};
  let url = b?.data?.[0]?.url || b?.data?.[0]?.image_url || b?.output?.url || b?.url;
  if (!url && b?.data?.[0]?.b64_json) url = 'data:image/png;base64,' + b.data[0].b64_json;
  if (!url && b?.images?.[0]?.url) url = b.images[0].url;
  if (!url) throw new Error('图像生成失败：' + JSON.stringify(b).slice(0, 250));
  addUsage('image', Math.max(1, Math.round(Number(n) || 1)));   /* 按张数计 */
  settle('image', bill, `图片 ${size}${refs.length > 1 ? ' · 多参考图' : refs.length ? ' · 图生图' : ''}`);
  chargeModelQuota(p, imgCost);
  return { url, raw: b };
}

/* ---------- 视频（Agnes 异步任务：POST /v1/videos → GET /agnesapi?video_id=） ---------- */
export async function genVideo(prompt, { provider, feature, images = [], duration = 5, ratio = '16:9', motion, firstFrame, lastFrame, onProgress } = {}) {
  ensureQuota('video');
  /* 按秒计价：480P 3/秒、720P 8/秒、2K 15/秒；首尾帧 +20%，参考图 +30% */
  const vidCost = quoteVideo(duration, {
    resolution: '720P',
    keyframe: !!(firstFrame || lastFrame),
    ref: images.filter(Boolean).length > 0
  });
  const bill = assertAffordable('video', vidCost);
  const p = resolveConn(provider || featureProvider(feature), 'video');
  assertModelQuota(p);                        /* 该模型的每人每天额度 */
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
  /* 视频通道免费档很挤：排队/限流时服务端返回「无 CORS 头的 429」，浏览器只会给一个
     TypeError。所以这里按网络错误与 429/503 退避重试，别让用户以为是自己网络断了。 */
  const waits = [0, 8000, 20000, 40000];
  let lastErr = null;
  let res = null;
  for (let attempt = 0; attempt < waits.length; attempt++) {
    if (waits[attempt]) {
      onProgress?.(`视频通道排队中，${Math.round(waits[attempt] / 1000)} 秒后重试（${attempt}/${waits.length - 1}）…`);
      await new Promise(r => setTimeout(r, waits[attempt]));
      onProgress?.('提交视频任务…');
    }
    try {
      res = await request(submitPath, { base, own: p.own, headers: authHeaders(p.apiKey), body, timeout: 90000 });
      lastErr = null;
      break;
    } catch (e) {
      lastErr = e;
      const retryable = e && (e.network === true || /HTTP (429|503)/.test(String(e.message)));
      if (!retryable) throw e;
      if (attempt === waits.length - 1) {
        throw new Error('视频通道一直在排队或限流（免费档常见，不是你的网络问题）。' +
          '过 1-2 分钟再试，或把视频模型换成别的通道；文字和图片不受影响。');
      }
    }
  }
  if (!res && lastErr) throw lastErr;
  const b = res.body || {};
  const direct = b?.video_url || b?.url || b?.data?.url;
  if (direct) { addUsage('video'); settle('video', bill, `视频 ${duration}s`); chargeModelQuota(p, vidCost); return { url: direct, raw: b }; }
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
      addUsage('video'); settle('video', bill, `视频 ${duration}s`); chargeModelQuota(p, vidCost);
      return { url, raw: sb };
    }
    if (url) { addUsage('video'); settle('video', bill, `视频 ${duration}s`); chargeModelQuota(p, vidCost); return { url, raw: sb }; }
    if (fail) throw new Error('视频生成失败：' + JSON.stringify(sb.error || sb).slice(0, 200));
  }
  throw new Error('视频生成超时，请稍后重试');
}

/* ---------- 后端连通性自检（供设置页「测试连接」） ---------- */
export async function testBackend() {
  if (!backendOn()) return { ok: false, msg: 'AI 后台已关闭' };
  const t0 = Date.now();
  try {
    const t = await chat('回复OK两个字', { timeout: 30000, metering: false });
    return { ok: true, msg: `连通正常（${Date.now() - t0}ms）：` + String(t).replace(/\s+/g, ' ').slice(0, 30) };
  } catch (e) { return { ok: false, msg: String(e?.message || e) }; }
}
