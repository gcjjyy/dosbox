# DOSBox 0.74-3 patches

Applied in numeric order during Docker build (see ../Dockerfile).

| File | Purpose | Touches |
|---|---|---|
| 01-emscripten-build.diff | Makefile.am + configure.ac changes so the build emits `dosbox0743.js`/`dosbox0743.wasm` from emcc with Asyncify and jsdos-like release flags | Makefile.am, src/Makefile.am, configure.ac |
| 02-sdl1-asyncify.diff | Adds an Asyncify-friendly yield in `Normal_Loop`, throttled to jsdos' roughly 24ms pacing | src/dosbox.cpp |
| 03-fs-glue.diff | Add EM_JS callbacks: `js_on_frame(ptr, w, h)`, `js_on_audio(samples_ptr, n_samples, sample_rate)`, `js_on_extract_progress(fraction)`; register them with DOSBox's render/mixer subsystems | src/sdlmain.cpp, src/gui/render.cpp, src/hardware/mixer.cpp (see Source-tree notes for exact paths in 0.74-3) |
| 04-disable-sdl-cdrom.diff | Guard the physical `CDROM_Interface_SDL` and its `SDL_CD*` enumeration under `#if !defined(JSDOS)` — Emscripten's `-sUSE_SDL=1` port lacks the SDL 1.2 CD-ROM audio API (`SDL_CD`, `SDL_CDNumDrives`, `SDL_CDName`, `CD_INDRIVE`, …). `CDROM_GetMountType` reports zero physical drives under JSDOS, so the MSCDEX factory falls back to `CDROM_Interface_Fake`. **`CDROM_Interface_Image` (.iso/.cue) is untouched** and still mounts via `IMGMOUNT` / `MOUNT -t iso`. Discovered during Phase C build iteration (cold build failed compiling dos_programs.cpp). | src/dos/cdrom.h, src/dos/cdrom.cpp, src/dos/dos_mscdex.cpp, src/dos/dos_programs.cpp |
| 05-define-msf-macros.diff | Define `FRAMES_TO_MSF` / `MSF_TO_FRAMES` in `cdrom.h` (after `COOKED_SECTOR_SIZE`, **unconditionally** — no JSDOS guard). These standard CD-ROM frame/MSF conversion macros are *absent from upstream 0.74-3* yet used by image CD-ROM code (`cdrom_image.cpp`) and `dos_mscdex.cpp`, which compile in all builds. Latent upstream bug: only surfaces once the build progresses past the earlier `dos_programs.o` blocker (fixed by patch 04) to reach `dos_mscdex.o`. Discovered during Phase C build iteration. | src/dos/cdrom.h |
| 06-sdl1-link-compat.diff | Guard the SDL functions that emscripten's `-sUSE_SDL=1` port does NOT implement, so `wasm-ld` stops failing on undefined symbols. **(a) YUV overlay**: the three `case SCREEN_OVERLAY:` branches that call `SDL_FreeYUVOverlay`/`SDL_CreateYUVOverlay` (GFX_SetSize → `goto dosurface`), `SDL_LockYUVOverlay` (GFX_StartUpdate → `return false`), and `SDL_UnlockYUVOverlay`/`SDL_DisplayYUVOverlay` (GFX_EndUpdate → `break`) are wrapped in `#if !defined(JSDOS)` with no-op fallbacks. The `output == "overlay"` config arm also falls back to `SCREEN_SURFACE` under JSDOS so the dead overlay path is never selected at runtime. **SCREEN_OVERLAY is dead in our build** (frame callback only fires for SCREEN_SURFACE). The flag-only `SCREEN_OVERLAY` cases in GFX_GetBestMode (~552) and GFX_GetRGB (~1133) are left alone — they contain no SDL YUV calls. **(b) `SDL_WaitEvent`**: the two pause/idle loop sites (one in `PauseDOSBox`, one in the focus-loss loop) use `SDL_Delay(1)` + `SDL_PollEvent` under JSDOS. Discovered during Phase C link iteration. | src/gui/sdlmain.cpp |

## Reference materials (do NOT vendor)

- caiiiycuk/emulators: build pattern, emcc flags, exported symbols
- js-dos/dosbox: already-patched 0.74-2 source (we re-derive patches against 0.74-3)
- Emscripten Asyncify guide: https://emscripten.org/docs/porting/asyncify.html

Patches are GPL-2.0 (inherited from DOSBox).

---

## Source-tree notes (verified against extracted `dosbox-0.74-3.tar.gz`)

Line numbers are vanilla 0.74-3, unmodified.

### Patch 02 target — Asyncify yield

- **The hot loop is `src/dosbox.cpp:129` `static Bitu Normal_Loop(void)`**, NOT
  anything in sdlmain. The plan template's "src/sdlmain.cpp" entry for Patch 02
  is misleading — update it to `src/dosbox.cpp`.
  js-dos/dosbox's 0.74-2 fork injects `client_tick(); asyncify_sleep(0);` at the
  top of `Normal_Loop`. We keep the same idea, but throttle the yield to about
  24ms like jsdos' `syncSleep` path; yielding every iteration makes DOSBox run
  too slowly and stretches audio.
- `GFX_Events()` (`src/gui/sdlmain.cpp:1442`, `while (SDL_PollEvent(...))` at
  `:1464`) is called from `Normal_Loop` via `dosbox.cpp:144`, so it already
  yields per-tick. No extra sleep needed inside `GFX_Events()`.
