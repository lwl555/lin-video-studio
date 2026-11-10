/* Supabase Edge Function: media-proxy
 * ------------------------------------------------------------
 * 只做一件事：把「不带 CORS 头」的外部素材转发给浏览器，并补上 CORS 头。
 * 为什么需要它：Agnes 的输出素材域名（cos-platform-outputs.agnes-ai.cn）
 * 响应里没有 access-control-allow-origin，浏览器就：
 *   · canvas.drawImage 之后 toDataURL 抛 SecurityError（画布被污染）
 *   · fetch(videoUrl) 直接 TypeError
 * 于是「从已生成视频里截片头/片尾帧」在前端根本做不到。
 * 走这个函数取回字节 → 转成 blob: URL（同源）→ video 解码 → canvas 抽帧就通了。
 *
 * 安全：只放行白名单域名，不做通用开放代理（避免被拿去当跳板）。
 * 部署：Dashboard → Edge Functions → 新建 media-proxy → 粘这段 → 关掉 Verify JWT → Deploy
 */

const ALLOW_HOSTS = [
  'cos-platform-outputs.agnes-ai.cn',   // Agnes 输出素材（图/视频）
  'api.agnes-ai.cn',                    // 个别接口会直接回二进制
];

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': '*',
  'Access-Control-Max-Age': '86400',
};

const json = (obj, status) =>
  new Response(JSON.stringify(obj), {
    status,
    headers: { ...CORS, 'Content-Type': 'application/json' },
  });

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  if (req.method !== 'GET') return json({ error: 'only GET' }, 405);

  const raw = new URL(req.url).searchParams.get('url');
  if (!raw) return json({ error: 'missing ?url=' }, 400);

  let target: URL;
  try {
    target = new URL(raw);
  } catch {
    return json({ error: 'bad url' }, 400);
  }
  if (target.protocol !== 'https:') return json({ error: 'https only' }, 400);

  const hostOk = ALLOW_HOSTS.some(
    (h) => target.hostname === h || target.hostname.endsWith('.' + h),
  );
  if (!hostOk) return json({ error: 'host not allowed', host: target.hostname }, 403);

  let up: Response;
  try {
    up = await fetch(target.toString(), { headers: { 'User-Agent': 'pavo-media-proxy' } });
  } catch (e) {
    return json({ error: 'upstream failed', detail: String(e) }, 502);
  }

  const headers = new Headers(CORS);
  headers.set('Content-Type', up.headers.get('content-type') || 'application/octet-stream');
  headers.set('Cache-Control', 'public, max-age=86400');
  const len = up.headers.get('content-length');
  if (len) headers.set('Content-Length', len);

  return new Response(up.body, { status: up.status, headers });
});
