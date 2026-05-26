# Repository Guidelines

## Project Structure & Module Organization

This is a React Router v7 SSR TypeScript app for running a js-dos DOSBox environment in the browser. Application code lives in `app/`: UI in `app/components/`, routes in `app/routes/`, and shared logic in `app/lib/`. Unit tests sit beside code as `*.test.ts`, mainly under `app/lib/`. Static browser assets are in `public/`, including the audio worklet. Operational files live in `nginx/`, `ecosystem.config.cjs`, and `docs/superpowers/`. Do not hand-edit generated output such as `build/` or `public/js-dos/`.

## Build, Test, and Development Commands

- `npm install` installs dependencies. Node `>=20` is required.
- `npm run dev` copies js-dos files, then starts the dev server at `http://localhost:5173`.
- `npm run build` copies js-dos files and creates the production build in `build/`.
- `npm start` serves `build/server/index.js` for production-style local runs.
- `npm run typecheck` runs React Router type generation and `tsc`; run it after route changes.
- `npm run test` runs Vitest once. Use `npm run test:watch` while iterating.

## Coding Style & Naming Conventions

Use TypeScript with strict types and React function components. Match the surrounding style: two-space indentation, semicolons, named exports for shared helpers, and descriptive camelCase identifiers. Use the `~/*` alias for `app/*` imports. Keep server-only code in `*.server.ts` modules and out of client-reachable components. Route types come from generated `./+types/<route>` modules.

## Testing Guidelines

Vitest is the test runner. Add focused tests beside changed logic using the existing `*.test.ts` pattern, for example `app/lib/origin.test.ts`. Prefer small unit tests for path safety, payload validation, key mapping, options, and bundle behavior. Run `npm run test` before handoff; run `npm run typecheck` when routes or imports change.

## Commit & Pull Request Guidelines

Recent commits use Conventional Commit style with scopes, such as `fix(dosbox): ...`, `feat(vkb): ...`, and `chore(scripts): ...`. Keep messages imperative and specific. Pull requests should describe the user-visible change, note tests run, link related issues or docs, and include screenshots for UI changes. Do not manually bump `package.json` versions; the repo-local pre-commit hook handles patch bumps.

## Configuration & Safety Notes

Runtime configuration is provided through `.env`: `DOS_ROOT`, `DOSBOX_ADMIN_PASSWORD`, `SESSION_SECRET`, optional `DOSBOX_CACHE_DIR`, and production `PORT`. Server filesystem writes must continue to flow through the existing safe path and save helpers. The server depends on system `zip(1)` for js-dos-compatible bundles; do not replace it with a Node ZIP library without validating emulator extraction.
