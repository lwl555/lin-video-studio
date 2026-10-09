// ============================================================
// pavo-proxy · Supabase Edge Function
// 作用：① 转发模型 API 请求（绕开浏览器 CORS）
//       ② 上传素材到 Storage（可选）
// 部署：supabase functions deploy pavo-proxy --no-verify-jwt
// ============================================================

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
};

const json = (obj: unknown, status = 200) =>
  new Response(JSON.stringify(obj), {
    status,
    headers: { ...CORS, 'Content-Type': 'application/json' },
  });

/** 阻止访问内网地址（SSRF 防护） */
function isBlocked(url: URL): boolean {
  const h = url.hostname;
  if (['localhost', '0.0.0.0', '::1'].includes(h)) return true;
  if (/^127\./.test(h)) return true;
  if (/^10\./.test(h)) return true;
  if (/^192\.168\./.test(h)) return true;
  if (/^172\.(1[6-9]|2\d|3[01])\./.test(h)) return true;
  if (/^169\.254\./.test(h)) return true;
  if (/\.local$/i.test(h)) return true;
  return false;
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });

  const { pathname, searchParams } = new URL(req.url);
  const route = pathname.split('/').pop() || '';

  // ---------- 存储：/pavo-proxy/storage?path=xxx ----------
  if (route === 'storage') {
    try {
      const path = searchParams.get('path') || `u/${Date.now()}.bin`;
      const bucket = Deno.env.get('PAVO_BUCKET') ?? 'pavo';
      const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
      const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? Deno.env.get('SUPABASE_ANON_KEY')!;

      const bytes = new Uint8Array(await req.arrayBuffer());
      const contentType = req.headers.get('content-type') ?? 'application/octet-stream';

      const up = await fetch(`${supabaseUrl}/storage/v1/object/${bucket}/${path}`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${serviceKey}`,
          'Content-Type': contentType,
          'x-upsert': 'true',
        },
        body: bytes,
      });
      if (!up.ok) return json({ error: `storage ${up.status}: ${await up.text()}` }, 500);

      return json({
        url: `${supabaseUrl}/storage/v1/object/public/${bucket}/${path}`,
        path,
      });
    } catch (e) {
      return json({ error: String(e) }, 500);
    }
  }

  // ---------- 转发：/pavo-proxy/fetch ----------
  if (route === 'fetch') {
    if (req.method !== 'POST') return json({ error: 'method not allowed' }, 405);
    try {
      const { url, method = 'POST', headers = {}, body } = await req.json();
      if (!url) return json({ error: 'missing url' }, 400);

      const target = new URL(url);
      if (target.protocol !== 'https:') return json({ error: 'only https allowed' }, 400);
      if (isBlocked(target)) return json({ error: 'blocked host' }, 403);

      // 安全：只透传必要头部
      const pass: Record<string, string> = {};
      for (const k of Object.keys(headers)) {
        const lk = k.toLowerCase();
        if (['authorization', 'content-type', 'accept', 'x-api-key', 'anthropic-version'].includes(lk)) {
          pass[k] = headers[k];
        }
      }
      if (!pass['Content-Type'] && !pass['content-type']) pass['Content-Type'] = 'application/json';

      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), 180_000);   // 视频任务可能较久

      const r = await fetch(target.toString(), {
        method,
        headers: pass,
        body: body != null && method !== 'GET' ? (typeof body === 'string' ? body : JSON.stringify(body)) : undefined,
        signal: ctrl.signal,
      }).finally(() => clearTimeout(timer));

      const text = await r.text();
      let parsed: unknown;
      try { parsed = JSON.parse(text); } catch { parsed = { raw: text }; }

      return json({ status: r.status, body: parsed });
    } catch (e) {
      return json({ error: `proxy failed: ${String(e)}` }, 502);
    }
  }

  // ---------- 健康检查 ----------
  return json({
    ok: true,
    service: 'pavo-proxy',
    routes: ['POST /fetch', 'POST /storage?path=xxx'],
    time: new Date().toISOString(),
  });
});
