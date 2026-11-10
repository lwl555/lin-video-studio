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

/* 取某类型的有效 provider（供 models.js 调用，不含任何 UI 字段） */
export function backendProvider(type) {
  const ov = overrideOf(type);
  const builtinModel = BACKEND.agnes.models[type] || BACKEND.agnes.models.text;
  const model = ov.model || builtinModel;

  /* 代理模式：前端只把请求发给代理，密钥由代理侧注入。
     管理员如果单独给这个类型指了地址，则优先按管理员配置直连 */
  if (BACKEND.proxyUrl && !ov.baseUrl) {
    return { baseUrl: BACKEND.proxyUrl.replace(/\/$/, ''), apiKey: '', model, proxy: true };
  }
  return {
    baseUrl: (ov.baseUrl || BACKEND.agnes.baseUrl).replace(/\/+$/, ''),
    apiKey: ov.apiKey || BACKEND.agnes.apiKey,
    model,
    proxy: false
  };
}
