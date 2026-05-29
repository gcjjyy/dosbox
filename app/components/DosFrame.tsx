// app/components/DosFrame.tsx
import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { unzipSync } from "fflate";
import { DosEmulator, preloadDosboxRuntime, type CommandInterface } from "../lib/dos-emulator";
import { BootScreen, type BootPhase } from "./BootScreen";
import { clearUserState, readUserState } from "../lib/user-state";

export type { CommandInterface };
export type { DosEmulator };

export interface DosFrameProps {
  bundleUrl: string;
  configUrl: string;
  onReady: (ci: CommandInterface) => void;
  onError?: (err: unknown) => void;
  /** Called when DosEmulator instance is available (and again with null on unmount). */
  onEmulator?: (emu: DosEmulator | null) => void;
  /** Display width in CSS px. null → fill available space (object-fit contain). */
  width?: number | null;
  /** Display height in CSS px. null → fill available space. */
  height?: number | null;
  /** Vertical alignment of the canvas within the stage. Default "middle". */
  vAlign?: "top" | "middle" | "bottom";
  canvasOverlay?: ReactNode;
}

// Progress budget across the boot phases. Sums to 1.0.
//   wait     : fetching the runtime config
//   download : fetching the DOS ZIP bundle (real bytes/total)
//   runtime  : loading/instantiating the DOSBox JS/WASM runtime
//   extract  : unpacking the DOS files into the WASM filesystem
//   boot     : extract complete → first frame from the emulator
const W = { wait: 0.02, download: 0.77, runtime: 0.2, extract: 0.005, boot: 0.005 } as const;
const MAX_USER_STATE_BYTES = 3_500_000;
const BOOT_OVERLAY_OUT_MS = 280;

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function nextAnimationFrame(): Promise<void> {
  return new Promise((resolve) => requestAnimationFrame(() => resolve()));
}

async function streamBundle(
  url: string,
  signal: AbortSignal,
  onDownload: (fraction: number) => void,
): Promise<Uint8Array> {
  const r = await fetch(url, { signal });
  if (!r.ok) throw new Error(`bundle fetch failed: ${r.status}`);
  const totalHeader = r.headers.get("Content-Length");
  const total = totalHeader ? Number(totalHeader) : 0;
  if (!r.body) {
    // Older browsers / shimmed responses — fall back to a single arrayBuffer.
    const buf = new Uint8Array(await r.arrayBuffer());
    onDownload(1);
    return buf;
  }
  const reader = r.body.getReader();
  const chunks: Uint8Array[] = [];
  let received = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    received += value.length;
    if (total > 0) onDownload(Math.min(1, received / total));
  }
  // Concat. We allocate a fresh contiguous buffer because the WASM bridge
  // wants a single Uint8Array.
  const out = new Uint8Array(received);
  let off = 0;
  for (const c of chunks) { out.set(c, off); off += c.length; }
  if (total === 0) onDownload(1);
  return out;
}

async function fetchText(url: string, signal: AbortSignal): Promise<string> {
  const r = await fetch(url, { signal });
  if (!r.ok) throw new Error(`config fetch failed: ${r.status}`);
  return r.text();
}

function readValidUserState(): Uint8Array | null {
  const overlay = readUserState();
  if (!overlay) return null;
  if (overlay.byteLength > MAX_USER_STATE_BYTES) {
    console.warn("[dosframe] ignoring oversized saved user state:", overlay.byteLength);
    clearUserState();
    return null;
  }
  try {
    unzipSync(overlay);
    return overlay;
  } catch (err) {
    console.warn("[dosframe] ignoring invalid saved user state:", err);
    clearUserState();
    return null;
  }
}

