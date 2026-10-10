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

/* 取某类型的有效 provider（供 models.js 调用，不含任何 UI 字段） */
export function backendProvider(type) {
  const m = BACKEND.agnes.models[type] || BACKEND.agnes.models.text;
  if (BACKEND.proxyUrl) {
    // 代理模式：前端只把请求发给代理，密钥由代理侧注入
    return { baseUrl: BACKEND.proxyUrl.replace(/\/$/, ''), apiKey: '', model: m, proxy: true };
  }
  return { baseUrl: BACKEND.agnes.baseUrl, apiKey: BACKEND.agnes.apiKey, model: m, proxy: false };
}
