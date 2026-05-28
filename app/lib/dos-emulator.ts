// app/lib/dos-emulator.ts
//
// Browser glue for our self-built DOSBox 0.74-3 WASM runtime. It loads the
// generated Emscripten module, mounts the DOS archive into MEMFS, injects a
// separately served dosbox.conf, and forwards keyboard/mouse/audio events.

import { unzip, zipSync } from "fflate";
import { version } from "../../package.json";
import { PROCESSOR_NAME, WORKLET_URL } from "./dos-audio-worklet";

const RUNTIME_VERSION = encodeURIComponent(version);
const DOSBOX_SCRIPT_URL = `/wasm/dosbox0743.js?v=${RUNTIME_VERSION}`;
const DOSBOX_WASM_URL = `/wasm/dosbox0743.wasm?v=${RUNTIME_VERSION}`;
const AUDIO_RATE = 44100;

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
  onExit: (fn: () => void) => void;
}

interface DosboxFS {
  mkdir: (path: string) => void;
  mkdirTree?: (path: string) => void;
  writeFile: (path: string, data: Uint8Array | string) => void;
  readFile: (path: string) => Uint8Array;
  readdir: (path: string) => string[];
  stat: (path: string) => { mode: number };
  isDir: (mode: number) => boolean;
  isFile: (mode: number) => boolean;
}

interface DosboxModule {
  FS: DosboxFS;
  HEAPF32: Float32Array;
  SDL?: {
    audioContext?: AudioContext;
    openAudioContext?: () => void;
    audio?: {
      queueNewAudioData?: () => void;
    };
  };
  ccall: (name: string, returnType: string | null, argTypes: string[], args: unknown[]) => unknown;
  callMain: (args?: string[]) => void;
}

interface DosboxModuleOptions {
  canvas: HTMLCanvasElement;
  noInitialRun: boolean;
  noExitRuntime: boolean;
  SDL_numSimultaneouslyQueuedBuffers?: number;
  webgl2DPresentation?: boolean;
  canvas2DContextAttributes?: CanvasRenderingContext2DSettings;
  locateFile: (path: string) => string;
  print?: (text: string) => void;
  printErr?: (text: string) => void;
  onAbort?: (reason: unknown) => void;
  onFrame?: (ptr: number, width: number, height: number, stride: number) => void;
  onAudio?: (ptr: number, samples: number, rate: number) => void;
}

type DosboxFactory = (opts: DosboxModuleOptions) => Promise<DosboxModule>;

declare global {
  interface Window {
    createDosbox?: DosboxFactory;
    webkitAudioContext?: typeof AudioContext;
  }
}

let dosboxFactoryPromise: Promise<DosboxFactory> | null = null;

function waitForAudioRunning(ctx: AudioContext, timeoutMs: number): Promise<boolean> {
  return new Promise((resolve) => {
    if (ctx.state === "running") return resolve(true);
    const startedAt = Date.now();
    const done = (ok: boolean) => {
      ctx.removeEventListener("statechange", onChange);
      resolve(ok);
    };
    const onChange = () => {
      if (ctx.state === "running") done(true);
    };
    const tick = () => {
      if (ctx.state === "running") return done(true);
      if (ctx.state === "closed") return done(false);
      if (Date.now() - startedAt >= timeoutMs) return done(false);
      setTimeout(tick, 50);
    };
    ctx.addEventListener("statechange", onChange);
    setTimeout(tick, 50);
  });
}

function withTimeout<T>(p: Promise<T>, ms: number, label: string): Promise<T> {
  return Promise.race([
    p,
    new Promise<T>((_, reject) =>
      setTimeout(() => reject(new Error(`${label} timeout ${ms}ms`)), ms),
    ),
  ]);
}

function yieldToBrowser(): Promise<void> {
  return new Promise((resolve) => {
    if (typeof requestAnimationFrame === "function") {
      requestAnimationFrame(() => setTimeout(resolve, 0));
    } else {
      setTimeout(resolve, 0);
    }
  });
}

function unzipArchive(zipBytes: Uint8Array): Promise<Record<string, Uint8Array>> {
  return new Promise((resolve, reject) => {
    unzip(zipBytes, (err, entries) => {
      if (err) reject(err);
      else resolve(entries ?? {});
    });
  });
}

