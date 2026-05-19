# Self-Built DOSBox WASM — Design

**Date**: 2026-05-19
**Status**: Approved, pending implementation plan
**Topic**: Drop the `js-dos` npm dependency and build our own DOSBox 0.74-3 WASM in-tree.

---

## Motivation

We currently load DOSBox-X via the third-party `js-dos@^8.3.20` npm package. Its build artifacts (`emulators.js`, `wdosbox-x.wasm`, `wdosbox.wasm`, `wlibzip.wasm` — 9.5 MB total) are copied to `public/js-dos/emulators/` by a `copy-jsdos` script that is a prerequisite of both `npm run build` and `npm run dev`.

This creates two problems:

1. **External dependency surface** for what is essentially the core engine of the product. The npm package is GPL-2.0, contains prebuilt opaque WASM, and pins us to whatever emulator backend it chooses.
2. **`public/js-dos/` in the deployed bundle is aesthetically unacceptable** for a project whose only reason to exist is to run DOS in a browser — the emulator should be ours.

We accept the trade-off of losing DOSBox-X features (Windows 9x boot, more accurate hardware emulation, KSC5601 Hangul output) by reverting to vanilla DOSBox 0.74-3 — the last mainline release (2019). Korean DOS *games* (which render their own fonts) will keep working; Korean DOS *tools* (HWP, 한메한글, 태백한글 etc.) will show garbled menus. The user has explicitly accepted this trade-off.

## Goals

- Build `wdosbox.wasm` from DOSBox 0.74-3 source using Emscripten, fully in-tree.
- Replace the `js-dos` npm dependency and `public/js-dos/` directory with our own `public/wasm/` artifacts and `app/lib/wasm-dosbox/` wrapper.
- Keep the existing client architecture intact: WebGL renderer, AudioWorklet pull-based audio, GLFW-style keymap, 4-phase boot pipeline.
- Keep `~/.cache/dosbox/bundle.jsdos` (zip) format compatible — the server-side `bundle.ts` already emits standard zip via `zip(1)`.

## Non-goals

- KSC5601 Hangul rendering inside DOSBox. (User accepted.)
- Windows 9x boot via IMGMOUNT. We already removed all `_Win95/_Win98/_PCem98` games from `~/dos/`.
- Multi-emulator switching at runtime. Single backend, hard-wired.
- DOSBox-X feature parity. If we ever need it, we revisit.

---

## Architecture

```
┌─────────────────────── Build time (developer machine) ────────────────┐
│                                                                       │
│  scripts/wasm/Dockerfile  →  FROM emscripten/emsdk:3.1.74            │
│                              + DOSBox 0.74-3 source tarball           │
│                              + patches/*.diff applied                 │
│                                                                       │
│  scripts/wasm/build.sh    →  docker build → emcc compile              │
│                              SDL1 + Asyncify → wdosbox.wasm + .js     │
│                              → cp to public/wasm/                     │
│                                                                       │
│  git commit public/wasm/wdosbox.wasm + wdosbox.js                     │
│                                                                       │
└───────────────────────────────────────────────────────────────────────┘

┌─────────────────────── Runtime (browser) ─────────────────────────────┐
│                                                                       │
│  root.tsx       <script src="/wasm/wdosbox.js" defer />              │
│                 → registers window.createDosbox                       │
│                                                                       │
│  DosFrame.tsx   waits for window.createDosbox (was window.emulators)  │
│  app/lib/dos-emulator.ts                                              │
│    └─ createEmulator(initFs, options) from wasm-dosbox                │
│       (was emu.dosboxXDirect(initFs, options))                        │
│                                                                       │
│  app/lib/wasm-dosbox/  (new module, our own wrapper)                  │
│    ├─ module-loader  emscripten Module instance + ready promise       │
│    ├─ bundle-fs       fflate unzip → Module.FS.writeFile             │
│    ├─ frame-bus       C++ → RGBA Uint8ClampedArray                    │
│    ├─ audio-bus       C++ → Float32 chunks + sampleRate               │
│    └─ input           sendKey / mouse / exit ccall bindings           │
│                                                                       │
└───────────────────────────────────────────────────────────────────────┘
```

**Key build decisions**:

- **SDL1 + Asyncify** (caiiiycuk pattern). DOSBox 0.74-3 uses SDL1. Asyncify suspends the C++ main loop via `emscripten_sleep()` so it cooperates with the JS event loop. Most widely tested combination.
- **Emscripten 3.1.74 pinned** in the `Dockerfile FROM` line. Reproducible across machines.
- **DOSBox 0.74-3 source as `scripts/wasm/dosbox-0.74-3.tar.gz`** vendored in-tree (~3 MB). SHA256 verified by `build.sh` to prevent silent tampering.
- **Patches as `scripts/wasm/patches/*.diff`** applied during the Docker build. Order:
  - `01-emscripten-build.diff` — Makefile/configure changes for emcc toolchain
  - `02-sdl1-asyncify.diff` — SDL1 event loop + Asyncify integration
  - `03-fs-glue.diff` — emscripten MEMFS glue for bundle mounting
- **WASM loader (`wdosbox.js`)** is the file emcc generates — no hand modification. Our wrapper sits on top of it.

**Deployment impact**: Zero. Build artifacts are committed to git. On `pcnhost`, `git pull && npm run build && pm2 restart dosbox` continues to work. Docker is not needed on the production host.

## Components

| Path | Purpose | Dependencies |
|---|---|---|
| `scripts/wasm/Dockerfile` | emsdk 3.1.74 + DOSBox source + patches | Docker daemon |
| `scripts/wasm/build.sh` | Orchestrates docker build + extracts artifacts to `public/wasm/` | Bash, Docker |
| `scripts/wasm/dosbox-0.74-3.tar.gz` | Vendored vanilla source | SourceForge tarball, SHA256 pinned |
| `scripts/wasm/patches/*.diff` | Our patches against 0.74-3 source | None |
| `scripts/wasm/expected-hashes.txt` | Expected SHA256 of `wdosbox.wasm`/`wdosbox.js` for reproducibility checks | None |
| `scripts/wasm/README.md` | Build guide, license notes, patch rationale | None |
| `public/wasm/wdosbox.wasm` | ~1.4 MB build artifact, git committed | — |
| `public/wasm/wdosbox.js` | emscripten loader, registers `window.createDosbox` | — |
| `app/lib/wasm-dosbox/index.ts` | Public API: `createEmulator(initFs, options)` | sibling modules |
| `app/lib/wasm-dosbox/module-loader.ts` | Poll `window.createDosbox`, instantiate Module, expose ready promise | global `createDosbox` |
| `app/lib/wasm-dosbox/bundle-fs.ts` | fflate unzip → `Module.FS.writeFile` for every entry, emit progress | `fflate`, Module |
| `app/lib/wasm-dosbox/frame-bus.ts` | Read frame pointer + dims from HEAPU8, build RGBA buffer | `Module.HEAPU8` |
| `app/lib/wasm-dosbox/audio-bus.ts` | Read Float32 audio chunks from HEAPF32, post to AudioWorklet | `Module.HEAPF32` |
| `app/lib/wasm-dosbox/input.ts` | sendKeyDown/Up, mouse, exit — all `Module.ccall` bindings | Module |
| `app/lib/wasm-dosbox/types.ts` | `CommandInterface`, `BackendOptions` (matching current shapes) | — |

**Modified files** (small diffs):

- `app/root.tsx` — one line: `/js-dos/emulators/emulators.js` → `/wasm/wdosbox.js`
- `app/components/DosFrame.tsx` — polling target name: `window.emulators` → `window.createDosbox`
- `app/lib/dos-emulator.ts` — `emu.dosboxXDirect(initFs, opts)` → `createEmulator(initFs, opts)` from `wasm-dosbox`
- `package.json`:
  - Remove `"js-dos": "^8.3.20"` dependency
  - Remove `copy-jsdos` script and its references in `build`/`dev`
  - Add `"fflate": "^0.8.x"` dependency
- `.gitignore` — remove `public/js-dos/` entry (no longer generated), add `scripts/wasm/build/` (Docker build scratch)

**Deleted**:

- `public/js-dos/` directory (was gitignored anyway — deletion happens via the removal of `copy-jsdos`)
- `node_modules/js-dos/` (auto-removed by `npm install` after `package.json` edit)

