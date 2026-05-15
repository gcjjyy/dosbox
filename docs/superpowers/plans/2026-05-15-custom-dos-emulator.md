# Custom DOS Emulator Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace js-dos v8 React UI (sidebar/splash/soft-keyboard) with a class-based engine on top of the lower-level `emulators` WASM bridge, plus a custom QWERTY virtual keyboard for tablet landscape.

**Architecture:** `DosEmulator` class encapsulates the WASM engine glue (canvas rendering, audio, keyboard, mouse). React `DosFrame.tsx` is a thin shell owning the lifecycle. `VirtualKeyboard.tsx` is a standalone React component that calls `DosEmulator.sendKeyDown/Up` via a callback. Static SDL2 scancode lookup in `dos-keymap.ts`. Touch-device detection + localStorage toggle via `use-virtual-keyboard.ts`.

**Tech Stack:** React Router v7 + react-router-serve under pm2 · TypeScript · Tailwind v4 + CSS modules · js-dos `emulators` package (bundled in `node_modules/js-dos/dist/emulators/`, served from `public/js-dos/emulators/`) · Web Audio API · pointer events.

**Spec:** `docs/superpowers/specs/2026-05-15-custom-dos-emulator-design.md`

**Testing note:** This project has no automated test framework. Each task verifies via `npm run typecheck` (compile validation), `npm run build` (full build), and manual browser smoke checks. Deploy is `pm2 restart dosbox` (NOT systemd — feedback-pm2-not-systemd).

---

## File structure

```
app/
  components/
    DosFrame.tsx          ─ MODIFY: rewrite to use DosEmulator + <canvas> ref
    VirtualKeyboard.tsx   ─ CREATE: QWERTY keyboard component
    Toolbar.tsx           ─ MODIFY: add ⌨ keyboard toggle button
    ResolutionPicker.tsx  ─ (unchanged)
    BootScreen.tsx        ─ (unchanged)
    LoginModal.tsx        ─ (unchanged)
  lib/
    dos-emulator.ts       ─ CREATE: DosEmulator class (engine glue)
    dos-keymap.ts         ─ CREATE: KeyboardEvent.code → SDL2 scancode table
    use-resolution.ts     ─ (unchanged)
    use-virtual-keyboard.ts ─ CREATE: touch-detect + localStorage toggle hook
    save.ts               ─ (unchanged)
    auth.server.ts        ─ (unchanged)
    bundle.ts             ─ (unchanged)
    dos-paths.ts          ─ (unchanged)
  routes/
    _index.tsx            ─ MODIFY: wire VirtualKeyboard + emulator ref + grid rows
    dos.jsdos.tsx         ─ (unchanged)
    api.*.tsx             ─ (unchanged)
  app.css                 ─ MODIFY: add .vkb styles, .toolbar__icon, canvas tweaks
  root.tsx                ─ MODIFY: swap js-dos.js → emulators.js, remove js-dos.css

package.json              ─ MODIFY: copy-jsdos script narrowed to emulators/
public/js-dos/            ─ ASSET CLEANUP: js-dos.{js,css,js.map} removed by new copy-jsdos
```

---

## Task 1: SDL2 scancode keymap

**Files:**
- Create: `app/lib/dos-keymap.ts`

- [ ] **Step 1: Create the keymap file**

```ts
// app/lib/dos-keymap.ts
//
// KeyboardEvent.code → USB HID usage code (SDL2 scancode) lookup.
// emulators(.dosboxXDirect → CommandInterface).sendKeyEvent and
// simulateKeyPress take these numeric codes. Source: USB HID Usage
// Tables 1.12, "Keyboard / Keypad Page" — values match SDL2 SDL_Scancode.

export const keymap: Readonly<Record<string, number>> = {
  // Letters
  KeyA: 4, KeyB: 5, KeyC: 6, KeyD: 7, KeyE: 8, KeyF: 9, KeyG: 10,
  KeyH: 11, KeyI: 12, KeyJ: 13, KeyK: 14, KeyL: 15, KeyM: 16, KeyN: 17,
  KeyO: 18, KeyP: 19, KeyQ: 20, KeyR: 21, KeyS: 22, KeyT: 23, KeyU: 24,
  KeyV: 25, KeyW: 26, KeyX: 27, KeyY: 28, KeyZ: 29,

  // Top-row digits
  Digit1: 30, Digit2: 31, Digit3: 32, Digit4: 33, Digit5: 34,
  Digit6: 35, Digit7: 36, Digit8: 37, Digit9: 38, Digit0: 39,

  // Control keys
  Enter: 40, Escape: 41, Backspace: 42, Tab: 43, Space: 44,

  // Punctuation
  Minus: 45, Equal: 46,
  BracketLeft: 47, BracketRight: 48, Backslash: 49,
  Semicolon: 51, Quote: 52, Backquote: 53,
  Comma: 54, Period: 55, Slash: 56, CapsLock: 57,

  // Function keys
  F1: 58, F2: 59, F3: 60, F4: 61, F5: 62, F6: 63, F7: 64,
  F8: 65, F9: 66, F10: 67, F11: 68, F12: 69,

  // Navigation
  PrintScreen: 70, ScrollLock: 71, Pause: 72,
  Insert: 73, Home: 74, PageUp: 75, Delete: 76, End: 77, PageDown: 78,
  ArrowRight: 79, ArrowLeft: 80, ArrowDown: 81, ArrowUp: 82,

  // Numpad
  NumLock: 83, NumpadDivide: 84, NumpadMultiply: 85,
  NumpadSubtract: 86, NumpadAdd: 87, NumpadEnter: 88,
  Numpad1: 89, Numpad2: 90, Numpad3: 91, Numpad4: 92, Numpad5: 93,
  Numpad6: 94, Numpad7: 95, Numpad8: 96, Numpad9: 97, Numpad0: 98,
  NumpadDecimal: 99,

  // Modifiers
  ControlLeft: 224, ShiftLeft: 225, AltLeft: 226, MetaLeft: 227,
  ControlRight: 228, ShiftRight: 229, AltRight: 230, MetaRight: 231,
};

// Scancode constants used by the virtual keyboard.
export const SC = {
  ESC: 41, BS: 42, TAB: 43, ENTER: 40, SPACE: 44,
  SHIFT: 225, CTRL: 224, ALT: 226,
  UP: 82, DOWN: 81, LEFT: 80, RIGHT: 79,
  A: 4, B: 5, C: 6, D: 7, E: 8, F: 9, G: 10, H: 11, I: 12, J: 13,
  K: 14, L: 15, M: 16, N: 17, O: 18, P: 19, Q: 20, R: 21, S: 22,
  T: 23, U: 24, V: 25, W: 26, X: 27, Y: 28, Z: 29,
  D0: 39, D1: 30, D2: 31, D3: 32, D4: 33, D5: 34, D6: 35, D7: 36, D8: 37, D9: 38,
  MINUS: 45, EQUAL: 46,
  LBRACKET: 47, RBRACKET: 48, BACKSLASH: 49,
  SEMICOLON: 51, QUOTE: 52, COMMA: 54, PERIOD: 55, SLASH: 56,
  F1: 58, F2: 59, F3: 60, F4: 61, F5: 62, F6: 63, F7: 64, F8: 65, F9: 66, F10: 67,
} as const;
```

