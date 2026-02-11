"use client";

import { useMemo, useRef, useState } from "react";
import type { DoodlePadHandle } from "./DoodlePad";
import { py } from "../lib/pinyin";

type Props = {
  doodleRef: React.RefObject<DoodlePadHandle | null>;
};

function clamp(n: number, min: number, max: number) {
  return Math.max(min, Math.min(max, n));
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
  const prompt =
    "强烈的儿童笔触动漫风：幼儿蜡笔/马克笔涂鸦质感（very childlike hand-drawn, rough crayon/marker scribble, paper grain）。" +
    "刻意“不精致”：线条要粗、抖、略不均匀；边缘允许轻微毛糙；上色像孩子涂色，尽量少阴影、少高光、少细节。" +
    "绝对避免精致化：no polished rendering, no clean vector lines, no smooth gradients, no cinematic lighting, no ultra-detailed, no glossy, no realistic。" +
    "根据涂鸦内容生成简笔画风的单一主体：人物或拟人动物（轮廓清晰，形体简单）。" +
    "线条、色彩与构图 绝对遵循涂鸦的内容：主体位置/比例/留白关系保持一致；主色调严格贴近涂鸦，不要引入新的主导色（尤其不要改动主体的主色）。" +
    "背景自动匹配涂鸦主题：加入轻量的动漫背景或小道具辅助原始内容（柔和、简洁、不喧宾夺主）。" +
    "镜头与动作：固定机位或极轻微平移。动作要“明显但温柔”，不要像静态图片。" +
    "建议至少 2–3 个可见动作：眨眼、点头/歪头、挥手/小跳、身体轻轻左右摆动；全程持续有动感但不夸张。" +
    "避免复杂运镜与快速动作，不要剪辑跳切。" +
    "画面稳定：无闪烁、无跳帧、无噪点花屏、无文字/水印。";
  const [isBusy, setIsBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [videoBlob, setVideoBlob] = useState<Blob | null>(null);
  const [videoRemoteUrl, setVideoRemoteUrl] = useState<string | null>(null);
  const [status, setStatus] = useState<string>("");
  const runIdRef = useRef(0);

  const urlRef = useRef<string | null>(null);

  const videoUrl = useMemo(() => {
    if (urlRef.current) URL.revokeObjectURL(urlRef.current);
    if (!videoBlob) return null;
    const u = URL.createObjectURL(videoBlob);
    urlRef.current = u;
    return u;
  }, [videoBlob]);

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

      const res = await fetch("/api/generate", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          mode: "smart",
          seconds,
          prompt,
          imageDataUrl: pngDataUrl,
        }),
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
              const st = await fetch("/api/generate", {
                method: "POST",
                headers: { "content-type": "application/json" },
                body: JSON.stringify({
                  action: "status",
                  tid: pendingTid,
                }),
              });

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

          const poll = await fetch("/api/generate", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({
              action: "content",
              tid: pendingTid,
            }),
          });

          if (poll.status === 202) continue;
          if (!poll.ok) {
            const t = await poll.text();
            throw new Error(t || `HTTP ${poll.status}`);
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
          if (pollCt.startsWith("text/")) {
            const t = await poll.text();
            throw new Error(t || "fǎnhuí bùshì shìpín（返回不是视频）");
          }

          const blob = await poll.blob();
          const sniffed = await sniffBlobVideoType(blob);
          if (!sniffed) {
            const snippet = await blob.slice(0, 400).text().catch(() => "");
            throw new Error(
              snippet
                ? `fǎnhuí bùshì shìpín（返回不是视频）：${snippet.slice(0, 200)}`
                : "fǎnhuí bùshì shìpín（返回不是视频）",
            );
          }

          const video = blob.type && blob.type.startsWith("video/") ? blob : new Blob([blob], { type: sniffed });
          if (runIdRef.current !== runId) return;
          setVideoBlob(video);
          setStatus(`${py("wán chéng")}!（完成!）`);
          return;
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
            <video className="videoEl" src={videoRemoteUrl} controls playsInline />
          ) : videoUrl ? (
            <video className="videoEl" src={videoUrl} controls playsInline />
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
