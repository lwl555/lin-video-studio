/* ============ 剧情短片 · 六阶段流水线 ============ */
import { h, $, toast, download, pickFile } from '../ui.js';
import { icon } from '../icons.js';
import { store, uid } from '../store.js';
import { providers, chat, genImage, genVideo } from '../models.js';
import { go } from '../app.js';

const STAGES = ['需求确认', '剧本大纲', '角色场景', '分镜脚本', '关键帧', '视频成片'];

export function render(root, params = {}) {
  if (!params.prompt && !params.id) return renderNew(root);
  let proj = params.id ? store.find('series', params.id) : null;
  if (!proj) {
    proj = {
      id: uid('s'), logline: params.prompt || '', stage: 0,
      req: null, outline: null, storyboard: [], createdAt: Date.now()
    };
    store.add('series', proj);
  }
  renderProject(root, proj);
}

function renderNew(root) {
  const ta = h('textarea', { class: 'form-area', style: { minHeight: '120px' }, placeholder: '一句话故事创意，或直接粘贴剧本。例如：现代外卖员意外穿越到古代皇宫，被误认成御厨，情急之下做了一碗蛋炒饭，得到皇帝赏识。' });
  root.append(h('div', { class: 'page' },
    h('div', { class: 'page-title' }, '剧情短片'),
    h('div', { class: 'page-sub' }, '一句话创意 → 需求 → 角色场景 → 分镜 → 关键帧 → 成片，每一步你都可以改'),
    h('div', { style: { maxWidth: '720px' } },
      h('label', { class: 'form-label' }, '故事创意'),
      ta,
      h('div', { class: 'chip-row', style: { marginTop: '12px' } },
        ...['古装轻喜剧', '都市悬疑', '治愈日常', '仙侠爽剧', '产品种草短片'].map(t =>
          h('button', { class: 'chip', onclick: () => { ta.value = `${t}：`; ta.focus(); } }, t))),
      h('button', { class: 'btn-primary', style: { marginTop: '20px' }, onclick: () => {
        const p = ta.value.trim();
        if (!p) return toast('先写点创意', 'err');
        const proj = { id: uid('s'), logline: p, stage: 0, req: null, outline: null, storyboard: [], createdAt: Date.now() };
        store.add('series', proj);
        go('studio', { id: proj.id });
      } }, '开始创作')
    )));
}

