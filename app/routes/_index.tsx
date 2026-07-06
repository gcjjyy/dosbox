import { useCallback, useRef, useState } from "react";
import { Volume2 } from "lucide-react";
import type { Route } from "./+types/_index";
import { getSession } from "../lib/auth.server";
import { bundleVersionFromEtag, getBundleEtag, getDosboxConfEtag } from "../lib/bundle";
import { DosFrame, type CommandInterface, type DosEmulator } from "../components/DosFrame";
import { Toolbar } from "../components/Toolbar";
import { LoginModal } from "../components/LoginModal";
import { VirtualKeyboard } from "../components/VirtualKeyboard";
import { resolutionById } from "../components/ResolutionPicker";
import { OptionsDialog } from "../components/OptionsDialog";
import { useVirtualKeyboard } from "../lib/use-virtual-keyboard";
import { useVisualViewportCssVars } from "../lib/use-visual-viewport";
import { useUserState } from "../lib/use-user-state";
import { clearUserState, writeUserState } from "../lib/user-state";
import { saveToServer } from "../lib/save";
import { useOptions } from "../lib/use-options";
import { CYCLES_STEP, CYCLES_MAX, CYCLES_MIN, clampCycles, cyclesReplay } from "../lib/cpu-cycles";

export function meta(_: Route.MetaArgs) {
  return [{ title: "DosBox" }];
}

export async function loader({ request }: Route.LoaderArgs) {
  const session = await getSession(request);
  const bundleVersion = bundleVersionFromEtag(await getBundleEtag());
  const configVersion = bundleVersionFromEtag(getDosboxConfEtag());
  return {
    isAdmin: Boolean(session.get("isAdmin")),
    bundleUrl: `/dos.zip?v=${encodeURIComponent(bundleVersion)}`,
    configUrl: `/dosbox.conf?v=${encodeURIComponent(configVersion)}`,
  };
}

function isDesktopChrome(): boolean {
  if (typeof navigator === "undefined") return false;
  const ua = navigator.userAgent;
  return (
    navigator.vendor === "Google Inc." &&
    /\bChrome\//.test(ua) &&
    !/\b(Edg|OPR|Opera|SamsungBrowser|CriOS)\//.test(ua)
  );
}

