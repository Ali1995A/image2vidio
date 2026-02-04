"use client";

import {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
} from "react";

export type DoodlePadHandle = {
  exportPngBlob: () => Promise<Blob>;
};

type Props = {
  onSnapshot?: (blob: Blob) => void;
  snapshotIntervalMs?: number;
};

type Point = { x: number; y: number };

const LS_RECENT_BRUSH = "image2vidio.recentBrushColors";

const PALETTE = [
  "#ff2f8f",
  "#ff5aa8",
  "#ff90c6",
  "#ffc7e4",
  "#ffb703",
  "#00bbf9",
  "#00f5d4",
  "#111827",
  "#ffffff",
];

function clamp(n: number, min: number, max: number) {
  return Math.max(min, Math.min(max, n));
}

function hslToHex(h: number, s: number, l: number) {
  const hh = ((h % 360) + 360) % 360;
  const ss = Math.max(0, Math.min(100, s)) / 100;
  const ll = Math.max(0, Math.min(100, l)) / 100;

  const c = (1 - Math.abs(2 * ll - 1)) * ss;
  const x = c * (1 - Math.abs(((hh / 60) % 2) - 1));
  const m = ll - c / 2;

  let r = 0;
  let g = 0;
  let b = 0;

  if (hh < 60) [r, g, b] = [c, x, 0];
  else if (hh < 120) [r, g, b] = [x, c, 0];
  else if (hh < 180) [r, g, b] = [0, c, x];
  else if (hh < 240) [r, g, b] = [0, x, c];
  else if (hh < 300) [r, g, b] = [x, 0, c];
  else [r, g, b] = [c, 0, x];

  const toHex = (v: number) => Math.round((v + m) * 255).toString(16).padStart(2, "0");
  return `#${toHex(r)}${toHex(g)}${toHex(b)}`;
}

function grayHex(v: number) {
  const x = Math.max(0, Math.min(255, Math.round(v)));
  const h = x.toString(16).padStart(2, "0");
  return `#${h}${h}${h}`;
}

