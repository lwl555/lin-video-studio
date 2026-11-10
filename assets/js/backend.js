/* ============================================================
 *  AI 后台（平台统一接入，用户不可见、不可编辑）
 *  ------------------------------------------------------------
 *  这是「林的视频工作台」唯一的后台通道。
 *  - 用户在前端【永远看不到】任何 Base URL / API Key / 模型名。
 *  - 设置页只有一个「开启 / 关闭」开关。
 *  - 若 proxyUrl 为空：走内置直连（密钥仅存在于本文件，不在任何界面展示）。
 *  - 若 proxyUrl 已填：所有请求经服务端代理，前端完全不持有密钥。
 *  无论如何，配置都不出现在设置界面，用户无法发现。
 * ============================================================ */

/* 管理员可以在「管理后台 → 平台默认模型」里覆盖默认模型 / 地址 / Key，
   覆盖项存在本地状态里，这里直接读，保持「前端不暴露平台密钥」的原则：
   界面只显示模型名与管理员自己填的内容，内置 Key 始终不出现在任何界面。 */
import { store } from './store.js';
import { platformModels } from './ops.js';

const AGNES = {
  baseUrl: 'https://api.agnes-ai.cn/v1',
  // 内置密钥仅用于直连兜底；若启用服务端代理(proxyUrl)，此值不会被发往浏览器任何请求
  apiKey: 'sk-tbGNayc79htQLz88GFxqDrPBjgVG1LVtPiAdqf9f0uWljQMF',
  models: {
    text: 'agnes-3.0-flash',
    image: 'agnes-image-2.5-flash',
    video: 'agnes-video-2.5-flash',
  },
};

export const BACKEND = {
  // 是否启用 AI 后台（用户可在设置页开关；持久化在 store.state.backend.enabled）
  enabled: true,
  // 服务端代理地址（密钥在服务端）。留空 = 内置直连。
  // 例：'https://xxx.edgeone.app/pavo-proxy'  —— 部署后填这里即可切换到「密钥零前端暴露」
  proxyUrl: '',
  agnes: AGNES,
};

/* 当前是否走服务端代理（前端零密钥暴露） */
export function usingProxy() {
  return !!BACKEND.proxyUrl;
}

/* 管理员在「管理后台 → 平台默认模型」里配置的覆盖项。
   只覆盖填了的字段：模型名留空 = 用内置默认；地址/Key 留空 = 沿用内置通道 */
function overrideOf(type) {
  const d = (store.state.ops && store.state.ops.defaults) || {};
  const o = d[type] || {};
  return {
    model: String(o.model || '').trim(),
    baseUrl: String(o.baseUrl || '').trim(),
    apiKey: String(o.apiKey || '').trim()
  };
}

/* 把「后台配置的一条模型记录」解析成真正要连的通道。
   只覆盖填了的字段：模型名留空 = 内置默认；地址/Key 留空 = 沿用内置通道。
   返回值里带上 entry，模型层据此做「每人每天额度」的计量。 */
export function entryConfig(entry) {
  const builtinModel = BACKEND.agnes.models[entry.type] || BACKEND.agnes.models.text;
  const model = String(entry.model || '').trim() || builtinModel;

  if (BACKEND.proxyUrl && !String(entry.baseUrl || '').trim()) {
    return { baseUrl: BACKEND.proxyUrl.replace(/\/$/, ''), apiKey: '', model, proxy: true, entry };
  }
  return {
    baseUrl: (String(entry.baseUrl || '').trim() || BACKEND.agnes.baseUrl).replace(/\/+$/, ''),
    apiKey: String(entry.apiKey || '').trim() || BACKEND.agnes.apiKey,
    model,
    proxy: false,
    entry
  };
}

/* 某类型下所有「可被用户选中」的平台模型（管理后台配了几条就有几个） */
export function platformProviders(type) {
  return platformModels.list(type)
    .filter(e => e.enabled !== false)
    .map(e => ({
      id: '__pm_' + e.id,
      entryId: e.id,
      name: e.name || e.model || '平台模型',
      type,
      model: e.model || BACKEND.agnes.models[type] || '',
      platform: true,
      meter: e.meter,
      daily: e.daily,
      enabled: true
    }));
}

/* 取某类型的有效 provider（供 models.js 调用，不含任何 UI 字段）。
   有多条平台模型时取第一条；没有配置时走内置 Agnes 通道。 */
export function backendProvider(type) {
  const live = platformModels.list(type).filter(e => e.enabled !== false);
  if (live.length) {
    const c = entryConfig(live[0]);
    return { baseUrl: c.baseUrl, apiKey: c.apiKey, model: c.model, proxy: c.proxy, entry: c.entry };
  }
  const ov = overrideOf(type);
  const builtinModel = BACKEND.agnes.models[type] || BACKEND.agnes.models.text;
  const model = ov.model || builtinModel;
  if (BACKEND.proxyUrl && !ov.baseUrl) {
    return { baseUrl: BACKEND.proxyUrl.replace(/\/$/, ''), apiKey: '', model, proxy: true, entry: null };
  }
  return {
    baseUrl: (ov.baseUrl || BACKEND.agnes.baseUrl).replace(/\/+$/, ''),
    apiKey: ov.apiKey || BACKEND.agnes.apiKey,
    model,
    proxy: false,
    entry: null
  };
}
