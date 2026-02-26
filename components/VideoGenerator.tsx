"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { DoodlePadHandle } from "./DoodlePad";
import { py } from "../lib/pinyin";

type Props = {
  doodleRef: React.RefObject<DoodlePadHandle | null>;
};

const STYLE_PRESETS = [
  {
    id: "crayon",
    pinyin: "là bǐ",
    zh: "蜡笔",
    prompt:
      "风格：幼儿蜡笔/马克笔涂鸦质感（very childlike hand-drawn, rough crayon/marker scribble, paper grain）。" +
      "刻意“不精致”：线条要粗、抖、略不均匀；上色像孩子涂色，尽量少阴影、少高光、少细节。",
  },
  {
    id: "pencil",
    pinyin: "cǎi qiān",
    zh: "彩铅",
    prompt:
      "风格：儿童彩铅画册质感（colored pencil grain, paper texture）。" +
      "允许非常轻的彩铅阴影，但不要精修、不要电影光影。",
  },
  {
    id: "watercolor",
    pinyin: "shuǐ cǎi",
    zh: "水彩",
    prompt:
      "风格：儿童水彩画质感（watercolor wash, watercolor paper）。" +
      "颜色轻柔晕染，但必须保留原始线条与构图，不要改形。",
  },
  {
    id: "comic",
    pinyin: "màn huà",
    zh: "漫画",
    prompt:
      "风格：童趣漫画（simple comic ink lines, minimal screentone）。" +
      "表情可以更生动，但不要复杂背景与镜头。",
  },
  {
    id: "papercraft",
    pinyin: "zhǐ ōu",
    zh: "纸偶",
    prompt:
      "风格：儿童手工纸偶/拼贴（paper cut collage, handmade layers）。" +
      "保持粗线条与简单色块，不要贴纸风、不需要质感精修。",
  },
  {
    id: "doodle",
    pinyin: "tú yā",
    zh: "涂鸦",
    prompt:
      "风格：原始涂鸦强化（raw doodle）。" +
      "尽量只做涂色与极少补线，保留不完美笔画与随手感。",
  },
] as const;

type StyleId = (typeof STYLE_PRESETS)[number]["id"];

function buildPrompt(styleId: StyleId) {
  const style = STYLE_PRESETS.find((s) => s.id === styleId) ?? STYLE_PRESETS[0];

  const globalStrict =
    "全局要求（严格）：必须保留涂鸦原始笔画与不完美（保留每一笔的抖动/粗细/断续），不要平滑线条、不要重画成新线稿。" +
    "先充分理解涂鸦想表达的主体与意图，再开始生成；允许轻量拟人化/补全，但只能在原笔画基础上加少量内容，不要破坏构图。";

  const common =
    "线条、色彩与构图绝对遵循涂鸦：主体位置/比例/留白关系保持一致；主色调严格贴近涂鸦，不要引入新的主导色（尤其不要改动主体的主色）。" +
    "主要工作是“涂鸦上色/轻微补线/轻微背景辅助”，让它更像孩子画的彩色动漫涂鸦。" +
    "背景自动匹配涂鸦主题：加入轻量的动漫背景或小道具辅助原始内容（柔和、简洁、不喧宾夺主）。" +
    "镜头与动作：固定机位或极轻微平移。动作要“明显但温柔”，不要像静态图片。" +
    "建议至少 2–3 个可见动作：眨眼、点头/歪头、挥手/小跳、身体轻轻左右摆动；全程持续有动感但不夸张。" +
    "避免复杂运镜与快速动作，不要剪辑跳切。" +
    "绝对避免精致化：no polished rendering, no clean vector lines, no smooth gradients, no cinematic lighting, no ultra-detailed, no glossy, no realistic。" +
    "画面稳定：无闪烁、无跳帧、无噪点花屏、无文字/水印。";

  return `${globalStrict}${style.prompt}${common}`;
}

function clamp(n: number, min: number, max: number) {
  return Math.max(min, Math.min(max, n));
}

function shortenText(s: string, max = 220) {
  const t = String(s || "");
  return t.length > max ? `${t.slice(0, max)}...` : t;
}

