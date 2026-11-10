/* ============================================================
 *  联系客服：统一的弹窗 + 二维码
 *  登录页 / 授权提醒 / 配额用尽 / 管理后台都能复用同一套
 * ============================================================ */
import { h, modal, toast } from './ui.js';

export const SUPPORT_NAME = '零遇';
export const SUPPORT_QR = 'assets/img/kefu.jpg';

/* 复制到剪贴板（http 环境 / 老浏览器都有兜底） */
export async function copyText(text) {
  const s = String(text || '');
  if (!s) return false;
  try {
    if (navigator.clipboard && window.isSecureContext) {
      await navigator.clipboard.writeText(s);
      return true;
    }
  } catch { /* 落到下面的兜底 */ }
  try {
    const ta = document.createElement('textarea');
    ta.value = s;
    ta.setAttribute('readonly', '');
    ta.style.cssText = 'position:fixed;top:-9999px;opacity:0';
    document.body.append(ta);
    ta.select();
    const ok = document.execCommand('copy');
    ta.remove();
    return ok;
  } catch { return false; }
}

/**
 * 打开客服弹窗
 * @param {object} opt
 * @param {string} opt.reason  顶部说明，例如「账号还没开通，加我微信帮你开」
 * @param {string} opt.account 需要一起复制给客服的账号
 * @param {string} opt.title   弹窗标题
 */
export function openSupport({ reason = '', account = '', title = '联系客服' } = {}) {
  const copyPayload = [account && `账号：${account}`, reason].filter(Boolean).join('\n');

  const acts = [];
  if (account) {
    acts.push(h('button', {
      class: 'btn-ghost', onclick: async () => {
        const ok = await copyText(copyPayload || account);
        toast(ok ? '已复制，粘贴给客服就行' : '复制失败，手动打字吧', ok ? 'ok' : 'err');
      }
    }, '复制我的账号'));
  }
  acts.push(h('button', {
    class: 'btn-ghost', onclick: async () => {
      const ok = await copyText(SUPPORT_NAME);
      toast(ok ? `已复制「${SUPPORT_NAME}」` : '复制失败', ok ? 'ok' : 'err');
    }
  }, `复制客服微信`));

  const m = modal({
    title,
    body: h('div', { class: 'support-box' },
      reason ? h('div', { class: 'support-reason' }, reason) : null,
      h('div', { class: 'support-qr' },
        h('img', { src: SUPPORT_QR, alt: '客服微信二维码', loading: 'lazy' })),
      h('div', { class: 'support-title' }, `微信扫一扫，添加「${SUPPORT_NAME}」`),
      h('div', { class: 'support-sub' },
        account ? `添加时备注账号 ${account}，通过更快；也可以直接截图二维码用微信识别。`
          : '可以直接扫这个二维码添加，也可以截图后用微信识别。'),
      h('div', { class: 'support-acts' }, ...acts)),
    foot: [
      h('button', { class: 'btn-primary', onclick: () => m.close() }, '知道了')
    ]
  });
  return m;
}

/* 登录页角落那个小按钮，点开同样弹窗 */
export function supportLink(label = '联系客服', opt = {}) {
  return h('button', { class: 'link-btn', type: 'button', onclick: () => openSupport(opt) }, label);
}

/* 管理后台里的「邀请卡片」文案模板，供管理员复制发人 */
export function inviteMessage(code, extra, days) {
  return [
    '林的工作台 · 邀请你开通账号',
    '',
    `邀请码：${code}`,
    `注册时填这个码即可直接开通，不用等审核；额外每天多 ${extra} 次额度，有效期 ${days} 天。`,
    '',
    '地址：https://lwl555.github.io/lin-video-studio/'
  ].join('\n');
}
