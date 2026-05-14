import { useEffect, useRef, useState } from "react";

/**
 * Retro CRT/BBS-style boot screen shown until js-dos reports ci-ready.
 * Phosphor-green terminal aesthetic — thick block-font DOSBOX, big Galmuri
 * Korean banner, BIOS POST log, header bar with BIOS info + clock,
 * sidebar VU/EQ meters, footer activity light, scanlines and vignette.
 *
 * Meant to evoke a Korean classroom PC powering on circa 1998.
 */

const LOGO = [
  "██████   ██████  ███████ ██████   ██████  ██   ██",
  "██   ██ ██    ██ ██      ██   ██ ██    ██  ██ ██ ",
  "██   ██ ██    ██ ███████ ██████  ██    ██   ███  ",
  "██   ██ ██    ██      ██ ██   ██ ██    ██  ██ ██ ",
  "██████   ██████  ███████ ██████   ██████  ██   ██",
].join("\n");

type Line = readonly [string, string, string];

const BOOT_LINES: readonly Line[] = [
  ["BIOS",          " GCJJYY v8.3 · IBM AT-COMPATIBLE", "OK"],
  ["EMULATOR INIT", " js-dos / wasm runtime          ", "OK"],
  ["MEMORY",        " 640K BASE · 15,360K EXTENDED   ", "OK"],
  ["FETCH BUNDLE",  " /dos.jsdos                     ", "..."],
  ["MOUNT C:",      " /home/gcjjyy/dos -> 512.5 MB   ", "OK"],
  ["CODEPAGE",      " CP949 · KSC5601 한글 모드      ", "OK"],
  ["CONFIG.SYS",    " FILES=60 BUFFERS=20 STACKS=9,256", "OK"],
  ["AUTOEXEC.BAT",  " PATH=C:\\QB45;C:\\WIN30;C:\\MDIR", "OK"],
  ["READY",         " WELCOME TO DOSBOX.GCJJYY.DEV   ", "♥"],
];

