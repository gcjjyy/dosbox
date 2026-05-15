# 사용자별 상태저장 (localStorage) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** DOS 게임/프로그램의 진행 상태를 사용자 본인 브라우저에 localStorage로 저장/자동 복원하는 기능. 기존 관리자 저장(`POST /api/save`)과는 완전히 독립된 채널.

**Architecture:** `ci.persist(true)`가 반환하는 변경 파일 zip(Uint8Array)을 base64로 인코딩해 localStorage(`dosbox-user-state`)에 저장. 부팅 시 DosFrame이 localStorage를 읽어 emulators `dosboxXDirect`에 두 번째 init entry로 전달 → 서버 번들 위에 사용자 저장이 overlay됨. 삭제는 confirm + reload.

**Tech Stack:** React Router v7 · TypeScript · `window.emulators.dosboxXDirect(init: Uint8Array[])` · `CommandInterface.persist(true)` · localStorage · base64 (`btoa`/`atob`, chunked)

**Spec:** `docs/superpowers/specs/2026-05-15-user-state-save-design.md`

**Testing note:** 자동 테스트 프레임워크 없음. 검증은 `npm run typecheck`, `npm run build`, 수동 브라우저 smoke test. 배포는 `pm2 restart dosbox` (NOT systemd).

---

## File structure

```
app/
  lib/
    user-state.ts          ─ CREATE: localStorage read/write/clear + base64 helpers (pure)
    use-user-state.ts      ─ CREATE: React hook for reactive hasSave (for toolbar conditional UI)
    dos-emulator.ts        ─ MODIFY: DosEmulatorOpts에 overlay?: Uint8Array | null 추가
  components/
    DosFrame.tsx           ─ MODIFY: boot 시 readUserState() 호출, DosEmulator에 overlay 전달
    Toolbar.tsx            ─ MODIFY: 내 저장 + 🗑 버튼 추가, 기존 "저장" → "관리자 저장"
  routes/
    _index.tsx             ─ MODIFY: useUserState, onUserSave, onUserDelete 와이어링
```

---

## Task 1: user-state.ts (pure functions)

**Files:**
- Create: `app/lib/user-state.ts`

- [ ] **Step 1: Create the file**

Create `/home/gcjjyy/dosbox/app/lib/user-state.ts` with the following exact contents:

```ts
// app/lib/user-state.ts
//
// localStorage-backed per-user DOS state save. The save itself is the
// Uint8Array returned by emulators' CommandInterface.persist(true) —
// a ZIP of files changed since the initial bundle. Stored as base64
// in localStorage so non-UTF-8 bytes don't get mangled.

const STORAGE_KEY = "dosbox-user-state";

function bytesToBase64(bytes: Uint8Array): string {
  let bin = "";
  const CHUNK = 0x8000; // 32K — avoids "Maximum call stack" on apply with huge args
  for (let i = 0; i < bytes.length; i += CHUNK) {
    bin += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  }
  return btoa(bin);
}

function base64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

export function readUserState(): Uint8Array | null {
  try {
    const b64 = localStorage.getItem(STORAGE_KEY);
    if (!b64) return null;
    return base64ToBytes(b64);
  } catch {
    return null;
  }
}

/** Caller must catch QuotaExceededError to show a user-facing error. */
export function writeUserState(bytes: Uint8Array): void {
  const b64 = bytesToBase64(bytes);
  localStorage.setItem(STORAGE_KEY, b64);
}

export function clearUserState(): void {
  try { localStorage.removeItem(STORAGE_KEY); } catch { /* ignore */ }
}

export function hasUserState(): boolean {
  try { return localStorage.getItem(STORAGE_KEY) !== null; } catch { return false; }
}
```

- [ ] **Step 2: Verify typecheck**

Run: `npm run typecheck`
Expected: exit 0, no errors.

- [ ] **Step 3: Commit**

```bash
git add app/lib/user-state.ts
git commit -m "feat(dos): add user-state localStorage helpers (base64 read/write/clear)"
```

