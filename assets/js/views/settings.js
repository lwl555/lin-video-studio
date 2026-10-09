/* ============ 模型接入 & 设置 ============ */
import { h, $, toast, modal, confirm, download } from '../ui.js';
import { store, auth, uid, ADMIN } from '../store.js';
import { providers, PRESETS, TYPE_LABEL, testProvider } from '../models.js';

export function render(root) {
  const page = h('div', { class: 'page', style: { maxWidth: '920px' } });
  root.append(page);

  page.append(h('div', {},
    h('div', { class: 'page-title' }, '模型接入'),
    h('div', { class: 'page-sub' }, '平台不自带模型 —— 填你自己的 Base URL 和 API Key，全部只保存在这台电脑的浏览器里')));

  /* ---- 预设 ---- */
  const presetRow = h('div', { class: 'preset-row' });
  for (const p of PRESETS) {
    presetRow.append(h('button', { class: 'chip', onclick: () => quickAdd(p) },
      `${TYPE_LABEL[p.type]} · ${p.name}`));
  }
  page.append(h('div', { class: 'section-title' }, '快速添加'), presetRow);

  /* ---- 已接入 ---- */
  const listBox = h('div', {});
  page.append(h('div', { class: 'section-title' }, '已接入的模型'), listBox);

  function drawList() {
    listBox.innerHTML = '';
    const all = providers.all();
    if (!all.length) {
      listBox.append(h('div', { class: 'empty' }, h('div', { class: 'empty-icon' }, '🔌'),
        '还没有接入任何模型', h('div', { class: 'hint' }, '点上面的预设，或点下面「自定义接入」')));
    }
    for (const p of all) {
      const keyInput = h('input', { class: 'form-input', type: 'password', value: p.apiKey || '', placeholder: 'sk-...' });
      const card = h('div', { class: 'provider-card' },
        h('div', { class: 'provider-head' },
          h('div', { class: 'provider-name' }, h('span', { class: 'status-dot' + (p.enabled !== false ? ' on' : '') }), p.name,
            h('span', { class: 'tag' }, TYPE_LABEL[p.type])),
          h('button', { class: 'node-btn', onclick: async e => {
            e.currentTarget.textContent = '测试中…';
            const r = await testProvider(p);
            e.currentTarget.textContent = '测试';
            toast(r.msg, r.ok ? 'ok' : 'err', 4500);
          } }, '测试'),
          h('button', { class: 'node-btn', onclick: () => { providers.update(p.id, { enabled: p.enabled === false }); drawList(); } },
            p.enabled === false ? '启用' : '停用'),
          h('button', { class: 'node-btn', onclick: async () => {
            if (await confirm(`删除「${p.name}」？`)) { providers.remove(p.id); drawList(); }
          } }, '删除')),
        h('div', { class: 'form-row' },
          h('div', { class: 'form-group' }, h('label', { class: 'form-label' }, 'Base URL'),
            h('input', { class: 'form-input', value: p.baseUrl || '', placeholder: 'https://api.example.com/v1',
              oninput: e => providers.update(p.id, { baseUrl: e.target.value }) })),
          h('div', { class: 'form-group' }, h('label', { class: 'form-label' }, '模型名'),
            h('input', { class: 'form-input', value: p.model || '', placeholder: 'model-name',
              oninput: e => providers.update(p.id, { model: e.target.value }) }))),
        h('div', { class: 'form-group' }, h('label', { class: 'form-label' }, 'API Key'),
          h('div', { class: 'input-wrap' }, keyInput,
            h('button', { class: 'eye-btn', onclick: () => { keyInput.type = keyInput.type === 'password' ? 'text' : 'password'; } }, '显示')),
          h('div', { class: 'hint' }, 'Key 保存在本机 localStorage，不会上传到任何服务器（除非你开了下面的后端代理）。')));

      if (p.type === 'video') {
        card.append(h('div', { class: 'form-row' },
          h('div', { class: 'form-group' }, h('label', { class: 'form-label' }, '提交路径'),
            h('input', { class: 'form-input', value: p.submitPath || '/video/generations',
              oninput: e => providers.update(p.id, { submitPath: e.target.value }) })),
          h('div', { class: 'form-group' }, h('label', { class: 'form-label' }, '查询路径'),
            h('input', { class: 'form-input', value: p.queryPath || '/video/status',
              oninput: e => providers.update(p.id, { queryPath: e.target.value }) }))));
      }
      keyInput.addEventListener('input', () => providers.update(p.id, { apiKey: keyInput.value }));
      listBox.append(card);
    }
  }

  function quickAdd(preset) {
    if (providers.all().some(x => x.name === preset.name && x.baseUrl === preset.baseUrl)) return toast('这个模型已经加过了', 'err');
    providers.add({ name: preset.name, type: preset.type, baseUrl: preset.baseUrl, model: preset.model, apiKey: '' });
    drawList(); toast('已添加，填入 API Key 即可用', 'ok');
  }

  const customForm = h('div', { class: 'provider-card' },
    h('div', { class: 'provider-name', style: { marginBottom: '12px' } }, '自定义接入'),
    h('div', { class: 'form-row-3' },
      (() => { const i = h('input', { class: 'form-input', placeholder: '名称，如 我的中转' }); i.id = 'cf-name'; return h('div', { class: 'form-group' }, h('label', { class: 'form-label' }, '名称'), i); })(),
      (() => {
        const s = h('select', { class: 'form-select' }); s.id = 'cf-type';
        Object.entries(TYPE_LABEL).forEach(([k, v]) => s.append(h('option', { value: k }, v)));
        return h('div', { class: 'form-group' }, h('label', { class: 'form-label' }, '类型'), s);
      })(),
      (() => { const i = h('input', { class: 'form-input', placeholder: 'model-name' }); i.id = 'cf-model'; return h('div', { class: 'form-group' }, h('label', { class: 'form-label' }, '模型名'), i); })()),
    (() => { const i = h('input', { class: 'form-input', placeholder: 'https://api.example.com/v1' }); i.id = 'cf-url'; return h('div', { class: 'form-group' }, h('label', { class: 'form-label' }, 'Base URL（OpenAI 兼容格式）'), i); })(),
    (() => { const i = h('input', { class: 'form-input', type: 'password', placeholder: 'sk-...' }); i.id = 'cf-key'; return h('div', { class: 'form-group' }, h('label', { class: 'form-label' }, 'API Key'), i); })(),
    h('button', { class: 'btn-primary', onclick: () => {
      const name = $('#cf-name').value.trim(), type = $('#cf-type').value, model = $('#cf-model').value.trim();
      const baseUrl = $('#cf-url').value.trim(), apiKey = $('#cf-key').value;
      if (!name || !baseUrl || !model) return toast('名称 / URL / 模型名都要填', 'err');
      providers.add({ name, type, model, baseUrl, apiKey });
      drawList(); toast('已添加', 'ok');
      ['cf-name', 'cf-model', 'cf-url', 'cf-key'].forEach(id => $('#' + id).value = '');
    } }, '添加到我的模型'));

  page.append(h('div', { class: 'section-title' }, '自定义接入'), customForm);

  /* ---- 后端代理 ---- */
  const px = store.state.proxy;
  const pxUrl = h('input', { class: 'form-input', value: px.url || '', placeholder: 'https://xxxx.functions.supabase.co/pavo-proxy' });
  const pxAnon = h('input', { class: 'form-input', type: 'password', value: px.anon || '', placeholder: 'anon key（可选）' });
  const pxEnable = h('input', { type: 'checkbox', checked: !!px.enabled });

  page.append(h('div', { class: 'section-title' }, '后端代理（可选）'),
    h('div', { class: 'provider-card' },
      h('div', { class: 'hint', style: { marginTop: '0', marginBottom: '14px' } },
        '浏览器直连模型 API 时常会被 CORS 拦。填一个 Supabase Edge Function 地址后，请求会经它转发，顺带还能把素材存进 Supabase Storage。'),
      h('div', { class: 'form-group' }, h('label', { class: 'form-label' }, '代理地址'), pxUrl),
      h('div', { class: 'form-group' }, h('label', { class: 'form-label' }, 'anon key'), pxAnon),
      h('label', { class: 'f-check', style: { marginBottom: '14px' } }, pxEnable, h('span'), '启用后端代理'),
      h('button', { class: 'btn-ghost', onclick: () => {
        store.set({ proxy: { url: pxUrl.value.trim(), anon: pxAnon.value.trim(), enabled: pxEnable.checked } });
        toast('已保存', 'ok');
      } }, '保存代理配置')));

  /* ---- 账号与数据 ---- */
  const u = auth.user;
  page.append(h('div', { class: 'section-title' }, '账号与数据'),
    h('div', { class: 'provider-card' },
      h('div', { class: 'provider-head' },
        h('span', { class: 'avatar' }, u.nick.slice(0, 1)),
        h('div', { class: 'provider-name', style: { flexDirection: 'column', alignItems: 'flex-start', gap: '2px' } },
          h('span', {}, u.nick),
          h('span', { class: 'hint', style: { marginTop: '0' } }, `${u.account} · ${u.role === 'admin' ? '管理员' : '创作者'}`))),
      h('div', { style: { display: 'flex', gap: '10px', flexWrap: 'wrap' } },
        h('button', { class: 'btn-ghost', onclick: () => {
          const data = store.state;
          const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
          download(URL.createObjectURL(blob), `lin-studio-backup-${new Date().toISOString().slice(0, 10)}.json`);
        } }, '导出全部数据'),
        h('button', { class: 'btn-ghost', onclick: importData }, '导入数据'),
        h('button', { class: 'btn-ghost btn-danger', onclick: async () => {
          if (await confirm('清空所有本地数据（项目 / 资产 / 作品 / 模型配置）？此操作不可撤销。')) {
            const keep = store.state.session;
            store.reset(); store.set({ session: keep });
            toast('已清空', 'ok'); location.reload();
          }
        } }, '清空数据'))));

  if (auth.isAdmin) page.append(h('div', { class: 'hint' }, `管理员内置账号：${ADMIN.account} · 昵称「${ADMIN.nick}」`));

  drawList();
}

function importData() {
  const inp = h('input', { type: 'file', accept: 'application/json', style: { display: 'none' } });
  inp.addEventListener('change', async () => {
    const f = inp.files?.[0]; if (!f) return;
    try {
      const j = JSON.parse(await f.text());
      const sess = store.state.session;
      store.set({ ...j, session: sess });
      toast('导入成功', 'ok'); setTimeout(() => location.reload(), 600);
    } catch (e) { toast('文件格式不对：' + e.message, 'err'); }
  });
  document.body.append(inp); inp.click();
  setTimeout(() => inp.remove(), 1000);
}
