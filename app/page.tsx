"use client";

import { useRef } from "react";
import DoodlePad, { type DoodlePadHandle } from "../components/DoodlePad";
import VideoGenerator from "../components/VideoGenerator";
import { py } from "../lib/pinyin";
import { APP_VERSION } from "../lib/version";

export default function HomePage() {
  const doodleRef = useRef<DoodlePadHandle | null>(null);

  return (
    <main className="appShell">
      <section className="panel">
        <div className="panelInner">
          <div className="panelHeader">
            <div className="panelTitle">
              <span className="pinyin-text">{py("zuǒ biān")}</span> 左边 ·{" "}
              <span className="pinyin-text">{py("tú yā")}</span> 涂鸦
            </div>
          <div className="chip">build {APP_VERSION} · iPad Pro（Landscape）</div>
          </div>
          <DoodlePad
            ref={doodleRef}
          />
        </div>
      </section>

      <section className="panel">
        <div className="panelInner">
          <div className="panelHeader">
            <div className="panelTitle">
              <span className="pinyin-text">{py("yòu biān")}</span> 右边 ·{" "}
              <span className="pinyin-text">{py("dòng màn shì pín")}</span>{" "}
              动漫视频
            </div>
            <div className="chip">build {APP_VERSION} · wan2.2 i2v · 1–3s</div>
          </div>
          <VideoGenerator doodleRef={doodleRef} />
        </div>
      </section>
    </main>
  );
}
