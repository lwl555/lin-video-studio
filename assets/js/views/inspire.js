/* ============ 灵感 / 发现 ============ */
import { h, toast } from '../ui.js';
import { icon } from '../icons.js';
import { go } from '../app.js';

const CASES = [
  { t: '折梅听风 · 古风一镜到底', tag: '短剧', ic: 'video', meta: '9:16 · 12s',
    p: '古风庭院，白衣女子立于梅树下，伸手折下一枝寒梅。镜头从背后缓慢环绕至正面，雪花飘落，衣袂翻动，环境音：风声与远处古琴，电影感，冷色调。' },
  { t: '御膳房来了个外卖员', tag: '轻喜剧', ic: 'video', meta: '16:9 · 30s',
    p: '现代外卖员穿越到古代御膳房，穿着冲锋衣、背着保温箱，一脸茫然地站在古色古香的厨房里，周围宫女太监惊讶围观。中景，暖黄烛光，喜剧氛围。' },
  { t: '海边露营 · 蓝调时刻', tag: '氛围片', ic: 'video', meta: '16:9 · 8s',
    p: '海边露营地，米白色帐篷亮起温暖灯光，远处海面进入蓝调时刻，天空出现少量星星。镜头从露营地缓慢向后拉远，海风吹动草叶，加入自然海浪声，安静治愈。' },
  { t: '雨夜中式茶馆', tag: '广告', ic: 'video', meta: '9:16 · 15s',
    p: '雨夜的中式茶馆，穿深色风衣的女子推门进入。镜头从门口缓慢推进，暖黄色灯光映在湿漉漉的地面，雨水沿屋檐成串滴落，电影感，人物动作自然。' },
  { t: '云上天宫 · 仙侠开场', tag: '短剧', ic: 'video', meta: '16:9 · 10s',
    p: '云雾缭绕的悬浮天宫，玉石台阶通向巨大牌坊，仙鹤掠过云海。镜头从云层中穿出向上飞升，金光洒落，恢弘仙侠感，史诗级运镜。' },
  { t: '像素风 · 闯关小剧场', tag: '动画', ic: 'video', meta: '1:1 · 6s',
    p: '8-bit 像素风格，小骑士在横向卷轴关卡中奔跑跳跃，躲避尖刺与飞行的蝙蝠，收集金币。复古游戏画面，明快配色，循环动画。' },
  { t: '产品开箱 · 竖屏种草', tag: '电商', ic: 'video', meta: '9:16 · 20s',
    p: '纯色浅灰背景，双手拆开极简白色包装盒，取出产品缓慢旋转展示。柔和顶光，产品细节特写与整体中景交替，干净高级的电商质感。' },
  { t: '水墨国风 · 山雨欲来', tag: '国风', ic: 'video', meta: '16:9 · 9s',
    p: '水墨画风格，群山层叠，乌云压顶，一叶扁舟在江面缓行。镜头缓慢横移，墨色晕染扩散，留白写意，中国山水画意境。' }
];

const STYLES = ['写实电影感', '2D 日式动画', '3D 皮克斯', '水墨国风', '美式漫画', '像素风', '儿童蜡笔手绘',
  '赛博朋克霓虹', '复古胶片', '大友克洋风', '清冷病弱系东亚', '中国神话风', '黏土定格', '低多边形',
  '黑白二维漫画', '宫崎骏治愈', '蒸汽波', '废土末日', '洛丽塔轻小说', '厚涂油画'];

export function render(root) {
  const page = h('div', { class: 'page' });
  root.append(page);

  page.append(h('div', {},
    h('div', { class: 'page-title' }, '灵感'),
    h('div', { class: 'page-sub' }, '看看别人怎么做的 —— 复制提示词，或直接在它的基础上二次创作')));

  page.append(h('div', { class: 'section-title' }, '精选案例'));
  page.append(h('div', { class: 'flow-grid' }, ...CASES.map(c => h('div', { class: 'flow-card' },
    h('div', { class: 'flow-thumb' }, h('div', { class: 'flow-ph', html: icon(c.ic, 36) }), h('span', { class: 'flow-badge' }, c.tag)),
    h('div', { class: 'flow-body' },
      h('div', { class: 'flow-title' }, c.t),
      h('div', { class: 'flow-meta' }, c.meta),
      h('div', { style: { display: 'flex', gap: '6px', marginTop: '8px' } },
        h('button', { class: 'node-btn', onclick: () => navigator.clipboard?.writeText(c.p).then(() => toast('提示词已复制', 'ok')) }, '复制提示词'),
        h('button', { class: 'node-btn', onclick: () => go('home', {}) }, '去创作'),
        h('button', { class: 'node-btn primary', onclick: () => go('studio', { prompt: c.p }) }, 'Remix')))))));

  page.append(h('div', { class: 'section-title' }, '风格库'));
  page.append(h('div', { class: 'chip-row', style: { width: '100%', marginTop: '0' } },
    ...STYLES.map(s => h('button', { class: 'chip', onclick: () => navigator.clipboard?.writeText(s).then(() => toast(`已复制风格：${s}`, 'ok')) }, s))));
}
