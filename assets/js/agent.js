/* ============ Agent 创作代理 ============
   参考开源实现的两条主线：
   - LangGraph 的 interrupt + checkpoint：把「暂停等人审」做成持久状态，恢复时从断点继续，
     已完成的部分不重跑（对应这里的 proj.agent.cursor + 每步幂等）。
   - OpenMontage 的 pipeline manifest：每个阶段有明确的产出与审核关口，全程留决策日志。

   设计取舍：
   - 状态全部落在 proj.agent（会被 store 持久化），所以刷新页面/换设备打开都不丢；
   - 每个 runner 幂等（产物已存在就跳过），所以「续跑」永远不会重做已经生成的东西；
   - 模式在中途切换时，只影响下一个关口是否停下，规划上下文一点不动。
   ============================================ */
import { store, uid } from './store.js';
import { chat, genImage, genVideo } from './models.js';
import { SKILLS, skillCatalog, hasSkill, deliverOf } from './skills.js';
const SKILL_KEYS = new Set(SKILLS.map(s => s.key));

export const STEPS = [
  { key: 'think',      label: '思考',       gate: false, hint: '理解需求，决定这次调用哪些技能' },
  { key: 'plan',       label: '制作方案',   gate: false, hint: '把创意整理成可执行的制作方案' },
  { key: 'outline',    label: '角色与场景', gate: true,  hint: '拆出角色、场景、道具与全局基调' },
  { key: 'assets',     label: '定妆图',     gate: false, hint: '角色 / 场景参考图，后续镜头复用' },
  { key: 'storyboard', label: '分镜方案',   gate: true,  hint: '逐镜头写清画面、景别、运镜、时长' },
  { key: 'frames',     label: '关键帧',     gate: false, hint: '每个镜头先出一张首帧' },
  { key: 'video',      label: '镜头视频',   gate: true,  hint: '关键帧转片段，逐镜检查' },
  { key: 'assemble',   label: '合成成片',   gate: false, manual: true, hint: '按顺序拼接成 MP4' },
];

const VIDEO_FIELDS = ['desc', 'shot', 'camera', 'dialogue', 'dur'];

/* 幂等判定：这一步的产物是不是已经有了 */
export const DONE = {
  think: p => !!p.think,
  plan: p => !!p.req,
  outline: p => !!p.outline,
  assets: p => {
    const list = [...(p.outline?.characters || []), ...(p.outline?.scenes || [])];
    return list.every(c => c.image);   // 没有角色/场景也算完成，避免空转
  },
  storyboard: p => (p.storyboard || []).length > 0,
  frames: p => (p.storyboard || []).length > 0 && p.storyboard.every(s => s.frame),
  video: p => (p.storyboard || []).length > 0 && p.storyboard.every(s => s.video),
  assemble: p => !!p.film,
};

/* 为每个分镜挑生成路径：特写先锁表情、大场景直接文生、有角色参考就走参考图 */
export function routeShot(s, proj) {
  const text = `${s.desc || ''} ${s.shot || ''} ${s.camera || ''}`;
  const close = /特写|近景|大特写/.test(text);
  const wide = /全景|远景|航拍|大全景|空镜/.test(text);
  const hasLine = !!(s.dialogue || '').trim();
  const chars = proj.outline?.characters || [];
  const refs = chars
    .filter(c => c.image && s.desc && s.desc.includes(c.name))
    .map(c => c.image)
    .slice(0, 2);
  const mode = wide && !hasLine ? 'text' : 'keyframe';
  return {
    refs,
    videoMode: mode,
    model: mode === 'text' ? '文生视频' : '图生视频',
    routeNote: close ? '特写：先定关键帧，锁住表情与细节'
      : wide ? '大场景：文生视频，构图交给运镜提示'
        : '常规：关键帧起手，画面更稳',
  };
}

