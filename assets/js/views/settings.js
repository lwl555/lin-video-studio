/* ============ 设置 ============ */
import { h, $, toast, modal, confirm, download, imgErr } from '../ui.js';
import { icon } from '../icons.js';
import { store, auth, uid, ADMIN } from '../store.js';
import { testBackend, providers, PRESETS, TYPE_LABEL } from '../models.js';
import { usageReport, clearOldest, clearKind, clearAllMedia, compressAllImages, fmtMB, fmtKB } from '../storage.js';

export function render(root) {
  const page = h('div', { class: 'page', style: { maxWidth: '920px' } });
  root.append(page);

  page.append(h('div', {},
    h('div', { class: 'page-title' }, '设置'),
    h('div', { class: 'page-sub' }, 'AI 后台由平台统一接入并维护，开箱即用；你也可以额外接入自己的模型（可选）')));

  /* ---- AI 后台服务（唯一可操作项：开 / 关） ---- */
  const on = () => { const b = store.state.backend; return b ? b.enabled !== false : true; };
  const statusLine = h('div', { class: 'backend-status' });
  function drawStatus() {
    statusLine.innerHTML = '';
    if (on()) {
      statusLine.className = 'backend-status ok';
      statusLine.append(h('span', { class: 'dot' }), '已启用 · Agnes AI（文本 / 图像 / 视频）已就绪');
    } else {
      statusLine.className = 'backend-status off';
      statusLine.append(h('span', { class: 'dot' }), '已关闭 — 所有 AI 生成功能将不可用');
    }
  }
  const swInput = h('input', { type: 'checkbox', checked: on() });
  swInput.addEventListener('change', e => { store.set({ backend: { enabled: e.target.checked } }); drawStatus(); });
  const sw = h('label', { class: 'switch' }, swInput, h('span', { class: 'slider' }));

  const testLine = h('div', { style: { display: 'none', fontSize: '12.5px', margin: '10px 0 0', padding: '9px 12px', borderRadius: '8px', lineHeight: '1.6', wordBreak: 'break-all' } });

  const backendCard = h('div', { class: 'provider-card' },
    h('div', { style: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '16px' } },
      h('div', {},
        h('div', { style: { fontSize: '14px', fontWeight: '600' } }, 'AI 后台服务'),
        h('div', { class: 'hint', style: { margin: '4px 0 0' } }, '平台已为你接好模型通道，打开开关即可使用，不用填任何东西。')),
      sw),
    statusLine,
    h('div', { style: { display: 'flex', gap: '10px', flexWrap: 'wrap', marginTop: '14px' } },
      h('button', { class: 'btn-ghost', onclick: async e => {
        const btn = e.currentTarget; btn.disabled = true; btn.textContent = '测试中…';
        testLine.style.display = 'none';
        try {
          const r = await testBackend();
          testLine.style.display = 'block';
          testLine.style.background = r.ok ? '#E9F9F6' : '#FEF2F2';
          testLine.style.color = r.ok ? '#0E7C6E' : 'var(--err)';
          testLine.textContent = (r.ok ? '✓ ' : '✗ ') + r.msg;
        } catch (err) {
          testLine.style.display = 'block';
          testLine.style.background = '#FEF2F2';
          testLine.style.color = 'var(--err)';
          testLine.textContent = '✗ 测试异常：' + String(err?.message || err);
        } finally { btn.disabled = false; btn.textContent = '测试连接'; }
      } }, '测试连接')),
    testLine);

  page.append(h('div', { class: 'section-title' }, 'AI 后台服务'), backendCard);
  drawStatus();

  /* ---- 我的模型（可选 · 自带 Key） ---- */
  const mineWrap = h('div', {});
  page.append(h('div', { class: 'section-title' }, '我的模型（可选）'), mineWrap);

  function maskKey(k) {
    const s = String(k || '');
    if (!s) return '未填';
    if (s.length <= 10) return s.slice(0, 3) + '••••';
    return s.slice(0, 6) + '••••••' + s.slice(-4);
  }

  function drawMine() {
    mineWrap.innerHTML = '';
    const list = store.list('providers');

    mineWrap.append(h('div', { class: 'provider-card' },
      h('div', { class: 'hint', style: { marginTop: '0' } },
        '平台后台已经接好，日常不用动这里。只有你想用自己的 API Key（自带模型 / BYOK）时才需要添加 —— 添加并启用后，会出现在「图片生成 / 视频生成」的模型下拉里；不添加也照样能用平台的文本、图像、视频模型。'),
      h('div', { style: { display: 'flex', gap: '10px', flexWrap: 'wrap', alignItems: 'center', marginTop: '14px' } },
        h('button', { class: 'btn-ghost', onclick: () => openForm(null) }, '＋ 添加模型'),
        list.length ? h('span', { class: 'hint', style: { margin: '0' } }, `已添加 ${list.length} 个`) : null)));

    if (!list.length) {
      mineWrap.append(h('div', { class: 'provider-card' },
        h('div', { class: 'hint', style: { marginTop: '0' } },
          '还没有添加自己的模型。不添加也能正常使用平台的文本 / 图像 / 视频模型。')));
      return;
    }

    for (const p of list) {
      const sw2 = h('input', { type: 'checkbox', checked: p.enabled !== false });
      sw2.addEventListener('change', e => {
        providers.update(p.id, { enabled: e.target.checked });
        toast(e.target.checked ? `已启用「${p.name || '未命名'}」` : `已停用「${p.name || '未命名'}」`, 'ok');
        drawMine();
      });
      mineWrap.append(h('div', { class: 'provider-card' },
        h('div', { class: 'provider-head', style: { marginBottom: '0' } },
          h('span', { class: 'tag' }, TYPE_LABEL[p.type] || p.type || '文本/剧情'),
          h('div', { class: 'provider-name', style: { flexDirection: 'column', alignItems: 'flex-start', gap: '2px', minWidth: '0' } },
            h('span', {}, p.name || '未命名模型'),
            h('div', { class: 'hint', style: { marginTop: '0', wordBreak: 'break-all' } },
              `${p.model || '未填模型名'} · ${p.baseUrl || '未填地址'} · Key ${maskKey(p.apiKey)}`)),
          h('label', { class: 'switch' }, sw2, h('span', { class: 'slider' })),
          h('button', { class: 'node-btn', onclick: () => openForm(p) }, '编辑'),
          h('button', { class: 'node-btn', onclick: async () => {
            if (!await confirm(`删除模型「${p.name || '未命名'}」？`)) return;
            providers.remove(p.id); drawMine(); toast('已删除', 'ok');
          } }, '删除'))));
    }
  }

  /* 添加 / 编辑表单（就地插入列表顶部） */
  function openForm(existing) {
    const st = {
      type: existing?.type || 'text',
      name: existing?.name || '',
      baseUrl: existing?.baseUrl || '',
      model: existing?.model || '',
      apiKey: existing?.apiKey || ''
    };
    const form = h('div', { class: 'provider-card', style: { borderColor: 'var(--brand)' } });

    const typeSel = h('select', { class: 'form-select' },
      Object.entries(TYPE_LABEL).filter(([k]) => k !== 'audio')
        .map(([k, v]) => h('option', { value: k, selected: k === st.type }, v)));

    const nameInp = h('input', { class: 'form-input', placeholder: '例如：我的 Agnes / 我的 DeepSeek', value: st.name });
    const urlInp = h('input', { class: 'form-input', placeholder: 'https://xxx/v1', value: st.baseUrl });
    const modelInp = h('input', { class: 'form-input', placeholder: '模型名，例如 agnes-3.0-flash', value: st.model });
    const keyInp = h('input', { class: 'form-input', type: 'password', placeholder: 'sk-...（只存在你自己的浏览器里）', value: st.apiKey });
    const presetRow = h('div', { class: 'chip-row', style: { margin: '0', justifyContent: 'flex-start' } });

    function drawPresets() {
      presetRow.innerHTML = '';
      const ps = PRESETS.filter(x => x.type === typeSel.value && x.key !== 'custom');
      for (const pre of ps) presetRow.append(h('button', { class: 'chip', onclick: () => {
        nameInp.value = pre.name; urlInp.value = pre.baseUrl; modelInp.value = pre.model; keyInp.focus();
      } }, pre.name));
      if (!ps.length) presetRow.append(h('span', { class: 'hint', style: { margin: '0' } }, '这类没有内置预设，手动填地址与模型名即可'));
    }
    typeSel.addEventListener('change', drawPresets);
    drawPresets();

    form.append(
      h('div', { style: { fontSize: '14px', fontWeight: '600', marginBottom: '6px' } }, existing ? '编辑模型' : '添加模型'),
      h('div', { class: 'hint', style: { margin: '0 0 16px' } }, 'Key 只保存在你自己的浏览器本地，不会上传到任何地方。'),
      h('div', { class: 'form-group' }, h('label', { class: 'form-label' }, '类型'), typeSel),
      h('div', { class: 'form-group' }, h('label', { class: 'form-label' }, '常用预设（点一下自动填地址与模型名）'), presetRow),
      h('div', { class: 'form-group' }, h('label', { class: 'form-label' }, '名称'), nameInp),
      h('div', { class: 'form-row' },
        h('div', { class: 'form-group' }, h('label', { class: 'form-label' }, 'Base URL'), urlInp),
        h('div', { class: 'form-group' }, h('label', { class: 'form-label' }, '模型名'), modelInp)),
      h('div', { class: 'form-group' }, h('label', { class: 'form-label' }, 'API Key'), keyInp),
      h('div', { style: { display: 'flex', gap: '10px' } },
        h('button', { class: 'btn-primary', onclick: () => {
          const url = urlInp.value.trim(), model = modelInp.value.trim();
          if (!url) return toast('请填 Base URL', 'err');
          if (!model) return toast('请填模型名', 'err');
          const data = {
            type: typeSel.value,
            name: nameInp.value.trim() || model,
            baseUrl: url,
            model,
            apiKey: keyInp.value.trim()
          };
          if (existing) providers.update(existing.id, data);
          else providers.add({ ...data, enabled: true });
          const l = store.list('providers').length;
          $('#credit-num') && ($('#credit-num').textContent = l ? `${l} 个模型` : 'BYOK');
          toast(existing ? '已保存' : '已添加，可在模型下拉里选到', 'ok');
          drawMine();
        } }, existing ? '保存' : '添加'),
        h('button', { class: 'btn-ghost', onclick: () => drawMine() }, '取消')));

    mineWrap.prepend(form);
    nameInp.focus();
  }

  drawMine();

  /* ---- 存储管理 ---- */
  function storageCard() {
    const card = h('div', { class: 'provider-card' });
    function draw() {
      card.innerHTML = '';
      const rep = usageReport(store.state);
      const warn = rep.percent >= 85;

      /* 用量条 */
      const bar = h('div', { style: { height: '10px', background: 'var(--bg)', borderRadius: '6px', overflow: 'hidden', marginTop: '8px' } },
        h('div', { style: { height: '100%', width: rep.percent + '%', borderRadius: '6px', background: warn ? 'var(--err)' : rep.percent >= 65 ? 'var(--warn)' : 'var(--brand)', transition: 'width .3s' } }));

      /* 分类明细 */
      const kinds = Object.entries(rep.byKind).sort((a, b) => b[1].bytes - a[1].bytes);
      const kindRows = h('div', { style: { margin: '12px 0' } },
        kinds.length ? kinds.map(([k, v]) => h('div', { style: { display: 'flex', alignItems: 'center', gap: '10px', fontSize: '12.5px', padding: '4px 0' } },
          h('span', { style: { width: '92px', color: 'var(--txt-2)' } }, k),
          h('span', { class: 'tag' }, v.count + ' 个'),
          h('div', { style: { flex: '1', height: '5px', background: 'var(--bg)', borderRadius: '4px', overflow: 'hidden' } },
            h('div', { style: { height: '100%', width: Math.min(100, v.bytes / Math.max(1, rep.mediaBytes) * 100) + '%', background: 'var(--brand)', opacity: '.7' } })),
          h('span', { style: { width: '70px', textAlign: 'right', color: 'var(--txt-3)' } }, fmtKB(v.bytes))))
          : h('div', { class: 'hint' }, '目前没有占用空间的本地素材'));

      /* 自动清理阈值 */
      const at = store.state.settings?.autoCleanAt ?? 0.85;
      const seg = h('div', { class: 'seg' },
        [['0', '关闭'], ['0.75', '75%'], ['0.85', '85%'], ['0.92', '92%']].map(([v, label]) =>
          h('button', {
            class: String(at) === v ? 'active' : '', onclick: () => {
              const cur = store.state.settings || {};
              store.set({ settings: { ...cur, autoCleanAt: parseFloat(v) } });
              draw(); toast(v === '0' ? '已关闭自动清理' : `空间用到 ${label} 时自动清理旧素材`, 'ok');
            }
          }, label)));

      card.append(
        h('div', { style: { display: 'flex', alignItems: 'baseline', gap: '10px' } },
          h('span', { style: { fontSize: '14px', fontWeight: '600' } }, '本机存储'),
          h('span', { style: { fontSize: '12.5px', color: warn ? 'var(--err)' : 'var(--txt-2)' } },
            `${fmtMB(rep.total)} / 5 MB（${rep.percent}%）`),
          warn ? h('span', { class: 'badge', style: { background: '#FEF2F2', color: 'var(--err)' } }, '接近上限') : null),
        bar,
        kindRows,
        h('div', { style: { display: 'flex', alignItems: 'center', gap: '12px', margin: '14px 0 6px', flexWrap: 'wrap' } },
          h('span', { style: { fontSize: '12.5px', color: 'var(--txt-2)' } }, '自动清理：'),
          h('div', { style: { width: '190px' } }, seg),
          h('span', { class: 'hint', style: { margin: '0' } }, '空间不足时，从最旧的素材开始清（只清图，保留文字记录）')),
        h('div', { style: { display: 'flex', gap: '10px', flexWrap: 'wrap' } },
          h('button', { class: 'btn-ghost', onclick: () => {
            const n = clearOldest(store.state, 20);
            if (!n) return toast('没有可清理的旧素材');
            store.save(); draw(); toast(`已清理 ${n} 个旧素材`, 'ok');
          } }, '清理最旧素材（留最新 20 个）'),
          h('button', { class: 'btn-ghost', onclick: async e => {
            const btn = e.currentTarget;
            btn.disabled = true;
            try {
              toast('开始压缩…');
              const saved = await compressAllImages(store.state, () => { /* 静默 */ });
              store.save(); draw();
              toast(saved > 0 ? `压缩完成，省下 ${fmtKB(saved)}` : '素材都已经足够小，无需压缩', 'ok', 3500);
            } catch (err) {
              toast('压缩失败：' + String(err?.message || err), 'err');
            } finally {
              btn.disabled = false;
            }
          } }, '一键压缩全部图片'),
          h('button', { class: 'btn-ghost btn-danger', onclick: async () => {
            if (!await confirm('清空全部本地素材（图片/视频缓存）？文字记录会完整保留，素材无法恢复。')) return;
            const n = clearAllMedia(store.state);
            store.save(); draw(); toast(`已清空 ${n} 个素材`, 'ok');
          } }, '清空全部素材')),
        h('div', { class: 'hint' },
          '图片保存时自动压缩（长边 1280、JPEG）；空间不足时按上面设置的阈值自动清理最旧素材；被清理的位置会显示占位图，文字与记录都在。'));
    }
    draw();
    return card;
  }

  page.append(h('div', { class: 'section-title' }, '存储管理'), storageCard());

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

  if (auth.isAdmin) {
    const users = store.list('users');
    page.append(h('div', { class: 'section-title' }, '账号管理'),
      h('div', { class: 'provider-card' },
        h('div', { class: 'hint', style: { marginTop: '0', marginBottom: '14px' } },
          `内置管理员 ${ADMIN.account}（${ADMIN.nick}）始终可登录。下面是通过「申请授权」注册的账号，授权后才能进入。`),
        users.length
          ? h('div', {}, ...users.map(u => h('div', { class: 'list-row', style: { marginBottom: '8px' } },
            h('span', { class: 'avatar' }, u.nick.slice(0, 1)),
            h('div', { class: 'list-main' },
              h('div', { class: 'list-title' }, u.nick),
              h('div', { class: 'list-meta' }, u.account + ' · ' + (u.approved ? '已授权' : '待授权'))),
            h('button', {
              class: 'node-btn' + (u.approved ? '' : ' primary'),
              onclick: () => { u.approved = !u.approved; store.save(); render(root); }
            }, u.approved ? '撤销授权' : '授权进入'),
            h('button', { class: 'node-btn', onclick: async () => {
              if (await confirm(`删除账号「${u.nick}」？`)) {
                const arr = store.list('users');
                arr.splice(arr.indexOf(u), 1); store.save(); render(root);
              }
            } }, '删除'))))
          : h('div', { class: 'hint' }, '暂无申请账号')));
  }
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
