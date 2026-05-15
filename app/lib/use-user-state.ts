// app/lib/use-user-state.ts
//
// Reactive boolean for whether a per-user save exists. Used by the
// toolbar to conditionally show the delete button. Save bytes themselves
// are read at boot time directly via readUserState() — this hook only
// tracks presence for UI rendering.

import { useCallback, useEffect, useState } from "react";
import { hasUserState } from "./user-state";

export function useUserState(): [boolean, () => void] {
  // SSR-safe: false initially, useEffect adjusts after hydration.
  const [hasSave, setHasSave] = useState(false);

  useEffect(() => { setHasSave(hasUserState()); }, []);

  const refresh = useCallback(() => { setHasSave(hasUserState()); }, []);

  return [hasSave, refresh];
}
