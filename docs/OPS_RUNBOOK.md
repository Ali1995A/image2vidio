# Ops Runbook（运维手册）

本文档面向本项目的日常运维与故障处理，覆盖环境配置、发布、巡检、应急与回滚。

## 1. 系统概览

- 应用类型：Next.js 16（App Router）单体应用
- 核心能力：左侧涂鸦，右侧调用 `/api/generate` 生成 5 秒动画视频
- 运行平台：本地 Node.js / Vercel
- 上游依赖：AIHubMix（默认 `https://aihubmix.com/v1`）

关键模块：
- 前端：`components/DoodlePad.tsx`、`components/VideoGenerator.tsx`
- 服务端接口：`app/api/generate/route.ts`
- 版本信息：`/version`、`/api/version`

## 2. 环境变量

必填：
- `AIHUBMIX_API_KEY`：上游 API Key

可选：
- `AIHUBMIX_BASE_URL`：默认 `https://aihubmix.com/v1`
- `AIHUBMIX_CAPTION_MODEL`：默认 `gpt-4o-mini`

配置位置：
- 本地：复制 `.env.example` 为 `.env`
- Vercel：Project -> Settings -> Environment Variables

## 3. 启动与发布

本地开发：

```bash
npm i
npm run dev
```

生产构建自检：

```bash
npm run build
npm run start
```

Vercel 发布：
1. 推送代码到主分支（或触发目标分支部署）。
2. 在 Vercel 查看 Deployment 状态为 `Ready`。
3. 打开 `/version` 检查 `build` 是否与本次提交一致。

## 4. 发布后巡检（Smoke Test）

每次发布后至少执行以下检查：

1. 页面可访问：首页正常加载，左右栏正常显示。
2. 版本正确：`/version` 显示当前构建版本。
3. API 正常：`/api/version` 返回 200 JSON。
4. 主链路：手绘简图 -> 点击“开始” -> 生成成功并可播放。
5. 下载能力：点击“下载”可拿到视频（本地 blob 或直链）。

## 5. 运行时观测重点

重点关注以下异常信号：
- `/api/generate` 5xx 升高
- 生成耗时显著升高（轮询时间变长）
- 上游返回非视频内容（`返回不是视频`）
- `TLS handshake timeout`

建议日志字段（如接入日志平台）：
- `action`（generate/status/content）
- `tid`
- 上游状态码
- 错误摘要（脱敏）
- 总耗时

## 6. 常见故障与处理

### 6.1 现象：`Missing apiKey`

原因：
- 未配置 `AIHUBMIX_API_KEY`，或配置在错误环境（Preview/Production）中。

处理：
1. 检查 Vercel 环境变量是否存在。
2. 确认变量作用域（Production/Preview/Development）正确。
3. 重新部署后复测。

### 6.2 现象：长时间 pending（一直 202）

原因：
- 上游排队或处理慢。

处理：
1. 检查上游服务状态与配额。
2. 用 `tid` 查询 `action:"status"` 判断是否失败态。
3. 若频繁超时，先降并发、提醒用户重试，必要时切备用上游。

### 6.3 现象：`Video generation failed`

已知约束：
- 当前 wan 链路固定 5 秒，短于 5 秒易失败。

处理：
1. 确认请求参数未改动时长限制。
2. 检查上游模型可用性。
3. 观察是否为阶段性上游故障，必要时重试。

### 6.4 现象：`返回不是视频`

原因：
- 上游返回 JSON/文本错误页，或容器头不匹配。

处理：
1. 记录错误 snippet（注意脱敏）。
2. 检查上游 content-type 与 body 是否一致。
3. 优先走 `tid` + `content/status` 轮询，不直接判成功。

### 6.5 现象：`TLS handshake timeout`

原因：
- 服务端拉取 OSS 签名地址超时。

当前策略：
- 服务端返回 `{ url }`，前端浏览器直连播放/下载。

处理：
1. 确认是否命中直链返回分支。
2. 若未命中，检查上游返回结构是否变化。

## 7. 回滚流程

Vercel 回滚建议：
1. 打开 Vercel 项目 Deployments。
2. 选择上一个稳定版本执行 `Promote to Production`。
3. 回滚后立即执行第 4 节 Smoke Test。

回滚触发条件（建议）：
- 发布后 10 分钟内 `/api/generate` 5xx 持续异常
- 核心链路不可用且无法在 15 分钟内修复

## 8. 安全与合规

- API Key 仅放服务端环境变量，不下发到浏览器。
- 日志中禁止打印完整 API Key 与完整用户图片数据。
- 对外错误信息可读但不暴露内部敏感细节。

## 9. 值班操作清单（Checklist）

日常：
1. 检查昨日错误率与生成成功率。
2. 抽样验证 1 次端到端生成链路。
3. 检查 Vercel 与上游额度/配额。

发布日：
1. 发布前确认环境变量。
2. 发布后执行 Smoke Test。
3. 观察 15-30 分钟错误率与生成耗时。

事故中：
1. 先恢复可用性（回滚/降级）。
2. 再定位根因（上游、配置、代码）。
3. 记录时间线与改进项。