- [ ] **Step 2: Verify typecheck**

Run: `npm run typecheck`
Expected: exits 0 with no output (or only react-router typegen output).

- [ ] **Step 3: Commit**

```bash
git add app/lib/dos-keymap.ts
git commit -m "feat(dos): add SDL2 scancode lookup for KeyboardEvent.code"
```

---

## Task 2: DosEmulator engine class

**Files:**
- Create: `app/lib/dos-emulator.ts`

- [ ] **Step 1: Create the engine class**

```ts
// app/lib/dos-emulator.ts
//
// Thin glue on top of the `emulators` WASM bridge. Owns the canvas
// rendering loop, Web Audio output, physical keyboard forwarding, and
// pointer-based mouse forwarding. Virtual keyboard calls in via
// sendKeyDown/Up. No React, no js-dos UI.

import { keymap } from "./dos-keymap";

export interface CommandInterface {
  exit: () => Promise<void>;
  soundFrequency: () => number;
  simulateKeyPress: (...keyCodes: number[]) => void;
  sendKeyEvent: (keyCode: number, pressed: boolean) => void;
  sendMouseMotion: (x: number, y: number) => void;
  sendMouseRelativeMotion: (x: number, y: number) => void;
  sendMouseButton: (button: number, pressed: boolean) => void;
  sendMouseSync: () => void;
  persist: (onlyChanges?: boolean) => Promise<Uint8Array | null | { drives: unknown[] }>;
  events: () => CommandInterfaceEvents;
}

export interface CommandInterfaceEvents {
  onFrame: (fn: (rgb: Uint8Array | null, rgba: Uint8Array | null) => void) => void;
  onFrameSize: (fn: (w: number, h: number) => void) => void;
  onSoundPush: (fn: (samples: Float32Array) => void) => void;
  onExit: (fn: () => void) => void;
}

interface EmulatorsGlobal {
  pathPrefix: string;
  dosboxXDirect: (init: Uint8Array[]) => Promise<CommandInterface>;
}

declare global {
  interface Window {
    emulators?: EmulatorsGlobal;
  }
}

// preventDefault exempt list — let browser/OS handle these.
// Modifier + (R, T, W, N, L, F, S, P, +, -, 0~9): browser shortcuts.
// Modifier + Tab: tab/app switching. F11: fullscreen. F12: devtools.
const EXEMPT_MODIFIED = new Set([
  "KeyR", "KeyT", "KeyW", "KeyN", "KeyL", "KeyF", "KeyS", "KeyP",
  "Equal", "Minus",
  "Digit0", "Digit1", "Digit2", "Digit3", "Digit4",
  "Digit5", "Digit6", "Digit7", "Digit8", "Digit9",
]);
const EXEMPT_ALWAYS = new Set(["F11", "F12"]);

function shouldForward(e: KeyboardEvent): boolean {
  if (EXEMPT_ALWAYS.has(e.code)) return false;
  const hasCtrlOrMeta = e.ctrlKey || e.metaKey;
  if (hasCtrlOrMeta && EXEMPT_MODIFIED.has(e.code)) return false;
  if ((e.ctrlKey || e.metaKey || e.altKey) && e.code === "Tab") return false;
  return true;
}

export interface DosEmulatorOpts {
  canvas: HTMLCanvasElement;
  bundle: Uint8Array;
  onReady?: (ci: CommandInterface) => void;
  onFirstFrame?: () => void;
  onError?: (err: unknown) => void;
}

export class DosEmulator {
  private opts: DosEmulatorOpts;
  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private ci: CommandInterface | null = null;
  private audioCtx: AudioContext | null = null;
  private nextAudioTime = 0;
  private firstFrame = false;
  private exiting = false;
  private rgbaScratch: Uint8ClampedArray | null = null;

  private readonly onKeyDown: (e: KeyboardEvent) => void;
  private readonly onKeyUp: (e: KeyboardEvent) => void;
  private readonly onPointerDown: (e: PointerEvent) => void;
  private readonly onPointerMove: (e: PointerEvent) => void;
  private readonly onPointerUp: (e: PointerEvent) => void;
  private gestureUnlock: ((e: Event) => void) | null = null;

  constructor(opts: DosEmulatorOpts) {
    this.opts = opts;
    this.canvas = opts.canvas;
    const ctx = this.canvas.getContext("2d");
    if (!ctx) throw new Error("2d canvas context unavailable");
    this.ctx = ctx;
    this.canvas.style.imageRendering = "pixelated";

    this.onKeyDown = (e) => this.handleKey(e, true);
    this.onKeyUp = (e) => this.handleKey(e, false);
    this.onPointerDown = (e) => this.handlePointer(e, "down");
    this.onPointerMove = (e) => this.handlePointer(e, "move");
    this.onPointerUp = (e) => this.handlePointer(e, "up");

    void this.boot().catch((err) => opts.onError?.(err));
  }

  private async boot(): Promise<void> {
    const emu = window.emulators;
    if (!emu) throw new Error("window.emulators not loaded");
    emu.pathPrefix = "/js-dos/emulators/";
    const ci = await emu.dosboxXDirect([this.opts.bundle]);
    if (this.exiting) {
      await ci.exit().catch(() => undefined);
      return;
    }
    this.ci = ci;

    const events = ci.events();
    events.onFrameSize((w, h) => {
      this.canvas.width = w;
      this.canvas.height = h;
      this.rgbaScratch = null; // size changed → reallocate on next frame
    });
    events.onFrame((rgb, rgba) => {
      const w = this.canvas.width, h = this.canvas.height;
      if (w === 0 || h === 0) return;
      let buf: Uint8ClampedArray | null = null;
      if (rgba) {
        buf = new Uint8ClampedArray(rgba.buffer, rgba.byteOffset, rgba.byteLength);
      } else if (rgb) {
        const n = (rgb.length / 3) | 0;
        if (!this.rgbaScratch || this.rgbaScratch.length !== n * 4) {
          this.rgbaScratch = new Uint8ClampedArray(n * 4);
        }
        const tmp = this.rgbaScratch;
        for (let i = 0, j = 0; i < n; i++, j += 4) {
          tmp[j]     = rgb[i * 3];
          tmp[j + 1] = rgb[i * 3 + 1];
          tmp[j + 2] = rgb[i * 3 + 2];
          tmp[j + 3] = 0xff;
        }
        buf = tmp;
      }
      if (!buf) return;
      const img = new ImageData(buf, w, h);
      this.ctx.putImageData(img, 0, 0);
      if (!this.firstFrame) {
        this.firstFrame = true;
        this.opts.onFirstFrame?.();
      }
    });

    // ── Audio ─────────────────────────────────────────────────────
    const sampleRate = ci.soundFrequency();
    if (sampleRate > 0) {
      try {
        this.audioCtx = new AudioContext({ sampleRate });
      } catch {
        this.audioCtx = new AudioContext();
      }
      this.nextAudioTime = this.audioCtx.currentTime;

      const unlock = () => {
        this.audioCtx?.resume().catch(() => undefined);
        if (this.gestureUnlock) {
          window.removeEventListener("pointerdown", this.gestureUnlock, true);
          window.removeEventListener("keydown", this.gestureUnlock, true);
          this.gestureUnlock = null;
        }
      };
      this.gestureUnlock = unlock;
      window.addEventListener("pointerdown", unlock, true);
      window.addEventListener("keydown", unlock, true);

      events.onSoundPush((samples) => this.pushAudio(samples));
    }

    // ── Listeners ─────────────────────────────────────────────────
    window.addEventListener("keydown", this.onKeyDown);
    window.addEventListener("keyup", this.onKeyUp);
    this.canvas.addEventListener("pointerdown", this.onPointerDown);
    this.canvas.addEventListener("pointermove", this.onPointerMove);
    this.canvas.addEventListener("pointerup", this.onPointerUp);
    // Suppress browser right-click menu on the DOS canvas
    this.canvas.addEventListener("contextmenu", (e) => e.preventDefault());

    this.opts.onReady?.(ci);
  }

  private pushAudio(samples: Float32Array): void {
    const audioCtx = this.audioCtx;
    if (!audioCtx) return;
    if (samples.length === 0) return;
    const buffer = audioCtx.createBuffer(1, samples.length, audioCtx.sampleRate);
    buffer.copyToChannel(samples, 0);
    const source = audioCtx.createBufferSource();
    source.buffer = buffer;
    source.connect(audioCtx.destination);
    const t = Math.max(audioCtx.currentTime, this.nextAudioTime);
    source.start(t);
    this.nextAudioTime = t + buffer.duration;
  }

  private handleKey(e: KeyboardEvent, pressed: boolean): void {
    if (!this.ci) return;
    const code = keymap[e.code];
    if (code === undefined) return;
    if (!shouldForward(e)) return;
    e.preventDefault();
    this.ci.sendKeyEvent(code, pressed);
  }

  private handlePointer(e: PointerEvent, kind: "down" | "move" | "up"): void {
    if (!this.ci) return;
    const rect = this.canvas.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) return;
    const rx = (e.clientX - rect.left) / rect.width;
    const ry = (e.clientY - rect.top) / rect.height;
    const cx = Math.max(0, Math.min(1, rx));
    const cy = Math.max(0, Math.min(1, ry));
    this.ci.sendMouseMotion(cx, cy);
    if (kind === "move") {
      this.ci.sendMouseSync();
      return;
    }
    // pointer button — 0=left, 2=right, 1=middle (DOS sees 0,1,2 for L,R,M)
    const button = e.button === 2 ? 1 : e.button === 1 ? 2 : 0;
    this.ci.sendMouseButton(button, kind === "down");
    this.ci.sendMouseSync();
  }

  // ── Public API (used by VirtualKeyboard) ─────────────────────────
  sendKeyDown(scancode: number): void { this.ci?.sendKeyEvent(scancode, true); }
  sendKeyUp(scancode: number): void { this.ci?.sendKeyEvent(scancode, false); }
  sendKeyTap(scancode: number): void { this.ci?.simulateKeyPress(scancode); }

  get commandInterface(): CommandInterface | null { return this.ci; }

  async destroy(): Promise<void> {
    this.exiting = true;
    window.removeEventListener("keydown", this.onKeyDown);
    window.removeEventListener("keyup", this.onKeyUp);
    this.canvas.removeEventListener("pointerdown", this.onPointerDown);
    this.canvas.removeEventListener("pointermove", this.onPointerMove);
    this.canvas.removeEventListener("pointerup", this.onPointerUp);
    if (this.gestureUnlock) {
      window.removeEventListener("pointerdown", this.gestureUnlock, true);
      window.removeEventListener("keydown", this.gestureUnlock, true);
      this.gestureUnlock = null;
    }
    if (this.ci) {
      try { await this.ci.exit(); } catch { /* ignore */ }
      this.ci = null;
    }
    if (this.audioCtx) {
      try { await this.audioCtx.close(); } catch { /* ignore */ }
      this.audioCtx = null;
    }
  }
}
```

