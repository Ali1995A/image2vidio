# Model Selection Guide（模型选择与扩展报告）

目的：这份文档专门写给“以后维护 / 以后要加模型选择”的你（或 AI），让你不用重新翻全仓库也能快速改出“可选模型 / 可选分辨率 / 可变时长（若模型支持）”。

> 时间基准：本文基于仓库当前实现（右侧默认 `smart`：涂鸦 → caption → t2v），以及 2026-02-14 在 AIHubMix 页面可见的计费信息。

---

## 1) 当前到底是哪些模型在驱动本 App？

本 App 有两段“AI”：

1. **Caption（看图理解涂鸦）**
   - 位置：`app/api/generate/route.ts`
   - 上游：`POST {AIHUBMIX_BASE_URL}/chat/completions`
   - 模型：环境变量 `AIHUBMIX_CAPTION_MODEL`（默认 `gpt-4o-mini`）
   - 输出格式：严格 4 行
     - `SUBJECT=...`
     - `INTENT=...`
     - `COLORS=...`
     - `COMPOSITION=...`

2. **Video（生成视频）**
   - 位置：`app/api/generate/route.ts`
   - 上游：`POST {AIHUBMIX_BASE_URL}/videos`
   - 默认模型：`wan2.2-t2v-plus`
   - 当前强约束：**服务端固定把时长锁定为 5 秒**（避免 1–3s 失败）

前端提示词（风格/动作/严格保留涂鸦笔画）主要在：
- `components/VideoGenerator.tsx`（风格按钮 + buildPrompt）

---

## 2) 计费对比（用于做“模型选择”时的成本预估）

> 价格会变，建议以后都以 `https://aihubmix.com/call/mdl_info/<modelId>` 为准，做一次抓取/人工核对再写入代码或文档。

### Wan 2.2（当前默认）

`wan2.2-t2v-plus` / `wan2.2-i2v-plus`（AIHubMix 页面显示为按秒计费）：
- 480p：`$0.0192 / 秒`
- 1080p：`$0.0959 / 秒`

### 即梦 DreamVideo 3.0（Doubao）

AIHubMix 页面显示为按秒计费（并且有 720p / 1080p / pro 三档）：
- `jimeng-3.0-720p`：`$0.038 / 秒`
- `jimeng-3.0-1080p`：`$0.086 / 秒`
- `jimeng-3.0-pro`：`$0.137 / 秒`

### 快速估算公式（建议未来放到后台或调试页）

`单次成本 ≈ seconds * pricePerSecond`

例如 5 秒：
- Wan 480p：约 `$0.096`
- 即梦 720p：约 `$0.19`
- 即梦 1080p：约 `$0.43`
- Wan 1080p：约 `$0.48`

---

## 3) 为什么现在是 “smart：涂鸦 → caption → t2v”？

目标是“**严格保留儿童涂鸦笔画**，只做轻量上色/轻量补线/加简单背景 + 明显但温柔的动作”。

经验结论（当前仓库策略）：
- 直接 i2v 在某些模型/参数下更容易失败或跑偏（曾出现频繁 `Video generation failed`）。
- 用 caption 把涂鸦意图结构化（SUBJECT/INTENT/COLORS/COMPOSITION），再拼上硬规则与负面词，整体更稳。

对应代码：
- 前端：`components/VideoGenerator.tsx`（全局严格约束 + 风格 preset）
- 服务端：`app/api/generate/route.ts`（caption + Hard rules + Negative）

---

## 4) “模型选择”要怎么加（推荐的最小改动方案）

### 4.1 你要加的不是“直接暴露 modelId”，而是 “Preset（预设）”

原因：
- 不同模型支持的参数不一样（`seconds`、`size`、是否必须 i2v、是否需要 `image_url`、是否要 multipart）。
- “给 5 岁孩子用”的 UI 也不适合出现技术名词。

推荐定义：
- `presetId`（前端按钮用）：例如 `wan_480p`, `wan_1080p`, `jimeng_720p`, `jimeng_1080p`
- 服务端做 allowlist：`presetId -> { modelId, size, secondsPolicy, strategy }`

### 4.2 推荐把“策略”也纳入 preset

最常见是 3 种策略：
1) `smart_t2v`：caption + t2v（当前默认）
2) `direct_t2v`：不 caption，直接用 prompt（更便宜更快，但更不稳）
3) `i2v`：把图片作为强条件输入（最像 image2video，但不同模型实现差异最大）

### 4.3 服务端改动点（最省事、风险最小）

文件：`app/api/generate/route.ts`

新增输入字段（建议）：
- `presetId?: string`（必走 allowlist）
- `size?: string`（可选，但最好由 preset 决定）

服务端做 3 件事：
1) **校验**：只允许 preset allowlist 中的项
2) **选模型 + 选 size + 选 seconds 策略**
   - Wan：当前固定 5s（已有 `secondsFixed`）
   - 即梦：页面示例存在 `seconds="6"`，理论上支持可变；但是否稳定、是否有最小值，需要你实测后再放开
3) **组装上游请求**（JSON / multipart / image_url）

### 4.4 “即梦 i2v”目前的关键不确定点（必须先确认）

即梦页面示例里，i2v 是通过 `image_url=...` 传入（并提示“输入图像必须与目标视频分辨率匹配”）。

而本仓库当前只有：
- `data:image/...`（base64）传给服务端
- multipart 的 `input_reference`（用于 wan i2v 的 fallback）

所以如果你要做“即梦真正 i2v”，通常需要额外一步：
- **把涂鸦图片变成一个可公网访问的 URL**（例如上传到对象存储 / Vercel Blob / 你自己的 CDN）
- 然后把该 URL 作为 `image_url` 传给 `/videos`

如果不想新增上传链路，你仍然可以先把“即梦”作为 `smart_t2v` / `direct_t2v` 的可选模型来集成（不走 i2v）。

---

## 5) UI 侧怎么做“模型选择”（建议做成家长模式/设置区）

文件：`components/VideoGenerator.tsx`

建议：
- 默认仍只露出“风格按钮”（蜡笔/彩铅/水彩/漫画/纸偶/涂鸦）
- “模型选择”放到一个更隐蔽的位置（例如右侧面板的齿轮按钮），避免孩子误操作导致费用暴涨
- 显示文案用拼音+汉字，但不要出现 `wan/jimeng` 技术名词（面向孩子）；技术信息可放在 `/version` 或 debug panel

---

## 6) 验证清单（加模型后必须跑一遍）

1) `/version` 看 build 是否最新（避免“以为改了但没部署”）
2) 生成 3 次，确认：
   - 能拿到视频（或 `{url}`）而不是 JSON 假视频
   - 动作明显（不是静态图）
   - 构图/线条/主色调没有被“精致化重绘”
3) 如果走 `{url}`：
   - iPad Safari 能否直接播放
   - “下载”能否保存到相册（iOS 通常需要用户手势触发）

