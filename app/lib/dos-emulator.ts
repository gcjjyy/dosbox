// app/lib/dos-emulator.ts
//
// Thin glue on top of the `emulators` WASM bridge. Owns the canvas
// rendering loop, Web Audio output, physical keyboard forwarding, and
// pointer-based mouse forwarding. Virtual keyboard calls in via
// sendKeyDown/Up. No React, no js-dos UI.

import { keymap } from "./dos-keymap";
import { PROCESSOR_NAME, createWorkletModuleUrl } from "./dos-audio-worklet";

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

interface BackendOptions {
  onExtractProgress?: (bundleIndex: number, file: string, extracted: number, total: number) => void;
}

interface EmulatorsGlobal {
  pathPrefix: string;
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

  private readonly onKeyDown: (e: KeyboardEvent) => void;
  private readonly onKeyUp: (e: KeyboardEvent) => void;
  private readonly onPointerDown: (e: PointerEvent) => void;
  private readonly onPointerMove: (e: PointerEvent) => void;
  private readonly onPointerUp: (e: PointerEvent) => void;
  private gestureUnlock: ((e: Event) => void) | null = null;

  constructor(opts: DosEmulatorOpts) {
    this.opts = opts;
    this.canvas = opts.canvas;
    const gl = this.canvas.getContext("webgl", {
      alpha: false,
      antialias: false,
      preserveDrawingBuffer: false,
    });
    if (!gl) throw new Error("webgl context unavailable");
    this.gl = gl;
    // Keep the CSS hint: when the canvas is upscaled by the compositor
    // beyond its framebuffer, the browser will do a nearest-neighbor blit.
    this.canvas.style.imageRendering = "pixelated";
    this.setupGL();

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
    const onExtract = this.opts.onExtractProgress;
    const initFs = this.opts.overlay
      ? [this.opts.bundle, this.opts.overlay]
      : [this.opts.bundle];
    const ci = await emu.dosboxXDirect(initFs, onExtract ? {
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
    // Pull-based pipeline: AudioWorkletNode owns a ring buffer on the audio
    // thread; main thread just posts Float32Array chunks via the node's port.
    // This replaces the old per-chunk createBufferSource + future-schedule
    // pattern, which was dropping nearly all chunks on mobile because the
    // 10ms MAX_LEAD cap couldn't survive Worker→main-thread postMessage
    // jitter. Matches the upstream js-dos pipeline (ring buffer + onaudio
    // process) but uses the modern AudioWorklet API.
    const sampleRate = ci.soundFrequency();
    if (sampleRate > 0) {
      // latencyHint: 'interactive' matches js-dos and gives the platform
      // permission to pick a small device buffer. Safari (<14.5) historically
      // exposed AudioContext as webkitAudioContext only — fall back if needed
      // even though current iOS Safari supports the standard name.
      const Ctor: typeof AudioContext | undefined =
        typeof AudioContext !== "undefined"
          ? AudioContext
          : (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (Ctor) {
        try {
          try {
            this.audioCtx = new Ctor({ sampleRate, latencyHint: "interactive" });
          } catch {
            // Some browsers reject specific sampleRate values; fall back to default.
            this.audioCtx = new Ctor({ latencyHint: "interactive" });
          }

          // AudioWorklet was shipped everywhere by Safari 14.5 (2021). If a
          // visitor's browser is older, fall through to no-audio rather than
          // crash the boot — they still get a playable but silent emulator.
          if (!this.audioCtx.audioWorklet) {
            throw new Error("AudioWorklet unsupported");
          }

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

          // Load the processor module via Blob URL — no static asset, no build
          // plugin. Revoke the URL once addModule resolves; the worklet code is
          // already parsed and registered by then.
          const moduleUrl = createWorkletModuleUrl();
          try {
            await this.audioCtx.audioWorklet.addModule(moduleUrl);
          } finally {
            URL.revokeObjectURL(moduleUrl);
          }
          if (this.exiting) return;

          this.audioNode = new AudioWorkletNode(this.audioCtx, PROCESSOR_NAME, {
            numberOfInputs: 0,
            numberOfOutputs: 1,
            outputChannelCount: [1],
          });
          this.audioNode.connect(this.audioCtx.destination);

          events.onSoundPush((samples) => this.pushAudio(samples));
        } catch (err) {
          // Audio init failure must never break the emulator — video + input
          // are independent. Log and continue silently.
          console.warn("[dos-emulator] audio init failed; running without sound:", err);
          if (this.audioCtx) {
            try { await this.audioCtx.close(); } catch { /* ignore */ }
            this.audioCtx = null;
          }
          this.audioNode = null;
        }
      }
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
    // NEAREST keeps DOS pixels crisp; CSS image-rendering: pixelated handles
    // any further upscale the compositor applies.
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
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
    // Defensive copy: the WASM bridge reuses this buffer between callbacks.
    // Transfer the copy's ArrayBuffer to the audio thread so the post is
    // zero-copy. Backpressure (queue cap, prime delay before suspended
    // context resumes, underrun handling) all lives in the worklet.
    const copy = new Float32Array(samples);
    node.port.postMessage(copy, [copy.buffer]);
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
    if (this.rafId !== 0) {
      cancelAnimationFrame(this.rafId);
      this.rafId = 0;
    }
    this.pendingBuf = null;
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
