// app/lib/dos-emulator.ts
//
// Thin glue on top of the `emulators` WASM bridge. Owns the canvas
// rendering loop, Web Audio output, physical keyboard forwarding, and
// pointer-based mouse forwarding. Virtual keyboard calls in via
// sendKeyDown/Up. No React, no js-dos UI.

import { keymap } from "./dos-keymap";
import { PROCESSOR_NAME, WORKLET_URL } from "./dos-audio-worklet";

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
  sendBackendEvent: (event: unknown) => void;
  events: () => CommandInterfaceEvents;
}

export interface CommandInterfaceEvents {
  onFrame: (fn: (rgb: Uint8Array | null, rgba: Uint8Array | null) => void) => void;
  onFrameSize: (fn: (w: number, h: number) => void) => void;
  onSoundPush: (fn: (samples: Float32Array) => void) => void;
  onExit: (fn: () => void) => void;
}

interface BackendOptions {
  onExtractProgress?: (bundleIndex: number, file: string, extracted: number, total: number) => void;
}

interface EmulatorsGlobal {
  pathPrefix: string;
  dosboxDirect: (init: Uint8Array[], options?: BackendOptions) => Promise<CommandInterface>;
  dosboxXDirect: (init: Uint8Array[], options?: BackendOptions) => Promise<CommandInterface>;
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

// Passthrough shaders for a fullscreen textured quad. Y is flipped in the
// vertex tex coords so row 0 of the uploaded image lands at the top of the
// canvas (WebGL's clip-space y is up, image data row 0 is the top).
const VS = `
attribute vec2 aPos;
attribute vec2 aTex;
varying vec2 vTex;
void main() {
  gl_Position = vec4(aPos, 0.0, 1.0);
  vTex = aTex;
}`;
const FS = `
precision mediump float;
varying vec2 vTex;
uniform sampler2D uTex;
void main() {
  gl_FragColor = texture2D(uTex, vTex);
}`;
// 6 verts × (vec2 pos, vec2 tex). v inverted so v=0 maps to image row 0.
const QUAD = new Float32Array([
  -1, -1, 0, 1,
   1, -1, 1, 1,
  -1,  1, 0, 0,
  -1,  1, 0, 0,
   1, -1, 1, 1,
   1,  1, 1, 0,
]);

function compileShader(gl: WebGLRenderingContext, type: number, source: string): WebGLShader {
  const sh = gl.createShader(type);
  if (!sh) throw new Error("gl.createShader failed");
  gl.shaderSource(sh, source);
  gl.compileShader(sh);
  if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) {
    const log = gl.getShaderInfoLog(sh) ?? "";
    gl.deleteShader(sh);
    throw new Error("shader compile failed: " + log);
  }
  return sh;
}

function withTimeout<T>(p: Promise<T>, ms: number, label: string): Promise<T> {
  return Promise.race([
    p,
    new Promise<T>((_, reject) =>
      setTimeout(() => reject(new Error(`${label} timeout ${ms}ms`)), ms),
    ),
  ]);
}

function waitForRunning(ctx: AudioContext, timeoutMs: number): Promise<void> {
  return new Promise((resolve) => {
    if (ctx.state === "running") return resolve();
    const start = Date.now();
    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      ctx.removeEventListener("statechange", onChange);
      resolve();
    };
    const onChange = () => { if (ctx.state === "running") finish(); };
    ctx.addEventListener("statechange", onChange);
    const poll = () => {
      if (done) return;
      if (ctx.state === "running") return finish();
      if (Date.now() - start > timeoutMs) return finish();
      setTimeout(poll, 100);
    };
    setTimeout(poll, 100);
  });
}