- [ ] **Step 2: Verify typecheck**

Run: `npm run typecheck`
Expected: exits 0 with no errors.

- [ ] **Step 3: Commit**

```bash
git add app/lib/dos-emulator.ts
git commit -m "feat(dos): add DosEmulator engine glue on top of emulators WASM bridge"
```

---

## Task 3: Rewrite DosFrame + swap root.tsx script tags

**Files:**
- Modify: `app/components/DosFrame.tsx` (full rewrite)
- Modify: `app/root.tsx` (script src + remove js-dos.css link)

- [ ] **Step 1: Rewrite `app/components/DosFrame.tsx`**

Replace the entire file contents with:

```tsx
// app/components/DosFrame.tsx
import { useEffect, useRef, useState } from "react";
import { DosEmulator, type CommandInterface } from "../lib/dos-emulator";
import { BootScreen } from "./BootScreen";

export type { CommandInterface };
export type { DosEmulator };

export interface DosFrameProps {
  bundleUrl: string;
  onReady: (ci: CommandInterface) => void;
  onError?: (err: unknown) => void;
  /** Called when DosEmulator instance is available (and again with null on unmount). */
  onEmulator?: (emu: DosEmulator | null) => void;
  /** Display width in CSS px. null → fill available space (object-fit contain). */
  width?: number | null;
  /** Display height in CSS px. null → fill available space. */
  height?: number | null;
}

export function DosFrame({ bundleUrl, onReady, onError, onEmulator, width, height }: DosFrameProps) {
  const ref = useRef<HTMLCanvasElement | null>(null);
  const [bootVisible, setBootVisible] = useState(true);
  const mountedAt = useRef<number>(0);
  const fixedSize = width != null && height != null;

  useEffect(() => {
    mountedAt.current = Date.now();
    let cancelled = false;
    let emulator: DosEmulator | null = null;

    async function boot() {
      const start = Date.now();
      while (!window.emulators) {
        if (Date.now() - start > 30_000) {
          onError?.(new Error("emulators failed to load within 30s"));
          return;
        }
        await new Promise((r) => setTimeout(r, 100));
      }
      if (cancelled || !ref.current) return;

      let bundle: Uint8Array;
      try {
        const r = await fetch(bundleUrl, { cache: "no-cache" });
        if (!r.ok) throw new Error(`bundle fetch failed: ${r.status}`);
        bundle = new Uint8Array(await r.arrayBuffer());
      } catch (err) {
        onError?.(err);
        return;
      }
      if (cancelled || !ref.current) return;

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
      onEmulator?.(emulator);
    }
    void boot();

    return () => {
      cancelled = true;
      onEmulator?.(null);
      void emulator?.destroy().catch(() => undefined);
    };
  }, [bundleUrl, onReady, onError, onEmulator]);

  return (
    <div className="dos-stage">
      <canvas
        ref={ref}
        className={fixedSize ? "dos-canvas dos-canvas--fixed" : "dos-canvas dos-canvas--fill"}
        style={fixedSize ? { width: `${width}px`, height: `${height}px` } : undefined}
      />
      <BootScreen visible={bootVisible} />
    </div>
  );
}
```

