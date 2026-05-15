// app/lib/use-virtual-keyboard.ts
//
// Auto-detect touch device → default ON. User toggle persists in
// localStorage and takes precedence over auto-detect on next visit.

import { useCallback, useEffect, useState } from "react";

const STORAGE_KEY = "dosbox-virtual-keyboard";

function detectTouch(): boolean {
  if (typeof window === "undefined") return false;
  try {
    if (window.matchMedia?.("(pointer: coarse)").matches) return true;
  } catch { /* ignore */ }
  return "ontouchstart" in window;
}

export function useVirtualKeyboard(): [boolean, () => void] {
  // SSR-safe: always start false; client useEffect adjusts after hydration.
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      if (saved === "1") { setVisible(true); return; }
      if (saved === "0") { setVisible(false); return; }
    } catch { /* ignore */ }
    setVisible(detectTouch());
  }, []);

  const toggle = useCallback(() => {
    setVisible((v) => {
      const next = !v;
      try { localStorage.setItem(STORAGE_KEY, next ? "1" : "0"); } catch { /* ignore */ }
      return next;
    });
  }, []);

  return [visible, toggle];
}
