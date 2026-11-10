/* ============ 提示词工程 ============
   模型给的画面描述通常只有一句话（「小福端着蛋炒饭」），原样丢给图像 / 视频模型必然糊：
   主体、环境、光线、景别、质感全靠模型自己猜。这一步负责把分镜字段拼成结构化长提示词，
   让「一句话描述 → 可执行的画面指令」。

   两条路径：
   1) 本地拼装（默认，零成本、稳定）：desc + 景别 + 运镜 + 光线 + 氛围 + 风格 + 画质。
   2) AI 扩写（用户点「AI 优化」时走）：把一句创意扩成 100-200 字的连贯画面描述。
   ==================================== */
import { chat } from './models.js';

const FALLBACK_STYLE = '写实电影感';

/* 画质 / 负面词：短、通用，不给模型添乱 */
const QUALITY = '电影级画质，构图完整，主体清晰，细节丰富，景深自然，无文字无字幕无水印';
const MOTION_Q = '动作连贯自然，人物比例正常，画面稳定不抖动，无文字无字幕';

/* 收尾标点统一去掉，否则拼起来会出现「外卖单。，景别：」这种双标点 */
const clean = v => String(v ?? '').replace(/\s+/g, ' ').trim().replace(/[，,。；;、\s]+$/, '');

/* 拼句：去空、去重复、用中文逗号连接 */
function join(...parts) {
  const seen = new Set();
  return parts
    .map(clean)
    .filter(Boolean)
    .filter(p => {
      const k = p.replace(/[，,。\s]/g, '');
      if (seen.has(k)) return false;
      seen.add(k);
      return true;
    })
    .join('，');
}

/* ============================================================
   角色 / 场景设定图：三视图 + 细节图
   ------------------------------------------------------------
   单个角色只出一张正面图，后续镜头无法稳定复用（侧面、背面全靠模型猜），
   所以按「三视图设定表 + 细节拼版」出两张，并把项目风格贯通进去。
   ============================================================ */

const styleOf = req => clean(req?.style) || FALLBACK_STYLE;

/** 角色三视图：左正面 / 中侧面 / 右背面，全身等高并排，白底 —— 后续镜头的稳定参考 */
export function charPrompt(c, req) {
  return join(
    `角色三视图设定表：${c.name || '主角'}`,
    c.age ? `年龄感：${c.age}` : '',
    c.look ? `外形与服装：${c.look}` : '',
    c.persona ? `气质与神态：${c.persona}` : '',
    '同一个角色的并排三视图：左侧正面全身、中间侧面全身、右侧背面全身，三张等高同比例、脚底线对齐、站姿一致',
    '纯白背景，柔和均匀棚拍光，无投影无地面',
    '服装层次、面料纹理、发型走向、鞋履与配饰细节清晰可辨',
    '写实人体比例准确，五官结构完整，双手五指正确',
    `整体视觉风格：${styleOf(req)}`,
    '不要文字标注，不要边框，不要多余人物，不要拼贴海报排版'
  );
}

/** 角色细节图：面部 / 服装材质 / 发型配饰 / 标志道具 四格特写 */
export function charDetailPrompt(c, req) {
  return join(
    `角色细节特写：${c.name || '主角'}`,
    c.age ? `年龄感：${c.age}` : '',
    c.look ? `外形与服装：${c.look}` : '',
    c.persona ? `气质与神态：${c.persona}` : '',
    '四格细节拼版：左上为面部五官与妆容特写，右上为服装材质与褶皱特写，左下为发型与配饰特写，右下为随身标志道具特写',
    '每格都是近距离特写，浅景深，细节锐利，纯白背景，柔光',
    `整体视觉风格：${styleOf(req)}`,
    '不要文字标注，不要边框，不要全景，不要多余人物'
  );
}

