import { useCallback, useEffect, useRef, useState } from "react";
import type { Route } from "./+types/_index";
import { getSession } from "../lib/auth.server";
import { DosFrame, type CommandInterface } from "../components/DosFrame";
import { Toolbar } from "../components/Toolbar";
import { LoginModal } from "../components/LoginModal";
import { saveToServer } from "../lib/save";

export function meta(_: Route.MetaArgs) {
  return [{ title: "dosbox.gcjjyy.dev" }];
}

export async function loader({ request }: Route.LoaderArgs) {
  const session = await getSession(request);
  return { isAdmin: Boolean(session.get("isAdmin")) };
}

export default function Index({ loaderData }: Route.ComponentProps) {
  const ciRef = useRef<CommandInterface | null>(null);
  const [showLogin, setShowLogin] = useState(false);
  const [saving, setSaving] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  // Mount DosFrame only after client hydration completes. This sidesteps any
  // server-rendered <div> conflicting with js-dos's DOM mutations on mount.
  const [mounted, setMounted] = useState(false);
  useEffect(() => { setMounted(true); }, []);

  const onReady = useCallback((ci: CommandInterface) => {
    ciRef.current = ci;
  }, []);

  const checkAndSave = useCallback(async () => {
    const ci = ciRef.current;
    if (!ci) return;
    setSaving(true);
    setStatus(null);
    try {
      // js-dos v7: ci.persist() returns a zip of the changed FS as Uint8Array.
      // Empty FS (no changes) → empty Uint8Array or tiny empty-zip; the server
      // accepts both as a no-op.
      const bytes = await ci.persist();
      if (bytes.length === 0) {
        setStatus("변경 없음");
        return;
      }
      const result = await saveToServer(bytes);
      if (result.applied.length === 0 && result.failed.length === 0) {
        setStatus("변경 없음");
        return;
      }
      const failedNote = result.failed.length > 0 ? ` (${result.failed.length}개 실패)` : "";
      setStatus(`${result.applied.length}개 저장됨${failedNote}`);
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
        saving={saving}
        onLoginClick={() => setShowLogin(true)}
        onLogout={logout}
        onSave={checkAndSave}
      />
      <main className="relative">
        {mounted && <DosFrame bundleUrl="/dos.jsdos" onReady={onReady} />}
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
