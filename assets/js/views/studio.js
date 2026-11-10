/* ============ 剧情短片 · Agent 创作代理工作台 ============ */
import { h, toast, download, pickFile, modal } from '../ui.js';
import { icon } from '../icons.js';
import { store, uid } from '../store.js';
import { go } from '../app.js';
import { Agent, STEPS, DONE, newProject } from '../agent.js';
import { skillLabel } from '../skills.js';

const MODE_TXT = {
  auto: '全自动：Agent 一路跑到底，只在失败时停。适合先出一版粗剪看方向。',
  director: '导演模式：角色设定、分镜方案、片段成片三个关口停下来等你确认，可逐条改。',
};

export function render(root, params = {}) {
  if (!params.id && !params.prompt) return renderNew(root);
  let proj = params.id ? store.find('series', params.id) : null;
  if (!proj) { proj = newProject(params.prompt || ''); store.add('series', proj); }
  proj.storyboard = proj.storyboard || [];
  renderProject(root, proj);
}

/* ---------- 新建 ---------- */
function renderNew(root) {
  let mode = 'director';
  const ta = h('textarea', {
    class: 'form-area', style: { minHeight: '132px' },
    placeholder: '一句话故事创意，或直接粘贴剧本。例如：现代外卖员意外穿越到古代皇宫，被误认成御厨，情急之下做了一碗蛋炒饭，得到皇帝赏识。',
  });
  const modeRow = h('div', { class: 'mode-switch' });
  const paintMode = () => {
    modeRow.innerHTML = '';
    for (const [k, label] of [['director', '导演模式'], ['auto', '全自动']]) {
      modeRow.append(h('button', {
        class: 'mode-btn' + (mode === k ? ' active' : ''),
        onclick: () => { mode = k; paintMode(); hint.textContent = MODE_TXT[k]; },
      }, label));
    }
  };
  const hint = h('div', { class: 'hint', style: { marginTop: '8px' } }, MODE_TXT[mode]);
  paintMode();

  root.append(h('div', { class: 'page' },
    h('div', { class: 'page-title' }, '剧情短片'),
    h('div', { class: 'page-sub' }, '给一句话，Agent 自己拆角色、排分镜、配模型、出片；关键节点你可以随时接过方向盘。'),
    h('div', { style: { maxWidth: '760px' } },
      h('label', { class: 'form-label' }, '故事创意'),
      ta,
      h('div', { class: 'chip-row', style: { marginTop: '12px' } },
        ...['古装轻喜剧', '都市悬疑', '治愈日常', '仙侠爽剧', '产品种草短片'].map(t =>
          h('button', { class: 'chip', onclick: () => { ta.value = `${t}：`; ta.focus(); } }, t))),
      h('div', { class: 'section-title', style: { marginTop: '20px' } }, '介入深度'),
      modeRow, hint,
      h('button', {
        class: 'btn-primary', style: { marginTop: '20px' }, onclick: () => {
          const p = ta.value.trim();
          if (!p) return toast('先写点创意', 'err');
          const proj = newProject(p);
          proj.agent.mode = mode;
          store.add('series', proj);
          go('studio', { id: proj.id });
        },
      }, '开始创作'))
  ));
}

