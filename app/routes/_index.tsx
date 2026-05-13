import { useCallback, useRef, useState } from "react";
import type { Route } from "./+types/_index";
import { getSession } from "../lib/auth.server";
import { DosFrame } from "../components/DosFrame";
import { Toolbar } from "../components/Toolbar";
import { LoginModal } from "../components/LoginModal";
import {
  snapshotFsTree,
  computeDiff,
  type JsDosCi,
  type Baseline,
} from "../lib/fs-diff";
import { saveToServer } from "../lib/save";

export function meta(_: Route.MetaArgs) {
  return [{ title: "dosbox.gcjjyy.dev" }];
}

export async function loader({ request }: Route.LoaderArgs) {
  const session = await getSession(request);
  return { isAdmin: Boolean(session.get("isAdmin")) };
}

export default function Index({ loaderData }: Route.ComponentProps) {
  const ciRef = useRef<JsDosCi | null>(null);
  const baselineRef = useRef<Baseline | null>(null);
  const [showLogin, setShowLogin] = useState(false);
  const [hasChanges, setHasChanges] = useState(false);
  const [saving, setSaving] = useState(false);
  const [status, setStatus] = useState<string | null>(null);

  const onReady = useCallback(async (ci: JsDosCi) => {
    ciRef.current = ci;
    baselineRef.current = await snapshotFsTree(ci);
  }, []);

  // Cheap "has changes?" probe — recompute on every save attempt;
  // we don't poll continuously to keep this simple.
  const checkAndSave = useCallback(async () => {
    const ci = ciRef.current;
    const baseline = baselineRef.current;
    if (!ci || !baseline) return;
    setSaving(true);
    setStatus(null);
    try {
      const diff = await computeDiff(ci, baseline);
      if (diff.writes.length === 0 && diff.deletes.length === 0) {
        setStatus("변경 없음");
        setHasChanges(false);
        return;
      }
      const result = await saveToServer(diff);
      // update baseline with applied paths only
      const newBaseline = new Map(baseline);
      for (const w of diff.writes) {
        if (result.applied.includes(w.path)) newBaseline.set(w.path, { size: w.bytes.length });
      }
      for (const d of diff.deletes) {
        if (result.applied.includes(d)) newBaseline.delete(d);
      }
      baselineRef.current = newBaseline;
      setHasChanges(result.failed.length > 0);
      const failedNote = result.failed.length > 0 ? ` (${result.failed.length}개 실패)` : "";
      const readErrNote = diff.readErrors.length > 0 ? ` (${diff.readErrors.length}개 읽기 실패)` : "";
      setStatus(`${result.applied.length}개 저장됨${failedNote}${readErrNote}`);
    } catch (err) {
      setStatus(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  }, []);

  const logout = useCallback(async () => {
    await fetch("/api/logout", { method: "POST", credentials: "same-origin" });
    window.location.reload();
  }, []);

  return (
    <div className="grid h-screen grid-rows-[auto_1fr] bg-black text-gray-100">
      <Toolbar
        isAdmin={loaderData.isAdmin}
        hasChanges={true}
        saving={saving}
        onLoginClick={() => setShowLogin(true)}
        onLogout={logout}
        onSave={checkAndSave}
      />
      <main className="relative">
        <DosFrame bundleUrl="/dos.jsdos" onReady={onReady} />
        {status && (
          <div className="pointer-events-none absolute bottom-3 left-1/2 -translate-x-1/2 rounded bg-black/80 px-3 py-1 text-xs">
            {status}
          </div>
        )}
      </main>
      {showLogin && (
        <LoginModal
          onClose={() => setShowLogin(false)}
          onSuccess={() => window.location.reload()}
        />
      )}
    </div>
  );
}
