# Options Dialog & Input Fixes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a persistent options dialog (cycles/resolution/canvas-alignment/keyboard-opacity) and fix two touch/keyboard input bugs on tablets.

**Architecture:** A pure `options.ts` module (types + validation + parse/serialize, node-testable) backs a SSR-safe `useOptions` localStorage hook. The toolbar's resolution + cycle controls move into a new `OptionsDialog` modal. Canvas vertical alignment and keyboard transparency are CSS-variable/modifier driven, plumbed from options. Two-finger right-click is added to the pointer handler in `dos-emulator.ts`. The Android Bluetooth-keyboard letter bug is diagnosed with on-screen instrumentation first, then fixed from observed data.

**Tech Stack:** React Router v7, TypeScript strict, Tailwind v4 + `app/app.css`, vitest (node env, pure-logic tests only — no jsdom).

---

## File Structure

| File | Responsibility | Action |
|---|---|---|
| `app/lib/cpu-cycles.ts` | Cycle constants + clamp + boot-replay step math | Modify |
| `app/lib/cpu-cycles.test.ts` | Cycle pure-logic tests | Modify |
| `app/lib/options.ts` | Options type, defaults, validation, parse/serialize (pure) | Create |
| `app/lib/options.test.ts` | Options pure-logic tests | Create |
| `app/lib/use-options.ts` | SSR-safe localStorage hook wrapping `options.ts` | Create |
| `app/lib/use-resolution.ts` | Old single-key resolution hook | Delete |
| `app/components/OptionsDialog.tsx` | Settings modal (resolution/cycles/valign/opacity) | Create |
| `app/components/Toolbar.tsx` | Add gear button; remove resolution + cycle controls | Modify |
| `app/components/DosFrame.tsx` | Accept `vAlign`, apply to `.dos-stage` | Modify |
| `app/components/VirtualKeyboard.tsx` | Accept `bgOpacity`, set `--vkb-bg-opacity` | Modify |
| `app/lib/dos-emulator.ts` | Two-finger right-click; Android keydown fix | Modify |
| `app/routes/_index.tsx` | Wire `useOptions`, cycles delta replay, dialog state | Modify |
| `app/app.css` | `.dos-stage` valign modifiers; keyboard bg-opacity calc | Modify |

---

## Task 1: Cycles default 8000 + boot-replay helper

**Files:**
- Modify: `app/lib/cpu-cycles.ts`
- Modify: `app/lib/cpu-cycles.test.ts`

- [ ] **Step 1: Update the failing test**

Replace the whole body of `app/lib/cpu-cycles.test.ts` with:

```ts
import { describe, it, expect } from "vitest";
import {
  DEFAULT_CYCLES,
  CYCLES_STEP,
  CYCLES_MIN,
  CYCLES_MAX,
  clampCycles,
  cyclesReplay,
} from "./cpu-cycles";

describe("cpu-cycles", () => {
  it("exposes 8000 default and absolute step", () => {
    expect(DEFAULT_CYCLES).toBe(8000);
    expect(CYCLES_STEP).toBe(2000);
    expect(CYCLES_MIN).toBe(100);
    expect(CYCLES_MAX).toBe(100000);
  });

  it("clamps within [MIN, MAX]", () => {
    expect(clampCycles(50)).toBe(CYCLES_MIN);
    expect(clampCycles(999999)).toBe(CYCLES_MAX);
    expect(clampCycles(8000)).toBe(8000);
  });

  it("rounds and falls back to default on NaN", () => {
    expect(clampCycles(8000.7)).toBe(8001);
    expect(clampCycles(Number.NaN)).toBe(DEFAULT_CYCLES);
  });

  it("computes boot replay direction + step count vs the default", () => {
    expect(cyclesReplay(8000)).toEqual({ dir: "up", count: 0 });
    expect(cyclesReplay(12000)).toEqual({ dir: "up", count: 2 });
    expect(cyclesReplay(4000)).toEqual({ dir: "down", count: 2 });
    // clamped target (100) is 7900 below default → 3.95 steps → rounds to 4
    expect(cyclesReplay(0)).toEqual({ dir: "down", count: 4 });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run app/lib/cpu-cycles.test.ts`
Expected: FAIL — `DEFAULT_CYCLES` is 23880 and `cyclesReplay` is not exported.

- [ ] **Step 3: Implement**

In `app/lib/cpu-cycles.ts` change the default constant:

```ts
export const DEFAULT_CYCLES = 8000;
```

Update the comment block above the constants to drop the 486DX2-66 rationale and replace with:

```ts
// Default 8000 cycles (~386-class) — baked into dosbox.conf (`cycles=fixed 8000`)
// and used as the client display default. Step is an ABSOLUTE value (>=100, not
// a percentage) so dosbox and the client compute "1 click = +/-2000" identically.
```

Then append at the end of the file:

