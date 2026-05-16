import { useEffect, useId, useRef, useState } from "react";

export type ResolutionId = "640x480" | "800x600" | "1024x768" | "1280x960" | "fullscreen";

export interface Resolution {
  id: ResolutionId;
  label: string;
  tag: string;
  width: number | null;
  height: number | null;
}

export const RESOLUTIONS: readonly Resolution[] = [
  { id: "640x480", label: "640 × 480", tag: "VGA", width: 640, height: 480 },
  { id: "800x600", label: "800 × 600", tag: "SVGA", width: 800, height: 600 },
  { id: "1024x768", label: "1024 × 768", tag: "XGA", width: 1024, height: 768 },
  { id: "1280x960", label: "1280 × 960", tag: "HD", width: 1280, height: 960 },
  { id: "fullscreen", label: "전체화면", tag: "FIT", width: null, height: null },
];

export const DEFAULT_RESOLUTION: ResolutionId = "640x480";

export function resolutionById(id: ResolutionId): Resolution {
  return RESOLUTIONS.find((r) => r.id === id) ?? RESOLUTIONS[0];
}

export interface ResolutionPickerProps {
  value: ResolutionId;
  onChange: (id: ResolutionId) => void;
}

export function ResolutionPicker({ value, onChange }: ResolutionPickerProps) {
  const [open, setOpen] = useState(false);
  const [focusIdx, setFocusIdx] = useState(0);
  const rootRef = useRef<HTMLDivElement | null>(null);
  const listRef = useRef<HTMLUListElement | null>(null);
  const listId = useId();
  const current = resolutionById(value);
  const currentIdx = Math.max(0, RESOLUTIONS.findIndex((r) => r.id === value));

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") { setOpen(false); return; }
      if (e.key === "ArrowDown") {
        e.preventDefault();
        setFocusIdx((i) => (i + 1) % RESOLUTIONS.length);
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        setFocusIdx((i) => (i - 1 + RESOLUTIONS.length) % RESOLUTIONS.length);
      } else if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        onChange(RESOLUTIONS[focusIdx].id);
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", onDoc);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDoc);
      document.removeEventListener("keydown", onKey);
    };
  }, [open, focusIdx, onChange]);

  useEffect(() => {
    if (open) setFocusIdx(currentIdx);
  }, [open, currentIdx]);

  return (
    <div ref={rootRef} className="res-picker">
      <button
        type="button"
        className="res-picker__trigger"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={listId}
        aria-label={`해상도: ${current.label}`}
        onClick={() => setOpen((o) => !o)}
      >
        <span className="res-picker__value res-picker__value--full">{current.label}</span>
        <span className="res-picker__value res-picker__value--tag" aria-hidden="true">
          {current.tag}
        </span>
        <svg
          className={`res-picker__chev ${open ? "res-picker__chev--up" : ""}`}
          width="8"
          height="8"
          viewBox="0 0 8 8"
          aria-hidden="true"
        >
          <path d="M1 3 L4 6 L7 3" fill="none" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>

      {open && (
        <ul
          ref={listRef}
          id={listId}
          role="listbox"
          aria-label="해상도"
          className="res-picker__menu"
        >
          <li className="res-picker__hint" aria-hidden="true">resolution</li>
          {RESOLUTIONS.map((r, idx) => {
            const selected = r.id === value;
            const focused = idx === focusIdx;
            return (
              <li
                key={r.id}
                role="option"
                aria-selected={selected}
                className={`res-picker__opt ${selected ? "res-picker__opt--selected" : ""} ${focused ? "res-picker__opt--focused" : ""}`}
                onMouseEnter={() => setFocusIdx(idx)}
                onClick={() => { onChange(r.id); setOpen(false); }}
              >
                <span className="res-picker__bar" aria-hidden="true" />
                <span className="res-picker__opt-label">{r.label}</span>
                <span className="res-picker__opt-tag">{r.tag}</span>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
