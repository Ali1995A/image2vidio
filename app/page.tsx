"use client";

import { useEffect, useRef, useState } from "react";
import DoodlePad, { type DoodlePadHandle } from "../components/DoodlePad";
import VideoGenerator from "../components/VideoGenerator";

export default function HomePage() {
  const doodleRef = useRef<DoodlePadHandle | null>(null);
  const [lastPng, setLastPng] = useState<Blob | null>(null);
  const [pngUrl, setPngUrl] = useState<string | null>(null);

  useEffect(() => {
    if (!lastPng) {
      setPngUrl(null);
      return;
    }
    const u = URL.createObjectURL(lastPng);
    setPngUrl(u);
    return () => URL.revokeObjectURL(u);
  }, [lastPng]);

  return (
    <main className="appShell">
      <section className="panel">
        <div className="panelInner">
          <div className="panelHeader">
            <div className="panelTitle">zuǒbiān 左边 · túyā 涂鸦</div>
            <div className="chip">iPad Pro（Landscape）</div>
          </div>
          <DoodlePad
            ref={doodleRef}
            onSnapshot={(blob) => setLastPng(blob)}
            snapshotIntervalMs={700}
          />
        </div>
      </section>

      <section className="panel">
        <div className="panelInner">
          <div className="panelHeader">
            <div className="panelTitle">yòubiān 右边 · dòngmàn 动漫视频</div>
            <div className="chip">wan2.2 i2v · 1.5–3s</div>
          </div>
          <VideoGenerator doodleRef={doodleRef} fallbackPngUrl={pngUrl} />
        </div>
      </section>
    </main>
  );
}
