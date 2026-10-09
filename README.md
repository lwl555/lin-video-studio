# 林的视频工作台

> 参考 Pavo（Agnes AI）复刻的 AI 视频/短剧创作工作台。
> 区别只有一处：**模型不内置，由用户自己接入**（BYOK）——填自己的 Base URL + API Key + 模型名，Key 只存在本机浏览器里。

## 功能

| 模块 | 说明 |
|---|---|
| **创作广场（首页）** | 大输入框 + 四种模式（图片 / 视频 / 剧情短片 / Agent）+ 首帧尾帧参考图 + 下方作品流 |
| **无限画布** | 节点式工作流：文本 / 图片 / 视频 / 音频 / 视频合成 / 导演台 / 素材；端口拖拽连线、分支、复制、一键整理、缩放平移、导出 JSON |
| **剧情短片** | 六阶段流水线：需求确认 → 剧本大纲 → 角色场景 → 分镜脚本 → 关键帧 → 视频成片，每步可改、单镜头可重绘 |
| **短剧剧场** | 项目管理 + 资产库 + 分集进度 |
| **图片工作区** | 文生图 / 图生图（参考图），8 种风格预设、6 种尺寸 |
| **视频工作区** | 文生视频 / 图生视频 / 首尾帧，6 种比例、5 档时长，异步任务轮询 |
| **资产库** | 角色 / 场景 / 道具沉淀，节点里可直接调用，解决跨镜头崩脸 |
| **灵感社区** | 精选案例 + 提示词复制 + Remix 二创 + 20 种风格库 |
| **模型接入** | 14 个预设（Agnes / DeepSeek / 智谱 / 硅基流动 / Moonshot / OpenAI / 火山 / FLUX / CogView …）+ 完全自定义 + 连通性自检 |
| **登录门禁** | 仅管理员可进入 |

## 账号

内置管理员（唯一可直接登录的账号）：

```
手机号：18882632073
密码：  110110nm
昵称：  林
```

其他账号通过「申请授权」注册后，需管理员授权才能登录（数据存在本机 localStorage）。

## 本地运行

纯静态、零构建、零依赖。任意静态服务器即可：

```bash
cd pavo-clone
python -m http.server 8899
# 打开 http://localhost:8899
```

> 直接双击 `index.html` 也能打开，但浏览器会拦 ES Module（file:// 协议），所以**建议用上面的方式起个服务**。

## 部署到 GitHub Pages

```bash
git init && git add -A && git commit -m "init"
git remote add origin https://github.com/<你的用户名>/<仓库名>.git
git push -u origin main
```

然后在仓库 Settings → Pages 里把 Source 选成 `main` 分支根目录即可。
访问地址形如 `https://<用户名>.github.io/<仓库名>/`。

## 后端（可选）：CORS 代理 + 素材存储

浏览器直连很多模型 API 会被跨域拦截。用 Supabase 免费档可以解决，顺带把素材存进 Storage。

1. 在 [supabase.com](https://supabase.com) 建项目（免费档，不用绑卡）
2. 装 CLI 并登录：

```bash
npm i -g supabase
supabase login
supabase link --project-ref <你的项目ref>
```

3. 建一个公开 bucket 叫 `pavo`（Storage → New bucket → 勾选 Public）
4. 部署函数：

```bash
supabase functions deploy pavo-proxy --no-verify-jwt
```

部署完会拿到形如 `https://xxxx.functions.supabase.co/pavo-proxy` 的地址。

5. 回到工作台 →「模型接入」→ 最下方 **后端代理**，填地址 + anon key，勾选启用，保存。

函数提供两个路由：
- `POST /fetch` —— 转发模型请求，body `{ url, method, headers, body }`
- `POST /storage?path=xxx` —— 上传二进制到 Storage，返回公开 URL

## 目录结构

```
pavo-clone/
├─ index.html                     入口（登录页 + 应用外壳）
├─ assets/
│  ├─ css/style.css               全部样式（浅色主题）
│  └─ js/
│     ├─ app.js                   认证 + 路由
│     ├─ store.js                 localStorage 数据层 + 认证 + 媒体存储
│     ├─ models.js                BYOK 模型接入层（chat / genImage / genVideo）
│     ├─ ui.js                    通用组件（toast / modal / 右键菜单 / 文件选择）
│     └─ views/                   home · canvas · image · video · studio · series
│                                 assets · works · inspire · settings
├─ supabase/functions/pavo-proxy/index.ts
└─ docs/
   ├─ PAVO-平台拆解与复刻方案.md    调研 + 对照清单
   └─ screenshots/                 界面截图
```

## 模型接口约定

- **文本**：`POST {base}/chat/completions`（OpenAI 兼容）
- **图像**：`POST {base}/images/generations`，兼容返回 `data[0].url` 或 `data[0].b64_json`
- **视频**：`POST {base}{提交路径}` → 轮询 `GET {base}{查询路径}?id=xxx`
  两个路径可在模型接入页自定义，默认 `/video/generations` 与 `/video/status`

## 路由

支持 hash 直链：`#home` `#inspire` `#series` `#canvas` `#works` `#assets` `#settings` `#image` `#video` `#studio`

## 与 Pavo 的差异

| | Pavo | 本工作台 |
|---|---|---|
| 模型 | 平台内置 Agnes | 用户自己接入，Key 只在本机 |
| 计费 | 积分 / 会员 | 无，不消耗任何平台额度 |
| 登录 | 手机号 / 微信 / Google | 仅授权账号 |
| 后端 | 官方云 | 可选自建 Supabase 免费档 |
| 数据 | 云端账户 | 默认本机浏览器，可导出/导入 JSON |