export interface DosEmulatorOpts {
  canvas: HTMLCanvasElement;
  bundle: Uint8Array;
  /** Optional per-user save overlay. emulators layers later entries over earlier
   *  ones, so files in this zip overwrite the matching paths from `bundle`. */
  overlay?: Uint8Array | null;
  onReady?: (ci: CommandInterface) => void;
  onFirstFrame?: () => void;
  onError?: (err: unknown) => void;
  /** Fraction in [0,1] of bundle extraction progress reported by the WASM bridge. */
  onExtractProgress?: (fraction: number) => void;
}

export class DosEmulator {
  private opts: DosEmulatorOpts;
  private canvas: HTMLCanvasElement;
  private gl: WebGLRenderingContext;
  private program: WebGLProgram | null = null;
  private tex: WebGLTexture | null = null;
  private quadBuf: WebGLBuffer | null = null;
  private ci: CommandInterface | null = null;
  private audioCtx: AudioContext | null = null;
  private audioNode: AudioWorkletNode | null = null;
  // Ratio for linear-interpolation resampling in pushAudio. iOS Safari
  // silently coerces our requested 22050 Hz context to the device native
  // rate (48000/44100), so we let it pick the rate and resample DOS samples
  // (sourceRate) into the context's rate (ctx.sampleRate) on the main thread
  // before posting to the worklet.
  private resampleRatio = 1;
  private firstFrame = false;
  private exiting = false;
  // Latest pixel buffer staged by onFrame; consumed by the next RAF tick.
  // Decoupling emulator output rate from display vsync is what stops the
  // Chrome/Mac compositor from thrashing the display state.
  private pendingBuf: Uint8Array | null = null;
  private pendingFmt = 0;
  private texW = 0;
  private texH = 0;
  private rafId = 0;

  // Touch gesture state. TouchEvent.touches is the source of truth on iOS.
  private leftTouchDown = false;
  private rightTouchActive = false;
  private longPressTimer: ReturnType<typeof setTimeout> | null = null;
  private longPressStart = { x: 0.5, y: 0.5 };
  private suppressMouseUntil = 0;
  private touchStartedOnCanvas = false;
  private touchMoved = false;
  private clickReleaseTimers = new Set<ReturnType<typeof setTimeout>>();

  private readonly onKeyDown: (e: KeyboardEvent) => void;
  private readonly onKeyUp: (e: KeyboardEvent) => void;
  private readonly onPointerDown: (e: PointerEvent) => void;
  private readonly onPointerMove: (e: PointerEvent) => void;
  private readonly onPointerUp: (e: PointerEvent) => void;
  private readonly onTouchStart: (e: TouchEvent) => void;
  private readonly onTouchMove: (e: TouchEvent) => void;
  private readonly onTouchEnd: (e: TouchEvent) => void;
  private readonly onContextMenu: (e: MouseEvent) => void;
  private gestureUnlock: ((e: Event) => void) | null = null;

  constructor(opts: DosEmulatorOpts) {
    this.opts = opts;
    this.canvas = opts.canvas;
    // preserveDrawingBuffer: true is load-bearing for Chrome on macOS.
    // With it false (the WebGL default), the browser clears the canvas
    // backbuffer after each compositor read. Our RAF only fires when the
    // emulator pushes a new frame, so any display vsync without a fresh
    // emulator frame (DOS modes run 60-70 Hz, occasional CPU dips) shows a
    // cleared (black) canvas → whole-window flicker. Safari masks this with
    // a different compositor path. When the virtual keyboard is mounted
    // its fixed+transform layer accidentally promotes the canvas to its own
    // composited layer, which also masked the bug — but the underlying
    // race exists in both states.
    const gl = this.canvas.getContext("webgl", {
      alpha: false,
      antialias: false,
      preserveDrawingBuffer: true,
    });
    if (!gl) throw new Error("webgl context unavailable");
    this.gl = gl;
    // "auto" lets the compositor smooth any further upscale beyond the
    // canvas framebuffer, matching the LINEAR sampling inside GL.
    this.canvas.style.imageRendering = "auto";
    this.setupGL();

    this.onKeyDown = (e) => this.handleKey(e, true);
    this.onKeyUp = (e) => this.handleKey(e, false);
    this.onPointerDown = (e) => this.handlePointer(e, "down");
    this.onPointerMove = (e) => this.handlePointer(e, "move");
    this.onPointerUp = (e) => this.handlePointer(e, "up");
    this.onTouchStart = (e) => this.handleTouchEvent(e, "down");
    this.onTouchMove = (e) => this.handleTouchEvent(e, "move");
    this.onTouchEnd = (e) => this.handleTouchEvent(e, "up");
    this.onContextMenu = (e) => e.preventDefault();

    void this.boot().catch((err) => opts.onError?.(err));
  }

