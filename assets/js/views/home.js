/* ============ 首页 · 创作广场（对齐 Pavo 布局） ============ */
import { h, $, toast, pickFile, modelChip, timeAgo } from '../ui.js';
import { icon } from '../icons.js';
import { store, saveMedia, uid } from '../store.js';
import { providers, chat } from '../models.js';
import { go } from '../app.js';

const MODES = [
  { k: 'image', label: '图片生成', icon: 'image', ph: '上传参考素材，输入文字，请描述你想生成的图片' },
  { k: 'video', label: '视频生成', icon: 'video', ph: '上传参考素材（首帧 / 尾帧），输入文字，请描述你想生成的视频' },
  { k: 'studio', label: '剧情短片', icon: 'film', ph: '一句话故事创意。例如：现代外卖员意外穿越到古代皇宫，被误认成御厨，情急之下做了一碗蛋炒饭。' },
  { k: 'agent', label: 'Agent 对话', icon: 'agent', ph: '直接说需求。例如：帮我把这段故事拆成 6 个分镜，标出景别和运镜。' }
];

const ENTRIES = [
  { k: 'image', label: '图片生成', icon: 'image', desc: '多模型可选，支持商业海报、电商视觉、人物写真与风格化编辑' },
  { k: 'video', label: '视频生成', icon: 'video', desc: '文生视频 / 图生视频，多种画幅与清晰度' },
  { k: 'studio', label: '剧情短片', icon: 'film', desc: '从剧本到成片，全流程自动生成' },
  { k: 'agent', label: 'Agent', icon: 'agent', desc: '一句话下达复合创作指令，自动拆解并执行' }
];

