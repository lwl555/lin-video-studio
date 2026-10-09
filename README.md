# 林的视频工作台

> 参考 Pavo（Agnes AI）做的 AI 视频 / 短剧创作工作台。
> 唯一区别：**模型不内置，由用户自己接入**（BYOK）——填自己的 Base URL + API Key + 模型名，Key 只存在本机浏览器。

## 功能

| 模块 | 说明 |
|---|---|
| **创作广场（首页）** | 大输入框 + 四种模式（图片 / 视频 / 剧情短片 / Agent）+ 首帧尾帧参考图 + 下方作品流 |
| **无限画布** | 节点式工作流：文本 / 图片 / 视频 / 音频 / 视频合成 / 导演台 / 素材；端口拖拽连线（带箭头）、分支、一键整理、缩放平移、导出 JSON |
| **剧情短片** | 六阶段流水线：需求确认 → 剧本大纲 → 角色场景 → 分镜脚本 → 关键帧 → 视频成片，每步可改、单镜头可重绘 |
| **3D 导演台** | Three.js 实时 3D：拖角色摆位、6 种姿势预设、关节逐项微调、**12 个机位预设**、镜头参数实时调整、机位截图存资产、支持导入 GLB 模型 |
| **一键合成成片** | 浏览器内跑 **ffmpeg.wasm**：多片段拼接（快拼 / 重编码）、0.5s 淡入淡出转场、混入背景音、导出 MP4 |
| **短剧剧场** | 项目管理 + 资产库 + 分集进度 |
| **图片工作区** | 文生图 / 图生图，8 种风格预设、6 种尺寸 |
| **视频工作区** | 文生视频 / 图生视频 / 首尾帧，6 种比例、5 档时长，异步任务轮询 |
| **资产库** | 角色 / 场景 / 道具沉淀，画布节点可直接调用，解决跨镜头崩脸 |
| **灵感社区** | 精选案例 + 提示词复制 + Remix 二创 + 20 种风格库 |
| **模型接入** | 14 个预设（Agnes / DeepSeek / 智谱 / 硅基流动 / Moonshot / OpenAI / 火山 / FLUX / CogView …）+ 完全自定义 + 连通性自检 |
| **配音 / 音色克隆** | 接口已预留，暂不开放（节点里有入口提示） |
| **登录门禁** | 仅授权账号可进入 |

## 账号

内置管理员（唯一可直接登录的账号）：

```
手机号：18882632073
密码：  110110nm
昵称：  林
```

其他账号走「申请授权」注册，之后要管理员在「模型接入 → 账号管理」里点授权才能登录。

## 本地运行

纯静态、零构建、零依赖（Three.js 已放进 `assets/vendor/`）。任意静态服务器即可：

```bash
cd pavo-clone
python -m http.server 8899
# 打开 http://localhost:8899
```

> 直接双击 `index.html` 也能打开，但浏览器会拦 ES Module（file:// 协议），**建议起个服务**。

## 部署到 GitHub Pages

```bash
git init && git add -A && git commit -m "init"
git remote add origin https://github.com/<用户名>/<仓库名>.git
git push -u origin main
```

然后仓库 Settings → Pages，Source 选 `main` 分支根目录。地址形如 `https://<用户名>.github.io/<仓库名>/`。

## 后端（可选）：CORS 代理 + 素材存储

**合成不需要后端**（在浏览器里跑）。只有当你接入的模型 API 不允许浏览器直连（跨域）时才需要它：

1. 在 [supabase.com](https://supabase.com) 建项目（免费档，不用绑卡）
2. `npm i -g supabase && supabase login && supabase link --project-ref <ref>`
3. Storage 建一个公开 bucket：`pavo`
4. `supabase functions deploy pavo-proxy --no-verify-jwt`
5. 回到工作台 →「模型接入」→ 底部 **后端代理**，填地址 + anon key，勾启用

函数两个路由：
- `POST /fetch` —— 转发模型请求，body `{ url, method, headers, body }`（带 SSRF 防护，只放行 https）
- `POST /storage?path=xxx` —— 上传二进制到 Storage，返回公开 URL

> 重要：**ffmpeg 不能在 Supabase Edge Function 里跑**（Edge Runtime 不支持外部二进制），所以合成一律走浏览器内的 ffmpeg.wasm。

## 目录结构

```
pavo-clone/
├─ index.html                       入口（登录页 + 应用外壳 + importmap）
├─ assets/
│  ├─ css/style.css                 全部样式
│  ├─ vendor/                       Three.js 本地副本（three.module.js + addons）
│  └─ js/
│     ├─ app.js                     认证 + hash 路由
│     ├─ store.js                   localStorage 数据层 + 认证 + 媒体存储
│     ├─ models.js                  BYOK 模型接入层（chat / genImage / genVideo）
│     ├─ media.js                   浏览器内合成（ffmpeg.wasm）+ 抽帧
│     ├─ director.js                3D 导演台（Three.js）
│     ├─ ui.js                      通用组件（toast / modal / 右键菜单 / 文件选择）
│     └─ views/                     home · canvas · image · video · studio · series
│                                   assets · works · inspire · settings
├─ supabase/functions/pavo-proxy/index.ts
└─ docs/
   ├─ PAVO-平台拆解与复刻方案.md
   └─ screenshots/
```

## 外部依赖

| 依赖 | 来源 | 说明 |
|---|---|---|
| Three.js 0.160 | 已放进 `assets/vendor/` | 离线可用，不联网 |
| ffmpeg.wasm | jsDelivr（失败自动回退 unpkg） | 首次合成时下载约 30MB 内核，浏览器缓存后不再下 |

## 模型接口约定

- **文本**：`POST {base}/chat/completions`（OpenAI 兼容）
- **图像**：`POST {base}/images/generations`，兼容 `data[0].url` 或 `data[0].b64_json`
- **视频**：`POST {base}{提交路径}` → 轮询 `GET {base}{查询路径}?id=xxx`
  两个路径在模型接入页可自定义，默认 `/video/generations` 与 `/video/status`

## 路由

hash 直链：`#home` `#inspire` `#series` `#canvas` `#works` `#assets` `#settings` `#image` `#video` `#studio`

## 与 Pavo 的差异

| | Pavo | 本工作台 |
|---|---|---|
| 模型 | 平台内置 Agnes | 用户自己接入，Key 只在本机 |
| 计费 | 积分 / 会员 | 无，不消耗任何平台额度 |
| 登录 | 手机号 / 微信 / Google | 仅授权账号 |
| 合成 | 云端 | 浏览器内 ffmpeg.wasm |
| 后端 | 官方云 | 可选自建 Supabase 免费档 |
| 数据 | 云端账户 | 默认本机浏览器，可导出 / 导入 JSON |