export default function Index({ loaderData }: Route.ComponentProps) {
  useVisualViewportCssVars();

  const ciRef = useRef<CommandInterface | null>(null);
  const emulatorRef = useRef<DosEmulator | null>(null);
  const [showLogin, setShowLogin] = useState(false);
  const [showOptions, setShowOptions] = useState(false);
  const [saving, setSaving] = useState(false);
  const [savingUserState, setSavingUserState] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const [audioPromptVisible, setAudioPromptVisible] = useState(false);
  const [audioUnlocking, setAudioUnlocking] = useState(false);
  const [options, setOption, optionsReady] = useOptions();
  const optionsRef = useRef(options);
  optionsRef.current = options;
  const cyclesAppliedRef = useRef(false);
  const audioPromptTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const resolution = resolutionById(options.resolutionId);
  const [vkbVisible, toggleVkb] = useVirtualKeyboard();
  const [hasUserStateValue, refreshHasUserState] = useUserState();

  const onReady = useCallback((ci: CommandInterface) => {
    ciRef.current = ci;
    if (audioPromptTimerRef.current) clearTimeout(audioPromptTimerRef.current);
    audioPromptTimerRef.current = setTimeout(() => {
      if (isDesktopChrome()) {
        setAudioPromptVisible(false);
        return;
      }
      setAudioPromptVisible(!emulatorRef.current?.isAudioRunning());
    }, 1200);
    // Restore the saved cycles value by replaying cycleup/down from the baked
    // default (the shared bundle can't be re-baked per user). Runs once.
    //
    // DosFrame mounts only after useOptions has attempted localStorage
    // hydration, so this sees the user's saved cycles/resolution defaults.
    if (!cyclesAppliedRef.current) {
      cyclesAppliedRef.current = true;
      const { dir, count } = cyclesReplay(optionsRef.current.cycles);
      for (let i = 0; i < count; i++) {
        if (dir === "up") emulatorRef.current?.cyclesUp();
        else emulatorRef.current?.cyclesDown();
      }
    }
  }, []);

  const onEmulator = useCallback((emu: DosEmulator | null) => {
    emulatorRef.current = emu;
    if (!emu) {
      if (audioPromptTimerRef.current) {
        clearTimeout(audioPromptTimerRef.current);
        audioPromptTimerRef.current = null;
      }
      setAudioPromptVisible(false);
    }
  }, []);

  const onAudioEnable = useCallback(async () => {
    const emu = emulatorRef.current;
    if (!emu) return;
    setAudioUnlocking(true);
    setStatus(null);
    try {
      const ok = await emu.unlockAudio();
      if (ok) setAudioPromptVisible(false);
      else setStatus("오디오 장치 준비 중");
    } catch (err) {
      setStatus(err instanceof Error ? err.message : String(err));
    } finally {
      setAudioUnlocking(false);
    }
  }, []);

  const onVkbKeyDown = useCallback((code: number) => {
    emulatorRef.current?.sendKeyDown(code);
  }, []);

  const onVkbKeyUp = useCallback((code: number) => {
    emulatorRef.current?.sendKeyUp(code);
  }, []);

  const onCyclesUp = useCallback(() => {
    const cur = optionsRef.current.cycles;
    if (cur >= CYCLES_MAX) return;
    emulatorRef.current?.cyclesUp();
    setOption("cycles", clampCycles(cur + CYCLES_STEP));
  }, [setOption]);

  const onCyclesDown = useCallback(() => {
    const cur = optionsRef.current.cycles;
    if (cur <= CYCLES_MIN) return;
    emulatorRef.current?.cyclesDown();
    setOption("cycles", clampCycles(cur - CYCLES_STEP));
  }, [setOption]);

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
    <div className={`app-shell${vkbVisible ? " app-shell--keyboard" : ""}`}>
      <Toolbar
        isAdmin={loaderData.isAdmin}
        saving={saving}
        vkbVisible={vkbVisible}
        onVkbToggle={toggleVkb}
        onOptionsClick={() => setShowOptions(true)}
        savingUserState={savingUserState}
        hasUserState={hasUserStateValue}
        onUserSave={onUserSave}
        onUserDelete={onUserDelete}
        onLoginClick={() => setShowLogin(true)}
        onLogout={logout}
        onSave={checkAndSave}
      />
      <main className="app-main">
        {optionsReady && (
          <DosFrame
            bundleUrl={loaderData.bundleUrl}
            configUrl={loaderData.configUrl}
            onReady={onReady}
            onEmulator={onEmulator}
            width={resolution.width}
            height={resolution.height}
            vAlign={options.canvasVAlign}
            canvasOverlay={audioPromptVisible && !isDesktopChrome() ? (
              <button
                type="button"
                className="audio-unlock__button"
                onClick={onAudioEnable}
                disabled={audioUnlocking}
              >
                <Volume2 size={18} strokeWidth={1.8} aria-hidden="true" />
                <span>{audioUnlocking ? "음소거 해제 중" : "탭하여 음소거 해제"}</span>
              </button>
            ) : null}
          />
        )}
        {status && (
          <div className="pointer-events-none absolute bottom-3 left-1/2 -translate-x-1/2 rounded bg-black/80 px-3 py-1 text-xs">
            {status}
          </div>
        )}
      </main>
      {vkbVisible && (
        <VirtualKeyboard
          onKeyDown={onVkbKeyDown}
          onKeyUp={onVkbKeyUp}
          onHide={() => { if (vkbVisible) toggleVkb(); }}
          bgOpacity={options.keyboardOpacity}
        />
      )}
      {showLogin && (
        <LoginModal
          onClose={() => setShowLogin(false)}
          onSuccess={() => window.location.reload()}
        />
      )}
      {showOptions && (
        <OptionsDialog
          onClose={() => setShowOptions(false)}
          resolutionId={options.resolutionId}
          onResolutionChange={(id) => setOption("resolutionId", id)}
          cycles={options.cycles}
          onCyclesUp={onCyclesUp}
          onCyclesDown={onCyclesDown}
          canvasVAlign={options.canvasVAlign}
          onCanvasVAlignChange={(v) => setOption("canvasVAlign", v)}
          keyboardOpacity={options.keyboardOpacity}
          onKeyboardOpacityChange={(v) => setOption("keyboardOpacity", v)}
        />
      )}
    </div>
  );
}