/** 场景全景：无人物，把空间、陈设、光线讲清楚 */
export function scenePrompt(c, req) {
  return join(
    `场景设定图：${c.name || '主场景'}`,
    c.env ? `空间与陈设：${c.env}` : '',
    c.light ? `光线：${c.light}` : '',
    '广角全景，画面中无人物，透视正确，纵深层次清楚',
    '墙地顶的材质、家具陈设的做工、年代感细节丰富',
    `整体视觉风格：${styleOf(req)}`,
    '电影级打光，不要文字，不要水印'
  );
}

/** 场景细节图：陈设 / 材质 / 光源 四格特写 */
export function sceneDetailPrompt(c, req) {
  return join(
    `场景细节特写：${c.name || '主场景'}`,
    c.env ? `空间与陈设：${c.env}` : '',
    c.light ? `光线：${c.light}` : '',
    '四格细节拼版：左上为主要陈设的近景特写，右上为墙面或地面材质特写，左下为关键道具特写，右下为光源与影调特写',
    '近距离特写，浅景深，材质纹理锐利',
    `整体视觉风格：${styleOf(req)}`,
    '画面中无人物，不要文字标注，不要边框'
  );
}

/** 关键帧提示词：一句画面描述 → 一整套出图指令 */
export function imagePrompt(s, proj) {
  const req = proj?.req || {};
  const base = clean(s?.prompt) || clean(s?.desc) || '电影感画面';
  return join(
    base,
    s?.shot ? `景别：${s.shot}` : '',
    s?.camera ? `机位与运镜：${s.camera}` : '',
    s?.light ? `光线：${s.light}` : '',
    req.tone ? `情绪氛围：${req.tone}` : '',
    `视觉风格：${req.style || FALLBACK_STYLE}`,
    QUALITY
  );
}

/** 镜头视频提示词：重「动」，把动作、运镜、节奏、声音一并交代 */
export function videoPrompt(s, proj) {
  const req = proj?.req || {};
  return join(
    clean(s?.videoPrompt) || clean(s?.desc) || '镜头内的主体自然运动',
    s?.camera ? `运镜：${s.camera}` : '',
    s?.shot ? `景别：${s.shot}` : '',
    s?.light ? `光线：${s.light}` : '',
    s?.sound ? `声音：${s.sound}` : '',
    req.tone ? `氛围：${req.tone}` : '',
    req.style ? `风格：${req.style}` : '',
    MOTION_Q
  );
}

/* ---------------- AI 扩写（用户手动点「AI 优化」） ---------------- */
export async function optimizePrompt(raw, { kind = 'image', ratio = '16:9', style = '', tone = '' } = {}) {
  const text = clean(raw);
  if (!text) throw new Error('先写一点画面描述');
  const isVid = kind === 'video';
  const spec = isVid
    ? `prompt 要求：中文，130-200 字，按「主体与动作 → 环境与光线 → 运镜与节奏 → 氛围与风格」的顺序写成一段连贯描述；写清镜头怎么动、主体怎么动；不要分点、不要列表、不要加引号、不要出现"画面描述/提示词"这类元话术；不要字幕与文字元素。`
    : `prompt 要求：中文，110-180 字，按「主体与动作 → 环境与陈设 → 光线与色调 → 景别与构图 → 风格与质感」的顺序写成一段连贯描述；具体到服装、材质、天气、光影方向；不要分点、不要列表、不要加引号、不要出现"画面描述/提示词"这类元话术；不要字幕与文字元素。`;

  const r = await chat(
    `把下面这段创意扩写成可以直接喂给${isVid ? '视频' : '图像'}模型的详细提示词。
画幅：${ratio}${style ? `；风格倾向：${style}` : ''}${tone ? `；情绪基调：${tone}` : ''}
原始描述：${text}

只输出 JSON：{"prompt":"扩写后的完整提示词"}
${spec}`,
    {
      json: true,
      feature: 'agentText',
      temperature: 0.7,
      system: '你是电影级提示词工程师，擅长把一句话扩成信息密度高、可直接执行的画面描述。句子要通顺，只输出 JSON，不要解释。',
    }
  );
  const p = clean(r && (r.prompt || r.text || r.result));
  if (!p || p.length < 20) throw new Error('模型没给出有效提示词，稍后重试');
  return p;
}
