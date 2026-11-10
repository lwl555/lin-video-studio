/* ============ Agent 技能表 ============
   Agent 先思考，再从这张表里挑这次要用的技能；没选的技能不会白跑。
   ======================================== */
export const SKILLS = [
  { key: 'story', label: '剧本构思', desc: '把创意扩成有起承转合的故事', icon: 'spark' },
  { key: 'character', label: '角色设计', desc: '拆角色、定外貌与性格', icon: 'agent' },
  { key: 'scene', label: '场景设计', desc: '定环境、光线与氛围', icon: 'image' },
  { key: 'storyboard', label: '分镜编排', desc: '拆镜头、景别、运镜、时长', icon: 'film' },
  { key: 'image', label: '图像生成', desc: '出定妆图与关键帧', icon: 'image' },
  { key: 'video', label: '视频生成', desc: '关键帧转镜头片段', icon: 'video' },
  { key: 'voice', label: '配音配乐', desc: '台词配音与配乐（预留）', icon: 'music' },
  { key: 'edit', label: '剪辑合成', desc: '按顺序拼接成片', icon: 'layers' },
];

export const SKILL_MAP = Object.fromEntries(SKILLS.map(s => [s.key, s]));

export function skillLabel(k) { return SKILL_MAP[k]?.label || k; }

/* 给规划器的技能清单（走 JSON，不让模型自由发挥） */
export function skillCatalog() {
  return SKILLS.map(s => `${s.key} = ${s.label}（${s.desc}）`).join('\n');
}

/* 老项目没有 think 时，按「全量视频」处理，保证兼容 */
export function hasSkill(proj, key) {
  const list = proj?.think?.skills;
  if (!Array.isArray(list) || !list.length) return true;
  return list.includes(key);
}

export function deliverOf(proj) {
  return proj?.think?.deliver || 'video';
}
