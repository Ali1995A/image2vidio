# Codebase Guide（代码衔接说明）

这份文档用于“快速重新上手”本仓库：你可以从这里按模块定位代码、理解数据流、以及知道改动应该落在哪个文件。

## 1. 项目目标与页面结构

目标：在 iPad 横屏（第一代 iPad Pro 作为主优化对象）上，用粉色 iOS 风格 UI：
- 左侧：涂鸦画板（画笔/橡皮/笔宽/调色板/底色/全屏/加载本地图片）
- 右侧：把左侧涂鸦作为输入，调用 `wan2.2-i2v-plus` 生成短视频（当前 1–3 秒，默认 1 秒）

入口页：
- `app/page.tsx`：左右两栏容器与标题文案（带“拼音+汉字”展示），并把 `doodleRef` 传给右侧生成器组件。
- `app/layout.tsx`：全局 `metadata` 与 `viewport`（适配 iOS safe-area）。
- `app/globals.css`：全局粉色主题、布局网格、控件样式、拼音字体（`CC Pinyin`）与相关样式类。

## 2. 关键数据流（从涂鸦到视频）

核心思路：右侧组件只依赖一个“可以导出 PNG”的句柄（handle），不直接关心左侧内部实现。

1) 左侧 `components/DoodlePad.tsx`
- 通过 `forwardRef` 暴露 `exportPngBlob()`：把“当前绘制层 canvas + 底色 bgColor”合成 PNG Blob。
- 画画发生在 `<canvas>` 上：指针事件（pointerdown/move/up）画线或擦除。
- 橡皮实现：`globalCompositeOperation = "destination-out"`（擦掉像素）。

2) 右侧 `components/VideoGenerator.tsx`
- 点击“开始”：
  - 调 `doodleRef.current.exportPngBlob()` 拿到 PNG
  - 转成 `data:image/...;base64,...`（`blobToDataUrl`）
  - `fetch("/api/generate")` 发给服务端
