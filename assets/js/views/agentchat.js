/* ============ Agent · 对话式创作（对齐「豆包工作」形态） ============
   中间是对话流，Agent 把方案 / 角色场景 / 分镜 / 关键帧 / 成片作为卡片贴进对话；
   关键节点在对话里直接「通过 / 重跑 / 一句话改」，不用跳表单式工作台。
   精细编辑仍可一键转到 studio。
   ================================================================ */
import { h, toast, esc } from '../ui.js';
import { icon } from '../icons.js';
import { store, uid, saveMedia } from '../store.js';
import { go } from '../app.js';
import { Agent, STEPS, DONE, newProject } from '../agent.js';
import { skillLabel, deliverOf } from '../skills.js';
import { chat } from '../models.js';
import { ASSISTANT_SYSTEM, wantsProduction, extractDocument } from '../assistant.js';
import { verdictLine } from '../verify.js';

const STATUS_TXT = {
  idle: '待开始', running: '执行中', waiting: '等你确认', paused: '已暂停', done: '已完成', error: '失败',
};

function statusText(a) { return STATUS_TXT[a.status] || '待开始'; }
function gateLabel(key) { return STEPS.find(s => s.key === key)?.label || ''; }

/* 气泡里的轻量 Markdown：加粗 / 行内代码 / 列表 / 换行
   先转义再做替换，避免模型输出里的尖括号被当 HTML 执行 */