---

## Task 2: use-user-state.ts (React hook)

**Files:**
- Create: `app/lib/use-user-state.ts`

- [ ] **Step 1: Create the hook**

Create `/home/gcjjyy/dosbox/app/lib/use-user-state.ts` with exactly:

```ts
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
```

- [ ] **Step 2: Verify typecheck**

Run: `npm run typecheck`
Expected: exit 0.

- [ ] **Step 3: Commit**

```bash
git add app/lib/use-user-state.ts
git commit -m "feat(dos): add useUserState hook for reactive save presence"
```

---

## Task 3: DosEmulator overlay support

**Files:**
- Modify: `app/lib/dos-emulator.ts`

- [ ] **Step 1: Add `overlay` to `DosEmulatorOpts`**

In `/home/gcjjyy/dosbox/app/lib/dos-emulator.ts`, find:

```ts
export interface DosEmulatorOpts {
  canvas: HTMLCanvasElement;
  bundle: Uint8Array;
  onReady?: (ci: CommandInterface) => void;
  onFirstFrame?: () => void;
  onError?: (err: unknown) => void;
}
```

Replace with:

```ts
export interface DosEmulatorOpts {
  canvas: HTMLCanvasElement;
  bundle: Uint8Array;
  /** Optional per-user save overlay. emulators layers later entries over earlier
   *  ones, so files in this zip overwrite the matching paths from `bundle`. */
  overlay?: Uint8Array | null;
  onReady?: (ci: CommandInterface) => void;
  onFirstFrame?: () => void;
  onError?: (err: unknown) => void;
}
```

- [ ] **Step 2: Pass overlay to `dosboxXDirect`**

In the same file, find this line inside `boot()`:

```ts
    const ci = await emu.dosboxXDirect([this.opts.bundle]);
```

Replace with:

```ts
    const initFs = this.opts.overlay
      ? [this.opts.bundle, this.opts.overlay]
      : [this.opts.bundle];
    const ci = await emu.dosboxXDirect(initFs);
```

- [ ] **Step 3: Verify typecheck + build**

Run: `npm run typecheck && npm run build 2>&1 | tail -8`
Expected: typecheck exit 0, build succeeds.

- [ ] **Step 4: Commit**

```bash
git add app/lib/dos-emulator.ts
git commit -m "feat(dos): support optional overlay bundle in DosEmulator"
```

---

## Task 4: DosFrame reads user state at boot

**Files:**
- Modify: `app/components/DosFrame.tsx`

- [ ] **Step 1: Import `readUserState`**

In `/home/gcjjyy/dosbox/app/components/DosFrame.tsx`, find the import block at the top:

```tsx
import { useEffect, useRef, useState } from "react";
import { DosEmulator, type CommandInterface } from "../lib/dos-emulator";
import { BootScreen } from "./BootScreen";
```

Add the user-state import below them:

```tsx
import { useEffect, useRef, useState } from "react";
import { DosEmulator, type CommandInterface } from "../lib/dos-emulator";
import { BootScreen } from "./BootScreen";
import { readUserState } from "../lib/user-state";
```

- [ ] **Step 2: Read overlay and pass to DosEmulator**

In the same file, find the `new DosEmulator({...})` call inside `boot()`:

```tsx
      emulator = new DosEmulator({
        canvas: ref.current,
        bundle,
        onReady,
        onFirstFrame: () => {
          // Minimum boot-screen display time. On warm visits the first frame
          // can arrive in ~200 ms; this keeps the splash readable.
          const MIN_MS = 1500;
          const elapsed = Date.now() - mountedAt.current;
          const wait = Math.max(0, MIN_MS - elapsed);
          setTimeout(() => {
            if (cancelled) return;
            setBootVisible(false);
          }, wait);
        },
        onError,
      });
```

Replace with:

