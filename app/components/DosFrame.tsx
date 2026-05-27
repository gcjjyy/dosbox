// app/components/DosFrame.tsx
import { useEffect, useRef, useState } from "react";
import { DosEmulator, type CommandInterface } from "../lib/dos-emulator";
import { BootScreen, type BootPhase } from "./BootScreen";
import { readUserState } from "../lib/user-state";

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
}

// Progress budget across the four phases. Sums to 1.0.
//   wait     : fetching the runtime config
//   download : fetching the DOS ZIP bundle (real bytes/total)
//   extract  : unpacking the DOS files into the WASM filesystem
//   boot     : extract complete → first frame from the emulator
// download dominates wall-clock time; extract/boot are near-instant, so we give
// download the bulk of the budget (5%→99%) and leave extract/boot a thin tail.
const W = { wait: 0.05, download: 0.94, extract: 0.005, boot: 0.005 } as const;

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

export function DosFrame({ bundleUrl, configUrl, onReady, onError, onEmulator, width, height, vAlign = "middle" }: DosFrameProps) {
  const ref = useRef<HTMLCanvasElement | null>(null);
  const [bootVisible, setBootVisible] = useState(true);
  const [progress, setProgress] = useState(0);
  const [phase, setPhase] = useState<BootPhase>("wait");
  const mountedAt = useRef<number>(0);
  const fixedSize = width != null && height != null;

  useEffect(() => {
    mountedAt.current = Date.now();
    const ac = new AbortController();
    let cancelled = false;
    let emulator: DosEmulator | null = null;

    function setPhaseProgress(p: BootPhase, fraction: number) {
      // Translate phase + intra-phase fraction into a global [0,1] value.
      const f = Math.max(0, Math.min(1, fraction));
      let base = 0;
      if (p === "download") base = W.wait;
      else if (p === "extract") base = W.wait + W.download;
      else if (p === "boot") base = W.wait + W.download + W.extract;
      const slice =
        p === "wait" ? W.wait :
        p === "download" ? W.download :
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
        if (!cancelled) onError?.(err);
        return;
      }
      setPhaseProgress("wait", 1);
      if (cancelled || !ref.current) return;

      // ── 2. download bundle (real bytes via streaming reader) ───────
      let bundle: Uint8Array;
      try {
        setPhaseProgress("download", 0);
        bundle = await streamBundle(bundleUrl, ac.signal, (f) => setPhaseProgress("download", f));
      } catch (err) {
        if (!cancelled) onError?.(err);
        return;
      }
      if (cancelled || !ref.current) return;
      setPhaseProgress("download", 1);

      // ── 3. extract (BackendOptions.onExtractProgress) ─ 4. boot ────
      setPhaseProgress("extract", 0);
      // Read the per-user save (if any) once at boot. The toolbar's reactive
      // useUserState() hook covers UI; the engine just needs the bytes here.
      const overlay = readUserState();
      emulator = new DosEmulator({
        canvas: ref.current,
        bundle,
        config,
        overlay,
        onExtractProgress: (f) => setPhaseProgress("extract", f),
        onReady: (ci) => {
          // Extract is done by the time onReady fires inside the bridge,
          // but the bridge doesn't always emit a final 1.0 progress tick.
          setPhaseProgress("extract", 1);
          setPhaseProgress("boot", 0.4);
          onReady(ci);
        },
        onFirstFrame: () => {
          setPhaseProgress("boot", 1);
          const MIN_MS = 1500;
          const elapsed = Date.now() - mountedAt.current;
          const wait = Math.max(0, MIN_MS - elapsed);
          setTimeout(() => {
            if (cancelled) return;
            setBootVisible(false);
          }, wait);
        },
        onError,
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
    <div className={`dos-stage dos-stage--valign-${vAlign}`}>
      <canvas
        ref={ref}
        tabIndex={0}
        className={fixedSize ? "dos-canvas dos-canvas--fixed" : "dos-canvas dos-canvas--fill"}
        style={fixedSize ? { width: `${width}px`, height: `${height}px` } : undefined}
      />
      <BootScreen visible={bootVisible} progress={progress} phase={phase} />
    </div>
  );
}