- [ ] **Step 2: Update `app/root.tsx`**

In `app/root.tsx`, find this line in the `links` function and **delete** it entirely:
```ts
  { rel: "stylesheet", href: "/js-dos/js-dos.css" },
```

In `app/root.tsx`, find this script tag in the `Layout` function:
```tsx
<script src="/js-dos/js-dos.js" defer />
```
Replace it with:
```tsx
<script src="/js-dos/emulators/emulators.js" defer />
```

- [ ] **Step 3: Update `app/app.css` for canvas display**

In `app/app.css`, find the `/* ── DOS stage ── */` section and replace the canvas rules:

Find:
```css
.dos-canvas--fill { width: 100%; height: 100%; }
.dos-canvas--fixed {
  background: #000;
  box-shadow:
    0 0 0 1px var(--color-navy-line),
    0 24px 60px -20px rgba(0, 0, 0, 0.65);
}
```

Replace with:
```css
.dos-canvas { image-rendering: pixelated; display: block; }
.dos-canvas--fill {
  width: 100%;
  height: 100%;
  object-fit: contain;
}
.dos-canvas--fixed {
  background: #000;
  box-shadow:
    0 0 0 1px var(--color-navy-line),
    0 24px 60px -20px rgba(0, 0, 0, 0.65);
}
```