```tsx
      // Read the per-user save (if any) once at boot. The toolbar's reactive
      // useUserState() hook covers UI; the engine just needs the bytes here.
      const overlay = readUserState();
      emulator = new DosEmulator({
        canvas: ref.current,
        bundle,
        overlay,
        onReady,
        onFirstFrame: () => {
          // Minimum boot-screen display time. On warm visits the first frame
          // can arrive in ~200 ms; this keeps the splash readable.
          const MIN_MS = 1500;
          const elapsed = Date.now() - mountedAt.current;
          const wait = Math.max(0, MIN_MS - elapsed);
          setTimeout(() => {
            if (cancelled) return;
            setBootVisible(false);
          }, wait);
        },
        onError,
      });
```

- [ ] **Step 3: Verify typecheck + build**

Run: `npm run typecheck && npm run build 2>&1 | tail -5`
Expected: typecheck exit 0, build succeeds.

- [ ] **Step 4: Commit**

```bash
git add app/components/DosFrame.tsx
git commit -m "feat(dos): apply per-user state overlay at DosFrame boot"
```

---

## Task 5: Toolbar buttons + _index.tsx wiring (joint commit)

**Files:**
- Modify: `app/components/Toolbar.tsx` (rewrite)
- Modify: `app/routes/_index.tsx` (rewrite)

This task adds two props sets at once; Toolbar's new props can only be satisfied once `_index.tsx` is updated, so we commit both together. Do not commit between Step 1 and Step 2.

- [ ] **Step 1: Rewrite `app/components/Toolbar.tsx`**

Replace the entire contents of `/home/gcjjyy/dosbox/app/components/Toolbar.tsx` with:

```tsx
import { ResolutionPicker, type ResolutionId } from "./ResolutionPicker";

export interface ToolbarProps {
  isAdmin: boolean;
  saving: boolean;
  resolutionId: ResolutionId;
  onResolutionChange: (id: ResolutionId) => void;
  vkbVisible: boolean;
  onVkbToggle: () => void;
  // Per-user state save
  savingUserState: boolean;
  hasUserState: boolean;
  onUserSave: () => void;
  onUserDelete: () => void;
  // Admin actions
  onLoginClick: () => void;
  onLogout: () => void;
  onSave: () => void;
}

export function Toolbar({
  isAdmin,
  saving,
  resolutionId,
  onResolutionChange,
  vkbVisible,
  onVkbToggle,
  savingUserState,
  hasUserState,
  onUserSave,
  onUserDelete,
  onLoginClick,
  onLogout,
  onSave,
}: ToolbarProps) {
  return (
    <header className="toolbar">
      <h1 className="toolbar__brand">dosbox.gcjjyy.dev</h1>
      <div className="toolbar__right">
        <button
          type="button"
          onClick={onVkbToggle}
          className={`toolbar__icon ${vkbVisible ? "toolbar__icon--active" : ""}`}
          title="가상 키보드"
          aria-pressed={vkbVisible}
          aria-label="가상 키보드 토글"
        >
          ⌨
        </button>
        <ResolutionPicker value={resolutionId} onChange={onResolutionChange} />
        <span className="toolbar__sep" aria-hidden="true" />
        {hasUserState && (
          <button
            type="button"
            onClick={onUserDelete}
            className="toolbar__icon"
            title="저장 삭제"
            aria-label="저장 상태 삭제"
          >
            🗑
          </button>
        )}
        <button
          type="button"
          onClick={onUserSave}
          disabled={savingUserState}
          className="toolbar__ghost"
        >
          {savingUserState ? "저장 중…" : "내 저장"}
        </button>
        <span className="toolbar__sep" aria-hidden="true" />
        {isAdmin ? (
          <>
            <button
              type="button"
              onClick={onSave}
              disabled={saving}
              className="toolbar__save"
            >
              {saving ? "저장 중…" : "관리자 저장"}
            </button>
            <button type="button" onClick={onLogout} className="toolbar__ghost">
              로그아웃
            </button>
          </>
        ) : (
          <button type="button" onClick={onLoginClick} className="toolbar__ghost">
            관리자
          </button>
        )}
      </div>
    </header>
  );
}
```

