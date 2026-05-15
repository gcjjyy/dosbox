import { useCallback, useEffect, useRef, useState } from "react";
import type { Route } from "./+types/_index";
import { getSession } from "../lib/auth.server";
import { DosFrame, type CommandInterface, type DosEmulator } from "../components/DosFrame";
import { Toolbar } from "../components/Toolbar";
import { LoginModal } from "../components/LoginModal";
import { VirtualKeyboard } from "../components/VirtualKeyboard";
import { resolutionById } from "../components/ResolutionPicker";
import { useResolution } from "../lib/use-resolution";
import { useVirtualKeyboard } from "../lib/use-virtual-keyboard";
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
  const emulatorRef = useRef<DosEmulator | null>(null);
  const [showLogin, setShowLogin] = useState(false);
  const [saving, setSaving] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const [mounted, setMounted] = useState(false);
  useEffect(() => { setMounted(true); }, []);
  const [resolutionId, setResolutionId] = useResolution();
  const resolution = resolutionById(resolutionId);
  const [vkbVisible, toggleVkb] = useVirtualKeyboard();

  const onReady = useCallback((ci: CommandInterface) => {
    ciRef.current = ci;
  }, []);

  const onEmulator = useCallback((emu: DosEmulator | null) => {
    emulatorRef.current = emu;
  }, []);

  const onVkbKeyDown = useCallback((code: number) => {
    emulatorRef.current?.sendKeyDown(code);
  }, []);

  const onVkbKeyUp = useCallback((code: number) => {
    emulatorRef.current?.sendKeyUp(code);
  }, []);

  const checkAndSave = useCallback(async () => {
    const ci = ciRef.current;
    if (!ci) return;
    setSaving(true);
    setStatus(null);
    try {
      const persisted = await ci.persist(true);
      const bytes = persisted instanceof Uint8Array ? persisted : null;
      if (!bytes || bytes.length === 0) {
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
    <div className="grid h-dvh grid-rows-[auto_1fr] text-gray-100">
      <Toolbar
        isAdmin={loaderData.isAdmin}
        saving={saving}
        resolutionId={resolutionId}
        onResolutionChange={setResolutionId}
        vkbVisible={vkbVisible}
        onVkbToggle={toggleVkb}
        onLoginClick={() => setShowLogin(true)}
        onLogout={logout}
        onSave={checkAndSave}
      />
      <main className="relative">
        {mounted && (
          <DosFrame
            bundleUrl="/dos.jsdos"
            onReady={onReady}
            onEmulator={onEmulator}
            width={resolution.width}
            height={resolution.height}
          />
        )}
        {status && (
          <div className="pointer-events-none absolute bottom-3 left-1/2 -translate-x-1/2 rounded bg-black/80 px-3 py-1 text-xs">
            {status}
          </div>
        )}
      </main>
      {vkbVisible && (
        <VirtualKeyboard onKeyDown={onVkbKeyDown} onKeyUp={onVkbKeyUp} />
      )}
      {showLogin && (
        <LoginModal
          onClose={() => setShowLogin(false)}
          onSuccess={() => window.location.reload()}
        />
      )}
    </div>
  );
}
