import { useCallback, useEffect, useState } from "react";
import { DEFAULT_RESOLUTION, RESOLUTIONS, type ResolutionId } from "../components/ResolutionPicker";

const STORAGE_KEY = "dosbox-resolution";

function isValidId(v: unknown): v is ResolutionId {
  return typeof v === "string" && RESOLUTIONS.some((r) => r.id === v);
}

export function useResolution(): [ResolutionId, (id: ResolutionId) => void] {
  const [value, setValue] = useState<ResolutionId>(DEFAULT_RESOLUTION);

  useEffect(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      if (isValidId(saved)) setValue(saved);
    } catch { /* ignore */ }
  }, []);

  const set = useCallback((id: ResolutionId) => {
    setValue(id);
    try { localStorage.setItem(STORAGE_KEY, id); } catch { /* ignore */ }
  }, []);

  return [value, set];
}