/* ---------------- 各阶段执行（全部幂等） ---------------- */
const RUN = {
  async think(proj, tick) {
    if (DONE.think(proj)) return;
    tick('先想一下怎么做…', 8);
    const r = await chat(
      `用户要做一支短视频，创意是：${proj.logline}

你可以调用的技能（每行一个 key）：
${skillCatalog()}

先思考：这个需求真正要什么、该调用哪些技能、最终交什么？只输出 JSON：
{"summary":"一句话复述你要做的片子","skills":["按执行顺序从上表挑 key"],"deliver":"video|images|storyboard","reason":"一句话说明为什么这么选"}
规则：
- 涉及画面时，必须含 story、storyboard；
- 要出图才加 image，要出视频才加 video；
- 用户只要文字或分镜时，deliver 用 storyboard，且不要加 image / video；
- 用户只要几张图时，deliver 用 images。`,
      { json: true, feature: 'agentText', system: '你是创作导演。先判断要哪些工序，不要急着写具体内容。' }
    );
    const keys = (Array.isArray(r.skills) ? r.skills : []).filter(k => SKILL_KEYS.has(k));
    const skills = keys.length ? keys : ['story', 'storyboard', 'image', 'video'];
    let deliver = ['video', 'images', 'storyboard'].includes(r.deliver) ? r.deliver : 'video';
    /* 自洽校正：选了视频交付却没视频技能，就降级为出图；出图没图像技能就只交分镜 */
    if (deliver === 'video' && !skills.includes('video')) deliver = skills.includes('image') ? 'images' : 'storyboard';
    if (deliver === 'images' && !skills.includes('image')) deliver = 'storyboard';
    proj.think = {
      summary: r.summary || '',
      skills,
      deliver,
      reason: r.reason || '',
      at: Date.now(),
    };
  },

  async plan(proj, tick) {
    if (DONE.plan(proj)) return;
    tick('正在理解创意…', 20);
    const r = await chat(
      `把下面的创意整理成一份可执行的短视频制作方案，只输出 JSON：
{"title":"标题","logline":"一句话梗概","duration":"总时长如60秒","ratio":"16:9 或 9:16","style":"视觉风格","tone":"情绪基调","audience":"目标观众"}

创意：${proj.logline}`,
      { json: true, feature: 'agentText', system: '你是短剧制片人，输出必须是可以直接执行的中文方案，不要解释。' }
    );
    proj.req = {
      title: r.title || '未命名', logline: r.logline || proj.logline,
      duration: r.duration || '60秒', ratio: r.ratio === '9:16' ? '9:16' : '16:9',
      style: r.style || '', tone: r.tone || '', audience: r.audience || '',
    };
  },

  async outline(proj, tick) {
    if (DONE.outline(proj)) return;
    tick('拆解角色与场景…', 25);
    const r = await chat(
      `根据制作方案写剧本大纲，只输出 JSON：
{"synopsis":"剧情梗概（120字内）",
 "characters":[{"name":"","age":"","look":"外貌与服装","persona":"性格"}],
 "scenes":[{"name":"","env":"环境","light":"光线氛围"}],
 "props":[{"name":"","desc":""}]}

方案：${JSON.stringify(proj.req)}
创意：${proj.logline}`,
      { json: true, feature: 'agentText' }
    );
    proj.outline = {
      synopsis: r.synopsis || '',
      characters: (r.characters || []).map(c => ({ name: c.name || '未命名', age: c.age || '', look: c.look || '', persona: c.persona || '', image: '' })),
      scenes: (r.scenes || []).map(c => ({ name: c.name || '未命名', env: c.env || '', light: c.light || '', image: '' })),
      props: r.props || [],
    };
  },

  async assets(proj, tick) {
    if (!hasSkill(proj, 'image')) return;
    const list = [...(proj.outline?.characters || []), ...(proj.outline?.scenes || [])];
    let i = 0;
    for (const c of list) {
      i++;
      if (c.image) continue;
      tick(`生成定妆图 ${i}/${list.length} · ${c.name}`, Math.round((i / Math.max(1, list.length)) * 90));
      const isChar = !('env' in c);
      const prompt = isChar
        ? `角色设定图：${c.name}，${c.age || ''}，${c.look || ''}，${c.persona || ''}，三视图，白底，清晰正面全身`
        : `场景设定图：${c.name}，${c.env || ''}，${c.light || ''}，电影感，无人物`;
      try {
        const r = await genImage(prompt, { size: '1024x1024', feature: 'agentImage' });
        c.image = r.url;
        store.add('assets', {
          id: uid('a'), name: c.name, type: isChar ? 'character' : 'scene',
          desc: [c.look, c.env, c.persona, c.light].filter(Boolean).join(' · '),
          url: r.url, createdAt: Date.now(),
        });
      } catch (e) {
        /* 单张失败不阻断整条流水线：留空，后面镜头不用它即可 */
        c.imageError = e.message;
      }
    }
    if (list.length && list.every(c => !c.image)) throw new Error('定妆图全部生成失败，检查模型或额度');
  },

  async storyboard(proj, tick) {
    if (DONE.storyboard(proj)) return;
    tick('规划分镜…', 30);
    const r = await chat(
      `根据以下内容拆解分镜，只输出 JSON 对象：{"shots":[{"n":1,"desc":"画面内容（谁在哪做什么）","shot":"景别","camera":"运镜","dialogue":"台词，没有就空字符串","dur":5}]}
要求 6-8 个镜头，dur 为 4-10 的整数秒。

方案：${JSON.stringify(proj.req)}
大纲：${JSON.stringify({ synopsis: proj.outline?.synopsis, characters: proj.outline?.characters?.map(c => c.name), scenes: proj.outline?.scenes?.map(c => c.name) })}`,
      { json: true, feature: 'agentText' }
    );
    const shots = Array.isArray(r) ? r : (r.shots || []);
    proj.storyboard = shots.map((s, i) => {
      const shot = {
        n: s.n || i + 1, desc: s.desc || '', shot: s.shot || '中景', camera: s.camera || '静止',
        dialogue: s.dialogue || '', dur: Math.min(10, Math.max(4, Number(s.dur) || 5)),
      };
      return { ...shot, ...routeShot(shot, proj), frame: '', video: '', status: '' };
    });
    if (!proj.storyboard.length) throw new Error('模型没有给出可用分镜');
  },

  async frames(proj, tick) {
    if (!hasSkill(proj, 'image')) return;
    const list = proj.storyboard || [];
    let i = 0;
    for (const s of list) {
      i++;
      if (s.frame) continue;
      tick(`生成关键帧 ${i}/${list.length} · 镜头 ${s.n}`, Math.round((i / Math.max(1, list.length)) * 92));
      const style = proj.req?.style ? `${proj.req.style}，` : '';
      try {
        const r = await genImage(`${s.desc}，${s.shot}，${style}电影感画面`, {
          size: proj.req?.ratio === '9:16' ? '720x1280' : '1280x720',
          images: (s.refs || []).slice(0, 1),
          feature: 'agentImage',
        });
        s.frame = r.url; s.status = '';
      } catch (e) { s.status = '帧失败：' + e.message; }
    }
    if (list.length && list.every(s => !s.frame)) throw new Error('关键帧全部生成失败');
  },

  async video(proj, tick) {
    if (!hasSkill(proj, 'video')) return;
    const list = proj.storyboard || [];
    let i = 0;
    for (const s of list) {
      i++;
      if (s.video) continue;
      tick(`生成片段 ${i}/${list.length} · 镜头 ${s.n}`, Math.round((i / Math.max(1, list.length)) * 90));
      try {
        const r = await genVideo(`${s.desc}，${s.camera || ''}`, {
          images: s.videoMode === 'text' ? [] : [...(s.frame ? [s.frame] : []), ...(s.refs || [])],
          duration: s.dur || 5,
          ratio: proj.req?.ratio || '16:9',
          feature: 'agentVideo',
        });
        s.video = r.url; s.status = '';
        store.add('works', { id: uid('w'), title: `${proj.req?.title || '短片'} · 镜头${s.n}`, type: 'video', url: r.url, createdAt: Date.now() });
      } catch (e) {
        s.status = '片段失败：' + e.message;
      }
    }
    if (list.length && list.every(s => !s.video)) throw new Error('镜头视频全部生成失败');
  },

  /* 人工环节：合成在浏览器里跑 ffmpeg.wasm，不放进自动链路 */
  async assemble() { /* 由界面触发，见 studio.js */ },
};

