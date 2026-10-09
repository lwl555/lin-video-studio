/* ============ 3D 导演台（Three.js） ============ */
import { h, toast, pickFile } from './ui.js';
import { store, uid } from './store.js';

/* 12 个机位预设：azimuth(水平角°) / elevation(俯仰°) / distance / fov / targetY */
export const SHOT_PRESETS = [
  { name: '正面 中景', a: 0, e: 8, d: 4.2, fov: 45, ty: 1.0 },
  { name: '正面 特写', a: 0, e: 4, d: 2.0, fov: 35, ty: 1.4 },
  { name: '侧面 中景', a: 90, e: 8, d: 4.0, fov: 45, ty: 1.0 },
  { name: '背面 跟拍', a: 180, e: 10, d: 3.6, fov: 45, ty: 1.0 },
  { name: '过肩 双人', a: 35, e: 6, d: 3.2, fov: 40, ty: 1.25 },
  { name: '俯拍 全景', a: 0, e: 55, d: 7.0, fov: 50, ty: 0.6 },
  { name: '仰拍 威压', a: 0, e: -28, d: 2.6, fov: 38, ty: 1.5 },
  { name: '鸟瞰 全场', a: 25, e: 78, d: 9.0, fov: 55, ty: 0.3 },
  { name: '低角度 推轨', a: 15, e: -8, d: 2.2, fov: 32, ty: 1.45 },
  { name: '侧逆 剪影', a: 125, e: 15, d: 4.5, fov: 45, ty: 1.1 },
  { name: '环绕 中近', a: 210, e: 12, d: 3.0, fov: 42, ty: 1.2 },
  { name: '远景 定场', a: 0, e: 14, d: 11.0, fov: 50, ty: 0.9 }
];

/* 姿势预设：关节角度（弧度） */
const POSES = {
  '站立': { armL: -0.15, armR: -0.15, legL: 0, legR: 0, torso: 0 },
  '行走': { armL: 0.7, armR: -0.7, legL: 0.35, legR: -0.35, torso: 0.03 },
  '坐姿': { armL: -0.5, armR: -0.5, legL: -1.4, legR: -1.4, torso: 0.15, sit: true },
  '挥手': { armL: -2.5, armR: -0.3, legL: 0, legR: 0, torso: 0.05 },
  '指前方': { armL: -1.6, armR: -0.1, legL: 0.1, legR: -0.1, torso: 0 },
  '叉腰': { armL: -1.1, armR: -1.1, legL: 0, legR: 0, torso: 0 }
};

let THREE = null;
async function loadThree() {
  if (THREE) return THREE;
  try {
    THREE = await import('three');
  } catch (e) {
    throw new Error('Three.js 加载失败（需要联网从 CDN 取）：' + e.message);
  }
  return THREE;
}

/**
 * 打开导演台
 * @param {object} opts { onCapture(dataURL) } 截图回调
 */