- [ ] **Step 4: Verify typecheck + build**

Run: `npm run typecheck && npm run build 2>&1 | tail -15`
Expected: typecheck passes; build emits new chunks; no errors.

- [ ] **Step 5: Manual browser smoke test**

In a separate terminal: `pm2 restart dosbox` (or `npm run dev` for hot reload).

Then load `http://localhost:5301/` in a browser (or open via Playwright). Verify:
- Boot screen appears, then fades out within ~2s of first DOS frame
- The DOS canvas shows the booted DOS screen (whatever is in `~/dos`)
- Keyboard input forwards: tap canvas, press arrow keys / letters / Enter — DOS reacts
- Mouse click on canvas: registers in DOS (if a mouse-aware program is running)
- Audio: a DOS beep or music plays after the first user interaction
- Resolution picker still works: switch 800×600 etc. — canvas resizes

If any of these fail, do not commit. Investigate (browser console, network tab) and fix.

- [ ] **Step 6: Commit**

```bash
git add app/components/DosFrame.tsx app/root.tsx app/app.css
git commit -m "feat(dos): switch DosFrame to DosEmulator engine; load emulators.js"
```

---

## Task 4: Strip js-dos UI assets

**Files:**
- Modify: `package.json` (`copy-jsdos` script)
- Asset cleanup: `public/js-dos/js-dos.{js,js.map,css}` (removed by new copy-jsdos)

- [ ] **Step 1: Update `copy-jsdos` script in `package.json`**

Find the line in `scripts`:
```json
"copy-jsdos": "rm -rf public/js-dos && mkdir -p public/js-dos && cp -r node_modules/js-dos/dist/* public/js-dos/"
```

Replace with:
```json
"copy-jsdos": "rm -rf public/js-dos && mkdir -p public/js-dos/emulators && cp -r node_modules/js-dos/dist/emulators/* public/js-dos/emulators/"
```

- [ ] **Step 2: Run copy-jsdos to refresh public assets**

Run: `npm run copy-jsdos && ls public/js-dos/`
Expected output: only `emulators` directory listed. No `js-dos.js`, `js-dos.css`, or `js-dos.js.map`.

Verify emulators subdir contents:
Run: `ls public/js-dos/emulators/`
Expected: `emulators.js`, `emulators.js.map`, `wdosbox.js`, `wdosbox.js.symbols`, `wdosbox.wasm`, `wdosbox-x.js`, `wdosbox-x.js.symbols`, `wdosbox-x.wasm`, `wlibzip.js`, `wlibzip.js.symbols`, `wlibzip.wasm`.

- [ ] **Step 3: Verify build still works**

Run: `npm run build 2>&1 | tail -10`
Expected: build succeeds; no missing-file errors.

- [ ] **Step 4: Manual browser smoke test**

Run: `pm2 restart dosbox`

Load `http://localhost:5301/`. Verify the same checks as Task 3 Step 5 still pass. Additionally:
- Browser DevTools Network tab: no request to `/js-dos/js-dos.js` or `/js-dos/js-dos.css`
- `/js-dos/emulators/emulators.js` request succeeds (200 or 304)

If 404 for emulators.js: re-run `npm run copy-jsdos` and check `public/js-dos/emulators/emulators.js` exists.

- [ ] **Step 5: Commit**

```bash
git add package.json public/js-dos
git commit -m "chore(dos): drop js-dos UI assets; copy-jsdos narrowed to emulators/"
```

---

## Task 5: useVirtualKeyboard hook

**Files:**
- Create: `app/lib/use-virtual-keyboard.ts`

- [ ] **Step 1: Create the hook**

```ts
// app/lib/use-virtual-keyboard.ts
//
// Auto-detect touch device → default ON. User toggle persists in
// localStorage and takes precedence over auto-detect on next visit.

import { useCallback, useEffect, useState } from "react";

const STORAGE_KEY = "dosbox-virtual-keyboard";

function detectTouch(): boolean {
  if (typeof window === "undefined") return false;
  try {
    if (window.matchMedia?.("(pointer: coarse)").matches) return true;
  } catch { /* ignore */ }
  return "ontouchstart" in window;
}

export function useVirtualKeyboard(): [boolean, () => void] {
  // SSR-safe: always start false; client useEffect adjusts after hydration.
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      if (saved === "1") { setVisible(true); return; }
      if (saved === "0") { setVisible(false); return; }
    } catch { /* ignore */ }
    setVisible(detectTouch());
  }, []);

  const toggle = useCallback(() => {
    setVisible((v) => {
      const next = !v;
      try { localStorage.setItem(STORAGE_KEY, next ? "1" : "0"); } catch { /* ignore */ }
      return next;
    });
  }, []);

  return [visible, toggle];
}
```