/* ---------------- Agent 状态机 ---------------- */
export class Agent {
  constructor(proj, onChange) {
    this.proj = proj;
    this.onChange = typeof onChange === 'function' ? onChange : () => {};
    proj.agent = proj.agent || {
      mode: 'director', cursor: 0, status: 'idle', approved: {},
      log: [], startedAt: Date.now(), error: '', progress: null,
    };
    /* 老项目补字段 */
    const a = proj.agent;
    a.approved = a.approved || {};
    a.log = a.log || [];
    a.mode = a.mode || 'director';
    a.cursor = Number(a.cursor) || 0;
    a.status = a.status || 'idle';
  }

  get st() { return this.proj.agent; }
  get step() { return STEPS[this.st.cursor]; }

  save() { store.save(); this.onChange(); }

  log(msg, extra = {}) {
    this.st.log.push({ t: Date.now(), step: STEPS[this.st.cursor]?.key, msg, ...extra });
    if (this.st.log.length > 240) this.st.log.splice(0, 80);
  }

  /** 切模式：立刻生效，只影响「下一个关口停不停」，上下文不动 */
  setMode(mode) {
    const m = mode === 'auto' ? 'auto' : 'director';
    if (this.st.mode === m) return this;
    this.st.mode = m;
    this.log(m === 'auto' ? '切换为全自动：后面的关口自动通过' : '切换为导演模式：每个关键节点等你确认');
    const wasWaiting = this.st.status === 'waiting';
    this.save();
    /* 从「等人审」切到全自动 → 立刻接着跑 */
    if (m === 'auto' && wasWaiting) {
      const k = this.st.pending;
      if (k) this.st.approved[k] = true;
      this.st.pending = null;
      this.run();
    }
    return this;
  }

