import { Minus, Plus, X } from "lucide-react";
import { useEffect, useRef } from "react";
import { ResolutionPicker, type ResolutionId } from "./ResolutionPicker";
import { CYCLES_MIN, CYCLES_MAX } from "../lib/cpu-cycles";
import type { CanvasVAlign } from "../lib/options";

export interface OptionsDialogProps {
  onClose: () => void;
  resolutionId: ResolutionId;
  onResolutionChange: (id: ResolutionId) => void;
  cycles: number;
  onCyclesUp: () => void;
  onCyclesDown: () => void;
  canvasVAlign: CanvasVAlign;
  onCanvasVAlignChange: (v: CanvasVAlign) => void;
  keyboardOpacity: number;
  onKeyboardOpacityChange: (v: number) => void;
}

const VALIGN_OPTS: { id: CanvasVAlign; label: string }[] = [
  { id: "top", label: "위" },
  { id: "middle", label: "중간" },
  { id: "bottom", label: "아래" },
];

const STEP_ICON = { size: 12, strokeWidth: 1.75, "aria-hidden": true } as const;

export function OptionsDialog({
  onClose,
  resolutionId,
  onResolutionChange,
  cycles,
  onCyclesUp,
  onCyclesDown,
  canvasVAlign,
  onCanvasVAlignChange,
  keyboardOpacity,
  onKeyboardOpacityChange,
}: OptionsDialogProps) {
  const dialogRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    dialogRef.current?.focus({ preventScroll: true });
  }, []);

  return (
    <div className="opt-overlay" onClick={onClose}>
      <div
        ref={dialogRef}
        className="opt-dialog"
        role="dialog"
        aria-label="설정"
        tabIndex={-1}
        onClick={(e) => e.stopPropagation()}
      >
        <header className="opt-header">
          <span className="opt-title">설정</span>
          <button type="button" className="opt-close" onClick={onClose} aria-label="닫기">
            <X size={13} strokeWidth={1.75} aria-hidden="true" />
          </button>
        </header>

        <div className="opt-row">
          <span className="opt-label">해상도</span>
          <ResolutionPicker value={resolutionId} onChange={onResolutionChange} />
        </div>

        <div className="opt-row">
          <span className="opt-label">CPU 속도</span>
          <div className="opt-stepper">
            <button
              type="button"
              className="opt-step-btn"
              onClick={onCyclesDown}
              disabled={cycles <= CYCLES_MIN}
              aria-label="CPU 속도 낮추기"
            >
              <Minus {...STEP_ICON} />
            </button>
            <span className="opt-stepper-value" aria-live="polite">
              {cycles.toLocaleString()}
            </span>
            <button
              type="button"
              className="opt-step-btn"
              onClick={onCyclesUp}
              disabled={cycles >= CYCLES_MAX}
              aria-label="CPU 속도 높이기"
            >
              <Plus {...STEP_ICON} />
            </button>
          </div>
        </div>

        <div className="opt-row">
          <span className="opt-label">화면 세로 위치</span>
          <div className="opt-seg" role="group" aria-label="화면 세로 위치">
            {VALIGN_OPTS.map((o) => (
              <button
                key={o.id}
                type="button"
                className={`opt-seg-btn${canvasVAlign === o.id ? " opt-seg-btn--active" : ""}`}
                onClick={() => onCanvasVAlignChange(o.id)}
                aria-pressed={canvasVAlign === o.id}
              >
                {o.label}
              </button>
            ))}
          </div>
        </div>

        <div className="opt-row opt-row--last">
          <span className="opt-label">키보드 투명도</span>
          <div className="opt-range-wrap">
            <input
              className="opt-range"
              type="range"
              min={0}
              max={1}
              step={0.05}
              value={keyboardOpacity}
              onChange={(e) => onKeyboardOpacityChange(Number(e.target.value))}
              aria-label="키보드 투명도"
            />
            <span className="opt-range-val">{Math.round(keyboardOpacity * 100)}%</span>
          </div>
        </div>
      </div>
    </div>
  );
}