- [ ] **Step 2: Verify typecheck**

Run: `npm run typecheck`
Expected: exits 0 with no errors.

- [ ] **Step 3: Commit**

```bash
git add app/lib/use-virtual-keyboard.ts
git commit -m "feat(dos): add useVirtualKeyboard hook (touch auto-detect + localStorage)"
```

---

## Task 6: VirtualKeyboard component + styles

**Files:**
- Create: `app/components/VirtualKeyboard.tsx`
- Modify: `app/app.css` (append `.vkb` styles)

- [ ] **Step 1: Create `app/components/VirtualKeyboard.tsx`**

```tsx
// app/components/VirtualKeyboard.tsx
//
// QWERTY virtual keyboard for tablet (landscape). Maps button taps to
// SDL2 scancodes and calls onKeyDown/onKeyUp. Sticky-once modifiers:
// Shift/Ctrl/Alt latch on tap, release after the next non-modifier
// key's pointerup. Tap a latched modifier again to clear it manually.

import { useCallback, useState } from "react";
import { SC } from "../lib/dos-keymap";

export interface VirtualKeyboardProps {
  onKeyDown: (scancode: number) => void;
  onKeyUp: (scancode: number) => void;
}

interface KeyDef {
  code: number;
  label: string;
  flex?: number;     // flex-grow units (default 1)
  modifier?: boolean;
}

const ROWS: KeyDef[][] = [
  // Row 1: digits + Backspace
  [
    { code: SC.D1, label: "1" }, { code: SC.D2, label: "2" }, { code: SC.D3, label: "3" },
    { code: SC.D4, label: "4" }, { code: SC.D5, label: "5" }, { code: SC.D6, label: "6" },
    { code: SC.D7, label: "7" }, { code: SC.D8, label: "8" }, { code: SC.D9, label: "9" },
    { code: SC.D0, label: "0" }, { code: SC.MINUS, label: "-" }, { code: SC.EQUAL, label: "=" },
    { code: SC.BS, label: "⌫", flex: 2 },
  ],
  // Row 2: Tab + Q..P + brackets + backslash
  [
    { code: SC.TAB, label: "Tab", flex: 1.5 },
    { code: SC.Q, label: "Q" }, { code: SC.W, label: "W" }, { code: SC.E, label: "E" },
    { code: SC.R, label: "R" }, { code: SC.T, label: "T" }, { code: SC.Y, label: "Y" },
    { code: SC.U, label: "U" }, { code: SC.I, label: "I" }, { code: SC.O, label: "O" },
    { code: SC.P, label: "P" },
    { code: SC.LBRACKET, label: "[" }, { code: SC.RBRACKET, label: "]" },
    { code: SC.BACKSLASH, label: "\\" },
  ],
  // Row 3: Esc + A..L + ; ' Enter
  [
    { code: SC.ESC, label: "Esc", flex: 1.75 },
    { code: SC.A, label: "A" }, { code: SC.S, label: "S" }, { code: SC.D, label: "D" },
    { code: SC.F, label: "F" }, { code: SC.G, label: "G" }, { code: SC.H, label: "H" },
    { code: SC.J, label: "J" }, { code: SC.K, label: "K" }, { code: SC.L, label: "L" },
    { code: SC.SEMICOLON, label: ";" }, { code: SC.QUOTE, label: "'" },
    { code: SC.ENTER, label: "⏎", flex: 2.25 },
  ],
  // Row 4: Shift + Z..M + , . / + UP
  [
    { code: SC.SHIFT, label: "Shift", flex: 2.25, modifier: true },
    { code: SC.Z, label: "Z" }, { code: SC.X, label: "X" }, { code: SC.C, label: "C" },
    { code: SC.V, label: "V" }, { code: SC.B, label: "B" }, { code: SC.N, label: "N" },
    { code: SC.M, label: "M" },
    { code: SC.COMMA, label: "," }, { code: SC.PERIOD, label: "." }, { code: SC.SLASH, label: "/" },
    { code: SC.UP, label: "↑", flex: 1.5 },
  ],
  // Row 5: Ctrl Alt Space Alt + arrows
  [
    { code: SC.CTRL, label: "Ctrl", flex: 1.5, modifier: true },
    { code: SC.ALT, label: "Alt", flex: 1.25, modifier: true },
    { code: SC.SPACE, label: "Space", flex: 6 },
    { code: SC.ALT, label: "Alt", flex: 1.25, modifier: true },
    { code: SC.LEFT, label: "←" }, { code: SC.DOWN, label: "↓" }, { code: SC.RIGHT, label: "→" },
  ],
  // Row 6: F1..F10
  [
    { code: SC.F1, label: "F1" }, { code: SC.F2, label: "F2" }, { code: SC.F3, label: "F3" },
    { code: SC.F4, label: "F4" }, { code: SC.F5, label: "F5" }, { code: SC.F6, label: "F6" },
    { code: SC.F7, label: "F7" }, { code: SC.F8, label: "F8" }, { code: SC.F9, label: "F9" },
    { code: SC.F10, label: "F10" },
  ],
];

export function VirtualKeyboard({ onKeyDown, onKeyUp }: VirtualKeyboardProps) {
  // pressed: ids of non-modifier keys currently held (for visual feedback)
  const [pressed, setPressed] = useState<Set<string>>(new Set());
  // stickyMods: scancodes of currently-latched modifiers
  const [stickyMods, setStickyMods] = useState<Set<number>>(new Set());

  const handleDown = useCallback((id: string, k: KeyDef) => {
    if (k.modifier) {
      setStickyMods((prev) => {
        const n = new Set(prev);
        if (n.has(k.code)) {
          n.delete(k.code);
          onKeyUp(k.code);
        } else {
          n.add(k.code);
          onKeyDown(k.code);
        }
        return n;
      });
      return;
    }
    setPressed((prev) => {
      if (prev.has(id)) return prev;
      const n = new Set(prev);
      n.add(id);
      return n;
    });
    onKeyDown(k.code);
  }, [onKeyDown, onKeyUp]);

  const handleUp = useCallback((id: string, k: KeyDef) => {
    if (k.modifier) return;
    setPressed((prev) => {
      if (!prev.has(id)) return prev;
      const n = new Set(prev);
      n.delete(id);
      return n;
    });
    onKeyUp(k.code);
    // After a non-modifier release, clear any sticky modifiers.
    setStickyMods((prev) => {
      if (prev.size === 0) return prev;
      for (const m of prev) onKeyUp(m);
      return new Set();
    });
  }, [onKeyUp]);

  return (
    <div className="vkb" role="group" aria-label="DOS 가상 키보드">
      {ROWS.map((row, ri) => (
        <div className="vkb-row" key={ri}>
          {row.map((k, ki) => {
            const id = `${ri}-${ki}`;
            const isPressed = k.modifier ? stickyMods.has(k.code) : pressed.has(id);
            return (
              <button
                key={id}
                type="button"
                tabIndex={-1}
                aria-pressed={isPressed}
                className={
                  "vkb-key" +
                  (isPressed ? " vkb-key--pressed" : "") +
                  (k.modifier ? " vkb-key--mod" : "")
                }
                style={{ flexGrow: k.flex ?? 1 }}
                onPointerDown={(e) => { e.preventDefault(); handleDown(id, k); }}
                onPointerUp={(e) => { e.preventDefault(); handleUp(id, k); }}
                onPointerCancel={() => handleUp(id, k)}
                onPointerLeave={(e) => { if (e.buttons !== 0) handleUp(id, k); }}
                onContextMenu={(e) => e.preventDefault()}
              >
                {k.label}
              </button>
            );
          })}
        </div>
      ))}
    </div>
  );
}
```

