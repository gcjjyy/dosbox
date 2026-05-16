# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this app is

Single-tenant web app that boots a real Korean-era MS-DOS environment (`~/dos`, ~231 MB) inside the browser via the js-dos v8 **WASM bridge** (`emulators`). Public read-only access for anyone; one admin password unlocks a Save button that persists changes back to the host filesystem. There is also a per-user save channel that lives entirely in the visitor's localStorage and is layered on top of the server bundle at boot.

Architectural anchors (read these specs before changing core mechanics):
- `docs/superpowers/specs/2026-05-13-dosbox-design.md` — overall architecture, access matrix, threat model.
- `docs/superpowers/specs/2026-05-15-custom-dos-emulator-design.md` — why the js-dos React UI was removed and how the bare WASM glue is structured.
- `docs/superpowers/specs/2026-05-15-user-state-save-design.md` — localStorage overlay save semantics.

## Commands

```bash
npm install
npm run dev         # copy-jsdos + react-router dev (http://localhost:5173)
npm run build       # copy-jsdos + react-router build
npm start           # react-router-serve ./build/server/index.js (prod)
npm run typecheck   # react-router typegen && tsc  ← run after changing routes
npm run test        # vitest run (node env, app/**/*.test.ts(x), pool: forks)
npm run test:watch
npx vitest run app/lib/bundle.test.ts        # single test file
npx vitest run -t "rebuilds bundle"          # single test by name
```

`npm run copy-jsdos` syncs `node_modules/js-dos/dist/emulators/*` → `public/js-dos/emulators/`. It is a build prereq baked into `dev` and `build`; `public/js-dos/` is gitignored as a build artifact. After upgrading `js-dos`, rerun it.

**System `zip(1)` is a runtime dependency** of the server. The bundle builder shells out to it because every Node zip library we tried emits streaming-format ZIPs (general-purpose bit 3 set), and js-dos's wlibzip extractor hangs on those for bundles of this size. Keep the `spawn("zip", …)` call in `app/lib/bundle.ts` — do not "modernize" it back to archiver/yazl.

## Required env

