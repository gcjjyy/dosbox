// app/lib/dos-emulator.ts
//
// Browser glue for our self-built DOSBox 0.74-3 WASM runtime. It loads the
// generated Emscripten module, mounts the DOS archive into MEMFS, injects a
// separately served dosbox.conf, and forwards keyboard/mouse/audio events.

import { unzipSync, zipSync } from "fflate";
import { version } from "../../package.json";
import { recoverSDLKeyCodeFromBrokenAsciiEvent, toSDLKeyCode } from "./dos-input";
import { PROCESSOR_NAME, WORKLET_URL } from "./dos-audio-worklet";
import { SingleFlight } from "./single-flight";

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
    defaults?: {
      copyOnLock?: boolean;
      discardOnLock?: boolean;
      opaqueFrontBuffer?: boolean;
    };
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
  keyboardListeningElement?: HTMLElement;
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

function downmixStereoToMono(input: Float32Array): Float32Array {
  const frames = Math.floor(input.length / 2);
  const out = new Float32Array(frames);
  for (let i = 0, j = 0; i < frames; i++, j += 2) {
    out[i] = ((input[j] ?? 0) + (input[j + 1] ?? 0)) * 0.5;
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

interface BaselineEntry {
  size: number;
  crc: number;
}

interface ZipWorkerEntry {
  name: string;
  data: ArrayBuffer;
}

type ZipWorkerMessage =
  | { type: "progress"; id: number; phase: "inflate" | "write"; fraction: number }
  | { type: "batch"; id: number; seq: number; bytes: number; entries: ZipWorkerEntry[] }
  | { type: "done"; id: number }
  | { type: "error"; id: number; message: string };

let crcTable: Uint32Array | null = null;

function getCrcTable(): Uint32Array {
  if (crcTable) return crcTable;
  const table = new Uint32Array(256);
  for (let i = 0; i < 256; i++) {
    let c = i;
    for (let j = 0; j < 8; j++) c = (c & 1) ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1);
    table[i] = c >>> 0;
  }
  crcTable = table;
  return table;
}

function crc32(bytes: Uint8Array): number {
  const table = getCrcTable();
  let crc = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) {
    crc = table[(crc ^ bytes[i]) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function yieldToBrowser(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

function transferableBuffer(bytes: Uint8Array): ArrayBuffer {
  if (bytes.byteOffset === 0 && bytes.byteLength === bytes.buffer.byteLength && bytes.buffer instanceof ArrayBuffer) {
    return bytes.buffer;
  }
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  return copy.buffer;
}

function readU16(bytes: Uint8Array, offset: number): number {
  return bytes[offset] | (bytes[offset + 1] << 8);
}

function readU32(bytes: Uint8Array, offset: number): number {
  return (
    bytes[offset] |
    (bytes[offset + 1] << 8) |
    (bytes[offset + 2] << 16) |
    (bytes[offset + 3] << 24)
  ) >>> 0;
}

function zipBaseline(zipBytes: Uint8Array): Map<string, BaselineEntry> {
  const baseline = new Map<string, BaselineEntry>();
  const min = Math.max(0, zipBytes.length - 65_558);
  let eocd = -1;
  for (let i = zipBytes.length - 22; i >= min; i--) {
    if (readU32(zipBytes, i) === 0x06054b50) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) return baseline;

  const entries = readU16(zipBytes, eocd + 10);
  let offset = readU32(zipBytes, eocd + 16);
  const decoder = new TextDecoder();
  for (let i = 0; i < entries && offset + 46 <= zipBytes.length; i++) {
    if (readU32(zipBytes, offset) !== 0x02014b50) break;
    const crc = readU32(zipBytes, offset + 16);
    const size = readU32(zipBytes, offset + 24);
    const nameLen = readU16(zipBytes, offset + 28);
    const extraLen = readU16(zipBytes, offset + 30);
    const commentLen = readU16(zipBytes, offset + 32);
    const nameStart = offset + 46;
    const nameEnd = nameStart + nameLen;
    const rel = normalizeZipName(decoder.decode(zipBytes.subarray(nameStart, nameEnd)));
    if (rel) baseline.set(rel, { size, crc });
    offset = nameEnd + extraLen + commentLen;
  }
  return baseline;
}

function toSDLMouseButton(button: number): number {
  if (button === 1) return 3;
  if (button === 2) return 2;
  return 1;
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
  onFrameSize?: (width: number, height: number) => void;
  onBeforeStart?: () => void | Promise<void>;
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
  private audioUnlockFlight = new SingleFlight<boolean>();
  private audioSourceRate = AUDIO_RATE;
  private audioChannels = 2;
  private resampleRatio = 1;
  private firstFrame = false;
  private frameWidth = 0;
  private frameHeight = 0;
  private exiting = false;
  private baseline = new Map<string, BaselineEntry>();

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
  private readonly onKeyCapture: (e: KeyboardEvent) => void;
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
    this.onKeyCapture = (e) => this.handleKeyCapture(e);
    this.onContextMenu = (e) => e.preventDefault();

    void this.boot().catch((err) => opts.onError?.(err));
  }

  private async boot(): Promise<void> {
    const factory = await loadDosboxFactory();
    let module!: DosboxModule;
    module = await factory({
      canvas: this.canvas,
      keyboardListeningElement: this.canvas,
      noInitialRun: true,
      noExitRuntime: true,
      SDL_numSimultaneouslyQueuedBuffers: 3,
      webgl2DPresentation: false,
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
    if (module.SDL?.defaults) {
      module.SDL.defaults.copyOnLock = false;
      module.SDL.defaults.discardOnLock = true;
      module.SDL.defaults.opaqueFrontBuffer = true;
    }

    await this.mountDrive(module, this.opts.bundle, 0, 0.8);
    if (this.exiting) return;
    if (this.opts.overlay) await this.mountDrive(module, this.opts.overlay, 0.8, 0.15);
    if (this.exiting) return;
    module.FS.writeFile("/dosbox.conf", this.opts.config);
    this.opts.onExtractProgress?.(1);

    this.ci = this.createCommandInterface(module);
    this.attachListeners();
    this.setupAudioUnlock();
    await this.opts.onBeforeStart?.();
    if (this.exiting) return;
    module.callMain(["-conf", "/dosbox.conf"]);
    this.focusCanvas();
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
    const sdlKeyCode = toSDLKeyCode(code);
    if (sdlKeyCode === null) return;
    this.sendSDLKey(sdlKeyCode, pressed);
  }

  private sendSDLKey(sdlKeyCode: number, pressed: boolean): void {
    this.module?.ccall("send_key", null, ["number", "number"], [sdlKeyCode, pressed ? 1 : 0]);
  }

  private async mountDrive(module: DosboxModule, zipBytes: Uint8Array, progressBase: number, progressSpan: number): Promise<void> {
    this.ensureDir(module, "/c");
    this.opts.onExtractProgress?.(progressBase);
    const baseline = zipBaseline(zipBytes);
    if (typeof Worker !== "undefined") {
      await this.mountDriveWithWorker(module, zipBytes, baseline, progressBase, progressSpan);
      return;
    }

    const entries = unzipSync(zipBytes);
    if (this.exiting) return;
    this.opts.onExtractProgress?.(progressBase + progressSpan * 0.08);

    const files: Array<[string, Uint8Array]> = [];
    for (const [name, data] of Object.entries(entries)) {
      const rel = normalizeZipName(name);
      if (rel) files.push([rel, data]);
    }
    const total = Math.max(1, files.length);
    for (let idx = 0; idx < files.length; idx++) {
      if (this.exiting) return;
      const [rel, data] = files[idx];
      const dest = `/c/${rel}`;
      const slash = dest.lastIndexOf("/");
      if (slash > 0) this.ensureDir(module, dest.slice(0, slash));
      module.FS.writeFile(dest, data);
      this.baseline.set(rel, baseline.get(rel) ?? { size: data.length, crc: crc32(data) });
      const written = idx + 1;
      const fraction = 0.08 + 0.9 * (written / total);
      this.opts.onExtractProgress?.(progressBase + progressSpan * fraction);
      if (idx % 32 === 31) await yieldToBrowser();
    }
  }

  private mountDriveWithWorker(
    module: DosboxModule,
    zipBytes: Uint8Array,
    baseline: Map<string, BaselineEntry>,
    progressBase: number,
    progressSpan: number,
  ): Promise<void> {
    const id = Date.now() + Math.floor(Math.random() * 1_000_000);
    const worker = new Worker(new URL("./zip-mount-worker.ts", import.meta.url), { type: "module" });
    const zipBuffer = transferableBuffer(zipBytes);

    return new Promise((resolve, reject) => {
      let settled = false;
      const finish = (err?: unknown) => {
        if (settled) return;
        settled = true;
        worker.terminate();
        if (err) reject(err);
        else resolve();
      };

      const writeBatch = async (msg: Extract<ZipWorkerMessage, { type: "batch" }>) => {
        try {
          for (let idx = 0; idx < msg.entries.length; idx++) {
            if (this.exiting) return finish();
            const entry = msg.entries[idx];
            const rel = normalizeZipName(entry.name);
            if (!rel) continue;
            const data = new Uint8Array(entry.data);
            const dest = `/c/${rel}`;
            const slash = dest.lastIndexOf("/");
            if (slash > 0) this.ensureDir(module, dest.slice(0, slash));
            module.FS.writeFile(dest, data);
            this.baseline.set(rel, baseline.get(rel) ?? { size: data.length, crc: crc32(data) });
            if (idx % 4 === 3) await yieldToBrowser();
          }
          await yieldToBrowser();
          worker.postMessage({ type: "ack", id, seq: msg.seq });
        } catch (err) {
          finish(err);
        }
      };

      worker.onmessage = (event: MessageEvent<ZipWorkerMessage>) => {
        const msg = event.data;
        if (msg.id !== id || settled) return;
        if (msg.type === "progress") {
          const local = msg.phase === "inflate"
            ? 0.02 + 0.68 * msg.fraction
            : 0.7 + 0.28 * msg.fraction;
          this.opts.onExtractProgress?.(progressBase + progressSpan * local);
        } else if (msg.type === "batch") {
          void writeBatch(msg);
        } else if (msg.type === "done") {
          this.opts.onExtractProgress?.(progressBase + progressSpan);
          finish();
        } else if (msg.type === "error") {
          finish(new Error(msg.message));
        }
      };
      worker.onerror = (event) => finish(new Error(event.message));
      worker.postMessage({ type: "extract", id, zip: zipBuffer }, [zipBuffer]);
    });
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
      if (!base || base.size !== bytes.length || base.crc !== crc32(bytes)) changed[rel] = bytes;
    }
    const names = Object.keys(changed);
    if (names.length === 0) return null;
    return zipSync(changed);
  }

  private handleFrame(width: number, height: number): void {
    if (width > 0 && height > 0 && (this.frameWidth !== width || this.frameHeight !== height)) {
      this.frameWidth = width;
      this.frameHeight = height;
      this.events.emitFrameSize(width, height);
      this.opts.onFrameSize?.(width, height);
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
    const sourceChannels = samples > 1 && samples % 2 === 0 ? 2 : 1;
    this.audioChannels = 1;
    const totalSamples = Math.floor(samples / sourceChannels) * sourceChannels;
    if (totalSamples <= 0) return;
    const start = ptr >> 2;
    const copy = new Float32Array(module.HEAPF32.subarray(start, start + totalSamples));
    this.pushAudio(sourceChannels === 2 ? downmixStereoToMono(copy) : copy, 1);
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
    return this.audioUnlockFlight.run(() => this.performAudioUnlock());
  }

  private async performAudioUnlock(): Promise<boolean> {
    if (this.exiting) return false;
    this.focusCanvas();
    if (!this.audioCtx) {
      await this.setupAudio(this.audioSourceRate || AUDIO_RATE);
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
      this.canvas.style.setProperty("width", `var(--dos-canvas-width, ${width}px)`, "important");
      this.canvas.style.setProperty("height", `var(--dos-canvas-height, ${height}px)`, "important");
    } else {
      this.canvas.style.setProperty("width", "var(--dos-canvas-width, 100%)", "important");
      this.canvas.style.setProperty("height", "var(--dos-canvas-height, 100%)", "important");
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
    this.canvas.addEventListener("keydown", this.onKeyCapture, true);
    this.canvas.addEventListener("keyup", this.onKeyCapture, true);
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

  private handleKeyCapture(e: KeyboardEvent): void {
    if (!this.ci || (e.type !== "keydown" && e.type !== "keyup")) return;
    const sdlKeyCode = recoverSDLKeyCodeFromBrokenAsciiEvent(e);
    if (sdlKeyCode === null) return;

    e.preventDefault();
    e.stopImmediatePropagation();
    this.sendSDLKey(sdlKeyCode, e.type === "keydown");
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
    this.canvas.removeEventListener("keydown", this.onKeyCapture, true);
    this.canvas.removeEventListener("keyup", this.onKeyCapture, true);
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
