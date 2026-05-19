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
import { useUserState } from "../lib/use-user-state";
import { clearUserState, writeUserState } from "../lib/user-state";
import { saveToServer } from "../lib/save";

export function meta(_: Route.MetaArgs) {
  return [{ title: "DosBox" }];
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
  const [savingUserState, setSavingUserState] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const [mounted, setMounted] = useState(false);
  useEffect(() => { setMounted(true); }, []);
  const [resolutionId, setResolutionId] = useResolution();
  const resolution = resolutionById(resolutionId);
  const [vkbVisible, toggleVkb] = useVirtualKeyboard();
  const [hasUserStateValue, refreshHasUserState] = useUserState();

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

  const onUserSave = useCallback(async () => {
    const ci = ciRef.current;
    if (!ci) return;
    setSavingUserState(true);
    setStatus(null);
    try {
      const persisted = await ci.persist(true);
      const bytes = persisted instanceof Uint8Array ? persisted : null;
      if (!bytes || bytes.length === 0) {
        setStatus("변경 없음");
        return;
      }
      if (bytes.length > 3_500_000) {
        setStatus(`저장 실패: 용량 초과 (${(bytes.length / 1024 / 1024).toFixed(1)}MB)`);
        return;
      }
      try {
        writeUserState(bytes);
      } catch (err) {
        setStatus(err instanceof Error ? `저장 실패: ${err.message}` : "저장 실패");
        return;
      }
      refreshHasUserState();
      setStatus(`저장됨 (${(bytes.length / 1024).toFixed(0)}KB)`);
    } catch (err) {
      setStatus(err instanceof Error ? err.message : String(err));
    } finally {
      setSavingUserState(false);
    }
  }, [refreshHasUserState]);

  const onUserDelete = useCallback(() => {
    if (!window.confirm("저장된 상태를 삭제하고 처음부터 시작합니다. 진행할까요?")) return;
    clearUserState();
    window.location.reload();
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
        savingUserState={savingUserState}
        hasUserState={hasUserStateValue}
        onUserSave={onUserSave}
        onUserDelete={onUserDelete}
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
      {/* Always mount; toggle visibility via opacity + inert. Keeping the
          VKB compositor layer alive (even invisible) is load-bearing for
          Chrome on M-series Macs driving an external monitor: without it,
          macOS promotes the DOS canvas to a direct-scanout overlay plane,
          and the resulting display-mode renegotiation flickers the
          physical monitor. The VKB layer's mere presence disqualifies the
          canvas from overlay promotion. (`preserveDrawingBuffer: true` in
          dos-emulator alone wasn't enough — that addresses WebGL backbuffer
          clearing, not OS-level scanout promotion.) `inert` blocks pointer
          and focus events to the hidden subtree so stray taps can't reach
          DOS through invisible keys. */}
      <div
        inert={!vkbVisible}
        style={{ opacity: vkbVisible ? 1 : 0 }}
      >
        <VirtualKeyboard onKeyDown={onVkbKeyDown} onKeyUp={onVkbKeyUp} />
      </div>
      {showLogin && (
        <LoginModal
          onClose={() => setShowLogin(false)}
          onSuccess={() => window.location.reload()}
        />
      )}
    </div>
  );
}
