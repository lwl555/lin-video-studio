/* ============ 图片生成工作区 ============
   生成任务在 jobs.js 里常驻执行：切页不中断，回来能恢复历史与进度。
   ============================================ */
import { h, toast, pickFile, modelSelect, download } from '../ui.js';
import { icon } from '../icons.js';
import { store, saveMedia } from '../store.js';
import { providers } from '../models.js';
import { wsGet, wsPatch, onJob, runImage } from '../jobs.js';
import { optimizePrompt } from '../prompts.js';
import { go } from '../app.js';

/* 风格：缩略图是平台真实生成过的样图（点开就是这张图的效果），kw 是真正喂给模型的英文提示词 */
const STYLES = [
  { k: 'none', label: '不指定', img: '', kw: '' },
  { k: 'cinematic', label: '写实电影感', img: 'assets/style/cinematic.jpg', kw: 'cinematic film still, photorealistic, 35mm lens, shallow depth of field, film grain' },
  { k: 'anime', label: '2D 动漫', img: 'assets/style/anime.jpg', kw: 'anime style illustration, cel shading, vibrant colors, clean lineart' },
  { k: '3d', label: '3D 渲染', img: 'assets/style/3d.jpg', kw: '3d render, pixar style, soft studio lighting, octane render' },
  { k: 'ink', label: '国风水墨', img: 'assets/style/ink.jpg', kw: 'traditional chinese ink wash painting, rice paper texture, negative space' },
  { k: 'comic', label: '美式漫画', img: 'assets/style/comic.jpg', kw: 'american comic book style, bold outlines, halftone dots, flat saturated colors' },
  { k: 'pixel', label: '像素风', img: 'assets/style/pixel.jpg', kw: 'pixel art, 16-bit, limited palette, crisp pixels' },
  { k: 'kids', label: '儿童插画', img: 'assets/style/kids.jpg', kw: "children's book illustration, soft watercolor, pastel warm colors, whimsical" },
  { k: 'cyberpunk', label: '赛博朋克', img: 'assets/style/cyberpunk.jpg', kw: 'cyberpunk, neon lights, rain, high contrast magenta and cyan' }
];
const SIZES = ['1024x1024', '1536x864', '864x1536', '1280x720', '720x1280', '2048x2048'];

const elapsed = ts => Math.max(0, Math.round((Date.now() - (ts || Date.now())) / 1000)) + 's';