function resampleInterleaved(input: Float32Array, channels: number, ratio: number): Float32Array {
  if (Math.abs(ratio - 1) < 0.001) return new Float32Array(input);
  const frames = Math.floor(input.length / channels);
  const outFrames = Math.max(1, Math.round(frames * ratio));
  const out = new Float32Array(outFrames * channels);
  const invRatio = frames / outFrames;
  const lastFrame = frames - 1;
  for (let frame = 0; frame < outFrames; frame++) {
    const srcPos = frame * invRatio;
    const srcFrame = Math.floor(srcPos);
    const frac = srcPos - srcFrame;
    const aFrame = Math.min(srcFrame, lastFrame);
    const bFrame = Math.min(srcFrame + 1, lastFrame);
    for (let ch = 0; ch < channels; ch++) {
      const a = input[aFrame * channels + ch] ?? 0;
      const b = input[bFrame * channels + ch] ?? a;
      out[frame * channels + ch] = a + (b - a) * frac;
    }
  }
  return out;
}

function loadDosboxFactory(): Promise<DosboxFactory> {
  if (window.createDosbox) return Promise.resolve(window.createDosbox);
  if (!dosboxFactoryPromise) {
    dosboxFactoryPromise = new Promise((resolve, reject) => {
      const script = document.createElement("script");
      script.src = DOSBOX_SCRIPT_URL;
      script.async = true;
      script.onload = () => {
        if (window.createDosbox) resolve(window.createDosbox);
        else reject(new Error("createDosbox was not registered by dosbox0743.js"));
      };
      script.onerror = () => reject(new Error(`failed to load ${DOSBOX_SCRIPT_URL}`));
      document.head.appendChild(script);
    });
  }
  return dosboxFactoryPromise;
}

export function preloadDosboxRuntime(): Promise<void> {
  return loadDosboxFactory().then(() => undefined);
}

function normalizeZipName(name: string): string | null {
  const rel = name.replace(/\\/g, "/").replace(/^\/+/, "");
  if (!rel || rel.endsWith("/")) return null;
  if (rel.split("/").some((part) => part === ".." || part === "" || part.startsWith("."))) return null;
  return rel;
}

function arraysEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) return false;
  }
  return true;
}

function toSDLMouseButton(button: number): number {
  if (button === 1) return 3;
  if (button === 2) return 2;
  return 1;
}

interface DomKeyInfo {
  keyCode: number;
  key: string;
  code: string;
  location?: number;
  charCode?: number;
}

