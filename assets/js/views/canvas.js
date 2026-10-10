/* ============ 无限画布 ============ */
import { h, $, $$, toast, ctxMenu, modal, confirm, pickFile, modelChip, timeAgo, download } from '../ui.js';
import { icon } from '../icons.js';
import { store, uid, saveMedia } from '../store.js';
import { providers, chat, genImage, genVideo } from '../models.js';
import { openDirector } from '../director.js';
import { concatVideos } from '../media.js';
import { go } from '../app.js';

/* 节点注册表（插件化入口）：默认节点 + 外部可 registerNodeType 扩展 */
export const NODE_REGISTRY = {
  text: { label: '文本', icon: '文' },
  image: { label: '图片', icon: '图' },
  video: { label: '视频', icon: '视' },
  audio: { label: '音频', icon: '音' },
  merge: { label: '视频合成', icon: '合' },
  director: { label: '导演台', icon: '导' },
  upload: { label: '素材', icon: '素' }
};
export function registerNodeType(type, meta) { NODE_REGISTRY[type] = meta; }
const TRY = {
  text: ['自己编写', '一句话生成剧本', '扩写成分镜脚本', '文生图', '文生视频', '图片反推提示词'],
  image: ['文生图', '图生图', '角色四视图', '场景设定图', '局部重绘'],
  video: ['文生视频', '图生视频', '首尾帧补间', '全能参考'],
  audio: ['上传音频', '生成背景音乐', '生成音效'],
  merge: ['合成成片', '预览片段'],
  director: ['机位预演', '角色站位'],
  upload: ['上传文件', '从资产库添加']
};

