/* ============ 图片生成工作区 ============ */
import { h, $, toast, pickFile, modelSelect, download } from '../ui.js';
import { icon } from '../icons.js';
import { store, uid, saveMedia } from '../store.js';
import { providers, genImage } from '../models.js';
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

export function render(root, params = {}) {
  const list = providers.byType('image');
  let providerId = list[0]?.id || '';
  let refUrl = null, size = '1024x1024', style = STYLES[1];   /* 默认「写实电影感」 */
  const results = [];

  const ta = h('textarea', { class: 'form-area', placeholder: '描述画面：主体 + 场景 + 光线 + 风格，越具体越好' });
  if (params.prompt) ta.value = params.prompt;
  if (params.refs?.[0]) refUrl = params.refs[0];

  const refBox = h('div', { class: 'ref-row', style: { margin: '0 0 16px' } });
  const drawRef = () => {
    refBox.innerHTML = '';
    refBox.append(h('div', { class: 'ref-slot', onclick: async () => {
      const f = await pickFile('image/*'); if (!f) return;
      refUrl = await saveMedia(f); drawRef();
    } }, refUrl ? h('img', { src: refUrl }) : h('span', { style: { fontSize: '16px' } }, '＋'),
      refUrl ? h('div', { class: 'del', onclick: e => { e.stopPropagation(); refUrl = null; drawRef(); } }, '×') : h('span', {}, '参考图')));
  };
  drawRef();

  const stage = h('div', { class: 'stage-box' }, h('div', { class: 'stage-ph' },
    h('span', { class: 'big', html: icon('image', 34) }), '生成结果会显示在这里'));
  const strip = h('div', { class: 'result-strip' });

  /* 风格：缩略图卡片（真实样图），不再是一排纯文字 */
  const styleRow = h('div', { class: 'style-tiles' });
  const drawStyles = () => {
    styleRow.innerHTML = '';
    for (const s of STYLES) {
      styleRow.append(h('button', {
        class: 'style-tile' + (s.k === style.k ? ' active' : ''),
        title: s.label,
        onclick: () => { style = s; drawStyles(); }
      },
        s.img
          ? h('img', { src: s.img, alt: s.label, loading: 'lazy' })
          : h('span', { class: 'style-none' }, '不指定风格'),
        h('span', { class: 'style-name' }, s.label)));
    }
  };
  drawStyles();

  const sizeRow = h('div', { class: 'ratio-row' });
  SIZES.forEach((s, i) => sizeRow.append(h('button', {
    class: 'ratio-btn' + (i === 0 ? ' active' : ''), onclick: e => {
      size = s; [...sizeRow.children].forEach(c => c.classList.toggle('active', c === e.currentTarget));
    }
  }, s.replace('x', '×'))));

  const genBtn = h('button', { class: 'btn-primary', style: { width: '100%' }, onclick: generate }, '生成图片');

  const panel = h('div', { class: 'ws-panel' },
    h('div', { class: 'form-group' }, h('label', { class: 'form-label' }, '模型'),
      modelSelect('image', providerId, v => providerId = v)),
    h('div', { class: 'form-group' }, h('label', { class: 'form-label' }, '画面描述'), ta),
    h('div', { class: 'form-group' }, h('label', { class: 'form-label' }, '参考图（可选，用于图生图）'), refBox),
    h('div', { class: 'form-group' }, h('label', { class: 'form-label' }, '风格'), styleRow),
    h('div', { class: 'form-group' }, h('label', { class: 'form-label' }, '尺寸'), sizeRow),
    genBtn,
    h('div', { class: 'hint' }, '提示：模型由你在「模型接入」里配置，Key 只存在本机。若浏览器直连被跨域拦截，请到设置里开启后端代理。')
  );

  root.append(h('div', { class: 'ws' }, panel,
    h('div', { class: 'ws-stage' }, stage, strip)));

  async function generate() {
    const p = providers.get(providerId) || providers.defaultOf('image');
    if (!p) { toast('还没接入图像模型，去「模型接入」添加', 'err'); return go('settings'); }
    const prompt = ta.value.trim();
    if (!prompt) return toast('先写点画面描述', 'err');
    const t0 = Date.now();
    genBtn.disabled = true; genBtn.textContent = '生成中…';
    /* 阶段提示 + 进度条 + 已等待秒数，不再是干巴巴一句「正在生成」 */
    const paint = (txt, pct) => {
      stage.innerHTML = '';
      stage.append(h('div', { class: 'stage-ph' },
        h('span', { class: 'spinner', style: { margin: '0 auto 12px' } }),
        h('div', { class: 'stage-txt' }, txt),
        h('div', { class: 'ws-bar' }, h('i', { style: { width: Math.max(8, Math.min(96, pct || 8)) + '%' } })),
        h('span', { class: 'ws-time' }, '已等待 0s')));
    };
    paint('提交画面…', 18);
    let sec = 0;
    const timer = setInterval(() => {
      sec++;
      const t = stage.querySelector('.ws-time');
      if (t) t.textContent = `已等待 ${sec}s`;
    }, 1000);
    try {
      /* 风格用英文关键词喂给模型（比中文标签稳），不指定时不拼 */
      const full = style.kw ? `${prompt}，${style.kw}` : prompt;
      const r = await genImage(full, { provider: p, size, images: refUrl ? [refUrl] : [] });
      results.unshift(r.url);
      stage.innerHTML = ''; stage.append(h('img', { src: r.url }));
      store.add('works', { id: uid('w'), title: prompt.slice(0, 24), type: 'image', url: r.url, createdAt: Date.now() });
      drawStrip();
      toast(`生成完成 · ${((Date.now() - t0) / 1000).toFixed(1)}s`, 'ok');
    } catch (e) {
      stage.innerHTML = ''; stage.append(h('div', { class: 'stage-ph' }, h('span', { class: 'big', html: icon('warn', 34) }), e.message));
      toast('失败：' + e.message, 'err', 4500);
    } finally {
      clearInterval(timer);
      genBtn.disabled = false; genBtn.textContent = '生成图片';
    }
  }

  function drawStrip() {
    strip.innerHTML = '';
    results.forEach((u, i) => strip.append(h('div', {
      class: 'result-thumb' + (i === 0 ? ' active' : ''), onclick: () => {
        stage.innerHTML = ''; stage.append(h('img', { src: u }));
        [...strip.children].forEach((c, j) => c.classList.toggle('active', j === i));
      }
    }, h('img', { src: u }))));
    if (results.length) strip.append(h('button', { class: 'btn-ghost', onclick: () => download(results[0], 'image.png') }, '下载'));
  }
}