function toDOMKeyInfo(code: number): DomKeyInfo | null {
  if (code >= 65 && code <= 90) {
    const ch = String.fromCharCode(code);
    return { keyCode: code, key: ch.toLowerCase(), code: `Key${ch}`, charCode: code + 32 };
  }
  if (code >= 48 && code <= 57) {
    const ch = String.fromCharCode(code);
    return { keyCode: code, key: ch, code: `Digit${ch}`, charCode: code };
  }
  if (code >= 290 && code <= 301) {
    const n = code - 289;
    return { keyCode: 111 + n, key: `F${n}`, code: `F${n}` };
  }
  if (code >= 320 && code <= 329) {
    const n = code - 320;
    return { keyCode: 96 + n, key: String(n), code: `Numpad${n}`, location: 3, charCode: 48 + n };
  }
  const map: Record<number, DomKeyInfo> = {
    32: { keyCode: 32, key: " ", code: "Space", charCode: 32 },
    39: { keyCode: 222, key: "'", code: "Quote", charCode: 39 },
    44: { keyCode: 188, key: ",", code: "Comma", charCode: 44 },
    45: { keyCode: 189, key: "-", code: "Minus", charCode: 45 },
    46: { keyCode: 190, key: ".", code: "Period", charCode: 46 },
    47: { keyCode: 191, key: "/", code: "Slash", charCode: 47 },
    59: { keyCode: 186, key: ";", code: "Semicolon", charCode: 59 },
    61: { keyCode: 187, key: "=", code: "Equal", charCode: 61 },
    91: { keyCode: 219, key: "[", code: "BracketLeft", charCode: 91 },
    92: { keyCode: 220, key: "\\", code: "Backslash", charCode: 92 },
    93: { keyCode: 221, key: "]", code: "BracketRight", charCode: 93 },
    96: { keyCode: 192, key: "`", code: "Backquote", charCode: 96 },
    256: { keyCode: 27, key: "Escape", code: "Escape" },
    257: { keyCode: 13, key: "Enter", code: "Enter" },
    258: { keyCode: 9, key: "Tab", code: "Tab" },
    259: { keyCode: 8, key: "Backspace", code: "Backspace" },
    260: { keyCode: 45, key: "Insert", code: "Insert" },
    261: { keyCode: 46, key: "Delete", code: "Delete" },
    262: { keyCode: 39, key: "ArrowRight", code: "ArrowRight" },
    263: { keyCode: 37, key: "ArrowLeft", code: "ArrowLeft" },
    264: { keyCode: 40, key: "ArrowDown", code: "ArrowDown" },
    265: { keyCode: 38, key: "ArrowUp", code: "ArrowUp" },
    266: { keyCode: 33, key: "PageUp", code: "PageUp" },
    267: { keyCode: 34, key: "PageDown", code: "PageDown" },
    268: { keyCode: 36, key: "Home", code: "Home" },
    269: { keyCode: 35, key: "End", code: "End" },
    280: { keyCode: 20, key: "CapsLock", code: "CapsLock" },
    281: { keyCode: 145, key: "ScrollLock", code: "ScrollLock" },
    282: { keyCode: 144, key: "NumLock", code: "NumLock" },
    330: { keyCode: 110, key: ".", code: "NumpadDecimal", location: 3, charCode: 46 },
    331: { keyCode: 111, key: "/", code: "NumpadDivide", location: 3, charCode: 47 },
    332: { keyCode: 106, key: "*", code: "NumpadMultiply", location: 3, charCode: 42 },
    333: { keyCode: 109, key: "-", code: "NumpadSubtract", location: 3, charCode: 45 },
    334: { keyCode: 107, key: "+", code: "NumpadAdd", location: 3, charCode: 43 },
    335: { keyCode: 13, key: "Enter", code: "NumpadEnter", location: 3 },
    340: { keyCode: 16, key: "Shift", code: "ShiftLeft", location: 1 },
    341: { keyCode: 17, key: "Control", code: "ControlLeft", location: 1 },
    342: { keyCode: 18, key: "Alt", code: "AltLeft", location: 1 },
    344: { keyCode: 16, key: "Shift", code: "ShiftRight", location: 2 },
    345: { keyCode: 17, key: "Control", code: "ControlRight", location: 2 },
    346: { keyCode: 18, key: "Alt", code: "AltRight", location: 2 },
  };
  return map[code] ?? null;
}

function dispatchKeyboard(type: "keydown" | "keyup" | "keypress", info: DomKeyInfo): void {
  const charCode = type === "keypress" ? (info.charCode ?? info.keyCode) : 0;
  const event = new KeyboardEvent(type, {
    bubbles: true,
    cancelable: true,
    key: info.key,
    code: info.code,
    location: info.location ?? 0,
  });
  Object.defineProperties(event, {
    keyCode: { get: () => info.keyCode },
    which: { get: () => type === "keypress" ? charCode : info.keyCode },
    charCode: { get: () => charCode },
    location: { get: () => info.location ?? 0 },
  });
  document.dispatchEvent(event);
}

class EventHub implements CommandInterfaceEvents {
  private frameFns: Array<(rgb: Uint8Array | null, rgba: Uint8Array | null) => void> = [];
  private frameSizeFns: Array<(w: number, h: number) => void> = [];
  private exitFns: Array<() => void> = [];

  onFrame(fn: (rgb: Uint8Array | null, rgba: Uint8Array | null) => void): void { this.frameFns.push(fn); }
  onFrameSize(fn: (w: number, h: number) => void): void { this.frameSizeFns.push(fn); }
  onExit(fn: () => void): void { this.exitFns.push(fn); }

  emitFrameSize(w: number, h: number): void { for (const fn of this.frameSizeFns) fn(w, h); }
  emitFrame(): void { for (const fn of this.frameFns) fn(null, null); }
  emitExit(): void { for (const fn of this.exitFns) fn(); }
}

export interface DosEmulatorOpts {
  canvas: HTMLCanvasElement;
  bundle: Uint8Array;
  config: string;
  displayWidth?: number | null;
  displayHeight?: number | null;
  overlay?: Uint8Array | null;
  onReady?: (ci: CommandInterface) => void;
  onFirstFrame?: () => void;
  onError?: (err: unknown) => void;
  onRuntimeReady?: () => void;
  onExtractProgress?: (fraction: number) => void;
}