function renderProject(root, proj) {
  const page = h('div', { class: 'page' });
  root.append(page);

  const steps = h('div', { class: 'steps' });
  const content = h('div', {});
  const footer = h('div', { style: { marginTop: '22px', display: 'flex', gap: '10px' } });

  const draw = () => {
    steps.innerHTML = '';
    STAGES.forEach((s, i) => steps.append(h('div', {
      class: 'step' + (i === proj.stage ? ' active' : i < proj.stage ? ' done' : ''),
      onclick: () => { proj.stage = i; store.save(); draw(); }
    }, h('span', { class: 'step-n' }, i < proj.stage ? '✓' : String(i + 1)), s)));
    content.innerHTML = '';
    [drawReq, drawOutline, drawRoles, drawStoryboard, drawFrames, drawFinal][proj.stage]();
    footer.innerHTML = '';
    footer.append(
      proj.stage > 0 ? h('button', { class: 'btn-ghost', onclick: () => { proj.stage--; store.save(); draw(); } }, '← 上一步') : null,
      proj.stage < STAGES.length - 1 ? h('button', { class: 'btn-primary', onclick: () => { proj.stage++; store.save(); draw(); } }, '下一步 →') : null,
      h('button', { class: 'btn-ghost', style: { marginLeft: 'auto' }, onclick: () => go('canvas', {}) }, '转到画布')
    );
  };

  /* ① 需求确认 */
  function drawReq() {
    const box = h('div', { class: 'req-card' });
    content.append(h('div', { class: 'page-sub' }, '第一步：让模型把你的创意整理成一份可执行的制作方案'), box);
    if (!proj.req) {
      box.append(h('button', { class: 'btn-primary', onclick: async e => {
        e.currentTarget.disabled = true; e.currentTarget.textContent = '分析中…';
        try {
          const r = await chat(`请把下面的创意整理成制作方案，只输出 JSON：{"title":"标题","logline":"一句话梗概","duration":"总时长如60秒","ratio":"16:9 或 9:16","style":"视觉风格"}\n\n创意：${proj.logline}`, { json: true });
          proj.req = { title: r.title || '未命名', logline: r.logline || '', duration: r.duration || '60秒', ratio: r.ratio || '16:9', style: r.style || '' };
          store.save(); draw();
        } catch (err) { toast('失败：' + err.message, 'err'); e.currentTarget.disabled = false; e.currentTarget.textContent = '生成制作方案'; }
      } }, '生成制作方案'));
      return;
    }
    for (const [k, label] of [['title', '标题'], ['logline', '梗概'], ['duration', '总时长'], ['ratio', '画幅'], ['style', '视觉风格']]) {
      box.append(h('div', { class: 'req-row' }, h('div', { class: 'req-k' }, label),
        h('div', { class: 'req-v' }, (() => {
          const i = h('input', { value: proj.req[k] || '', oninput: e => { proj.req[k] = e.target.value; store.save(); } });
          return i;
        })())));
    }
    box.append(h('button', { class: 'btn-ghost', style: { marginTop: '12px' }, onclick: () => { proj.req = null; draw(); } }, '重新生成'));
  }

  /* ② 剧本大纲 */
  function drawOutline() {
    content.append(h('div', { class: 'page-sub' }, '第二步：角色设定、场景与全局基调'));
    if (!proj.outline) {
      content.append(h('button', { class: 'btn-primary', onclick: async e => {
        e.currentTarget.disabled = true; e.currentTarget.textContent = '生成中…';
        try {
          const r = await chat(`根据以下方案写剧本大纲，只输出 JSON：{"synopsis":"剧情梗概","characters":[{"name":"","age":"","look":"外貌","persona":"性格"}],"scenes":[{"name":"","env":"环境","light":"光线氛围"}],"props":[{"name":"","desc":""}]}\n\n方案：${JSON.stringify(proj.req)}\n创意：${proj.logline}`, { json: true });
          proj.outline = r; store.save(); draw();
        } catch (err) { toast('失败：' + err.message, 'err'); e.currentTarget.disabled = false; e.currentTarget.textContent = '生成大纲'; }
      } }, '生成大纲'));
      return;
    }
    const o = proj.outline;
    if (o.synopsis) content.append(h('div', { class: 'card', style: { padding: '14px', marginBottom: '14px' } }, h('div', { class: 'asset-name' }, '剧情梗概'), h('div', { class: 'asset-desc', style: { maxHeight: 'none' } }, o.synopsis)));
    for (const [key, label] of [['characters', '角色'], ['scenes', '场景'], ['props', '道具']]) {
      if (!o[key]?.length) continue;
      content.append(h('div', { class: 'section-title' }, label));
      content.append(h('div', { class: 'asset-cards' }, ...o[key].map(c =>
        h('div', { class: 'asset-card' }, h('div', { class: 'asset-body' },
          h('div', { class: 'asset-name' }, c.name || '未命名'),
          h('div', { class: 'asset-desc' }, [c.age, c.look, c.persona, c.env, c.light, c.desc].filter(Boolean).join(' · ')))))));
    }
    content.append(h('button', { class: 'btn-ghost', style: { marginTop: '14px' }, onclick: () => { proj.outline = null; draw(); } }, '重新生成'));
  }

  /* ③ 角色/场景出图 */
  function drawRoles() {
    content.append(h('div', { class: 'page-sub' }, '第三步：为角色和场景生成参考图，确认后可作为资产在后续镜头复用'));
    const chars = proj.outline?.characters || [];
    const scenes = proj.outline?.scenes || [];
    if (!chars.length && !scenes.length) { content.append(h('div', { class: 'empty' }, '请先完成第二步「剧本大纲」')); return; }
    const wrap = h('div', { class: 'asset-cards' });
    [...chars.map(c => ({ ...c, kind: '角色' })), ...scenes.map(c => ({ ...c, kind: '场景' }))].forEach(c => {
      const imgBox = h('div', { style: { width: '100%', aspectRatio: '1', background: 'var(--bg)', display: 'flex', alignItems: 'center', justifyContent: 'center', overflow: 'hidden' } });
      if (c.image) imgBox.append(h('img', { src: c.image, style: { width: '100%', height: '100%', objectFit: 'cover' } }));
      else imgBox.append(h('span', { class: 'ico', html: icon('image', 28) }));
      const btn = h('button', { class: 'node-btn', style: { marginTop: '8px' }, onclick: async e => {
        e.currentTarget.disabled = true; e.currentTarget.textContent = '生成中…';
        try {
          const prompt = c.kind === '角色'
            ? `角色设定图：${c.name}，${c.age || ''}，${c.look || ''}，${c.persona || ''}，三视图，白底，清晰正面全身`
            : `场景设定图：${c.name}，${c.env || ''}，${c.light || ''}，电影感，无人物`;
          const r = await genImage(prompt, { size: '1024x1024' });
          c.image = r.url; store.save();
          store.add('assets', { id: uid('a'), name: c.name, type: c.kind === '角色' ? 'character' : 'scene', desc: [c.look, c.env, c.persona, c.light].filter(Boolean).join(' · '), url: r.url, createdAt: Date.now() });
          draw();
        } catch (err) { toast('失败：' + err.message, 'err'); e.currentTarget.disabled = false; e.currentTarget.textContent = '生成参考图'; }
      } }, c.image ? '重新生成' : '生成参考图');
      wrap.append(h('div', { class: 'asset-card' }, imgBox,
        h('div', { class: 'asset-body' }, h('div', { class: 'asset-name' }, `${c.name} · ${c.kind}`), btn)));
    });
    content.append(wrap);
    content.append(h('div', { class: 'hint' }, '生成的参考图会自动存入资产库，可直接在画布节点里调用。'));
  }

  /* ④ 分镜脚本 */
  function drawStoryboard() {
    content.append(h('div', { class: 'page-sub' }, '第四步：把剧本拆成镜头，逐条确认景别、运镜、台词与时长'));
    if (!proj.storyboard.length) {
      content.append(h('button', { class: 'btn-primary', onclick: async e => {
        e.currentTarget.disabled = true; e.currentTarget.textContent = '拆解中…';
        try {
          const r = await chat(`根据以下内容拆解分镜，只输出 JSON 数组（6-8 个镜头）：[{"n":1,"desc":"画面内容","shot":"景别如中景","camera":"运镜如缓慢推进","dialogue":"台词或空","dur":5}]\n\n方案：${JSON.stringify(proj.req)}\n大纲：${JSON.stringify(proj.outline)}`, { json: true });
          proj.storyboard = (Array.isArray(r) ? r : r.shots || []).map((s, i) => ({ n: s.n || i + 1, desc: s.desc || '', shot: s.shot || '', camera: s.camera || '', dialogue: s.dialogue || '', dur: s.dur || 5 }));
          store.save(); draw();
        } catch (err) { toast('失败：' + err.message, 'err'); e.currentTarget.disabled = false; e.currentTarget.textContent = '生成分镜'; }
      } }, '生成分镜'));
      return;
    }
    proj.storyboard.forEach((s, i) => {
      content.append(h('div', { class: 'shot-row' },
        h('div', { class: 'shot-n' }, s.n),
        h('div', { class: 'shot-main' },
          h('div', { class: 'shot-desc', contenteditable: 'true', onblur: e => { s.desc = e.target.textContent; store.save(); } }, s.desc),
          h('div', { class: 'shot-tags' },
            h('span', { class: 'tag' }, s.shot || '中景'),
            h('span', { class: 'tag' }, s.camera || '静止'),
            h('span', { class: 'tag' }, (s.dur || 5) + 's'),
            s.dialogue ? h('span', { class: 'tag' }, h('span', { class: 'ico', html: icon('chat', 12) }), ' ' + s.dialogue.slice(0, 16)) : null)),
        h('div', { class: 'shot-side' },
          h('div', { class: 'shot-frame' }, s.frame ? h('img', { src: s.frame }) : h('div', { class: 'stage-ph', style: { fontSize: '11px' } }, '待生成')))));
    });
    content.append(h('div', { style: { display: 'flex', gap: '10px' } },
      h('button', { class: 'btn-ghost', onclick: () => { proj.storyboard = []; store.save(); draw(); } }, '重新拆解'),
      h('button', { class: 'btn-primary', onclick: () => { proj.stage = 4; store.save(); draw(); } }, '去生成关键帧 →')));
  }

  /* ⑤ 关键帧 */
  function drawFrames() {
    content.append(h('div', { class: 'page-sub' }, '第五步：为每个镜头生成关键帧图，崩掉的镜头单独重绘，不用全部重来'));
    if (!proj.storyboard.length) { content.append(h('div', { class: 'empty' }, '请先完成第四步「分镜脚本」')); return; }
    const btnAll = h('button', { class: 'btn-primary', style: { marginBottom: '14px' }, onclick: async e => {
      e.currentTarget.disabled = true;
      for (const s of proj.storyboard) {
        if (s.frame) continue;
        e.currentTarget.textContent = `生成中 ${s.n}/${proj.storyboard.length}…`;
        try {
          const r = await genImage(`${s.desc}，${s.shot}，${proj.req?.style || ''}，电影感画面`, { size: '1280x720' });
          s.frame = r.url; store.save(); draw();
        } catch (err) { toast(`镜头 ${s.n} 失败：${err.message}`, 'err'); }
      }
      e.currentTarget.disabled = false; e.currentTarget.textContent = '一键生成全部关键帧';
    } }, '一键生成全部关键帧');
    content.append(btnAll);
    proj.storyboard.forEach(s => {
      content.append(h('div', { class: 'shot-row' },
        h('div', { class: 'shot-n' }, s.n),
        h('div', { class: 'shot-main' }, h('div', { class: 'shot-desc' }, s.desc),
          h('div', { class: 'shot-tags' }, h('span', { class: 'tag' }, s.shot || ''), h('span', { class: 'tag' }, (s.dur || 5) + 's'))),
        h('div', { class: 'shot-side' },
          h('div', { class: 'shot-frame' }, s.frame ? h('img', { src: s.frame }) : h('div', { class: 'stage-ph', style: { fontSize: '11px' } }, '待生成')),
          h('button', { class: 'node-btn', style: { marginTop: '6px', width: '100%', justifyContent: 'center' }, onclick: async e => {
            e.currentTarget.disabled = true; e.currentTarget.textContent = '…';
            try {
              const r = await genImage(`${s.desc}，${s.shot}，电影感`, { size: '1280x720' });
              s.frame = r.url; store.save(); draw();
            } catch (err) { toast('失败：' + err.message, 'err'); e.currentTarget.disabled = false; e.currentTarget.textContent = '重绘'; }
          } }, s.frame ? '重绘' : '生成'))));
    });
  }

  /* ⑥ 成片 */
  function drawFinal() {
    const ready = proj.storyboard.filter(s => s.frame);
    content.append(h('div', { class: 'page-sub' }, '第六步：把关键帧转成视频片段，然后合成成片'));
    if (!proj.storyboard.length) { content.append(h('div', { class: 'empty' }, '请先完成分镜与关键帧')); return; }
    const btnAll = h('button', { class: 'btn-primary', style: { marginBottom: '14px' }, onclick: async e => {
      e.currentTarget.disabled = true;
      for (const s of proj.storyboard) {
        if (s.video) continue;
        e.currentTarget.textContent = `生成片段 ${s.n}/${proj.storyboard.length}…`;
        try {
          const r = await genVideo(`${s.desc}，${s.camera || ''}`, { images: s.frame ? [s.frame] : [], duration: s.dur || 5, ratio: proj.req?.ratio || '16:9' });
          s.video = r.url; store.save(); draw();
        } catch (err) { toast(`镜头 ${s.n} 失败：${err.message}`, 'err'); }
      }
      e.currentTarget.disabled = false; e.currentTarget.textContent = '一键生成全部视频片段';
    } }, '一键生成全部视频片段');
    content.append(btnAll,
      h('div', { class: 'hint' }, `关键帧就绪 ${ready.length}/${proj.storyboard.length}　·　建议先用 Flash 类免费模型批量试错，定稿再用高清模型出片`));

    proj.storyboard.forEach(s => content.append(h('div', { class: 'shot-row' },
      h('div', { class: 'shot-n' }, s.n),
      h('div', { class: 'shot-main' }, h('div', { class: 'shot-desc' }, s.desc),
        h('div', { class: 'shot-tags' }, h('span', { class: 'tag' }, s.shot || ''), h('span', { class: 'tag' }, (s.dur || 5) + 's'),
          s.video ? h('span', { class: 'badge' }, '片段就绪') : null)),
      h('div', { class: 'shot-side' },
        h('div', { class: 'shot-frame' }, s.video ? h('video', { src: s.video, muted: true, controls: true }) : (s.frame ? h('img', { src: s.frame }) : null)),
        h('button', { class: 'node-btn', style: { marginTop: '6px', width: '100%', justifyContent: 'center' }, onclick: async e => {
          e.currentTarget.disabled = true; e.currentTarget.textContent = '…';
          try {
            const r = await genVideo(`${s.desc}，${s.camera || ''}`, { images: s.frame ? [s.frame] : [], duration: s.dur || 5, ratio: proj.req?.ratio || '16:9' });
            s.video = r.url; store.save(); draw();
          } catch (err) { toast('失败：' + err.message, 'err'); e.currentTarget.disabled = false; e.currentTarget.textContent = '生成片段'; }
        } }, s.video ? '重生成' : '生成片段')))));

    const all = proj.storyboard.filter(s => s.video);
    const statusLine = h('div', { class: 'hint', style: { marginTop: '10px' } }, '');
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
        h('button', { class: 'btn-primary', onclick: async e => {
          if (!all.length) return toast('还没有视频片段', 'err');
          e.currentTarget.disabled = true;
          try {
            const { concatVideos } = await import('../media.js');
            const r = await concatVideos(all.map(s => s.video), {
              transition: xf.checked ? 0.5 : 0,
              audioUrl: bgmUrl,
              onProgress: s => { statusLine.textContent = s; }
            });
            statusLine.textContent = '';
            resultBox.innerHTML = '';
            resultBox.append(
              h('video', { src: r.url, controls: true, style: { width: '100%', borderRadius: '10px', marginTop: '10px', maxHeight: '320px' } }),
              h('div', { style: { display: 'flex', gap: '10px', marginTop: '10px' } },
                h('button', { class: 'btn-primary', onclick: () => download(r.url, (proj.req?.title || '成片') + '.mp4') }, `下载成片（${(r.size / 1048576).toFixed(1)} MB）`),
                h('button', { class: 'btn-ghost', onclick: () => {
                  store.add('works', { id: uid('w'), title: (proj.req?.title || '成片'), type: 'video', url: r.url, createdAt: Date.now() });
                  toast('已存入作品库', 'ok');
                } }, '存入作品')));
            toast('合成完成', 'ok');
          } catch (err) {
            statusLine.textContent = '';
            toast('合成失败：' + err.message, 'err', 6000);
          }
          e.currentTarget.disabled = false;
        } }, '一键合成 MP4'),
        h('button', { class: 'btn-ghost', onclick: () => {
          const blob = new Blob([JSON.stringify(proj, null, 2)], { type: 'application/json' });
          download(URL.createObjectURL(blob), (proj.req?.title || '短片') + '.json');
        } }, '导出项目 JSON')),
      statusLine, resultBox,
      h('div', { class: 'hint' }, '合成在浏览器里完成（ffmpeg.wasm），首次要下载约 30MB 编码内核，之后本机缓存。成片是临时链接，记得及时下载。')));
  }

  page.append(
    h('div', { style: { display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: '16px' } },
      h('div', {},
        h('div', { class: 'page-title' }, proj.req?.title || '剧情短片'),
        h('div', { class: 'page-sub', style: { marginBottom: '0' } }, proj.logline.slice(0, 80) + (proj.logline.length > 80 ? '…' : ''))),
      proj.req ? h('div', { style: { display: 'flex', gap: '6px' } },
        h('span', { class: 'tag' }, proj.req.ratio || '16:9'),
        h('span', { class: 'tag' }, proj.req.duration || ''),
        h('span', { class: 'tag' }, proj.req.style || '')) : null),
    steps, content, footer);
  draw();
}
