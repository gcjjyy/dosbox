import { useEffect, useRef } from "react";
import type { CommandInterface } from "js-dos/dist/emulators/types/emulators";

type DosEvent = "emu-ready" | "bnd-play" | "ci-ready" | "fullscreen-changed";

declare global {
  interface Window {
    Dos: (
      el: HTMLDivElement,
      opts: {
        url?: string;
        autoStart?: boolean;
        noCloud?: boolean;
        noNetworking?: boolean;
        pathPrefix?: string;
        onEvent?: (event: DosEvent, arg?: unknown) => void;
      },
    ) => { stop: () => void };
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

  useEffect(() => {
    let cancelled = false;
    let instance: ReturnType<Window["Dos"]> | null = null;

    async function wipeJsDosIdbIfBundleChanged(): Promise<void> {
      // Only wipe the js-dos IndexedDB cache when the server bundle has
      // changed (admin saved → new ETag). Wiping on every mount makes repeat
      // visits re-extract the 80 MB ~/dos every time, killing perf. Same-etag
      // visits keep the IDB cache so js-dos can reuse its extracted FS.
      const STORAGE_KEY = "dosbox-last-bundle-etag";
      let serverEtag = "";
      try {
        const r = await fetch(bundleUrl, { method: "HEAD", cache: "no-store" });
        serverEtag = r.headers.get("etag") ?? "";
      } catch { /* network blip — treat as unchanged */ return; }
      const lastSeen = (() => { try { return localStorage.getItem(STORAGE_KEY); } catch { return null; } })();
      if (serverEtag && serverEtag === lastSeen) return;
      try {
        const dbs = await (indexedDB as unknown as { databases?: () => Promise<{ name?: string }[]> })
          .databases?.() ?? [];
        await Promise.all(dbs.map(({ name }) => {
          if (!name || !name.toLowerCase().startsWith("js-dos")) return Promise.resolve();
          return new Promise<void>((resolve) => {
            const req = indexedDB.deleteDatabase(name);
            const done = () => resolve();
            req.addEventListener("success", done);
            req.addEventListener("error", done);
            req.addEventListener("blocked", done);
            setTimeout(done, 500);
          });
        }));
      } catch { /* ignore */ }
      try { if (serverEtag) localStorage.setItem(STORAGE_KEY, serverEtag); } catch { /* ignore */ }
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
      await wipeJsDosIdbIfBundleChanged();
      if (cancelled || !ref.current) return;
      try {
        instance = window.Dos(ref.current, {
          url: bundleUrl,
          pathPrefix: "/js-dos/emulators/",
          autoStart: true,
          noCloud: true,
          noNetworking: true,
          onEvent: (event, arg) => {
            if (cancelled) return;
            if (event === "ci-ready" && arg) onReady(arg as CommandInterface);
          },
        });
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