- [ ] **Step 2: Rewrite `app/routes/_index.tsx`**

Replace the entire contents of `/home/gcjjyy/dosbox/app/routes/_index.tsx` with:

```tsx
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

  const gridRows = vkbVisible ? "grid-rows-[auto_1fr_auto]" : "grid-rows-[auto_1fr]";

  return (
    <div className={`grid h-dvh ${gridRows} text-gray-100`}>
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
```

Note: the grid uses `auto_1fr_auto` when vkb visible (legacy from prior plan) — but the virtual keyboard is `position:fixed` overlay, so the third row is effectively unused. Leaving as-is to match existing wiring; an idle `auto` row is harmless. (If you observe layout problems, switch both branches to `auto_1fr`.)

- [ ] **Step 3: Verify typecheck**

Run: `npm run typecheck`
Expected: exit 0.

- [ ] **Step 4: Verify build**

Run: `npm run build 2>&1 | tail -10`
Expected: build succeeds.

- [ ] **Step 5: Commit Tasks 5 (both files together)**

```bash
git add app/components/Toolbar.tsx app/routes/_index.tsx
git commit -m "feat(dos): per-user save UI (내 저장 / 🗑) + admin save rename"
```

---

## Task 6: Deploy + smoke test

**Files:** none (verification + deploy only)

- [ ] **Step 1: Restart pm2**

Run: `pm2 restart dosbox && sleep 1 && curl -sI http://localhost:5301/ | head -3`
Expected: `HTTP/1.1 200 OK`.

- [ ] **Step 2: Verify served HTML (non-admin path)**

Run: `curl -s http://localhost:5301/ | grep -oE '내 저장|h-dvh' | sort -u`
Expected output:
```
h-dvh
내 저장
```
(`내 저장` always renders. `관리자 저장` only renders after login, so it won't appear in an unauthenticated SSR fetch — that's verified manually in Step 4.)

- [ ] **Step 3: Desktop browser smoke test**

Open `http://localhost:5301/` in Chrome. Verify in the toolbar:
- `⌨ ▢ 해상도▾  | 내 저장  | 관리자` — the 🗑 button does **not** appear (no save yet).
- Boot screen → canvas loads as usual.
- Click into the DOS canvas, run some commands or play a game state that writes to disk.
- Click `내 저장`. Toast appears: either `저장됨 (NN KB)` or `변경 없음`.
- After successful save, `🗑` button appears between resolution picker and `내 저장`.
- Reload the page (Ctrl+R). Boot screen → DOS canvas. Verify the saved state is back (e.g., files created during the previous session are present).
- Click `🗑`. Browser confirm dialog. Click OK. Page reloads. State is gone (fresh server bundle only). `🗑` no longer appears.

If any step fails, do NOT mark complete. Investigate via DevTools network/console.

- [ ] **Step 4: Admin path verification**

Click `관리자`. Login modal opens. Log in. After reload, the toolbar's admin region now shows `관리자 저장` (accent button) and `로그아웃`. The `내 저장` button (per-user) remains visible too. They are independent.

- [ ] **Step 5: pm2 status sanity**

Run: `pm2 list 2>&1 | grep dosbox`
Expected: status `online`, uptime fresh, no crash-loop spike in restart count.

- [ ] **Step 6: No commit needed** — Tasks 1-5 already committed. End-of-feature.

---

## Out of scope (do not implement)

- Multi-slot save (single slot only per spec).
- Auto-save / periodic snapshot (manual save only).
- Server-side bundle ETag invalidation of user save (user manages via 🗑).
- Custom confirm modal (use native `confirm()` per spec).
- Cloud sync / cross-device save.
- Compression (zip is already compressed).
- Showing UI feedback for auto-load at boot (silent per spec; 🗑 visibility serves as the signal).
