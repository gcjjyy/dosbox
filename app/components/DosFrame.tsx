import { useEffect, useRef, useState } from "react";
import type { JsDosCi } from "../lib/fs-diff";

type DosEvent = "emu-ready" | "bnd-play" | "ci-ready" | "fullscreen-changed";
type Phase = "loading" | "booting" | "ready";

declare global {
  interface Window {
    Dos: (
      el: HTMLDivElement,
      opts: {
        url: string;
        onEvent?: (event: DosEvent, arg?: unknown) => void;
      },
    ) => {
      stop: () => void;
      setAutoStart: (v: boolean) => void;
    };
  }
}

export interface DosFrameProps {
  bundleUrl: string;
  onReady: (ci: JsDosCi) => void;
  onError?: (err: unknown) => void;
}

export function DosFrame({ bundleUrl, onReady, onError }: DosFrameProps) {
  const ref = useRef<HTMLDivElement | null>(null);
  const [phase, setPhase] = useState<Phase>("loading");
  const [seconds, setSeconds] = useState(0);

  useEffect(() => {
    let cancelled = false;
    let instance: ReturnType<Window["Dos"]> | null = null;
    const startedAt = Date.now();
    const tick = setInterval(() => {
      if (!cancelled) setSeconds(Math.floor((Date.now() - startedAt) / 1000));
    }, 1000);

    async function boot() {
      const start = Date.now();
      while (typeof window.Dos !== "function") {
        if (Date.now() - start > 30_000) {
          onError?.(new Error("js-dos failed to load within 30s"));
          return;
        }
        await new Promise((r) => setTimeout(r, 100));
      }
      if (cancelled || !ref.current) return;
      try {
        instance = window.Dos(ref.current, {
          url: bundleUrl,
          onEvent: (event, arg) => {
            if (cancelled) return;
            if (event === "bnd-play") setPhase("booting");
            if (event === "ci-ready" && arg) {
              setPhase("ready");
              onReady(arg as JsDosCi);
            }
          },
        });
        instance.setAutoStart(true);
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
            {phase === "loading"
              ? `번들 다운로드 + 압축 해제 중… (${seconds}s)`
              : `DOSBox 부팅 중… (${seconds}s)`}
          </div>
          <div className="mt-1 text-[10px] text-gray-400">
            첫 로드는 1-2분 걸려요. 다음 방문부터 빠릅니다.
          </div>
        </div>
      )}
    </div>
  );
}