  /** 暂停：不打断正在飞的请求，这一步做完就停（下次从 checkpoint 继续） */
  pause() {
    if (this.st.status !== 'running') return this;
    this.st.paused = true;
    this.log('已请求暂停：当前这一步做完就停');
    this.save();
    return this;
  }

  /** 从当前 checkpoint 续跑；遇到关口或人工环节就停 */
  async run() {
    if (this.st.status === 'running') return;
    this.st.status = 'running';
    this.st.error = '';
    this.save();
    try {
      while (this.st.cursor < STEPS.length) {
        const def = STEPS[this.st.cursor];

        if (this.st.paused) {
          this.st.paused = false;
          this.st.status = 'paused';
          this.save();
          return;
        }

        if (def.manual) {
          this.st.status = DONE[def.key](this.proj) ? 'done' : 'waiting';
          this.st.pending = DONE[def.key](this.proj) ? null : def.key;
          this.save();
          return;
        }

        if (!DONE[def.key](this.proj)) {
          const t0 = Date.now();
          await RUN[def.key](this.proj, (msg, pct) => {
            this.st.progress = { msg, pct };
            this.onChange();
          });
          this.st.progress = null;
          this.log(`完成 · ${((Date.now() - t0) / 1000).toFixed(1)}s`, { ms: Date.now() - t0 });
          this.save();
        }

        /* 关口语义：这一步的产出要不要人先看过 */
        if (def.gate && this.st.mode !== 'auto' && !this.st.approved[def.key]) {
          this.st.status = 'waiting';
          this.st.pending = def.key;
          this.save();
          return;
        }

        this.st.cursor++;

        /* 交付形态决定在哪收尾：只要分镜 / 只要图，就不必再跑后面的视频与合成 */
        const dl = deliverOf(this.proj);
        if ((def.key === 'storyboard' && dl === 'storyboard') || (def.key === 'frames' && dl === 'images')) {
          this.st.status = 'done';
          this.st.pending = null;
          this.save();
          return;
        }

        this.save();
      }
      this.st.status = 'done';
      this.st.pending = null;
      this.save();
    } catch (e) {
      this.st.status = 'error';
      this.st.error = e.message;
      this.st.progress = null;
      this.log('失败：' + e.message, { level: 'error' });
      this.save();
    }
  }

