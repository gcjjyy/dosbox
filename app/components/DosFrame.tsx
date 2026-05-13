import { useEffect, useRef, useState } from "react";
import type { JsDosCi } from "../lib/fs-diff";

type DosEvent = "emu-ready" | "bnd-play" | "ci-ready" | "fullscreen-changed";
type Phase = "loading" | "booting" | "ready";

declare global {
  interface Window {
    Dos: (
      el: HTMLDivElement,
      opts: {
        url?: string;
        autoStart?: boolean;
        backend?: "dosbox" | "dosboxX";
        noCloud?: boolean;
        noNetworking?: boolean;
        onEvent?: (event: DosEvent, arg?: unknown) => void;
      },
    ) => { stop: () => void };
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

    async function wipeStaleJsDosCache() {
      // js-dos persists FS deltas in IndexedDB ("js-dos-cache (guest)"); once a
      // bad/inconsistent state lands there it gets replayed every boot and DOSBox
      // exits before ci-ready fires (observed: a constant BC31/BGI + ExitStatus
      // even with single-file bundles). The server is the source of truth for
      // ~/dos, so we don't want IDBFS persistence at all. Wipe before mount.
      try {
        const list = await (indexedDB as unknown as { databases?: () => Promise<{ name?: string }[]> })
          .databases?.() ?? [];
        await Promise.all(list.map(({ name }) =>
          !name || !name.toLowerCase().startsWith("js-dos")
            ? Promise.resolve()
            : new Promise<void>((resolve) => {
              const req = indexedDB.deleteDatabase(name);
              const done = () => resolve();
              req.addEventListener("success", done);
              req.addEventListener("error", done);
              req.addEventListener("blocked", done);
              setTimeout(done, 500);
            }),
        ));
      } catch { /* ignore */ }
    }

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
      await wipeStaleJsDosCache();
      if (cancelled || !ref.current) return;
      try {
        instance = window.Dos(ref.current, {
          url: bundleUrl,
          autoStart: true,
          noCloud: true,
          noNetworking: true,
          onEvent: (event, arg) => {
            if (cancelled) return;
            if (event === "bnd-play") setPhase("booting");
            if (event === "ci-ready" && arg) {
              setPhase("ready");
              onReady(arg as JsDosCi);
            }
          },
        });
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
