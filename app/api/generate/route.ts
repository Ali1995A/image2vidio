import { NextResponse } from "next/server";

export const runtime = "nodejs";

type PendingResult = { pending: true; tid: string; message?: string };

function isPendingMessage(text: string) {
  const s = String(text || "").toLowerCase();
  return (
    s.includes("still being generated") ||
    s.includes("being generated") ||
    s.includes("generating") ||
    s.includes("processing") ||
    s.includes("queued") ||
    s.includes("running") ||
    s.includes("pending")
  );
}

function parsePendingTidFromText(text: string): PendingResult | null {
  const s = String(text || "");
  if (!isPendingMessage(s)) return null;

  // Avoid treating unrelated "tid" (e.g. token failure) as pending.
  const sLower = s.toLowerCase();
  if (sLower.includes("token") || sLower.includes("获取token")) return null;

  // aihubmix often returns: "video is still being generated (tid: 2026...)"
  const m = /tid:\s*([0-9]{10,})/i.exec(s) ?? /\btid=([0-9]{10,})/i.exec(s);
  if (!m) return null;
  return { pending: true, tid: m[1], message: s.slice(0, 200) };
}

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

function pickJobId(json: unknown): string | null {
  if (!json || typeof json !== "object") return null;
  const anyJson = json as Record<string, any>;
  const direct = anyJson.id ?? anyJson.video_id ?? anyJson.videoId ?? anyJson.tid ?? anyJson.task_id;
  if (typeof direct === "string" && direct) return direct;
  if (typeof direct === "number" && Number.isFinite(direct)) return String(direct);

  const data = anyJson.data;
  if (data && typeof data === "object") {
    const d = data as any;
    const id = d.id ?? d.video_id ?? d.videoId ?? d.tid ?? d.task_id;
    if (typeof id === "string" && id) return id;
    if (typeof id === "number" && Number.isFinite(id)) return String(id);
  }

  return null;
}

function pickStatus(json: unknown): string | null {
  if (!json) return null;
  if (typeof json !== "object") return null;
  const anyJson = json as Record<string, any>;
  const direct = anyJson.status ?? anyJson.state;
  if (typeof direct === "string" && direct) return direct;
  const data = anyJson.data;
  if (data && typeof data === "object") {
    const st = (data as any).status ?? (data as any).state;
    if (typeof st === "string" && st) return st;
  }
  return null;
}

function isTerminalSuccessStatus(status: string) {
  const s = status.trim().toLowerCase();
  return ["succeeded", "success", "completed", "complete", "done", "finished"].includes(s);
}

function isTerminalFailureStatus(status: string) {
  const s = status.trim().toLowerCase();
  return ["failed", "fail", "error", "canceled", "cancelled", "rejected"].includes(s);
}

function parsePendingFromJson(json: unknown): PendingResult | null {
  const jobId = pickJobId(json);
  if (!jobId) return null;
  const st = pickStatus(json);
  if (st && (isTerminalSuccessStatus(st) || isTerminalFailureStatus(st))) return null;
  return { pending: true, tid: jobId };
}