`.env` (gitignored, see `.env.example`):
- `PORT` (default 5301 in prod via pm2; dev uses Vite's 5173)
- `DOS_ROOT` — absolute path to the DOS tree. Defaults to `~/dos`.
- `DOSBOX_ADMIN_PASSWORD` — single shared admin password.
- `SESSION_SECRET` — **must be ≥32 chars**; storage init throws otherwise.
- `DOSBOX_CACHE_DIR` (optional) — where `bundle.jsdos` + ETag get cached. Defaults to `~/.cache/dosbox`.

## Architecture at a glance

```
Browser ─HTTPS─► nginx (443) ─proxy_pass─► RR v7 server (127.0.0.1:5301) ─fs─► ~/dos
```

- **Server** is React Router v7 SSR (`ssr: true` in `react-router.config.ts`), Tailwind v4 via Vite plugin, TypeScript strict, Node ≥20.
- **Client** loads `/js-dos/emulators/emulators.js` from `root.tsx`'s `<head>`. The route `/` then mounts `<DosFrame>`, which fetches `/dos.jsdos` as a streamed `Uint8Array`, instantiates `DosEmulator`, and renders into a WebGL canvas.
- **No js-dos React UI is used.** We deleted the sidebar/soft-keyboard/splash layers and built the engine glue directly on `window.emulators.dosboxXDirect`. The custom UI lives in `app/components/{Toolbar,ResolutionPicker,VirtualKeyboard,BootScreen,LoginModal}.tsx`.

### Module map

| Concern | File | Notes |
|---|---|---|
| Path safety | `app/lib/dos-paths.ts` | All FS writes go through `resolveSafe()` (rejects empty/control-char segments and any path resolving outside `DOS_ROOT`). |
| Bundle build | `app/lib/bundle.ts` | Streams `zip(1)` output, ETag = sha256(file list) + on-disk mtime/size (mtime suffix is **load-bearing**: it forces fresh ETags so browsers can't pin a previously-cached broken zip). |
| Auth | `app/lib/auth.server.ts` | Cookie session via React Router's `createCookieSessionStorage` (not iron-session, despite the older spec). Password compare is constant-time + exact-equal (defeats padding bypass). 10 logins/min/IP in-memory rate limit. |
| Same-origin guard | `app/lib/origin.ts` | All mutating routes call `assertSameOrigin()`. No CSRF token — SameSite=Lax cookie + origin check is the model. |
| Server save | `app/routes/api.save.tsx` + `app/lib/apply-changes.ts` | POST body is raw `ci.persist(true)` ZIP. yauzl unpacks, applyChanges does atomic `tmp` + `rename`, then `rebuildBundle()` is called to refresh the cached bundle. |
| Client save (server) | `app/lib/save.ts` | Posts the raw ZIP as `application/octet-stream`. |
| User save (localStorage) | `app/lib/user-state.ts` + `app/lib/use-user-state.ts` | Base64-encoded ZIP under `dosbox-user-state`. ~3.5 MB soft cap before localStorage quota errors. |
| Engine | `app/lib/dos-emulator.ts` | Owns WebGL renderer, Web Audio, physical keyboard, pointer mouse, lifecycle. |
| Audio worklet | `app/lib/dos-audio-worklet.ts` + `public/dos-audio-processor.js` | TS file is just the `PROCESSOR_NAME` + `WORKLET_URL` constants; the actual processor source lives at the public path so `audioWorklet.addModule()` loads a same-origin static URL (Blob URLs were unreliable on iOS Safari). Don't duplicate the queue/prime-threshold logic — touch one place. |
| Keymap | `app/lib/dos-keymap.ts` | `KeyboardEvent.code` → **GLFW-style** keycodes (e.g. `A`=65, Enter=257, Space=32, ArrowUp=265). **Not SDL2 scancodes, not USB HID.** Taken from the `KBD_*` table in `node_modules/js-dos/dist/js-dos.js`. The `SC` named export is used by `VirtualKeyboard.tsx`. |
| Routes | `app/routes.ts` | RR v7 flat routes: `dos.jsdos.tsx` → `/dos.jsdos`, `api.save.tsx` → `/api/save`, etc. Typed route props come from the virtual `./+types/{name}` module generated by `react-router typegen`. |

### Two save channels — do not confuse them

1. **Admin save** (server-wide, persistent): `Toolbar` "관리자 저장" → `ci.persist(true)` → `POST /api/save` → unzip → write into `DOS_ROOT` → `rebuildBundle()`. All subsequent visitors see the change.
2. **User save** (this browser only): `Toolbar` "내 저장" → `ci.persist(true)` → base64 → `localStorage["dosbox-user-state"]`. On boot, `DosFrame` reads it and passes it as the second entry to `dosboxXDirect([bundle, overlay])`. Multi-entry semantics in emulators **layer later entries over earlier ones** — same-path files in the overlay win.

### Boot pipeline (progress bar phases)

`BootScreen` shows real percentages across four weighted phases summed in `DosFrame.tsx`:
1. `wait` (5%) — poll `window.emulators` (script tag with `defer`).
2. `download` (55%) — stream `/dos.jsdos` and track `Content-Length`. The route sets `Cache-Control: no-cache, must-revalidate, no-transform` — `no-transform` is required to stop Cloudflare from brotli-recompressing the bundle, which strips `Content-Length` and breaks the progress bar.
3. `extract` (35%) — wlibzip extraction; fractions reported by the WASM bridge's `onExtractProgress`.
4. `boot` (5%) — `onReady` → first `onFrame`.

### Rendering & audio gotchas

- **WebGL RAF coalescing**: `DosEmulator` stages the latest frame buffer in `pendingBuf` and uploads it on the next `requestAnimationFrame`. Emulator output frequency is decoupled from display vsync — this is what stopped Chrome/Mac compositor flicker. Don't reintroduce per-`onFrame` `gl.drawArrays`.
- **Audio: pull-based AudioWorklet, not push-scheduling**: `app/lib/dos-emulator.ts` posts raw `Float32Array` chunks via `port.postMessage(chunk, [chunk.buffer])` (transferable). The worklet (`public/dos-audio-processor.js`) owns a ring queue (2048 sample cap, 512 prime threshold ≈ ~43 / ~11 ms @ 48 kHz) and drains it inside `process()` at the audio thread's natural rate. **Steady-state latency is dominated by PRIME_THRESHOLD** — once primed the queue length oscillates around its initial value, so the prime threshold effectively *is* the audible delay. Upstream js-dos uses 6144/2048 (~128 / ~43 ms) to match its 2048-sample ScriptProcessor quantum; we run a 128-sample AudioWorklet quantum (2.67 ms) so 512 still leaves 4× headroom for postMessage jitter. **Do not** revive the old `createBufferSource + start(t)` push-scheduling pattern with a `MAX_LEAD` cap — that worked on desktop only because of low main-thread jitter and silently dropped nearly all chunks on mobile.
- **iOS Web Audio unlock**: Construct `AudioContext` with **only the `{sampleRate: n}` option** (n = `ci.soundFrequency()`). Adding `latencyHint: "interactive"`, silent-buffer "unlock dances", or `await`ing `resume()` all caused iOS Safari to leave the context permanently `state === "suspended"` even from inside a gesture handler. The current `setupAudio()` does the minimum that works: gesture-deferred construction, fire-and-forget `resume()`, then poll `ctx.state` until "running" via `waitForRunning()`. `pushAudio` carries a `resampleRatio = ctx.sampleRate / sourceRate` fallback so if iOS ever does coerce the rate, we resample on the main thread (linear interp) before posting to the worklet.
- Pixels stay crisp via `gl.NEAREST` filtering + CSS `image-rendering: pixelated` on the canvas.

### Conventions worth knowing

- `~/*` import alias → `./app/*` (tsconfig `paths`).
- `*.server.ts` suffix marks server-only modules (e.g. `auth.server.ts`). Avoid importing these from anything in `app/components/` or other client-reachable files.
- React Router type imports come from the **virtual** `./+types/<route>` path — they only exist after `react-router typegen` runs. Run `npm run typecheck` after editing `app/routes.ts`.
- `app/.server/` and `app/.client/` are RR convention dirs (included by tsconfig); we don't use them yet but they exist as escape hatches if a module must be one-sided.
- Errors flow through `app/lib/errors.ts`: typed classes (`Unauthorized`, `InvalidPayload`, `PayloadTooLarge`, `RateLimited`, `PathEscapeError`) → `toErrorResponse(err)` maps to JSON with the right HTTP status. Throw these from actions; don't hand-roll `new Response(…, { status: 400 })`.

## Deployment

- **pm2** via `ecosystem.config.cjs`: app name `dosbox`, runs `react-router-serve build/server/index.js` from `/home/gcjjyy/dosbox`, reads `.env` at startup, restarts at 512 MB.
- **nginx** config in `nginx/dosbox.gcjjyy.dev.conf` proxies to `127.0.0.1:5301`. `client_max_body_size 256m` accommodates large save uploads.
- Behind Cloudflare — see the `no-transform` note above before changing bundle response headers.

## Git hooks

`core.hooksPath` is wired to `.githooks` at the **repo-local** level (`git config --local core.hooksPath .githooks`), which overrides whatever global hooksPath the developer has set. The two installed hooks:

- `.githooks/pre-commit` auto-bumps `package.json`'s patch version on every commit (skips during rebase / merge / cherry-pick, and skips when the commit already touches the `version` field). **Do not bump the patch version manually** — the hook will detect your manual bump and skip its own.
- `.githooks/post-commit` is a shim that re-invokes `~/.claude/git-hooks/post-commit` (the QuickBASIC 4.5 auto-logger) when present. The local hooksPath would otherwise hide it.

If you cloned fresh and the hooks aren't firing, re-run `git config --local core.hooksPath .githooks` once.