  /** 通过当前关口并继续 */
  approve() {
    const def = STEP_DEFS_get(this.st.pending) || this.step;
    if (def) this.st.approved[def.key] = true;
    this.st.pending = null;
    this.st.status = 'idle';     // 必须是 idle：run() 见到 running 会直接返回
    this.save();
    return this.run();
  }

  /** 重跑当前这一步（清掉它的产物） */
  redo() {
    const def = this.step;
    if (!def) return;
    clearStep(this.proj, def.key);
    this.st.status = 'idle';
    this.save();
    return this.run();
  }

  /** 从某一步重来：后面所有产物一起清掉 */
  rewind(i) {
    for (let k = i; k < STEPS.length; k++) clearStep(this.proj, STEPS[k].key);
    this.st.cursor = i;
    this.st.status = 'idle';
    this.st.pending = null;
    this.st.approved = {};
    this.save();
  }

  /**
   * 自然语言局部调整：只改被点名的镜头，其他镜头连产物都不动。
   * 这条是「已生成的成片可通过自然语言反馈局部重排，而非整体重来」的落点。
   */
  async nudge(text) {
    if (!(this.proj.storyboard || []).length) throw new Error('还没有分镜可改');
    const brief = this.proj.storyboard.map(s => ({
      n: s.n, desc: s.desc, shot: s.shot, camera: s.camera, dialogue: s.dialogue, dur: s.dur,
    }));
    const r = await chat(
      `当前分镜（JSON）：${JSON.stringify(brief)}

用户的修改要求：${text}

只输出 JSON：{"ops":[{"n":镜头号,"patch":{"字段":"新值"}}],"note":"一句话说明改了什么"}
可改字段：${VIDEO_FIELDS.join(' / ')}。只输出真正需要改的镜头，没提到的镜头不要出现在 ops 里。
如果用户要求增加/删除镜头，用 {"ops":[],"note":"说明了原因"} 并保持原样。`,
      { json: true, feature: 'agentText', system: '你是剪辑导演，只做用户明确要求的局部修改，不要顺手改别的镜头。' }
    );
    const ops = Array.isArray(r.ops) ? r.ops : [];
    const changed = [];
    for (const op of ops) {
      const s = this.proj.storyboard.find(x => Number(x.n) === Number(op.n));
      if (!s || !op.patch) continue;
      const before = { ...s };
      for (const k of VIDEO_FIELDS) {
        if (op.patch[k] === undefined) continue;
        s[k] = k === 'dur' ? Math.min(10, Math.max(4, Number(op.patch[k]) || s.dur)) : String(op.patch[k]);
      }
      if (s.desc !== before.desc || s.shot !== before.shot || s.camera !== before.camera) {
        /* 只作废这个镜头自己的产物，别的镜头不动 */
        s.frame = ''; s.video = ''; s.status = '待重生成';
        Object.assign(s, routeShot(s, this.proj));
      }
      changed.push(s.n);
    }
    this.log(`自然语言调整：${r.note || text}${changed.length ? `（镜头 ${changed.join('、')}）` : ''}`);
    this.save();
    return { changed, note: r.note || '', ops };
  }
}

function STEP_DEFS_get(key) { return STEPS.find(s => s.key === key); }

export function clearStep(proj, key) {
  if (key === 'plan') proj.req = null;
  if (key === 'outline') { proj.outline = null; }
  if (key === 'assets') {
    for (const c of [...(proj.outline?.characters || []), ...(proj.outline?.scenes || [])]) c.image = '';
  }
  if (key === 'storyboard') proj.storyboard = [];
  if (key === 'frames') for (const s of proj.storyboard || []) s.frame = '';
  if (key === 'video') for (const s of proj.storyboard || []) s.video = '';
  if (key === 'assemble') proj.film = null;
}

export function newProject(logline) {
  return {
    id: uid('s'), logline, cursor: 0,
    req: null, outline: null, storyboard: [], film: null,
    createdAt: Date.now(),
    agent: { mode: 'director', cursor: 0, status: 'idle', approved: {}, log: [], startedAt: Date.now(), error: '', progress: null },
  };
}
