import { useCallback, useEffect, useState } from "react";
import {
  DEFAULT_OPTIONS,
  LEGACY_RESOLUTION_KEY,
  OPTIONS_STORAGE_KEY,
  parseOptions,
  serializeOptions,
  type Options,
} from "./options";

// SSR-safe: starts at defaults, then hydrates from localStorage after mount.
// The third return value flips true only after that hydration attempt finishes,
// so callers can avoid mounting size-sensitive browser-only surfaces too early.
export function useOptions(): [Options, <K extends keyof Options>(key: K, value: Options[K]) => void, boolean] {
  const [options, setOptions] = useState<Options>(DEFAULT_OPTIONS);
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => {
    try {
      const raw = localStorage.getItem(OPTIONS_STORAGE_KEY);
      const legacy = raw === null ? localStorage.getItem(LEGACY_RESOLUTION_KEY) : null;
      setOptions(parseOptions(raw, legacy));
    } catch {
      /* ignore — keep defaults */
    } finally {
      setHydrated(true);
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

  return [options, setOption, hydrated];
}
