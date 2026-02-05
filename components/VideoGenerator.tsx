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

function extractTidFromText(text: string) {
  const s = String(text || "");
  const m =
    /tid:\s*([0-9]+)/i.exec(s) ??
    /"tid"\s*:\s*"([0-9]+)"/i.exec(s) ??
    /"tid"\s*:\s*([0-9]+)/i.exec(s) ??
    /\btid=([0-9]+)/i.exec(s);
  return m ? m[1] : "";
}

export default function VideoGenerator({ doodleRef }: Props) {
  const [seconds, setSeconds] = useState(1);
  const prompt = "anime style, cute, colorful, clean lines, soft lighting, smooth motion";
  const [isBusy, setIsBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [videoBlob, setVideoBlob] = useState<Blob | null>(null);
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
    const sec = clamp(seconds, 1, 3);
    if (!doodleRef.current) {
      setError(`${py("huà bù wú fǎ dú qǔ")}（画布无法读取）`);
      return;
    }
    setIsBusy(true);
    try {
      setStatus(`${py("shēng chéng zhōng")}…（生成中…）`);
      const pngBlob = await doodleRef.current.exportPngBlob();
      const pngDataUrl = await blobToDataUrl(pngBlob);

      const res = await fetch("/api/generate", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          seconds: sec,
          prompt,
          imageDataUrl: pngDataUrl,
        }),
      });

      const tryHandlePending = async (pendingTid: string) => {
        const maxWaitMs = 2_160_000;
        const started = Date.now();
        while (Date.now() - started < maxWaitMs) {
          if (runIdRef.current !== runId) return; // superseded
          setStatus(`${py("shēng chéng zhōng")}…（生成中… ${Math.round((Date.now() - started) / 1000)}s）`);
          await new Promise((r) => setTimeout(r, 1800));

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
            // Sometimes upstream (or our API) may respond with an error JSON/text that still contains the tid.
            // Treat it as "still generating" and keep waiting instead of failing fast.
            const tidFromErr = extractTidFromText(t);
            if (tidFromErr) continue;
            throw new Error(t || `HTTP ${poll.status}`);
          }

          const pollCt = (poll.headers.get("content-type") || "").toLowerCase();
          if (pollCt.includes("application/json") || pollCt.startsWith("text/")) {
            const t = await poll.text();
            const tidFromOkText = extractTidFromText(t);
            if (tidFromOkText) continue;
            throw new Error(t || "fǎnhuí bùshì shìpín（返回不是视频）");
          }

          const blob = await poll.blob();
          const sniffed = await sniffBlobVideoType(blob);
          if (!sniffed) {
            const snippet = await blob.slice(0, 400).text().catch(() => "");
            const tidFromSnippet = extractTidFromText(snippet);
            if (tidFromSnippet) continue;
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
        throw new Error("shíjiān chāoshí（时间超时）");
      };

      if (res.status === 202) {
        const json = (await res.json().catch(() => null)) as any;
        const tid = typeof json?.tid === "string" ? json.tid : "";
        if (tid) {
          await tryHandlePending(tid);
          return;
        }
      }

      if (!res.ok) {
        const text = await res.text();
        const tid = extractTidFromText(text);
        if (tid) {
          await tryHandlePending(tid);
          return;
        }
        throw new Error(text || `HTTP ${res.status}`);
      }

      const ct = (res.headers.get("content-type") || "").toLowerCase();
      if (ct.includes("application/json")) {
        const text = await res.text();
        // If server returns pending json but with 200, handle it (defensive).
        try {
          const j = JSON.parse(text) as any;
          const pending =
            Boolean(j?.pending) ||
            /still being generated/i.test(String(j?.error?.message || j?.message || ""));
          if (pending) {
            const tid =
              (typeof j?.tid === "string" && j.tid) ||
              extractTidFromText(String(j?.error?.message || j?.message || "")) ||
              extractTidFromText(text);
            if (tid) {
              await tryHandlePending(tid);
              return;
            }
          }
        } catch {}

        const tid = extractTidFromText(text);
        if (tid) {
          await tryHandlePending(tid);
          return;
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
      setError(e instanceof Error ? e.message : String(e));
      setStatus("");
    } finally {
      setIsBusy(false);
    }
  };

  const onDownload = () => {
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
          <button type="button" className="btn" onClick={onDownload} disabled={!videoBlob}>
            <span className="pinyin-text">{py("xià zǎi")}</span> 下载
          </button>
          {canShare ? (
            <button type="button" className="btn" onClick={onShare} disabled={!videoBlob}>
              <span className="pinyin-text">{py("fēn xiǎng")}</span> 分享
            </button>
          ) : null}

          <div className="timeInline" aria-label="video duration">
            <div className="timeInlineLabel">
              <span className="pinyin-text">{py("shí jiān")}</span> 时间 · {clamp(seconds, 1, 3)}s
            </div>
            <input
              className="slider timeInlineSlider"
              type="range"
              min={1}
              max={3}
              step={0.5}
              value={seconds}
              onChange={(e) => setSeconds(Number(e.target.value))}
              disabled={isBusy}
            />
          </div>
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
          {videoUrl ? (
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
