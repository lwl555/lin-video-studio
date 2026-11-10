/* ============ 图片生成工作区 ============
   生成任务在 jobs.js 里常驻执行：切页不中断，回来能恢复历史与进度。
   ============================================ */
import { h, toast, pickFile, modelSelect, download } from '../ui.js';
import { icon } from '../icons.js';
import { store, saveMedia } from '../store.js';
import { providers } from '../models.js';
import { wsGet, wsPatch, onJob, runImage } from '../jobs.js';
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

  const panel = h('div', { class: 'ws-panel' },
    h('div', { class: 'form-group' }, h('label', { class: 'form-label' }, '模型'),
      modelSelect('image', providerId, v => { providerId = v; saveForm(); })),
    h('div', { class: 'form-group' }, h('label', { class: 'form-label' }, '画面描述'), ta),
    h('div', { class: 'form-group' }, h('label', { class: 'form-label' }, '参考图（可选，用于图生图）'), refBox),
    h('div', { class: 'form-group' }, h('label', { class: 'form-label' }, '风格'), styleRow),
    h('div', { class: 'form-group' }, h('label', { class: 'form-label' }, '尺寸'), sizeRow),
    genBtn,
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
    drawStrip();
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

  async function generate() {
    const p = providers.get(providerId) || providers.defaultOf('image');
    if (!p) { toast('还没接入图像模型，去「模型接入」添加', 'err'); return go('settings'); }
    const raw = ta.value.trim();
    if (!raw) return toast('先写点画面描述', 'err');

    saveForm();
    const full = style.kw ? `${raw}，${style.kw}` : raw;
    await runImage({ provider: p, prompt: full, size, images: refUrl ? [refUrl] : [], title: raw });
    paint();
  }

  /* 回到本页时：恢复历史 + 进行中的进度；任务完成后实时刷新 */
  paint();
  ta.addEventListener('change', saveForm);

  let off = null;
  off = onJob(kind => {
    if (!stage.isConnected) { off && off(); return; }
    if (kind === 'image') paint();
  });

  /* 进行中时刷新等待秒数 */
  const timer = setInterval(() => {
    if (!stage.isConnected) { clearInterval(timer); return; }
    const s = wsGet('image');
    if (!s.busy) return;
    const t = stage.querySelector('.ws-time');
    if (t) t.textContent = '已等待 ' + elapsed(s.startedAt);
  }, 1000);
}