const CODE_STYLE = 'background:#F2F3F5;padding:1px 5px;border-radius:5px;font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:12.5px';
function richText(t) {
  return esc(String(t == null ? '' : t))
    .replace(/`([^`\n]+)`/g, '<code style="' + CODE_STYLE + '">$1</code>')
    .replace(/\*\*([^*\n]+)\*\*/g, '<b>$1</b>')
    .replace(/__([^_\n]+)__/g, '<b>$1</b>')
    .replace(/(^|\n)\s*[-·]\s+/g, '$1• ')
    .replace(/(^|\n)(#{1,4})\s+/g, '$1')
    .replace(/\n/g, '<br>');
}

export function render(root, params = {}) {
  let proj = params.id ? store.find('series', params.id) : null;
  let agent = null;
  let nudgeDraft = '';
  let lastCount = -1;
  let lastCursor = -1, lastStatus = '';

  const rootEl = h('div', { class: 'agent-chat' });
  const headEl = h('div', { class: 'ac-head' });
  const logEl = h('div', { class: 'ac-log' });
  const msgWrap = h('div', { class: 'ac-msgs' });
  const taskEl = h('div', { class: 'ac-task' });
  logEl.append(msgWrap, taskEl);

  const inputEl = h('textarea', { class: 'ac-input', rows: '1', placeholder: '说需求、问问题，或上传图片/文档让我读……' });
  const sendBtn = h('button', { class: 'ac-send', title: '发送' },
    h('span', { html: '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 19V5M5 12l7-7 7 7"/></svg>' }));

  /* 附件：图片走多模态，文档抽成文本一起发 */
  let attach = { images: [], docs: [] };
  const chipRow = h('div', {
    style: {
      display: 'none', flexWrap: 'wrap', gap: '6px', padding: '0 2px 8px',
      fontSize: '12px', color: 'var(--txt-2)'
    }
  });
  const fileInput = h('input', {
    type: 'file', multiple: true,
    accept: 'image/*,.txt,.md,.csv,.json,.docx',
    style: { display: 'none' }
  });
  const attachBtn = h('button', { class: 'ac-send', title: '上传图片或文档（txt/md/csv/json/docx）', onclick: () => fileInput.click() },
    h('span', { html: '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 5v14M5 12h14"/></svg>' }));

  const compose = h('div', { class: 'ac-compose' },
    chipRow,
    h('div', { class: 'ac-box' }, attachBtn, inputEl, sendBtn),
    fileInput);
  rootEl.append(headEl, logEl, compose);
  root.append(rootEl);

  /* ---------- 有创意参数：直接建项目 ---------- */
  if (!proj && params.prompt) {
    proj = newProject(params.prompt);
    proj.chat = [{ id: uid('m'), role: 'user', text: params.prompt, at: Date.now() }];
    store.add('series', proj);
    mountAgent();
    paintHead();
    renderAll();
    agent.run();
    bindCompose();
    return;
  }

  if (proj) { mountAgent(); }
  paintHead();
  renderAll();
  bindCompose();
  if (proj && params.start) agent.run();

  /* ================= 逻辑 ================= */
  function mountAgent() {
    proj.chat = proj.chat || [];
    agent = new Agent(proj, onChange);
  }

  function onChange() {
    const a = agent.st;
    if (a.cursor !== lastCursor || a.status !== lastStatus) {
      lastCursor = a.cursor; lastStatus = a.status;
      announce();
    }
    renderAll();
  }

  /* 阶段完成时在对话里说一句，只在首次进入该阶段时说明 */
  function announce() {
    const a = agent.st;
    const key = a.status + '@' + a.cursor + '@' + (a.pending || '');
    /* 先思考：把理解和选中的技能说清楚，再往下执行 */
    if (proj.think) {
      say(`我先想了一下：${proj.think.summary || '按你的要求来做'}。这次调用 ${(proj.think.skills || []).map(skillLabel).join('、')}${proj.think.reason ? '——' + proj.think.reason : ''}`, 'think@' + proj.think.at);
    }
    if (a.status === 'waiting') {
      if (a.pending === 'assemble') return say('镜头都出好了，去合成成片吧。', key);
      if (a.pending === 'outline') return say('方案和角色 / 场景拆好了。' + verdictLine(proj.verify?.outline, '剧情') + ' 看一眼，确认后我出定妆图。', key);
      if (a.pending === 'storyboard') return say(`分镜排好了，共 ${proj.storyboard.length} 个镜头。` + verdictLine(proj.verify?.storyboard, '分镜') + ' 哪条不顺直接在这说，我只改那条。', key);
      if (a.pending === 'video') return say(`${proj.storyboard.length} 个镜头视频都出好了，检查一下，没问题就去合成。`, key);
      return say(`「${gateLabel(a.pending)}」准备好了，确认后继续。`, key);
    }
    if (a.status === 'done') return say('成片合成完了，在下面直接看。', key);
    if (a.status === 'error') return say('卡住了：' + (a.error || '未知错误'), key);
  }

  function say(text, stage) {
    if (proj.chat.some(m => m.stage === stage)) return;
    const m = { id: uid('m'), role: 'agent', text, at: Date.now() };
    if (stage) m.stage = stage;
    proj.chat.push(m);
    store.save();
    paintMessages();
  }

  function push(role, text) {
    proj.chat.push({ id: uid('m'), role, text, at: Date.now() });
    store.save();
    paintMessages();
  }

  /* ---------- 助手对话（不跑流水线，就真的在聊天/读图/读文档） ---------- */
  let replying = false;
  async function chatReply(text, imgs = [], docs = []) {
    if (replying) return;
    replying = true;
    try {
      const hist = (proj.chat || []).filter(m => !m.stage).slice(-12)
        .map(m => (m.role === 'user' ? '用户：' : '助手：') + m.text).join('\n');
      const docPart = docs.length
        ? '\n\n【用户上传的文档内容】\n' + docs.map(d => '《' + d.name + '》\n' + d.text).join('\n\n')
        : '';
      const prompt = '【最近的对话】\n' + hist
        + '\n\n【用户这次说】\n' + (text || '（只发了附件，没有文字）')
        + docPart;
      const out = await chat(prompt, {
        system: ASSISTANT_SYSTEM,
        feature: 'agentText',
        temperature: 0.6,
        images: imgs
      });
      say(String(out || '').trim() || '这次没组织出话来，再说一次试试。', 'reply@' + Date.now());
    } catch (e) {
      say('没答上来：' + (e && e.message ? e.message : e), 'err@' + Date.now());
    } finally {
      replying = false;
    }
  }

  function paintAttach() {
    chipRow.innerHTML = '';
    const total = attach.images.length + attach.docs.length;
    if (!total) { chipRow.style.display = 'none'; return; }
    chipRow.style.display = 'flex';
    const chip = (label, onDel) => h('span', {
      style: {
        display: 'inline-flex', alignItems: 'center', gap: '6px', padding: '3px 9px',
        borderRadius: '999px', background: 'var(--brand-soft)', color: 'var(--brand-2)'
      }
    }, label, h('b', { style: { cursor: 'pointer' }, onclick: onDel }, '×'));
    attach.images.forEach((u, i) => chipRow.append(chip('图片 ' + (i + 1), () => { attach.images.splice(i, 1); paintAttach(); })));
    attach.docs.forEach((d, i) => chipRow.append(chip(d.name, () => { attach.docs.splice(i, 1); paintAttach(); })));
  }

  function clearAttach() {
    attach = { images: [], docs: [] };
    paintAttach();
  }

  function bindAttach() {
    fileInput.addEventListener('change', async () => {
      const files = [...(fileInput.files || [])];
      fileInput.value = '';
      for (const f of files) {
        try {
          if (String(f.type || '').startsWith('image/')) {
            attach.images.push(await saveMedia(f));
          } else {
            attach.docs.push(await extractDocument(f));
          }
        } catch (e) {
          toast((e && e.message) || '这个文件读不了', 'err', 4600);
        }
      }
      paintAttach();
    });
  }

  function createProject(text) {
    const p = newProject(text);
    p.chat = [{ id: uid('m'), role: 'user', text, at: Date.now() }];
    store.add('series', p);
    go('agent', { id: p.id, start: '1' });
  }

  /* 改完分镜后只重出被作废的镜头：从 frames 步续跑，已有产物自动跳过。
     只要分镜（deliver=storyboard）时不重跑任何生成，直接停在分镜处给用户看。 */
  function regenerateChanged() {
    if (deliverOf(proj) === 'storyboard') { renderAll(); return; }
    const i = STEPS.findIndex(s => s.key === 'frames');
    agent.st.cursor = i;
    agent.st.status = 'idle';
    agent.st.approved = { ...(agent.st.approved || {}), outline: true, storyboard: true };
    agent.save();
    agent.run();
  }

  /* ================= 交互 ================= */
  function bindCompose() {
    bindAttach();
    paintAttach();
    sendBtn.addEventListener('click', send);
    inputEl.addEventListener('keydown', e => {
      if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); }
    });
    inputEl.addEventListener('input', autosize);
    autosize();
  }

  function autosize() {
    inputEl.style.height = 'auto';
    inputEl.style.height = Math.min(120, inputEl.scrollHeight) + 'px';
  }

  async function send() {
    const text = inputEl.value.trim();
    const hasAttach = attach.images.length + attach.docs.length > 0;
    if (!text && !hasAttach) return;
    inputEl.value = '';
    autosize();

    const imgs = attach.images.slice();
    const docs = attach.docs.slice();
    const note = [
      imgs.length ? `[图片 ${imgs.length} 张]` : '',
      docs.length ? docs.map(d => `[文档 ${d.name}]`).join(' ') : ''
    ].filter(Boolean).join(' ');
    const line = (text || (hasAttach ? '（附件）' : '')) + (note ? '  ' + note : '');

    /* 还没有项目：先判断这是「问事」还是「要做片」 */
    if (!proj) {
      if (hasAttach || !wantsProduction(text)) {
        proj = newProject(text || docs[0]?.name || '新会话');
        proj.chat = [];
        proj.mode = 'chat';
        store.add('series', proj);
        mountAgent();
        paintHead();
        renderAll();
        push('user', line);
        clearAttach();
        await chatReply(text, imgs, docs);
        return;
      }
      createProject(line);
      clearAttach();
      return;
    }
    if (!agent) mountAgent();

    const a = proj.agent;
    if (a.status === 'running') { push('user', line); toast('正在执行，可以先暂停再改', 'err'); return; }

    push('user', line);

    /* 1) 已经排好分镜：这句话是对镜头的局部修改 */
    const noBoard = !(proj.storyboard || []).length;
    if (!noBoard) {
      clearAttach();
      try {
        const r = await agent.nudge(text);
        if (r.changed.length) {
          say(`改好了镜头 ${r.changed.join('、')}。${r.note || ''}`, 'nudge@' + Date.now());
          regenerateChanged();
        } else {
          say(r.note || '这条不用改，原样保留。', 'nudge@' + Date.now());
        }
      } catch (e) { say('没改成：' + e.message, 'nudge@' + Date.now()); }
      return;
    }

    /* 2) 流水线正等你确认：说「继续 / 好」就往下走 */
    if (a.status === 'waiting' && !hasAttach && !/^(不|别|先不|等等|等一下)/.test(text)) {
      proj.mode = 'prod';
      store.save();
      clearAttach();
      agent.approve();
      return;
    }

    /* 3) 明确要开工：聊天模式下也能一句话转生产（之前进了对话就再也出不了片） */
    if (!hasAttach && wantsProduction(text)) {
      proj.mode = 'prod';
      if (!proj.logline) proj.logline = text;
      store.save();
      clearAttach();
      paintTask();
      agent.run();
      return;
    }

    /* 4) 其余一律当对话：带附件、提问、模糊需求都走这里 */
    if (proj.mode !== 'chat') { proj.mode = 'chat'; store.save(); }
    clearAttach();
    paintTask();
    await chatReply(text, imgs, docs);
  }

  /* ================= 渲染 ================= */
  function paintHead() {
    headEl.innerHTML = '';
    const mSwitch = h('div', { class: 'mode-switch' });
    if (proj) {
      for (const [k, label] of [['director', '导演模式'], ['auto', '全自动']]) {
        mSwitch.append(h('button', {
          class: 'mode-btn' + (proj.agent.mode === k ? ' active' : ''),
          onclick: () => { agent && agent.setMode(k); paintHead(); renderAll(); },
        }, label));
      }
    }
    headEl.append(
      h('div', { class: 'ac-head-main' },
        h('div', { class: 'ac-title' }, 'Agent'),
        h('div', { class: 'ac-sub' }, '既能聊（看图、读文档、问功能），也能干活（一句话出方案、分镜、成片）。')),
      h('div', { class: 'ac-head-actions' }, mSwitch));
  }

  function paintMessages() {
    msgWrap.innerHTML = '';
    if (!proj) {
      msgWrap.append(h('div', { class: 'ac-welcome' },
        h('div', { class: 'ac-welcome-ic', html: icon('agent', 30) }),
        h('h2', {}, '今天想拍点什么？'),
        h('p', {}, '给我一句创意或一段剧本，我先把方案、角色和分镜摆出来给你审。'),
        h('div', { class: 'ac-ex' },
          ...['外卖员穿越皇宫做蛋炒饭', '雨夜中式茶馆，风衣女子推门而入', '国风仙侠 · 折梅听风，一镜到底'].map(t =>
            h('button', { class: 'chip', onclick: () => { inputEl.value = t; inputEl.focus(); autosize(); } }, t)))));
      lastCount = 0;
      return;
    }
    for (const m of proj.chat || []) {
      const isMe = m.role === 'user';
      msgWrap.append(h('div', { class: 'ac-msg ' + (isMe ? 'me' : 'ai') },
        h('div', { class: 'ac-av', html: icon(isMe ? 'chat' : 'spark', 15) }),
        isMe
          ? h('div', { class: 'ac-bub' }, m.text)
          : h('div', { class: 'ac-bub', html: richText(m.text) })));
    }
    lastCount = (proj.chat || []).length;
  }

  function renderAll() {
    if ((proj?.chat || []).length !== lastCount) paintMessages();
    /* 正在「一句话改」输入框里打字时不要重绘任务卡，否则会丢焦点 */
    const ae = document.activeElement;
    const typingNudge = !!(ae && ae.classList && ae.classList.contains('ac-nudge-in'));
    if (!typingNudge) paintTask();
    requestAnimationFrame(() => { logEl.scrollTop = logEl.scrollHeight; });
  }

  /* 对话模式的状态条：不催工，只提示「想开工就说」 */
  function paintChatBar() {
    const bar = h('div', {
      style: {
        display: 'flex', alignItems: 'center', gap: '10px', flexWrap: 'wrap',
        padding: '10px 12px', border: '1px solid var(--line)', borderRadius: '12px', background: '#fff'
      }
    });
    bar.append(
      h('span', { class: 'ac-dot' }),
      h('span', { style: { fontSize: '12.5px', color: 'var(--txt-2)' } },
        '对话模式：随便问、随便聊，发图片和文档我也能看'),
      h('span', { style: { flex: '1 1 auto' } }),
      h('button', {
        class: 'node-btn',
        onclick: () => {
          const lastUser = (proj.chat || []).filter(m => m.role === 'user').slice(-1)[0];
          proj.mode = 'prod';
          if (!proj.logline) proj.logline = lastUser?.text || '新片';
          store.save();
          paintTask();
          agent.run();
        }
      }, '开始做片')
    );
    taskEl.append(bar);
  }

  function paintTask() {
    taskEl.innerHTML = '';
    if (!proj) { taskEl.classList.add('hidden'); return; }
    taskEl.classList.remove('hidden');
    /* 聊天模式下不要摆「0 个分镜 / 开始执行」那套催工卡，改成一条对话模式条 */
    if (proj.mode === 'chat' && !(proj.storyboard || []).length) { paintChatBar(); return; }
    const a = proj.agent;    const dotCls = a.status === 'running' ? 'ac-dot on' : a.status === 'error' ? 'ac-dot err' : 'ac-dot';
    taskEl.append(h('div', { class: 'ac-task-h' },
      h('span', { class: dotCls }),
      h('span', { class: 'ac-state ' + a.status }, statusText(a)),
      a.progress ? h('span', { class: 'ac-progress' }, `${a.progress.msg}${a.progress.pct ? ' · ' + a.progress.pct + '%' : ''}`) : null,
      h('span', { class: 'ac-spacer' }),
      h('span', { class: 'ac-count' }, `${(proj.storyboard || []).length} 个分镜`)));

    /* 步骤 */
    const steps = h('div', { class: 'ac-steps' });
    STEPS.forEach((s, i) => {
      const done = DONE[s.key](proj);
      const cls = i === a.cursor ? 'cur' : done ? 'done' : '';
      steps.append(h('span', { class: 'ac-step ' + cls, title: s.hint },
        (done && i !== a.cursor ? '✓ ' : '') + s.label));
    });
    taskEl.append(steps);

    /* 产物 */
    taskEl.append(h('div', { class: 'ac-body' }, ...productBlocks(a)));

    /* 操作 */
    taskEl.append(actions(a));

    /* 一句话改（有分镜时） */
    if ((proj.storyboard || []).length) taskEl.append(nudgeRow());
  }

  /* 自检结果卡片：分数 + 待处理问题 + 已自动修正的镜头 */
  function verifyBlock(v, label) {
    if (!v) return null;
    const bad = (v.issues || []).filter(x => x.level !== 'low');
    const box = h('div', {});
    box.append(h('div', {
      class: 'ac-sect',
      style: { color: v.pass ? 'var(--ok)' : 'var(--warn)', marginTop: '10px' }
    }, `${label}自检 ${v.score || '-'} 分 · ${v.pass ? '通过' : bad.length + ' 处待处理'}`));

    if (v.logic) box.append(h('div', { class: 'ac-logline', style: { paddingTop: '0' } }, v.logic));

    if (bad.length) {
      box.append(h('div', { style: { display: 'flex', flexDirection: 'column', gap: '4px', paddingBottom: '6px' } },
        ...bad.slice(0, 6).map(x => h('div', {
          style: { fontSize: '12px', color: 'var(--txt-2)', lineHeight: '1.5' }
        }, (x.level === 'high' ? '⛔ ' : '⚠ ') + x.where + '：' + x.problem))));
    }
    if (v.patched && v.patched.length) {
      box.append(h('div', { style: { fontSize: '11.5px', color: 'var(--ok)' } },
        `已自动修正镜头 ${v.patched.join('、')}`));
    }
    return box;
  }

  function productBlocks(a) {
    const out = [];
    if (proj.think) out.push(thinkBlock(proj.think));
    if (proj.film) {
      const v = h('video', { src: proj.film, controls: '', playsinline: '', preload: 'metadata', class: 'ac-film' });
      out.push(v);
    }
    if (proj.req) {
      out.push(h('div', { class: 'ac-plan' },
        h('span', { class: 'ac-plan-t' }, proj.req.title || '未命名'),
        h('span', { class: 'ac-chip' }, proj.req.ratio || '16:9'),
        h('span', { class: 'ac-chip' }, proj.req.duration || ''),
        proj.req.style ? h('span', { class: 'ac-chip' }, proj.req.style) : null,
        proj.req.tone ? h('span', { class: 'ac-chip' }, proj.req.tone) : null));
      if (proj.req.logline) out.push(h('div', { class: 'ac-logline' }, proj.req.logline));
    }
    if (proj.outline) {
      /* 剧情放最前：先把故事讲清楚，再看角色图，否则会像「图先出来了、剧情没有」 */
      if (proj.outline.synopsis) {
        out.push(h('div', { class: 'ac-sect' }, '剧情梗概'));
        out.push(h('div', { class: 'ac-logline' }, proj.outline.synopsis));
      }
      if (proj.verify?.outline) {
        const vb = verifyBlock(proj.verify.outline, '剧情');
        if (vb) out.push(vb);
      }
      const list = [...(proj.outline.characters || []), ...(proj.outline.scenes || [])];
      if (list.length) {
        out.push(h('div', { class: 'ac-sect' }, '角色与场景设定'));
        out.push(h('div', { class: 'ac-assets' }, ...list.map(c => {
          const cell = h('div', { class: 'ac-asset' });
          /* 主图 = 三视图 / 全景；细节图叠在右下角小角标，保证每格高度一致、名字对齐 */
          const fig = h('div', { style: { position: 'relative', width: '86px', height: '86px' } });
          fig.append(c.image
            ? h('img', { src: c.image, class: 'ac-asset-img', style: { width: '86px', height: '86px' } })
            : h('div', { class: 'ac-asset-ph', html: icon('image', 16) }));
          if (c.detail) {
            fig.append(h('img', {
              src: c.detail,
              title: '细节图',
              style: {
                position: 'absolute', right: '-4px', bottom: '-4px', width: '38px', height: '38px',
                objectFit: 'cover', borderRadius: '7px', border: '2px solid #fff',
                boxShadow: '0 1px 4px rgba(0,0,0,.18)', background: '#fff'
              }
            }));
          }
          cell.append(fig);
          cell.append(h('div', { class: 'ac-asset-name' }, c.name));
          const meta = c.look || c.env || '';
          if (meta) {
            cell.append(h('div', {
              style: { fontSize: '11px', color: 'var(--txt-3)', lineHeight: '1.35', marginTop: '2px' }
            }, meta.slice(0, 46)));
          }
          return cell;
        })));
      }
    }
    if ((proj.storyboard || []).length) {
      const rows = h('div', { class: 'ac-shots' });
      for (const s of proj.storyboard) {
        const thumb = s.frame
          ? h('img', { src: s.frame, class: 'ac-thumb' })
          : (s.video
            ? h('div', { class: 'ac-thumb ac-thumb-ph', html: icon('video', 15) })
            : h('div', { class: 'ac-thumb ac-thumb-ph' }, String(s.n)));
        rows.append(h('div', { class: 'ac-shot' },
          h('div', { class: 'ac-shot-n' }, String(s.n)),
          thumb,
          h('div', { class: 'ac-shot-d' }, s.desc || '（未写画面）', s.dialogue ? h('div', { class: 'ac-shot-line' }, '「' + s.dialogue + '」') : null),
          h('div', { class: 'ac-shot-m' }, `${s.shot || ''} · ${s.camera || ''} · ${s.dur || 5}s`)));
      }
      out.push(rows);
      if (proj.verify?.storyboard) {
        const vb = verifyBlock(proj.verify.storyboard, '分镜');
        if (vb) out.push(vb);
      }
    }
    if (!out.length) {
      out.push(h('div', { class: 'ac-hint' }, a.status === 'running' ? '正在理解你的创意…' : '还没开始，发一句话就开工。'));
    }
    return out;
  }

  function actions(a) {
    const bar = h('div', { class: 'ac-acts' });
    const btn = (label, cls, fn) => h('button', { class: cls, onclick: fn }, label);

    if (a.status === 'idle') {
      bar.append(btn('开始执行', 'btn-primary sm', () => agent.run()));
    } else if (a.status === 'running') {
      bar.append(h('span', { class: 'ac-hint' }, '执行中…'), btn('暂停', 'btn-ghost sm', () => agent.pause()));
    } else if (a.status === 'waiting') {
      if (a.pending === 'assemble') {
        bar.append(btn('去合成成片 →', 'btn-primary sm', () => go('studio', { id: proj.id })));
      } else {
        bar.append(btn('通过，继续 →', 'btn-primary sm', () => agent.approve()),
          btn('重跑这一步', 'btn-ghost sm', () => agent.redo()));
      }
    } else if (a.status === 'done') {
      bar.append(btn('再做一个', 'btn-primary sm', () => go('agent', {})),
        btn('回到分镜重做', 'btn-ghost sm', () => { agent.rewind(STEPS.findIndex(s => s.key === 'storyboard')); agent.run(); }));
    } else if (a.status === 'error') {
      bar.append(h('span', { class: 'ac-err' }, a.error || '执行失败'),
        btn('重试', 'btn-primary sm', () => agent.run()),
        btn('重跑这一步', 'btn-ghost sm', () => agent.redo()));
    }
    if ((proj.storyboard || []).length) {
      bar.append(btn('精细工作台', 'btn-ghost sm', () => go('studio', { id: proj.id })));
    }
    return bar;
  }

  function nudgeRow() {
    const i = h('input', { class: 'ac-nudge-in', placeholder: '一句话改，例如：把第 2 个镜头改成夜景' });
    i.value = nudgeDraft;
    i.addEventListener('input', () => { nudgeDraft = i.value; });
    const b = h('button', { class: 'btn-accent sm', onclick: async e => {
      const text = i.value.trim();
      if (!text) return toast('写点要改什么', 'err');
      const btn = e.currentTarget; btn.disabled = true; btn.textContent = '调整中…';
      nudgeDraft = '';
      push('user', text);
      try {
        const r = await agent.nudge(text);
        if (r.changed.length) { say(`改好了镜头 ${r.changed.join('、')}。${r.note || ''}`, 'nudge@' + Date.now()); regenerateChanged(); }
        else say(r.note || '这条不用改。', 'nudge@' + Date.now());
      } catch (err) { say('没改成：' + err.message, 'nudge@' + Date.now()); }
      btn.disabled = false; btn.textContent = '应用';
    } }, '应用');
    return h('div', { class: 'ac-nudge' }, h('span', { class: 'ac-nudge-ic', html: icon('spark', 13) }), i, b);
  }
}

/* 思考卡：说明它理解了什么、这次挑哪些技能 */
function thinkBlock(t) {
  const skills = t.skills || [];
  return h('div', { class: 'ac-think' },
    h('div', { class: 'ac-think-h' }, h('span', { html: icon('spark', 13) }), ' 思考 · 计划调用 ', String(skills.length), ' 个技能'),
    t.summary ? h('div', { class: 'ac-think-sum' }, t.summary) : null,
    h('div', { class: 'ac-skills' }, ...skills.map(k => h('span', { class: 'ac-skill' }, skillLabel(k)))),
    t.reason ? h('div', { class: 'ac-think-reason' }, t.reason) : null);
}
