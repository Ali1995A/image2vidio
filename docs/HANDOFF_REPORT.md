# Handoff Report（随时衔接报告）

目的：给未来的你 / 其他 AI 一个“开箱即懂”的仓库说明，快速判断当前状态、关键约束、以及下一步怎么改。

## TL;DR

- 这是一个 iPad 横屏双栏网页：左涂鸦、右生成动漫短视频。
- 当前视频方案是 **Smart 模式**：先“看图写一句描述”（caption），再用 `wan2.2-t2v-plus` 做 t2v（更稳定）。
- `wan2.x i2v` 在当前链路下频繁 `Video generation failed`；并且 **wan 系列时长固定 5s**（1–3s 会失败）。
- 视频内容若返回 OSS 签名直链：前端直接播放/下载该直链，避免服务端 `TLS handshake timeout`。
- 右侧 UI 有“风格按钮”，提示词强调“儿童笔触 + 严格保留涂鸦原始笔画与构图 + 动作明显”。

## Repo Map（文件地图）

- UI
  - `app/page.tsx`：左右栏与标题、右侧 generator 入口
  - `app/globals.css`：粉色 iOS 风格样式、布局、拼音字体样式
  - `components/DoodlePad.tsx`：涂鸦画布与工具；暴露 export handle
  - `components/VideoGenerator.tsx`：生成/轮询/播放/下载/分享
- 服务端 API
  - `app/api/generate/route.ts`：唯一后端入口；对接 AIHubMix `/v1`
- 工具库
  - `lib/pinyin.ts`：拼音显示处理（NFD + a→ɑ）
  - `lib/version.ts` + `next.config.js`：把 git sha 注入到 `NEXT_PUBLIC_APP_VERSION`
- 配置
  - `.env.example`：环境变量模板（Vercel 也照这个配）

## Runtime Contract（关键接口约定）

### Browser → Server

`POST /api/generate`

- 生成（smart 模式）：
  - body: `{ mode:"smart", seconds:5, prompt:string, imageDataUrl:string }`
  - response:
    - `202 { pending:true, tid }`：需要轮询
    - `200 video/*`：直接给视频二进制
    - `200 { url }`：给视频直链（浏览器直接播放/下载）

- 轮询状态：
  - body: `{ action:"status", tid }`
  - response:
    - `202 { pending:true, tid }`
    - `200 json`（上游状态 JSON）

- 轮询内容：
  - body: `{ action:"content", tid }`
  - response:
    - `202 { pending:true, tid }`
    - `200 video/*` 或 `200 { url }`

### Server → AIHubMix

- Caption（视觉理解）：
  - endpoint: `POST {baseUrl}/chat/completions`
  - model: `process.env.AIHUBMIX_CAPTION_MODEL`（默认 `gpt-4o-mini`）
  - 输入：imageDataUrl
  - 输出：一句描述文本

- Video（t2v）：
  - endpoint: `POST {baseUrl}/videos`
  - model: `wan2.2-t2v-plus`
  - seconds: 固定 5
  - size: `832x480`

## Operational Notes（运行/部署要点）

- 本地：`.env`（不会提交）
  - `AIHUBMIX_API_KEY`：必填
  - `AIHUBMIX_BASE_URL`：可选，默认 `https://aihubmix.com/v1`
  - `AIHUBMIX_CAPTION_MODEL`：可选，默认 `gpt-4o-mini`
- Vercel：按 `.env.example` 配环境变量即可。

## Known Failure Modes（已知失败与对策）

1) `Video generation failed`
- 原因：wan i2v 侧不稳定/不支持 1–3s
- 对策：当前走 smart→t2v；并固定 5s

2) `video is still being generated (tid: ...)`
- 原因：正常 pending
- 对策：前端轮询 `action=content/status`

3) `TLS handshake timeout`（拉 OSS mp4）
- 原因：服务端拉 OSS 直链在 Vercel 网络不稳定
- 对策：服务端改为返回 `{ url }`，浏览器直连播放/下载

## Next Work Suggestions（下一步可以做什么）

- 需求若必须 1–3 秒：需要换支持可变时长的视频模型，或生成 5 秒后在前端/服务端做裁剪与转码。
- 如果要加“模型选择”：优先做成 preset（allowlist），不要直接暴露 modelId；详见 `docs/MODEL_SELECTION.md`。
- 若要增强“儿童交互”：增加更大的单一主按钮、动画提示、以及生成进度条/可视化倒计时。
- 若要更稳定：在服务端把“上游返回 schema”记录到日志（注意脱敏），便于快速适配字段变化。
