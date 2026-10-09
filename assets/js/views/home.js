/* ============ 首页 · 创作广场 ============ */
import { h, $, toast, pickFile, modelChip, timeAgo } from '../ui.js';
import { store, saveMedia, uid } from '../store.js';
import { providers, chat } from '../models.js';
import { go } from '../app.js';

const MODES = [
  { k: 'image', label: '图片生成', icon: '🖼️', ph: '描述你想要的画面。例如：黄昏的海边露营地，米白色帐篷亮起暖灯，电影感，4K。' },
  { k: 'video', label: '视频生成', icon: '🎬', ph: '描述镜头内容与运动。例如：镜头缓慢向帐篷推进，海风吹动帐篷布，夕阳接近海平面，加入海浪声。' },
  { k: 'studio', label: '剧情短片', icon: '🎞️', ph: '一句话故事创意。例如：现代外卖员意外穿越到古代皇宫，被误认成御厨，情急之下做了一碗蛋炒饭。' },
  { k: 'agent', label: 'Agent 对话', icon: '✨', ph: '直接说需求。例如：帮我把这段故事拆成 6 个分镜，标出景别和运镜。' }
];

const IDEAS = [
  '黄昏海边露营，镜头缓慢推近帐篷',
  '古装轻喜剧 · 御膳房来了个外卖员',
  '雨夜中式茶馆，风衣女子推门而入',
  '国风仙侠 · 折梅听风，一镜到底',
  '产品开箱种草短片，竖屏 9:16',
  '治愈系：小猫在厨房做蛋炒饭'
];

export function render(root, params = {}) {
  let mode = params.mode || 'image';
  const refs = [];   // {label, file, url}

  const ph = MODES.find(m => m.k === mode).ph;
  const ta = h('textarea', { class: 'composer-input', placeholder: ph });
  const refRow = h('div', { class: 'ref-row' });

  const addRef = async (label) => {
    const f = await pickFile('image/*');
    if (!f) return;
    const url = await saveMedia(f);
    refs.push({ label, url, name: f.name });
    drawRefs();
  };
  function drawRefs() {
    refRow.innerHTML = '';
    const slots = ['首帧', '尾帧', '参考图'];
    for (const s of slots) {
      const has = refs.find(r => r.label === s);
      const el = h('div', { class: 'ref-slot', onclick: () => !has && addRef(s) },
        has ? h('img', { src: has.url }) : null,
        has ? h('div', { class: 'del', onclick: e => { e.stopPropagation(); refs.splice(refs.indexOf(has), 1); drawRefs(); } }, '×') : null,
        has ? null : h('span', { style: { fontSize: '16px' } }, '＋'),
        has ? null : h('span', {}, s)
      );
      refRow.append(el);
    }
  }
  drawRefs();

  const modeTabs = h('div', { class: 'mode-tabs' });
  const redrawTabs = () => {
    modeTabs.innerHTML = '';
    for (const m of MODES) {
      modeTabs.append(h('button', {
        class: 'mode-tab' + (m.k === mode ? ' active' : ''),
        onclick: () => { mode = m.k; redrawTabs(); ta.placeholder = m.ph; syncModel(); }
      }, h('span', {}, m.icon), m.label));
    }
  };
  redrawTabs();

  const modelBtn = h('button', { class: 'model-select', onclick: () => go('settings') });
  const syncModel = () => {
    const type = mode === 'image' ? 'image' : mode === 'video' ? 'video' : 'text';
    modelBtn.innerHTML = `<span class="model-dot"></span>${modelChip(type)}
      <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2"><path d="M6 9l6 6 6-6"/></svg>`;
  };
  syncModel();

  const send = async () => {
    const prompt = ta.value.trim();
    if (mode === 'image' && !prompt) return toast('先写点画面描述', 'err');
    if (mode === 'video' && !prompt) return toast('先写点镜头描述', 'err');
    if (mode === 'studio') return go('studio', { prompt });
    if (mode === 'agent') return runAgent(prompt);
    go(mode, { prompt, refs: refs.map(r => r.url) });
  };

  const sendBtn = h('button', { class: 'send-round', title: '开始', onclick: send },
    h('span', { html: '<svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 19V5M5 12l7-7 7 7"/></svg>' }));

  const composer = h('div', { class: 'composer' },
    modeTabs,
    ta,
    refRow,
    h('div', { class: 'composer-bar' },
      modelBtn,
      h('div', { class: 'composer-actions' },
        h('span', { style: { fontSize: '12px', color: 'var(--txt-3)' } }, `${ta.value.length}`),
        sendBtn
      )
    )
  );
  ta.addEventListener('input', () => {
    composer.querySelector('.composer-actions span').textContent = ta.value.length;
  });

  const chips = h('div', { class: 'chip-row' },
    ...IDEAS.map(t => h('button', { class: 'chip', onclick: () => { ta.value = t; ta.focus(); } }, t)));

  /* 作品流 */
  const works = store.list('works');
  const flow = works.length
    ? h('div', { class: 'flow-grid' }, ...works.slice(0, 8).map(w => workCard(w)))
    : h('div', { class: 'flow-grid' }, ...SAMPLE.map(s => sampleCard(s)));

  root.append(h('div', { class: 'home' },
    h('div', { class: 'home-hero' },
      h('h1', { class: 'home-title' }, '把想法交给它，', h('em', {}, '剩下的交给画布')),
      h('div', { class: 'home-desc' }, '接入你自己的模型，剧本 · 分镜 · 图像 · 视频，全部在同一块画布上完成')
    ),
    composer,
    chips,
    h('div', { class: 'home-flow' },
      h('div', { class: 'section-title' },
        works.length ? '最近作品' : '灵感广场',
        h('span', { class: 'tag' }, works.length ? `${works.length} 个` : '示例')),
      flow
    )
  ));

  async function runAgent(prompt) {
    if (!prompt) return toast('说点什么吧', 'err');
    const defaultProvider = providers.defaultOf('text');
    if (!defaultProvider) return toast('还没接入文本模型，去「模型接入」配置', 'err');
    const tw = h('div', { class: 'node-text' }, '思考中…');
    const m = (await import('../ui.js')).modal({
      title: 'Agent',
      large: true,
      body: h('div', {},
        h('div', { style: { fontSize: '12.5px', color: 'var(--txt-3)', marginBottom: '6px' } }, '你：' + prompt),
        tw)
    });
    try {
      const out = await chat(prompt, {
        system: '你是短视频/短剧创作助手。用中文回答，结构清晰，能直接落地为分镜、提示词或拍摄方案。'
      });
      tw.innerHTML = '';
      tw.append(h('div', { style: { whiteSpace: 'pre-wrap' } }, out));
    } catch (e) { tw.textContent = '失败：' + e.message; }
    return m;
  }
}

