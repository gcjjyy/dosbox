import { useCallback, useEffect, useRef, useState } from "react";
import type { Route } from "./+types/_index";
import { getSession } from "../lib/auth.server";
import { bundleVersionFromEtag, getBundleEtag } from "../lib/bundle";
import { DosFrame, type CommandInterface, type DosEmulator } from "../components/DosFrame";
import { Toolbar } from "../components/Toolbar";
import { LoginModal } from "../components/LoginModal";
import { VirtualKeyboard } from "../components/VirtualKeyboard";
import { resolutionById } from "../components/ResolutionPicker";
import { OptionsDialog } from "../components/OptionsDialog";
import { useVirtualKeyboard } from "../lib/use-virtual-keyboard";
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
  return {
    isAdmin: Boolean(session.get("isAdmin")),
    bundleUrl: `/dos.jsdos?v=${encodeURIComponent(bundleVersion)}`,
  };
}

export default function Index({ loaderData }: Route.ComponentProps) {
  const ciRef = useRef<CommandInterface | null>(null);
  const emulatorRef = useRef<DosEmulator | null>(null);
  const [showLogin, setShowLogin] = useState(false);
  const [showOptions, setShowOptions] = useState(false);
  const [saving, setSaving] = useState(false);
  const [savingUserState, setSavingUserState] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const [mounted, setMounted] = useState(false);
  useEffect(() => { setMounted(true); }, []);
  const [options, setOption] = useOptions();
  const optionsRef = useRef(options);
  optionsRef.current = options;
  const cyclesAppliedRef = useRef(false);
  const resolution = resolutionById(options.resolutionId);
  const [vkbVisible, toggleVkb] = useVirtualKeyboard();
  const [hasUserStateValue, refreshHasUserState] = useUserState();

  const onReady = useCallback((ci: CommandInterface) => {
    ciRef.current = ci;
    // Restore the saved cycles value by replaying cycleup/down from the baked
    // default (the shared bundle can't be re-baked per user). Runs once.
    //
    // Two ordering invariants make optionsRef + emulatorRef reliable here:
    //  · options are hydrated from localStorage in useOptions' mount useEffect,
    //    which runs together with the `mounted` effect that gates DosFrame —
    //    so DosFrame (and thus this onReady) cannot mount before hydration.
    //  · emulatorRef is set by onEmulator, called synchronously at DosEmulator
    //    construction; onReady fires only after the async download+extract boot
    //    chain, so emulatorRef.current is already non-null.
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
    <div className="grid h-dvh grid-rows-[auto_1fr] text-gray-100">
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
      <main className="relative">
        {mounted && (
          <DosFrame
            bundleUrl={loaderData.bundleUrl}
            onReady={onReady}
            onEmulator={onEmulator}
            width={resolution.width}
            height={resolution.height}
            vAlign={options.canvasVAlign}
          />
        )}
        {status && (
          <div className="pointer-events-none absolute bottom-3 left-1/2 -translate-x-1/2 rounded bg-black/80 px-3 py-1 text-xs">
            {status}
          </div>
        )}
      </main>
      {/* Always mount; hidden state uses opacity 0.01 (NOT 0) + inert.
          Load-bearing for Chrome on M-series Macs driving an external
          monitor: macOS otherwise promotes the DOS canvas to a direct-
          scanout overlay plane at certain canvas-to-window size ratios,
          and the resulting display-mode renegotiation flickers the
          physical monitor. A composited VKB layer above the canvas
          disqualifies the canvas from overlay promotion.
          0.01 (not 0) is critical: Chrome skips painting opacity-0
          subtrees entirely, so the compositor layer effectively
          disappears — equivalent to not mounting at all. 1% alpha on a
          dark element over a dark background is below visual threshold
          but keeps Chrome painting the layer. `inert` blocks pointer
          and focus events so stray taps can't reach DOS through the
          invisible keys. (`preserveDrawingBuffer: true` in dos-emulator
          addresses WebGL backbuffer clearing — separate WebGL-spec
          hygiene, not the root cause here.) */}
      <div
        inert={!vkbVisible}
        style={{
          opacity: vkbVisible ? 1 : 0.01,
          pointerEvents: vkbVisible ? "auto" : "none",
        }}
      >
        <VirtualKeyboard
          onKeyDown={onVkbKeyDown}
          onKeyUp={onVkbKeyUp}
          onHide={() => { if (vkbVisible) toggleVkb(); }}
          bgOpacity={options.keyboardOpacity}
        />
      </div>
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