export class DosEmulator {
  private opts: DosEmulatorOpts;
  private canvas: HTMLCanvasElement;
  private module: DosboxModule | null = null;
  private ci: CommandInterface | null = null;
  private events = new EventHub();
  private audioCtx: AudioContext | null = null;
  private audioNode: AudioWorkletNode | null = null;
  private audioSourceRate = AUDIO_RATE;
  private audioUnlocking = false;
  private audioChannels = 2;
  private resampleRatio = 1;
  private firstFrame = false;
  private exiting = false;
  private baseline = new Map<string, Uint8Array>();

  private leftTouchDown = false;
  private rightTouchActive = false;
  private longPressTimer: ReturnType<typeof setTimeout> | null = null;
  private longPressStart = { x: 0.5, y: 0.5 };
  private suppressMouseUntil = 0;
  private touchStartedOnCanvas = false;
  private touchMoved = false;
  private clickReleaseTimers = new Set<ReturnType<typeof setTimeout>>();

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
    this.canvas.style.imageRendering = "auto";
    this.applyDisplaySize();

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
    const factory = await loadDosboxFactory();
    let module!: DosboxModule;
    module = await factory({
      canvas: this.canvas,
      noInitialRun: true,
      noExitRuntime: true,
      SDL_numSimultaneouslyQueuedBuffers: 2,
      webgl2DPresentation: true,
      canvas2DContextAttributes: {
        alpha: false,
        desynchronized: false,
        willReadFrequently: true,
      },
      locateFile: (file) => file.endsWith(".wasm") ? DOSBOX_WASM_URL : `/wasm/${file}`,
      print: (text) => console.log("[dosbox]", text),
      printErr: (text) => console.warn("[dosbox]", text),
      onAbort: (reason) => this.opts.onError?.(reason),
      onFrame: (_ptr, width, height) => this.handleFrame(width, height),
      onAudio: (ptr, samples, rate) => this.handleAudio(module, ptr, samples, rate),
    });
    if (this.exiting) return;
    this.module = module;
    this.opts.onRuntimeReady?.();

    await this.mountDrive(module, this.opts.bundle, 0, 0.8);
    if (this.exiting) return;
    if (this.opts.overlay) await this.mountDrive(module, this.opts.overlay, 0.8, 0.15);
    if (this.exiting) return;
    module.FS.writeFile("/dosbox.conf", this.opts.config);
    this.opts.onExtractProgress?.(0.98);
    await yieldToBrowser();
    this.baseline = await this.snapshotDriveAsync(module);
    if (this.exiting) return;
    this.opts.onExtractProgress?.(1);