const CATS = ['娱乐短片', '创意图片', '科幻特效', '萌宠', '全民唱跳', '营销素材', 'Summer Breeze'];

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

  const modeTabs = h('div', { class: 'composer-tabs' });
  const redrawTabs = () => {
    modeTabs.innerHTML = '';
    for (const m of MODES.slice(0, 2)) {
      modeTabs.append(h('button', {
        class: 'ctab' + (m.k === mode ? ' active' : ''),
        onclick: () => { mode = m.k; redrawTabs(); ta.placeholder = m.ph; syncModel(); }
      }, h('span', { html: icon(m.icon, 16) }), m.label));
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

  /* 创作入口四宫格 */
  const entryGrid = h('div', { class: 'entry-grid' },
    ...ENTRIES.map(e => h('button', { class: 'entry-tile', onclick: () => {
      if (e.k === 'agent') return runAgent();
      if (e.k === 'studio') return go('studio');
      mode = e.k; redrawTabs(); ta.placeholder = MODES.find(m => m.k === e.k).ph; syncModel();
      ta.focus(); window.scrollTo({ top: 0, behavior: 'smooth' });
    } },
      h('div', { class: 'entry-icon', html: icon(e.icon, 22) }),
      h('div', { class: 'entry-label' }, e.label),
      h('div', { class: 'entry-desc' }, e.desc)
    ))
  );

  const chips = h('div', { class: 'chip-row' },
    ...IDEAS.map(t => h('button', { class: 'chip', onclick: () => { ta.value = t; ta.focus(); } }, t)));

  /* 发现区 */
  const works = store.list('works');
  const flow = works.length
    ? h('div', { class: 'flow-grid' }, ...works.slice(0, 8).map(w => workCard(w)))
    : h('div', { class: 'flow-grid' }, ...PRESETS.map(s => presetCard(s)));

  root.append(h('div', { class: 'home' },
    h('div', { class: 'home-hero' },
      h('h1', { class: 'home-title' }, '释放你的创造力，', h('br', {}), '即刻将创意变为现实！'),
      h('div', { class: 'home-desc' }, '输入想法或剧本，上传参考，和林的视频工作台一起创作')
    ),
    composer,
    entryGrid,
    chips,
    h('div', { class: 'home-flow' },
      h('div', { class: 'section-title' },
        works.length ? '最近作品' : '灵感预设',
        h('span', { class: 'tag' }, works.length ? `${works.length} 个` : `${PRESETS.length} 个可直接跑`),
        h('a', { class: 'flow-link', onclick: () => go('inspire') }, '更多灵感')),
      h('div', { class: 'cat-row' },
        ...CATS.map(c => h('button', { class: 'cat-chip' }, c))),
      flow
    )
  ));

  async function runAgent(prompt) {
    prompt = prompt || ta.value.trim();
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
    ? (w.cover || w.url ? h('video', { src: w.url || w.cover, muted: true, playsinline: true }) : h('div', { class: 'flow-ph', html: icon('video', 36) }))
    : (w.url ? h('img', { src: w.url, loading: 'lazy' }) : h('div', { class: 'flow-ph', html: icon('image', 36) }));
  return h('div', { class: 'flow-card', onclick: () => go('works') },
    h('div', { class: 'flow-thumb' }, thumb, h('span', { class: 'flow-badge' }, w.type === 'video' ? '视频' : '图片')),
    h('div', { class: 'flow-body' },
      h('div', { class: 'flow-title' }, w.title || '未命名作品'),
      h('div', { class: 'flow-meta' }, timeAgo(w.createdAt)))
  );
}

/* 灵感预设：缩略图是平台真实生成过的图，提示词与尺寸都是可直接跑的真参数。
   点一下 = 建一个带好提示词的画布项目，进去按「生成」就能出结果（不再是空壳示例）。 */
const PRESETS = [
  { t: '写实电影感 · 雨夜霓虹小巷', tag: '图片', img: 'assets/style/cinematic.jpg', size: '1536x864',
    prompt: '一位穿风衣的女子站在雨夜的霓虹小巷里，湿地面倒映着霓虹灯，35mm 电影感，浅景深，胶片颗粒' },
  { t: '2D 动漫 · 放学后的天台', tag: '图片', img: 'assets/style/anime.jpg', size: '864x1536',
    prompt: '放学后的学校天台，长发少女靠在栏杆上望着夕阳，动漫赛璐璐上色，暖色调，干净线稿' },
  { t: '3D 渲染 · 治愈系小机器人', tag: '图片', img: 'assets/style/3d.jpg', size: '1024x1024',
    prompt: '一只圆滚滚的可爱小机器人朝镜头挥手，柔和影棚光，皮克斯质感 3D 渲染，干净浅色背景' },
  { t: '国风水墨 · 山雨欲来', tag: '图片', img: 'assets/style/ink.jpg', size: '1536x864',
    prompt: '水墨山水，层叠远山与江面一叶小舟，大面积留白，宣纸质感，淡彩' },
  { t: '美式漫画 · 城市屋顶', tag: '图片', img: 'assets/style/comic.jpg', size: '1024x1024',
    prompt: '超级英雄站在城市屋顶俯瞰天际线，粗黑描边，网点印刷感，平涂饱和色' },
  { t: '像素风 · 奇幻酒馆', tag: '图片', img: 'assets/style/pixel.jpg', size: '1024x1024',
    prompt: '16-bit 像素风奇幻酒馆内部，壁炉火光，等距视角，有限色板，颗粒清晰' },
  { t: '儿童插画 · 森林里的小狐狸', tag: '图片', img: 'assets/style/kids.jpg', size: '1024x1024',
    prompt: '秋日森林里一只微笑的小狐狸在树下读书，柔和水彩，暖色治愈，绘本插画' },
  { t: '赛博朋克 · 霓虹夜街', tag: '图片', img: 'assets/style/cyberpunk.jpg', size: '1536x864',
    prompt: '赛博朋克夜街，霓虹招牌，雨后积水倒影，飞行器掠过，品红与青高对比' }
];

function presetCard(s) {
  return h('div', { class: 'flow-card', onclick: () => usePreset(s) },
    h('div', { class: 'flow-thumb' },
      h('img', { src: s.img, alt: s.t, loading: 'lazy' }),
      h('span', { class: 'flow-badge' }, s.tag),
      h('span', { class: 'flow-use' }, '一键建画布')),
    h('div', { class: 'flow-body' },
      h('div', { class: 'flow-title' }, s.t),
      h('div', { class: 'flow-meta' }, s.size.replace('x', '×'))));
}

/* 按预设建一个「描述 → 图片」两节点画布，提示词和尺寸都填好，进去直接能跑 */
function usePreset(s) {
  const text = { id: uid('n'), type: 'text', x: 120, y: 200, title: '创意描述', prompt: s.prompt, content: s.prompt, media: null };
  const img = { id: uid('n'), type: 'image', x: 560, y: 200, title: s.t, prompt: s.prompt, content: '', media: null, size: s.size };
  const p = {
    id: uid('pj'), name: s.t, nodes: [text, img],
    edges: [{ id: uid('e'), from: text.id, to: img.id }],
    viewport: { x: 60, y: 40, zoom: 1 }, createdAt: Date.now(), updatedAt: Date.now()
  };
  store.add('projects', p);
  go('canvas-edit', { id: p.id });
  toast('已按预设建好画布，点图片节点的「生成」就能出图', 'ok', 3600);
}