function parsePendingFromAny(jsonOrText: unknown): PendingResult | null {
  if (!jsonOrText) return null;
  if (typeof jsonOrText === "string") return parsePendingTidFromText(jsonOrText);
  if (typeof jsonOrText !== "object") return null;

  const pendingFromJson = parsePendingFromJson(jsonOrText);
  if (pendingFromJson) return pendingFromJson;

  const anyJson = jsonOrText as Record<string, any>;
  const candidates = [
    anyJson?.error?.message,
    anyJson?.message,
    anyJson?.detail,
    anyJson?.error,
    anyJson?.raw,
  ];
  for (const c of candidates) {
    if (typeof c !== "string") continue;
    const pending = parsePendingTidFromText(c);
    if (pending) return pending;
  }
  return null;
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

async function captionDoodle(params: {
  baseUrl: string;
  apiKey: string;
  imageDataUrl: string;
}): Promise<string> {
  const { baseUrl, apiKey, imageDataUrl } = params;
  const model = String(process.env.AIHUBMIX_CAPTION_MODEL || "gemini-3-flash-preview").trim() || "gemini-3-flash-preview";

  const payload = {
    model,
    max_tokens: 120,
    messages: [
      {
        role: "user",
        content: [
          {
            type: "text",
            text:
              "You are describing a child's doodle for an animation prompt.\n" +
              "Return EXACTLY 4 lines (no markdown):\n" +
              "SUBJECT=...\n" +
              "INTENT=... (what the kid likely wants to express)\n" +
              "COLORS=... (list 3-6 simple color words)\n" +
              "COMPOSITION=... (where the subject is placed, scale, empty space)\n" +
              "Keep it short and concrete.",
          },
          {
            type: "image_url",
            image_url: { url: imageDataUrl },
          },
        ],
      },
    ],
  };

  const res = await fetch(`${baseUrl}/chat/completions`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "content-type": "application/json",
    },
    body: JSON.stringify(payload),
  });

  if (!res.ok) {
    const t = await res.text();
    throw new Error(`Caption failed: ${t || `HTTP ${res.status}`}`);
  }

  const j = (await res.json().catch(() => null)) as any;
  const text = String(j?.choices?.[0]?.message?.content || "").trim();
  if (!text) throw new Error("Caption failed: empty response");
  return text;
}

function isLikelyCloudBearCaption(caption: string) {
  const s = String(caption || "").toLowerCase();
  if (!s) return false;

  const hasBear = /\bbear\b|\bteddy\b|小熊|熊/.test(s);
  const hasCloudLike = /\bcloud\b|\bfluffy\b|\bcotton\b|云|云朵|棉花/.test(s);
  const hasRoundCute = /\bround\b|\bchubby\b|\bcute\b|\bkawaii\b|圆|可爱/.test(s);
  const hasFaceCue = /\bears?\b|\bcheek\b|\bblush\b|\bbutton nose\b|\boval eyes?\b|耳朵|腮红|鼻子|眼睛/.test(s);

  // Strong match: bear + cloud-like; weak fallback: cloud-like + round/cute + face cues.
  if (hasBear && hasCloudLike) return true;
  return hasCloudLike && hasRoundCute && hasFaceCue;
}

