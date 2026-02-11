import { NextResponse } from "next/server";

export const runtime = "nodejs";

export async function GET() {
  const payload = {
    appVersion: process.env.NEXT_PUBLIC_APP_VERSION || "dev",
    buildAt: process.env.NEXT_PUBLIC_BUILD_AT || "",
    vercelEnv: process.env.NEXT_PUBLIC_VERCEL_ENV || "",
    deploymentId: process.env.NEXT_PUBLIC_VERCEL_DEPLOYMENT_ID || "",
    now: new Date().toISOString(),
  };
  return NextResponse.json(payload, {
    headers: { "cache-control": "no-store" },
  });
}