function workCard(w) {
  const thumb = w.type === 'video'
    ? (w.cover || w.url ? h('video', { src: w.url || w.cover, muted: true, playsinline: true }) : h('div', { class: 'flow-ph' }, '🎬'))
    : (w.url ? h('img', { src: w.url, loading: 'lazy' }) : h('div', { class: 'flow-ph' }, '🖼️'));
  return h('div', { class: 'flow-card', onclick: () => go('works') },
    h('div', { class: 'flow-thumb' }, thumb, h('span', { class: 'flow-badge' }, w.type === 'video' ? '视频' : '图片')),
    h('div', { class: 'flow-body' },
      h('div', { class: 'flow-title' }, w.title || '未命名作品'),
      h('div', { class: 'flow-meta' }, timeAgo(w.createdAt)))
  );
}

const SAMPLE = [
  { t: '折梅听风 · 古风一镜到底', tag: '短剧', emoji: '🌸', meta: '9:16 · 12s' },
  { t: '御膳房来了个外卖员', tag: '轻喜剧', emoji: '🍚', meta: '16:9 · 30s' },
  { t: '海边露营 · 蓝调时刻', tag: '氛围片', emoji: '🏕️', meta: '16:9 · 8s' },
  { t: '雨夜中式茶馆', tag: '广告', emoji: '🌧️', meta: '9:16 · 15s' },
  { t: '云上天宫 · 仙侠开场', tag: '短剧', emoji: '☁️', meta: '16:9 · 10s' },
  { t: '像素风 · 闯关小剧场', tag: '动画', emoji: '👾', meta: '1:1 · 6s' },
  { t: '产品开箱 · 竖屏种草', tag: '电商', emoji: '📦', meta: '9:16 · 20s' },
  { t: '水墨国风 · 山雨欲来', tag: '国风', emoji: '🏔️', meta: '16:9 · 9s' }
];
function sampleCard(s) {
  return h('div', { class: 'flow-card' },
    h('div', { class: 'flow-thumb' }, h('div', { class: 'flow-ph' }, s.emoji), h('span', { class: 'flow-badge' }, s.tag)),
    h('div', { class: 'flow-body' }, h('div', { class: 'flow-title' }, s.t), h('div', { class: 'flow-meta' }, s.meta)));
}
