"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { DoodlePadHandle } from "./DoodlePad";
import { py } from "../lib/pinyin";

type Props = {
  doodleRef: React.RefObject<DoodlePadHandle | null>;
  fallbackPngUrl: string | null;
};

const LS_KEY = "image2vidio.apiKey";
const LS_BASE = "image2vidio.baseUrl";

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

export default function VideoGenerator({ doodleRef, fallbackPngUrl }: Props) {
  const [apiKey, setApiKey] = useState("");
  const [baseUrl, setBaseUrl] = useState("https://aihubmix.com/v1");
  const [seconds, setSeconds] = useState(2);
  const [prompt, setPrompt] = useState(
    "anime style, cute, colorful, clean lines, soft lighting, smooth motion",
  );
  const [isAdvanced, setIsAdvanced] = useState(false);
  const [isBusy, setIsBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [videoBlob, setVideoBlob] = useState<Blob | null>(null);
  const [status, setStatus] = useState<string>("");

  const urlRef = useRef<string | null>(null);

  useEffect(() => {
    const k = window.localStorage.getItem(LS_KEY);
    if (k) setApiKey(k);
    const b = window.localStorage.getItem(LS_BASE);
    if (b) setBaseUrl(b);
  }, []);

  useEffect(() => {
    window.localStorage.setItem(LS_KEY, apiKey);
  }, [apiKey]);

  useEffect(() => {
    window.localStorage.setItem(LS_BASE, baseUrl);
  }, [baseUrl]);

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
    setError(null);
    setStatus("");
    setVideoBlob(null);
    const sec = clamp(seconds, 1.5, 3);
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
          apiKey,
          baseUrl,
          seconds: sec,
          prompt,
          imageDataUrl: pngDataUrl,
        }),
      });
      if (!res.ok) {
        const text = await res.text();
        throw new Error(text || `HTTP ${res.status}`);
      }

      const ct = (res.headers.get("content-type") || "").toLowerCase();
      if (ct.includes("application/json")) {
        const text = await res.text();
        throw new Error(text || "fǎnhuí bùshì shìpín（返回不是视频）");
      }

      const blob = await res.blob();
      const hinted =
        ct.startsWith("video/") ? ct.split(";")[0].trim() :
        ct.includes("application/octet-stream") ? "video/mp4" :
        blob.type && blob.type.startsWith("video/") ? blob.type :
        null;

      const sniffed = hinted ?? (await sniffBlobVideoType(blob));
      if (!sniffed) {
        const snippet = await blob.slice(0, 400).text().catch(() => "");
        throw new Error(
          snippet
            ? `fǎnhuí bùshì shìpín（返回不是视频）：${snippet.slice(0, 200)}`
            : "fǎnhuí bùshì shìpín（返回不是视频）",
        );
      }

      const video = blob.type && blob.type.startsWith("video/") ? blob : new Blob([blob], { type: sniffed });
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
          <button
            type="button"
            className={`btn ${isAdvanced ? "btnOn" : ""}`}
            onClick={() => setIsAdvanced((v) => !v)}
            disabled={isBusy}
          >
            <span className="pinyin-text">{py("gāo jí")}</span> 高级
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
              <span className="pinyin-text">{py("shí jiān")}</span> 时间 · {clamp(seconds, 1.5, 3)}s
            </div>
            <input
              className="slider timeInlineSlider"
              type="range"
              min={1.5}
              max={3}
              step={0.5}
              value={seconds}
              onChange={(e) => setSeconds(Number(e.target.value))}
              disabled={isBusy}
            />
          </div>
        </div>

        {isAdvanced ? (
          <>
            <div className="row">
              <div className="label">
                <span className="pinyin-text">{py("yào shí")}</span> 钥匙 · API Key
              </div>
              <input
                className="input"
                value={apiKey}
                onChange={(e) => setApiKey(e.target.value)}
                placeholder={`${py("kě bù tián")}（可不填：yòng Vercel 环境变量）`}
                autoCapitalize="none"
                autoCorrect="off"
                spellCheck={false}
              />
            </div>
            <div className="row">
              <div className="label">
                <span className="pinyin-text">{py("dì zhǐ")}</span> 地址 · Base URL
              </div>
              <input
                className="input"
                value={baseUrl}
                onChange={(e) => setBaseUrl(e.target.value)}
                placeholder="https://aihubmix.com/v1"
                autoCapitalize="none"
                autoCorrect="off"
                spellCheck={false}
              />
            </div>
            <div className="row">
              <div className="label">
                <span className="pinyin-text">{py("tí shì")}</span> 提示 · Prompt
              </div>
              <input
                className="input"
                value={prompt}
                onChange={(e) => setPrompt(e.target.value)}
                placeholder="anime style..."
              />
            </div>
          </>
        ) : null}

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
          ) : fallbackPngUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={fallbackPngUrl}
              alt="preview"
              style={{ width: "100%", height: "100%", objectFit: "contain" }}
            />
          ) : (
            <div className="hint">
              <span className="pinyin-text">{py("huà yì zhāng tú")}，{py("ránhòu")} {py("kāi shǐ")}</span>
              （画一张图，然后开始）
            </div>
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
