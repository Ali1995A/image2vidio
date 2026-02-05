# image2vidio

粉色系（iOS 审美）横屏页面：
- 左侧：涂鸦（画笔/笔宽/调色板/底色/橡皮擦/全屏/加载本地图片）
 - 右侧：基于涂鸦的动漫风格视频生成（wan 系列固定 5 秒；当前用“智能：先描述涂鸦 → 再 t2v”来稳定生成），支持下载/分享

## 本地运行

```bash
npm i
npm run dev
```

打开 `http://localhost:3000`。

## Vercel 部署

这是 Next.js 项目，直接在 Vercel 导入 GitHub 仓库即可。

## API Key

推荐用环境变量（更安全）：

- 本地：复制 `.env.example` → `.env`，填 `AIHUBMIX_API_KEY`
- Vercel：Project → Settings → Environment Variables
  - `AIHUBMIX_API_KEY`（必填）
  - `AIHUBMIX_BASE_URL`（可选，默认 `https://aihubmix.com/v1`）

右侧不提供手动输入 `API Key` 的功能（统一使用环境变量）。

## 代码衔接说明

见 `docs/CODEBASE.md`。
