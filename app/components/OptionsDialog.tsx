import { ResolutionPicker, type ResolutionId } from "./ResolutionPicker";
import { IconMinus, IconPlus } from "./Toolbar";
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
  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/60" onClick={onClose}>
      <div
        onClick={(e) => e.stopPropagation()}
        className="w-96 max-w-[calc(100vw-24px)] rounded-lg bg-gray-900 p-6 text-gray-100 shadow-xl"
        role="dialog"
        aria-label="설정"
      >
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-lg font-semibold">설정</h2>
          <button type="button" onClick={onClose} className="rounded px-2 py-1 text-sm hover:bg-gray-800" aria-label="닫기">✕</button>
        </div>

        {/* Resolution */}
        <div className="mb-5 flex items-center justify-between gap-4">
          <span className="text-sm text-gray-300">해상도</span>
          <ResolutionPicker value={resolutionId} onChange={onResolutionChange} />
        </div>

        {/* CPU cycles */}
        <div className="mb-5 flex items-center justify-between gap-4">
          <span className="text-sm text-gray-300">CPU 속도</span>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={onCyclesDown}
              disabled={cycles <= CYCLES_MIN}
              className="grid h-7 w-7 place-items-center rounded border border-gray-700 hover:bg-gray-800 disabled:opacity-40"
              aria-label="CPU 속도 낮추기"
            >
              <IconMinus />
            </button>
            <span className="min-w-[64px] text-center text-sm tabular-nums" aria-live="polite">
              {cycles.toLocaleString()}
            </span>
            <button
              type="button"
              onClick={onCyclesUp}
              disabled={cycles >= CYCLES_MAX}
              className="grid h-7 w-7 place-items-center rounded border border-gray-700 hover:bg-gray-800 disabled:opacity-40"
              aria-label="CPU 속도 높이기"
            >
              <IconPlus />
            </button>
          </div>
        </div>

        {/* Canvas vertical alignment */}
        <div className="mb-5 flex items-center justify-between gap-4">
          <span className="text-sm text-gray-300">화면 세로 위치</span>
          <div className="flex overflow-hidden rounded border border-gray-700" role="group" aria-label="화면 세로 위치">
            {VALIGN_OPTS.map((o) => (
              <button
                key={o.id}
                type="button"
                onClick={() => onCanvasVAlignChange(o.id)}
                aria-pressed={canvasVAlign === o.id}
                className={
                  "px-3 py-1 text-sm " +
                  (canvasVAlign === o.id ? "bg-emerald-600 text-white" : "hover:bg-gray-800")
                }
              >
                {o.label}
              </button>
            ))}
          </div>
        </div>

        {/* Keyboard opacity */}
        <div className="flex items-center justify-between gap-4">
          <span className="text-sm text-gray-300">키보드 투명도</span>
          <div className="flex items-center gap-2">
            <input
              type="range"
              min={0}
              max={1}
              step={0.05}
              value={keyboardOpacity}
              onChange={(e) => onKeyboardOpacityChange(Number(e.target.value))}
              aria-label="키보드 투명도"
              className="w-40"
            />
            <span className="min-w-[36px] text-right text-sm tabular-nums">
              {Math.round(keyboardOpacity * 100)}%
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}
