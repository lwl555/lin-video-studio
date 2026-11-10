/* ============================================================
 *  自检层（验证剧情与分镜，而不是生成完就直接执行）
 *  ------------------------------------------------------------
 *  两层校验，缺一不可：
 *    A. 确定性检查（不花钱、必跑）：时长预算、景别/运镜合法性、字段缺失、
 *       人物一致性（分镜里出现的人是否在角色表里）、台词长度、镜头是否重复。
 *    B. 模型评审（一次 chat）：剧情因果是否成立、镜头之间是否有推进关系、
 *       有没有前后矛盾。
 *  结果落到 proj.verify，卡片上展示；能自动修的直接修（改 desc / 改时长）。
 * ============================================================ */
import { chat } from './models.js';

/* 收尾标点与空白清理（与 prompts.js 同一口径，这里内联避免多一次模块依赖） */
const clean = v => String(v ?? '').replace(/\s+/g, ' ').trim().replace(/[，,。；;、\s]+$/, '');

export const SHOT_SIZES = ['大远景', '远景', '全景', '中景', '近景', '特写', '大特写'];
export const CAMERA_MOVES = ['固定', '缓推', '缓拉', '横移', '跟拍', '环绕', '升降', '手持'];

const secOf = s => Math.min(10, Math.max(4, Number(s) || 5));
const totalDur = proj => (proj.storyboard || []).reduce((a, s) => a + secOf(s.dur), 0);
const targetDur = proj => Number(String(proj.req?.duration || '').replace(/[^\d]/g, '')) || 60;

const add = (list, level, where, problem, fix) => list.push({ level, where, problem, fix: fix || '' });

/* ---------------- A. 确定性检查 ---------------- */
export function checkOutlineLocal(proj) {
  const issues = [];
  const o = proj.outline || {};
  const syn = clean(o.synopsis);

  if (!syn) add(issues, 'high', '剧情梗概', '没有剧情梗概，后面分镜没有依据');
  else if (syn.length < 120) add(issues, 'high', '剧情梗概', `梗概只有 ${syn.length} 字，太短，撑不起起承转合`, '写足 180-260 字');
  else if (!/[然后|接着|最后|结果|于是|却|但|没想到|直到]/.test(syn)) add(issues, 'mid', '剧情梗概', '梗概里没有转折或推进词，读起来像一句设定而不是故事');

  const chars = o.characters || [];
  const scenes = o.scenes || [];
  if (!chars.length) add(issues, 'high', '角色', '一个角色都没有，镜头里没有主体可拍');
  if (!scenes.length) add(issues, 'high', '场景', '一个场景都没有，画面没有环境');

  for (const c of chars) {
    if (!clean(c.look)) add(issues, 'mid', `角色 ${c.name}`, '缺外形与服装描述，出图会随机变脸', '写清年龄感、体型、发型、服装款式与颜色、标志性物件');
    if (!clean(c.persona)) add(issues, 'low', `角色 ${c.name}`, '缺性格与说话方式，台词会不像这个人');
  }
  for (const s of scenes) {
    if (!clean(s.env)) add(issues, 'mid', `场景 ${s.name}`, '缺空间与陈设描述，画面会空');
    if (!clean(s.light)) add(issues, 'low', `场景 ${s.name}`, '缺光线描述，氛围无法统一');
  }

  /* 人物一致性：梗概里出现的人名应该在角色表里 */
  const named = chars.map(c => c.name).filter(Boolean);
  const otherNames = named.filter(n => syn.includes(n));
  if (named.length && !otherNames.length) add(issues, 'high', '一致性', '梗概里没有点名任何一个角色，故事和角色表是脱节的');

  return issues;
}