    this.ci = this.createCommandInterface(module);
    this.attachListeners();
    this.setupAudioUnlock();
    module.callMain(["-conf", "/dosbox.conf"]);
    this.opts.onReady?.(this.ci);
  }

  private createCommandInterface(module: DosboxModule): CommandInterface {
    return {
      exit: async () => {
        module.ccall("exit_dosbox", null, [], []);
        this.events.emitExit();
      },
      soundFrequency: () => AUDIO_RATE,
      simulateKeyPress: (...keyCodes: number[]) => {
        for (const code of keyCodes) {
          this.sendKey(code, true);
          this.sendKey(code, false);
        }
      },
      sendKeyEvent: (keyCode, pressed) => this.sendKey(keyCode, pressed),
      sendMouseMotion: (x, y) => {
        const px = Math.round(Math.max(0, Math.min(1, x)) * Math.max(1, this.canvas.width));
        const py = Math.round(Math.max(0, Math.min(1, y)) * Math.max(1, this.canvas.height));
        module.ccall("send_mouse_motion", null, ["number", "number"], [px, py]);
      },
      sendMouseRelativeMotion: (_x, _y) => undefined,
      sendMouseButton: (button, pressed) => {
        module.ccall("send_mouse_button", null, ["number", "number"], [toSDLMouseButton(button), pressed ? 1 : 0]);
      },
      sendMouseSync: () => undefined,
      persist: async () => this.persistDrive(module),
      sendBackendEvent: () => undefined,
      events: () => this.events,
    };
  }

  private sendKey(code: number, pressed: boolean): void {
    const info = toDOMKeyInfo(code);
    if (!info) return;
    dispatchKeyboard(pressed ? "keydown" : "keyup", info);
    if (pressed && info.charCode) dispatchKeyboard("keypress", info);
  }

  private async mountDrive(module: DosboxModule, zipBytes: Uint8Array, progressBase: number, progressSpan: number): Promise<void> {
    this.ensureDir(module, "/c");
    this.opts.onExtractProgress?.(progressBase);
    await yieldToBrowser();
    const entries = await unzipArchive(zipBytes);
    if (this.exiting) return;
    this.opts.onExtractProgress?.(progressBase + progressSpan * 0.08);
    await yieldToBrowser();

    const files: Array<[string, Uint8Array]> = [];
    for (const [name, data] of Object.entries(entries)) {
      const rel = normalizeZipName(name);
      if (rel) files.push([rel, data]);
    }
    const total = Math.max(1, files.length);
    let lastYield = performance.now();
    for (let idx = 0; idx < files.length; idx++) {
      if (this.exiting) return;
      const [rel, data] = files[idx];
      const dest = `/c/${rel}`;
      const slash = dest.lastIndexOf("/");
      if (slash > 0) this.ensureDir(module, dest.slice(0, slash));
      module.FS.writeFile(dest, data);
      const written = idx + 1;
      const fraction = 0.08 + 0.9 * (written / total);
      this.opts.onExtractProgress?.(progressBase + progressSpan * fraction);
      const now = performance.now();
      if (written === total || written % 8 === 0 || now - lastYield > 12) {
        await yieldToBrowser();
        lastYield = performance.now();
      }
    }
  }

  private ensureDir(module: DosboxModule, dir: string): void {
    if (module.FS.mkdirTree) {
      try { module.FS.mkdirTree(dir); return; } catch { /* fall through */ }
    }
    let cur = "";
    for (const part of dir.split("/")) {
      if (!part) continue;
      cur += `/${part}`;
      try { module.FS.mkdir(cur); } catch { /* already exists */ }
    }
  }

  private async snapshotDriveAsync(module: DosboxModule): Promise<Map<string, Uint8Array>> {
    const out = new Map<string, Uint8Array>();
    let visited = 0;
    const rec = async (dir: string, relDir: string): Promise<void> => {
      for (const name of module.FS.readdir(dir)) {
        if (name === "." || name === "..") continue;
        const abs = `${dir}/${name}`;
        const rel = relDir ? `${relDir}/${name}` : name;
        const st = module.FS.stat(abs);
        if (module.FS.isDir(st.mode)) {
          await rec(abs, rel);
        } else if (module.FS.isFile(st.mode)) {
          out.set(rel, new Uint8Array(module.FS.readFile(abs)));
        }
        visited++;
        if (visited % 32 === 0) await yieldToBrowser();
        if (this.exiting) return;
      }
    };
    await rec("/c", "");
    return out;
  }

  private readDrive(module: DosboxModule): Array<[string, Uint8Array]> {
    const files: Array<[string, Uint8Array]> = [];
    const rec = (dir: string, relDir: string) => {
      for (const name of module.FS.readdir(dir)) {
        if (name === "." || name === "..") continue;
        const abs = `${dir}/${name}`;
        const rel = relDir ? `${relDir}/${name}` : name;
        const st = module.FS.stat(abs);
        if (module.FS.isDir(st.mode)) rec(abs, rel);
        else if (module.FS.isFile(st.mode)) files.push([rel, new Uint8Array(module.FS.readFile(abs))]);
      }
    };
    rec("/c", "");
    return files;
  }

  private persistDrive(module: DosboxModule): Uint8Array | null {
    const changed: Record<string, Uint8Array> = {};
    for (const [rel, bytes] of this.readDrive(module)) {
      const base = this.baseline.get(rel);
      if (!base || !arraysEqual(base, bytes)) changed[rel] = bytes;
    }
    const names = Object.keys(changed);
    if (names.length === 0) return null;
    return zipSync(changed);
  }

  private handleFrame(width: number, height: number): void {
    if (width > 0 && height > 0 && (this.canvas.width !== width || this.canvas.height !== height)) {
      this.canvas.width = width;
      this.canvas.height = height;
      this.events.emitFrameSize(width, height);
    }
    this.applyDisplaySize();
    this.events.emitFrame();
    if (!this.firstFrame) {
      this.firstFrame = true;
      this.opts.onFirstFrame?.();
    }
  }

  private handleAudio(module: DosboxModule, ptr: number, samples: number, rate: number): void {
    if (rate > 0) this.audioSourceRate = rate;
    const channels = samples > 1 && samples % 2 === 0 ? 2 : 1;
    this.audioChannels = channels;
    const totalSamples = Math.floor(samples / channels) * channels;
    if (totalSamples <= 0) return;
    const start = ptr >> 2;
    const copy = new Float32Array(module.HEAPF32.subarray(start, start + totalSamples));
    this.pushAudio(copy, channels);
  }

  private setupAudioUnlock(): void {
    const unlock = () => {
      void this.unlockAudio().catch((err) => console.warn("[dos-emulator] audio unlock failed:", err));
    };
    this.gestureUnlock = unlock;
    window.addEventListener("pointerdown", unlock, true);
    window.addEventListener("mousedown", unlock, true);
    window.addEventListener("touchstart", unlock, true);
    window.addEventListener("keydown", unlock, true);
    window.addEventListener("click", unlock, true);

    const activation = (navigator as Navigator & { userActivation?: { hasBeenActive?: boolean; isActive?: boolean } }).userActivation;
    if (activation?.hasBeenActive || activation?.isActive) unlock();
  }

  private removeAudioUnlockListeners(): void {
    if (!this.gestureUnlock) return;
    window.removeEventListener("pointerdown", this.gestureUnlock, true);
    window.removeEventListener("mousedown", this.gestureUnlock, true);
    window.removeEventListener("touchstart", this.gestureUnlock, true);
    window.removeEventListener("keydown", this.gestureUnlock, true);
    window.removeEventListener("click", this.gestureUnlock, true);
    this.gestureUnlock = null;
  }

  private pushAudio(samples: Float32Array, channels: number): void {
    const node = this.audioNode;
    if (!node || samples.length === 0) return;
    const toSend = resampleInterleaved(samples, channels, this.resampleRatio);
    node.port.postMessage({ type: "audio", samples: toSend, channels }, [toSend.buffer]);
  }

  private async setupAudio(sourceRate: number): Promise<void> {
    if (this.audioCtx || this.exiting) return;
    const Ctor: typeof AudioContext | undefined =
      typeof AudioContext !== "undefined" ? AudioContext : window.webkitAudioContext;
    if (!Ctor) throw new Error("AudioContext unavailable");

    try {
      this.audioCtx = new Ctor({ sampleRate: sourceRate });
    } catch {
      this.audioCtx = new Ctor();
    }
    this.resampleRatio = this.audioCtx.sampleRate / sourceRate;
    this.audioCtx.addEventListener("statechange", this.resumeAudioIfNeeded);
    if (!this.audioCtx.audioWorklet || typeof this.audioCtx.audioWorklet.addModule !== "function") {
      throw new Error("AudioWorklet API missing");
    }

    void this.audioCtx.resume().catch(() => undefined);
    await waitForAudioRunning(this.audioCtx, 2000);
    await withTimeout(this.audioCtx.audioWorklet.addModule(WORKLET_URL), 6000, "addModule");
    if (this.exiting) return;

    try {
      this.audioNode = new AudioWorkletNode(this.audioCtx, PROCESSOR_NAME, {
        numberOfInputs: 0,
        numberOfOutputs: 1,
        outputChannelCount: [this.audioChannels],
      });
    } catch {
      this.audioNode = new AudioWorkletNode(this.audioCtx, PROCESSOR_NAME, {
        numberOfInputs: 0,
        numberOfOutputs: 1,
      });
    }
    this.audioNode.connect(this.audioCtx.destination);
    void this.audioCtx.resume().catch(() => undefined);
    await waitForAudioRunning(this.audioCtx, 1500);
  }

  async unlockAudio(): Promise<boolean> {
    if (this.exiting) return false;
    this.focusCanvas();
    if (!this.audioCtx) {
      if (this.audioUnlocking) return false;
      this.audioUnlocking = true;
      try {
        await this.setupAudio(this.audioSourceRate || AUDIO_RATE);
      } finally {
        this.audioUnlocking = false;
      }
    } else if (this.audioCtx.state !== "running" && this.audioCtx.state !== "closed") {
      void this.audioCtx.resume().catch(() => undefined);
    }

    const sdl = this.module?.SDL;
    if (!sdl?.audioContext) sdl?.openAudioContext?.();
    const sdlCtx = sdl?.audioContext;
    if (sdlCtx && sdlCtx.state !== "running" && sdlCtx.state !== "closed") {
      void sdlCtx.resume().catch(() => undefined);
    }
    sdl?.audio?.queueNewAudioData?.();

    const ctx = this.audioCtx;
    if (!ctx || ctx.state === "closed") return false;
    const running = await waitForAudioRunning(ctx, 1200);
    if (ctx.state === "running") this.removeAudioUnlockListeners();
    return running;
  }

  isAudioRunning(): boolean {
    return this.audioCtx?.state === "running";
  }

  private applyDisplaySize(): void {
    const width = this.opts.displayWidth;
    const height = this.opts.displayHeight;
    if (width != null && height != null) {
      this.canvas.style.setProperty("width", `${width}px`, "important");
      this.canvas.style.setProperty("height", `${height}px`, "important");
    } else {
      this.canvas.style.setProperty("width", "100%", "important");
      this.canvas.style.setProperty("height", "100%", "important");
    }
  }

  private resumeAudioIfNeeded = (): void => {
    const ctx = this.audioCtx;
    if (ctx && ctx.state !== "running" && ctx.state !== "closed") {
      void ctx.resume().catch(() => undefined);
    }
    const sdlCtx = this.module?.SDL?.audioContext ?? null;
    if (sdlCtx && sdlCtx.state !== "running" && sdlCtx.state !== "closed") {
      void sdlCtx.resume().catch(() => undefined);
    }
  };

  private attachListeners(): void {
    this.canvas.addEventListener("pointerdown", this.onPointerDown);
    this.canvas.addEventListener("pointermove", this.onPointerMove);
    this.canvas.addEventListener("pointerup", this.onPointerUp);
    this.canvas.addEventListener("pointercancel", this.onPointerUp);
    window.addEventListener("touchstart", this.onTouchStart, { passive: false, capture: true });
    window.addEventListener("touchmove", this.onTouchMove, { passive: false, capture: true });
    window.addEventListener("touchend", this.onTouchEnd, { passive: false, capture: true });
    window.addEventListener("touchcancel", this.onTouchEnd, { passive: false, capture: true });
    this.canvas.addEventListener("contextmenu", this.onContextMenu);
  }

  private handlePointer(e: PointerEvent, kind: "down" | "move" | "up"): void {
    if (kind === "down") this.resumeAudioIfNeeded();
    if (!this.ci) return;
    if (e.pointerType === "touch" && "TouchEvent" in window) return;
    if (Date.now() < this.suppressMouseUntil) return;
    if (kind === "down") this.focusCanvas();
  }

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

  private focusCanvas(): void {
    try { this.canvas.focus({ preventScroll: true }); } catch { /* ignore */ }
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
      if (this.touchStartedOnCanvas) this.focusCanvas();
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

  sendKeyDown(scancode: number): void { this.ci?.sendKeyEvent(scancode, true); }
  sendKeyUp(scancode: number): void { this.ci?.sendKeyEvent(scancode, false); }
  sendKeyTap(scancode: number): void { this.ci?.simulateKeyPress(scancode); }

  cyclesUp(): void {
    this.ci?.sendKeyEvent(341, true);
    this.ci?.sendKeyEvent(301, true);
    this.ci?.sendKeyEvent(301, false);
    this.ci?.sendKeyEvent(341, false);
  }

  cyclesDown(): void {
    this.ci?.sendKeyEvent(341, true);
    this.ci?.sendKeyEvent(300, true);
    this.ci?.sendKeyEvent(300, false);
    this.ci?.sendKeyEvent(341, false);
  }

  get commandInterface(): CommandInterface | null { return this.ci; }

  async destroy(): Promise<void> {
    this.exiting = true;
    this.cancelLongPress();
    for (const timer of this.clickReleaseTimers) clearTimeout(timer);
    this.clickReleaseTimers.clear();
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
      this.removeAudioUnlockListeners();
    }
    if (this.ci) {
      try { await this.ci.exit(); } catch { /* ignore */ }
      this.ci = null;
    }
    if (this.audioNode) {
      this.audioNode.port.postMessage({ type: "reset" });
      this.audioNode.disconnect();
      this.audioNode = null;
    }
    if (this.audioCtx && this.audioCtx.state !== "closed") {
      this.audioCtx.removeEventListener("statechange", this.resumeAudioIfNeeded);
      try { await this.audioCtx.close(); } catch { /* ignore */ }
    }
    this.audioCtx = null;
    const audioCtx = this.module?.SDL?.audioContext;
    if (audioCtx && audioCtx.state !== "closed") {
      try { await audioCtx.close(); } catch { /* ignore */ }
    }
    this.module = null;
  }
}