- 服务端可能返回三种情况：
  - 直接返回视频二进制（200 + video/*）
  - 返回 JSON/文本但包含 `tid`（表示正在生成）
  - 返回 202 `{ pending:true, tid }`（明确 pending）
- pending 时进入轮询：对 `/api/generate` 发送 `action:"content"` 和偶尔 `action:"status"`，直到拿到真实视频二进制。

3) 服务端 `app/api/generate/route.ts`
- 负责：
  - 从环境变量读取 `AIHUBMIX_API_KEY` / `AIHUBMIX_BASE_URL`
  - 把 PNG 以 `FormData` 上传到上游（`POST {baseUrl}/videos`）
  - 处理“上游还在生成”的各种返回形式，并统一向前端返回 202 或可轮询的 `tid`
  - 提供轮询接口：
    - `action:"status"` → `GET /videos/{tid}`（透传/解析）
    - `action:"content"` → `GET /videos/{tid}/content`（拿视频内容）
- 关键防御：
  - 不盲信 `content-type`，会嗅探二进制头判断是否 MP4/WebM
  - 上游返回 `octet-stream` 但不是视频容器时，会返回 502 + snippet，避免“看似成功但打不开”的假视频

## 3. 环境变量与部署（Vercel）

本地 `.env`（不会提交）：
- `AIHUBMIX_API_KEY`：必填，上游 API Key
- `AIHUBMIX_BASE_URL`：可选，默认 `https://aihubmix.com/v1`

模板：
- `.env.example`：给 Vercel/本地配置对照用

Vercel 配置路径：
- Project → Settings → Environment Variables
  - 添加 `AIHUBMIX_API_KEY`
  - 可选添加 `AIHUBMIX_BASE_URL`

说明：当前右侧 UI **不提供**手工输入 API Key（避免在浏览器端暴露密钥）；所有请求均通过 `/api/generate` 服务端转发。

## 4. 模块说明

### 4.1 涂鸦画板：`components/DoodlePad.tsx`

功能点：
- 画笔/橡皮/清除/加载图片/全屏（不支持 fullscreen 时走“最大化”兜底）
- 笔宽滑块：统一影响画笔与橡皮
- 调色板：overlay 弹层（快速色、黑白灰、最近颜色、256 色墙）
- 最近颜色：localStorage `image2vidio.recentBrushColors`

实现要点：
- 画布 resize：使用 `ResizeObserver`
  - “只扩不缩”避免对已有像素做缩放重采样导致变糊
  - 旋转或全屏时，会扩展内部像素尺寸并把旧像素 1:1 拷贝过去
- 载入图片：读取本地文件后 `drawImage` 到 canvas 中央并按比例适配

### 4.2 视频生成 UI：`components/VideoGenerator.tsx`

功能点：
- “开始/下载/分享”
- 时长滑块：当前范围 `1–3s`（step=0.5）
- pending 轮询：显示 `tid`、耗时与 cycle 信息

实现要点：
- `runIdRef`：避免用户快速多次点击时，旧轮询覆盖新结果
- 视频验证：
  - `sniffBlobVideoType` 读取前 16 bytes 判断 MP4/WebM
  - 不接受“声明 video/mp4 但嗅探不匹配”的响应，避免拿到错误内容

### 4.3 服务端 API：`app/api/generate/route.ts`

对外接口（同一个 endpoint）：
- `POST /api/generate`（生成/取内容/取状态）
  - 生成：`{ seconds, prompt, imageDataUrl }`
  - 状态：`{ action:"status", tid }`
  - 内容：`{ action:"content", tid }`

上游接口（默认 baseUrl=`https://aihubmix.com/v1`）：
- `POST /videos`：提交生成任务
- `GET /videos/{tid}`：查询状态
- `GET /videos/{tid}/content`：获取最终视频

参数：
- `model=wan2.2-i2v-plus`
- `seconds`：当前 clamp 到 `1–3`（默认 1），并设置 `size=832x480` 横屏 480p

### 4.4 拼音展示与字体

- `lib/pinyin.ts`：`py()` 将输入字符串 NFD 分解并把 `a` 替换为 `ɑ`，减少不同系统字体回退导致的音调显示不一致问题。
- `public/fonts/cc-pinyin.woff2`：拼音字体
- `app/globals.css`：`.pinyin-text` 使用该字体，并关闭连字避免音标错位。

### 4.5 版本号（便于定位线上构建）

- `next.config.js`：注入 `NEXT_PUBLIC_APP_VERSION`
  - 优先使用 Vercel 的 `VERCEL_GIT_COMMIT_SHA`
  - 否则尝试读取本地 `git rev-parse --short HEAD`
- `lib/version.ts`：`APP_VERSION` 从 `NEXT_PUBLIC_APP_VERSION` 读取
- `app/page.tsx`：右上角 chip 显示 build

## 5. 常见改动点（快速定位）

想改 UI 视觉（粉色主题/间距/按钮/布局）：
- `app/globals.css`

想改左侧画板功能：
- `components/DoodlePad.tsx`

想改右侧生成逻辑、轮询策略、时长范围：
- `components/VideoGenerator.tsx`

想改上游接口参数（例如 duration 上限、分辨率、字段名）：
- `app/api/generate/route.ts`

想改“标题/按钮文案/拼音显示”：
- `app/page.tsx` + `lib/pinyin.ts`

## 6. 已知约束/注意事项

- 生成时长目前是 `1–3s`（UI 与服务端都 clamp 了）；如果你要恢复到 `3–5s`，需要同时改：
- 生成时长目前是 `1–3s`（默认 1s），UI 与服务端都有 clamp；如果要扩大范围，需要同时改：
  - `components/VideoGenerator.tsx`
  - `app/api/generate/route.ts`
- “全屏”在部分 iOS Safari 上可能受限制：组件有 fallback 的最大化样式（`canvasStageMax`）。
- 轮询策略偏保守：遇到上游偶发返回 JSON/text 但仍带 `tid` 的情况，会继续等待而不是直接失败。