```ts
// Boot-time replay: the shared server bundle can't be re-baked per user, so a
// saved cycles value is restored by replaying cycleup/cycledown events from the
// baked default. The stepper only moves in CYCLES_STEP increments, so the saved
// target is always DEFAULT_CYCLES + k*CYCLES_STEP and the replay lands exactly.
export function cyclesReplay(saved: number): { dir: "up" | "down"; count: number } {
  const delta = clampCycles(saved) - DEFAULT_CYCLES;
  const count = Math.round(Math.abs(delta) / CYCLES_STEP);
  return { dir: delta >= 0 ? "up" : "down", count };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run app/lib/cpu-cycles.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add app/lib/cpu-cycles.ts app/lib/cpu-cycles.test.ts
git commit -m "feat(cycles): default 8000 + boot-replay step helper"
```

---

## Task 2: Pure options module

**Files:**
- Create: `app/lib/options.ts`
- Create: `app/lib/options.test.ts`

- [ ] **Step 1: Write the failing test**

Create `app/lib/options.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import {
  DEFAULT_OPTIONS,
  parseOptions,
  serializeOptions,
} from "./options";

describe("options", () => {
  it("returns defaults for null/garbage input", () => {
    expect(parseOptions(null)).toEqual(DEFAULT_OPTIONS);
    expect(parseOptions("not json")).toEqual(DEFAULT_OPTIONS);
    expect(parseOptions("123")).toEqual(DEFAULT_OPTIONS);
  });

  it("defaults: cycles 8000, valign middle, opacity 1, resolution 640x480", () => {
    expect(DEFAULT_OPTIONS).toEqual({
      cycles: 8000,
      resolutionId: "640x480",
      canvasVAlign: "middle",
      keyboardOpacity: 1,
    });
  });

  it("reads and validates each field", () => {
    const raw = JSON.stringify({
      cycles: 12000,
      resolutionId: "800x600",
      canvasVAlign: "top",
      keyboardOpacity: 0.5,
    });
    expect(parseOptions(raw)).toEqual({
      cycles: 12000,
      resolutionId: "800x600",
      canvasVAlign: "top",
      keyboardOpacity: 0.5,
    });
  });

  it("clamps/falls back invalid field values", () => {
    const raw = JSON.stringify({
      cycles: 9_999_999,
      resolutionId: "bogus",
      canvasVAlign: "sideways",
      keyboardOpacity: 5,
    });
    expect(parseOptions(raw)).toEqual({
      cycles: 100000,
      resolutionId: "640x480",
      canvasVAlign: "middle",
      keyboardOpacity: 1,
    });
  });

  it("migrates legacy resolution key only when no blob exists", () => {
    expect(parseOptions(null, "1024x768").resolutionId).toBe("1024x768");
    // legacy ignored once a blob is present
    const raw = JSON.stringify({ resolutionId: "800x600" });
    expect(parseOptions(raw, "1024x768").resolutionId).toBe("800x600");
    // invalid legacy → default
    expect(parseOptions(null, "nope").resolutionId).toBe("640x480");
  });

  it("round-trips through serialize/parse", () => {
    const o = { cycles: 6000, resolutionId: "fullscreen" as const, canvasVAlign: "bottom" as const, keyboardOpacity: 0 };
    expect(parseOptions(serializeOptions(o))).toEqual(o);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run app/lib/options.test.ts`
Expected: FAIL — `./options` does not exist.

- [ ] **Step 3: Implement `app/lib/options.ts`**

```ts
// app/lib/options.ts
//
// Pure (DOM-free) options model: type, defaults, validation, and JSON
// parse/serialize. The React hook (use-options.ts) wraps this with
// localStorage. Kept pure so it's unit-testable in the node test env.

import { RESOLUTIONS, DEFAULT_RESOLUTION, type ResolutionId } from "../components/ResolutionPicker";
import { DEFAULT_CYCLES, clampCycles } from "./cpu-cycles";

export type CanvasVAlign = "top" | "middle" | "bottom";

export interface Options {
  cycles: number;
  resolutionId: ResolutionId;
  canvasVAlign: CanvasVAlign;
  keyboardOpacity: number; // 0..1
}

export const DEFAULT_OPTIONS: Options = {
  cycles: DEFAULT_CYCLES,
  resolutionId: DEFAULT_RESOLUTION,
  canvasVAlign: "middle",
  keyboardOpacity: 1,
};

export const OPTIONS_STORAGE_KEY = "dosbox-options";
export const LEGACY_RESOLUTION_KEY = "dosbox-resolution";

function isResolutionId(v: unknown): v is ResolutionId {
  return typeof v === "string" && RESOLUTIONS.some((r) => r.id === v);
}
function isVAlign(v: unknown): v is CanvasVAlign {
  return v === "top" || v === "middle" || v === "bottom";
}
function clamp01(n: unknown): number {
  if (typeof n !== "number" || Number.isNaN(n)) return DEFAULT_OPTIONS.keyboardOpacity;
  return Math.max(0, Math.min(1, n));
}

// `raw` is the stored blob string (or null). `legacyResolution` is the value of
// the old `dosbox-resolution` key, applied ONLY when no blob exists yet.
export function parseOptions(raw: string | null, legacyResolution?: string | null): Options {
  let obj: Record<string, unknown> = {};
  if (raw) {
    try {
      const p = JSON.parse(raw);
      if (p && typeof p === "object" && !Array.isArray(p)) obj = p as Record<string, unknown>;
    } catch {
      /* ignore — fall through to defaults */
    }
  }

  const resolutionId: ResolutionId = isResolutionId(obj.resolutionId)
    ? obj.resolutionId
    : raw === null && isResolutionId(legacyResolution)
      ? legacyResolution
      : DEFAULT_OPTIONS.resolutionId;

  return {
    cycles: typeof obj.cycles === "number" ? clampCycles(obj.cycles) : DEFAULT_OPTIONS.cycles,
    resolutionId,
    canvasVAlign: isVAlign(obj.canvasVAlign) ? obj.canvasVAlign : DEFAULT_OPTIONS.canvasVAlign,
    keyboardOpacity: obj.keyboardOpacity === undefined ? DEFAULT_OPTIONS.keyboardOpacity : clamp01(obj.keyboardOpacity),
  };
}

export function serializeOptions(o: Options): string {
  return JSON.stringify(o);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run app/lib/options.test.ts`
