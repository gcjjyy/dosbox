import { useEffect, useRef } from "react";
import type { JsDosCi } from "../lib/fs-diff";

type DosEvent = "emu-ready" | "bnd-play" | "ci-ready" | "fullscreen-changed";

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

  useEffect(() => {
    let cancelled = false;
    let instance: ReturnType<Window["Dos"]> | null = null;

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
            if (event === "ci-ready" && arg) {
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
      try { instance?.stop(); } catch { /* ignore */ }
    };
  }, [bundleUrl, onReady, onError]);

  return <div ref={ref} className="size-full" />;
}