## Data flow

### Build time

1. Developer runs `scripts/wasm/build.sh`.
2. Script checks Docker daemon, verifies `dosbox-0.74-3.tar.gz` SHA256.
3. `docker build` runs the Dockerfile: emsdk image → extract source → apply patches → `emconfigure ./configure --enable-asyncify` → `emmake make`. Cold build 30–60 min, cached 1–2 min.
4. Script creates a container from the resulting image, `docker cp` extracts `wdosbox.wasm` and `wdosbox.js` to `public/wasm/`.
5. Optionally `--verify`: SHA256 of new artifacts compared against `expected-hashes.txt`.
6. Developer reviews + `git commit public/wasm/`.

### Runtime (browser boot — 4-phase pipeline preserved)

1. **wait (5 %)**: `root.tsx` loads `/wasm/wdosbox.js` via `<script defer>`. The script registers `window.createDosbox = (config) => Promise<Module>`. `DosFrame.tsx` polls `window.createDosbox` with a 30 s timeout.
2. **download (55 %)**: `fetch('/dos.jsdos')` with `Content-Length` progress (Cloudflare `no-transform` header preserved). Yields a `Uint8Array` (~100 MB).
3. **extract (35 %)**: `bundle-fs.ts` calls `fflate.unzipSync` (or async streaming variant), iterates entries, calls `Module.FS.mkdirTree(dirname)` + `Module.FS.writeFile(path, contents)`, emits `onExtractProgress(fraction)` per entry.
4. **boot (5 %)**: `module-loader.ts` calls `Module.callMain([])`. Asyncify keeps the main loop suspended between frames. First `onFrame` callback → `onReady` → progress 100 %.

### Runtime (steady state — unchanged contracts)

- **Rendering**: `frame-bus.ts` exposes `latestFrame` via `pendingBuf` pattern from `dos-emulator.ts`. WebGL RAF coalescing in `dos-emulator.ts` is untouched.
- **Audio**: `audio-bus.ts` posts `Float32Array` chunks via `port.postMessage(chunk, [chunk.buffer])` to `dos-audio-processor.js` (worklet). Pull-based ring queue unchanged.
- **Input**: `input.ts` exposes `sendKeyDown(code)`, `sendKeyUp(code)`, `sendMouseMotion`, `sendMouseButton`, `exit`. Each is a `Module.ccall` binding. GLFW-style keymap from `app/lib/dos-keymap.ts` works as-is.

## Error handling

### Build-time

| Failure | Detection | Action |
|---|---|---|
| Docker daemon down | `docker info` at script start | Friendly message, exit 1 |
| `dosbox-0.74-3.tar.gz` SHA256 mismatch | Script-side check before `docker build` | Refuse to build, point at expected hash |
| Patch apply fails | `patch -p1` exit code inside Dockerfile | Build fails, stderr surfaces which `.diff` failed |
| emcc compile fails | Docker layer exit code | Propagated to host via `set -e` in `build.sh` |
| Artifact size sanity (< 800 KB) | `[ $(stat -f%z wdosbox.wasm) -gt 800000 ]` post-extract check | Exit 1 |

`build.sh` supports `--no-cache` to bypass Docker layer cache.

### Runtime

Existing `app/lib/errors.ts` patterns are extended:

| Failure | Handling |
|---|---|
| `/wasm/wdosbox.js` 404 / network error | Existing `BootScreen` wait-phase error UI, message text updated `emulators` → `createDosbox` |
| `window.createDosbox` 30 s polling timeout | Same as above |
| `/dos.jsdos` fetch failure | Existing download-phase error, unchanged |
| `fflate.unzipSync` throws (corrupt bundle) | New `BundleUnzipError`, extract-phase UI says "bundle corrupted, contact admin"; ops note: rebuild server cache |
| `Module.FS.writeFile` throws (OOM) | New `FSWriteError`, "browser memory exhausted, reload" UI |
| `Module.callMain` aborts | Existing `onError` callback, BootScreen error |
| Asyncify deadlock (no frames for 10 s after boot) | RAF-based heartbeat in `dos-emulator.ts` → banner suggesting reload |

