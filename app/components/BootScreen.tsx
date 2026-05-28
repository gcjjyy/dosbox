import { version } from "../../package.json";

/**
 * Boot overlay shown until the emulator reports its first frame.
 *
 * Refined minimal · midnight navy. A thin linear progress bar drives a
 * real-percentage readout across phases (wait → download → runtime → extract
 * → boot). Below: wordmark + phase label. No spinner — the bar is the motion.
 */

export type BootPhase = "wait" | "download" | "runtime" | "extract" | "boot";

const PHASE_LABEL: Record<BootPhase, string> = {
  wait: "에뮬레이터 준비 중",
  download: "디스크 이미지 내려받는 중",
  runtime: "도스박스 런타임 불러오는 중",
  extract: "디스크 압축 푸는 중",
  boot: "도스 부팅 중",
};

export function BootScreen({
  visible,
  progress,
  phase,
  message,
}: {
  visible: boolean;
  progress: number;
  phase: BootPhase;
  message?: string | null;
}) {
  const pct = Math.max(0, Math.min(100, Math.round(progress * 100)));

  return (
    <div
      className={`boot-overlay pointer-events-none fixed inset-0 z-[9999] grid place-items-center ${visible ? "" : "boot-overlay--out"}`}
      aria-hidden={!visible}
    >
      <div className="boot-stack">
        <img className="boot-icon" src="/favicon-96x96.png" width={64} height={64} alt="" aria-hidden="true" />
        <div className="boot-progress" role="progressbar" aria-label="Loading" aria-valuemin={0} aria-valuemax={100} aria-valuenow={pct}>
          <div className="boot-progress__track">
            <div className="boot-progress__fill" style={{ width: `${pct}%` }} />
            <span className="boot-progress__pct">{pct}%</span>
          </div>
        </div>

        <div className="boot-text">
          <p className="boot-wordmark">
            <span className="boot-wordmark__name">DOSBOX</span>
            <span className="boot-wordmark__cursor" aria-hidden="true">_</span>
          </p>
          <p className="boot-status" key={message ?? phase}>{message ?? PHASE_LABEL[phase]}</p>
        </div>
      </div>

      <div className="boot-footer">
        <span className="boot-footer__dot" />
        <span>v{version}</span>
      </div>
    </div>
  );
}