Expected: PASS (6 tests).

- [ ] **Step 5: Commit**

```bash
git add app/lib/options.ts app/lib/options.test.ts
git commit -m "feat(options): pure options model with validation + migration"
```

---

## Task 3: useOptions hook + delete use-resolution

**Files:**
- Create: `app/lib/use-options.ts`
- Delete: `app/lib/use-resolution.ts`

No unit test (hook needs DOM/localStorage; test env is node-only). Verified by typecheck + manual.

- [ ] **Step 1: Create `app/lib/use-options.ts`**

```ts
import { useCallback, useEffect, useState } from "react";
import {
  DEFAULT_OPTIONS,
  LEGACY_RESOLUTION_KEY,
  OPTIONS_STORAGE_KEY,
  parseOptions,
  serializeOptions,
  type Options,
} from "./options";

// SSR-safe: starts at defaults, then hydrates from localStorage after mount
// (mirrors the old use-resolution.ts pattern). setOption updates one field,
// persists the whole blob, and re-renders.
export function useOptions(): [Options, <K extends keyof Options>(key: K, value: Options[K]) => void] {
  const [options, setOptions] = useState<Options>(DEFAULT_OPTIONS);

  useEffect(() => {
    try {
      const raw = localStorage.getItem(OPTIONS_STORAGE_KEY);
      const legacy = raw === null ? localStorage.getItem(LEGACY_RESOLUTION_KEY) : null;
      setOptions(parseOptions(raw, legacy));
    } catch {
      /* ignore — keep defaults */
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

  return [options, setOption];
}
```

- [ ] **Step 2: Delete the old hook**

```bash
git rm app/lib/use-resolution.ts
```