export async function openDirector(opts = {}) {
  const T = await loadThree();
  const { onCapture } = opts;

  /* ---------- 场景 ---------- */
  const scene = new T.Scene();
  scene.background = new T.Color(0xF5F6F8);
  scene.fog = new T.Fog(0xF5F6F8, 18, 45);

  const camera = new T.PerspectiveCamera(45, 1, 0.1, 200);
  const cam = { a: 0, e: 10, d: 5.4, fov: 45, ty: 1.05 };

  const renderer = new T.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
  renderer.setPixelRatio(Math.min(2, devicePixelRatio));
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = T.PCFSoftShadowMap;

  scene.add(new T.HemisphereLight(0xffffff, 0xcfd4dc, 0.85));
  const key = new T.DirectionalLight(0xffffff, 1.5);
  key.position.set(4, 8, 6); key.castShadow = true;
  key.shadow.mapSize.set(1024, 1024);
  scene.add(key);
  const fill = new T.DirectionalLight(0xffffff, 0.35);
  fill.position.set(-5, 3, -4); scene.add(fill);

  const grid = new T.GridHelper(40, 40, 0xC8CCD4, 0xE3E6EB);
  scene.add(grid);
  const ground = new T.Mesh(
    new T.PlaneGeometry(40, 40),
    new T.MeshStandardMaterial({ color: 0xEEF0F3, roughness: 0.95 })
  );
  ground.rotation.x = -Math.PI / 2; ground.position.y = -0.001; ground.receiveShadow = true;
  scene.add(ground);

  /* ---------- 角色 ---------- */
  const characters = [];
  function makeCharacter(name) {
    const g = new T.Group();
    const mat = new T.MeshStandardMaterial({ color: 0x8A93A6, roughness: 0.6, metalness: 0.05 });
    const skin = new T.MeshStandardMaterial({ color: 0xD8B49A, roughness: 0.8 });

    const torso = new T.Mesh(new T.CapsuleGeometry(0.2, 0.55, 6, 12), mat);
    torso.position.y = 1.05; torso.castShadow = true; g.add(torso);

    const head = new T.Mesh(new T.SphereGeometry(0.155, 20, 16), skin);
    head.position.y = 1.52; head.castShadow = true; g.add(head);

    /* 朝向标记（鼻子）——方便判断角色面朝哪边 */
    const nose = new T.Mesh(new T.ConeGeometry(0.042, 0.085, 8), skin);
    nose.rotation.x = Math.PI / 2; nose.position.set(0, 1.51, 0.155);
    nose.castShadow = true; g.add(nose);

    const hips = new T.Group(); hips.position.y = 0.78; g.add(hips);
    const mkLimb = (r, len, x, y, z) => {
      const pivot = new T.Group();
      pivot.position.set(x, y, z);
      const m = new T.Mesh(new T.CapsuleGeometry(r, len, 4, 10), mat);
      m.position.y = -(len / 2 + r * 0.4);
      m.castShadow = true;
      pivot.add(m);
      return pivot;
    };
    const armL = mkLimb(0.065, 0.45, -0.24, 1.32, 0);
    const armR = mkLimb(0.065, 0.45, 0.24, 1.32, 0);
    const legL = mkLimb(0.085, 0.5, -0.11, 0.78, 0);
    const legR = mkLimb(0.085, 0.5, 0.11, 0.78, 0);
    g.add(armL, armR, legL, legR);

    g.userData = {
      name, parts: { torso, head, armL, armR, legL, legR }, pose: '站立', sit: false
    };
    characters.push(g); scene.add(g);
    return g;
  }
  const c1 = makeCharacter('角色 1'); c1.position.set(-0.9, 0, 0);
  const c2 = makeCharacter('角色 2'); c2.position.set(0.9, 0, 0); c2.rotation.y = -Math.PI / 8;

  let selected = characters[0];
  const selectRing = new T.Mesh(
    new T.RingGeometry(0.3, 0.36, 40),
    new T.MeshBasicMaterial({ color: 0x17B8A6, side: T.DoubleSide })
  );
  selectRing.rotation.x = -Math.PI / 2; selectRing.position.y = 0.01;
  scene.add(selectRing);

  function applyPose(ch, poseName, extra = {}) {
    const p = POSES[poseName] || POSES['站立'];
    const { armL, armR, legL, legR } = ch.userData.parts;
    armL.rotation.x = p.armL + (extra.armL || 0);
    armR.rotation.x = p.armR + (extra.armR || 0);
    legL.rotation.x = p.legL + (extra.legL || 0);
    legR.rotation.x = p.legR + (extra.legR || 0);
    ch.userData.pose = poseName;
    const sit = !!p.sit;
    ch.position.y = sit ? -0.28 : 0;
    ch.userData.parts.torso.rotation.x = p.torso || 0;
  }
  characters.forEach(c => applyPose(c, '站立'));

  /* ---------- 相机控制 ---------- */
  function syncCamera() {
    const rad = a => a * Math.PI / 180;
    const az = rad(cam.a), el = rad(cam.e);
    camera.position.set(
      Math.sin(az) * Math.cos(el) * cam.d,
      Math.sin(el) * cam.d + 0.4,
      Math.cos(az) * Math.cos(el) * cam.d
    );
    camera.fov = cam.fov;
    camera.updateProjectionMatrix();
    camera.lookAt(0, cam.ty, 0);
  }
  syncCamera();

  const canvasWrap = h('div', { class: 'd3-stage' });
  canvasWrap.append(renderer.domElement);
  renderer.domElement.style.width = '100%';
  renderer.domElement.style.height = '100%';
  renderer.domElement.style.display = 'block';

  /* 鼠标：拖拽旋转视角 / 拖动角色 / 滚轮缩放 */
  let drag = null;
  const ray = new T.Raycaster();
  const plane = new T.Plane(new T.Vector3(0, 1, 0), 0);
  renderer.domElement.addEventListener('pointerdown', e => {
    const rect = renderer.domElement.getBoundingClientRect();
    const ndc = new T.Vector2(
      ((e.clientX - rect.left) / rect.width) * 2 - 1,
      -((e.clientY - rect.top) / rect.height) * 2 + 1
    );
    ray.setFromCamera(ndc, camera);
    const hits = ray.intersectObjects(characters, true);
    if (hits.length) {
      let o = hits[0].object;
      while (o.parent && !characters.includes(o)) o = o.parent;
      if (characters.includes(o)) {
        selected = o;
        const pt = new T.Vector3();
        if (ray.ray.intersectPlane(plane, pt)) {
          drag = { mode: 'move', obj: o, off: new T.Vector3(pt.x - o.position.x, 0, pt.z - o.position.z) };
        }
        drawPanel();
        return;
      }
    }
    drag = { mode: 'orbit', x: e.clientX, y: e.clientY, a: cam.a, e: cam.e };
    renderer.domElement.setPointerCapture?.(e.pointerId);
  });
  renderer.domElement.addEventListener('pointermove', e => {
    if (!drag) return;
    if (drag.mode === 'orbit') {
      cam.a = drag.a + (e.clientX - drag.x) * 0.4;
      cam.e = Math.max(-60, Math.min(85, drag.e - (e.clientY - drag.y) * 0.3));
      syncCamera();
    } else if (drag.mode === 'move') {
      const rect = renderer.domElement.getBoundingClientRect();
      const ndc = new T.Vector2(
        ((e.clientX - rect.left) / rect.width) * 2 - 1,
        -((e.clientY - rect.top) / rect.height) * 2 + 1
      );
      ray.setFromCamera(ndc, camera);
      const pt = new T.Vector3();
      if (ray.ray.intersectPlane(plane, pt)) {
        drag.obj.position.x = pt.x - drag.off.x;
        drag.obj.position.z = pt.z - drag.off.z;
      }
    }
  });
  const endDrag = () => { drag = null; };
  renderer.domElement.addEventListener('pointerup', endDrag);
  renderer.domElement.addEventListener('pointerleave', endDrag);
  renderer.domElement.addEventListener('wheel', e => {
    e.preventDefault();
    cam.d = Math.max(1.2, Math.min(20, cam.d * (e.deltaY > 0 ? 1.08 : 0.93)));
    syncCamera();
  }, { passive: false });

  /* ---------- 面板 ---------- */
  const shots = [];
  const shotBox = h('div', { class: 'd3-shots' });

  const roleBox = h('div', {});
  const poseRow = h('div', { class: 'd3-poses' });
  const extraRow = h('div', {});

  function drawPanel() {
    roleBox.innerHTML = '';
    characters.forEach((c, i) => {
      roleBox.append(h('div', {
        class: 'd3-role' + (c === selected ? ' active' : ''),
        onclick: () => { selected = c; drawPanel(); }
      },
        h('span', { class: 'd3-role-n' }, String(i + 1)),
        h('span', { class: 'd3-role-name' }, c.userData.name),
        h('button', { class: 'node-btn', onclick: e => {
          e.stopPropagation();
          if (characters.length <= 1) return toast('至少保留一个角色', 'err');
          scene.remove(c); characters.splice(i, 1);
          if (selected === c) selected = characters[0];
          drawPanel();
        } }, '×')));
    });

    poseRow.innerHTML = '';
    for (const p of Object.keys(POSES)) {
      poseRow.append(h('button', {
        class: 'ratio-btn' + (selected?.userData.pose === p ? ' active' : ''),
        onclick: () => { applyPose(selected, p); drawPanel(); }
      }, p));
    }

    extraRow.innerHTML = '';
    const mk = (label, key, min, max, step, get, set) => {
      const inp = h('input', { type: 'range', min, max, step, value: get(), oninput: e => { set(parseFloat(e.target.value)); } });
      extraRow.append(h('div', { class: 'd3-slider' },
        h('span', {}, label), inp, h('span', { class: 'd3-val' }, String(get()))));
      inp.addEventListener('input', () => inp.nextElementSibling.textContent = inp.value);
    };
    if (selected) {
      mk('朝向', 'rotY', -180, 180, 1, () => Math.round(selected.rotation.y * 180 / Math.PI),
        v => selected.rotation.y = v * Math.PI / 180);
      mk('身高', 'scale', 0.6, 1.6, 0.05, () => selected.scale.y,
        v => selected.scale.setScalar(v));
      mk('手臂 L', 'armL', -3, 1.2, 0.05, () => selected.userData.parts.armL.rotation.x,
        v => selected.userData.parts.armL.rotation.x = v);
      mk('手臂 R', 'armR', -3, 1.2, 0.05, () => selected.userData.parts.armR.rotation.x,
        v => selected.userData.parts.armR.rotation.x = v);
      mk('腿 L', 'legL', -1.6, 1.2, 0.05, () => selected.userData.parts.legL.rotation.x,
        v => selected.userData.parts.legL.rotation.x = v);
      mk('腿 R', 'legR', -1.6, 1.2, 0.05, () => selected.userData.parts.legR.rotation.x,
        v => selected.userData.parts.legR.rotation.x = v);
    }
  }

  const camRow = h('div', {});
  function drawCam() {
    camRow.innerHTML = '';
    const mk = (label, key, min, max, step) => {
      const inp = h('input', { type: 'range', min, max, step, value: cam[key], oninput: e => { cam[key] = parseFloat(e.target.value); syncCamera(); } });
      camRow.append(h('div', { class: 'd3-slider' }, h('span', {}, label), inp, h('span', { class: 'd3-val' }, String(cam[key]))));
      inp.addEventListener('input', () => inp.nextElementSibling.textContent = inp.value);
    };
    mk('方位', 'a', -180, 180, 1);
    mk('俯仰', 'e', -60, 85, 1);
    mk('距离', 'd', 1.2, 20, 0.1);
    mk('焦距', 'fov', 20, 75, 1);
    mk('视线高', 'ty', 0, 2, 0.05);
  }

  function applyPreset(p) {
    cam.a = p.a; cam.e = p.e; cam.d = p.d; cam.fov = p.fov; cam.ty = p.ty;
    syncCamera(); drawCam();
  }

  async function capture() {
    renderer.render(scene, camera);
    const url = renderer.domElement.toDataURL('image/png');
    shots.unshift({ url, label: `机位 ${shots.length + 1} · ${Math.round(cam.a)}°/${Math.round(cam.e)}°` });
    drawShots();
    toast('已截图', 'ok');
    return url;
  }

  function drawShots() {
    shotBox.innerHTML = '';
    if (!shots.length) shotBox.append(h('div', { class: 'hint' }, '点「截图」把当前机位存下来'));
    shots.forEach(s => shotBox.append(h('div', { class: 'd3-shot' },
      h('img', { src: s.url }),
      h('div', { class: 'd3-shot-label' }, s.label),
      h('div', { style: { display: 'flex', gap: '4px', marginTop: '4px' } },
        h('button', { class: 'node-btn', onclick: () => {
          store.add('assets', {
            id: uid('a'), name: s.label, type: 'scene',
            desc: `机位截图 · 方位 ${Math.round(cam.a)}° 俯仰 ${Math.round(cam.e)}° 距离 ${cam.d}`,
            url: s.url, createdAt: Date.now()
          });
          toast('已存入资产库', 'ok');
        } }, '存资产'),
        h('button', { class: 'node-btn', onclick: () => { onCapture?.(s.url); toast('已传给节点', 'ok'); } }, '用这张')))));
  }

  drawPanel(); drawCam(); drawShots();

  /* ---------- 布局 ---------- */
  const overlay = h('div', { class: 'd3-root' },
    h('div', { class: 'd3-head' },
      h('div', { class: 'd3-title' }, '3D 导演台'),
      h('div', { class: 'd3-sub' }, '拖动角色摆位 · 拖动空白处转视角 · 滚轮推拉镜头'),
      h('button', { class: 'btn-ghost', onclick: () => { stop(); overlay.remove(); } }, '关闭')),
    h('div', { class: 'd3-body' },
      /* 左：角色 */
      h('div', { class: 'd3-side' },
        h('div', { class: 'd3-h' }, '角色'),
        roleBox,
        h('div', { style: { display: 'flex', gap: '6px', margin: '10px 0' } },
          h('button', { class: 'node-btn', onclick: () => {
            const c = makeCharacter(`角色 ${characters.length + 1}`);
            c.position.set((Math.random() - 0.5) * 2, 0, (Math.random() - 0.5) * 2);
            selected = c; drawPanel();
          } }, '＋ 加角色'),
          h('button', { class: 'node-btn', onclick: async () => {
            const f = await pickFile('.glb,.gltf,model/gltf-binary');
            if (!f) return;
            try {
              const { GLTFLoader } = await import('three/addons/loaders/GLTFLoader.js');
              const buf = await f.arrayBuffer();
              const loader = new GLTFLoader();
              loader.parse(buf, '', gltf => {
                const m = gltf.scene;
                const box = new T.Box3().setFromObject(m);
                const size = box.getSize(new T.Vector3()).length() || 1;
                const fit = 1.7 / size;
                m.scale.setScalar(fit);
                m.position.set(0, 0, 0);
                m.traverse(o => { if (o.isMesh) o.castShadow = true; });
                m.userData = { name: f.name.replace(/\.[^.]+$/, ''), parts: {}, pose: '模型', custom: true };
                scene.add(m); characters.push(m); selected = m;
                drawPanel(); toast('模型已导入', 'ok');
              }, err => toast('模型解析失败：' + err, 'err'));
            } catch (e) { toast('导入失败：' + e.message, 'err'); }
          } }, '导入 GLB')),
        h('div', { class: 'd3-h' }, '姿势'),
        poseRow,
        h('div', { class: 'd3-h', style: { marginTop: '14px' } }, '精细调整'),
        extraRow),
      /* 中：3D */
      canvasWrap,
      /* 右：机位 */
      h('div', { class: 'd3-side' },
        h('div', { class: 'd3-h' }, '机位预设'),
        h('div', { class: 'd3-presets' }, ...SHOT_PRESETS.map(p =>
          h('button', { class: 'd3-preset', onclick: () => applyPreset(p) },
            h('span', { class: 'd3-preset-n' }, String(SHOT_PRESETS.indexOf(p) + 1).padStart(2, '0')),
            p.name))),
        h('div', { class: 'd3-h', style: { marginTop: '14px' } }, '镜头参数'),
        camRow,
        h('div', { style: { display: 'flex', gap: '6px', marginTop: '14px' } },
          h('button', { class: 'btn-primary', style: { flex: '1' }, onclick: capture }, '截图'),
          h('button', { class: 'btn-ghost', onclick: () => {
            if (!shots.length) return toast('还没有截图', 'err');
            onCapture?.(shots[0].url); toast('已把首张机位图传给节点', 'ok');
          } }, '完成')),
        h('div', { class: 'd3-h', style: { marginTop: '16px' } }, `机位截图（${shots.length}）`),
        shotBox)));

  document.body.append(overlay);

  /* ---------- 渲染循环 ---------- */
  let raf = 0, stopped = false;
  function resize() {
    const r = canvasWrap.getBoundingClientRect();
    if (!r.width || !r.height) return;
    renderer.setSize(r.width, r.height, false);
    camera.aspect = r.width / r.height;
    camera.updateProjectionMatrix();
  }
  const ro = new ResizeObserver(resize);
  ro.observe(canvasWrap);
  function loop() {
    if (stopped) return;
    selectRing.position.x = selected?.position.x || 0;
    selectRing.position.z = selected?.position.z || 0;
    selectRing.visible = !!selected;
    renderer.render(scene, camera);
    raf = requestAnimationFrame(loop);
  }
  requestAnimationFrame(() => { resize(); loop(); });
  function stop() {
    stopped = true; cancelAnimationFrame(raf); ro.disconnect();
    renderer.dispose();
  }

  return { close: () => { stop(); overlay.remove(); } };
}
