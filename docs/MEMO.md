# Memo（下次 AI 无缝衔接用）

这是一份“给未来 AI/自己看的备忘录”，用来在不了解上下文时快速恢复全貌与关键坑点。

## 一句话概述

`神笔CC`：iPad 横屏双栏网页（左涂鸦、右生成动漫短视频），后端走 AIHubMix `/v1`，当前使用 **smart：涂鸦→caption→t2v** 来稳定出片。

## 当前关键结论（最容易踩坑的地方）

1) **AIHubMix 的 wan 视频模型时长固定 5 秒**
- 之前试过 1–3 秒会稳定 `Video generation failed`
- 代码里现在固定走 5s（UI 也不再展示时长提示块）

2) **wan i2v 在当前链路下不稳定**
- `wan2.2-i2v-plus` / `wan2.5-i2v-preview` / `wan2.6-i2v` 在测试中经常直接失败
- 目前更稳定的路径：`caption`（视觉理解）→ `wan2.2-t2v-plus`

3) **OSS 签名视频链接不要让服务端转拉**
- Vercel/服务端拉阿里云 OSS 签名 mp4 容易 `TLS handshake timeout`
- 现在服务端遇到签名直链会返回 `{ url }`，前端用浏览器直接播放/下载

## 核心数据流（从涂鸦到视频）

1) `components/DoodlePad.tsx`
- Canvas 涂鸦（pointer events）
- 通过 `forwardRef` 暴露：
  - `exportPngBlob()`：合成底色+绘制层为 PNG
  - `exportReferenceImageBlob({width,height,mimeType,quality})`：缩放导出（默认用 JPEG）

2) `components/VideoGenerator.tsx`
- 点击“开始”：
  - 导出较小 JPEG（用于 caption + 视频 prompt）
  - `POST /api/generate`（`mode:"smart"`）
- pending（202）时轮询：
  - `action:"content"` + `action:"status"`（偶尔）
- 服务端若返回 `{ url }`：直接用 `<video src>` 播放，并“下载”打开新标签页

3) `app/api/generate/route.ts`
- 读取环境变量：`AIHUBMIX_API_KEY`, `AIHUBMIX_BASE_URL`
- smart 模式：
  - `captionDoodle()` 调 `POST /chat/completions`（默认 `gpt-4o-mini`，可用 `AIHUBMIX_CAPTION_MODEL` 改）
  - 用 `wan2.2-t2v-plus` 调 `POST /videos`
- 轮询：
  - `GET /videos/{tid}`
  - `GET /videos/{tid}/content`
- 关键：解析 `video is still being generated (tid: ...)` 为 202 pending；识别 OSS 签名直链并回 `{ url }`

## Prompt 策略（你改风格主要改这里）

- 前端默认风格提示词（绘本/蜡笔、遵循涂鸦颜色构图、背景自动匹配、动作明显但温柔）：
  - `components/VideoGenerator.tsx`
- 服务端在 smart 模式会把 caption 的 SUBJECT/COLORS/COMPOSITION 拼进 `finalPrompt`，并附加 Hard rules + Negative：
  - `app/api/generate/route.ts`

## 下次要加“模型选择”从哪里下手

- 先读：`docs/MODEL_SELECTION.md`
- 入口文件：
  - UI：`components/VideoGenerator.tsx`（增加 preset 选择按钮/设置）
  - Backend：`app/api/generate/route.ts`（做 allowlist + 根据 preset 选 model/size/seconds/策略）

## 版本号/品牌

- 标题：`神笔CC`：`app/layout.tsx`
- 全局字体优先幼圆：`app/globals.css`
- build 版本：`next.config.js` 注入 `NEXT_PUBLIC_APP_VERSION`，页面 chip 展示：`lib/version.ts` + `app/page.tsx`

## 环境变量（本地 & Vercel）

- `.env`（本地，不提交）：
  - `AIHUBMIX_API_KEY`（必填）
  - `AIHUBMIX_BASE_URL`（可选，默认 `https://aihubmix.com/v1`）
  - `AIHUBMIX_CAPTION_MODEL`（可选，默认 `gpt-4o-mini`）
- `.env.example`：模板

## 文件入口索引（从哪开始看）

- UI 主页面：`app/page.tsx`
- 左侧涂鸦：`components/DoodlePad.tsx`
- 右侧生成器：`components/VideoGenerator.tsx`
- 后端路由：`app/api/generate/route.ts`
- 全局样式：`app/globals.css`
- 代码说明：`docs/CODEBASE.md`
- 衔接报告：`docs/HANDOFF_REPORT.md`
- 版本页面：`/version`（`app/version/page.tsx`），API：`/api/version`