export function DosFrame({ bundleUrl, configUrl, onReady, onError, onEmulator, width, height, vAlign = "middle", canvasOverlay }: DosFrameProps) {
  const stageRef = useRef<HTMLDivElement | null>(null);
  const ref = useRef<HTMLCanvasElement | null>(null);
  const [bootVisible, setBootVisible] = useState(true);
  const [progress, setProgress] = useState(0);
  const [phase, setPhase] = useState<BootPhase>("wait");
  const [bootMessage, setBootMessage] = useState<string | null>(null);
  const [overlayPos, setOverlayPos] = useState({ left: 16, top: 16 });
  const fixedSize = width != null && height != null;

  useLayoutEffect(() => {
    const stage = stageRef.current;
    const canvas = ref.current;
    if (!stage || !canvas) return;

    const update = () => {
      const stageRect = stage.getBoundingClientRect();
      const canvasRect = canvas.getBoundingClientRect();
      const left = Math.max(0, Math.round(canvasRect.left - stageRect.left + 12));
      const top = Math.max(0, Math.round(canvasRect.top - stageRect.top + 12));
      setOverlayPos((prev) => (prev.left === left && prev.top === top ? prev : { left, top }));
    };

    update();
    const ro = new ResizeObserver(update);
    ro.observe(stage);
    ro.observe(canvas);
    window.addEventListener("resize", update);
    return () => {
      ro.disconnect();
      window.removeEventListener("resize", update);
    };
  }, [fixedSize, width, height, vAlign]);

  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    if (fixedSize) {
      canvas.style.setProperty("width", `${width}px`, "important");
      canvas.style.setProperty("height", `${height}px`, "important");
    } else {
      canvas.style.setProperty("width", "100%", "important");
      canvas.style.setProperty("height", "100%", "important");
    }
  }, [fixedSize, width, height]);

  useEffect(() => {
    const ac = new AbortController();
    let cancelled = false;
    let emulator: DosEmulator | null = null;
    let runtimePromise: Promise<void> | null = null;

    const failBoot = (err: unknown) => {
      if (cancelled) return;
      console.error("[dosframe] boot failed:", err);
      const detail = err instanceof Error ? err.message : String(err);
      setBootMessage(`부팅 실패: ${detail}`);
      onError?.(err);
    };

    function setPhaseProgress(p: BootPhase, fraction: number) {
      // Translate phase + intra-phase fraction into a global [0,1] value.
      const f = Math.max(0, Math.min(1, fraction));
      let base = 0;
      if (p === "download") base = W.wait;
      else if (p === "runtime") base = W.wait + W.download;
      else if (p === "extract") base = W.wait + W.download + W.runtime;
      else if (p === "boot") base = W.wait + W.download + W.runtime + W.extract;
      const slice =
        p === "wait" ? W.wait :
        p === "download" ? W.download :
        p === "runtime" ? W.runtime :
        p === "extract" ? W.extract :
        W.boot;
      setPhase(p);
      setProgress((prev) => {
        const next = base + slice * f;
        // Progress is monotonic — protects against any out-of-order callbacks.
        return next > prev ? next : prev;
      });
    }

    async function boot() {
      // ── 1. fetch config ────────────────────────────────────────────
      setPhaseProgress("wait", 0);
      let config: string;
      try {
        config = await fetchText(configUrl, ac.signal);
      } catch (err) {
        failBoot(err);
        return;
      }
      setPhaseProgress("wait", 1);
      if (cancelled || !ref.current) return;
      runtimePromise = preloadDosboxRuntime();

      // ── 2. download bundle (real bytes via streaming reader) ───────
      let bundle: Uint8Array;
      try {
        setPhaseProgress("download", 0);
        bundle = await streamBundle(bundleUrl, ac.signal, (f) => setPhaseProgress("download", f));
      } catch (err) {
        failBoot(err);
        return;
      }
      if (cancelled || !ref.current) return;
      setPhaseProgress("download", 1);
      setPhaseProgress("runtime", 0);
      try {
        await runtimePromise;
      } catch (err) {
        failBoot(err);
        return;
      }
      if (cancelled || !ref.current) return;

      // ── 3. extract (BackendOptions.onExtractProgress) ─ 4. boot ────
      setPhaseProgress("extract", 0);
      // Read the per-user save (if any) once at boot. The toolbar's reactive
      // useUserState() hook covers UI; the engine just needs the bytes here.
      const overlay = readValidUserState();
      emulator = new DosEmulator({
        canvas: ref.current,
        bundle,
        config,
        displayWidth: width,
        displayHeight: height,
        overlay,
        onRuntimeReady: () => {
          setPhaseProgress("runtime", 1);
          setPhaseProgress("extract", 0);
        },
        onExtractProgress: (f) => setPhaseProgress("extract", f),
        onBeforeStart: async () => {
          // Extract is done here, but the bridge doesn't always emit a final
          // 1.0 progress tick. Hide the overlay before callMain() so any
          // pre-yield DOSBox startup work cannot visibly freeze CSS animation.
          setPhaseProgress("extract", 1);
          setPhaseProgress("boot", 0.4);
          await nextAnimationFrame();
          if (cancelled) return;
          setBootVisible(false);
          await delay(BOOT_OVERLAY_OUT_MS + 40);
        },
        onReady: (ci) => {
          onReady(ci);
        },
        onFirstFrame: () => {
          setPhaseProgress("boot", 1);
        },
        onError: failBoot,
      });
      onEmulator?.(emulator);
    }
    void boot();

    return () => {
      cancelled = true;
      ac.abort();
      if (emulator) {
        onEmulator?.(null);
        void emulator.destroy().catch(() => undefined);
      }
    };
  }, [bundleUrl, configUrl, onReady, onError, onEmulator]);

  return (
    <div ref={stageRef} className={`dos-stage dos-stage--valign-${vAlign}`}>
      <canvas
        ref={ref}
        tabIndex={0}
        className={fixedSize ? "dos-canvas dos-canvas--fixed" : "dos-canvas dos-canvas--fill"}
        style={fixedSize ? { width: `${width}px`, height: `${height}px` } : undefined}
      />
      {canvasOverlay && (
        <div className="audio-unlock" style={{ left: `${overlayPos.left}px`, top: `${overlayPos.top}px` }}>
          {canvasOverlay}
        </div>
      )}
      <BootScreen visible={bootVisible} progress={progress} phase={phase} message={bootMessage} />
    </div>
  );
}