- `int main(...)` is at `src/gui/sdlmain.cpp:1845` — the SDL1 main file is
  **`src/gui/sdlmain.cpp`**, not the `src/sdlmain.cpp` listed in the table above.

### Patch 03 target — JS callbacks

- Audio: `MIXER_CallBack` at `src/hardware/mixer.cpp:414` is the SDL1 pull
  callback. `MIXER_Init` is at `:616` with `SDL_OpenAudio` at `:649`. Replace
  the `SDL_OpenAudio` wiring with an `EM_JS js_on_audio(ptr, n, rate)` call;
  leave the `MixerChannel::AddSamples*` family (`:290-340`) alone.
- Frame: hook `GFX_EndUpdate()` in `src/gui/sdlmain.cpp:852` (also called from
  `:504` / `:999`) — invoke `js_on_frame(ptr, w, h)` after the scaler has
  written the final framebuffer.
- `ScalerLineHandler_t RENDER_DrawLine` (`src/gui/render.cpp:38`) is the
  scaler dispatch — do not intercept here; it runs per-line.

### Patch 01 target — emcc link flags

From caiiiycuk's `targets/dosbox.cmake` (do NOT vendor):

```
-sWASM=1 -sUSE_ZLIB=1 -sASYNCIFY=1
-sASYNCIFY_IMPORTS=['syncSleep']
-sEXPORT_NAME='WDOSBOX'
```

Compile-time defines: `-DHAVE_CONFIG_H -DGET_X86_FUNCTIONS -DJSDOS -DC_IPX`.
We do NOT use `-DWITHOUT_SDL` (we keep SDL1 surfaces in the patched sdlmain).
`-DJSDOS` is the conventional guard for emscripten-only code blocks.

`ALLOW_MEMORY_GROWTH=1`, `ASYNCIFY_STACK_SIZE`, and `EXPORT_NAME` must match
what `app/lib/dos-emulator.ts` expects (`createDosbox` factory) — caiiiycuk's
shared `EM_LINK_OPTIONS` is not in the dosbox-specific target file, so recreate
those from the consumer's API.

### Asyncify only-list

caiiiycuk's `targets/dosbox-asyncify.txt` is a single-line JSON array of
mangled symbols. We keep a reference list in this repo, but do not wire it into
the link: thin LTO renames enough DOSBox C++ symbols that the plain list is not
reliable and caused `invalid state: 1` aborts in browser testing. Full Asyncify
is currently required for the self-built 0.74-3 artifact. Notables for future
tuning:

- `main`, `Normal_Loop`, `DOSBOX_RunMachine`, `CALLBACK_Idle`
- `DOS_Shell::Run`, `::RunInternal`, `::Execute`
- `DOS_21Handler`, `DOS_OpenFile`, `DOS_ReadFile`, `DOS_WriteFile`, `DOS_CloseFile`
- `INT10_*` (SetVideoMode, SetCursorPos, TeletypeOutput, ...)
- `INT15_Handler`, `INT2E_Handler`
- `localFile::Read`, `::Close`, `::UpdateLocalDateTime`
- `PAGING_PageFault`, `MEM_BlockCopy`, `MEM_BlockRead`

If this is revisited, verify it with Playwright boot tests in Chromium and
WebKit before committing the artifact.

### Patch 04 target — SDL physical CD-ROM

- `src/dos/Makefile.am` SOURCES lists `cdrom_ioctl_win32.cpp`,
  `cdrom_aspi_win32.cpp`, `cdrom_ioctl_linux.cpp`, `cdrom_ioctl_os2.cpp`
  **unconditionally** — they are always handed to the compiler. But each file
  wraps its *entire* body in `#if defined(WIN32|LINUX|OS2)`, so under the
  emscripten host (`wasm32`, none of those defined) they compile to empty
  translation units and never reference `CDROM_Interface_SDL`. **No JSDOS guard
  needed in those four files.**
- `CDROM_Interface_Ioctl` (cdrom.h:349) derives from `CDROM_Interface_SDL` but
  is itself inside `#if defined(LINUX)||defined(OS2)`, so it never compiles
  under JSDOS — guarding the base class out is safe.
- The MSCDEX interface factory is `MSCDEX_AddDrive` in
  `src/dos/dos_mscdex.cpp:254` (`switch (CDROM_GetMountType(...))`); the physical
  branch (`new CDROM_Interface_SDL()`) is `:293`. Patch 04 adds an `#elif
  defined(JSDOS)` arm that uses `CDROM_Interface_Fake` (kept compiling; actually
  unreachable since `CDROM_GetMountType` returns only 0x01/0x02 under JSDOS).

### Build-system reality check

caiiiycuk replaces autoconf with CMake. We keep autoconf, so patch 01 must:

1. Guard `AM_PATH_SDL` (`configure.ac:30-33`) under `EMSCRIPTEN` or stub it —
   it will fail in the emscripten sysroot.
2. Inject emcc `CXXFLAGS`/`LDFLAGS` in `src/Makefile.am` so the link emits
   `dosbox0743.js` instead of a native binary.
3. Visualc_net / win32 midi / coreaudio targets are already conditional;
   verify but don't touch.

## Loader patch

`../patch-loader.mjs` runs after Docker extracts `dosbox0743.js`. It disables
SDL's generated WebAudio scheduling whenever `Module.onAudio` is installed, so
the app's AudioWorklet is the single playback path.