export function render(root, params = {}) {
  const list = providers.byType('image');
  const saved = wsGet('image');

  let providerId = saved.provider || store.state.modelRoute?.image || list[0]?.id || '';
  let refUrl = params.refs?.[0] || saved.refUrl || null;
  let size = saved.size || '1024x1024';
  let style = STYLES.find(s => s.k === saved.styleKey) || STYLES[1];   /* 默认「写实电影感」 */

  const ta = h('textarea', { class: 'form-area', placeholder: '描述画面：主体 + 场景 + 光线 + 风格，越具体越好' });
  ta.value = params.prompt || saved.prompt || '';

  const refBox = h('div', { class: 'ref-row', style: { margin: '0 0 16px' } });
  const drawRef = () => {
    refBox.innerHTML = '';
    refBox.append(h('div', { class: 'ref-slot', onclick: async () => {
      const f = await pickFile('image/*'); if (!f) return;
      refUrl = await saveMedia(f); saveForm(); drawRef();
    } }, refUrl ? h('img', { src: refUrl }) : h('span', { style: { fontSize: '16px' } }, '＋'),
      refUrl ? h('div', { class: 'del', onclick: e => { e.stopPropagation(); refUrl = null; saveForm(); drawRef(); } }, '×') : h('span', {}, '参考图')));
  };
  drawRef();

  const stage = h('div', { class: 'stage-box' });
  const strip = h('div', { class: 'result-strip' });

  /* 风格：缩略图卡片（真实样图），不再是一排纯文字 */
  const styleRow = h('div', { class: 'style-tiles' });
  const drawStyles = () => {
    styleRow.innerHTML = '';
    for (const s of STYLES) {
      styleRow.append(h('button', {
        class: 'style-tile' + (s.k === style.k ? ' active' : ''),
        title: s.label,
        onclick: () => { style = s; saveForm(); drawStyles(); }
      },
        s.img
          ? h('img', { src: s.img, alt: s.label, loading: 'lazy' })
          : h('span', { class: 'style-none' }, '不指定风格'),
        h('span', { class: 'style-name' }, s.label)));
    }
  };
  drawStyles();

  const sizeRow = h('div', { class: 'ratio-row' });
  SIZES.forEach(s => sizeRow.append(h('button', {
    class: 'ratio-btn' + (s === size ? ' active' : ''), onclick: e => {
      size = s; saveForm();
      [...sizeRow.children].forEach(c => c.classList.toggle('active', c === e.currentTarget));
    }
  }, s.replace('x', '×'))));

  const genBtn = h('button', { class: 'btn-primary', style: { width: '100%' }, onclick: generate }, '生成图片');
  /* 移动端表单很长，结果区会被推到屏幕外；这一行状态始终贴在按钮下方，
     保证「生成中 / 进度 / 完成 / 错误」在可视区内也能看到 */
  const panelStatus = h('div', { class: 'ws-panel-status hidden' });

  const panel = h('div', { class: 'ws-panel' },
    h('div', { class: 'form-group' }, h('label', { class: 'form-label' }, '模型'),
      modelSelect('image', providerId, v => { providerId = v; saveForm(); })),
    h('div', { class: 'form-group' },
      h('div', { class: 'form-label', style: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '10px' } },
        h('span', {}, '画面描述'),
        h('button', { class: 'node-btn sm', title: '把一句话扩写成详细的画面提示词', onclick: optimize }, 'AI 优化提示词')),
      ta),
    h('div', { class: 'form-group' }, h('label', { class: 'form-label' }, '参考图（可选，用于图生图）'), refBox),
    h('div', { class: 'form-group' }, h('label', { class: 'form-label' }, '风格'), styleRow),
    h('div', { class: 'form-group' }, h('label', { class: 'form-label' }, '尺寸'), sizeRow),
    genBtn,
    panelStatus,
    h('div', { class: 'hint' }, '提示：模型由你在「模型接入」里配置，Key 只存在本机。生成任务会常驻执行，切到别的页面也会继续。')
  );

  root.append(h('div', { class: 'ws' }, panel,
    h('div', { class: 'ws-stage' }, stage, strip)));

  /* ---------- 状态 ---------- */
  function saveForm() {
    wsPatch('image', {
      provider: providerId, prompt: ta.value, size, styleKey: style.k, refUrl,
    });
  }

  function paint() {
    const s = wsGet('image');
    const rs = s.results || [];
    stage.innerHTML = '';
    if (s.busy) {
      stage.append(h('div', { class: 'stage-ph' },
        h('span', { class: 'spinner', style: { margin: '0 auto 12px' } }),
        h('div', { class: 'stage-txt' }, '生成中…（切到别的页面也会继续）'),
        h('div', { class: 'ws-bar' }, h('i', { style: { width: '46%' } })),
        h('span', { class: 'ws-time' }, '已等待 ' + elapsed(s.startedAt))));
    } else if (s.error) {
      stage.append(h('div', { class: 'stage-ph' },
        h('span', { class: 'big', html: icon('warn', 34) }),
        h('div', { class: 'stage-txt' }, s.error),
        h('button', { class: 'btn-primary', style: { marginTop: '14px' }, onclick: generate }, '重试')));
    } else if (rs.length) {
      stage.append(h('img', { src: rs[0] }));
    } else {
      stage.append(h('div', { class: 'stage-ph' },
        h('span', { class: 'big', html: icon('image', 34) }), '生成结果会显示在这里'));
    }
    genBtn.disabled = !!s.busy;
    genBtn.textContent = s.busy ? '生成中…' : '生成图片';
    /* 状态行：始终贴在按钮下方，移动端不滚也能看到进度/结果 */
    if (s.busy) {
      panelStatus.className = 'ws-panel-status busy';
      panelStatus.textContent = '生成中…（已等待 ' + elapsed(s.startedAt) + '）';
    } else if (s.error) {
      panelStatus.className = 'ws-panel-status err';
      panelStatus.textContent = '出错了：' + s.error;
    } else if (rs.length) {
      panelStatus.className = 'ws-panel-status ok';
      panelStatus.textContent = '已完成，共 ' + rs.length + ' 张，结果见下方 ↓';
    } else {
      panelStatus.className = 'ws-panel-status hidden';
      panelStatus.textContent = '';
    }
    drawStrip();
  }

  /* 把结果区滚入视口（移动端表单很长，.ws 内部可滚动）。
     用「结果区顶到容器顶部」的精准滚动，避免它是最后一个元素时被顶到视口底部。
     桌面端 .ws 不是滚动容器，scrollTop 自动不生效 */
  function revealStage() {
    try {
      const ws = stage.closest('.ws');
      if (ws && ws.scrollHeight > ws.clientHeight + 2) {
        const wr = ws.getBoundingClientRect(), sr = stage.getBoundingClientRect();
        ws.scrollTop += (sr.top - wr.top) - 8;
      } else {
        stage.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }
    } catch { try { stage.scrollIntoView(); } catch { /* ignore */ } }
  }

  function drawStrip() {
    const rs = wsGet('image').results || [];
    strip.innerHTML = '';
    rs.forEach((u, i) => strip.append(h('div', {
      class: 'result-thumb' + (i === 0 ? ' active' : ''), onclick: () => {
        stage.innerHTML = ''; stage.append(h('img', { src: u }));
        [...strip.children].forEach((c, j) => c.classList.toggle('active', j === i));
      }
    }, h('img', { src: u }))));
    if (rs.length) strip.append(h('button', { class: 'btn-ghost', onclick: () => download(rs[0], 'image.png') }, '下载'));
  }

  async function optimize(e) {
    const b = e.currentTarget;
    const raw = ta.value.trim();
    if (!raw) return toast('先写一句画面描述，AI 再帮你扩写', 'err');
    b.disabled = true; b.textContent = '扩写中…';
    try {
      const p = await optimizePrompt(raw, { kind: 'image', ratio: size, style: style.kw });
      ta.value = p;
      saveForm();
      toast('已扩写成详细提示词，可再手动微调', 'ok', 3200);
    } catch (err) { toast('扩写失败：' + err.message, 'err'); }
    b.disabled = false; b.textContent = 'AI 优化提示词';
  }

  async function generate() {
    const p = providers.get(providerId) || providers.defaultOf('image');
    if (!p) { toast('还没接入图像模型，去「模型接入」添加', 'err'); return go('settings'); }
    const raw = ta.value.trim();
    if (!raw) return toast('先写点画面描述', 'err');

    saveForm();
    const full = style.kw ? `${raw}，${style.kw}` : raw;
    requestAnimationFrame(() => revealStage());          // 立即把结果区（含进度）滚入视口
    await runImage({ provider: p, prompt: full, size, images: refUrl ? [refUrl] : [], title: raw });
    paint();
  }

  /* 回到本页时：恢复历史 + 进行中的进度；任务完成后实时刷新 */
  paint();
  ta.addEventListener('change', saveForm);
  /* 边写边存（防抖）：不然只在失焦时保存，直接切页面会把刚写的描述丢掉 */
  let saveT = 0;
  ta.addEventListener('input', () => { clearTimeout(saveT); saveT = setTimeout(saveForm, 400); });

  let seenResults = (wsGet('image').results || []).length;
  let off = null;
  off = onJob(kind => {
    if (!stage.isConnected) { off && off(); return; }
    if (kind === 'image') {
      const s = wsGet('image');
      const n = (s.results || []).length;
      paint();
      /* 刚出结果时把画面滚入视口，确保用户看到生成结果 */
      if (!s.busy && n > seenResults) { seenResults = n; revealStage(); }
    }
  });

  /* 进行中时刷新等待秒数（进度条 + 按钮下方状态行同步） */
  const timer = setInterval(() => {
    if (!stage.isConnected) { clearInterval(timer); return; }
    const s = wsGet('image');
    if (!s.busy) return;
    const t = stage.querySelector('.ws-time');
    if (t) t.textContent = '已等待 ' + elapsed(s.startedAt);
    if (!panelStatus.classList.contains('hidden')) {
      panelStatus.textContent = '生成中…（已等待 ' + elapsed(s.startedAt) + '）';
    }
  }, 1000);
}