function cloudBearPromptHint() {
  return (
    `Character steering (only if doodle is similar): CLOUD BEAR (云朵熊).\n` +
    `- keyword must be: 云朵熊 (cloud bear)\n` +
    `- core identity: a BEAR with obvious cloud features; the cloud trait must be visually dominant\n` +
    `- cloud-first silhouette rule: at least 70% of the visible body reads as cloud puffs/clusters, then bear cues are layered on top\n` +
    `- contour rule: use cauliflower-like cloud edges and soft puff lobes, avoid clean animal anatomy lines\n` +
    `- material rule: vapor-cotton look, airy and fluffy volume, soft translucent rim light, no dense fur strands\n` +
    `- keep one single mascot character: a cloud-shaped teddy bear, big fluffy silhouette, round head and round ears\n` +
    `- face design: black oval eyes, tiny dark nose, small smiling mouth, soft pink cheeks\n` +
    `- body design: puffy cotton-cloud body, short chubby limbs formed by cloud puffs, soft rounded edges\n` +
    `- primary color rule (strict): the character body must be cloud-white / white-cloud color as the dominant color\n` +
    `- secondary color rule: only very light sky-blue can appear as subtle shadow/fill; do not shift to gray, beige, or saturated colors\n` +
    `- color direction: white as main color with very light sky-blue shadows; optional tiny peach blush accents\n` +
    `- expression and vibe: gentle, warm, innocent, child-friendly\n` +
    `- background: simple blue-sky cloud scene, minimal details, never distract from the character\n` +
    `- strict negative: do not turn into a normal plush/furry bear, no realistic fur strands, no heavy muscle/body structure; keep it stylized, toy-like, cloud-like`
  );
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

function pickUrlDeep(json: unknown): string | null {
  const direct = pickUrl(json);
  if (direct) return direct;
  if (!json || typeof json !== "object") return null;
  const anyJson = json as Record<string, any>;
  const data = anyJson.data;
  if (data && typeof data === "object" && !Array.isArray(data)) {
    const url =
      (data as any).url ??
      (data as any).content_url ??
      (data as any).contentUrl ??
      (data as any).video_url ??
      (data as any).videoUrl;
    if (typeof url === "string" && url) return url;
  }
  return null;
}

function isRemoteSignedUrl(url: string) {
  const u = String(url || "").trim();
  if (!u) return false;
  // Prefer letting the browser fetch signed OSS URLs; server-side fetch can hit TLS handshake timeouts.
  return /^https:\/\/.+aliyuncs\.com\//i.test(u) || /^https:\/\/.+oss-/i.test(u);
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
    const seconds = Number(body?.seconds ?? 1);
    const prompt = String(body?.prompt || "").trim();
    const imageDataUrl = String(body?.imageDataUrl || "").trim();
    const mode = String(body?.mode || "").trim().toLowerCase();
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
        const pending = parsePendingFromAny(maybeJson ?? text);
        if (pending) return NextResponse.json(pending, { status: 202 });
        return new NextResponse(text || `Status fetch failed (${statusRes.status})`, { status: 502 });
      }

      const pending = parsePendingFromAny(maybeJson ?? text);
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
        const pending = parsePendingFromAny(maybeJson ?? text);
        if (pending) return NextResponse.json(pending, { status: 202 });

        // Fallback: some providers expose a signed URL on status endpoint instead of /content.
        // If /content returns an aihubmix error JSON, try status → url → fetch.
        if (maybeJson && typeof maybeJson === "object") {
          const stRes = await fetchVideoStatus({ baseUrl, apiKey, tid });
          if (stRes.ok) {
            const stJson = await stRes.json().catch(() => null);
            const u = pickUrlDeep(stJson);
            if (u) {
              if (isRemoteSignedUrl(u)) {
                return NextResponse.json(
                  { url: u, tid, status: "completed" },
                  { status: 200, headers: { "cache-control": "no-store" } },
                );
              }
              const videoRes = await fetch(u, { headers: { Authorization: `Bearer ${apiKey}` } });
              if (videoRes.ok) {
                const vct = videoRes.headers.get("content-type") || "";
                const ab = await videoRes.arrayBuffer();
                const sniffed = sniffVideoContentType(vct, ab);
                if (sniffed) {
                  return new NextResponse(ab, {
                    status: 200,
                    headers: { "content-type": sniffed, "cache-control": "no-store" },
                  });
                }
              }
            }
          }
        }
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
        const pending = parsePendingFromAny(maybeJson ?? text);
        if (pending) return NextResponse.json(pending, { status: 202 });

        const u = pickUrlDeep(maybeJson);
        if (u) {
          return NextResponse.json(
            { url: u, tid, status: "completed" },
            { status: 200, headers: { "cache-control": "no-store" } },
          );
        }
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

    const safePrompt =
      prompt || "anime style, cute, colorful, clean lines, soft lighting, smooth motion";

    // Keep server-side duration fixed to 5s for current product behavior.
    const secondsFixed = 5;

    const isSmart = mode === "smart" || mode === "" || mode === "auto";
    const videoModel = "jimeng-3.0-720p";
    const secondsFinal = secondsFixed;

    let finalPrompt = safePrompt;
    let useMultipart = !isSmart; // i2v needs multipart; smart uses t2v json.

    if (isSmart) {
      const caption = await captionDoodle({ baseUrl, apiKey, imageDataUrl });
      const cloudBearHint = isLikelyCloudBearCaption(caption) ? `\n${cloudBearPromptHint()}\n` : "\n";
      finalPrompt =
        `${safePrompt}\n` +
        `Doodle notes:\n${caption}\n` +
        cloudBearHint +
        `Hard rules:\n` +
        `- single main subject, simple shapes, clear silhouette\n` +
        `- strictly preserve the original doodle strokes and imperfections; do NOT smooth or redraw as clean lineart\n` +
        `- preserve doodle line style, color palette, and composition at least 99% (line thickness/shape, position/scale/empty space)\n` +
        `- understand the doodle intent first (use INTENT), then animate it without changing the composition\n` +
        `- base the character on the doodle lines; only do minimal refinement/anthropomorphism (simple face/limbs/accessory) and mostly colorize the existing doodle\n` +
        `- do NOT introduce new dominant colors; keep the doodle's main subject colors\n` +
        `- background should support the doodle theme, minimal and not distracting\n` +
        `- camera: static or very gentle pan; motion must be clearly visible (not a still image)\n` +
        `- include 2-3 gentle but noticeable motions throughout (e.g., blink + head tilt/nod + wave/small bounce)\n` +
        `- keep it intentionally childlike and rough: thick uneven strokes, crayon/marker scribble, minimal shading\n` +
        `Negative:\n` +
        `no text, no watermark, no logo, no subtitle, no extra characters, no crowd, no complex camera movement, no fast motion, no jump cuts, no flicker, no glitch, no horror, no gore, no realistic style, no polished rendering, no clean vector lines, no smooth gradients, no cinematic lighting, no ultra-detailed, no glossy`;
    }

    // Prefer JSON request body (aihubmix /v1 is OpenAI-like and often expects JSON).
    // Keep a multipart fallback in case some upstream nodes require file upload.
    const jsonPayload = {
      model: videoModel,
      seconds: secondsFinal,
      size: "1280x720",
      prompt: finalPrompt,
    };

    let genRes: Response;

    if (!useMultipart) {
      genRes = await fetch(`${baseUrl}/videos`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "content-type": "application/json",
        },
        body: JSON.stringify(jsonPayload),
      });
    } else {
      const pngBlob = await dataUrlToBlob(imageDataUrl);
      const form = new FormData();
      form.set("model", videoModel);
      form.set("seconds", String(secondsFinal));
      form.set("size", "1280x720");
      form.set("prompt", finalPrompt);
      form.set("input_reference", pngBlob, "doodle.jpg");

      genRes = await fetch(`${baseUrl}/videos`, {
        method: "POST",
        headers: { Authorization: `Bearer ${apiKey}` },
        body: form,
      });
    }

    // Fallback to multipart if upstream complains about JSON shape.
    if (!genRes.ok) {
      const peekCt = (genRes.headers.get("content-type") || "").toLowerCase();
      const peekText = await genRes.clone().text().catch(() => "");
      const shouldTryMultipart =
        peekCt.includes("application/json") &&
        (peekText.toLowerCase().includes("missing") ||
          peekText.toLowerCase().includes("invalid") ||
          peekText.toLowerCase().includes("parse json"));

      if (shouldTryMultipart && !useMultipart) {
        const pngBlob = await dataUrlToBlob(imageDataUrl);
        const form = new FormData();
        form.set("model", videoModel);
        form.set("seconds", String(secondsFinal));
        form.set("size", "1280x720");
        form.set("prompt", finalPrompt);
        form.set("input_reference", pngBlob, "doodle.png");

        genRes = await fetch(`${baseUrl}/videos`, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${apiKey}`,
          },
          body: form,
        });
      }
    }

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

      const pending = parsePendingFromAny(maybeJson ?? text);
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
    const pendingFromOkJson = parsePendingFromAny(genJson);
    if (pendingFromOkJson) return NextResponse.json(pendingFromOkJson, { status: 202 });
    const directUrl = pickUrlDeep(genJson);
    if (directUrl) {
      if (isRemoteSignedUrl(directUrl)) {
        return NextResponse.json(
          { url: directUrl, status: "completed" },
          { status: 200, headers: { "cache-control": "no-store" } },
        );
      }
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
      const maybeJson = (() => {
        try {
          return JSON.parse(t) as unknown;
        } catch {
          return null;
        }
      })();
      const pending = parsePendingFromAny(maybeJson ?? t);
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