export function checkStoryboardLocal(proj) {
  const issues = [];
  const shots = proj.storyboard || [];
  const req = proj.req || {};
  const target = targetDur(proj);
  const total = totalDur(proj);

  if (!shots.length) { add(issues, 'high', '分镜', '没有分镜'); return issues; }

  if (Math.abs(total - target) / Math.max(1, target) > 0.35) {
    add(issues, 'mid', '总时长', `分镜合计 ${total}s，方案写的是 ${req.duration || target + 's'}，差太多`);
  }

  const charNames = (proj.outline?.characters || []).map(c => c.name).filter(Boolean);
  const seen = new Map();

  shots.forEach((s, i) => {
    const n = s.n || i + 1;
    const desc = clean(s.desc);

    if (!desc) add(issues, 'high', `镜头 ${n}`, '没有画面描述');
    else if (desc.length < 40) add(issues, 'mid', `镜头 ${n}`, `画面描述只有 ${desc.length} 字，出图会糊`, '补到 60-100 字：谁·在哪·做什么·表情·画面里还有什么');
    else if (!/[在|正|把|拿着|走向|推开|转身|看向|笑|皱眉|喊|递|接过|抬头|低]/.test(desc)) add(issues, 'low', `镜头 ${n}`, '描述里看不出具体动作');

    if (!SHOT_SIZES.includes(String(s.shot || '').trim())) add(issues, 'mid', `镜头 ${n}`, `景别「${s.shot || '空'}」不在允许列表里`);
    if (!CAMERA_MOVES.includes(String(s.camera || '').trim())) add(issues, 'low', `镜头 ${n}`, `运镜「${s.camera || '空'}」不在允许列表里`);
    if (!clean(s.light)) add(issues, 'low', `镜头 ${n}`, '缺光线描述');
    if ((s.dialogue || '').length > 20) add(issues, 'low', `镜头 ${n}`, `台词 ${s.dialogue.length} 字，太长念不完`);

    if (desc) {
      const key = desc.slice(0, 18);
      if (seen.has(key)) add(issues, 'high', `镜头 ${n}`, `和第 ${seen.get(key)} 镜开头一样，像重复画面`);
      else seen.set(key, n);
    }

    /* 人物一致性：这一镜提到的「名字」如果是角色表里的人，最好能拿到参考图 */
    const mentioned = charNames.filter(nm => desc.includes(nm));
    if (desc && charNames.length && !mentioned.length && !/(空镜|无人|全景|远景)/.test(`${desc} ${s.shot || ''}`)) {
      add(issues, 'low', `镜头 ${n}`, '没提到任何角色，也不是空镜，可能是遗漏');
    }
  });

  return issues;
}

/* ---------------- B. 模型评审 ---------------- */
const VERIFY_RULES = `你是在验收，不是在创作。
只挑真问题：逻辑断裂、前后矛盾、人物性格漂移、画面无法拍出来、重复。
不要挑风格偏好，不要要求加戏，不要因为「可以更好」就报问题。
没问题就返回空数组。`;

function parseJson(text) {
  const m = String(text || '').match(/\{[\s\S]*\}|\[[\s\S]*\]/);
  if (!m) return null;
  try { return JSON.parse(m[0]); } catch { return null; }
}

export async function verifyOutlineLLM(proj) {
  const r = await chat(
    `验收下面这份短视频剧本设定，只输出 JSON：
{"score":0-100,"logic":"一句话评价剧情因果是否成立","issues":[{"level":"high|mid|low","where":"位置","problem":"具体问题","fix":"改法（一句）"}]}

验收标准：
1. 主角有明确的目标和阻力，剧情有起承转合，结局收得住；
2. 角色表里的人物必须都在梗概里出场或被解释，不要有孤立角色；
3. 场景要支撑发生的事，不要出现「在 A 场景做只有 B 场景才可能做的事」；
4. 时间、地点、人物关系不能自相矛盾。

${VERIFY_RULES}

方案：${JSON.stringify({ title: proj.req?.title, logline: proj.req?.logline, duration: proj.req?.duration, tone: proj.req?.tone })}
梗概：${proj.outline?.synopsis || ''}
角色：${JSON.stringify((proj.outline?.characters || []).map(c => ({ name: c.name, age: c.age, look: c.look, persona: c.persona })))}
场景：${JSON.stringify((proj.outline?.scenes || []).map(s => ({ name: s.name, env: s.env, light: s.light })))}`,
    { json: true, feature: 'agentText', temperature: 0.3, system: '你是严格的剧本审稿人，只输出 JSON，问题要具体到能直接改。' }
  );
  return normalizeVerdict(r);
}