function isLikelyTransientNetworkError(msg: string) {
  const s = String(msg || "").toLowerCase();
  return (
    s.includes("load failed") ||
    s.includes("failed to fetch") ||
    s.includes("networkerror") ||
    s.includes("network request failed")
  );
}

async function postGenerateWithRetry(body: unknown, maxRetries = 2): Promise<Response> {
  let attempt = 0;
  while (true) {
    try {
      return await fetch("/api/generate", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      if (!isLikelyTransientNetworkError(msg) || attempt >= maxRetries) throw e;
      const waitMs = 500 * (attempt + 1);
      await new Promise((r) => setTimeout(r, waitMs));
      attempt++;
    }
  }
}

async function sniffBlobVideoType(blob: Blob): Promise<string | null> {
  const head = new Uint8Array(await blob.slice(0, 16).arrayBuffer());
  if (head.length >= 12) {
    // MP4: [size][ftyp]...
    if (head[4] === 0x66 && head[5] === 0x74 && head[6] === 0x79 && head[7] === 0x70) return "video/mp4";
  }
  if (head.length >= 4) {
    // WebM/Matroska EBML header
    if (head[0] === 0x1a && head[1] === 0x45 && head[2] === 0xdf && head[3] === 0xa3) return "video/webm";
  }
  return null;
}

async function blobToDataUrl(blob: Blob) {
  const arrayBuffer = await blob.arrayBuffer();
  const bytes = new Uint8Array(arrayBuffer);
  let binary = "";
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
  const base64 = btoa(binary);
  return `data:${blob.type || "application/octet-stream"};base64,${base64}`;
}

function pickStatusValue(json: unknown): string | null {
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

function pickMessageValue(json: unknown): string | null {
  if (!json) return null;
  if (typeof json === "string") return json;
  if (typeof json !== "object") return null;
  const anyJson = json as Record<string, any>;
  const candidates = [anyJson?.error?.message, anyJson?.message, anyJson?.detail, anyJson?.error];
  for (const c of candidates) if (typeof c === "string" && c) return c;
  return null;
}

function isTerminalSuccess(status: string) {
  const s = status.trim().toLowerCase();
  return ["succeeded", "success", "completed", "complete", "done", "finished"].includes(s);
}

function isTerminalFailure(status: string) {
  const s = status.trim().toLowerCase();
  return ["failed", "fail", "error", "canceled", "cancelled", "rejected"].includes(s);
}

export default function VideoGenerator({ doodleRef }: Props) {
  const seconds = 5;
  const [styleId, setStyleId] = useState<StyleId>("crayon");
  const prompt = useMemo(() => buildPrompt(styleId), [styleId]);
  const [isBusy, setIsBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [videoBlob, setVideoBlob] = useState<Blob | null>(null);
  const [videoRemoteUrl, setVideoRemoteUrl] = useState<string | null>(null);
  const [status, setStatus] = useState<string>("");
  const [isPlaying, setIsPlaying] = useState(false);
  const runIdRef = useRef(0);

  const urlRef = useRef<string | null>(null);
  const videoRef = useRef<HTMLVideoElement | null>(null);

  const videoUrl = useMemo(() => {
    if (urlRef.current) URL.revokeObjectURL(urlRef.current);
    if (!videoBlob) return null;
    const u = URL.createObjectURL(videoBlob);
    urlRef.current = u;
    return u;
  }, [videoBlob]);

  useEffect(() => {
    setIsPlaying(false);
    const v = videoRef.current;
    if (!v) return;
    try {
      v.pause();
      v.currentTime = 0;
    } catch {
      // ignore
    }
  }, [videoRemoteUrl, videoUrl]);

  const canShare = useMemo(() => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return typeof (navigator as any).share === "function";
  }, []);

  const onGenerate = async () => {
    const runId = ++runIdRef.current;
    setError(null);
    setStatus("");
    setVideoBlob(null);
    setVideoRemoteUrl(null);
    if (!doodleRef.current) {
      setError(`${py("huà bù wú fǎ dú qǔ")}（画布无法读取）`);
      return;
    }
    setIsBusy(true);
    try {
      setStatus(`${py("shēng chéng zhōng")}…（生成中…）`);
      const imgBlob =
        (await doodleRef.current.exportReferenceImageBlob?.({
          // Smaller image for captioning (cost-friendly); video itself is generated via T2V.
          width: 384,
          height: 384,
          mimeType: "image/jpeg",
          quality: 0.92,
        })) ?? (await doodleRef.current.exportPngBlob());
      const pngDataUrl = await blobToDataUrl(imgBlob);

      const res = await postGenerateWithRetry({
        mode: "smart",
        seconds,
        prompt,
        imageDataUrl: pngDataUrl,
      });

      const tryHandlePending = async (pendingTid: string) => {
        const maxTotalMs = 8 * 60 * 1000; // 8 minutes
        const cycleMs = 2_160_000;
        const totalStarted = Date.now();
        let cycleStarted = totalStarted;
        let cycle = 1;
        let pollCount = 0;

        while (true) {
          if (runIdRef.current !== runId) return; // superseded
          if (Date.now() - totalStarted > maxTotalMs) {
            setError(`${py("chāo shí")}（超时）：tid ${pendingTid}`);
            setStatus("");
            setIsBusy(false);
            return;
          }
          const totalElapsed = Math.round((Date.now() - totalStarted) / 1000);
          const cycleElapsed = Math.round((Date.now() - cycleStarted) / 1000);
          setStatus(
            `${py("shēng chéng zhōng")}…（生成中… ${totalElapsed}s · cycle ${cycle} ${cycleElapsed}s · tid ${pendingTid}）`,
          );
          await new Promise((r) => setTimeout(r, 1800));

          pollCount++;

          if (Date.now() - cycleStarted > cycleMs) {
            cycle++;
            cycleStarted = Date.now();
          }

          // Occasionally check status to confirm terminal failure/success instead of guessing from content.
          if (pollCount % 5 === 0) {
            try {
              const st = await postGenerateWithRetry(
                {
                  action: "status",
                  tid: pendingTid,
                },
                1,
              );

              if (st.status !== 202) {
                const ct = (st.headers.get("content-type") || "").toLowerCase();
                if (ct.includes("application/json")) {
                  const j = await st.json().catch(() => null);
                  const statusVal = pickStatusValue(j);
                  if (statusVal && isTerminalFailure(statusVal)) {
                    const msg = pickMessageValue(j) || `${py("shī bài")}（失败）`;
                    setError(`${py("shēng chéng shī bài")}（生成失败）：${msg}`);
                    setStatus("");
                    setIsBusy(false);
                    return;
                  }
                  // If success is reported, fall through to content fetch; it may still 202 briefly.
                  if (statusVal && isTerminalSuccess(statusVal)) {
                    // no-op
                  }
                } else if (!st.ok) {
                  // Don't fail fast on status endpoint; content polling is the source of truth.
                }
              }
            } catch {
              // ignore status polling errors
            }
          }

          const poll = await postGenerateWithRetry(
            {
              action: "content",
              tid: pendingTid,
            },
            1,
          );

          if (poll.status === 202) continue;
          if (!poll.ok) {
            const t = await poll.text().catch(() => "");
            throw new Error(shortenText(t) || `HTTP ${poll.status}`);
          }

          const pollCt = (poll.headers.get("content-type") || "").toLowerCase();
          if (pollCt.includes("application/json")) {
            const j = await poll.json().catch(() => null);
            if (j?.pending) continue;
            if (typeof j?.url === "string" && j.url) {
              if (runIdRef.current !== runId) return;
              setVideoRemoteUrl(j.url);
              setStatus(`${py("wán chéng")}!（完成!）`);
              return;
            }
            throw new Error(JSON.stringify(j || { error: "json returned from content endpoint" }));
          }
          const blob = await poll.blob();
          const sniffed = await sniffBlobVideoType(blob);
          if (sniffed) {
            const video = blob.type && blob.type.startsWith("video/") ? blob : new Blob([blob], { type: sniffed });
            if (runIdRef.current !== runId) return;
            setVideoBlob(video);
            setStatus(`${py("wán chéng")}!（完成!）`);
            return;
          }

          if (pollCt.startsWith("text/")) {
            const t = await blob.slice(0, 500).text().catch(() => "");
            throw new Error(shortenText(t) || "fǎnhuí bùshì shìpín（返回不是视频）");
          } else {
            const snippet = await blob.slice(0, 400).text().catch(() => "");
            throw new Error(
              snippet
                ? `fǎnhuí bùshì shìpín（返回不是视频）：${shortenText(snippet, 200)}`
                : "fǎnhuí bùshì shìpín（返回不是视频）",
            );
          }
        }
      };

      if (res.status === 202) {
        const json = (await res.json().catch(() => null)) as any;
        const tid = typeof json?.tid === "string" ? json.tid : "";
        if (tid) {
          await tryHandlePending(tid);
          return;
        }
        throw new Error(JSON.stringify(json || { error: "pending without tid" }));
      }

      if (!res.ok) {
        const ct = (res.headers.get("content-type") || "").toLowerCase();
        if (ct.includes("application/json")) {
          const j = await res.json().catch(() => null);
          if (j?.pending && typeof j?.tid === "string" && j.tid) {
            await tryHandlePending(j.tid);
            return;
          }
          if (typeof j?.url === "string" && j.url) {
            setVideoRemoteUrl(j.url);
            setStatus(`${py("wán chéng")}!（完成!）`);
            return;
          }
          throw new Error(JSON.stringify(j || { error: `HTTP ${res.status}` }));
        }
        const text = await res.text();
        throw new Error(text || `HTTP ${res.status}`);
      }

      const ct = (res.headers.get("content-type") || "").toLowerCase();
      if (ct.includes("application/json")) {
        const text = await res.text();
        // If server returns pending json with 200, handle it (defensive).
        try {
          const j = JSON.parse(text) as any;
          if (j?.pending && typeof j?.tid === "string" && j.tid) {
            await tryHandlePending(j.tid);
            return;
          }
          if (typeof j?.url === "string" && j.url) {
            setVideoRemoteUrl(j.url);
            setStatus(`${py("wán chéng")}!（完成!）`);
            return;
          }
        } catch {
          // ignore
        }
        throw new Error(text || "fǎnhuí bùshì shìpín（返回不是视频）");
      }

      const blob = await res.blob();
      const declared =
        (ct.startsWith("video/") ? ct.split(";")[0].trim() : "") ||
        (blob.type && blob.type.startsWith("video/") ? blob.type : "");

      // Always validate by sniffing bytes; don't trust content-type alone.
      const sniffed = await sniffBlobVideoType(blob);
      const effectiveType = sniffed || declared;

      if (!effectiveType) {
        const snippet = await blob.slice(0, 400).text().catch(() => "");
        throw new Error(
          snippet
            ? `fǎnhuí bùshì shìpín（返回不是视频）：${snippet.slice(0, 200)}`
            : "fǎnhuí bùshì shìpín（返回不是视频）",
        );
      }

      // If declared video/mp4/webm but sniff fails, it's likely not a real video.
      if (declared === "video/mp4" && sniffed !== "video/mp4") {
        const snippet = await blob.slice(0, 400).text().catch(() => "");
        throw new Error(
          snippet
            ? `fǎnhuí bùshì shìpín（返回不是视频）：${snippet.slice(0, 200)}`
            : "fǎnhuí bùshì shìpín（返回不是视频）",
        );
      }
      if (declared === "video/webm" && sniffed !== "video/webm") {
        const snippet = await blob.slice(0, 400).text().catch(() => "");
        throw new Error(
          snippet
            ? `fǎnhuí bùshì shìpín（返回不是视频）：${snippet.slice(0, 200)}`
            : "fǎnhuí bùshì shìpín（返回不是视频）",
        );
      }

      const video =
        blob.type && blob.type.startsWith("video/") ? blob : new Blob([blob], { type: effectiveType });
      setVideoBlob(video);
      setStatus(`${py("wán chéng")}!（完成!）`);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      if (/tls handshake timeout/i.test(msg)) {
        setError(`${py("wǎng luò mán")}（网络慢）：qǐng zài shì yí cì（请再试一次）`);
      } else {
        setError(msg);
      }
      setStatus("");
    } finally {
      setIsBusy(false);
    }
  };

  const onStop = () => {
    runIdRef.current++;
    setIsBusy(false);
    setStatus("");
  };

  const togglePlay = async () => {
    const v = videoRef.current;
    if (!v) return;
    try {
      if (v.paused) {
        await v.play();
      } else {
        v.pause();
      }
    } catch {
      // ignore
    }
  };

  const onDownload = () => {
    if (videoRemoteUrl) {
      const a = document.createElement("a");
      a.href = videoRemoteUrl;
      a.target = "_blank";
      a.rel = "noreferrer";
      document.body.appendChild(a);
      a.click();
      a.remove();
      return;
    }
    if (!videoBlob) return;
    const a = document.createElement("a");
    a.href = URL.createObjectURL(videoBlob);
    a.download = `image2vidio_${Date.now()}.mp4`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  };

  const onShare = async () => {
    if (!videoBlob) return;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const nav: any = navigator;
    try {
      const file = new File([videoBlob], "image2vidio.mp4", { type: videoBlob.type });
      await nav.share({ files: [file], title: "image2vidio", text: `${py("dòng màn shì pín")} 动漫视频` });
    } catch {
      // ignore
    }
  };

  return (
    <>
      <div className="controls">
        <div className="row">
          <div className="label">
            <span className="pinyin-text">{py("fēng gé")}</span> 风格
          </div>
          <div className="styleGrid" aria-label="style presets">
            {STYLE_PRESETS.map((s) => (
              <button
                key={s.id}
                type="button"
                className={`btn styleBtn ${styleId === s.id ? "btnOn" : ""}`}
                onClick={() => setStyleId(s.id)}
                disabled={isBusy}
              >
                <span className="pinyin-text">{py(s.pinyin)}</span> {s.zh}
              </button>
            ))}
          </div>
        </div>

        <div className="btnRow">
          <button
            type="button"
            className="btn btnPrimary"
            onClick={onGenerate}
            disabled={isBusy}
          >
            <span className="pinyin-text">{py("kāi shǐ")}</span> 开始
          </button>
          <button type="button" className="btn" onClick={onStop} disabled={!isBusy}>
            <span className="pinyin-text">{py("tíng zhǐ")}</span> 停止
          </button>
          <button type="button" className="btn" onClick={onDownload} disabled={!videoBlob}>
            <span className="pinyin-text">{py("xià zǎi")}</span> 下载
          </button>
          {canShare ? (
            <button type="button" className="btn" onClick={onShare} disabled={!videoBlob}>
              <span className="pinyin-text">{py("fēn xiǎng")}</span> 分享
            </button>
          ) : null}
        </div>

        {status ? <div className="hint">{status}</div> : null}
        {error ? (
          <div className="hint" style={{ color: "#b4235a", fontWeight: 800 }}>
            {error}
          </div>
        ) : null}
      </div>

      <div className="videoBox">
        <div className="videoStage">
          {videoRemoteUrl ? (
            <>
              <video
                ref={videoRef}
                className="videoEl"
                src={videoRemoteUrl}
                playsInline
                preload="auto"
                onPlay={() => setIsPlaying(true)}
                onPause={() => setIsPlaying(false)}
                onEnded={() => setIsPlaying(false)}
              />
              {!isPlaying ? (
                <button type="button" className="videoOverlayBtn" onClick={togglePlay}>
                  <div>
                    <span className="pinyin-text">{py("bō fàng")}</span>
                    <br />
                    播放
                  </div>
                </button>
              ) : null}
            </>
          ) : videoUrl ? (
            <>
              <video
                ref={videoRef}
                className="videoEl"
                src={videoUrl}
                playsInline
                preload="auto"
                onPlay={() => setIsPlaying(true)}
                onPause={() => setIsPlaying(false)}
                onEnded={() => setIsPlaying(false)}
              />
              {!isPlaying ? (
                <button type="button" className="videoOverlayBtn" onClick={togglePlay}>
                  <div>
                    <span className="pinyin-text">{py("bō fàng")}</span>
                    <br />
                    播放
                  </div>
                </button>
              ) : null}
            </>
          ) : (
            <div className="hint" style={{ opacity: 0.35 }} />
          )}
        </div>
        <div className="hint">
          <span className="pinyin-text">
            {py("iOS xià zǎi shí")}：{py("diǎn")} “{py("xià zǎi")} 下载” {py("hòu")}，{py("kě")} {py("zài")} “{py("wén jiàn")} 文件” {py("lǐ")} {py("zhǎo")}
          </span>
          （iOS 下载时：点“下载”后，可在“文件”里找）
        </div>
      </div>
    </>
  );
}
