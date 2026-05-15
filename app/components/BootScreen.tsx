import { version } from "../../package.json";

/**
 * Boot overlay shown until the emulator reports its first frame.
 *
 * Refined minimal · midnight navy. A thin linear progress bar drives a
 * real-percentage readout across four phases (wait → download → extract →
 * boot). Below: wordmark + phase label. No spinner — the bar is the motion.
 */

export type BootPhase = "wait" | "download" | "extract" | "boot";

const PHASE_LABEL: Record<BootPhase, string> = {
  wait: "에뮬레이터 준비 중",
  download: "디스크 이미지 내려받는 중",
  extract: "디스크 압축 푸는 중",
  boot: "도스 부팅 중",
};

export function BootScreen({
  visible,
  progress,
  phase,
}: {
  visible: boolean;
  progress: number;
  phase: BootPhase;
}) {
  const pct = Math.max(0, Math.min(100, Math.round(progress * 100)));

  return (
    <div
      className={`boot-overlay pointer-events-none fixed inset-0 z-[9999] grid place-items-center ${visible ? "" : "boot-overlay--out"}`}
      aria-hidden={!visible}
    >
      <div className="boot-stack">
        <div className="boot-progress" role="progressbar" aria-label="Loading" aria-valuemin={0} aria-valuemax={100} aria-valuenow={pct}>
          <div className="boot-progress__track">
            <div className="boot-progress__fill" style={{ width: `${pct}%` }} />
          </div>
          <span className="boot-progress__pct">{pct.toString().padStart(2, "0")}%</span>
        </div>

        <div className="boot-text">
          <p className="boot-wordmark">dosbox.gcjjyy.dev</p>
          <p className="boot-status" key={phase}>{PHASE_LABEL[phase]}</p>
        </div>
      </div>

      <div className="boot-footer">
        <span className="boot-footer__dot" />
        <span>v{version} · korean ms-dos preservation</span>
      </div>
    </div>
  );
}