**License-violation guard**: `build.sh` verifies the tarball SHA256 before each build. If someone replaces the vendored source, the build aborts.

## Testing

### Build reproducibility

- `build.sh --verify` mode: after build, SHA256 of `public/wasm/wdosbox.wasm` and `wdosbox.js` compared against `scripts/wasm/expected-hashes.txt`. Mismatch fails CI / human review.
- Manual cold-vs-cached timing check (30–60 min cold vs 1–2 min cached) to confirm Docker layer cache works.

### Unit tests (Vitest, existing `app/**/*.test.ts(x)` pattern, `pool: forks`)

| File | What it covers |
|---|---|
| `app/lib/wasm-dosbox/bundle-fs.test.ts` | Mock `Module.FS`; verify fflate output yields correct paths/contents for empty zip, nested dirs, multi-entry stub |
| `app/lib/wasm-dosbox/frame-bus.test.ts` | Mock `Module.HEAPU8`; verify RGBA extraction with correct stride and endianness |
| `app/lib/wasm-dosbox/audio-bus.test.ts` | Mock `Module.HEAPF32`; verify Float32 chunk conversion, sample-rate passthrough, transferable detach |
| `app/lib/wasm-dosbox/input.test.ts` | Mock `Module.ccall`; verify `sendKey*` maps to the right symbols and arg types; GLFW keycodes preserved |

WASM itself is not runnable under Vitest (no wasm interpreter in jsdom).

### Integration / smoke (manual, on dev server)

5-game matrix executed on every WASM-touching PR:

| Game | Verify |
|---|---|
| DOOM2 | Boot, AdLib music, SB SFX, key input, save/load |
| SAM4 | Boot, graphics mode, self-rendered Korean fonts |
| DARKSIDE | Boot, music, fonts |
| DEJAVU | Boot, music |
| KHAN2 | Boot, KOEI.COM entry, graphics |

Korean tools (HWP20, HANME, etc.) are **explicitly excluded** — known to fail under 0.74-3, documented in `scripts/wasm/README.md`.

### CI gate

- New unit tests run under `npm run test` (existing CI step).
- New `npm run verify-wasm` script: compares SHA256 of `public/wasm/*.wasm` against `scripts/wasm/expected-hashes.txt`. CI fails if artifact was edited but expected-hashes wasn't updated (forces deliberate confirmation).
- The WASM build itself is **not** run in CI (developer's choice — Docker on developer machine only). Future enhancement: optional CI build for verification only (doesn't commit artifacts).

## License

- DOSBox = GPL-2.0. Our build artifacts inherit GPL-2.0. Documented in `scripts/wasm/README.md`.
- Our wrapper code (`app/lib/wasm-dosbox/*`) is original work, written referencing caiiiycuk's API contract but without copying code. License of the wrapper follows the parent project's license.
- No vendored caiiiycuk/emulators source.

## Migration / rollout

Single deployment cutover. Before/after:

```
Before:
  package.json:        "js-dos": "^8.3.20"
  scripts:             copy-jsdos prereq of build/dev
  public/js-dos/       9.5 MB (gitignored, regenerated each build)
  root.tsx:            <script src="/js-dos/emulators/emulators.js">
  dos-emulator.ts:     emu.dosboxXDirect(...)

After:
  package.json:        "fflate": "^0.8.x"
  scripts:             scripts/wasm/build.sh
  public/wasm/         ~1.5 MB (git committed, never regenerated automatically)
  root.tsx:            <script src="/wasm/wdosbox.js">
  dos-emulator.ts:     createEmulator(...) from app/lib/wasm-dosbox
```

`pcnhost` deploy: `git pull && npm install && npm run build && pm2 restart dosbox`. Docker not needed on remote.

Rollback: `git revert` of the cutover commits restores `package.json` and source files; `npm install` reinstates `js-dos`. The `public/wasm/` directory remains harmless (orphaned files).

## Open questions / future work

- Optional CI build for hash verification (don't commit artifacts from CI).
- Hangul rendering: if needed later, evaluate a minimal KSC5601 font patch as `patches/04-ksc5601-glyphs.diff`. Out of scope for this spec.
- DOSBox Staging or DOSBox-X self-build: only revisit if real users need features 0.74-3 lacks.