function normalizeHex(hex: string) {
  const s = String(hex || "").trim().toLowerCase();
  if (/^#[0-9a-f]{6}$/.test(s)) return s;
  return "";
}

function getPointerPos(e: PointerEvent, el: HTMLCanvasElement): Point {
  const rect = el.getBoundingClientRect();
  const x = (e.clientX - rect.left) * (el.width / rect.width);
  const y = (e.clientY - rect.top) * (el.height / rect.height);
  return { x, y };
}

function canvasSizeForStage(stage: HTMLElement, dpr: number) {
  const rect = stage.getBoundingClientRect();
  const width = Math.max(1, Math.floor(rect.width * dpr));
  const height = Math.max(1, Math.floor(rect.height * dpr));
  return { width, height };
}

async function blobFromCanvas(drawCanvas: HTMLCanvasElement, bgColor: string): Promise<Blob> {
  const out = document.createElement("canvas");
  out.width = drawCanvas.width;
  out.height = drawCanvas.height;
  const ctx = out.getContext("2d");
  if (!ctx) throw new Error("Canvas ctx missing");
  ctx.fillStyle = bgColor;
  ctx.fillRect(0, 0, out.width, out.height);
  ctx.drawImage(drawCanvas, 0, 0);
  const blob = await new Promise<Blob>((resolve, reject) => {
    out.toBlob((b) => (b ? resolve(b) : reject(new Error("toBlob failed"))), "image/png");
  });
  return blob;
}

const DoodlePad = forwardRef<DoodlePadHandle, Props>(function DoodlePad(
  { onSnapshot, snapshotIntervalMs = 0 },
  ref,
) {
  const stageRef = useRef<HTMLDivElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const fileRef = useRef<HTMLInputElement | null>(null);

  const [bgColor, setBgColor] = useState("#fff1f7");
  const [brushColor, setBrushColor] = useState(PALETTE[0]);
  const [brushWidth, setBrushWidth] = useState(14);
  const [isEraser, setIsEraser] = useState(false);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [isMaximized, setIsMaximized] = useState(false);
  const [isColorWallOpen, setIsColorWallOpen] = useState(false);
  const [recentBrushColors, setRecentBrushColors] = useState<string[]>([]);
  const lastPointRef = useRef<Point | null>(null);
  const drawingRef = useRef(false);

  const widthLabel = useMemo(() => `${brushWidth}px`, [brushWidth]);

  const palette256 = useMemo(() => {
    const hues = 16;
    const lightness = [22, 28, 34, 40, 48, 58, 68, 78];
    const sats = [92, 62];
    const out: string[] = [];

    const rows: Array<{ sat: number; light: number }> = [];
    for (let li = 0; li < lightness.length; li++) {
      for (let si = 0; si < sats.length; si++) rows.push({ sat: sats[si], light: lightness[li] });
    }

    for (const row of rows) {
      for (let h = 0; h < hues; h++) {
        const hue = Math.round((360 / hues) * h);
        out.push(hslToHex(hue, row.sat, row.light));
      }
    }

    return out.slice(0, 256);
  }, []);

  const grays32 = useMemo(() => {
    const out: string[] = [];
    for (let i = 0; i < 32; i++) out.push(grayHex((255 / 31) * i));
    return out;
  }, []);

  useEffect(() => {
    try {
      const raw = window.localStorage.getItem(LS_RECENT_BRUSH);
      const parsed = raw ? (JSON.parse(raw) as unknown) : null;
      if (!Array.isArray(parsed)) return;
      const cleaned = parsed
        .filter((v): v is string => typeof v === "string")
        .map((v) => normalizeHex(v))
        .filter(Boolean);
      if (cleaned.length) setRecentBrushColors(cleaned.slice(0, 12));
    } catch {
      // ignore
    }
  }, []);

  const rememberBrushColor = (hex: string) => {
    const c = normalizeHex(hex);
    if (!c) return;
    setRecentBrushColors((prev) => {
      const next = [c, ...prev.filter((p) => p !== c)].slice(0, 12);
      try {
        window.localStorage.setItem(LS_RECENT_BRUSH, JSON.stringify(next));
      } catch {
        // ignore
      }
      return next;
    });
  };

  const selectBrushColor = (hex: string) => {
    setIsEraser(false);
    setBrushColor(hex);
    rememberBrushColor(hex);
  };

  useImperativeHandle(ref, () => ({
    exportPngBlob: async () => {
      const c = canvasRef.current;
      if (!c) throw new Error("canvas missing");
      return blobFromCanvas(c, bgColor);
    },
  }));

  useEffect(() => {
    const stage = stageRef.current;
    const canvas = canvasRef.current;
    if (!stage || !canvas) return;

    const dpr = clamp(window.devicePixelRatio || 1, 1, 2);
    const resize = () => {
      const { width, height } = canvasSizeForStage(stage, dpr);
      if (canvas.width === width && canvas.height === height) return;
      const prev = document.createElement("canvas");
      prev.width = canvas.width || width;
      prev.height = canvas.height || height;
      const pctx = prev.getContext("2d");
      if (pctx) pctx.drawImage(canvas, 0, 0);

      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext("2d");
      if (!ctx) return;
      ctx.lineCap = "round";
      ctx.lineJoin = "round";
      ctx.imageSmoothingEnabled = true;
      ctx.drawImage(prev, 0, 0, width, height);
    };

    resize();
    const ro = new ResizeObserver(() => resize());
    ro.observe(stage);
    return () => ro.disconnect();
  }, []);

  useEffect(() => {
    if (!snapshotIntervalMs || !onSnapshot) return;
    const id = window.setInterval(async () => {
      try {
        const c = canvasRef.current;
        if (!c) return;
        const blob = await blobFromCanvas(c, bgColor);
        onSnapshot(blob);
      } catch {
        // ignore
      }
    }, snapshotIntervalMs);
    return () => window.clearInterval(id);
  }, [bgColor, onSnapshot, snapshotIntervalMs]);

  useEffect(() => {
    const stage = stageRef.current;
    const canvas = canvasRef.current;
    if (!stage || !canvas) return;

    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.imageSmoothingEnabled = true;

    const stroke = (a: Point, b: Point) => {
      ctx.save();
      ctx.globalCompositeOperation = isEraser ? "destination-out" : "source-over";
      ctx.strokeStyle = isEraser ? "rgba(0,0,0,1)" : brushColor;
      ctx.lineWidth = brushWidth;
      ctx.beginPath();
      ctx.moveTo(a.x, a.y);
      ctx.lineTo(b.x, b.y);
      ctx.stroke();
      ctx.restore();
    };

    const drawDot = (p: Point) => {
      ctx.save();
      ctx.globalCompositeOperation = isEraser ? "destination-out" : "source-over";
      ctx.fillStyle = isEraser ? "rgba(0,0,0,1)" : brushColor;
      ctx.beginPath();
      ctx.arc(p.x, p.y, brushWidth / 2, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    };

    const onDown = (e: PointerEvent) => {
      if (e.button !== 0) return;
      drawingRef.current = true;
      canvas.setPointerCapture(e.pointerId);
      lastPointRef.current = getPointerPos(e, canvas);
      drawDot(lastPointRef.current);
    };

    const onMove = (e: PointerEvent) => {
      if (!drawingRef.current) return;
      const p = getPointerPos(e, canvas);
      const last = lastPointRef.current;
      if (!last) {
        lastPointRef.current = p;
        return;
      }
      stroke(last, p);
      lastPointRef.current = p;
    };

    const onUp = () => {
      drawingRef.current = false;
      lastPointRef.current = null;
    };

    stage.addEventListener("pointerdown", onDown);
    stage.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", onUp);

    return () => {
      stage.removeEventListener("pointerdown", onDown);
      stage.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", onUp);
    };
  }, [brushColor, brushWidth, isEraser]);

  useEffect(() => {
    const onFs = () => setIsFullscreen(Boolean(document.fullscreenElement));
    document.addEventListener("fullscreenchange", onFs);
    return () => document.removeEventListener("fullscreenchange", onFs);
  }, []);

  const clear = () => {
    const c = canvasRef.current;
    if (!c) return;
    const ctx = c.getContext("2d");
    if (!ctx) return;
    ctx.clearRect(0, 0, c.width, c.height);
  };

  const toggleFullscreen = async () => {
    const el = stageRef.current;
    if (!el) return;
    try {
      if (!document.fullscreenElement) {
        await el.requestFullscreen();
      } else {
        await document.exitFullscreen();
      }
    } catch {
      setIsMaximized((v) => !v);
    }
  };

  const loadImage = () => fileRef.current?.click();

  const onPickFile: React.ChangeEventHandler<HTMLInputElement> = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const url = URL.createObjectURL(file);
    try {
      const img = await new Promise<HTMLImageElement>((resolve, reject) => {
        const i = new Image();
        i.onload = () => resolve(i);
        i.onerror = () => reject(new Error("Image load failed"));
        i.src = url;
      });
      const c = canvasRef.current;
      if (!c) return;
      const ctx = c.getContext("2d");
      if (!ctx) return;

      const scale = Math.min(c.width / img.width, c.height / img.height);
      const w = Math.floor(img.width * scale);
      const h = Math.floor(img.height * scale);
      const x = Math.floor((c.width - w) / 2);
      const y = Math.floor((c.height - h) / 2);
      ctx.save();
      ctx.globalCompositeOperation = "source-over";
      ctx.drawImage(img, x, y, w, h);
      ctx.restore();
    } finally {
      URL.revokeObjectURL(url);
      e.target.value = "";
    }
  };

  const palette = useMemo(
    () =>
      PALETTE.map((c) => ({
        c,
        on: c.toLowerCase() === brushColor.toLowerCase(),
      })),
    [brushColor],
  );

  return (
    <>
      <div className="controls">
        <div className="btnRow">
          <button
            type="button"
            className={`btn ${!isEraser ? "btnOn" : ""}`}
            onClick={() => setIsEraser(false)}
          >
            huàbǐ 画笔
          </button>
          <button
            type="button"
            className={`btn ${isEraser ? "btnOn" : ""}`}
            onClick={() => setIsEraser(true)}
          >
            xiàngpí 橡皮
          </button>
          <button type="button" className="btn btnGhost" onClick={clear}>
            qīngchú 清除
          </button>
          <button type="button" className="btn btnGhost" onClick={loadImage}>
            túpiàn 图片
          </button>
          <button type="button" className="btn btnGhost" onClick={toggleFullscreen}>
            quánpíng 全屏
          </button>
        </div>

        <div className="row">
          <div className="label">
            bǐkuān 笔宽 · <span aria-label="width">{widthLabel}</span>
          </div>
          <input
            className="slider"
            type="range"
            min={4}
            max={48}
            value={brushWidth}
            onChange={(e) => setBrushWidth(Number(e.target.value))}
          />
        </div>

        <div className="row">
          <div className="label">bǐsè 笔色 · dǐsè 底色</div>
          <div className="colorRow">
            <button
              type="button"
              className="swatch swatchOn"
              style={{ background: brushColor }}
              onClick={() => setIsColorWallOpen(true)}
              aria-label="open color palette"
              title={brushColor}
            />
            {palette.map((p) => (
              <button
                key={p.c}
                type="button"
                className={`swatch ${p.on ? "swatchOn" : ""}`}
                style={{ background: p.c }}
                onClick={() => selectBrushColor(p.c)}
                aria-label={`color ${p.c}`}
                title={p.c}
              />
            ))}
            <input
              className="input"
              type="color"
              value={brushColor}
              onChange={(e) => selectBrushColor(e.target.value)}
              aria-label="custom brush color"
              style={{ height: 44, padding: 8, width: 64 }}
            />
            <div className="colorSpacer" aria-hidden="true" />
            <input
              className="input"
              type="color"
              value={bgColor}
              onChange={(e) => setBgColor(e.target.value)}
              aria-label="background color"
              style={{ height: 44, padding: 8, width: 64 }}
            />
          </div>
        </div>
      </div>

      {isColorWallOpen ? (
        <div
          className="overlay"
          role="dialog"
          aria-label="Color palette"
          onMouseDown={() => setIsColorWallOpen(false)}
          onTouchStart={() => setIsColorWallOpen(false)}
        >
          <div
            className="colorPanel"
            onMouseDown={(e) => e.stopPropagation()}
            onTouchStart={(e) => e.stopPropagation()}
          >
            <div className="colorPanelHeader">
              <div className="colorPanelTitle">tiáosè 调色板</div>
              <button type="button" className="btn btnGhost" onClick={() => setIsColorWallOpen(false)}>
                guānbì 关闭
              </button>
            </div>

            <div className="colorPanelSection">
              <div className="colorPanelLabel">hēibáihuī 黑白灰</div>
              <div className="colorWall">
                {grays32.map((c) => (
                  <button
                    key={c}
                    type="button"
                    className={`colorChip ${brushColor.toLowerCase() === c.toLowerCase() ? "colorChipOn" : ""}`}
                    style={{ background: c }}
                    onClick={() => selectBrushColor(c)}
                    aria-label={`gray ${c}`}
                    title={c}
                  />
                ))}
              </div>
            </div>

            {recentBrushColors.length ? (
              <div className="colorPanelSection">
                <div className="colorPanelLabel">zuìjìn 最近 · Recent</div>
                <div className="colorWall12">
                  {recentBrushColors.slice(0, 12).map((c) => (
                    <button
                      key={c}
                      type="button"
                      className={`colorChip ${brushColor.toLowerCase() === c.toLowerCase() ? "colorChipOn" : ""}`}
                      style={{ background: c }}
                      onClick={() => selectBrushColor(c)}
                      aria-label={`recent ${c}`}
                      title={c}
                    />
                  ))}
                </div>
              </div>
            ) : null}

            <div className="colorPanelSection">
              <div className="colorPanelLabel">256</div>
              <div className="colorWall">
                {palette256.map((c) => (
                  <button
                    key={c}
                    type="button"
                    className={`colorChip ${brushColor.toLowerCase() === c.toLowerCase() ? "colorChipOn" : ""}`}
                    style={{ background: c }}
                    onClick={() => selectBrushColor(c)}
                    aria-label={`color ${c}`}
                    title={c}
                  />
                ))}
              </div>
            </div>
          </div>
        </div>
      ) : null}

      <div className="canvasWrap">
        <div
          ref={stageRef}
          className={`canvasStage ${isMaximized ? "canvasStageMax" : ""}`}
          style={{
            background: bgColor,
          }}
        >
          <canvas ref={canvasRef} className="canvasEl" />
        </div>
        <div className="hint">
          wánfǎ 玩法：yòng shǒuzhǐ huà 用手指画 · yòng xiàngpí cā 用橡皮擦 · kě jiāzài túpiàn
          可加载图片
        </div>
      </div>

      <input
        ref={fileRef}
        type="file"
        accept="image/*"
        style={{ display: "none" }}
        onChange={onPickFile}
      />
    </>
  );
});

export default DoodlePad;
