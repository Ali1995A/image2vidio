"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { DoodlePadHandle } from "./DoodlePad";

type Props = {
  doodleRef: React.RefObject<DoodlePadHandle | null>;
  fallbackPngUrl: string | null;
};

const LS_KEY = "image2vidio.apiKey";
const LS_BASE = "image2vidio.baseUrl";

function clamp(n: number, min: number, max: number) {
  return Math.max(min, Math.min(max, n));
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
  const [seconds, setSeconds] = useState(4);
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
    const sec = clamp(seconds, 3, 5);
    if (!doodleRef.current) {
      setError("huàbù wúfǎ dúqǔ（画布无法读取）");
      return;
    }
    setIsBusy(true);
    try {
      setStatus("shēngchéng zhōng…（生成中…）");
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
      const blob = await res.blob();
      if (!blob.type.startsWith("video/")) {
        throw new Error("fǎnhuí bùshì shìpín（返回不是视频）");
      }
      setVideoBlob(blob);
      setStatus("wánchéng!（完成!）");
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
      await nav.share({ files: [file], title: "image2vidio", text: "dòngmàn shìpín 动漫视频" });
    } catch {
      // ignore
    }
  };

  return (
    <>
      <div className="controls">
        <div className="row">
          <div className="label">shíjiān 时间 · {clamp(seconds, 3, 5)}s</div>
          <input
            className="slider"
            type="range"
            min={3}
            max={5}
            value={seconds}
            onChange={(e) => setSeconds(Number(e.target.value))}
          />
        </div>

        <div className="btnRow">
          <button
            type="button"
            className="btn btnPrimary"
            onClick={onGenerate}
            disabled={isBusy}
          >
            kāishǐ 开始
          </button>
          <button
            type="button"
            className={`btn ${isAdvanced ? "btnOn" : ""}`}
            onClick={() => setIsAdvanced((v) => !v)}
            disabled={isBusy}
          >
            gāojí 高级
          </button>
          <button type="button" className="btn" onClick={onDownload} disabled={!videoBlob}>
            xiàzài 下载
          </button>
          {canShare ? (
            <button type="button" className="btn" onClick={onShare} disabled={!videoBlob}>
              fēnxiǎng 分享
            </button>
          ) : null}
        </div>

        {isAdvanced ? (
          <>
            <div className="row">
              <div className="label">yáoshi 钥匙 · API Key</div>
              <input
                className="input"
                value={apiKey}
                onChange={(e) => setApiKey(e.target.value)}
                placeholder="kě bù tián（可不填：yòng Vercel 环境变量）"
                autoCapitalize="none"
                autoCorrect="off"
                spellCheck={false}
              />
            </div>
            <div className="row">
              <div className="label">dǐzhǐ 地址 · Base URL</div>
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
              <div className="label">tíshì 提示 · Prompt</div>
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
        {!isAdvanced ? (
          <div className="hint">
            tíxǐng 提醒：API Key jiàn yì fàng zài Vercel huánjìng biànliàng（API Key 建议放在 Vercel 环境变量）
          </div>
        ) : null}
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
            <div className="hint">huà yízhāng tú, ránhòu kāishǐ（画一张图，然后开始）</div>
          )}
        </div>
        <div className="hint">
          iOS xiàzài shí：diǎn “xiàzài 下载” hòu, kě zài “Wénjiàn 文件” lǐ zhǎo（iOS 下载时：点“下载”后，可在“文件”里找）
        </div>
      </div>
    </>
  );
}