/* ---------- 工作台 ---------- */
function renderProject(root, proj) {
  const page = h('div', { class: 'page' });
  root.append(page);

  const head = h('div', {});
  const stepsBox = h('div', { class: 'steps' });
  const bar = h('div', { class: 'agent-bar' });
  const content = h('div', {});
  const foot = h('div', { class: 'agent-foot' });
  const logBox = h('details', { class: 'agent-log' });
  page.append(head, stepsBox, bar, content, foot, logBox);

  const agent = new Agent(proj, onChange);
  let drawnCursor = -2, drawnStatus = '', progressEl = null;

  function onChange() {
    const a = agent.st;
    if (a.cursor !== drawnCursor || a.status !== drawnStatus) return draw();
    if (progressEl) {
      const p = a.progress;
      progressEl.textContent = p ? `${p.msg}${p.pct ? ' · ' + p.pct + '%' : ''}` : '';
      progressEl.classList.toggle('on', !!p);
    }
  }

  function draw() {
    const a = agent.st;
    drawnCursor = a.cursor; drawnStatus = a.status;

    /* 头部 */
    head.innerHTML = '';
    head.append(h('div', { class: 'agent-head' },
      h('div', {},
        h('div', { class: 'page-title' }, proj.req?.title || '剧情短片'),
        h('div', { class: 'page-sub', style: { marginBottom: '0' } }, (proj.logline || '').slice(0, 90) + ((proj.logline || '').length > 90 ? '…' : ''))),
      h('div', { class: 'agent-head-tags' },
        proj.req ? h('span', { class: 'tag' }, proj.req.ratio || '16:9') : null,
        proj.req?.duration ? h('span', { class: 'tag' }, proj.req.duration) : null,
        h('span', { class: 'tag' }, `${(proj.storyboard || []).length} 个分镜`),
        h('button', { class: 'btn-ghost sm', onclick: syncModal }, '会话同步'))));

    /* 步骤条 */
    stepsBox.innerHTML = '';
    STEPS.forEach((s, i) => {
      const done = DONE[s.key](proj);
      const cls = i === a.cursor
        ? (a.status === 'waiting' || a.status === 'paused' ? 'wait' : a.status === 'error' ? 'err' : a.status === 'running' ? 'active' : 'active')
        : done ? 'done' : '';
      stepsBox.append(h('div', {
        class: 'step ' + cls,
        title: s.hint,
        onclick: () => { if (i <= a.cursor || done) { a.cursor = i; agent.save(); draw(); } },
      }, h('span', { class: 'step-n' }, done && i !== a.cursor ? '✓' : String(i + 1)), s.label));
    });

    /* 模式 + 状态条 */
    bar.innerHTML = '';
    const mSwitch = h('div', { class: 'mode-switch' });
    for (const [k, label] of [['director', '导演模式'], ['auto', '全自动']]) {
      mSwitch.append(h('button', {
        class: 'mode-btn' + (a.mode === k ? ' active' : ''),
        onclick: () => { agent.setMode(k); draw(); },
      }, label));
    }
    progressEl = h('div', { class: 'agent-progress' + (a.progress ? ' on' : '') },
      a.progress ? `${a.progress.msg}${a.progress.pct ? ' · ' + a.progress.pct + '%' : ''}` : '');
    bar.append(mSwitch,
      h('div', { class: 'agent-state ' + a.status },
        statusText(a)),
      progressEl,
      h('div', { style: { flex: '1' } }),
      a.status === 'running' || a.status === 'waiting' ? h('button', {
        class: 'btn-ghost sm', onclick: () => { agent.pause(); draw(); },
      }, '暂停') : null);

    /* 内容 */
    content.innerHTML = '';
    ({ think: drawPlan, plan: drawPlan, outline: drawOutline, assets: drawAssets, storyboard: drawStoryboard, frames: drawFrames, video: drawVideo, assemble: drawAssemble })[STEPS[a.cursor].key]();

    /* 底部动作 */
    foot.innerHTML = '';
    const gateKey = a.pending;
    if (a.status === 'error') {
      foot.append(h('div', { class: 'agent-err' }, h('span', { html: icon('warn', 14) }), ' ', a.error || '执行失败'),
        h('button', { class: 'btn-primary', onclick: () => agent.run() }, '重试这一步'),
        h('button', { class: 'btn-ghost', onclick: () => { agent.redo(); } }, '清掉重跑'));
    } else if (a.status === 'waiting' && gateKey && gateKey !== 'assemble') {
      foot.append(
        h('div', { class: 'gate-note' }, `「${STEPS.find(s => s.key === gateKey)?.label}」已就绪，确认后继续`),
        h('button', { class: 'btn-primary', onclick: () => agent.approve() }, '通过，继续 →'),
        h('button', { class: 'btn-ghost', onclick: () => agent.redo() }, '重跑这一步'));
    } else if (a.status === 'waiting' && gateKey === 'assemble') {
      foot.append(h('div', { class: 'gate-note' }, '所有镜头就绪，去合成成片'),
        h('button', { class: 'btn-primary', onclick: () => { agent.st.cursor = STEPS.length - 1; agent.save(); draw(); } }, '去合成 →'));
    } else if (a.status === 'done') {
      foot.append(h('div', { class: 'gate-note' }, '这条链路完成了'),
        h('button', { class: 'btn-ghost', onclick: () => { agent.rewind(STEPS.findIndex(s => s.key === 'storyboard')); draw(); } }, '回到分镜重做'),
        h('button', { class: 'btn-ghost', onclick: () => go('canvas', {}) }, '转到画布'));
    } else if (a.status === 'running') {
      foot.append(h('div', { class: 'gate-note' }, 'Agent 正在执行，可随时切到全自动或暂停'));
    } else {
      foot.append(h('button', { class: 'btn-primary', onclick: () => agent.run() }, a.cursor === 0 ? '开始执行' : '继续执行'),
        h('button', { class: 'btn-ghost', onclick: () => { agent.rewind(a.cursor); draw(); } }, '从这一步重来'));
    }

    /* 决策日志 */
    logBox.innerHTML = '';
    logBox.append(h('summary', {}, `决策日志（${a.log.length} 条）`));
    for (const it of [...a.log].reverse().slice(0, 40)) {
      logBox.append(h('div', { class: 'log-row' + (it.level === 'error' ? ' err' : '') },
        h('span', { class: 'log-t' }, new Date(it.t).toLocaleTimeString('zh-CN', { hour12: false })),
        h('span', { class: 'log-s' }, STEPS.find(s => s.key === it.step)?.label || ''),
        h('span', { class: 'log-m' }, it.msg)));
    }
  }

  const statusText = a => ({
    idle: '待执行', running: '执行中', waiting: '等你确认', paused: '已暂停', done: '已完成', error: '失败',
  }[a.status] || '待执行');

  /* ---------- 各步内容 ---------- */
  function fieldRow(label, value, onChange) {
    const i = h('input', { class: 'form-input sm', value: value || '' });
    i.addEventListener('input', () => onChange(i.value));
    return h('div', { class: 'req-row' }, h('div', { class: 'req-k' }, label), i);
  }

  function drawPlan() {
    content.append(h('div', { class: 'page-sub' }, 'Agent 第一步：先想清楚要调用哪些技能，再把一句话变成可执行的制作方案。改完再往下走。'));
    if (proj.think) {
      content.append(h('div', { class: 'think-card' },
        h('div', { class: 'think-h' }, h('span', { html: icon('spark', 13) }), ' 思考 · 计划调用 ', String((proj.think.skills || []).length), ' 个技能'),
        proj.think.summary ? h('div', { class: 'think-sum' }, proj.think.summary) : null,
        h('div', { class: 'think-skills' }, ...(proj.think.skills || []).map(k => h('span', { class: 'think-skill' }, skillLabel(k)))),
        proj.think.reason ? h('div', { class: 'think-reason' }, proj.think.reason) : null));
    }
    if (!proj.req) return content.append(h('div', { class: 'empty' }, '还没有方案，点下面的「开始执行」'));
    const box = h('div', { class: 'req-card' });
    for (const [k, label] of [['title', '标题'], ['logline', '梗概'], ['duration', '总时长'], ['ratio', '画幅'], ['style', '视觉风格'], ['tone', '情绪基调'], ['audience', '目标观众']]) {
      box.append(fieldRow(label, proj.req[k], v => { proj.req[k] = v; store.save(); }));
    }
    content.append(box);
  }

  function drawOutline() {
    content.append(h('div', { class: 'page-sub' }, 'Agent 第二步：角色、场景、道具先定下来，后面每个镜头都复用这套设定。'));
    const o = proj.outline;
    if (!o) return content.append(h('div', { class: 'empty' }, '还没有拆解结果'));
    if (o.synopsis) content.append(h('div', { class: 'card', style: { padding: '14px', marginBottom: '14px' } },
      h('div', { class: 'asset-name' }, '剧情梗概'),
      h('div', { class: 'asset-desc', style: { maxHeight: 'none' } }, o.synopsis)));
    for (const [key, label] of [['characters', '角色'], ['scenes', '场景'], ['props', '道具']]) {
      if (!o[key]?.length) continue;
      content.append(h('div', { class: 'section-title' }, `${label}（${o[key].length}）`));
      content.append(h('div', { class: 'asset-cards' }, ...o[key].map(c =>
        h('div', { class: 'asset-card' },
          c.image ? h('img', { src: c.image }) : null,
          h('div', { class: 'asset-body' },
            h('div', { class: 'asset-name' }, c.name || '未命名'),
            h('div', { class: 'asset-desc' }, [c.age, c.look, c.persona, c.env, c.light, c.desc].filter(Boolean).join(' · ')))))));
    }
  }

  function drawAssets() {
    content.append(h('div', { class: 'page-sub' }, '定妆图会自动存进资产库，后续镜头按角色名自动引用。'));
    const list = [...(proj.outline?.characters || []), ...(proj.outline?.scenes || [])];
    if (!list.length) return content.append(h('div', { class: 'empty' }, '先完成「角色与场景」'));
    content.append(h('div', { class: 'asset-cards' }, ...list.map(c => {
      const isChar = !('env' in c);
      return h('div', { class: 'asset-card' },
        h('div', { class: 'asset-thumb' }, c.image
          ? h('img', { src: c.image })
          : h('div', { class: 'stage-ph' }, c.imageError ? '生成失败' : '待生成')),
        h('div', { class: 'asset-body' },
          h('div', { class: 'asset-name' }, `${c.name} · ${isChar ? '角色' : '场景'}`),
          h('button', {
            class: 'node-btn', style: { marginTop: '6px' },
            onclick: async e => {
              const b = e.currentTarget; b.disabled = true; b.textContent = '生成中…';
              try {
                const { genImage } = await import('../models.js');
                const prompt = isChar
                  ? `角色设定图：${c.name}，${c.age || ''}，${c.look || ''}，${c.persona || ''}，三视图，白底，清晰正面全身`
                  : `场景设定图：${c.name}，${c.env || ''}，${c.light || ''}，电影感，无人物`;
                const r = await genImage(prompt, { size: '1024x1024' });
                c.image = r.url;
                store.add('assets', { id: uid('a'), name: c.name, type: isChar ? 'character' : 'scene', desc: '', url: r.url, createdAt: Date.now() });
                agent.save(); draw();
              } catch (err) { toast('失败：' + err.message, 'err'); b.disabled = false; b.textContent = '生成'; }
            },
          }, c.image ? '重新生成' : '生成')));
    })));
  }

  /* 分镜：逐条审阅 + 每镜头模型 + 自然语言局部调整 */
  function drawStoryboard() {
    content.append(h('div', { class: 'page-sub' }, '生成第一帧之前，这里每一条都能改；改哪条只影响哪条。'));

    /* 自然语言局部调整 */
    const ta = h('textarea', { class: 'form-area sm', rows: '2', placeholder: '用一句话局部调整，例如：把第 3 个镜头改成夜景，整体节奏快一点' });
    content.append(h('div', { class: 'nudge-box' },
      h('div', { class: 'nudge-h' }, h('span', { html: icon('spark', 13) }), ' 自然语言调整（只改被点名的镜头）'),
      ta,
      h('div', { style: { display: 'flex', gap: '8px', marginTop: '8px' } },
        h('button', {
          class: 'btn-primary sm', onclick: async e => {
            const txt = ta.value.trim();
            if (!txt) return toast('写点要改什么', 'err');
            const b = e.currentTarget; b.disabled = true; b.textContent = '调整中…';
            try {
              const r = await agent.nudge(txt);
              ta.value = '';
              toast(r.changed.length ? `已调整镜头 ${r.changed.join('、')}${r.note ? ' · ' + r.note : ''}` : (r.note || '没有需要改的地方'), 'ok', 3600);
              draw();
            } catch (err) { toast('调整失败：' + err.message, 'err'); b.disabled = false; b.textContent = '应用调整'; }
          },
        }, '应用调整'),
        h('button', {
          class: 'btn-ghost sm', onclick: () => {
            ta.value = '把整体节奏加快，删掉铺垫性的镜头';
          },
        }, '试试示例')))
    );

    if (!proj.storyboard.length) return content.append(h('div', { class: 'empty' }, '还没有分镜，先执行到这一步'));

    content.append(h('div', { class: 'shot-head' },
      h('div', {}, '镜头'), h('div', {}, '画面 / 台词'), h('div', {}, '景别 · 运镜 · 时长'),
      h('div', {}, '生成路径'), h('div', {}, '状态')));

    proj.storyboard.forEach(s => {
      const descI = h('textarea', { class: 'shot-input', rows: '2' });
      descI.value = s.desc || '';
      descI.addEventListener('input', () => { s.desc = descI.value; store.save(); });
      const lineI = h('input', { class: 'form-input sm', placeholder: '台词（可空）', value: s.dialogue || '' });
      lineI.addEventListener('input', () => { s.dialogue = lineI.value; store.save(); });
      const shotI = h('input', { class: 'form-input sm', value: s.shot || '' });
      shotI.addEventListener('input', () => { s.shot = shotI.value; store.save(); });
      const camI = h('input', { class: 'form-input sm', value: s.camera || '' });
      camI.addEventListener('input', () => { s.camera = camI.value; store.save(); });
      const durI = h('input', { class: 'form-input sm', type: 'number', min: '4', max: '10', value: String(s.dur || 5) });
      durI.addEventListener('input', () => { s.dur = Math.min(10, Math.max(4, Number(durI.value) || 5)); store.save(); });

      const modelSel = h('select', { class: 'form-select sm' });
      for (const m of ['图生视频', '文生视频']) modelSel.append(h('option', { value: m, selected: m === s.model }, m));
      modelSel.addEventListener('change', () => {
        s.model = modelSel.value;
        s.videoMode = modelSel.value === '文生视频' ? 'text' : 'keyframe';
        s.video = ''; s.status = '路径已改，需重出片段';
        store.save(); draw();
      });

      content.append(h('div', { class: 'shot-row edit' },
        h('div', { class: 'shot-n' }, s.n),
        h('div', { class: 'shot-main' },
          descI, lineI),
        h('div', { class: 'shot-fields' },
          shotI, camI,
          h('div', { class: 'dur-wrap' }, durI, h('span', {}, 's'))),
        h('div', { class: 'shot-model' },
          modelSel,
          h('div', { class: 'route-note' }, s.routeNote || ''),
          s.refs?.length ? h('div', { class: 'route-note ok' }, `引用 ${s.refs.length} 张角色图`) : null),
        h('div', { class: 'shot-state' },
          h('span', { class: 'badge' + (s.frame ? ' ok' : '') }, s.frame ? '关键帧 ✓' : '无关键帧'),
          h('span', { class: 'badge' + (s.video ? ' ok' : '') }, s.video ? '片段 ✓' : '无片段'),
          s.status ? h('span', { class: 'badge warn' }, s.status) : null,
          h('button', {
            class: 'node-btn sm', onclick: () => {
              s.frame = ''; s.video = ''; s.status = '排队重生成';
              agent.st.cursor = 4; agent.save(); draw();
              agent.run();
            },
          }, '重生成'))));
    });
  }

  function frameCard(s, kind) {
    const isFrame = kind === 'frame';
    const thumb = isFrame
      ? (s.frame ? h('img', { src: s.frame }) : h('div', { class: 'stage-ph' }, '待生成'))
      : (s.video ? h('video', { src: s.video, controls: true, muted: true, playsinline: true })
        : (s.frame ? h('img', { src: s.frame }) : h('div', { class: 'stage-ph' }, '待生成')));
    const gen = async (e) => {
      const b = e.currentTarget; b.disabled = true; b.textContent = '生成中…';
      try {
        const { genImage } = await import('../models.js');
        const r = await genImage(`${s.desc}，${s.shot}，${proj.req?.style || ''}，电影感画面`, {
          size: proj.req?.ratio === '9:16' ? '720x1280' : '1280x720',
          images: (s.refs || []).slice(0, 1),
        });
        s.frame = r.url; s.status = ''; agent.save(); draw();
      } catch (err) {
        toast('失败：' + err.message, 'err');
        b.disabled = false; b.textContent = isFrame ? '生成' : '生成片段';
      }
    };
    const label = isFrame ? (s.frame ? '重绘' : '生成') : (s.video ? '重生成' : '生成片段');
    const btn = h('button', { class: 'node-btn', style: { marginTop: '6px' }, onclick: gen }, label);
    const name = `镜头 ${s.n} · ${s[isFrame ? 'shot' : 'model'] || ''}`;
    const desc = h('div', { class: 'asset-desc' }, (s.desc || '').slice(0, 60));
    const nm = h('div', { class: 'asset-name' }, name);
    const body = h('div', { class: 'asset-body' }, nm, desc, btn);
    const th = h('div', { class: 'asset-thumb wide' }, thumb);
    return h('div', { class: 'asset-card' }, th, body);
  }

  function drawFrames() {
    content.append(h('div', { class: 'page-sub' }, '每个镜头一张首帧；崩掉的单条重绘，不用整片重来。'));
    if (!proj.storyboard.length) return content.append(h('div', { class: 'empty' }, '先完成分镜'));
    content.append(h('div', { class: 'asset-cards' }, ...proj.storyboard.map(s => frameCard(s, 'frame'))));
  }


  function drawVideo() {
    content.append(h('div', { class: 'page-sub' }, '按每个镜头选定的路径生成片段，配错的单条改路径重出即可。'));
    if (!proj.storyboard.length) return content.append(h('div', { class: 'empty' }, '先完成分镜'));
    const ready = proj.storyboard.filter(s => s.video).length;
    content.append(h('div', { class: 'hint' }, `片段就绪 ${ready}/${proj.storyboard.length}　·　建议先用 Flash 类免费模型试错，定稿再换高清`));
    content.append(h('div', { class: 'asset-cards', style: { marginTop: '12px' } }, ...proj.storyboard.map(s => videoCard(s))));
  }

  function videoCard(s) {
    const thumb = s.video
      ? h('video', { src: s.video, controls: true, muted: true, playsinline: true })
      : (s.frame ? h('img', { src: s.frame }) : h('div', { class: 'stage-ph' }, '待生成'));
    const gen = async (e) => {
      const b = e.currentTarget; b.disabled = true; b.textContent = '生成中…';
      try {
        const { genVideo } = await import('../models.js');
        const r = await genVideo(`${s.desc}，${s.camera || ''}`, {
          images: s.videoMode === 'text' ? [] : (s.frame ? [s.frame] : []),
          duration: s.dur || 5, ratio: proj.req?.ratio || '16:9',
        });
        s.video = r.url; s.status = ''; agent.save(); draw();
      } catch (err) {
        toast('失败：' + err.message, 'err');
        b.disabled = false; b.textContent = '生成片段';
      }
    };
    const label = s.video ? '重生成' : '生成片段';
    const btn = h('button', { class: 'node-btn', style: { marginTop: '6px' }, onclick: gen }, label);
    const name = h('div', { class: 'asset-name' }, `镜头 ${s.n} · ${s.model || ''}`);
    const desc = h('div', { class: 'asset-desc' }, s.status || ((s.desc || '').slice(0, 54)));
    const body = h('div', { class: 'asset-body' }, name, desc, btn);
    const th = h('div', { class: 'asset-thumb wide' }, thumb);
    return h('div', { class: 'asset-card' }, th, body);
  }

  function drawAssemble() {
    const all = proj.storyboard.filter(s => s.video);
    content.append(h('div', { class: 'page-sub' }, '按分镜顺序拼接。合成在浏览器本地跑（ffmpeg.wasm），首次要下约 30MB 内核。'));
    content.append(h('div', { class: 'hint' }, `片段就绪 ${all.length}/${proj.storyboard.length}`));

    const statusLine = h('div', { class: 'hint' });
    const resultBox = h('div', {});
    const xf = h('input', { type: 'checkbox' });
    let bgmUrl = null;
    const bgmSlot = h('div', { class: 'ref-slot', onclick: async () => {
      const f = await pickFile('audio/*'); if (!f) return;
      bgmUrl = URL.createObjectURL(f);
      bgmSlot.innerHTML = '';
      bgmSlot.append(h('span', { style: { fontSize: '11px', padding: '4px' } }, h('span', { class: 'ico', html: icon('music', 12) }), ' ' + f.name.slice(0, 12)));
    } }, h('span', { style: { fontSize: '16px' } }, '＋'), h('span', {}, '背景音'));

    content.append(h('div', { class: 'card', style: { padding: '16px', marginTop: '14px' } },
      h('div', { class: 'asset-name' }, `合成成片（${all.length}/${proj.storyboard.length} 个片段就绪）`),
      h('div', { style: { display: 'flex', gap: '10px', alignItems: 'center', marginTop: '10px', flexWrap: 'wrap' } },
        h('label', { class: 'f-check', style: { fontSize: '12.5px' } }, xf, h('span'), '加转场（淡入淡出 0.5s）'),
        bgmSlot,
        h('button', {
          class: 'btn-primary', onclick: async e => {
            if (!all.length) return toast('还没有视频片段', 'err');
            const btn = e.currentTarget;
            btn.disabled = true;
            try {
              const { concatVideos } = await import('../media.js');
              const r = await concatVideos(all.map(s => s.video), {
                transition: xf.checked ? 0.5 : 0,
                audioUrl: bgmUrl,
                onProgress: s => { statusLine.textContent = s; },
              });
              proj.film = r.url;
              agent.st.status = 'done'; agent.log('合成成片完成'); agent.save();
              statusLine.textContent = '';
              resultBox.innerHTML = '';
              resultBox.append(
                h('video', { src: r.url, controls: true, style: { width: '100%', borderRadius: '10px', marginTop: '10px', maxHeight: '320px' } }),
                h('div', { style: { display: 'flex', gap: '10px', marginTop: '10px' } },
                  h('button', { class: 'btn-primary', onclick: () => download(r.url, (proj.req?.title || '成片') + '.mp4') }, `下载成片（${(r.size / 1048576).toFixed(1)} MB）`),
                  h('button', {
                    class: 'btn-ghost', onclick: () => {
                      store.add('works', { id: uid('w'), title: proj.req?.title || '成片', type: 'video', url: r.url, createdAt: Date.now() });
                      toast('已存入作品库', 'ok');
                    },
                  }, '存入作品')));
              toast('合成完成', 'ok');
            } catch (err) {
              statusLine.textContent = '';
              toast('合成失败：' + err.message, 'err', 6000);
            }
            btn.disabled = false;
          },
        }, '一键合成 MP4'),
        h('button', {
          class: 'btn-ghost', onclick: () => {
            const blob = new Blob([JSON.stringify(proj, null, 2)], { type: 'application/json' });
            download(URL.createObjectURL(blob), (proj.req?.title || '短片') + '.json');
          },
        }, '导出项目 JSON')),
      statusLine, resultBox));
  }

  /* ---------- 会话同步 ---------- */
  function syncModal() {
    const body = h('div', {});
    const proxyOn = !!(store.state.proxy?.enabled && store.state.proxy?.url);
    body.append(
      h('div', { class: 'hint', style: { marginBottom: '12px' } },
        proxyOn ? '已配置云端后端：可以把会话快照推到云端，手机打开链接继续。' : '未配置云端后端：先导出快照文件，在另一台设备导入即可接续（不是实时同步）。'),
      h('div', { style: { display: 'flex', gap: '8px', flexWrap: 'wrap' } },
        h('button', {
          class: 'btn-primary', onclick: async e => {
            const b = e.currentTarget; b.disabled = true; b.textContent = '上传中…';
            try {
              const url = await pushSnapshot(proj);
              await navigator.clipboard?.writeText(url).catch(() => {});
              toast('链接已复制，在另一台设备打开即可接续', 'ok', 4200);
              body.append(h('div', { class: 'hint' }, '链接：' + url));
            } catch (err) { toast(err.message, 'err'); }
            b.disabled = false; b.textContent = '推送到云端并复制链接';
          },
        }, proxyOn ? '推送到云端并复制链接' : '导出快照文件'),
        h('button', {
          class: 'btn-ghost', onclick: async () => {
            const f = await pickFile('application/json');
            if (!f) return;
            try {
              const data = JSON.parse(await f.text());
              importSnapshot(data);
            } catch (err) { toast('导入失败：' + err.message, 'err'); }
          },
        }, '从文件导入'),
        h('button', {
          class: 'btn-ghost', onclick: async () => {
            const url = prompt('粘贴快照链接');
            if (!url) return;
            try {
              const r = await fetch(url);
              importSnapshot(await r.json());
            } catch (err) { toast('拉取失败：' + err.message, 'err'); }
          },
        }, '从链接导入'))
    );
    modal({ title: '会话同步', body });
  }

  function importSnapshot(data) {
    if (!data || !data.logline) return toast('不是有效的会话快照', 'err');
    const p = { ...data, id: uid('s'), createdAt: Date.now() };
    store.add('series', p);
    toast('已导入会话，正在打开', 'ok');
    go('studio', { id: p.id });
  }

  draw();
}

/* 快照推送：复用 settings 里配置的 Supabase 代理存储 */
async function pushSnapshot(proj) {
  const p = store.state.proxy;
  const snap = { ...proj, agent: { ...proj.agent, status: 'idle' }, snapshotAt: Date.now() };
  const blob = new Blob([JSON.stringify(snap)], { type: 'application/json' });
  if (!(p?.enabled && p?.url)) {
    download(URL.createObjectURL(blob), (proj.req?.title || '会话') + '-快照.json');
    return '已导出到本地文件';
  }
  const path = `sessions/${proj.id}-${Date.now()}.json`;
  const r = await fetch(`${p.url.replace(/\/$/, '')}/storage?path=${encodeURIComponent(path)}`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${p.anon}`, 'Content-Type': 'application/json' },
    body: blob,
  });
  const j = await r.json().catch(() => ({}));
  if (!j?.url) throw new Error('云端未返回链接，检查后端配置');
  return j.url;
}
