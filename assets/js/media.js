/* ============ 浏览器内视频合成（ffmpeg.wasm） ============ */
import { toast } from './ui.js';

const CDN_LIST = [
  {
    name: 'jsdelivr',
    js: 'https://cdn.jsdelivr.net/npm/@ffmpeg/ffmpeg@0.12.15/dist/umd/ffmpeg.js',
    core: 'https://cdn.jsdelivr.net/npm/@ffmpeg/core@0.12.10/dist/umd'
  },
  {
    name: 'unpkg',
    js: 'https://unpkg.com/@ffmpeg/ffmpeg@0.12.15/dist/umd/ffmpeg.js',
    core: 'https://unpkg.com/@ffmpeg/core@0.12.10/dist/umd'
  }
];

let ffmpeg = null;
let loading = null;

function loadScript(src) {
  return new Promise((res, rej) => {
    const s = document.createElement('script');
    s.src = src; s.async = true;
    s.onload = () => res();
    s.onerror = () => rej(new Error('加载脚本失败：' + src));
    document.head.append(s);
  });
}

/** 远程文件转 blob URL —— 绕开 ffmpeg.wasm 的跨域限制 */
async function toBlobURL(url, type) {
  const r = await fetch(url, { mode: 'cors' });
  if (!r.ok) throw new Error(`拉取 ${url} 失败 ${r.status}`);
  const b = await r.blob();
  return URL.createObjectURL(new Blob([b], { type }));
}

/** 获取 ffmpeg 实例（只会初始化一次，core 约 30MB，首次较慢） */
export async function getFFmpeg(onProgress = () => { }) {
  if (ffmpeg) return ffmpeg;
  if (loading) return loading;

  loading = (async () => {
    let lastErr;
    for (const cdn of CDN_LIST) {
      try {
        onProgress(`加载 ffmpeg 运行时（${cdn.name}）…`);
        if (!window.FFmpeg) await loadScript(cdn.js);
        const { FFmpeg } = window;
        if (!FFmpeg) throw new Error('FFmpeg 未挂载');

        const coreURL = await toBlobURL(`${cdn.core}/ffmpeg-core.js`, 'text/javascript');
        const wasmURL = await toBlobURL(`${cdn.core}/ffmpeg-core.wasm`, 'application/wasm');

        const f = new FFmpeg();
        f.on('log', ({ message }) => console.debug('[ffmpeg]', message));
        f.on('progress', ({ progress }) => {
          if (progress > 0) onProgress(`合成中 ${Math.min(99, Math.round(progress * 100))}%`);
        });
        await f.load({ coreURL, wasmURL });
        ffmpeg = f;
        return f;
      } catch (e) {
        lastErr = e;
        console.warn('CDN 失败', cdn.name, e);
      }
    }
    throw lastErr || new Error('ffmpeg 初始化失败');
  })();
  return loading;
}

/** 拉取远端媒体为二进制（模型返回的 URL 必须允许跨域） */
async function fetchBin(url, onProgress) {
  onProgress?.(`下载素材…`);
  let r;
  try {
    r = await fetch(url, { mode: 'cors' });
  } catch {
    throw new Error(`素材不允许跨域读取（CORS）：${short(url)}\n\n解决：在「模型接入 → 后端代理」里开启代理，让素材先落到 Supabase Storage，或先把视频下载到本地再上传。`);
  }
  if (!r.ok) throw new Error(`下载素材失败 ${r.status}`);
  return new Uint8Array(await r.arrayBuffer());
}

const short = u => String(u).length > 60 ? String(u).slice(0, 40) + '…' + String(u).slice(-16) : u;

/** 读取单个片段时长（秒）：ffmpeg -i 会把信息输出到日志 */
async function probeDuration(f, name) {
  let text = '';
  const handler = ({ message }) => { text += message + '\n'; };
  f.on('log', handler);
  try { await f.exec(['-i', name]); } catch { /* -i 无输出参数会"失败"，属正常 */ }
  f.off('log', handler);
  const m = text.match(/Duration:\s*(\d+):(\d+):(\d+\.?\d*)/);
  if (!m) return 5;
  return (+m[1]) * 3600 + (+m[2]) * 60 + parseFloat(m[3]);
}

/**
 * 合成多个视频片段
 * @param {string[]} urls 片段地址
 * @param {object} opts { audioUrl, transition(秒,0=不转场), reencode, onProgress }
 * @returns {Promise<{url:string, blob:Blob, size:number}>}
 */
