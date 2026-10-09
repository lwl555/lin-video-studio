/* ============ 无限画布 ============ */
import { h, $, $$, toast, ctxMenu, modal, confirm, pickFile, modelChip, timeAgo, download } from '../ui.js';
import { store, uid, saveMedia } from '../store.js';
import { providers, chat, genImage, genVideo } from '../models.js';
import { go } from '../app.js';

const NODE_META = {
  text: { label: '文本', icon: '文' },
  image: { label: '图片', icon: '图' },
  video: { label: '视频', icon: '视' },
  audio: { label: '音频', icon: '音' },
  merge: { label: '视频合成', icon: '合' },
  director: { label: '导演台', icon: '导' },
  upload: { label: '素材', icon: '素' }
};
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
          first ? h('img', { src: first.media.url }) : h('div', { class: 'flow-ph' }, '🎨'),
          h('span', { class: 'flow-badge' }, `${p.nodes?.length || 0} 节点`)),
        h('div', { class: 'flow-body' },
          h('div', { class: 'flow-title' }, p.name),
          h('div', { class: 'flow-meta' }, '更新于 ' + timeAgo(p.updatedAt || p.createdAt))));
    }))
    : h('div', { class: 'empty' }, h('div', { class: 'empty-icon' }, '🎨'), '还没有画布项目，点右上角新建一个');

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
  const applyVp = () => { stage.style.transform = `translate(${vp.x}px,${vp.y}px) scale(${vp.zoom})`; zoomLabel.textContent = Math.round(vp.zoom * 100) + '%'; };
  const save = () => { proj.updatedAt = Date.now(); store.save(); };

  /* ---- 边 ---- */
  const edgeLayer = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  edgeLayer.setAttribute('class', 'edges');
  stage.append(edgeLayer);

  function portPos(node, side) {
    const el = nodeEls.get(node.id); if (!el) return null;
    const w = el.offsetWidth || 300, hh = el.offsetHeight || 160;
    return side === 'out' ? { x: node.x + w, y: node.y + hh / 2 } : { x: node.x, y: node.y + hh / 2 };
  }
  function drawEdges() {
    edgeLayer.innerHTML = '';
    for (const e of proj.edges) {
      const a = proj.nodes.find(n => n.id === e.from), b = proj.nodes.find(n => n.id === e.to);
      if (!a || !b) continue;
      const p1 = portPos(a, 'out'), p2 = portPos(b, 'in'); if (!p1 || !p2) continue;
      const dx = Math.max(40, Math.abs(p2.x - p1.x) * 0.45);
      const d = `M${p1.x},${p1.y} C${p1.x + dx},${p1.y} ${p2.x - dx},${p2.y} ${p2.x},${p2.y}`;
      const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
      path.setAttribute('class', 'edge'); path.setAttribute('d', d);
      edgeLayer.append(path);
    }
  }

  /* ---- 上游取值 ---- */
  function upstream(node) {
    const ids = proj.edges.filter(e => e.to === node.id).map(e => e.from);
    return ids.map(id => proj.nodes.find(n => n.id === id)).filter(Boolean);
  }

  /* ---- 节点元素 ---- */
  function buildNode(node) {
    const meta = NODE_META[node.type] || NODE_META.text;
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
    nodeEls.set(node.id, el);

    /* 选择 */
    el.addEventListener('mousedown', () => { select(node); }, true);

    /* 拖动 */
    el.querySelector('.node-head').addEventListener('mousedown', e => {
      if (e.target.closest('.node-model')) return;
      e.stopPropagation();
      const sx = e.clientX, sy = e.clientY, ox = node.x, oy = node.y;
      const move = ev => {
        node.x = ox + (ev.clientX - sx) / vp.zoom;
        node.y = oy + (ev.clientY - sy) / vp.zoom;
        el.style.left = node.x + 'px'; el.style.top = node.y + 'px';
        drawEdges();
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
        { text: '复制节点', onClick: () => { const c = structuredClone(node); c.id = uid('n'); c.x += 40; c.y += 40; proj.nodes.push(c); refresh(); save(); } },
        { text: '另存为资产', onClick: () => toAsset(node) },
        { text: '从此节点分支', onClick: () => { const c = structuredClone(node); c.id = uid('n'); c.x = node.x + 380; c.y = node.y + 200; c.media = null; c.content = ''; proj.nodes.push(c); proj.edges.push({ id: uid('e'), from: node.id, to: c.id }); refresh(); save(); } },
        '-',
        { text: '下载素材', onClick: () => node.media?.url && download(node.media.url, node.title + '.png') },
        { text: '删除节点', onClick: () => delNode(node) }
      ]);
    });

    renderBody(node, body, actions, () => { syncModel(); refresh(node); });
    return el;
  }

  function renderBody(node, body, actions, rerender) {
    body.innerHTML = ''; actions.innerHTML = '';

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

    if (node.status) body.append(h('div', { class: 'node-status' }, h('span', { class: 'spinner' }), node.status));
    if (node.error) body.append(h('div', { class: 'node-status', style: { color: 'var(--err)' } }, '⚠ ' + node.error));

    /* 输入区 */
    if (['text', 'image', 'video', 'merge', 'director'].includes(node.type)) {
      const ta = h('textarea', { class: 'node-textarea', placeholder: '描述你的需求…' });
      ta.value = node.prompt || '';
      ta.addEventListener('input', () => { node.prompt = ta.value; });
      ta.addEventListener('mousedown', e => e.stopPropagation());
      body.append(ta);
      actions.append(
        h('button', { class: 'node-btn primary', onclick: () => run(node, refresh) },
          h('span', { html: '✦' }), '生成'),
        h('button', { class: 'node-btn', onclick: () => { ta.value = ''; node.prompt = ''; } }, '清空')
      );
    }
    if (node.type === 'audio' || node.type === 'upload') {
      actions.append(h('button', { class: 'node-btn primary', onclick: () => uploadToNode(node, refresh) }, '上传文件'));
    }
    actions.append(h('button', { class: 'node-btn', onclick: () => toAsset(node) }, '存为资产'));
  }

  function renderMerge(node, refresh) {
    const ups = upstream(node).filter(n => n.media?.url);
    return h('div', { class: 'node-try' },
      h('div', { class: 'try-h' }, `待合成片段（${ups.length}）`),
      ...ups.map((u, i) => h('div', { class: 'try-chip' }, `${i + 1}. ${u.title || '片段'}`)),
      ups.length ? h('button', { class: 'node-btn primary', style: { marginTop: '8px' }, onclick: async () => {
        node.content = `已将 ${ups.length} 个片段加入合成队列。\n合成需要在后端（Supabase Edge Function + ffmpeg）执行，当前为本地模式：可逐个下载后自行拼接。`;
        node.media = null; refresh(node);
      } }, '开始合成') : h('div', { class: 'try-h' }, '把视频节点连到本节点即可合成')
    );
  }

  const SHOTS = ['中景 平视 静止', '近景 俯拍 推镜', '全景 平视 横移', '特写 仰拍 跟拍', '中景 侧拍 环绕', '远景 航拍 拉远'];
  function renderDirector(node) {
    return h('div', {},
      h('div', { class: 'try-h' }, '机位预设'),
      h('div', { class: 'node-try' }, ...SHOTS.map(s => h('button', {
        class: 'try-chip', onclick: () => { node.prompt = (node.prompt ? node.prompt + '，' : '') + s; refresh(node); }
      }, s))),
      h('div', { class: 'try-h' }, '生成前先选定机位，构图更可控')
    );
  }

  /* ---- 节点操作 ---- */
  function addNode(type, at) {
    const w = at || toWorld(innerWidth / 2 - 150, innerHeight / 2 - 90);
    const n = { id: uid('n'), type, x: w.x - 150, y: w.y - 60, title: NODE_META[type].label + '节点', prompt: '', content: '', media: null };
    proj.nodes.push(n); refresh(); save();
    return n;
  }
  function delNode(node) {
    proj.nodes = proj.nodes.filter(n => n.id !== node.id);
    proj.edges = proj.edges.filter(e => e.from !== node.id && e.to !== node.id);
    nodeEls.delete(node.id); refresh(); save();
  }
  function select(node) {
    selected = node;
    $$('.node').forEach(el => el.classList.toggle('selected', el.dataset.id === node.id));
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
    const url = await saveMedia(f);
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
        const r = await genVideo(p, { images: refImgs.slice(0, 2), onProgress: s => { node.status = s; refresh(node); } });
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
      el.style.left = only.x + 'px'; el.style.top = only.y + 'px';
      el.classList.toggle('running', !!only.status);
      el.querySelector('.node-model').textContent = modelChip(only.type === 'image' ? 'image' : only.type === 'video' ? 'video' : 'text');
    }
    drawEdges();
  }

  /* ---- 画布交互 ---- */
  wrap.addEventListener('mousedown', e => {
    if (e.target.closest('.node') || e.target.closest('.canvas-toolbar') || e.target.closest('.canvas-topbar')) return;
    selected = null; $$('.node').forEach(el => el.classList.remove('selected'));
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
  const nameInput = h('input', { value: proj.name, oninput: e => { proj.name = e.target.value; save(); } });
  const zoomLabel = h('div', { class: 'zoom-label' }, '100%');

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
    h('div', { class: 'tb-div' }),
    h('button', { class: 'tb-btn', title: '缩小', onclick: () => { vp.zoom = Math.max(.25, vp.zoom * .85); applyVp(); } },
      h('span', { html: '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2"><path d="M5 12h14"/></svg>' })),
    zoomLabel,
    h('button', { class: 'tb-btn', title: '放大', onclick: () => { vp.zoom = Math.min(2.5, vp.zoom * 1.15); applyVp(); } },
      h('span', { html: '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 5v14M5 12h14"/></svg>' })),
    h('button', { class: 'tb-btn', title: '适应内容', onclick: fit }, h('span', { html: '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M3 8V5a2 2 0 012-2h3M21 8V5a2 2 0 00-2-2h-3M3 16v3a2 2 0 002 2h3M21 16v3a2 2 0 01-2 2h-3"/></svg>' })),
    h('div', { class: 'tb-div' }),
    h('button', { class: 'tb-btn', title: '一键整理', onclick: arrange }, h('span', { html: '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.8"><rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/></svg>' })),
    h('button', { class: 'tb-btn', title: '导出项目 JSON', onclick: exportJSON }, h('span', { html: '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4M7 10l5 5 5-5M12 15V3"/></svg>' }))
  );

  const topbar = h('div', { class: 'canvas-topbar' },
    h('div', { style: { display: 'flex', alignItems: 'center', gap: '10px' } },
      h('button', { class: 'icon-btn', onclick: () => { save(); go('canvas'); }, title: '返回' },
        h('span', { html: '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2"><path d="M15 18l-6-6 6-6"/></svg>' })),
      h('div', { class: 'canvas-name' }, nameInput)),
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

  root.append(wrap, toolbar, topbar);
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