  private async boot(): Promise<void> {
    const emu = window.emulators;
    if (!emu) throw new Error("window.emulators not loaded");
    emu.pathPrefix = "/js-dos/emulators/";
    const onExtract = this.opts.onExtractProgress;
    const initFs = this.opts.overlay
      ? [this.opts.bundle, this.opts.overlay]
      : [this.opts.bundle];
    // Use the classic DOSBox backend. SDI113 runs on native DOSBox 0.74 but
    // exits under the DOSBox-X WASM backend even with matching conf defaults.
    const ci = await emu.dosboxDirect(initFs, onExtract ? {
      onExtractProgress: (_idx, _file, extracted, total) => {
        if (total > 0) onExtract(Math.min(1, extracted / total));
      },
    } : undefined);
    if (this.exiting) {
      await ci.exit().catch(() => undefined);
      return;
    }
    this.ci = ci;

    const events = ci.events();
    const gl = this.gl;
    events.onFrameSize((w, h) => {
      this.canvas.width = w;
      this.canvas.height = h;
      this.texW = w;
      this.texH = h;
      gl.viewport(0, 0, w, h);
      this.pendingBuf = null;
    });
    events.onFrame((rgb, rgba) => {
      const src = rgba ?? rgb;
      if (!src) return;
      // Defensive copy: the WASM bridge reuses this buffer between frames.
      // Cheap allocation, prevents tearing if RAF fires after a new frame
      // has overwritten the old contents.
      this.pendingBuf = new Uint8Array(src);
      this.pendingFmt = rgba ? gl.RGBA : gl.RGB;
      // Coalesce: if a RAF is already scheduled, the latest buffer simply
      // replaces the previous one — dropping intermediate frames keeps GPU
      // work in lockstep with display vsync.
      if (this.rafId === 0) this.rafId = requestAnimationFrame(this.renderFrame);
    });

    // ── Audio ─────────────────────────────────────────────────────
    // Pull-based pipeline using AudioWorklet (replacement for the old
    // per-chunk createBufferSource scheduler that was dropping ~all chunks on
    // mobile because a 10 ms MAX_LEAD cap couldn't survive Worker→main-thread
    // postMessage jitter). Pattern mirrors upstream js-dos's ring-buffer +
    // ScriptProcessorNode, but with the modern (non-deprecated) Worklet API.
    //
    // Setup is deferred to first user gesture: iOS Safari has well-known
    // failure modes where an AudioContext created outside a gesture stays
    // silent even after resume(). Doing the creation + addModule + node
    // wiring synchronously inside the gesture callback is the well-trodden
    // path. Desktop Chrome doesn't care; mobile Safari does.
    //
    // events.onSoundPush is registered immediately (sampleRate>0), so
    // pre-gesture chunks reach pushAudio. They no-op (audioNode is null) —
    // same effective behavior as the old "drop while suspended" path.
    const sampleRate = ci.soundFrequency();
    if (sampleRate > 0) {
      events.onSoundPush((samples) => this.pushAudio(samples));

      // First gesture wins. Each handler removes the other.
      const setupOnce = async (): Promise<void> => {
        if (this.gestureUnlock) {
          window.removeEventListener("pointerdown", this.gestureUnlock, true);
          window.removeEventListener("keydown", this.gestureUnlock, true);
          this.gestureUnlock = null;
        }
        try {
          await this.setupAudio(sampleRate);
        } catch (err) {
          // Audio failure must never break video/input.
          console.warn("[dos-emulator] audio init failed:", err);
          if (this.audioCtx) {
            try { await this.audioCtx.close(); } catch { /* ignore */ }
            this.audioCtx = null;
          }
          this.audioNode = null;
        }
      };
      const unlock = () => { void setupOnce(); };
      this.gestureUnlock = unlock;
      window.addEventListener("pointerdown", unlock, true);
      window.addEventListener("keydown", unlock, true);
    }

    // ── Listeners ─────────────────────────────────────────────────
    window.addEventListener("keydown", this.onKeyDown);
    window.addEventListener("keyup", this.onKeyUp);
    this.canvas.addEventListener("pointerdown", this.onPointerDown);
    this.canvas.addEventListener("pointermove", this.onPointerMove);
    this.canvas.addEventListener("pointerup", this.onPointerUp);
    this.canvas.addEventListener("pointercancel", this.onPointerUp);
    window.addEventListener("touchstart", this.onTouchStart, { passive: false, capture: true });
    window.addEventListener("touchmove", this.onTouchMove, { passive: false, capture: true });
    window.addEventListener("touchend", this.onTouchEnd, { passive: false, capture: true });
    window.addEventListener("touchcancel", this.onTouchEnd, { passive: false, capture: true });
    // Suppress browser right-click menu on the DOS canvas
    this.canvas.addEventListener("contextmenu", this.onContextMenu);

    this.opts.onReady?.(ci);
  }