function pad(n: number): string { return n.toString().padStart(2, "0"); }
function fmtClock(d: Date): string { return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`; }
function fmtDate(d: Date): string { return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; }

// Side bar meter — 14 cells from bottom, animated heights via a deterministic
// pseudo-random walk seeded by tick, so SSR matches CSR until the timer kicks in.
function Meter({ label, seed }: { label: string; seed: number }) {
  const [tick, setTick] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setTick((t) => t + 1), 220);
    return () => clearInterval(id);
  }, []);
  const cells = Array.from({ length: 14 }, (_, i) => {
    const phase = (tick * 0.7 + i * 0.6 + seed) % (Math.PI * 2);
    // Pseudo-deterministic height based on phase + index.
    const h = 0.45 + 0.55 * Math.abs(Math.sin(phase));
    return h;
  });
  const peak = Math.max(...cells);
  return (
    <div className="flex flex-col items-center gap-1">
      <div className="font-[var(--font-mono)] text-[9px] tracking-[0.35em] text-[var(--color-phosphor-dim)] uppercase">
        {label}
      </div>
      <div className="flex h-[120px] w-[18px] flex-col-reverse gap-[2px]">
        {cells.map((h, i) => {
          const lit = h > i / cells.length;
          const isPeak = i === Math.floor(peak * cells.length) - 1;
          return (
            <span
              key={i}
              className={`block w-full transition-[opacity] duration-150 ${lit ? "opacity-100" : "opacity-15"}`}
              style={{
                height: "calc((100% - 26px) / 14)",
                background: isPeak ? "var(--color-phosphor)" : i < 9 ? "var(--color-phosphor)" : i < 12 ? "#facc15" : "#f87171",
                boxShadow: lit ? "0 0 4px currentColor" : "none",
              }}
            />
          );
        })}
      </div>
      <div className="font-[var(--font-crt)] text-[10px] text-[var(--color-phosphor)]">{Math.round(peak * 100).toString().padStart(2, "0")}</div>
    </div>
  );
}

export function BootScreen({ visible }: { visible: boolean }) {
  const [shown, setShown] = useState(1);
  const [tick, setTick] = useState(0);
  const [now, setNow] = useState<Date | null>(null);
  const [progress, setProgress] = useState(0);
  const stagger = useRef<number[]>([]);

  if (stagger.current.length === 0) {
    stagger.current = BOOT_LINES.map((_, i) => 90 + i * 280);
  }

  useEffect(() => {
    setNow(new Date());
    const id = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(id);
  }, []);

  // Simulated bundle-fetch progress. We can't reliably read the actual
  // download progress (js-dos handles it internally and the bundle is
  // typically HTTP-cached on warm visits), so animate to 99% over ~3s and
  // park there until ci-ready arrives.
  useEffect(() => {
    if (!visible) return;
    const start = Date.now();
    const id = setInterval(() => {
      const elapsed = Date.now() - start;
      // Asymptote toward 99 over ~3000ms.
      const pct = Math.min(99, Math.round(100 * (1 - Math.exp(-elapsed / 1200))));
      setProgress(pct);
      if (pct >= 99) clearInterval(id);
    }, 80);
    return () => clearInterval(id);
  }, [visible]);

  useEffect(() => {
    if (!visible) return;
    if (shown < BOOT_LINES.length) {
      const t = setTimeout(() => setShown((s) => s + 1), 230 + Math.random() * 140);
      return () => clearTimeout(t);
    }
    const t = setInterval(() => setTick((n) => n + 1), 900);
    return () => clearInterval(t);
  }, [shown, tick, visible]);

  const lines = BOOT_LINES.slice(0, shown);
  const lastDone = shown === BOOT_LINES.length;
  const progressBar = (() => {
    const width = 22;
    const filled = Math.round((progress / 100) * width);
    return "█".repeat(filled) + "░".repeat(width - filled);
  })();

  return (
    <div
      className={`crt-screen crt-scanlines crt-vignette pointer-events-none fixed inset-0 z-[9999] overflow-hidden ${visible ? "" : "crt-fadeout"}`}
      aria-hidden={!visible}
      style={{ fontFamily: "var(--font-crt)" }}
    >
      <span className="crt-scanbar" />

      {/* BIOS top bar */}
      <header className="crt-fade-in absolute top-0 right-0 left-0 grid grid-cols-3 items-center border-b border-[var(--color-phosphor)]/35 px-5 py-2 text-[12px] tracking-[0.3em] uppercase">
        <span className="text-[var(--color-phosphor)]">▌ DOSBOX BIOS v8.3</span>
        <span className="text-center text-[var(--color-phosphor)]/85 tabular-nums">
          {now ? `${fmtDate(now)}  ·  ${fmtClock(now)}` : "────────────  ·  ──:──:──"}
        </span>
        <span className="justify-self-end text-[var(--color-phosphor)]/70">
          DISK&nbsp;C  ·  RAM&nbsp;16M  ·  CGA/EGA/VGA
        </span>
      </header>

      {/* Left meters */}
      <aside className="crt-fade-in absolute top-1/2 left-6 -translate-y-1/2 flex flex-col gap-4" style={{ animationDelay: "320ms" }}>
        <Meter label="ROM" seed={0.2} />
        <Meter label="I/O" seed={1.4} />
      </aside>

      {/* Right meters */}
      <aside className="crt-fade-in absolute top-1/2 right-6 -translate-y-1/2 flex flex-col gap-4" style={{ animationDelay: "380ms" }}>
        <Meter label="GFX" seed={2.6} />
        <Meter label="SND" seed={3.8} />
      </aside>

      {/* Center stage */}
      <div className="absolute top-12 right-0 bottom-12 left-0 grid place-items-center overflow-hidden px-6">
        <div className="flex max-h-full w-[min(820px,92vw)] flex-col items-center gap-5 overflow-hidden">
          <pre
            className="crt-fade-in crt-logo-glow text-center text-[clamp(8px,1.35vw,15px)] leading-[1] whitespace-pre"
            style={{ animationDelay: "60ms" }}
          >
            {LOGO}
          </pre>

          <div className="crt-fade-in flex flex-col items-center gap-[6px] text-center" style={{ animationDelay: "200ms" }}>
            <p
              className="galmuri text-[34px] leading-none tracking-[0.04em]"
              style={{
                color: "var(--color-phosphor)",
                textShadow:
                  "0 0 1px var(--color-phosphor), 0 0 8px rgba(74,222,123,0.8), 0 0 24px rgba(74,222,123,0.45)",
              }}
            >
              한국 도스 게임 보존소
            </p>
            <p className="font-[var(--font-mono)] text-[10px] tracking-[0.45em] text-[var(--color-phosphor-dim)] uppercase">
              dosbox.gcjjyy.dev · korean ms-dos preservation · est&nbsp;2026
            </p>
          </div>

          {/* POST log */}
          <div className="crt-fade-in crt-bezel w-full max-w-[640px] px-5 pt-3 pb-4" style={{ animationDelay: "260ms" }}>
            <div className="mb-2 flex items-baseline justify-between text-[10px] tracking-[0.45em] text-[var(--color-phosphor-dim)] uppercase">
              <span>═══ power-on self test ═══</span>
              <span className="tabular-nums">{shown}/{BOOT_LINES.length}</span>
            </div>
            <ul className="space-y-[1px] text-[15px] leading-[1.45] sm:text-[16px]">
              {lines.map(([tag, body, status], i) => {
                const isFetch = tag === "FETCH BUNDLE";
                const showStatusDots = status === "..." && i === lines.length - 1 && !lastDone;
                const dots = ".".repeat((tick % 3) + 1).padEnd(3, " ");
                return (
                  <li
                    key={i}
                    className="crt-line-in grid grid-cols-[1fr_auto] gap-3 whitespace-pre"
                    style={{ animationDelay: `${stagger.current[i] ?? 0}ms` }}
                  >
                    <span>
                      <span className="text-[var(--color-phosphor-dim)]">&gt; </span>
                      <span className="text-[var(--color-phosphor)]">{tag.padEnd(14, " ")}</span>
                      <span className="galmuri text-[var(--color-phosphor)]/85">{body}</span>
                      {isFetch && (
                        <span className="ml-2 inline-flex items-baseline gap-2 align-baseline text-[var(--color-phosphor)]">
                          <span className="tracking-[0]">{progressBar}</span>
                          <span className="tabular-nums text-[var(--color-phosphor-dim)]">{progress.toString().padStart(2, " ")}%</span>
                        </span>
                      )}
                    </span>
                    <span className={showStatusDots ? "text-[var(--color-phosphor-dim)]" : "text-[var(--color-phosphor)]"}>
                      {showStatusDots ? `[ ${dots} ]` : `[ ${status} ]`}
                    </span>
                  </li>
                );
              })}
              {lastDone && (
                <li className="crt-line-in mt-3 flex items-center pl-3 text-[16px]">
                  <span className="text-[var(--color-phosphor-dim)]">C:\&gt;</span>
                  <span className="crt-cursor" />
                </li>
              )}
            </ul>
          </div>
        </div>
      </div>

      {/* Bottom hint bar */}
      <footer className="crt-fade-in absolute right-0 bottom-0 left-0 grid grid-cols-3 items-center border-t border-[var(--color-phosphor)]/35 px-5 py-2 text-[10px] tracking-[0.4em] text-[var(--color-phosphor-dim)] uppercase">
        <span>▌ rev 2026.05 · region kr</span>
        <span className="text-center">strg c — emergency reboot</span>
        <span className="flex items-center justify-end gap-2">
          <span className="crt-pulse inline-block h-[6px] w-[6px] rounded-full bg-[var(--color-phosphor)]" />
          link · ok
        </span>
      </footer>
    </div>
  );
}
