import { APP_VERSION, BUILD_AT, VERCEL_DEPLOYMENT_ID, VERCEL_ENV } from "../../lib/version";

export const dynamic = "force-static";

function line(label: string, value: string) {
  return (
    <div className="row" key={label}>
      <div className="label">{label}</div>
      <div style={{ fontWeight: 850 }}>{value || "-"}</div>
    </div>
  );
}

export default function VersionPage() {
  return (
    <main
      style={{
        height: "100vh",
        padding: "env(safe-area-inset-top) env(safe-area-inset-right) env(safe-area-inset-bottom) env(safe-area-inset-left)",
      }}
    >
      <div className="panelInner" style={{ height: "100%" }}>
        <div className="panelHeader">
          <div className="panelTitle">shén bǐ CC 神笔CC · bǎn běn 版本</div>
          <div className="chip">build {APP_VERSION}</div>
        </div>

        <div className="controls" style={{ gap: 12 }}>
          {line("App Version", APP_VERSION)}
          {line("Build At", BUILD_AT)}
          {line("Vercel Env", VERCEL_ENV)}
          {line("Deployment ID", VERCEL_DEPLOYMENT_ID)}
          <div className="hint">
            如果你看到的 build 不是最新 commit，请在 Vercel 里确认部署是否完成（或是否命中了旧缓存）。
          </div>
          <div className="btnRow">
            <a className="btn btnPrimary" href="/" style={{ textDecoration: "none", display: "inline-flex" }}>
              huí qù 回去
            </a>
          </div>
        </div>
      </div>
    </main>
  );
}