  private setupGL(): void {
    const gl = this.gl;
    const vs = compileShader(gl, gl.VERTEX_SHADER, VS);
    const fs = compileShader(gl, gl.FRAGMENT_SHADER, FS);
    const prog = gl.createProgram();
    if (!prog) throw new Error("gl.createProgram failed");
    gl.attachShader(prog, vs);
    gl.attachShader(prog, fs);
    gl.linkProgram(prog);
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) {
      const log = gl.getProgramInfoLog(prog) ?? "";
      throw new Error("program link failed: " + log);
    }
    gl.useProgram(prog);
    this.program = prog;

    const buf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, QUAD, gl.STATIC_DRAW);
    this.quadBuf = buf;

    const aPos = gl.getAttribLocation(prog, "aPos");
    const aTex = gl.getAttribLocation(prog, "aTex");
    gl.enableVertexAttribArray(aPos);
    gl.vertexAttribPointer(aPos, 2, gl.FLOAT, false, 16, 0);
    gl.enableVertexAttribArray(aTex);
    gl.vertexAttribPointer(aTex, 2, gl.FLOAT, false, 16, 8);

    const tex = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    // LINEAR smooths the non-integer upscale from DOS framebuffer to canvas —
    // notably 720x400 text mode into a 640x480-locked viewport, where NEAREST
    // produced visibly broken glyph stems.
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    // RGB rows for odd widths (e.g. 320*3=960 is %4 but 321*3=963 is not) —
    // tell the GPU not to expect 4-byte row alignment.
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGB, 1, 1, 0, gl.RGB, gl.UNSIGNED_BYTE, new Uint8Array([0, 0, 0]));
    this.tex = tex;

    const uTex = gl.getUniformLocation(prog, "uTex");
    gl.activeTexture(gl.TEXTURE0);
    gl.uniform1i(uTex, 0);
    gl.clearColor(0, 0, 0, 1);
  }

  private readonly renderFrame = (): void => {
    this.rafId = 0;
    const gl = this.gl;
    const buf = this.pendingBuf;
    if (!buf || this.texW === 0 || this.texH === 0) return;
    this.pendingBuf = null;
    gl.texImage2D(gl.TEXTURE_2D, 0, this.pendingFmt, this.texW, this.texH, 0, this.pendingFmt, gl.UNSIGNED_BYTE, buf);
    gl.drawArrays(gl.TRIANGLES, 0, 6);
    if (!this.firstFrame) {
      this.firstFrame = true;
      this.opts.onFirstFrame?.();
    }
  };

  private pushAudio(samples: Float32Array): void {
    const node = this.audioNode;
    if (!node || samples.length === 0) return;
    // Defensive copy regardless (WASM reuses its buffer). When the context
    // sample rate matches the DOS source rate, send as-is; otherwise linearly
    // interpolate to the context rate on this thread. The worklet just plays
    // whatever it receives at its native rate — no rate handling inside the
    // worklet keeps it simple. Per-chunk resampling has tiny phase
    // discontinuities at chunk boundaries but they're inaudible for DOS
    // audio (no continuous tonal content sensitive to phase jitter).
    const ratio = this.resampleRatio;
    let toSend: Float32Array;
    if (Math.abs(ratio - 1) < 0.001) {
      toSend = new Float32Array(samples);
    } else {
      const outLen = Math.max(1, Math.round(samples.length * ratio));
      toSend = new Float32Array(outLen);
      const invRatio = samples.length / outLen;
      const lastIdx = samples.length - 1;
      for (let i = 0; i < outLen; i++) {
        const srcPos = i * invRatio;
        const idx = Math.floor(srcPos);
        const frac = srcPos - idx;
        const a = idx <= lastIdx ? samples[idx] : 0;
        const b = idx + 1 <= lastIdx ? samples[idx + 1] : a;
        toSend[i] = a + (b - a) * frac;
      }
    }
    node.port.postMessage(toSend, [toSend.buffer]);
  }

  private async setupAudio(sourceRate: number): Promise<void> {
    if (this.audioCtx || this.exiting) return;

    // Safari (<14.5) only exposed webkitAudioContext. Current iOS Safari has
    // both names, but keep the fallback for the long tail.
    const Ctor: typeof AudioContext | undefined =
      typeof AudioContext !== "undefined"
        ? AudioContext
        : (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctor) throw new Error("AudioContext unavailable");

    // Match upstream js-dos: request the DOS mixer rate from AudioContext.
    // On desktop and browsers that honor the request, ctx.sampleRate ===
    // sourceRate and the resample fast-path in pushAudio is a no-op (ratio=1).
    //
    // CRITICAL: pass ONLY {sampleRate}. Adding latencyHint:"interactive"
    // (or any "unlock dance" with a silent BufferSource / oscillator, or
    // `await`ing resume()) caused iOS Safari to leave the context stuck in
    // state="suspended" forever even from inside a gesture handler. The
    // dynamic resampleRatio handles whatever the browser actually picks.
    try {
      this.audioCtx = new Ctor({ sampleRate: sourceRate });
    } catch {
      this.audioCtx = new Ctor();
    }
    this.resampleRatio = this.audioCtx.sampleRate / sourceRate;
    // WebKit (macOS/iOS Safari) interrupts the audio session whenever a
    // blocking system dialog (window.confirm/alert) appears or the tab is
    // backgrounded, dropping the context to "suspended"/"interrupted" and
    // NOT auto-resuming — audio stays dead until a fresh AudioContext is made
    // (i.e. a page reload). Re-kick resume() on every statechange so the
    // context recovers on its own as soon as the interruption ends. Chrome
    // never hits this path. See also resumeAudioIfNeeded() on user gestures.
    this.audioCtx.addEventListener("statechange", this.resumeAudioIfNeeded);
    if (!this.audioCtx.audioWorklet || typeof this.audioCtx.audioWorklet.addModule !== "function") {
      throw new Error("AudioWorklet API missing");
    }

    // Kick resume() inside the gesture's task. Don't await it: WebKit has
    // been observed to return a Promise that never resolves even when
    // ctx.state actually transitions to "running". Poll state instead.
    void this.audioCtx.resume().catch(() => undefined);
    await waitForRunning(this.audioCtx, 2000);

    await withTimeout(
      this.audioCtx.audioWorklet.addModule(WORKLET_URL),
      6000,
      "addModule",
    );
    if (this.exiting) return;

    // outputChannelCount intentionally NOT specified — let the platform
    // pick. Some iOS Safari builds reject [1] mono explicitly; the worklet
    // handles both mono and N-channel outputs (mirrors mono → all channels).
    this.audioNode = new AudioWorkletNode(this.audioCtx, PROCESSOR_NAME, {
      numberOfInputs: 0,
      numberOfOutputs: 1,
    });
    this.audioNode.connect(this.audioCtx.destination);

    // Re-kick resume after the audio graph is wired. iOS sometimes wants
    // the destination to be a non-empty graph before it'll commit.
    void this.audioCtx.resume().catch(() => undefined);
    await waitForRunning(this.audioCtx, 1500);
  }

  // Re-kick resume() if WebKit dropped the context out of "running" (system
  // dialog / tab switch interruption). Arrow property so it can be both an
  // event listener and a per-gesture call without rebinding. No-op on Chrome
  // (the context is already "running"), cheap (one state compare) otherwise.
  private resumeAudioIfNeeded = (): void => {
    const ctx = this.audioCtx;
    if (ctx && ctx.state !== "running" && ctx.state !== "closed") {
      void ctx.resume().catch(() => undefined);
    }
  };

  private handleKey(e: KeyboardEvent, pressed: boolean): void {
    this.resumeAudioIfNeeded();
    if (!this.ci) return;
    const code = keymap[e.code];
    if (code === undefined) return;
    if (!shouldForward(e)) return;
    e.preventDefault();
    this.ci.sendKeyEvent(code, pressed);
  }

  private handlePointer(e: PointerEvent, kind: "down" | "move" | "up"): void {
    if (kind === "down") this.resumeAudioIfNeeded();
    if (!this.ci) return;
    if (e.pointerType === "touch" && "TouchEvent" in window) return;
    if (Date.now() < this.suppressMouseUntil) return;
    e.preventDefault();
    if (kind === "down") {
      try { this.canvas.setPointerCapture(e.pointerId); } catch { /* pointer may already be inactive */ }
    } else if (kind === "up") {
      try { this.canvas.releasePointerCapture(e.pointerId); } catch { /* pointer may already be released */ }
    }
    const rect = this.canvas.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) return;
    const rx = (e.clientX - rect.left) / rect.width;
    const ry = (e.clientY - rect.top) / rect.height;
    const cx = Math.max(0, Math.min(1, rx));
    const cy = Math.max(0, Math.min(1, ry));

    // Mouse / pen — unchanged button-index behavior.
    this.ci.sendMouseMotion(cx, cy);
    if (kind === "move") {
      this.ci.sendMouseSync();
      return;
    }
    // Browser MouseEvent.button -> DOSBox button index:
    // browser 0 = left, 1 = middle, 2 = right
    // DOSBox  0 = left, 1 = right,  2 = middle
    const button = e.button === 2 ? 1 : e.button === 1 ? 2 : 0;
    this.ci.sendMouseButton(button, kind === "down");
    this.ci.sendMouseSync();
  }

  // Touch gesture model:
  //  · 1 finger: left button down, drag with motion, release on lift.
  //  · 2 fingers: cancel any left hold and emit a right click (button 1).
  //  · Long press: fallback right click for iOS users who expect it.
  private coordsFromClient(clientX: number, clientY: number): { x: number; y: number } | null {
    const rect = this.canvas.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) return null;
    const rx = (clientX - rect.left) / rect.width;
    const ry = (clientY - rect.top) / rect.height;
    return {
      x: Math.max(0, Math.min(1, rx)),
      y: Math.max(0, Math.min(1, ry)),
    };
  }

  private isInsideCanvas(clientX: number, clientY: number): boolean {
    const rect = this.canvas.getBoundingClientRect();
    return (
      rect.width > 0 &&
      rect.height > 0 &&
      clientX >= rect.left &&
      clientX <= rect.right &&
      clientY >= rect.top &&
      clientY <= rect.bottom
    );
  }

  private handleTouchEvent(e: TouchEvent, kind: "down" | "move" | "up"): void {
    if (kind === "down") this.resumeAudioIfNeeded();
    if (!this.ci) return;
    const touches = Array.from(e.touches);

    if (kind === "down" && touches.length >= 1 && !this.touchStartedOnCanvas) {
      this.touchStartedOnCanvas = this.isInsideCanvas(touches[0].clientX, touches[0].clientY);
    }
    if (!this.touchStartedOnCanvas) return;

    e.preventDefault();
    this.suppressMouseUntil = Date.now() + 700;

    if (kind === "down" && touches.length === 2) {
      this.cancelLongPress();
      const p = this.coordsFromClient(touches[0].clientX, touches[0].clientY);
      if (!p) return;
      if (this.leftTouchDown) this.releaseLeftTouch();
      if (this.rightTouchActive) return;
      this.rightTouchActive = true;
      this.touchMoved = true;
      this.emitRightClick(p.x, p.y);
      return;
    }

    if (kind === "move") {
      if (touches.length !== 1 || this.rightTouchActive) return;
      const p = this.coordsFromClient(touches[0].clientX, touches[0].clientY);
      if (!p) return;
      const dist = Math.abs(p.x - this.longPressStart.x) + Math.abs(p.y - this.longPressStart.y);
      if (dist > 0.02) {
        this.cancelLongPress();
        this.touchMoved = true;
        if (!this.leftTouchDown) {
          this.ci.sendMouseMotion(this.longPressStart.x, this.longPressStart.y);
          this.ci.sendMouseButton(0, true);
          this.ci.sendMouseSync();
          this.leftTouchDown = true;
        }
      }
      if (!this.leftTouchDown) return;
      this.ci.sendMouseMotion(p.x, p.y);
      this.ci.sendMouseSync();
      return;
    }

    if (kind === "up") {
      if (touches.length === 0) {
        this.cancelLongPress();
        if (this.leftTouchDown) this.releaseLeftTouch();
        else if (!this.rightTouchActive && !this.touchMoved) {
          const touch = e.changedTouches[0];
          if (touch) {
            const p = this.coordsFromClient(touch.clientX, touch.clientY);
            if (p) this.emitLeftClick(p.x, p.y);
          }
        }
        this.rightTouchActive = false;
        this.touchStartedOnCanvas = false;
        this.touchMoved = false;
      }
      return;
    }

    if (kind === "down" && touches.length === 1 && !this.leftTouchDown && !this.rightTouchActive) {
      const p = this.coordsFromClient(touches[0].clientX, touches[0].clientY);
      if (!p) return;
      this.longPressStart = p;
      this.ci.sendMouseMotion(p.x, p.y);
      this.ci.sendMouseSync();
      this.touchMoved = false;
      this.longPressTimer = setTimeout(() => {
        if (this.rightTouchActive || this.leftTouchDown || this.touchMoved) return;
        this.rightTouchActive = true;
        this.touchMoved = true;
        this.emitRightClick(p.x, p.y);
      }, 550);
    }
  }

  private cancelLongPress(): void {
    if (!this.longPressTimer) return;
    clearTimeout(this.longPressTimer);
    this.longPressTimer = null;
  }

  private releaseLeftTouch(): void {
    const ci = this.ci;
    if (!ci || !this.leftTouchDown) return;
    ci.sendMouseButton(0, false);
    ci.sendMouseSync();
    this.leftTouchDown = false;
  }

  private emitRightClick(x: number, y: number): void {
    this.emitClick(1, x, y);
  }

  private emitLeftClick(x: number, y: number): void {
    this.emitClick(0, x, y);
  }

  private emitClick(button: number, x: number, y: number): void {
    const ci = this.ci;
    if (!ci) return;
    ci.sendMouseMotion(x, y);
    ci.sendMouseButton(button, true);
    ci.sendMouseSync();
    const timer = setTimeout(() => {
      this.clickReleaseTimers.delete(timer);
      if (!this.ci) return;
      this.ci.sendMouseButton(button, false);
      this.ci.sendMouseSync();
    }, 60);
    this.clickReleaseTimers.add(timer);
  }

  // ── Public API (used by VirtualKeyboard) ─────────────────────────
  sendKeyDown(scancode: number): void { this.ci?.sendKeyEvent(scancode, true); }
  sendKeyUp(scancode: number): void { this.ci?.sendKeyEvent(scancode, false); }
  sendKeyTap(scancode: number): void { this.ci?.simulateKeyPress(scancode); }

  // Trigger dosbox-x's cycle mapper handlers by name via the backend-event
  // bridge (wdosbox-x.js: "wc-trigger-event" -> _TriggerEventByName).
  // No key-event injection needed. Step size = conf cycleup/cycledown.
  cyclesUp(): void {
    this.ci?.sendBackendEvent({ type: "wc-trigger-event", event: "hand_cycleup" });
  }
  cyclesDown(): void {
    this.ci?.sendBackendEvent({ type: "wc-trigger-event", event: "hand_cycledown" });
  }

  get commandInterface(): CommandInterface | null { return this.ci; }

  async destroy(): Promise<void> {
    this.exiting = true;
    if (this.rafId !== 0) {
      cancelAnimationFrame(this.rafId);
      this.rafId = 0;
    }
    this.cancelLongPress();
    for (const timer of this.clickReleaseTimers) clearTimeout(timer);
    this.clickReleaseTimers.clear();
    this.pendingBuf = null;
    window.removeEventListener("keydown", this.onKeyDown);
    window.removeEventListener("keyup", this.onKeyUp);
    this.canvas.removeEventListener("pointerdown", this.onPointerDown);
    this.canvas.removeEventListener("pointermove", this.onPointerMove);
    this.canvas.removeEventListener("pointerup", this.onPointerUp);
    this.canvas.removeEventListener("pointercancel", this.onPointerUp);
    window.removeEventListener("touchstart", this.onTouchStart, true);
    window.removeEventListener("touchmove", this.onTouchMove, true);
    window.removeEventListener("touchend", this.onTouchEnd, true);
    window.removeEventListener("touchcancel", this.onTouchEnd, true);
    this.canvas.removeEventListener("contextmenu", this.onContextMenu);
    if (this.gestureUnlock) {
      window.removeEventListener("pointerdown", this.gestureUnlock, true);
      window.removeEventListener("keydown", this.gestureUnlock, true);
      this.gestureUnlock = null;
    }
    if (this.ci) {
      try { await this.ci.exit(); } catch { /* ignore */ }
      this.ci = null;
    }
    if (this.audioNode) {
      try { this.audioNode.port.postMessage({ type: "reset" }); } catch { /* ignore */ }
      try { this.audioNode.disconnect(); } catch { /* ignore */ }
      this.audioNode = null;
    }
    if (this.audioCtx) {
      try { await this.audioCtx.close(); } catch { /* ignore */ }
      this.audioCtx = null;
    }
    const gl = this.gl;
    if (this.tex) { gl.deleteTexture(this.tex); this.tex = null; }
    if (this.quadBuf) { gl.deleteBuffer(this.quadBuf); this.quadBuf = null; }
    if (this.program) { gl.deleteProgram(this.program); this.program = null; }
  }
}
