import { NextResponse } from "next/server";

export const runtime = "nodejs";

function pickId(json: unknown): string | null {
  if (!json || typeof json !== "object") return null;
  const anyJson = json as Record<string, unknown>;
  const direct = anyJson["id"] ?? anyJson["video_id"] ?? anyJson["videoId"];
  if (typeof direct === "string" && direct) return direct;

  const data = anyJson["data"];
  if (Array.isArray(data) && data.length) {
    const first = data[0] as any;
    const id = first?.id ?? first?.video_id ?? first?.videoId;
    if (typeof id === "string" && id) return id;
  }
  return null;
}

function pickUrl(json: unknown): string | null {
  if (!json || typeof json !== "object") return null;
  const anyJson = json as Record<string, unknown>;
  const direct = anyJson["url"] ?? anyJson["content_url"] ?? anyJson["contentUrl"];
  if (typeof direct === "string" && direct) return direct;

  const data = anyJson["data"];
  if (Array.isArray(data) && data.length) {
    const first = data[0] as any;
    const url = first?.url ?? first?.content_url ?? first?.contentUrl;
    if (typeof url === "string" && url) return url;
  }
  return null;
}

async function dataUrlToBlob(dataUrl: string): Promise<Blob> {
  const m = /^data:([^;]+);base64,(.+)$/i.exec(dataUrl);
  if (!m) throw new Error("Bad imageDataUrl");
  const mime = m[1];
  const base64 = m[2];
  const bytes = Uint8Array.from(Buffer.from(base64, "base64"));
  return new Blob([bytes], { type: mime });
}

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const apiKey = String(body?.apiKey || "").trim();
    const baseUrl = String(body?.baseUrl || "https://aihubmix.com/v1").trim().replace(/\/$/, "");
    const seconds = Number(body?.seconds || 4);
    const prompt = String(body?.prompt || "").trim();
    const imageDataUrl = String(body?.imageDataUrl || "").trim();

    if (!apiKey) return new NextResponse("Missing apiKey", { status: 400 });
    if (!imageDataUrl.startsWith("data:image/"))
      return new NextResponse("Missing imageDataUrl", { status: 400 });

    const duration = Math.max(3, Math.min(5, Number.isFinite(seconds) ? seconds : 4));

    const pngBlob = await dataUrlToBlob(imageDataUrl);
    const form = new FormData();
    form.set("model", "wan2.2-i2v-plus");
    form.set("duration", String(duration));
    if (prompt) form.set("prompt", prompt);
    form.set("input_reference", pngBlob, "doodle.png");

    const genRes = await fetch(`${baseUrl}/videos`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
      },
      body: form,
    });

    const genContentType = genRes.headers.get("content-type") || "";
    if (!genRes.ok) {
      const t = await genRes.text();
      return new NextResponse(t || `Upstream error (${genRes.status})`, { status: 502 });
    }

    if (genContentType.startsWith("video/")) {
      const ab = await genRes.arrayBuffer();
      return new NextResponse(ab, {
        status: 200,
        headers: {
          "content-type": genContentType,
          "cache-control": "no-store",
        },
      });
    }

    const genJson = await genRes.json().catch(async () => ({ raw: await genRes.text() }));
    const directUrl = pickUrl(genJson);
    if (directUrl) {
      const videoRes = await fetch(directUrl, { headers: { Authorization: `Bearer ${apiKey}` } });
      if (!videoRes.ok) {
        const t = await videoRes.text();
        return new NextResponse(t || `Video fetch failed (${videoRes.status})`, { status: 502 });
      }
      const ct = videoRes.headers.get("content-type") || "video/mp4";
      const ab = await videoRes.arrayBuffer();
      return new NextResponse(ab, {
        status: 200,
        headers: {
          "content-type": ct,
          "cache-control": "no-store",
        },
      });
    }

    const id = pickId(genJson);
    if (!id) {
      return NextResponse.json(
        { error: "Upstream response missing video id", upstream: genJson },
        { status: 502 },
      );
    }

    const contentRes = await fetch(`${baseUrl}/videos/${encodeURIComponent(id)}/content`, {
      headers: { Authorization: `Bearer ${apiKey}` },
    });
    if (!contentRes.ok) {
      const t = await contentRes.text();
      return new NextResponse(t || `Content fetch failed (${contentRes.status})`, { status: 502 });
    }

    const ct = contentRes.headers.get("content-type") || "video/mp4";
    const ab = await contentRes.arrayBuffer();
    return new NextResponse(ab, {
      status: 200,
      headers: {
        "content-type": ct,
        "cache-control": "no-store",
      },
    });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : String(e) },
      { status: 500 },
    );
  }
}

