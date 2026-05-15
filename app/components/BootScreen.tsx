import { useEffect, useState } from "react";
import { version } from "../../package.json";

/**
 * Boot overlay shown until js-dos reports ci-ready.
 *
 * Refined minimal · midnight navy. One wordmark, one spinner, one status line.
 * No glow, no scanlines, no flicker — just a quiet loading state.
 */

const STATUS = [
  "에뮬레이터 시작 중",
  "디스크 마운트 중",
  "도스 준비 중",
];

export function BootScreen({ visible }: { visible: boolean }) {
  // Cycle a small set of status lines so the user has a sign of life even
  // though the underlying work has no real progress signal we can subscribe
  // to. Slow cadence — ~1.6s per phrase — so it doesn't feel busy.
  const [phase, setPhase] = useState(0);
  useEffect(() => {
    if (!visible) return;
    const id = setInterval(() => setPhase((p) => (p + 1) % STATUS.length), 1600);
    return () => clearInterval(id);
  }, [visible]);

  return (
    <div
      className={`boot-overlay pointer-events-none fixed inset-0 z-[9999] grid place-items-center ${visible ? "" : "boot-overlay--out"}`}
      aria-hidden={!visible}
    >
      <div className="flex flex-col items-center gap-7">
        <div className="boot-spinner" role="progressbar" aria-label="Loading">
          <span className="boot-spinner__track" />
          <span className="boot-spinner__arc" />
        </div>

        <div className="flex flex-col items-center gap-2 text-center">
          <p className="boot-wordmark">dosbox.gcjjyy.dev</p>
          <p className="boot-status" key={phase}>{STATUS[phase]}</p>
        </div>
      </div>

      <div className="boot-footer">
        <span className="boot-footer__dot" />
        <span>v{version} · korean ms-dos preservation</span>
      </div>
    </div>
  );
}