(Its only importer, `_index.tsx`, is rewired in Task 7. Typecheck will fail until then — that's expected.)

- [ ] **Step 3: Commit**

```bash
git add app/lib/use-options.ts
git commit -m "feat(options): useOptions localStorage hook; drop use-resolution"
```

---

## Task 4: Two-finger right-click (touch)

**Files:**
- Modify: `app/lib/dos-emulator.ts`

No unit test (pointer/touch is hardware-bound). Verified manually on the Android tablet. Logic: first finger presses left + can drag; a second simultaneous finger cancels the left press and arms a right-click that fires once when fingers lift.

- [ ] **Step 1: Add gesture state fields**

In `app/lib/dos-emulator.ts`, inside the `DosEmulator` class, add these private fields next to `private pendingBuf` (around line 173):

```ts
  // Touch gesture state for two-finger right-click. Mouse/pen pointers bypass
  // all of this and use the button-index path in handlePointer.
  private activeTouches = new Map<number, { x: number; y: number }>();
  private firstTouchId = -1;
  private leftTouchDown = false;
  private twoFingerArmed = false;
  private rightClickPos = { x: 0.5, y: 0.5 };
```

- [ ] **Step 2: Split mouse vs touch in handlePointer**

Replace the entire `handlePointer` method (currently lines ~501-522) with:

```ts
  private handlePointer(e: PointerEvent, kind: "down" | "move" | "up"): void {
    if (kind === "down") this.resumeAudioIfNeeded();
    if (!this.ci) return;
    const rect = this.canvas.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) return;
    const rx = (e.clientX - rect.left) / rect.width;
    const ry = (e.clientY - rect.top) / rect.height;
    const cx = Math.max(0, Math.min(1, rx));
    const cy = Math.max(0, Math.min(1, ry));

    if (e.pointerType === "touch") {
      this.handleTouch(e, kind, cx, cy);
      return;
    }

    // Mouse / pen — unchanged button-index behavior.
    this.ci.sendMouseMotion(cx, cy);
    if (kind === "move") {
      this.ci.sendMouseSync();
      return;
    }
    // PointerEvent.button → DOSBox button index:
    //   browser 0 (left) → 0, browser 2 (right) → 1, browser 1 (middle) → 2
    const button = e.button === 2 ? 1 : e.button === 1 ? 2 : 0;
    this.ci.sendMouseButton(button, kind === "down");
    this.ci.sendMouseSync();
  }

  // Touch gesture model:
  //  · 1 finger  → move pointer + hold LEFT (so taps click and drags work).
  //  · 2 fingers → cancel the held LEFT and arm a RIGHT click; the right click
  //    (down+up at the first finger's position) fires once when a finger lifts.
  //  · 3+ fingers→ ignored (no extra buttons).
  private handleTouch(e: PointerEvent, kind: "down" | "move" | "up", cx: number, cy: number): void {
    const ci = this.ci;
    if (!ci) return;

    if (kind === "down") {
      this.activeTouches.set(e.pointerId, { x: cx, y: cy });
      const count = this.activeTouches.size;
      if (count === 1) {
        this.firstTouchId = e.pointerId;
        this.rightClickPos = { x: cx, y: cy };
        ci.sendMouseMotion(cx, cy);
        ci.sendMouseButton(0, true);
        ci.sendMouseSync();
        this.leftTouchDown = true;
      } else if (count === 2) {
        // Second finger → this is a right-click gesture. Undo the left press.
        if (this.leftTouchDown) {
          ci.sendMouseButton(0, false);
          ci.sendMouseSync();
          this.leftTouchDown = false;
        }
        this.twoFingerArmed = true;
        // Anchor the right click at the first finger's last known position.
        const first = this.activeTouches.get(this.firstTouchId);
        if (first) this.rightClickPos = first;
      }
      return;
    }

    if (kind === "move") {
      if (this.activeTouches.has(e.pointerId)) {
        this.activeTouches.set(e.pointerId, { x: cx, y: cy });
      }
      // Single-finger drag only (don't move the cursor mid two-finger gesture).
      if (!this.twoFingerArmed && this.leftTouchDown && e.pointerId === this.firstTouchId) {
        ci.sendMouseMotion(cx, cy);
        ci.sendMouseSync();
      }
      return;
    }

    // kind === "up" (also reused for pointercancel via onPointerUp wiring below)
    this.activeTouches.delete(e.pointerId);

    if (this.twoFingerArmed) {
      // Fire one right click, then disarm. Remaining finger lifts are swallowed.
      this.twoFingerArmed = false;
      const p = this.rightClickPos;
      ci.sendMouseMotion(p.x, p.y);
      ci.sendMouseButton(1, true);
      ci.sendMouseSync();
      ci.sendMouseButton(1, false);
      ci.sendMouseSync();
    } else if (this.leftTouchDown && this.activeTouches.size === 0) {
      ci.sendMouseButton(0, false);
      ci.sendMouseSync();
      this.leftTouchDown = false;
    }

    if (this.activeTouches.size === 0) {
      this.firstTouchId = -1;
      this.twoFingerArmed = false;
      this.leftTouchDown = false;
    }
  }
```

- [ ] **Step 3: Route pointercancel into the up path**

In `boot()` the listeners are wired around line 311. Add a `pointercancel` listener bound to the same up handler. Change the constructor's handler bindings (lines ~213-215) — locate:

```ts
    this.onPointerUp = (e) => this.handlePointer(e, "up");
```

Leave it as-is, and in `boot()` add after the `pointerup` listener (line ~313):

```ts
    this.canvas.addEventListener("pointercancel", this.onPointerUp);
```

And in `destroy()` (after the `pointerup` removeEventListener, line ~552) add:

```ts
    this.canvas.removeEventListener("pointercancel", this.onPointerUp);
```

- [ ] **Step 4: Typecheck**

Run: `npm run typecheck`
Expected: PASS (no type errors in dos-emulator.ts).

- [ ] **Step 5: Commit**

```bash
git add app/lib/dos-emulator.ts
git commit -m "feat(input): two-finger tap = right-click on touch devices"
```

---

## Task 5: OptionsDialog component

**Files:**
- Create: `app/components/OptionsDialog.tsx`

No unit test (presentational; verified manually + typecheck). Uses the `ResolutionPicker` (moved here) and a +/- cycle stepper (moved from Toolbar). Imports the cycle icons from Toolbar.

- [ ] **Step 1: Export the cycle icons from Toolbar**

In `app/components/Toolbar.tsx`, change the `IconMinus` and `IconPlus` declarations (lines ~166 and ~174) from `function IconMinus()` / `function IconPlus()` to exported:

```ts
export function IconMinus() {
```
```ts
export function IconPlus() {
```

(Leave their bodies unchanged.)

- [ ] **Step 2: Create `app/components/OptionsDialog.tsx`**

```tsx
import { ResolutionPicker, type ResolutionId } from "./ResolutionPicker";
import { IconMinus, IconPlus } from "./Toolbar";
import { CYCLES_MIN, CYCLES_MAX } from "../lib/cpu-cycles";
import type { CanvasVAlign } from "../lib/options";

export interface OptionsDialogProps {
  onClose: () => void;
  resolutionId: ResolutionId;
  onResolutionChange: (id: ResolutionId) => void;
  cycles: number;
  onCyclesUp: () => void;
  onCyclesDown: () => void;
  canvasVAlign: CanvasVAlign;
  onCanvasVAlignChange: (v: CanvasVAlign) => void;
  keyboardOpacity: number;
  onKeyboardOpacityChange: (v: number) => void;
}

const VALIGN_OPTS: { id: CanvasVAlign; label: string }[] = [
  { id: "top", label: "위" },
  { id: "middle", label: "중간" },
  { id: "bottom", label: "아래" },
];

export function OptionsDialog({
  onClose,
  resolutionId,
  onResolutionChange,
  cycles,
  onCyclesUp,
  onCyclesDown,
  canvasVAlign,
  onCanvasVAlignChange,
  keyboardOpacity,
  onKeyboardOpacityChange,
}: OptionsDialogProps) {
  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/60" onClick={onClose}>
      <div
        onClick={(e) => e.stopPropagation()}
        className="w-96 max-w-[calc(100vw-24px)] rounded-lg bg-gray-900 p-6 text-gray-100 shadow-xl"
        role="dialog"
        aria-label="설정"
      >
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-lg font-semibold">설정</h2>
          <button type="button" onClick={onClose} className="rounded px-2 py-1 text-sm hover:bg-gray-800" aria-label="닫기">✕</button>
        </div>

        {/* Resolution */}
        <div className="mb-5 flex items-center justify-between gap-4">
          <span className="text-sm text-gray-300">해상도</span>
          <ResolutionPicker value={resolutionId} onChange={onResolutionChange} />
        </div>

        {/* CPU cycles */}
        <div className="mb-5 flex items-center justify-between gap-4">
          <span className="text-sm text-gray-300">CPU 속도</span>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={onCyclesDown}
              disabled={cycles <= CYCLES_MIN}
              className="grid h-7 w-7 place-items-center rounded border border-gray-700 hover:bg-gray-800 disabled:opacity-40"
              aria-label="CPU 속도 낮추기"
            >
              <IconMinus />
            </button>
            <span className="min-w-[64px] text-center text-sm tabular-nums" aria-live="polite">
              {cycles.toLocaleString()}
            </span>
            <button
              type="button"
              onClick={onCyclesUp}
              disabled={cycles >= CYCLES_MAX}
              className="grid h-7 w-7 place-items-center rounded border border-gray-700 hover:bg-gray-800 disabled:opacity-40"
              aria-label="CPU 속도 높이기"
            >
              <IconPlus />
            </button>
          </div>
        </div>

        {/* Canvas vertical alignment */}
        <div className="mb-5 flex items-center justify-between gap-4">
          <span className="text-sm text-gray-300">화면 세로 위치</span>
          <div className="flex overflow-hidden rounded border border-gray-700" role="group" aria-label="화면 세로 위치">
            {VALIGN_OPTS.map((o) => (
              <button
                key={o.id}
                type="button"
                onClick={() => onCanvasVAlignChange(o.id)}
                aria-pressed={canvasVAlign === o.id}
                className={
                  "px-3 py-1 text-sm " +
                  (canvasVAlign === o.id ? "bg-emerald-600 text-white" : "hover:bg-gray-800")
                }
              >
                {o.label}
              </button>
            ))}
          </div>
        </div>

        {/* Keyboard opacity */}
        <div className="flex items-center justify-between gap-4">
          <span className="text-sm text-gray-300">키보드 투명도</span>
          <div className="flex items-center gap-2">
            <input
              type="range"
              min={0}
              max={1}
              step={0.05}
              value={keyboardOpacity}
              onChange={(e) => onKeyboardOpacityChange(Number(e.target.value))}
              aria-label="키보드 투명도"
              className="w-40"
            />
            <span className="min-w-[36px] text-right text-sm tabular-nums">
              {Math.round(keyboardOpacity * 100)}%
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 3: Typecheck**

Run: `npm run typecheck`
Expected: still FAILS in `_index.tsx`/`Toolbar.tsx` (rewired in Task 7) but NO errors in `OptionsDialog.tsx` itself.

- [ ] **Step 4: Commit**

```bash
git add app/components/OptionsDialog.tsx app/components/Toolbar.tsx
git commit -m "feat(options): OptionsDialog modal + export cycle icons"
```

---

## Task 6: Toolbar — gear button, drop resolution + cycles

**Files:**
- Modify: `app/components/Toolbar.tsx`

- [ ] **Step 1: Update props and JSX**

In `app/components/Toolbar.tsx`:

(a) Replace the `ToolbarProps` interface (lines 4-24) with:

```ts
export interface ToolbarProps {
  isAdmin: boolean;
  saving: boolean;
  vkbVisible: boolean;
  onVkbToggle: () => void;
  onOptionsClick: () => void;
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
```

(b) Replace the destructured params (lines 26-43) with:

```ts
export function Toolbar({
  isAdmin,
  saving,
  vkbVisible,
  onVkbToggle,
  onOptionsClick,
  savingUserState,
  hasUserState,
  onUserSave,
  onUserDelete,
  onLoginClick,
  onLogout,
  onSave,
}: ToolbarProps) {
```

(c) Remove the `ResolutionPicker` line (61) and the entire `<div className="toolbar__cycles">…</div>` block (lines 62-84). In their place, after the keyboard toggle button (the `</button>` at line 60), add a gear button:

```tsx
        <button
          type="button"
          onClick={onOptionsClick}
          className="toolbar__icon"
          title="설정"
          aria-label="설정 열기"
        >
          <IconSettings />
        </button>
```

(d) Remove the now-unused imports at the top (lines 1-2):

```ts
import { ResolutionPicker, type ResolutionId } from "./ResolutionPicker";
import { CYCLES_MIN, CYCLES_MAX } from "../lib/cpu-cycles";
```

(Both are gone — `ResolutionPicker` and the cycles constants now live in `OptionsDialog`.)

- [ ] **Step 2: Add the gear icon**

Add this icon function next to the other icons (e.g. after `IconKeyboard`, around line 191):

```tsx
function IconSettings() {
  return (
    <svg {...svgProps}>
      <circle cx="8" cy="8" r="2.1" />
      <path d="M8 1.7v1.6M8 12.7v1.6M14.3 8h-1.6M3.3 8H1.7M12.5 3.5l-1.1 1.1M4.6 11.4l-1.1 1.1M12.5 12.5l-1.1-1.1M4.6 4.6L3.5 3.5" />
    </svg>
  );
}
```

- [ ] **Step 3: Commit**

```bash
git add app/components/Toolbar.tsx
git commit -m "feat(toolbar): gear button; move resolution + cycles to dialog"
```

---

## Task 7: Wire useOptions + dialog into the index route

**Files:**
- Modify: `app/routes/_index.tsx`

- [ ] **Step 1: Update imports**

Replace lines 8-14 of `app/routes/_index.tsx`:

```ts
import { resolutionById } from "../components/ResolutionPicker";
import { useResolution } from "../lib/use-resolution";
import { useVirtualKeyboard } from "../lib/use-virtual-keyboard";
import { useUserState } from "../lib/use-user-state";
import { clearUserState, writeUserState } from "../lib/user-state";
import { saveToServer } from "../lib/save";
import { DEFAULT_CYCLES, CYCLES_STEP, CYCLES_MIN, CYCLES_MAX, clampCycles } from "../lib/cpu-cycles";
```

with:

```ts
import { resolutionById } from "../components/ResolutionPicker";
import { OptionsDialog } from "../components/OptionsDialog";
import { useVirtualKeyboard } from "../lib/use-virtual-keyboard";
import { useUserState } from "../lib/use-user-state";
import { clearUserState, writeUserState } from "../lib/user-state";
import { saveToServer } from "../lib/save";
import { useOptions } from "../lib/use-options";
import { CYCLES_STEP, CYCLES_MAX, CYCLES_MIN, clampCycles, cyclesReplay } from "../lib/cpu-cycles";
```

- [ ] **Step 2: Replace state + add refs**

Replace lines 26-38 (the `ciRef … useUserState()` block) with:

```ts
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
```

- [ ] **Step 3: Replace onReady + cycle handlers**

Replace the `onReady` callback (lines 40-42) with one that replays the saved cycles once:

```ts
  const onReady = useCallback((ci: CommandInterface) => {
    ciRef.current = ci;
    // Restore the saved cycles value by replaying cycleup/down from the baked
    // default (the shared bundle can't be re-baked per user). Runs once.
    if (!cyclesAppliedRef.current) {
      cyclesAppliedRef.current = true;
      const { dir, count } = cyclesReplay(optionsRef.current.cycles);
      for (let i = 0; i < count; i++) {
        if (dir === "up") emulatorRef.current?.cyclesUp();
        else emulatorRef.current?.cyclesDown();
      }
    }
  }, []);
```

Replace the `onCyclesUp` / `onCyclesDown` callbacks (lines 56-66) with versions that persist via `setOption` and read the latest value from the ref:

```ts
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
```

- [ ] **Step 4: Update the Toolbar usage**

Replace the `<Toolbar … />` block (lines 138-155) with:

```tsx
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
```

- [ ] **Step 5: Pass vAlign to DosFrame and bgOpacity to VirtualKeyboard**

Change the `<DosFrame … />` (lines 158-164) to add `vAlign`:

```tsx
          <DosFrame
            bundleUrl="/dos.jsdos"
            onReady={onReady}
            onEmulator={onEmulator}
            width={resolution.width}
            height={resolution.height}
            vAlign={options.canvasVAlign}
          />
```

Change the `<VirtualKeyboard … />` (lines 192-196) to pass `bgOpacity`:

```tsx
        <VirtualKeyboard
          onKeyDown={onVkbKeyDown}
          onKeyUp={onVkbKeyUp}
          onHide={() => { if (vkbVisible) toggleVkb(); }}
          bgOpacity={options.keyboardOpacity}
        />
```

- [ ] **Step 6: Render the OptionsDialog**

After the `{showLogin && (…)}` block (lines 198-203), add:

```tsx
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
```

- [ ] **Step 7: Typecheck**

Run: `npm run typecheck`
Expected: FAILS only on `DosFrame` `vAlign` prop and `VirtualKeyboard` `bgOpacity` prop (added in Tasks 8-9). Confirm there are no OTHER errors (no leftover `useResolution`, `DEFAULT_CYCLES`, `resolutionId` state references).

- [ ] **Step 8: Commit**

```bash
git add app/routes/_index.tsx
git commit -m "feat(options): wire useOptions + OptionsDialog + cycles replay"
```

---

## Task 8: Canvas vertical alignment

**Files:**
- Modify: `app/components/DosFrame.tsx`
- Modify: `app/app.css`

- [ ] **Step 1: Accept the prop in DosFrame**

In `app/components/DosFrame.tsx`:

(a) Add to `DosFrameProps` (after `height?` at line 19):

```ts
  /** Vertical alignment of the canvas within the stage. Default "middle". */
  vAlign?: "top" | "middle" | "bottom";
```

(b) Add `vAlign = "middle"` to the destructured params (line 65):

```ts
export function DosFrame({ bundleUrl, onReady, onError, onEmulator, width, height, vAlign = "middle" }: DosFrameProps) {
```

(c) Change the stage `<div>` (line 173) to apply the modifier class:

```tsx
    <div className={`dos-stage dos-stage--valign-${vAlign}`}>
```

- [ ] **Step 2: CSS — replace place-items with explicit alignment + modifiers**

In `app/app.css`, the `.dos-stage` rule (lines 251-261) currently has `place-items: center;`. Replace that single line with:

```css
  justify-items: center;
  align-items: center;
```

Then add immediately after the `.dos-stage { … }` block (after line 261):

```css
.dos-stage--valign-top { align-items: start; }
.dos-stage--valign-middle { align-items: center; }
.dos-stage--valign-bottom { align-items: end; }
```

- [ ] **Step 3: Typecheck**

Run: `npm run typecheck`
Expected: FAILS now only on `VirtualKeyboard` `bgOpacity` (added in Task 9). No `vAlign` errors.

- [ ] **Step 4: Commit**

```bash
git add app/components/DosFrame.tsx app/app.css
git commit -m "feat(options): canvas vertical-position (top/middle/bottom)"
```

---

## Task 9: Keyboard transparency

**Files:**
- Modify: `app/components/VirtualKeyboard.tsx`
- Modify: `app/app.css`

Resting/panel/hover backgrounds scale with `--vkb-bg-opacity`; borders + legends are untouched. Momentary pressed/latched feedback colors are left at full strength so taps stay visible at low opacity (the user accepted feedback visibility either way).

- [ ] **Step 1: Accept bgOpacity in VirtualKeyboard**

In `app/components/VirtualKeyboard.tsx`:

(a) Add to `VirtualKeyboardProps` (after `onHide?` at line 64):

```ts
  /** 0..1 — scales the keyboard panel/key background alpha via the
   *  --vkb-bg-opacity CSS var. Borders and legends stay fully opaque.
   *  Default 1 (no change). */
  bgOpacity?: number;
```

(b) Add `bgOpacity = 1` to the destructured params (line 338):

```ts
export function VirtualKeyboard({ onKeyDown, onKeyUp, onHide, bgOpacity = 1 }: VirtualKeyboardProps) {
```

(c) Both return statements render `<div className="vkb" …>`. Add the CSS var to each. The mobile branch (line 583) and desktop branch (line 596) — change both opening tags to:

```tsx
    <div className="vkb" role="group" aria-label="DOS 가상 키보드" style={{ "--vkb-bg-opacity": bgOpacity } as React.CSSProperties}>
```

(`React.CSSProperties` doesn't type custom properties, so the `as` cast is required. `React` is already in scope via the JSX runtime; if `npm run typecheck` flags it, add `import type React from "react"` at the top of the file.)

- [ ] **Step 2: CSS — multiply background alphas by the var**

In `app/app.css`:

(a) `.vkb` background (line 414):

```css
  background: rgba(10, 15, 31, calc(0.72 * var(--vkb-bg-opacity, 1)));
```

(b) `.vkb-key` background (line 458):

```css
  background: rgba(255, 255, 255, calc(0.03 * var(--vkb-bg-opacity, 1)));
```

(c) `.vkb-key:hover` background (line 528):

```css
    background: rgba(255, 255, 255, calc(0.07 * var(--vkb-bg-opacity, 1)));
```

(Leave `.vkb-key--pressed`/`:active` and `.vkb-key--latched` unchanged — momentary feedback.)

- [ ] **Step 3: Typecheck**

Run: `npm run typecheck`
Expected: PASS (all prior cross-file errors now resolved).

- [ ] **Step 4: Run the full test suite**

Run: `npm run test`
Expected: PASS (cpu-cycles, options, bundle).

- [ ] **Step 5: Commit**

```bash
git add app/components/VirtualKeyboard.tsx app/app.css
git commit -m "feat(options): keyboard transparency (bg-only, legends/outlines stay)"
```

---

## Task 10: Issue 5 — Android Bluetooth keyboard diagnosis (instrumentation)

**Files:**
- Modify: `app/lib/dos-emulator.ts`

This is a DIAGNOSTIC step, not the fix. Letters fail while digits/arrows/symbols work → strong signal of IME composition swallowing letter keydowns (`e.code === ""` and/or `e.keyCode === 229`). We must confirm on the real device before writing the fix. Per the cross-device debug convention: stacked scrolling log + a visible version marker each iteration.

- [ ] **Step 1: Add a temporary on-screen keydown logger**

In `app/lib/dos-emulator.ts`, at the very top of `handleKey` (line ~491, before `this.resumeAudioIfNeeded()`), add:

```ts
    if (pressed) this.debugLogKey(e);
```

Then add this method to the class (e.g. just below `handleKey`):

```ts
  // TEMPORARY (issue #5 diagnosis): stacked on-screen log of raw keydown
  // fields, so we can see exactly what an Android Bluetooth keyboard sends for
  // letter keys vs digits/arrows. Remove once the fix is verified.
  private debugLogKey(e: KeyboardEvent): void {
    let box = document.getElementById("kbd-debug");
    if (!box) {
      box = document.createElement("div");
      box.id = "kbd-debug";
      box.style.cssText =
        "position:fixed;left:4px;bottom:4px;z-index:9999;max-height:40vh;overflow:auto;" +
        "font:11px/1.3 monospace;color:#9f9;background:rgba(0,0,0,.8);padding:4px 6px;" +
        "border:1px solid #393;border-radius:4px;pointer-events:none;white-space:pre;";
      box.textContent = "[kbd-debug v1]\n";
      document.body.appendChild(box);
    }
    const line =
      `code=${JSON.stringify(e.code)} key=${JSON.stringify(e.key)} ` +
      `kc=${e.keyCode} comp=${e.isComposing}`;
    box.textContent += line + "\n";
    box.scrollTop = box.scrollHeight;
  }
```

- [ ] **Step 2: Typecheck + build sanity**

Run: `npm run typecheck`
Expected: PASS.

- [ ] **Step 3: Commit and deploy for device testing**

```bash
git add app/lib/dos-emulator.ts
git commit -m "chore(debug): on-screen keydown logger for issue #5 diagnosis"
```

Deploy (per `reference_dosbox_deploy`): `sshpass + ssh pcnhost` → `git pull origin main && npm run build && pm2 restart dosbox`. **CHECKPOINT:** Test on the Android tablet with the Bluetooth keyboard. Press several letters, digits, arrows. Record what the `kbd-debug` box shows for letter keys (especially whether `code` is `""` and `kc` is `229`). Bring those observations back before Task 11.

---

## Task 11: Issue 5 — targeted fix (data-driven)

**Files:**
- Modify: `app/lib/dos-emulator.ts` (+ possibly `app/lib/dos-keymap.ts`)

> **Gate:** Do NOT start until Task 10's device observations are in hand. The
> fix below is the expected path for the IME-composition signature; adjust to
> the actual observed values.

- [ ] **Step 1: Add a `key`-based fallback to the keymap (if code is empty)**

If the device shows letter keydowns arriving with `e.code === ""` (or `"Unidentified"`) but `e.key` still holds the letter, add a fallback in `handleKey`. Locate (lines ~493-498):

```ts
    if (!this.ci) return;
    const code = keymap[e.code];
    if (code === undefined) return;
```

Replace with:

```ts
    if (!this.ci) return;
    let code = keymap[e.code];
    if (code === undefined) code = keyFromKeyValue(e.key);
    if (code === undefined) return;
```

- [ ] **Step 2: Add the `keyFromKeyValue` helper to dos-keymap.ts**

In `app/lib/dos-keymap.ts`, append:

```ts
// Fallback for IME/composition keydowns where KeyboardEvent.code is empty or
// "Unidentified" (observed on Android Chrome + Bluetooth keyboards: letters get
// swallowed by the IME while digits/arrows/symbols pass through with a valid
// code). Maps a single printable key value to its GLFW keycode using the same
// ASCII identity as the code table. Returns undefined for non-single-char keys.
export function keyFromKeyValue(key: string | undefined): number | undefined {
  if (!key || key.length !== 1) return undefined;
  const upper = key.toUpperCase();
  const cc = upper.charCodeAt(0);
  if (cc >= 65 && cc <= 90) return cc;        // A–Z → 65–90
  if (cc >= 48 && cc <= 57) return cc;        // 0–9 → 48–57
  return undefined;
}
```

Import it in `dos-emulator.ts` (line 8 currently imports `keymap`):

```ts
import { keymap, keyFromKeyValue } from "./dos-keymap";
```

> If the device instead showed `e.key` ALSO empty/"Process" during composition,
> the fallback above won't help — switch to the hidden-focused-input strategy:
> mount an off-screen `<input>` focused on canvas tap, read `beforeinput`/`input`
> events for the character, and map via `keyFromKeyValue`. Choose based on Task
> 10 data.

- [ ] **Step 3: Remove the debug logger from Task 10**

Delete the `if (pressed) this.debugLogKey(e);` line and the entire `debugLogKey` method added in Task 10.

- [ ] **Step 4: Typecheck**

Run: `npm run typecheck`
Expected: PASS.

- [ ] **Step 5: Commit + deploy + verify on device**

```bash
git add app/lib/dos-emulator.ts app/lib/dos-keymap.ts
git commit -m "fix(input): map IME-swallowed letter keydowns via key fallback (#5)"
```

Deploy and confirm on the Android tablet that QWERTY letters now register in DOS. **CHECKPOINT:** verify before considering issue #5 done.

---

## Final verification

- [ ] `npm run typecheck` — PASS
- [ ] `npm run test` — PASS (cpu-cycles, options, bundle)
- [ ] Manual (desktop browser): open gear → change resolution, cycles (+/-),
      canvas position, keyboard opacity (0 / 50% / 100%); reload → all persist.
- [ ] Manual (desktop): keyboard opacity 0 leaves outlines + legends visible,
      backgrounds gone.
- [ ] Manual (Android tablet): two-finger tap = right-click; QWERTY letters work
      via the Bluetooth keyboard.
- [ ] Confirm boot cycles default reads 8000 in the dialog on a fresh profile.
```
