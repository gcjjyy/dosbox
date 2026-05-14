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

    async function wipeJsDosIdb() {
      // js-dos persists FS deltas in IndexedDB ('js-dos-cache (...)'); once a
      // session's FS state lands there, every subsequent boot tries to replay
      // it and DOSBox exits before ci-ready fires (observed: QB45/ADVR_EX
      // "No such file or directory" + ExitStatus on a brand-new bundle that
      // didn't even contain QB45 — the path came from the cached session).
      // The server is the source of truth for ~/dos, so wipe IDB on every
      // mount before starting js-dos.
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
      await wipeJsDosIdb();
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
