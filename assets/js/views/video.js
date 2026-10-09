/* ============ 视频生成工作区 ============ */
import { h, $, toast, pickFile, modelSelect, download } from '../ui.js';
import { store, uid, saveMedia } from '../store.js';
import { providers, genVideo } from '../models.js';
import { go } from '../app.js';

const RATIOS = ['16:9', '9:16', '1:1', '4:3', '3:4', '21:9'];

export function render(root, params = {}) {
  const list = providers.byType('video');
  let providerId = list[0]?.id || '';
  let frames = { first: null, last: null };
  let ratio = '16:9', duration = 5;
  const results = [];

  const ta = h('textarea', { class: 'form-area', placeholder: '描述镜头：主体动作 + 运镜 + 环境声。例如：镜头缓慢向帐篷推进，海风吹动帐篷布，夕阳接近海平面，加入海浪声。' });
  if (params.prompt) ta.value = params.prompt;

  const frameRow = h('div', { class: 'ref-row', style: { margin: '0 0 16px' } });
  const drawFrames = () => {
    frameRow.innerHTML = '';
    for (const [k, label] of [['first', '首帧'], ['last', '尾帧']]) {
      frameRow.append(h('div', { class: 'ref-slot', onclick: async () => {
        const f = await pickFile('image/*'); if (!f) return;
        frames[k] = await saveMedia(f);
        drawFrames();
      } },
        frames[k] ? h('img', { src: frames[k] }) : h('span', { style: { fontSize: '16px' } }, '＋'),
        frames[k] ? h('div', { class: 'del', onclick: e => { e.stopPropagation(); frames[k] = null; drawFrames(); } }, '×') : h('span', {}, label)));
    }
  };
  if (params.refs?.[0]) frames.first = params.refs[0];
  drawFrames();

  const ratioRow = h('div', { class: 'ratio-row' });
  RATIOS.forEach((r, i) => ratioRow.append(h('button', {
    class: 'ratio-btn' + (i === 0 ? ' active' : ''), onclick: e => {
      ratio = r; [...ratioRow.children].forEach(c => c.classList.toggle('active', c === e.currentTarget));
    }
  }, r)));

  const durRow = h('div', { class: 'ratio-row' });
  [4, 5, 8, 10, 12].forEach((d, i) => durRow.append(h('button', {
    class: 'ratio-btn' + (i === 1 ? ' active' : ''), onclick: e => {
      duration = d; [...durRow.children].forEach(c => c.classList.toggle('active', c === e.currentTarget));
    }
  }, d + 's')));

  const stage = h('div', { class: 'stage-box' }, h('div', { class: 'stage-ph' }, h('span', { class: 'big' }, '🎬'), '生成的视频会在这里播放'));
  const strip = h('div', { class: 'result-strip' });
  const statusLine = h('div', { class: 'hint', style: { textAlign: 'center', marginTop: '12px' } }, '');

  const genBtn = h('button', { class: 'btn-primary', style: { width: '100%' }, onclick: generate }, '生成视频');

  root.append(h('div', { class: 'ws' },
    h('div', { class: 'ws-panel' },
      h('div', { class: 'form-group' }, h('label', { class: 'form-label' }, '模型'), modelSelect('video', providerId, v => providerId = v)),
      h('div', { class: 'form-group' }, h('label', { class: 'form-label' }, '镜头描述'), ta),
      h('div', { class: 'form-group' }, h('label', { class: 'form-label' }, '首帧 / 尾帧（可选）'), frameRow),
      h('div', { class: 'form-group' }, h('label', { class: 'form-label' }, '画面比例'), ratioRow),
      h('div', { class: 'form-group' }, h('label', { class: 'form-label' }, '时长'), durRow),
      genBtn,
      h('div', { class: 'hint' }, '首帧+尾帧可让模型自动补间中间动作，是控制镜头连续性最直接的方式。')),
    h('div', { class: 'ws-stage' }, stage, statusLine, strip)));

  async function generate() {
    const p = providers.get(providerId) || providers.defaultOf('video');
    if (!p) { toast('还没接入视频模型，去「模型接入」添加', 'err'); return go('settings'); }
    const prompt = ta.value.trim();
    if (!prompt && !frames.first) return toast('写点镜头描述，或至少放一张首帧', 'err');
    genBtn.disabled = true; genBtn.textContent = '生成中…';
    stage.innerHTML = ''; stage.append(h('div', { class: 'stage-ph' }, '提交任务…'));
    try {
      const imgs = [frames.first, frames.last].filter(Boolean);
      const r = await genVideo(prompt, {
        provider: p, images: imgs, ratio, duration,
        onProgress: s => { statusLine.textContent = s; }
      });
      statusLine.textContent = '';
      stage.innerHTML = ''; stage.append(h('video', { src: r.url, controls: true, autoplay: true }));
      results.unshift(r.url);
      store.add('works', { id: uid('w'), title: (prompt || '视频').slice(0, 24), type: 'video', url: r.url, createdAt: Date.now() });
      drawStrip(); toast('生成完成', 'ok');
    } catch (e) {
      stage.innerHTML = ''; stage.append(h('div', { class: 'stage-ph' }, h('span', { class: 'big' }, '⚠️'), e.message));
      statusLine.textContent = ''; toast('失败：' + e.message, 'err', 4500);
    } finally { genBtn.disabled = false; genBtn.textContent = '生成视频'; }
  }

  function drawStrip() {
    strip.innerHTML = '';
    results.forEach((u, i) => strip.append(h('div', {
      class: 'result-thumb' + (i === 0 ? ' active' : ''), onclick: () => {
        stage.innerHTML = ''; stage.append(h('video', { src: u, controls: true }));
        [...strip.children].forEach((c, j) => c.classList.toggle('active', j === i));
      }
    }, h('video', { src: u, muted: true }))));
    if (results.length) strip.append(h('button', { class: 'btn-ghost', onclick: () => download(results[0], 'video.mp4') }, '下载'));
  }
}
