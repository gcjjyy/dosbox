// app/components/DosFrame.tsx
import { useEffect, useRef, useState } from "react";
import { DosEmulator, type CommandInterface } from "../lib/dos-emulator";
import { BootScreen } from "./BootScreen";

export type { CommandInterface };
export type { DosEmulator };

export interface DosFrameProps {
  bundleUrl: string;
  onReady: (ci: CommandInterface) => void;
  onError?: (err: unknown) => void;
  /** Called when DosEmulator instance is available (and again with null on unmount). */
  onEmulator?: (emu: DosEmulator | null) => void;
  /** Display width in CSS px. null → fill available space (object-fit contain). */
  width?: number | null;
  /** Display height in CSS px. null → fill available space. */
  height?: number | null;
}

export function DosFrame({ bundleUrl, onReady, onError, onEmulator, width, height }: DosFrameProps) {
  const ref = useRef<HTMLCanvasElement | null>(null);
  const [bootVisible, setBootVisible] = useState(true);
  const mountedAt = useRef<number>(0);
  const fixedSize = width != null && height != null;

  useEffect(() => {
    mountedAt.current = Date.now();
    let cancelled = false;
    let emulator: DosEmulator | null = null;

    async function boot() {
      const start = Date.now();
      while (!window.emulators) {
        if (Date.now() - start > 30_000) {
          onError?.(new Error("emulators failed to load within 30s"));
          return;
        }
        await new Promise((r) => setTimeout(r, 100));
      }
      if (cancelled || !ref.current) return;

      let bundle: Uint8Array;
      try {
        const r = await fetch(bundleUrl, { cache: "no-cache" });
        if (!r.ok) throw new Error(`bundle fetch failed: ${r.status}`);
        bundle = new Uint8Array(await r.arrayBuffer());
      } catch (err) {
        onError?.(err);
        return;
      }
      if (cancelled || !ref.current) return;

      emulator = new DosEmulator({
        canvas: ref.current,
        bundle,
        onReady,
        onFirstFrame: () => {
          // Minimum boot-screen display time. On warm visits the first frame
          // can arrive in ~200 ms; this keeps the splash readable.
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
      if (emulator) {
        onEmulator?.(null);
        void emulator.destroy().catch(() => undefined);
      }
    };
  }, [bundleUrl, onReady, onError, onEmulator]);

  return (
    <div className="dos-stage">
      <canvas
        ref={ref}
        className={fixedSize ? "dos-canvas dos-canvas--fixed" : "dos-canvas dos-canvas--fill"}
        style={fixedSize ? { width: `${width}px`, height: `${height}px` } : undefined}
      />
      <BootScreen visible={bootVisible} />
    </div>
  );
}
