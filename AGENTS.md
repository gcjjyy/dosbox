# Repository Guidelines

## Project Structure & Module Organization

This is a React Router v7 SSR TypeScript app that runs a self-built DOSBox
0.74-3 WebAssembly runtime in the browser. UI lives in `app/components/`, routes
in `app/routes/`, and shared logic in `app/lib/`. Static runtime assets are in
`public/`, including `public/wasm/dosbox0743.{js,wasm}` and the audio worklet.
Tests sit beside code as `*.test.ts`, mostly under `app/lib/`.

## Build, Test, and Development Commands

- `npm install` installs dependencies. Node `>=20` is required.
- `npm run dev` starts the dev server at `http://localhost:5173`.
- `npm run build` creates the production build in `build/`.
- `npm start` serves `build/server/index.js`.
- `npm run typecheck` runs React Router typegen and `tsc`.
- `npm run test` runs Vitest once; use `npm run test:watch` while iterating.

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

## Configuration & Safety Notes

Runtime configuration is provided through `.env`: `DOS_ROOT`,
`DOSBOX_ADMIN_PASSWORD`, `SESSION_SECRET`, optional `DOSBOX_CACHE_DIR`, and
production `PORT`. Server filesystem writes must continue through the safe path
and save helpers. The server depends on system `zip(1)` for large DOS bundles.
