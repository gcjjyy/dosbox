import { useCallback, useEffect, useState } from "react";
import {
  DEFAULT_OPTIONS,
  LEGACY_RESOLUTION_KEY,
  OPTIONS_STORAGE_KEY,
  parseOptions,
  serializeOptions,
  type Options,
} from "./options";

// SSR-safe: starts at defaults, then hydrates from localStorage after mount
// (mirrors the old use-resolution.ts pattern). setOption updates one field,
// persists the whole blob, and re-renders.
export function useOptions(): [Options, <K extends keyof Options>(key: K, value: Options[K]) => void] {
  const [options, setOptions] = useState<Options>(DEFAULT_OPTIONS);

  useEffect(() => {
    try {
      const raw = localStorage.getItem(OPTIONS_STORAGE_KEY);
      const legacy = raw === null ? localStorage.getItem(LEGACY_RESOLUTION_KEY) : null;
      setOptions(parseOptions(raw, legacy));
    } catch {
      /* ignore — keep defaults */
    }
  }, []);

  const setOption = useCallback(<K extends keyof Options>(key: K, value: Options[K]) => {
    setOptions((prev) => {
      const next = { ...prev, [key]: value };
      try {
        localStorage.setItem(OPTIONS_STORAGE_KEY, serializeOptions(next));
      } catch {
        /* ignore quota/availability errors */
      }
      return next;
    });
  }, []);

  return [options, setOption];
}
