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
        // Defensive copy: the WASM bridge may reuse this buffer before
        // putImageData fully consumes it. new Uint8ClampedArray(typedArray)
        // allocates fresh storage. Side benefit: avoids the ArrayBufferLike
        // generic cast we'd otherwise need on rgba.buffer.
        buf = new Uint8ClampedArray(rgba);
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
      const img = new ImageData(buf as unknown as Uint8ClampedArray<ArrayBuffer>, w, h);
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
    buffer.copyToChannel(samples as Float32Array<ArrayBuffer>, 0);
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
    // PointerEvent.button → DOSBox button index:
    //   browser 0 (left)   → 0
    //   browser 2 (right)  → 1
    //   browser 1 (middle) → 2
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
