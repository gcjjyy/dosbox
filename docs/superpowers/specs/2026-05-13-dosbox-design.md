# dosbox.gcjjyy.dev — Design Spec

**Date:** 2026-05-13
**Author:** brainstorming session with gcjjyy
**Status:** Approved (pending written-spec review)

## 1. Purpose

`dosbox.gcjjyy.dev` is a single-host web app that runs the contents of `~/dos`
(a real Korean-era MS-DOS environment, ~231 MB / 7,574 files / 231 dirs) inside
a browser via **js-dos v8**. Anyone on the internet may load the page and play,
explore, or hack on the DOS system. Only the authenticated administrator
(the host's owner) may **persist** changes back to the server filesystem
through an explicit **Save** action.

## 2. Goals & Non-goals

### Goals
- Single page, one URL, no navigation chrome.
- `~/dos` mounted as the DOS C: drive in js-dos.
- Read-only access for everyone; admin-only writes that survive on disk.
- Save action is **explicit** (button click), not automatic.
- Match the existing nginx + React Router v7 + pm2 deployment pattern used
  by `hwangsa.gcjjyy.dev` and `pungwoayi.gcjjyy.dev`.

### Non-goals (YAGNI)
- Multi-user accounts / role hierarchy. Single admin only.
- Real-time multi-client sync. Only one writer (admin).
- File browser UI outside the emulator (no separate "file manager" view).
- Cloud storage / Sockdrive integration.
- Automatic sync, debounce, beforeunload save. Explicit button only.
- CSRF tokens (SameSite=Lax + Origin check is sufficient for this threat model).
- Rich logging frameworks. `console.log` via pm2 is enough.

## 3. Architecture

```
Browser  ──HTTPS──►  nginx (443)  ──proxy_pass──►  RR v7 server (127.0.0.1:5301)  ──fs──►  ~/dos
```

- **nginx**: TLS termination, identical pattern to existing siblings, plus
  `client_max_body_size 256m` for save uploads.
- **App**: React Router v7 (already scaffolded) running under pm2.
- **Filesystem**: Server reads & writes `~/dos` directly with `fs/promises`.
  All paths pass through `resolveSafe()` (see §6.1).

### Access matrix

| Route                | Method | Guest | Admin |
|----------------------|--------|-------|-------|
| `/`                  | GET    | ✅    | ✅    |
| `/dos.jsdos`         | GET    | ✅    | ✅    |
| `/api/login`         | POST   | ✅    | ✅    |
| `/api/logout`        | POST   | ✅    | ✅    |
| `/api/save`          | POST   | ❌ 401 | ✅    |

## 4. Components

### Directory layout

```
app/
├─ routes/
│  ├─ _index.tsx            ← landing page, loader returns {isAdmin}
│  ├─ dos[.]jsdos.tsx       ← streams ~/dos as a .jsdos bundle (ETag-cached)
│  ├─ api.login.tsx         ← password → session
│  ├─ api.logout.tsx
│  └─ api.save.tsx          ← multipart writes/deletes; requireAdmin
├─ components/
│  ├─ DosFrame.tsx          ← embeds js-dos, exposes ci
│  ├─ Toolbar.tsx           ← title + [Login]/[Logout] + [Save]
│  └─ LoginModal.tsx
├─ lib/
│  ├─ dos-paths.ts          ← DOS_ROOT + resolveSafe()
│  ├─ bundle.ts             ← streamJsdosBundle(res) — archiver-based zip
│  ├─ manifest.ts           ← (optional) listManifest() for debugging
│  ├─ auth.ts               ← iron-session helpers, requireAdmin
│  ├─ apply-changes.ts      ← atomic write/delete loop
│  ├─ fs-diff.ts            ← client-side: snapshot + diff
│  └─ save.ts               ← client-side: builds FormData, POSTs /api/save
├─ app.css
├─ root.tsx
└─ routes.ts

docs/superpowers/specs/2026-05-13-dosbox-design.md   ← this file
ecosystem.config.cjs                                  ← pm2 entry
/etc/nginx/conf.d/dosbox.gcjjyy.dev.conf              ← nginx (system-wide)
```

### Module responsibilities (single-purpose)

| Module | Owns | Depends on |
|---|---|---|
| `dos-paths.ts` | `DOS_ROOT`, `resolveSafe()` | `node:path`, `node:os` |
| `bundle.ts` | Streaming `.jsdos` zip generation, ETag computation | `archiver`, `dos-paths`, `node:fs` |
| `auth.ts` | Session cookie, password compare, rate limit, `requireAdmin` | `iron-session`, `node:crypto` |
| `apply-changes.ts` | Atomic write (`tmp` + `rename`), delete (idempotent), result summary | `dos-paths`, `node:fs` |
| `fs-diff.ts` | `snapshotFsTree(ci)`, `computeDiff(ci, baseline)` | js-dos `ci` interface |
| `save.ts` | Build FormData, POST `/api/save`, parse result | `fetch` |
| `DosFrame.tsx` | Mount/unmount js-dos, expose `ci` via ref | `js-dos` global / npm |
| `Toolbar.tsx`, `LoginModal.tsx` | UI only | none |

### New dependencies

| Package | Purpose |
|---|---|
| `js-dos` (^8.3.20) | DOS emulator (npm or `<script>`) |
| `iron-session` | Encrypted session cookie |
| `archiver` | Stream zip for `.jsdos` bundle |
| `zod` | Validate save payload |
| `vitest` (dev) | Unit/integration tests |

## 5. Data Flow

### 5.1 Boot

```
1. GET /
   ├─ loader → reads session cookie → returns {isAdmin: bool}
   └─ Returns SSR HTML with React shell
2. Client mounts <DosFrame>
   ├─ Loads js-dos library (script tag or import)
   └─ Dos(el, { url: "/dos.jsdos", dosboxConf })
3. GET /dos.jsdos
   ├─ Server computes etag = sha256(sorted "${path}:${mtime}:${size}\n"…)
   │  cached in-memory for 5 seconds (TTL)
   ├─ If-None-Match matches → 304
   └─ Else archiver streams: walks ~/dos, adds files to zip,
      prepends ".jsdos/dosbox.conf" (autoexec: `mount C ./ ; C:`)
4. js-dos extracts bundle in browser, boots DOS, runs AUTOEXEC.BAT
5. Client: baseline = snapshotFsTree(ci)
   = Map<path, {size: number}> built from ci.fsTree() walk
```

**dosbox.conf** (server-generated, embedded in bundle):
```ini
[autoexec]
@ECHO OFF
IF EXIST AUTOEXEC.BAT CALL AUTOEXEC.BAT
```
js-dos automatically mounts the bundle root as `C:` (the FS root of the
emulator). The `~/dos/AUTOEXEC.BAT` that ships with the user's DOS environment
is preserved as a regular file inside the bundle; we explicitly `CALL` it from
`[autoexec]` so its `PATH`/`SET` lines run on every boot. Implementation must
verify this works in js-dos v8; if `CALL` is missing or behavior differs,
the conf is the only thing to adjust.

**ETag invalidation**: in-memory cache uses a 5-second TTL. After
`/api/save` succeeds, the cache is also explicitly invalidated. No filesystem
watcher (yagni).

### 5.2 Save

```
1. User clicks [Save] (admin only, button disabled if no changes)
2. Client computes diff:
   - current = await ci.fsTree() → flatten to Map<path, {size}>
   - writes = [path for path in current
                if path not in baseline
                or current[path].size !== baseline[path].size]
   - deletes = [path for path in baseline if path not in current]
   - For each write path: await ci.fsReadFile(path) → Uint8Array
     (sequential — js-dos limitation)
3. Build FormData:
   - "deletes" = JSON.stringify(deletes)
   - "writes" = File[]  (filename = relative DOS path)
4. POST /api/save with cookie
5. Server:
   - requireAdmin → 401 if not
   - Validate Origin header matches host
   - zod-validate the form
   - For each path: resolveSafe(path)
   - writes: write to tmp/.save-<uuid>-<i>, then fs.rename → final
   - deletes: fs.unlink (ENOENT treated as success)
   - Invalidate bundle ETag cache
   - Reply: {applied: string[], failed: {path, reason}[]}
6. Client:
   - Toast: "<N>개 저장됨" + failed list if any
   - baseline += applied paths' new sizes (failed paths remain in baseline
     for retry on next save)
```

### 5.3 Login / Logout

```
POST /api/login {password}
  → timingSafeEqual against env DOSBOX_ADMIN_PASSWORD
  → on success: session.isAdmin = true; session.save()
  → Set-Cookie: __dosbox_session=...; HttpOnly; Secure; SameSite=Lax
  → reload page

POST /api/logout
  → session.destroy()
  → reload page
```

## 6. Security

### 6.1 Path safety — `resolveSafe()`

```ts
export const DOS_ROOT = process.env.DOS_ROOT
  ? path.resolve(process.env.DOS_ROOT)
  : path.join(os.homedir(), "dos");

export function resolveSafe(relPath: string): string {
  const normalized = relPath.replace(/\\/g, "/");
  const absolute = path.resolve(DOS_ROOT, normalized);
  const rel = path.relative(DOS_ROOT, absolute);
  if (rel.startsWith("..") || path.isAbsolute(rel))
    throw new PathEscapeError(relPath);
  if (rel.split("/").some(c => c === "" || /[\x00-\x1f]/.test(c)))
    throw new PathEscapeError(relPath);
  return absolute;
}
```

**Applied at**: every write/delete in `apply-changes.ts`. The bundle
generator walks `~/dos` directly so it does not consume user input. Symlinks
inside `~/dos` are detected with `fs.lstat` and **skipped** (not added to
zip, not writable).

### 6.2 Auth — iron-session

- Cookie: `__dosbox_session`, `HttpOnly`, `Secure`, `SameSite=Lax`,
  `Path=/`, `maxAge=30d`.
- Secret: `SESSION_SECRET` env (32+ random bytes).
- Password compare: pad to fixed length + `crypto.timingSafeEqual` + final
  strict equality (to defeat padding bypass).
- Rate limit: `Map<ip, {count, resetAt}>` in memory — 10 login attempts /
  minute / IP. Resets on process restart (acceptable for single-admin app).

### 6.3 CSRF / Origin

- `SameSite=Lax` blocks cross-site automatic POSTs.
- `/api/save` and `/api/login` additionally check `Origin` header equals
  `https://dosbox.gcjjyy.dev`. Reject with 400 otherwise.
- No CSRF token (out of scope).

### 6.4 Upload limits

- nginx: `client_max_body_size 256m;`
- App: reject multipart > 256 MB or > 2,000 files.
- Per-file limit: 64 MB.

### 6.5 Logging

`console.log` / `console.error` via pm2. Log these events:

- Login attempt (success/failure, IP, timestamp).
- Save action (admin, write count, delete count, applied/failed counts).
- 5xx errors with stack.

**Never log**: passwords, session secrets, full file contents, absolute
host paths in error responses (only in server-side logs).

## 7. Deployment

### 7.1 Port

`PORT=5301` (3864 and 7492 already taken by hwangsa / pungwoayi).

### 7.2 nginx

`/etc/nginx/conf.d/dosbox.gcjjyy.dev.conf`:

```nginx
server {
    listen 443 ssl;
    server_name dosbox.gcjjyy.dev;

    ssl_certificate     /etc/letsencrypt/live/gcjjyy.dev/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/gcjjyy.dev/privkey.pem;

    access_log /var/log/nginx/dosbox.access.log;
    error_log  /var/log/nginx/dosbox.error.log;

    client_max_body_size 256m;

    location / {
        proxy_pass http://127.0.0.1:5301;

        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;

        proxy_http_version 1.1;
        proxy_set_header Connection "";

        proxy_read_timeout 300;
        proxy_connect_timeout 300;
        proxy_send_timeout 300;
    }
}
```

Apply: `sudo nginx -t && sudo systemctl reload nginx`

### 7.3 pm2

`/home/gcjjyy/dosbox/ecosystem.config.cjs`:

```js
module.exports = {
  apps: [{
    name: "dosbox",
    script: "node_modules/.bin/react-router-serve",
    args: "./build/server/index.js",
    cwd: "/home/gcjjyy/dosbox",
    env: {
      PORT: "5301",
      DOS_ROOT: "/home/gcjjyy/dos",
    },
    env_file: "/home/gcjjyy/dosbox/.env",
    max_memory_restart: "512M",
    restart_delay: 3000,
  }],
};
```

`/home/gcjjyy/dosbox/.env` (gitignored, mode 600):

```
DOSBOX_ADMIN_PASSWORD=<strong password>
SESSION_SECRET=<openssl rand -base64 32>
```

Commands:

```
npm install
npm run build
pm2 start ecosystem.config.cjs
pm2 save
```

Update:

```
git pull && npm install && npm run build && pm2 restart dosbox
```

## 8. Error handling

### 8.1 Server response taxonomy

| Class | Status | Body |
|---|---|---|
| Success | 2xx | intended payload |
| Client error | 400 / 401 / 413 | `{error: code, message: string}` (no paths) |
| Server error | 500 | `{error: "internal"}` (details in logs) |

Error classes in `app/lib/errors.ts`:
- `PathEscapeError` → 400 `"invalid_path"`
- `InvalidPayload` → 400 `"invalid_payload"`
- `Unauthorized` → 401 `"unauthorized"`
- `PayloadTooLarge` → 413 `"too_large"`

A single `try/catch` in each action maps these to responses.

### 8.2 Partial save failure

Save is **not** transactional across files. Policy:
- Each write is per-file atomic (`tmp` + `rename`).
- One file failing does **not** abort the rest.
- Response: `{applied: [paths…], failed: [{path, reason}…]}`.
- Client baseline updates **only** for `applied` paths. Failed paths remain
  unsynced and become candidates for the next save.
- Delete of a non-existent file → counted as `applied` (idempotent).

### 8.3 Client error UX

- js-dos boot fails / `/dos.jsdos` 5xx → ErrorBoundary shows "DOS 에뮬레이터를
  불러오지 못했습니다. 새로고침 해보세요."
- Save in flight → button disabled + spinner, `beforeunload` warning.
- `fsReadFile` per-file failure → skip that file, toast "X개 파일 읽기 실패,
  나머지만 저장하시겠습니까?"
- No changes → save button disabled.

## 9. Testing

Tests use **vitest**. Priority order:

| Module / route | Type | Why |
|---|---|---|
| `dos-paths.resolveSafe` | unit | Most security-critical — must reject `..`, abs paths, `\\`, NUL, control chars |
| `apply-changes` | unit + tmpdir | Atomicity, idempotent delete, partial failure reporting |
| `fs-diff` | unit | Correct add/modify/delete classification, same-size edge case |
| `bundle.streamJsdosBundle` | integration | Validates zip with `yauzl`, checks `.jsdos/dosbox.conf` present |
| `auth.login` | unit | Timing-safe compare, rate limit |
| `/api/save` route | integration | Auth, Origin, multipart parsing, error mapping |
| E2E (browser) | manual | Boot → modify → save → reload → still there |

### Manual ops checklist (post-deploy)

- [ ] Wrong password login → 401, logged
- [ ] Guest POST `/api/save` → 401
- [ ] `path: "../../etc/passwd"` in save payload → 400, no fs change
- [ ] Edit a small file, save, reload → change persists
- [ ] Delete a file, save → file gone from `~/dos`
- [ ] No changes + save → button disabled / no-op
- [ ] Bundle ETag: second `/dos.jsdos` request returns 304

## 10. Open questions (deferred)

- **Diff performance**: `fsTree` over 7,574 files — first measure, optimize
  only if measurably slow. Possible optimizations: web worker, batching,
  size+mtime instead of size-only.
- **Bundle size**: 231 MB raw → expected 80-120 MB zipped. If too slow on
  cold load, consider precomputing the zip on the filesystem instead of
  streaming.
- **Korean filenames / CP949**: `~/dos` directory names appear ASCII;
  in-file Korean content is the program's problem, not ours. Revisit only
  if files with non-ASCII names appear.

## 11. Out of scope (explicitly)

- File browser UI / file manager view (decided: js-dos only).
- Game Studio / `.jsdos` authoring features.
- Sockdrive integration.
- Multi-admin or per-user dos environments.
- Auto-save, debounced sync, beforeunload sync.
- systemd unit (decided: pm2 only).
- CSRF tokens (SameSite + Origin sufficient).
