/* ============ 视频生成工作区 ============
   生成任务在 jobs.js 里常驻执行：切页不中断，回来能恢复历史与进度。
   ============================================ */
import { h, toast, pickFile, modelSelect, download } from '../ui.js';
import { icon } from '../icons.js';
import { store, saveMedia } from '../store.js';
import { providers } from '../models.js';
import { wsGet, wsPatch, onJob, runVideo } from '../jobs.js';
import { go } from '../app.js';

const RATIOS = ['16:9', '9:16', '1:1', '4:3', '3:4', '21:9'];
const elapsed = ts => Math.max(0, Math.round((Date.now() - (ts || Date.now())) / 1000)) + 's';

export function render(root, params = {}) {
  const list = providers.byType('video');
  const saved = wsGet('video');

  let providerId = saved.provider || store.state.modelRoute?.video || list[0]?.id || '';
  let frames = { first: params.refs?.[0] || null, last: null, ref: null };
  let ratio = saved.ratio || '16:9';
  let duration = saved.duration || 5;

  const ta = h('textarea', { class: 'form-area', placeholder: '描述镜头：主体动作 + 运镜 + 环境声。例如：镜头缓慢向帐篷推进，海风吹动帐篷布，夕阳接近海平面，加入海浪声。' });
  ta.value = params.prompt || saved.prompt || '';

  const frameRow = h('div', { class: 'ref-row', style: { margin: '0 0 16px' } });
  const drawFrames = () => {
    frameRow.innerHTML = '';
    for (const [k, label] of [['first', '首帧'], ['last', '尾帧'], ['ref', '参考图']]) {
      frameRow.append(h('div', { class: 'ref-slot', onclick: async () => {
        const f = await pickFile('image/*'); if (!f) return;
        frames[k] = await saveMedia(f);
        drawFrames();
      } },
        frames[k] ? h('img', { src: frames[k] }) : h('span', { style: { fontSize: '16px' } }, '＋'),
        frames[k] ? h('div', { class: 'del', onclick: e => { e.stopPropagation(); frames[k] = null; drawFrames(); } }, '×') : h('span', {}, label)));
    }
  };
  drawFrames();

  const ratioRow = h('div', { class: 'ratio-row' });
  RATIOS.forEach(r => ratioRow.append(h('button', {
    class: 'ratio-btn' + (r === ratio ? ' active' : ''), onclick: e => {
      ratio = r; saveForm();
      [...ratioRow.children].forEach(c => c.classList.toggle('active', c === e.currentTarget));
    }
  }, r)));

  const durRow = h('div', { class: 'ratio-row' });
  [4, 5, 8, 10, 12].forEach(d => durRow.append(h('button', {
    class: 'ratio-btn' + (d === duration ? ' active' : ''), onclick: e => {
      duration = d; saveForm();
      [...durRow.children].forEach(c => c.classList.toggle('active', c === e.currentTarget));
    }
  }, d + 's')));

  const stage = h('div', { class: 'stage-box' });
  const strip = h('div', { class: 'result-strip' });
  const statusLine = h('div', { class: 'hint', style: { textAlign: 'center', marginTop: '12px' } }, '');

  const genBtn = h('button', { class: 'btn-primary', style: { width: '100%' }, onclick: generate }, '生成视频');

  root.append(h('div', { class: 'ws' },
    h('div', { class: 'ws-panel' },
      h('div', { class: 'form-group' }, h('label', { class: 'form-label' }, '模型'),
        modelSelect('video', providerId, v => { providerId = v; saveForm(); })),
      h('div', { class: 'form-group' }, h('label', { class: 'form-label' }, '镜头描述'), ta),
      h('div', { class: 'form-group' }, h('label', { class: 'form-label' }, '首帧 / 尾帧（可选）'), frameRow),
      h('div', { class: 'form-group' }, h('label', { class: 'form-label' }, '画面比例'), ratioRow),
      h('div', { class: 'form-group' }, h('label', { class: 'form-label' }, '时长'), durRow),
      genBtn,
      h('div', { class: 'hint' }, '生成任务会常驻执行，切到别的页面也会继续；回来能看到进度和历史。')),
    h('div', { class: 'ws-stage' }, stage, statusLine, strip)));

  function saveForm() {
    wsPatch('video', { provider: providerId, prompt: ta.value, ratio, duration });
  }

  function paint() {
    const s = wsGet('video');
    const rs = s.results || [];
    stage.innerHTML = '';
    if (s.busy) {
      stage.append(h('div', { class: 'stage-ph' },
        h('span', { class: 'spinner', style: { margin: '0 auto 12px' } }),
        h('div', { class: 'stage-txt' }, '生成中…（切到别的页面也会继续）'),
        h('div', { class: 'ws-bar' }, h('i', { style: { width: '42%' } })),
        h('span', { class: 'ws-time' }, '已等待 ' + elapsed(s.startedAt))));
      statusLine.textContent = s.progress || '';
    } else if (s.error) {
      stage.append(h('div', { class: 'stage-ph' },
        h('span', { class: 'big', html: icon('warn', 34) }),
        h('div', { class: 'stage-txt' }, s.error),
        h('button', { class: 'btn-primary', style: { marginTop: '14px' }, onclick: generate }, '重试')));
      statusLine.textContent = '';
    } else if (rs.length) {
      stage.append(h('video', { src: rs[0], controls: '', autoplay: '' }));
      statusLine.textContent = '';
    } else {
      stage.append(h('div', { class: 'stage-ph' },
        h('span', { class: 'big', html: icon('video', 34) }), '生成的视频会在这里播放'));
      statusLine.textContent = '';
    }
    genBtn.disabled = !!s.busy;
    genBtn.textContent = s.busy ? '生成中…' : '生成视频';
    drawStrip();
  }

  function drawStrip() {
    const rs = wsGet('video').results || [];
    strip.innerHTML = '';
    rs.forEach((u, i) => strip.append(h('div', {
      class: 'result-thumb' + (i === 0 ? ' active' : ''), onclick: () => {
        stage.innerHTML = ''; stage.append(h('video', { src: u, controls: '' }));
        [...strip.children].forEach((c, j) => c.classList.toggle('active', j === i));
      }
    }, h('video', { src: u, muted: '' }))));
    if (rs.length) strip.append(h('button', { class: 'btn-ghost', onclick: () => download(rs[0], 'video.mp4') }, '下载'));
  }

  async function generate() {
    const p = providers.get(providerId) || providers.defaultOf('video');
    if (!p) { toast('还没接入视频模型，去「模型接入」添加', 'err'); return go('settings'); }
    const raw = ta.value.trim();
    if (!raw && !frames.first) return toast('写点镜头描述，或至少放一张首帧', 'err');

    saveForm();
    const imgs = [frames.first, frames.last, frames.ref].filter(Boolean);
    await runVideo({ provider: p, prompt: raw, images: imgs, ratio, duration, title: raw });
    paint();
  }

  paint();
  ta.addEventListener('change', saveForm);

  let off = null;
  off = onJob(kind => {
    if (!stage.isConnected) { off && off(); return; }
    if (kind === 'video') paint();
  });

  const timer = setInterval(() => {
    if (!stage.isConnected) { clearInterval(timer); return; }
    const s = wsGet('video');
    if (!s.busy) return;
    const t = stage.querySelector('.ws-time');
    if (t) t.textContent = '已等待 ' + elapsed(s.startedAt);
  }, 1000);
}