- [ ] **Step 2: Append `.vkb` styles to `app/app.css`**

Append the following to the end of `app/app.css`:

```css
/* ── Virtual keyboard ─────────────────────────────────────────────── */

.vkb {
  display: flex;
  flex-direction: column;
  gap: 4px;
  padding: 8px;
  background: var(--color-navy-bg);
  border-top: 1px solid var(--color-navy-line);
  user-select: none;
  touch-action: manipulation;
}
.vkb-row { display: flex; gap: 4px; }
.vkb-key {
  flex: 1 1 0;
  min-width: 0;
  min-height: 34px;
  padding: 4px 0;
  border: 1px solid var(--color-navy-line);
  border-radius: 4px;
  background: var(--color-navy-bg-lift);
  color: var(--color-navy-text);
  font-family: var(--font-mono);
  font-size: 13px;
  letter-spacing: 0.02em;
  transition: background 80ms ease, border-color 80ms ease, color 80ms ease;
  cursor: pointer;
}
.vkb-key:active { background: var(--color-navy-line); }
.vkb-key--mod { color: var(--color-navy-muted); }
.vkb-key--pressed {
  background: var(--color-navy-accent);
  border-color: var(--color-navy-accent);
  color: #050912;
}
.vkb-key--mod.vkb-key--pressed { color: #050912; }
```

- [ ] **Step 3: Verify typecheck**

Run: `npm run typecheck`
Expected: exits 0 with no errors.

- [ ] **Step 4: Commit**

```bash
git add app/components/VirtualKeyboard.tsx app/app.css
git commit -m "feat(dos): add VirtualKeyboard component + navy minimal styles"
```

---

## Task 7: Toolbar keyboard toggle button

**Files:**
- Modify: `app/components/Toolbar.tsx`
- Modify: `app/app.css` (append `.toolbar__icon` styles)

- [ ] **Step 1: Update `app/components/Toolbar.tsx`**

Replace the entire file with:

```tsx
import { ResolutionPicker, type ResolutionId } from "./ResolutionPicker";

export interface ToolbarProps {
  isAdmin: boolean;
  saving: boolean;
  resolutionId: ResolutionId;
  onResolutionChange: (id: ResolutionId) => void;
  vkbVisible: boolean;
  onVkbToggle: () => void;
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
        {isAdmin ? (
          <>
            <button onClick={onSave} disabled={saving} className="toolbar__save">
              {saving ? "저장 중…" : "저장"}
            </button>
            <button onClick={onLogout} className="toolbar__ghost">
              로그아웃
            </button>
          </>
        ) : (
          <button onClick={onLoginClick} className="toolbar__ghost">
            관리자
          </button>
        )}
      </div>
    </header>
  );
}
```

- [ ] **Step 2: Append `.toolbar__icon` styles**

Append the following to the end of `app/app.css`:

