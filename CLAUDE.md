# CLAUDE.md

This file provides guidance to Claude Code when working in this repository.

## What This App Is

Single-tenant React Router v7 SSR app that boots a Korean-era MS-DOS tree
(`~/dos`) in the browser using this repo's self-built DOSBox 0.74-3 WebAssembly
runtime in `public/wasm/`. Public visitors can play read-only. A shared admin
password unlocks server-side saves back into `DOS_ROOT`, and each browser also
has a localStorage save overlay.

## Project Structure & Module Organization

This is a React Router v7 SSR TypeScript app that runs a self-built DOSBox
0.74-3 WebAssembly runtime in the browser. UI lives in `app/components/`, routes
in `app/routes/`, and shared logic in `app/lib/`. Static runtime assets are in
`public/`, including `public/wasm/dosbox0743.{js,wasm}` and the audio worklet.
Tests sit beside code as `*.test.ts`, mostly under `app/lib/`. Node `>=20` is
required.

## Commands

```bash
npm install
npm run dev         # React Router dev server at http://localhost:5173
npm run build       # production build in build/
npm start           # react-router-serve ./build/server/index.js
npm run typecheck   # react-router typegen && tsc
npm run test        # vitest run
npm run test:watch
```

System `zip(1)` is a runtime dependency. `app/lib/bundle.ts` shells out to it
to produce the large DOS file ZIP served at `/dos.zip`.

## Required Env

`.env` is gitignored.

- `PORT` defaults to 5301 in production.
- `DOS_ROOT` defaults to `~/dos`.
- `DOSBOX_ADMIN_PASSWORD` is the shared admin password.
- `SESSION_SECRET` must be at least 32 characters.
- `DOSBOX_CACHE_DIR` optionally overrides the bundle cache directory.

## Architecture

```
Browser -> nginx -> React Router server -> DOS_ROOT
```

- Client downloads `/wasm/dosbox0743.js` and `/wasm/dosbox0743.wasm`.
- `/dos.zip` streams the DOS files only.
- `/dosbox.conf` serves runtime configuration separately.
- `app/lib/dos-emulator.ts` loads `createDosbox()`, extracts `/dos.zip` into
  MEMFS `/c`, writes `/dosbox.conf`, starts DOSBox, and owns input/audio/save
  glue.

## Module Map

| Concern | File | Notes |
|---|---|---|
| Paths | `app/lib/dos-paths.ts` | `resolveSafe()` guards all writes under `DOS_ROOT`. |
| Bundle/config | `app/lib/bundle.ts` | Builds `/dos.zip`; exports `DOSBOX_CONF` and config ETag. |
| Runtime | `app/lib/dos-emulator.ts` | WASM loader, MEMFS extraction, input, mouse, audio, save diff. |
| Routes | `app/routes.ts` | `/`, `/dos.zip`, `/dosbox.conf`, auth, save API. |
| Save API | `app/routes/api.save.tsx` | Accepts changed-file ZIPs and applies them safely. |
| User save | `app/lib/user-state.ts` | Base64 ZIP in localStorage under `dosbox-user-state`. |
| Audio | `public/dos-audio-processor.js` | Same-origin AudioWorklet module. |
| Keyboard | `app/lib/dos-keymap.ts` | Stable virtual-key constants used by the on-screen keyboard. |

## Save Semantics

`CommandInterface.persist(true)` returns a ZIP containing files changed since
boot. Admin save posts that ZIP to `/api/save`, which writes into `DOS_ROOT` and
rebuilds the server bundle. User save stores the same ZIP in localStorage and
layers it over `/c` at the next boot. Deletions are not represented as a diff;
the current save model persists changed or created files.

## Coding Style & Naming Conventions

Use strict TypeScript and React function components. Match local style:
two-space indentation, semicolons, named exports for shared helpers, and
descriptive camelCase identifiers. Use the `~/*` alias for `app/*` imports.
Keep server-only code in `*.server.ts` modules and out of client components.
Route types come from generated `./+types/<route>` modules.

## Testing Guidelines

Vitest is the test runner. Add focused tests beside changed logic using the
existing `*.test.ts` pattern, for example `app/lib/bundle.test.ts`. Prefer small
unit tests for path safety, payload validation, key mapping, options, and
bundle behavior. Run `npm run test`; run `npm run typecheck` after route or
import changes.

## Commit & Pull Request Guidelines

Recent commits use Conventional Commit style with scopes, such as
`fix(dosbox): ...`, `feat(vkb): ...`, and `chore(scripts): ...`. Keep messages
imperative and specific. Pull requests should describe the user-visible change,
note tests run, link related issues or docs, and include screenshots for UI
changes. If you manually bump `package.json`, the pre-commit hook should skip
its own patch bump.

## Input Notes

`DOSBOX_CONF` sets `[sdl] usescancodes=false` because the browser SDL layer does
not provide native scancodes compatible with DOSBox 0.74's default mapper path.
Mouse lock is disabled (`autolock=false`) so absolute canvas coordinates are
forwarded consistently in browser mode.

## Deployment

Production runs with pm2 using `ecosystem.config.cjs`, app name `dosbox`, and
nginx proxy config in `nginx/dosbox.gcjjyy.dev.conf`. Standard deploy on
`pcnhost`:

```bash
cd ~/lab/dosbox
git fetch origin
git reset --hard origin/main
npm install
npm run build
pm2 restart dosbox
```

## Git Hooks

`core.hooksPath` is repo-local `.githooks`. The pre-commit hook can bump patch
versions automatically unless the commit already changes the `version` field.
