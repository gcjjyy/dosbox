import { useEffect, useRef, useState } from "react";
import type { CommandInterface } from "emulators";
import type { DosPlayer, DosPlayerFactoryType } from "js-dos";

declare global {
  interface Window {
    Dos: DosPlayerFactoryType;
    emulators: { pathPrefix: string;[key: string]: unknown };
  }
}

export type { CommandInterface };

export interface DosFrameProps {
  bundleUrl: string;
  onReady: (ci: CommandInterface) => void;
  onError?: (err: unknown) => void;
}

export function DosFrame({ bundleUrl, onReady, onError }: DosFrameProps) {
  const ref = useRef<HTMLDivElement | null>(null);
  const [phase, setPhase] = useState<"loading" | "ready">("loading");
  const [seconds, setSeconds] = useState(0);

  useEffect(() => {
    let cancelled = false;
    let instance: DosPlayer | null = null;
    const startedAt = Date.now();
    const tick = setInterval(() => {
      if (!cancelled) setSeconds(Math.floor((Date.now() - startedAt) / 1000));
    }, 1000);

    async function boot() {
      const start = Date.now();
      while (typeof window.Dos !== "function" || !window.emulators) {
        if (Date.now() - start > 30_000) {
          onError?.(new Error("js-dos failed to load within 30s"));
          return;
        }
        await new Promise((r) => setTimeout(r, 100));
      }
      window.emulators.pathPrefix = "/js-dos/";
      if (cancelled || !ref.current) return;
      try {
        instance = window.Dos(ref.current);
        const ci = await instance.run(bundleUrl);
        if (cancelled) {
          ci.exit().catch(() => { /* ignore */ });
          return;
        }
        setPhase("ready");
        onReady(ci);
      } catch (err) {
        onError?.(err);
      }
    }
    boot();

    return () => {
      cancelled = true;
      clearInterval(tick);
      try { instance?.stop(); } catch { /* ignore */ }
    };
  }, [bundleUrl, onReady, onError]);

  return (
    <div className="relative size-full">
      <div ref={ref} className="size-full" />
      {phase !== "ready" && (
        <div className="pointer-events-none absolute bottom-3 left-1/2 z-10 -translate-x-1/2 rounded bg-black/85 px-4 py-2 text-center text-xs text-gray-200 shadow-lg">
          <div className="font-mono">
            DOSBox 로딩 중… ({seconds}s)
          </div>
          <div className="mt-1 text-[10px] text-gray-400">
            첫 로드는 시간이 좀 걸려요. 다음 방문부터 빠릅니다.
          </div>
        </div>
      )}
    </div>
  );
}
