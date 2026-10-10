/* ============ 图片生成工作区 ============ */
import { h, $, toast, pickFile, modelSelect, download } from '../ui.js';
import { icon } from '../icons.js';
import { store, uid, saveMedia } from '../store.js';
import { providers, genImage } from '../models.js';
import { go } from '../app.js';

const STYLES = ['写实电影感', '2D 动漫', '3D 渲染', '国风水墨', '美式漫画', '像素风', '儿童插画', '赛博朋克'];
const SIZES = ['1024x1024', '1536x864', '864x1536', '1280x720', '720x1280', '2048x2048'];

export function render(root, params = {}) {
  const list = providers.byType('image');
  let providerId = list[0]?.id || '';
  let refUrl = null, size = '1024x1024', style = STYLES[0];
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

  const styleRow = h('div', { class: 'ratio-row' });
  STYLES.forEach((s, i) => styleRow.append(h('button', {
    class: 'ratio-btn' + (i === 0 ? ' active' : ''), onclick: e => {
      style = s; [...styleRow.children].forEach(c => c.classList.toggle('active', c === e.currentTarget));
    }
  }, s)));

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
    genBtn.disabled = true; genBtn.textContent = '生成中…';
    stage.innerHTML = ''; stage.append(h('div', { class: 'stage-ph' }, h('span', { class: 'spinner', style: { margin: '0 auto 12px' } }), '正在生成…'));
    try {
      const r = await genImage(`${prompt}，${style}`, { provider: p, size, images: refUrl ? [refUrl] : [] });
      results.unshift(r.url);
      stage.innerHTML = ''; stage.append(h('img', { src: r.url }));
      store.add('works', { id: uid('w'), title: prompt.slice(0, 24), type: 'image', url: r.url, createdAt: Date.now() });
      drawStrip();
      toast('生成完成', 'ok');
    } catch (e) {
      stage.innerHTML = ''; stage.append(h('div', { class: 'stage-ph' }, h('span', { class: 'big', html: icon('warn', 34) }), e.message));
      toast('失败：' + e.message, 'err', 4500);
    } finally { genBtn.disabled = false; genBtn.textContent = '生成图片'; }
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