```css
/* ── Toolbar icon button ─────────────────────────────────────────── */

.toolbar__icon {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 26px;
  height: 26px;
  border: 1px solid var(--color-navy-line);
  border-radius: 4px;
  background: transparent;
  color: var(--color-navy-muted);
  font-size: 14px;
  line-height: 1;
  transition: border-color 120ms ease, background 120ms ease, color 120ms ease;
  cursor: pointer;
}
.toolbar__icon:hover {
  border-color: #2e3d70;
  background: var(--color-navy-bg-lift);
  color: var(--color-navy-text);
}
.toolbar__icon--active {
  border-color: var(--color-navy-accent);
  color: var(--color-navy-accent);
  background: var(--color-navy-bg-lift);
}
```

- [ ] **Step 3: Verify typecheck (will fail until Task 8)**

Run: `npm run typecheck`
Expected: TYPE ERRORS in `app/routes/_index.tsx` — `<Toolbar />` is missing required props `vkbVisible` and `onVkbToggle`. This is expected; Task 8 wires them up. Do **not** commit yet.

- [ ] **Step 4: Proceed directly to Task 8** (no commit yet — type errors are intentional and resolved in next task)

---

## Task 8: Wire VirtualKeyboard in _index.tsx

**Files:**
- Modify: `app/routes/_index.tsx`

- [ ] **Step 1: Rewrite `app/routes/_index.tsx`**

Replace the entire file with:

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

- [ ] **Step 2: Verify typecheck**

Run: `npm run typecheck`
Expected: exits 0 with no errors. The Task 7 type errors should now be resolved.

- [ ] **Step 3: Build**

Run: `npm run build 2>&1 | tail -10`
Expected: build succeeds.

- [ ] **Step 4: Commit Tasks 7 + 8 together**

```bash
git add app/components/Toolbar.tsx app/routes/_index.tsx app/app.css
git commit -m "feat(dos): wire VirtualKeyboard with toolbar toggle + tablet auto-detect"
```

---

## Task 9: Final smoke test + deploy

**Files:** none (verification + deploy only)

- [ ] **Step 1: Restart pm2**

Run: `pm2 restart dosbox && sleep 1 && curl -sI http://localhost:5301/ | head -3`
Expected: `HTTP/1.1 200 OK` line in output.

- [ ] **Step 2: Verify the served HTML uses the new assets**

Run: `curl -s http://localhost:5301/ | grep -oE 'h-dvh|emulators\.js|js-dos\.js|js-dos\.css|res-picker__trigger|toolbar__icon' | sort -u`
Expected output (sorted, deduped):
```
emulators.js
h-dvh
res-picker__trigger
toolbar__icon
```
No `js-dos.js` or `js-dos.css` references.

- [ ] **Step 3: Desktop browser smoke test**

Open `http://localhost:5301/` in desktop Chrome. Verify:
- Boot screen appears, then fades (≤ 2s after first DOS frame visible)
- Canvas shows DOS booted state from `~/dos`
- Click canvas → press Arrow keys / letters → DOS reacts
- Mouse click registers in DOS (if mouse-aware program running)
- Audio plays after first interaction
- Toolbar `⌨` button: click toggles virtual keyboard on (grid grows a row at bottom). Toggle off → row removed.
- Resolution picker: cycle through 640×480, 800×600, 1024×768, 1280×960, 전체화면 — canvas resizes correctly. `image-rendering: pixelated` keeps the picture crisp at non-native sizes.
- Save button (after `관리자` login if needed): produces toast — either "N개 저장됨" or "변경 없음".
- Reload page: chosen resolution persists; vkb toggle state persists; first-frame boot screen appears.

- [ ] **Step 4: Tablet emulation smoke test (Chrome DevTools)**

In Chrome DevTools, toggle device toolbar → iPad Pro (1366×1024) landscape. Reload `http://localhost:5301/`. Verify:
- Virtual keyboard auto-shows at the bottom (touch-coarse pointer detected)
- Tap keyboard keys → DOS reacts to taps (letters, arrows, space)
- Tap Shift, then a letter → letter sends (Shift latches, releases after the letter's pointerup)
- Toggle keyboard off via toolbar `⌨` → row disappears, canvas grows
- Bottom of the page not clipped (h-dvh fix from prior commit)

- [ ] **Step 5: Verify no console errors during the smoke test**

In DevTools Console: should be clean — no red errors related to the emulator, audio, or React. Warnings (e.g., AudioContext autoplay) are acceptable until first user gesture.

- [ ] **Step 6: pm2 status sanity check**

Run: `pm2 list 2>&1 | grep dosbox`
Expected: status `online`, recent uptime (single-digit seconds or minutes), no crash-loop restart count spike.

- [ ] **Step 7: No commit needed (Tasks 1-8 already committed). End-of-feature note.**

If any smoke check failed in steps 3 or 4, do not declare done. Re-investigate using the relevant prior task's code as reference. If the failure is environmental (e.g., bundle not built, pm2 not restarted), redo that step. If logic, file a follow-up.

---

## Out of scope (do not implement)

- Automated test framework setup (no test infrastructure exists; this plan deliberately uses manual smoke checks).
- Game-pad / D-pad virtual overlay (deferred per brainstorming — only QWERTY).
- WebGL canvas renderer (2D `putImageData` is fine for current resolutions; revisit if mobile CPU shows up in profiling).
- AudioWorklet (`AudioBufferSourceNode` queue is fine to start; switch only if underrun is observed).
- Touch-to-mouse remapping for desktop click-and-drag games (the canvas already accepts pointer events).
- `wdosbox` (DOSBox classic) integration — we stay on `wdosbox-x` to match the prior runtime.
