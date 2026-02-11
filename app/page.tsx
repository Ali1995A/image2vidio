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
              神笔CC · <span className="pinyin-text">{py("zuǒ biān")}</span> 左边 ·{" "}
              <span className="pinyin-text">{py("tú yā")}</span> 涂鸦
            </div>
            <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
              <a className="chip" href="/version" style={{ textDecoration: "none", color: "inherit" }}>
                build {APP_VERSION}
              </a>
              <div className="chip">iPad Pro（Landscape）</div>
            </div>
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
            <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
              <a className="chip" href="/version" style={{ textDecoration: "none", color: "inherit" }}>
                build {APP_VERSION}
              </a>
              <div className="chip">smart → wan2.2 t2v · 5s</div>
            </div>
          </div>
          <VideoGenerator doodleRef={doodleRef} />
        </div>
      </section>
    </main>
  );
}
