import { useEffect, useRef } from "react";
import type { JsDosCi } from "../lib/fs-diff";

declare global {
  interface Window {
    Dos: (
      el: HTMLDivElement,
      opts: { url: string },
    ) => {
      stop: () => void;
      ciPromise?: Promise<JsDosCi & { exit?: () => Promise<void> }>;
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
      // Wait for window.Dos to be defined (script tag loads async)
      const start = Date.now();
      while (typeof window.Dos !== "function") {
        if (Date.now() - start > 30_000) throw new Error("js-dos failed to load within 30s");
        await new Promise((r) => setTimeout(r, 100));
      }
      if (cancelled || !ref.current) return;
      try {
        instance = window.Dos(ref.current, { url: bundleUrl });
        const ci = await instance.ciPromise;
        if (!ci || cancelled) return;
        onReady(ci);
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
