import { NextResponse } from "next/server";

export const runtime = "nodejs";

type PendingResult = { pending: true; tid: string; message?: string };

function sniffVideoContentType(contentType: string, buf: ArrayBuffer): string | null {
  const ct = (contentType || "").split(";")[0]?.trim().toLowerCase();
  if (ct.startsWith("video/")) return ct;

  const bytes = new Uint8Array(buf);

  // MP4: [size][ftyp]...
  if (bytes.length >= 12) {
    if (bytes[4] === 0x66 && bytes[5] === 0x74 && bytes[6] === 0x79 && bytes[7] === 0x70) {
      return "video/mp4";
    }
  }

  // WebM/Matroska EBML header: 1A 45 DF A3
  if (bytes.length >= 4) {
    if (bytes[0] === 0x1a && bytes[1] === 0x45 && bytes[2] === 0xdf && bytes[3] === 0xa3) {
      return "video/webm";
    }
  }

  return null;
}

function arrayBufferToTextSnippet(buf: ArrayBuffer, maxChars: number) {
  try {
    const text = Buffer.from(buf).toString("utf8");
    return text.slice(0, maxChars);
  } catch {
    return "";
  }
}

function parsePendingTidFromText(text: string): PendingResult | null {
  const s = String(text || "");
  // Examples:
  // - "video is still being generated (tid: 2026...)"
  // - {"tid":"2026..."} or {"tid":2026...}
  const m =
    /tid:\s*([0-9]+)/i.exec(s) ??
    /"tid"\s*:\s*"([0-9]+)"/i.exec(s) ??
    /"tid"\s*:\s*([0-9]+)/i.exec(s) ??
    /\btid=([0-9]+)/i.exec(s);
  if (!m) return null;
  return { pending: true, tid: m[1], message: s.slice(0, 200) };
}

function parsePendingTidFromJson(json: unknown): PendingResult | null {
  if (!json) return null;

  if (typeof json === "string") return parsePendingTidFromText(json);
  if (typeof json !== "object") return null;

  const anyJson = json as Record<string, any>;
  const candidates = [
    anyJson?.error?.message,
    anyJson?.message,
    anyJson?.error,
    anyJson?.detail,
    anyJson?.raw,
  ];

  for (const c of candidates) {
    if (typeof c !== "string") continue;
    const pending = parsePendingTidFromText(c);
    if (pending) return pending;
  }

  try {
    const s = JSON.stringify(json);
    return parsePendingTidFromText(s.slice(0, 2000));
  } catch {
    return null;
  }
}

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

async function fetchVideoContent(params: {
  baseUrl: string;
  apiKey: string;
  tid: string;
}): Promise<Response> {
  const { baseUrl, apiKey, tid } = params;
  return await fetch(`${baseUrl}/videos/${encodeURIComponent(tid)}/content`, {
    headers: { Authorization: `Bearer ${apiKey}` },
  });
}