export async function concatVideos(urls, opts = {}) {
  const { audioUrl = null, transition = 0, reencode = false, onProgress = () => { } } = opts;
  const list = (urls || []).filter(Boolean);
  if (!list.length) throw new Error('没有可合成的片段');
  if (list.length === 1 && !audioUrl) {
    onProgress('只有一个片段，直接返回');
    const r = await fetch(list[0]);
    const blob = await r.blob();
    return { url: list[0], blob, size: blob.size };
  }

  const f = await getFFmpeg(onProgress);

  /* 1. 写入虚拟文件系统 */
  const names = [];
  for (let i = 0; i < list.length; i++) {
    const bin = await fetchBin(list[i], onProgress);
    const name = `in${i}.mp4`;
    await f.writeFile(name, bin);
    names.push(name);
    onProgress(`写入片段 ${i + 1}/${list.length}`);
  }
  let audioName = null;
  if (audioUrl) {
    const bin = await fetchBin(audioUrl, onProgress);
    audioName = 'bgm' + (audioUrl.includes('.mp3') ? '.mp3' : '.m4a');
    await f.writeFile(audioName, bin);
  }

  const out = 'out.mp4';
  const args = [];

  if (!transition && !audioName && !reencode) {
    /* 2a. 快拼（无重编码，最快最稳） */
    await f.writeFile('list.txt', new TextEncoder().encode(names.map(n => `file '${n}'`).join('\n')));
    args.push('-f', 'concat', '-safe', '0', '-i', 'list.txt', '-c', 'copy', out);
  } else if (transition > 0 && names.length > 1) {
    /* 2b. 带转场的拼接 */
    const durs = [];
    for (const n of names) durs.push(await probeDuration(f, n));
    const inputs = [];
    for (const n of names) inputs.push('-i', n);
    const parts = [];
    let prev = null, offset = 0;
    for (let i = 0; i < names.length; i++) {
      if (i === 0) { prev = `[${i}:v]`; offset += durs[i]; continue; }
      const cur = `[v${i}]`;
      parts.push(`${prev}[${i}:v]xfade=transition=fade:duration=${transition}:offset=${Math.max(0, offset - transition)}${cur}`);
      prev = cur;
      offset += durs[i] - transition;
    }
    const filter = parts.join(';');
    args.push(...inputs, '-filter_complex', filter, '-map', prev,
      '-c:v', 'libx264', '-preset', 'ultrafast', '-pix_fmt', 'yuv420p', '-movflags', '+faststart');
    if (audioName) args.push('-i', audioName, '-map', `a:${names.length}`, '-shortest', '-c:a', 'aac');
    args.push(out);
  } else {
    /* 2c. 统一重编码拼接 + 可选背景音 */
    await f.writeFile('list.txt', new TextEncoder().encode(names.map(n => `file '${n}'`).join('\n')));
    args.push('-f', 'concat', '-safe', '0', '-i', 'list.txt',
      '-c:v', 'libx264', '-preset', 'ultrafast', '-pix_fmt', 'yuv420p', '-movflags', '+faststart');
    if (audioName) args.push('-i', audioName, '-map', '0:v', '-map', '1:a', '-shortest', '-c:a', 'aac');
    args.push(out);
  }

  onProgress('开始编码…');
  const code = await f.exec(args);
  if (code !== 0) throw new Error(`ffmpeg 执行失败（code ${code}）`);

  const data = await f.readFile(out);
  const blob = new Blob([data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength)], { type: 'video/mp4' });

  /* 清理 */
  for (const n of [...names, 'list.txt', out]) { try { await f.deleteFile(n); } catch { } }
  if (audioName) { try { await f.deleteFile(audioName); } catch { } }

  onProgress('完成');
  return { url: URL.createObjectURL(blob), blob, size: blob.size };
}

/** 单片段抽帧（取关键帧做封面/首帧） */
export async function extractFrame(url, time = 0) {
  const f = await getFFmpeg();
  const bin = await fetchBin(url);
  await f.writeFile('src.mp4', bin);
  await f.exec(['-ss', String(time), '-i', 'src.mp4', '-frames:v', '1', '-q:v', '2', 'frame.jpg']);
  const data = await f.readFile('frame.jpg');
  try { await f.deleteFile('src.mp4'); await f.deleteFile('frame.jpg'); } catch { }
  const blob = new Blob([data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength)], { type: 'image/jpeg' });
  return URL.createObjectURL(blob);
}

export const ffmpegReady = () => !!ffmpeg;