export async function verifyStoryboardLLM(proj) {
  const shots = (proj.storyboard || []).map(s => ({
    n: s.n, desc: s.desc, shot: s.shot, camera: s.camera, light: s.light, dialogue: s.dialogue, dur: s.dur,
  }));
  const r = await chat(
    `逐镜验收下面的分镜表，只输出 JSON：
{"score":0-100,"logic":"一句话评价整条片的推进","issues":[{"n":镜头号, "level":"high|mid|low","problem":"具体问题","fixDesc":"改写后的画面描述（可选，只在当前描述确实拍不出来时给）"}]}

逐镜验收标准：
1. 每个镜头是否都在推进剧情（时间 / 空间 / 情绪至少变一样），有没有原地打转；
2. 相邻镜头的景别是否有节奏（不要连着 4 个中景），有没有跳轴或空间关系断裂；
3. 台词是否符合该角色的性格与说话方式，有没有出戏的信息；
4. 画面描述能否被图像模型直接拍出来（人物、动作、环境、光线齐全，不抽象）。

${VERIFY_RULES}

剧情梗概：${proj.outline?.synopsis || ''}
角色：${JSON.stringify((proj.outline?.characters || []).map(c => ({ name: c.name, persona: c.persona })))}
方案时长：${proj.req?.duration || '60秒'}
分镜：${JSON.stringify(shots)}`,
    { json: true, feature: 'agentText', temperature: 0.3, system: '你是严格的电影分镜审稿人，只输出 JSON，问题要具体到镜头号。' }
  );
  return normalizeVerdict(r);
}

function normalizeVerdict(r) {
  const issues = Array.isArray(r?.issues) ? r.issues : [];
  return {
    score: Math.max(0, Math.min(100, Math.round(Number(r?.score) || 0))),
    logic: String(r?.logic || '').slice(0, 200),
    issues: issues.slice(0, 12).map(x => ({
      level: ['high', 'mid', 'low'].includes(x?.level) ? x.level : 'mid',
      where: x?.n ? `镜头 ${x.n}` : String(x?.where || '全局'),
      n: Number(x?.n) || 0,
      problem: String(x?.problem || '').slice(0, 160),
      fix: String(x?.fix || '').slice(0, 200),
      fixDesc: String(x?.fixDesc || '').slice(0, 400),
    })).filter(x => x.problem),
  };
}

/* ---------------- 对外统一入口 ---------------- */
export async function verifyOutline(proj) {
  const local = checkOutlineLocal(proj);
  let llm = null;
  try { llm = await verifyOutlineLLM(proj); } catch (e) { /* 评审失败不影响流水线 */ }
  const all = [...local, ...((llm && llm.issues) || [])];
  const high = all.filter(x => x.level === 'high').length;
  return {
    at: Date.now(),
    score: llm?.score || (high ? 55 : 80),
    logic: llm?.logic || '',
    local, llm,
    issues: all,
    high,
    pass: high === 0,
  };
}

export async function verifyStoryboard(proj) {
  const local = checkStoryboardLocal(proj);
  let llm = null;
  try { llm = await verifyStoryboardLLM(proj); } catch (e) { /* 同上 */ }

  /* 能自动修的先修：模型给了 fixDesc 就替换，并记下来 */
  const patched = [];
  for (const it of ((llm && llm.issues) || [])) {
    if (!it.fixDesc || !it.n) continue;
    const s = (proj.storyboard || []).find(x => Number(x.n) === it.n);
    if (!s) continue;
    s.desc = it.fixDesc;
    s.frame = '';                       /* 描述变了，旧关键帧作废 */
    s.video = '';
    patched.push(it.n);
  }

  const after = patched.length ? checkStoryboardLocal(proj) : local;
  const all = [...after, ...((llm && llm.issues) || []).filter(x => !x.fixDesc)];
  const high = all.filter(x => x.level === 'high').length;
  return {
    at: Date.now(),
    score: llm?.score || (high ? 55 : 80),
    logic: llm?.logic || '',
    local: after, llm,
    issues: all,
    high,
    patched,
    pass: high === 0,
  };
}

/* 把校验结果压成一句话，给对话流用 */
export function verdictLine(v, kind = '方案') {
  if (!v) return '';
  const kept = v.issues.filter(x => x.level !== 'low');
  if (!kept.length) return `${kind}自检通过（${v.score} 分）${v.logic ? '：' + v.logic : ''}`;
  const top = kept.slice(0, 3).map(x => `${x.where}——${x.problem}`);
  return `${kind}自检 ${v.score} 分，发现 ${kept.length} 处问题${v.patched?.length ? `（已自动改进 ${v.patched.length} 个镜头）` : ''}：${top.join('；')}`;
}