async function fetchVideoStatus(params: {
  baseUrl: string;
  apiKey: string;
  tid: string;
}): Promise<Response> {
  const { baseUrl, apiKey, tid } = params;
  return await fetch(`${baseUrl}/videos/${encodeURIComponent(tid)}`, {
    headers: { Authorization: `Bearer ${apiKey}` },
  });
}

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const envApiKey = String(process.env.AIHUBMIX_API_KEY || "").trim();
    const envBaseUrl = String(process.env.AIHUBMIX_BASE_URL || "").trim();
    const apiKey = String(body?.apiKey || envApiKey || "").trim();
    const baseUrl = String(body?.baseUrl || envBaseUrl || "https://aihubmix.com/v1")
      .trim()
      .replace(/\/$/, "");
    const seconds = Number(body?.seconds || 2);
    const prompt = String(body?.prompt || "").trim();
    const imageDataUrl = String(body?.imageDataUrl || "").trim();
    const action = String(body?.action || "").trim().toLowerCase();
    const tid = String(body?.tid || "").trim();

    if (!apiKey)
      return new NextResponse(
        "Missing apiKey. Set AIHUBMIX_API_KEY in Vercel env (or pass apiKey from client).",
        { status: 400 },
      );

    if (action === "status") {
      if (!tid) return new NextResponse("Missing tid", { status: 400 });

      const statusRes = await fetchVideoStatus({ baseUrl, apiKey, tid });
      const ct = statusRes.headers.get("content-type") || "";
      const ctLower = ct.toLowerCase();
      const text = await statusRes.text();

      const maybeJson = (() => {
        if (ctLower.includes("application/json")) {
          try {
            return JSON.parse(text) as unknown;
          } catch {
            return null;
          }
        }
        try {
          if (text.trim().startsWith("{") || text.trim().startsWith("[")) return JSON.parse(text) as unknown;
        } catch {
          // ignore
        }
        return null;
      })();

      if (!statusRes.ok) {
        const pending = parsePendingTidFromJson(maybeJson) ?? parsePendingTidFromText(text);
        if (pending) return NextResponse.json(pending, { status: 202 });
        return new NextResponse(text || `Status fetch failed (${statusRes.status})`, { status: 502 });
      }

      const pending = parsePendingTidFromJson(maybeJson) ?? parsePendingTidFromText(text);
      if (pending) return NextResponse.json(pending, { status: 202 });

      if (maybeJson) {
        return NextResponse.json(maybeJson, {
          status: 200,
          headers: { "cache-control": "no-store" },
        });
      }

      return new NextResponse(text || "Upstream returned non-json status", {
        status: 200,
        headers: { "cache-control": "no-store" },
      });
    }

    if (action === "content") {
      if (!tid) return new NextResponse("Missing tid", { status: 400 });

      const contentRes = await fetchVideoContent({ baseUrl, apiKey, tid });
      const ct = contentRes.headers.get("content-type") || "";
      const ctLower = ct.toLowerCase();
      if (!contentRes.ok) {
        const text = await contentRes.text();
        const maybeJson = ctLower.includes("application/json")
          ? (() => {
              try {
                return JSON.parse(text) as unknown;
              } catch {
                return null;
              }
            })()
          : null;
        const pending = parsePendingTidFromJson(maybeJson) ?? parsePendingTidFromText(text);
        if (pending) return NextResponse.json(pending, { status: 202 });
        return new NextResponse(text || `Content fetch failed (${contentRes.status})`, { status: 502 });
      }

      // Some upstreams return JSON with 200 while still processing.
      if (ctLower.includes("application/json")) {
        const text = await contentRes.text();
        const maybeJson = (() => {
          try {
            return JSON.parse(text) as unknown;
          } catch {
            return null;
          }
        })();
        const pending = parsePendingTidFromJson(maybeJson) ?? parsePendingTidFromText(text);
        if (pending) return NextResponse.json(pending, { status: 202 });
        return new NextResponse(text || "Upstream returned json, not video", { status: 502 });
      }

      const ab = await contentRes.arrayBuffer();
      const sniffed = sniffVideoContentType(ct, ab);
      if (!sniffed) {
        const snippet = arrayBufferToTextSnippet(ab, 800);
        const pending = parsePendingTidFromText(snippet);
        if (pending) return NextResponse.json(pending, { status: 202 });
        return NextResponse.json(
          {
            error: "Content response is not a known video container",
            contentType: ct,
            snippet: snippet || undefined,
          },
          { status: 502 },
        );
      }
      return new NextResponse(ab, {
        status: 200,
        headers: {
          "content-type": sniffed,
          "cache-control": "no-store",
        },
      });
    }

    if (!imageDataUrl.startsWith("data:image/"))
      return new NextResponse("Missing imageDataUrl", { status: 400 });

    const duration = Math.max(1, Math.min(3, Number.isFinite(seconds) ? seconds : 1));

    const pngBlob = await dataUrlToBlob(imageDataUrl);
    const form = new FormData();
    form.set("model", "wan2.2-i2v-plus");
    form.set("duration", String(duration));
    // 480P (landscape) output.
    form.set("size", "832x480");
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
      const text = await genRes.text();
      const maybeJson = (() => {
        try {
          return JSON.parse(text) as unknown;
        } catch {
          return null;
        }
      })();

      const pending = parsePendingTidFromJson(maybeJson) ?? parsePendingTidFromText(text);
      if (pending) return NextResponse.json(pending, { status: 202 });

      return new NextResponse(text || `Upstream error (${genRes.status})`, { status: 502 });
    }

    const isProbablyBinary =
      genContentType.startsWith("video/") ||
      genContentType.toLowerCase().includes("application/octet-stream");

    if (isProbablyBinary) {
      const ab = await genRes.arrayBuffer();
      const sniffed = sniffVideoContentType(genContentType, ab);

      // If upstream gives octet-stream but it's not a real video, don't lie with video/mp4.
      if (!sniffed && genContentType.toLowerCase().includes("application/octet-stream")) {
        const snippet = arrayBufferToTextSnippet(ab, 800);
        return NextResponse.json(
          {
            error: "Upstream returned octet-stream but not a known video container",
            upstreamContentType: genContentType,
            snippet: snippet || undefined,
          },
          { status: 502 },
        );
      }

      return new NextResponse(ab, {
        status: 200,
        headers: {
          "content-type": sniffed ?? genContentType ?? "video/mp4",
          "cache-control": "no-store",
        },
      });
    }

    const genJson = await genRes.json().catch(async () => ({ raw: await genRes.text() }));
    const pendingFromOkJson = parsePendingTidFromJson(genJson);
    if (pendingFromOkJson) return NextResponse.json(pendingFromOkJson, { status: 202 });
    const directUrl = pickUrl(genJson);
    if (directUrl) {
      const videoRes = await fetch(directUrl, { headers: { Authorization: `Bearer ${apiKey}` } });
      if (!videoRes.ok) {
        const t = await videoRes.text();
        return new NextResponse(t || `Video fetch failed (${videoRes.status})`, { status: 502 });
      }
      const ct = videoRes.headers.get("content-type") || "";
      const ab = await videoRes.arrayBuffer();
      const sniffed = sniffVideoContentType(ct, ab);
      return new NextResponse(ab, {
        status: 200,
        headers: {
          "content-type": sniffed ?? ct ?? "video/mp4",
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

    // The "id" here is typically the tid.
    const contentRes = await fetchVideoContent({ baseUrl, apiKey, tid: id });
    if (!contentRes.ok) {
      const t = await contentRes.text();
      const pending = parsePendingTidFromText(t);
      if (pending) return NextResponse.json(pending, { status: 202 });
      return new NextResponse(t || `Content fetch failed (${contentRes.status})`, { status: 502 });
    }

    const ct = contentRes.headers.get("content-type") || "";
    const ab = await contentRes.arrayBuffer();
    const sniffed = sniffVideoContentType(ct, ab);
    return new NextResponse(ab, {
      status: 200,
      headers: {
        "content-type": sniffed ?? ct ?? "video/mp4",
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