/* ---------------- 项目列表 ---------------- */
export function renderList(root) {
  const list = store.list('projects');
  const grid = list.length
    ? h('div', { class: 'flow-grid' }, ...list.map(p => {
      const first = p.nodes?.find(n => n.media?.url);
      return h('div', { class: 'flow-card', onclick: () => go('canvas-edit', { id: p.id }) },
        h('div', { class: 'flow-thumb' },
          first ? h('img', { src: first.media.url }) : h('div', { class: 'flow-ph', html: icon('canvas', 30) }),
          h('span', { class: 'flow-badge' }, `${p.nodes?.length || 0} 节点`)),
        h('div', { class: 'flow-body' },
          h('div', { class: 'flow-title' }, p.name),
          h('div', { class: 'flow-meta' }, '更新于 ' + timeAgo(p.updatedAt || p.createdAt))));
    }))
    : h('div', { class: 'empty' }, h('div', { class: 'empty-icon', html: icon('canvas', 40) }), '还没有画布项目，点右上角新建一个');

  root.append(h('div', { class: 'page' },
    h('div', { style: { display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' } },
      h('div', {},
        h('div', { class: 'page-title' }, '无限画布'),
        h('div', { class: 'page-sub' }, '灵感无边界，创作更自由 — 文本 · 图片 · 视频 · 音频 · 合成 · 导演台')),
      h('button', { class: 'btn-primary', onclick: newProject }, '＋ 新建画布项目')),
    grid));
}
function newProject() {
  const p = { id: uid('pj'), name: '未命名画布 ' + new Date().toLocaleDateString('zh-CN'), nodes: [], edges: [], viewport: { x: 120, y: 100, zoom: 1 }, createdAt: Date.now(), updatedAt: Date.now() };
  store.add('projects', p);
  go('canvas-edit', { id: p.id });
}

/* ---------------- 编辑器 ---------------- */
export function renderEditor(root, params) {
  const proj = store.find('projects', params.id) || store.list('projects')[0];
  if (!proj) { root.innerHTML = ''; go('canvas'); return; }
  proj.nodes = proj.nodes || []; proj.edges = proj.edges || [];
  const vp = proj.viewport = proj.viewport || { x: 120, y: 100, zoom: 1 };

  const stage = h('div', { class: 'canvas-viewport' });
  const grid = h('div', { class: 'canvas-grid' });
  const wrap = h('div', { class: 'canvas-wrap' }, grid, stage);
  const nodeEls = new Map();
  let selected = null, linking = null, tempLine = null;

  /* ---- 坐标换算 ---- */
  const toWorld = (clientX, clientY) => {
    const r = wrap.getBoundingClientRect();
    return { x: (clientX - r.left - vp.x) / vp.zoom, y: (clientY - r.top - vp.y) / vp.zoom };
  };
  const applyVp = () => {
    stage.style.transform = `translate(${vp.x}px,${vp.y}px) scale(${vp.zoom})`;
    if (zoomLabel) zoomLabel.textContent = Math.round(vp.zoom * 100) + '%';
    scheduleMinimap();
  };
  const save = () => { proj.updatedAt = Date.now(); store.save(); };

  /* ---- 撤销 / 重做（参考 PinCanvas/Zundo 思路） ---- */
  const undoStack = [], redoStack = [];
  const takeSnap = () => JSON.stringify({ n: proj.nodes, e: proj.edges });
  const pushUndo = () => { undoStack.push(takeSnap()); if (undoStack.length > 60) undoStack.shift(); redoStack.length = 0; updateUndoButtons(); };
  function updateUndoButtons() { if (undoBtn) undoBtn.disabled = !undoStack.length; if (redoBtn) redoBtn.disabled = !redoStack.length; }
  function restoreSnap(snap) {
    const d = JSON.parse(snap);
    proj.nodes = d.n; proj.edges = d.e;
    selected = null; refresh(); save(); updateUndoButtons();
  }
  function undo() { if (!undoStack.length) return; redoStack.push(takeSnap()); restoreSnap(undoStack.pop()); toast('已撤销', 'ok', 900); }
  function redo() { if (!redoStack.length) return; undoStack.push(takeSnap()); restoreSnap(redoStack.pop()); toast('已重做', 'ok', 900); }

  /* ---- 小地图（鸟瞰导航）
     规则：只有「有节点跑到视野外」时它才有用，否则自动收起，不白占画布左下角。
     工具栏上的小地图按钮可强制显示 / 隐藏。 ---- */
  let mmOn = true, mmForce = false, mmTransform = null, mmScheduled = false;
  /* 缩略图节点配色（按节点类型） */
  const MM_FILL = {
    text: '#D9DEE7', image: '#AFDED7', video: '#A9C6EA',
    audio: '#EFD7A9', merge: '#C3CBF0', director: '#D6C9EC', upload: '#E3E6EA'
  };
  function mmUseful() {
    if (!proj.nodes.length) return false;
    const margin = 60;
    const vx = -vp.x / vp.zoom, vy = -vp.y / vp.zoom;
    const vw = wrap.clientWidth / vp.zoom, vh = wrap.clientHeight / vp.zoom;
    for (const n of proj.nodes) {
      const el = nodeEls.get(n.id);
      const w = el?.offsetWidth || 300, hh = el?.offsetHeight || 160;
      if (n.x < vx - margin || n.y < vy - margin) return true;
      if (n.x + w > vx + vw + margin || n.y + hh > vy + vh + margin) return true;
    }
    return false;
  }
  function mmVisible() { return mmOn && (mmForce || mmUseful()); }
  function applyMM() {
    const vis = mmVisible();
    mmWrap.classList.toggle('hidden', !vis);
    mmToggle.classList.toggle('active', vis);
    mmToggle.title = vis ? '收起小地图'
      : mmOn ? '小地图（内容都在视野内，已自动收起）' : '显示小地图';
    if (vis) drawMinimap();
  }
  function scheduleMinimap() {
    if (mmScheduled) return;
    mmScheduled = true;
    requestAnimationFrame(() => { mmScheduled = false; applyMM(); });
  }
  function drawMinimap() {
    const c = mmCanvas; if (!c) return;
    const ctx = c.getContext('2d');
    const W = 168, H = 112, dpr = Math.min(2, devicePixelRatio || 1);
    if (c.width !== W * dpr) { c.width = W * dpr; c.height = H * dpr; c.style.width = W + 'px'; c.style.height = H + 'px'; }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, W, H);

    const vw = wrap.clientWidth / vp.zoom, vh = wrap.clientHeight / vp.zoom;
    const view = { x: -vp.x / vp.zoom, y: -vp.y / vp.zoom, w: vw, h: vh };
    let minX = view.x, minY = view.y, maxX = view.x + view.w, maxY = view.y + view.h;
    const sizeOf = n => {
      const el = nodeEls.get(n.id);
      return [el?.offsetWidth || 300, el?.offsetHeight || 160];
    };
    for (const n of proj.nodes) {
      const [w, hh] = sizeOf(n);
      minX = Math.min(minX, n.x); minY = Math.min(minY, n.y);
      maxX = Math.max(maxX, n.x + w); maxY = Math.max(maxY, n.y + hh);
    }
    const pad = 24; minX -= pad; minY -= pad; maxX += pad; maxY += pad;
    const s = Math.min(W / (maxX - minX), H / (maxY - minY));
    const ox = (W - (maxX - minX) * s) / 2, oy = (H - (maxY - minY) * s) / 2;
    mmTransform = { s, ox, oy, minX, minY };
    const toMM = (x, y) => [ox + (x - minX) * s, oy + (y - minY) * s];

    /* 连线 */
    ctx.strokeStyle = '#D9DCE1'; ctx.lineWidth = 1;
    for (const e of proj.edges) {
      const a = proj.nodes.find(n => n.id === e.from), b = proj.nodes.find(n => n.id === e.to);
      if (!a || !b) continue;
      const [aw, ah] = sizeOf(a), [bw, bh] = sizeOf(b);
      const [x1, y1] = toMM(a.x + aw / 2, a.y + ah / 2);
      const [x2, y2] = toMM(b.x + bw / 2, b.y + bh / 2);
      ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.stroke();
    }
    /* 节点：按类型配色，一眼区分文本/图片/视频… */
    for (const n of proj.nodes) {
      const [w, hh] = sizeOf(n);
      const [x, y] = toMM(n.x, n.y);
      const rw = Math.max(5, w * s), rh = Math.max(4, hh * s);
      ctx.fillStyle = n.error ? '#F0A9A9'
        : n.status ? '#F5C26B'
        : MM_FILL[n.type] || '#E6E8EC';
      ctx.fillRect(x, y, rw, rh);
      const isSel = n.id === selected?.id;
      ctx.strokeStyle = isSel ? '#17B8A6' : 'rgba(17,17,17,.16)';
      ctx.lineWidth = isSel ? 1.5 : 1;
      ctx.strokeRect(Math.round(x) + .5, Math.round(y) + .5,
        Math.max(3, Math.round(rw) - 1), Math.max(3, Math.round(rh) - 1));
    }
    /* 当前视口框：淡青底 + 锐利青边，一眼看出「我在看哪一块」 */
    const [vx, vy] = toMM(view.x, view.y);
    const vw2 = Math.min(W, view.w * s), vh2 = Math.min(H, view.h * s);
    ctx.fillStyle = 'rgba(23,184,166,.08)';
    ctx.fillRect(vx, vy, vw2, vh2);
    ctx.strokeStyle = '#17B8A6'; ctx.lineWidth = 1;
    ctx.strokeRect(Math.round(vx) + .5, Math.round(vy) + .5,
      Math.max(2, Math.round(vw2) - 1), Math.max(2, Math.round(vh2) - 1));
  }

  /* ---- 边 ---- */
  const edgeLayer = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  edgeLayer.setAttribute('class', 'edges');
  stage.append(edgeLayer);

  function portPos(node, side) {
    const el = nodeEls.get(node.id); if (!el) return null;
    const w = el.offsetWidth || 300, hh = el.offsetHeight || 160;
    return side === 'out' ? { x: node.x + w, y: node.y + hh / 2 } : { x: node.x, y: node.y + hh / 2 };
  }
  const SVGNS = 'http://www.w3.org/2000/svg';
  function drawEdges() {
    edgeLayer.innerHTML = '';
    /* 连线箭头（Pavo 风格） */
    const defs = document.createElementNS(SVGNS, 'defs');
    const mk = document.createElementNS(SVGNS, 'marker');
    mk.setAttribute('id', 'earrow');
    mk.setAttribute('viewBox', '0 0 10 10');
    mk.setAttribute('refX', '9'); mk.setAttribute('refY', '5');
    mk.setAttribute('markerWidth', '6'); mk.setAttribute('markerHeight', '6');
    mk.setAttribute('orient', 'auto-start-reverse');
    const tip = document.createElementNS(SVGNS, 'path');
    tip.setAttribute('d', 'M0,0 L10,5 L0,10 z');
    tip.setAttribute('fill', '#B6BAC4');
    mk.append(tip); defs.append(mk); edgeLayer.append(defs);

    for (const e of proj.edges) {
      const a = proj.nodes.find(n => n.id === e.from), b = proj.nodes.find(n => n.id === e.to);
      if (!a || !b) continue;
      const p1 = portPos(a, 'out'), p2 = portPos(b, 'in'); if (!p1 || !p2) continue;
      const dx = Math.max(40, Math.abs(p2.x - p1.x) * 0.45);
      const d = `M${p1.x},${p1.y} C${p1.x + dx},${p1.y} ${p2.x - dx},${p2.y} ${p2.x - 2},${p2.y}`;
      const path = document.createElementNS(SVGNS, 'path');
      path.setAttribute('class', 'edge');
      path.setAttribute('d', d);
      path.setAttribute('marker-end', 'url(#earrow)');
      edgeLayer.append(path);
    }
  }

  /* ---- 上游取值 ---- */
  function upstream(node) {
    const ids = proj.edges.filter(e => e.to === node.id).map(e => e.from);
    return ids.map(id => proj.nodes.find(n => n.id === id)).filter(Boolean);
  }

  /* ---- 节点元素 ---- */
  /* 折叠态（未选中）：只露结果预览，像 Pavo 一样一眼看清生成物；
     选中态：展开提示词、参数与按钮，才显示可编辑面板 */
  const isSel = node => !!selected && !!node && selected.id === node.id;
  const PH_HINT = {
    text: '点击节点，写需求生成文案/脚本',
    image: '点击节点，描述画面或连上参考图',
    video: '点击节点，描述镜头或连上首帧',
    audio: '点击节点，上传音频或生成配音',
    merge: '把视频节点连过来，点击合成成片',
    director: '点击节点，打开 3D 导演台摆位截图',
    upload: '点击节点，上传文件作为素材'
  };
  function paintState(el, node) {
    const sel = isSel(node);
    el.classList.toggle('selected', sel);
    el.classList.toggle('collapsed', !sel);
  }

  function buildNode(node) {
    const meta = NODE_REGISTRY[node.type] || NODE_REGISTRY.text;
    const modelTag = h('span', { class: 'node-model' });
    const syncModel = () => {
      const t = node.type === 'image' ? 'image' : node.type === 'video' ? 'video' : 'text';
      modelTag.textContent = modelChip(t);
    };
    syncModel();

    const body = h('div', { class: 'node-body' });
    const actions = h('div', { class: 'node-actions' });

    const el = h('div', { class: 'node', dataset: { id: node.id } },
      h('div', { class: 'node-head' },
        h('div', { class: 'node-icon' }, meta.icon),
        h('div', { class: 'node-title' }, node.title || meta.label + '节点'),
        modelTag),
      body, actions,
      h('button', { class: 'node-del', onclick: e => { e.stopPropagation(); delNode(node); } }, '×'),
      h('div', { class: 'node-port port-in', title: '输入' }, ''),
      h('div', { class: 'node-port port-out', title: '拖出连线' }, '＋')
    );
    el.style.left = node.x + 'px'; el.style.top = node.y + 'px';
    paintState(el, node);
    nodeEls.set(node.id, el);

    /* 选择 */
    el.addEventListener('mousedown', e => { if (e.target.closest('.media-play')) return; select(node); }, true);

    /* 拖动 */
    el.querySelector('.node-head').addEventListener('mousedown', e => {
      if (e.target.closest('.node-model')) return;
      e.stopPropagation();
      const sx = e.clientX, sy = e.clientY, ox = node.x, oy = node.y;
      let pushed = false;
      const move = ev => {
        if (!pushed) { pushUndo(); pushed = true; }
        node.x = ox + (ev.clientX - sx) / vp.zoom;
        node.y = oy + (ev.clientY - sy) / vp.zoom;
        el.style.left = node.x + 'px'; el.style.top = node.y + 'px';
        drawEdges(); scheduleMinimap();
      };
      const up = () => { document.removeEventListener('mousemove', move); document.removeEventListener('mouseup', up); save(); };
      document.addEventListener('mousemove', move); document.addEventListener('mouseup', up);
    });

    /* 连线 */
    el.querySelector('.port-out').addEventListener('mousedown', e => {
      e.stopPropagation(); e.preventDefault();
      linking = node;
      const p1 = portPos(node, 'out');
      tempLine = document.createElementNS('http://www.w3.org/2000/svg', 'path');
      tempLine.setAttribute('class', 'edge active');
      tempLine.setAttribute('d', `M${p1.x},${p1.y} L${p1.x},${p1.y}`);
      edgeLayer.append(tempLine);
      const move = ev => {
        const w = toWorld(ev.clientX, ev.clientY);
        const dx = Math.max(40, Math.abs(w.x - p1.x) * 0.45);
        tempLine.setAttribute('d', `M${p1.x},${p1.y} C${p1.x + dx},${p1.y} ${w.x - dx},${w.y} ${w.x},${w.y}`);
      };
      const up = ev => {
        document.removeEventListener('mousemove', move); document.removeEventListener('mouseup', up);
        tempLine?.remove(); tempLine = null;
        const hit = document.elementFromPoint(ev.clientX, ev.clientY)?.closest('.node');
        if (hit) {
          const target = proj.nodes.find(n => n.id === hit.dataset.id);
          if (target && target.id !== node.id && !proj.edges.some(x => x.from === node.id && x.to === target.id)) {
            pushUndo();
            proj.edges.push({ id: uid('e'), from: node.id, to: target.id });
            save(); drawEdges(); refresh(target);
          }
        }
        linking = null;
      };
      document.addEventListener('mousemove', move); document.addEventListener('mouseup', up);
    });

    /* 右键 */
    el.addEventListener('contextmenu', e => {
      e.preventDefault(); e.stopPropagation();
      ctxMenu(e.clientX, e.clientY, [
        { text: '生成 / 重跑', onClick: () => run(node, refresh) },
        { text: '复制节点', onClick: () => { pushUndo(); const c = structuredClone(node); c.id = uid('n'); c.x += 40; c.y += 40; proj.nodes.push(c); refresh(); save(); } },
        { text: '另存为资产', onClick: () => toAsset(node) },
        { text: '从此节点分支', onClick: () => { pushUndo(); const c = structuredClone(node); c.id = uid('n'); c.x = node.x + 380; c.y = node.y + 200; c.media = null; c.content = ''; proj.nodes.push(c); proj.edges.push({ id: uid('e'), from: node.id, to: c.id }); refresh(); save(); } },
        '-',
        { text: '下载素材', onClick: () => node.media?.url && download(node.media.url, node.title + '.png') },
        { text: '删除节点', onClick: () => delNode(node) }
      ]);
    });

    renderBody(node, body, actions, () => { syncModel(); refresh(node); });
    return el;
  }

  /* 折叠态内容：只显示已生成的结果（图/视频/文案）或空占位 */
  function renderCollapsed(node, body) {
    if (node.media?.url) {
      const isVid = node.media.type === 'video';
      const media = isVid
        ? h('video', { src: node.media.url, preload: 'metadata', muted: true, playsinline: true })
        : h('img', { src: node.media.url, loading: 'lazy', alt: node.title || '' });
      let playBtn = null;
      if (isVid) {
        playBtn = h('span', { class: 'media-play', title: '就地播放', onclick: e => {
          e.stopPropagation();
          media.controls = true; media.muted = false;
          media.play().catch(() => { toast('该视频暂时无法播放', 'err'); });
          playBtn.style.display = 'none';
        } }, h('span', { html: '<svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor"><path d="M8 5.4l11 6.6-11 6.6z"/></svg>' }));
      }
      body.append(h('div', { class: 'node-media' },
        media,
        h('span', { class: 'media-badge' }, isVid ? '视频' : '图片'),
        playBtn,
        h('span', { class: 'media-edit' }, '点击展开编辑')));
      const cap = (node.prompt || node.content || '').trim();
      if (cap) body.append(h('div', { class: 'node-cap' }, cap));
    } else if (node.content) {
      body.append(h('div', { class: 'node-text' }, node.content));
    } else {
      body.append(h('div', { class: 'node-ph' },
        h('div', { class: 'ph-ico', html: icon(node.type === 'video' ? 'video' : node.type === 'image' ? 'image' : 'layers', 22) }),
        h('div', { class: 'ph-t' }, PH_HINT[node.type] || '点击节点，描述你的需求后生成'),
        h('span', { class: 'ph-btn' }, '打开面板')));
    }
  }

  function renderBody(node, body, actions, rerender) {
    body.innerHTML = ''; actions.innerHTML = '';
    const expanded = isSel(node);
    const statusEl = node.status ? h('div', { class: 'node-status' }, h('span', { class: 'spinner' }), node.status) : null;
    const errEl = node.error ? h('div', { class: 'node-status err' }, '⚠ ' + node.error) : null;

    /* 折叠态：只露结果，不露任何可编辑控件 */
    if (!expanded) {
      body.classList.add('collapsed');
      renderCollapsed(node, body);
      if (statusEl) body.append(statusEl);
      if (errEl) body.append(errEl);
      return;
    }
    body.classList.remove('collapsed');
    if (statusEl) body.append(statusEl);
    if (errEl) body.append(errEl);

    /* 尝试区 */
    const tries = TRY[node.type] || TRY.text;
    const tryBox = h('div', { class: 'node-try' }, h('div', { class: 'try-h' }, '尝试'));
    for (const t of tries.slice(0, 5)) {
      tryBox.append(h('button', { class: 'try-chip', onclick: () => runTry(node, t, refresh) }, '· ' + t));
    }
    if (node.type !== 'merge') body.append(tryBox);

    /* 内容区 */
    if (node.media?.url) {
      const media = node.media.type === 'video'
        ? h('video', { src: node.media.url, controls: true, style: { maxHeight: '280px', width: '100%' } })
        : h('img', { src: node.media.url });
      body.append(h('div', { class: 'node-media' }, media));
    }
    if (node.type === 'merge') body.append(renderMerge(node, refresh));
    if (node.type === 'director') body.append(renderDirector(node));
    if (node.content) body.append(h('div', { class: 'node-text', style: { marginTop: node.media?.url ? '8px' : '0' } }, node.content));
    if (node.type === 'video') body.append(renderVideoOpts(node, refresh));

    /* 输入区 */
    if (['text', 'image', 'video', 'merge', 'director'].includes(node.type)) {
      const ta = h('textarea', { class: 'node-textarea', placeholder: '描述你的需求…' });
      ta.value = node.prompt || '';
      ta.addEventListener('input', () => { node.prompt = ta.value; });
      ta.addEventListener('mousedown', e => e.stopPropagation());
      body.append(ta);
      actions.append(
        h('button', { class: 'node-btn primary', onclick: () => run(node, refresh) },
          h('span', { class: 'ico', html: icon('spark', 14) }), '生成'),
        h('button', { class: 'node-btn', onclick: () => { ta.value = ''; node.prompt = ''; } }, '清空')
      );
    }
    if (node.type === 'audio' || node.type === 'upload') {
      actions.append(h('button', { class: 'node-btn primary', onclick: () => uploadToNode(node, refresh) }, '上传文件'));
    }
    if (node.type === 'audio') {
      actions.append(h('button', {
        class: 'node-btn',
        onclick: () => toast('配音 / 音色克隆 / 音效生成：接口已预留，接入 TTS 模型后开放', 'ok', 4200)
      }, '配音（开发中）'));
    }
    actions.append(
      h('button', { class: 'node-btn', title: '收起面板，只看结果', onclick: deselect }, '收起'),
      h('button', { class: 'node-btn', onclick: () => toAsset(node) }, '存为资产'));
  }

  function renderVideoOpts(node, refresh) {
    const wrap = h('div', { class: 'video-opts' });
    const motion = h('select', { class: 'form-select sm', onchange: e => { node.motion = e.target.value; save(); } });
    ['无运镜', '缓慢推近', '缓慢拉远', '水平横移', '垂直升降', '环绕运镜', '手持跟拍', '航拍俯冲'].forEach(m => motion.append(h('option', { value: m }, m)));
    motion.value = node.motion || '无运镜';
    wrap.append(h('div', { class: 'vo-row' }, h('span', { class: 'vo-label' }, '运镜'), motion));

    const fr = h('div', { class: 'vo-frames' });
    for (const f of ['首帧', '尾帧']) {
      const key = f === '首帧' ? 'firstFrame' : 'lastFrame';
      const slot = h('div', { class: 'ref-slot sm' },
        node[key] ? h('img', { src: node[key] }) : h('span', {}, f),
        node[key] ? h('div', { class: 'del', onclick: ev => { ev.stopPropagation(); node[key] = null; refresh(node); save(); } }, '×') : null);
      slot.onclick = async () => {
        if (node[key]) return;
        const fl = await pickFile('image/*'); if (!fl) return;
        let url; try { url = await saveMedia(fl); } catch (e) { toast(e.message, 'err'); return; }
        node[key] = url; refresh(node); save();
      };
      fr.append(slot);
    }
    wrap.append(h('div', { class: 'vo-label' }, '首尾帧（图生视频补间）'), fr);
    return wrap;
  }

  function renderMerge(node, refresh) {
    const ups = upstream(node).filter(n => n.media?.url && n.media.type === 'video');
    const box = h('div', { class: 'node-try' },
      h('div', { class: 'try-h' }, `待合成片段（${ups.length}）`),
      ...ups.map((u, i) => h('div', { class: 'try-chip' }, `${i + 1}. ${u.title || '片段'}`)));

    if (!ups.length) {
      box.append(h('div', { class: 'try-h' }, '把视频节点连到本节点即可合成'));
      return box;
    }

    const xf = h('input', { type: 'checkbox' });
    xf.id = 'mg-xf-' + node.id;
    const btn = h('button', { class: 'node-btn primary', style: { marginTop: '8px' }, onclick: async e => {
      const b = e.currentTarget;
      b.disabled = true;
      node.error = ''; node.status = '准备合成引擎…'; refresh(node);
      try {
        const r = await concatVideos(ups.map(u => u.media.url), {
          transition: xf.checked ? 0.5 : 0,
          onProgress: s => { node.status = s; refresh(node); }
        });
        node.media = { url: r.url, type: 'video' };
        node.content = `已合成 ${ups.length} 个片段 · ${(r.size / 1048576).toFixed(1)} MB\n（浏览器内完成，请及时下载保存）`;
        store.add('works', { id: uid('w'), title: (node.title || '成片'), type: 'video', url: r.url, createdAt: Date.now() });
        node.status = ''; toast('合成完成', 'ok');
      } catch (err) {
        node.status = ''; node.error = err.message;
        toast('合成失败：' + err.message, 'err', 6000);
      }
      b.disabled = false;
      refresh(node); save();
    } }, '一键合成成片');

    box.append(
      h('label', { class: 'f-check', style: { margin: '8px 0 2px', fontSize: '11.5px' } }, xf, h('span'), '加转场（淡入淡出 0.5s，需重编码）'),
      btn,
      h('div', { class: 'try-h' }, '首次需下载约 30MB 编码内核，之后本机缓存')
    );
    return box;
  }

  const SHOTS = ['中景 平视 静止', '近景 俯拍 推镜', '全景 平视 横移', '特写 仰拍 跟拍', '中景 侧拍 环绕', '远景 航拍 拉远'];
  function renderDirector(node) {
    return h('div', {},
      h('div', { class: 'try-h' }, '3D 导演台'),
      h('button', {
        class: 'node-btn primary', style: { width: '100%', justifyContent: 'center', marginBottom: '10px' },
        onclick: async e => {
          const b = e.currentTarget;
          b.disabled = true; b.textContent = '加载 3D 引擎…';
          try {
            await openDirector({
              onCapture: url => {
                node.media = { url, type: 'image' };
                node.title = node.title || '机位图';
                refresh(node); save();
              }
            });
          } catch (err) { toast('打开失败：' + err.message, 'err', 4500); }
          b.disabled = false; b.textContent = '打开导演台（摆位 · 机位 · 截图）';
        }
      }, '打开导演台（摆位 · 机位 · 截图）'),
      h('div', { class: 'node-try' }, ...SHOTS.map(s => h('button', {
        class: 'try-chip', onclick: () => { node.prompt = (node.prompt ? node.prompt + '，' : '') + s; refresh(node); }
      }, s))),
      h('div', { class: 'try-h' }, '截好的机位图可存为资产，或直接当下游视频节点的参考图')
    );
  }

  /* ---- 节点操作 ---- */
  function addNode(type, at) {
    pushUndo();
    const w = at || toWorld(innerWidth / 2 - 150, innerHeight / 2 - 90);
    const n = { id: uid('n'), type, x: w.x - 150, y: w.y - 60, title: NODE_REGISTRY[type].label + '节点', prompt: '', content: '', media: null };
    proj.nodes.push(n); refresh(); save();
    select(n);                       /* 新建即展开，方便直接写需求 */
    return n;
  }
  function delNode(node) {
    pushUndo();
    proj.nodes = proj.nodes.filter(n => n.id !== node.id);
    proj.edges = proj.edges.filter(e => e.from !== node.id && e.to !== node.id);
    nodeEls.delete(node.id); refresh(); save();
  }
  function select(node) {
    const prev = selected;
    if (prev && prev.id === node.id) return;   /* 已选中：不动，避免打断输入框 */
    selected = node;
    if (prev) { const pe = nodeEls.get(prev.id); if (pe) paintState(pe, prev); refresh(prev); }
    const el = nodeEls.get(node.id); if (el) paintState(el, node);
    refresh(node);
  }
  function deselect() {
    const prev = selected;
    selected = null;
    if (prev) { const pe = nodeEls.get(prev.id); if (pe) paintState(pe, prev); refresh(prev); }
  }
  function toAsset(node) {
    if (!node.media?.url) return toast('这个节点还没有素材', 'err');
    const m = modal({
      title: '存为资产',
      body: h('div', {},
        h('div', { class: 'form-group' }, h('label', { class: 'form-label' }, '资产名称'),
          (() => { const i = h('input', { class: 'form-input', value: node.title }); i.id = 'as-name'; return i; })()),
        h('div', { class: 'form-group' }, h('label', { class: 'form-label' }, '类型'),
          (() => {
            const s = h('select', { class: 'form-select' }); s.id = 'as-type';
            ['character', 'scene', 'prop'].forEach((t, i) => s.append(h('option', { value: t }, ['角色', '场景', '道具'][i])));
            return s;
          })()),
        h('div', { class: 'form-group' }, h('label', { class: 'form-label' }, '描述（会作为后续镜头的参考锚点）'),
          (() => { const a = h('textarea', { class: 'form-area' }); a.id = 'as-desc'; a.value = node.prompt || ''; return a; })())),
      foot: [
        h('button', { class: 'btn-ghost', onclick: () => m.close() }, '取消'),
        h('button', { class: 'btn-primary', onclick: () => {
          store.add('assets', {
            id: uid('a'), name: $('#as-name').value || '未命名', type: $('#as-type').value,
            desc: $('#as-desc').value, url: node.media.url, createdAt: Date.now()
          });
          m.close(); toast('已存入资产库', 'ok');
        } }, '保存')
      ]
    });
  }
  async function uploadToNode(node, refresh) {
    const f = await pickFile('*/*');
    if (!f) return;
    let url;
    try {
      url = await saveMedia(f);
    } catch (e) {
      toast(e.message, 'err', 6000);
      return;
    }
    node.media = { url, type: f.type.startsWith('video') ? 'video' : f.type.startsWith('audio') ? 'audio' : 'image' };
    node.title = f.name.slice(0, 20);
    refresh(node); save();
  }

  /* ---- 生成 ---- */
  async function runTry(node, label, refresh) {
    if (label === '自己编写') { node.prompt = node.prompt || ''; refresh(node); return; }
    if (label === '上传文件' || label === '上传音频') return uploadToNode(node, refresh);
    if (label === '从资产库添加') return pickAsset(node, refresh);
    if (label === '文生图') { node.type = 'image'; return run(node, refresh, '根据上面的描述生成一张图'); }
    if (label === '文生视频') { node.type = 'video'; return run(node, refresh); }
    node.prompt = (node.prompt ? node.prompt + '\n' : '') + label;
    return run(node, refresh);
  }
  function pickAsset(node, refresh) {
    const list = store.list('assets').filter(a => a.url);
    if (!list.length) return toast('资产库还是空的', 'err');
    const m = modal({
      title: '从资产库添加',
      body: h('div', { class: 'asset-cards' }, ...list.map(a =>
        h('div', { class: 'asset-card', style: { cursor: 'pointer' }, onclick: () => {
          node.media = { url: a.url, type: 'image' }; node.title = a.name; node.prompt = (node.prompt || '') + ' ' + (a.desc || '');
          m.close(); refresh(node); save();
        } }, h('img', { src: a.url }), h('div', { class: 'asset-body' }, h('div', { class: 'asset-name' }, a.name)))))
    });
  }

  async function run(node, refresh, extra = '') {
    const type = node.type === 'merge' ? 'merge' : node.type === 'director' ? 'image' : node.type;
    const prompt = [node.prompt, extra].filter(Boolean).join('\n');
    const ups = upstream(node);
    const refImgs = ups.map(u => u.media?.url).filter(Boolean);

    node.error = ''; node.status = '生成中…'; refresh(node); save();
    try {
      if (type === 'text') {
        if (!prompt) throw new Error('请先写点内容');
        const out = await chat(prompt, { system: '你是短视频/短剧创作助手，输出中文，简洁可落地。' });
        node.content = out; node.media = null;
      } else if (type === 'image') {
        const p = prompt || ups.find(u => u.content)?.content || 'a cinematic frame';
        const r = await genImage(p, { images: refImgs.slice(0, 1) });
        node.media = { url: r.url, type: 'image' };
        store.add('works', { id: uid('w'), title: (node.prompt || '图片').slice(0, 24), type: 'image', url: r.url, createdAt: Date.now() });
      } else if (type === 'video') {
        const p = prompt || 'cinematic shot';
        const r = await genVideo(p, { images: refImgs.slice(0, 2), motion: node.motion, firstFrame: node.firstFrame, lastFrame: node.lastFrame, onProgress: s => { node.status = s; refresh(node); } });
        node.media = { url: r.url, type: 'video' };
        store.add('works', { id: uid('w'), title: (node.prompt || '视频').slice(0, 24), type: 'video', url: r.url, createdAt: Date.now() });
      } else if (type === 'merge') {
        if (!refImgs.length) throw new Error('把视频节点连过来再合成');
        node.content = '片段已就绪（本地模式：请逐个下载后拼接，接入后端后可自动合成）';
      } else if (type === 'upload' || type === 'audio') {
        throw new Error('该节点请用「上传文件」');
      }
      node.status = '';
    } catch (e) {
      node.status = ''; node.error = e.message; toast('生成失败：' + e.message, 'err', 4000);
    }
    refresh(node); save();
  }

  /* ---- 重绘 ---- */
  function refresh(only) {
    if (!only) {
      stage.querySelectorAll('.node').forEach(el => el.remove());
      nodeEls.clear();
      for (const n of proj.nodes) stage.append(buildNode(n));
    } else {
      const el = nodeEls.get(only.id); if (!el) return;
      const body = el.querySelector('.node-body'), actions = el.querySelector('.node-actions');
      renderBody(only, body, actions, () => refresh(only));
      paintState(el, only);
      el.style.left = only.x + 'px'; el.style.top = only.y + 'px';
      el.classList.toggle('running', !!only.status);
      el.querySelector('.node-model').textContent = modelChip(only.type === 'image' ? 'image' : only.type === 'video' ? 'video' : 'text');
    }
    drawEdges();
    scheduleMinimap();
  }

  /* ---- 画布交互 ---- */
  wrap.addEventListener('mousedown', e => {
    if (e.target.closest('.node') || e.target.closest('.canvas-toolbar') || e.target.closest('.canvas-topbar')) return;
    deselect();
    const sx = e.clientX, sy = e.clientY, ox = vp.x, oy = vp.y;
    const move = ev => { vp.x = ox + ev.clientX - sx; vp.y = oy + ev.clientY - sy; applyVp(); };
    const up = () => { document.removeEventListener('mousemove', move); document.removeEventListener('mouseup', up); save(); };
    document.addEventListener('mousemove', move); document.addEventListener('mouseup', up);
  });
  wrap.addEventListener('dblclick', e => {
    if (e.target.closest('.node')) return;
    const w = toWorld(e.clientX, e.clientY);
    ctxMenu(e.clientX, e.clientY, [
      { label: '添加节点' },
      { text: '文本', onClick: () => addNode('text', w) },
      { text: '图片', onClick: () => addNode('image', w) },
      { text: '视频', onClick: () => addNode('video', w) },
      { text: '音频', onClick: () => addNode('audio', w) },
      { text: '视频合成', onClick: () => addNode('merge', w) },
      { text: '导演台', onClick: () => addNode('director', w) },
      '-',
      { label: '添加资源' },
      { text: '上传', onClick: async () => { const n = addNode('upload', w); await uploadToNode(n, refresh); } },
      { text: '从资产库添加', onClick: () => { const n = addNode('image', w); pickAsset(n, refresh); } }
    ]);
  });
  wrap.addEventListener('wheel', e => {
    e.preventDefault();
    const r = wrap.getBoundingClientRect();
    const mx = e.clientX - r.left, my = e.clientY - r.top;
    const old = vp.zoom;
    const nz = Math.min(2.5, Math.max(0.25, old * (e.deltaY > 0 ? 0.92 : 1.08)));
    vp.x = mx - (mx - vp.x) * (nz / old);
    vp.y = my - (my - vp.y) * (nz / old);
    vp.zoom = nz; applyVp(); save();
  }, { passive: false });

  /* ---- 顶栏 / 工具栏 ---- */
  const projSel = h('select', { class: 'proj-sel', onchange: e => {
    const v = e.target.value;
    if (v === '__new') newProject();
    else if (v) { save(); go('canvas-edit', { id: v }); }
  } });
  const fillProjSel = () => {
    projSel.innerHTML = '';
    for (const p of store.list('projects')) projSel.append(h('option', { value: p.id }, p.name));
    projSel.append(h('option', { value: '__new' }, '＋ 新建画布'));
    projSel.value = proj.id;
  };
  fillProjSel();
  const nameInput = h('input', { value: proj.name, oninput: e => { proj.name = e.target.value; save(); } });
  const zoomLabel = h('button', { class: 'zoom-label', title: '点击回到 100%', onclick: () => { vp.zoom = 1; applyVp(); } }, '100%');

  /* 小地图卡片 */
  const mmCanvas = h('canvas', { class: 'mm-canvas' });
  const mmWrap = h('div', { class: 'mm-wrap' }, mmCanvas);
  mmCanvas.addEventListener('pointerdown', e => {
    if (!mmTransform) return;
    e.preventDefault();
    mmWrap.classList.add('dragging');
    const jump = ev => {
      const r = mmCanvas.getBoundingClientRect();
      const wx = mmTransform.minX + (ev.clientX - r.left - mmTransform.ox) / mmTransform.s;
      const wy = mmTransform.minY + (ev.clientY - r.top - mmTransform.oy) / mmTransform.s;
      vp.x = wrap.clientWidth / 2 - wx * vp.zoom;
      vp.y = wrap.clientHeight / 2 - wy * vp.zoom;
      applyVp();
    };
    jump(e);
    const up = () => {
      document.removeEventListener('pointermove', jump); document.removeEventListener('pointerup', up);
      mmWrap.classList.remove('dragging');
      save();
    };
    document.addEventListener('pointermove', jump);
    document.addEventListener('pointerup', up);
  });

  const mmToggle = h('button', {
    class: 'tb-btn active', title: '收起小地图',
    onclick: () => {
      const vis = mmVisible();
      mmOn = !vis;                          // 直接翻转「我要不要看到它」
      mmForce = mmOn && !mmUseful();        // 内容放得下时靠强制显示撑住
      applyMM();
    }
  }, h('span', { html: '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M9 4L3 6v14l6-2 6 2 6-2V4l-6 2-6-2z"/><path d="M9 4v14M15 6v14"/></svg>' }));

  const undoBtn = h('button', { class: 'tb-btn', title: '撤销 (Ctrl+Z)', onclick: undo },
    h('span', { html: '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.9"><path d="M9 14L5 10l4-4"/><path d="M5 10h10a4 4 0 010 8h-3"/></svg>' }));
  undoBtn.disabled = true;
  const redoBtn = h('button', { class: 'tb-btn', title: '重做 (Ctrl+Y)', onclick: redo },
    h('span', { html: '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.9"><path d="M15 14l4-4-4-4"/><path d="M19 10H9a4 4 0 100 8h3"/></svg>' }));
  redoBtn.disabled = true;
  const toolbar = h('div', { class: 'canvas-toolbar' },
    h('button', { class: 'tb-add', onclick: e => {
      const r = e.currentTarget.getBoundingClientRect();
      ctxMenu(r.left, r.top - 300, [
        { label: '添加节点' },
        { text: '文本', onClick: () => addNode('text') },
        { text: '图片', onClick: () => addNode('image') },
        { text: '视频', onClick: () => addNode('video') },
        { text: '音频', onClick: () => addNode('audio') },
        { text: '视频合成', onClick: () => addNode('merge') },
        { text: '导演台', onClick: () => addNode('director') },
        '-',
        { text: '上传', onClick: async () => { const n = addNode('upload'); await uploadToNode(n, refresh); } },
        { text: '从资产库添加', onClick: () => { const n = addNode('image'); pickAsset(n, refresh); } }
      ]);
    } }, '＋ 添加节点'),
    undoBtn, redoBtn,
    h('div', { class: 'tb-div' }),
    mmToggle,
    h('button', { class: 'tb-btn', title: '一键整理', onclick: arrange }, h('span', { html: '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.8"><circle cx="6" cy="6" r="2.6"/><circle cx="6" cy="18" r="2.6"/><path d="M8.2 7.8L20 19M8.2 16.2L20 5"/></svg>' })),
    h('div', { class: 'tb-div' }),
    h('button', { class: 'tb-btn', title: '缩小', onclick: () => { vp.zoom = Math.max(.25, vp.zoom * .85); applyVp(); } },
      h('span', { html: '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2"><path d="M5 12h14"/></svg>' })),
    zoomLabel,
    h('button', { class: 'tb-btn', title: '放大', onclick: () => { vp.zoom = Math.min(2.5, vp.zoom * 1.15); applyVp(); } },
      h('span', { html: '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 5v14M5 12h14"/></svg>' })),
    h('button', { class: 'tb-btn', title: '总览全部内容', onclick: fit }, h('span', { html: '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.8"><rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/></svg>' })),
    h('button', { class: 'tb-btn', title: '导出项目 JSON', onclick: exportJSON }, h('span', { html: '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4M7 10l5 5 5-5M12 15V3"/></svg>' }))
  );

  const topbar = h('div', { class: 'canvas-topbar' },
    h('div', { style: { display: 'flex', alignItems: 'center', gap: '10px' } },
      h('button', { class: 'icon-btn', onclick: () => { save(); go('canvas'); }, title: '返回' },
        h('span', { html: '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2"><path d="M15 18l-6-6 6-6"/></svg>' })),
      h('div', { class: 'canvas-name' }, projSel, nameInput)),
    h('div', { style: { display: 'flex', gap: '8px' } },
      h('button', { class: 'btn-ghost', onclick: () => toast('已自动保存') }, '保存'),
      h('button', { class: 'btn-primary', onclick: () => toast('本地模式：导出 JSON 即可备份/分享', 'ok', 3500) }, '分享')));

  function fit() {
    if (!proj.nodes.length) return;
    const xs = proj.nodes.map(n => n.x), ys = proj.nodes.map(n => n.y);
    vp.x = 60 - Math.min(...xs); vp.y = 90 - Math.min(...ys); vp.zoom = 1; applyVp(); save();
  }
  function arrange() {
    const cols = new Set(proj.nodes.map(n => Math.round(n.x / 380)));
    const order = [...cols].sort((a, b) => a - b);
    const colIndex = new Map(order.map((c, i) => [c, i]));
    const rowCounter = {};
    for (const n of proj.nodes) {
      const c = colIndex.get(Math.round(n.x / 380));
      rowCounter[c] = rowCounter[c] || 0;
      n.x = 100 + c * 380; n.y = 100 + rowCounter[c] * 240; rowCounter[c]++;
    }
    refresh(); save(); toast('已整理', 'ok');
  }
  function exportJSON() {
    const blob = new Blob([JSON.stringify(proj, null, 2)], { type: 'application/json' });
    download(URL.createObjectURL(blob), proj.name + '.json');
  }

  root.append(wrap, toolbar, topbar, mmWrap);

  if (renderEditor._kbd) document.removeEventListener('keydown', renderEditor._kbd);
  renderEditor._kbd = e => {
    const tag = (document.activeElement?.tagName || '').toLowerCase();
    if (tag === 'input' || tag === 'textarea') return;
    const k = e.key.toLowerCase();
    if ((e.ctrlKey || e.metaKey) && k === 'z' && !e.shiftKey) { e.preventDefault(); undo(); }
    else if ((e.ctrlKey || e.metaKey) && (k === 'y' || (k === 'z' && e.shiftKey))) { e.preventDefault(); redo(); }
  };
  document.addEventListener('keydown', renderEditor._kbd);
  refresh();
  applyVp();
  requestAnimationFrame(() => { refresh(); applyVp(); });
  if (!proj.nodes.length) {
    const t = addNode('text', { x: 260, y: 220 });
    t.title = '文本节点 1';
    t.prompt = '生成一个 2 集的古装轻喜剧：现代外卖员意外穿越到古代皇宫，被误认成御厨，情急之下做了一碗蛋炒饭。';
    refresh();
  }
}
