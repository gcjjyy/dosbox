# Self-Built DOSBox WASM Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the `js-dos@^8.3.20` npm dependency with an in-tree, self-built DOSBox 0.74-3 WebAssembly build, eliminating `public/js-dos/` from the deployed bundle.

**Architecture:** Docker + Emscripten 3.1.74 toolchain builds DOSBox 0.74-3 (vanilla mainline) into `public/wasm/wdosbox.wasm` + `wdosbox.js`, committed to git. A minimal TypeScript wrapper at `app/lib/wasm-dosbox/` replaces `emu.dosboxXDirect(...)` with `createEmulator(...)`. Bundle (`*.jsdos` zip) extraction is handled by `fflate` (pure JS, no WASM dependency). The 4-phase boot pipeline (wait/download/extract/boot), WebGL renderer, and AudioWorklet are preserved.

**Tech Stack:** Docker, Emscripten 3.1.74, DOSBox 0.74-3 (vanilla, GPL-2.0), SDL1 + Asyncify, TypeScript 5.x, `fflate ^0.8.x`, React Router 7, Vitest.

**Reference materials (read-only during execution):**
- Spec: `docs/superpowers/specs/2026-05-19-self-built-dosbox-wasm-design.md`
- Existing emulator glue: `app/lib/dos-emulator.ts` (~500 lines, current `dosboxXDirect` call site at line 217)
- caiiiycuk/emulators repo (`https://github.com/caiiiycuk/emulators`) — Asyncify + SDL1 build patterns
- js-dos/dosbox repo (`https://github.com/js-dos/dosbox`) — already-patched DOSBox 0.74-2 source, study for patch ideas (do NOT vendor)
- DOSBox 0.74-3 source: `https://sourceforge.net/projects/dosbox/files/dosbox/0.74-3/`
- Emscripten Asyncify docs: `https://emscripten.org/docs/porting/asyncify.html`

---

## File Structure

**To create:**
```
scripts/wasm/
├── Dockerfile                                    # Build container definition
├── build.sh                                      # Build orchestration script
├── verify-wasm.sh                                # SHA256 verification
├── README.md                                     # Build guide + license notes
├── dosbox-0.74-3.tar.gz                          # Vendored mainline source (~3 MB)
├── dosbox-0.74-3.tar.gz.sha256                   # SHA256 of the tarball
├── expected-hashes.txt                           # SHA256 of public/wasm/* artifacts
└── patches/
    ├── 01-emscripten-build.diff                  # Makefile/configure for emcc
    ├── 02-sdl1-asyncify.diff                     # SDL1 + Asyncify main loop
    └── 03-fs-glue.diff                           # MEMFS glue + JS callbacks

public/wasm/
├── wdosbox.wasm                                  # Build artifact, ~1.4 MB, git committed
└── wdosbox.js                                    # Build artifact, emscripten loader

app/lib/wasm-dosbox/
├── types.ts                                      # CommandInterface, BackendOptions
├── module-loader.ts                              # Polls window.createDosbox
├── bundle-fs.ts                                  # fflate → Module.FS
├── frame-bus.ts                                  # HEAPU8 → RGBA
├── audio-bus.ts                                  # HEAPF32 → Float32Array
├── input.ts                                      # sendKey/mouse/exit
└── index.ts                                      # Public API: createEmulator(...)

app/lib/wasm-dosbox/bundle-fs.test.ts
app/lib/wasm-dosbox/frame-bus.test.ts
app/lib/wasm-dosbox/audio-bus.test.ts
app/lib/wasm-dosbox/input.test.ts
```

**To modify:**
```
app/root.tsx                                      # 1 line: script src
app/components/DosFrame.tsx                       # ~3 lines: poll target rename
app/lib/dos-emulator.ts                           # ~10 lines: call site swap (line 210-217)
package.json                                      # Remove js-dos, add fflate, remove copy-jsdos
.gitignore                                        # Remove public/js-dos/, add scripts/wasm/.build/
```

**To delete (after migration is verified):**
```
public/js-dos/                                    # No longer generated
```

---

## Phase 0 — Worktree setup

### Task 0: Create isolated worktree

**Files:**
- None yet (preparing workspace)

- [ ] **Step 1: Invoke worktree skill** — use `superpowers:using-git-worktrees` to create isolated branch `feat/self-built-wasm` rooted at `~/dosbox`. From this point on, all file paths in tasks below refer to paths inside the worktree.

- [ ] **Step 2: Verify clean baseline**

```bash
git status
# Expected: clean (any in-progress install-game.ts work stays in main, not this worktree)
git log --oneline -1
# Expected: most recent commit on main, including the spec we committed at 1072a7c
```

- [ ] **Step 3: Confirm Docker available**

```bash
docker info | head -5
# Expected: Server Version, Storage Driver, etc.
docker pull emscripten/emsdk:3.1.74
# Expected: pull succeeds (~1.5 GB image)
```

If docker not available, install Docker Desktop before proceeding.

---

## Phase A — Build infrastructure (files, no patches yet)

### Task A1: Vendor DOSBox 0.74-3 source

**Files:**
- Create: `scripts/wasm/dosbox-0.74-3.tar.gz`
- Create: `scripts/wasm/dosbox-0.74-3.tar.gz.sha256`

- [ ] **Step 1: Download DOSBox 0.74-3 from SourceForge**

```bash
mkdir -p scripts/wasm
curl -L -o scripts/wasm/dosbox-0.74-3.tar.gz \
  'https://sourceforge.net/projects/dosbox/files/dosbox/0.74-3/dosbox-0.74-3.tar.gz/download'
ls -lh scripts/wasm/dosbox-0.74-3.tar.gz
# Expected: ~2.9 MB file
```

- [ ] **Step 2: Capture SHA256**

```bash
shasum -a 256 scripts/wasm/dosbox-0.74-3.tar.gz > scripts/wasm/dosbox-0.74-3.tar.gz.sha256
cat scripts/wasm/dosbox-0.74-3.tar.gz.sha256
# Expected: a single line "<64 hex chars>  scripts/wasm/dosbox-0.74-3.tar.gz"
```

- [ ] **Step 3: Verify tarball integrity by extracting once locally**

```bash
mkdir -p /tmp/dosbox-vendor-test
tar -tzf scripts/wasm/dosbox-0.74-3.tar.gz | head -5
# Expected: starts with dosbox-0.74-3/, contains Makefile.am, configure.ac, src/, etc.
```

- [ ] **Step 4: Commit**

```bash
git add scripts/wasm/dosbox-0.74-3.tar.gz scripts/wasm/dosbox-0.74-3.tar.gz.sha256
git commit -m "build(wasm): vendor DOSBox 0.74-3 source tarball + SHA256"
```

---

### Task A2: Skeleton Dockerfile

**Files:**
- Create: `scripts/wasm/Dockerfile`

- [ ] **Step 1: Write the Dockerfile**

```dockerfile
# Build DOSBox 0.74-3 to WebAssembly via Emscripten.
# Pinned toolchain for reproducibility.

FROM emscripten/emsdk:3.1.74

WORKDIR /build

# Verify tarball integrity at build time.
COPY dosbox-0.74-3.tar.gz dosbox-0.74-3.tar.gz.sha256 ./
RUN sha256sum -c dosbox-0.74-3.tar.gz.sha256

# Extract.
RUN tar -xzf dosbox-0.74-3.tar.gz \
 && rm dosbox-0.74-3.tar.gz dosbox-0.74-3.tar.gz.sha256

WORKDIR /build/dosbox-0.74-3

# Apply patches in deterministic order (placeholder — patches added in Phase B).
COPY patches/ /build/patches/
RUN for p in /build/patches/[0-9]*.diff; do \
      echo "Applying $p"; \
      patch -p1 < "$p" || { echo "Patch failed: $p"; exit 1; }; \
    done

# Configure for emscripten (flags adjusted in patches).
RUN emconfigure ./configure \
      --host=wasm32 \
      --disable-sdltest \
      --without-x \
      --disable-debug

# Build. Single-job is intentional: DOSBox's Makefile race-conditions on parallel.
RUN emmake make -j1

# Final link with Asyncify flags + emscripten output.
# Exact CFLAGS/LDFLAGS provided by patch 02 inside Makefile.am, or by override here.
# The Makefile's `src/dosbox` link target produces wdosbox.js + wdosbox.wasm.

# Artifacts will be at /build/dosbox-0.74-3/src/wdosbox.{wasm,js}
```

- [ ] **Step 2: Commit (patches/ directory will be added in Phase B)**

```bash
git add scripts/wasm/Dockerfile
git commit -m "build(wasm): add Dockerfile skeleton (patches/ pending)"
```

Note: the `COPY patches/` line will fail until Phase B adds at least one `.diff`. That's intentional — we don't want a Dockerfile that "works" with zero patches; better to have it explicit.

---

### Task A3: Write `build.sh`

**Files:**
- Create: `scripts/wasm/build.sh`
- Modify: `scripts/wasm/` (chmod +x)

- [ ] **Step 1: Write `build.sh`**

```bash
#!/usr/bin/env bash
# scripts/wasm/build.sh
# Build DOSBox 0.74-3 WASM artifacts and copy them into public/wasm/.
#
# Usage:
#   ./scripts/wasm/build.sh           # Build using docker layer cache (1–2 min if cached)
#   ./scripts/wasm/build.sh --no-cache  # Force full rebuild (30–60 min)
#   ./scripts/wasm/build.sh --verify   # After build, compare SHA256 against expected-hashes.txt

set -euo pipefail

cd "$(dirname "$0")"  # scripts/wasm/
REPO_ROOT="$(cd ../.. && pwd)"
NO_CACHE=""
VERIFY=0
for arg in "$@"; do
  case "$arg" in
    --no-cache) NO_CACHE="--no-cache" ;;
    --verify)   VERIFY=1 ;;
    *) echo "Unknown flag: $arg"; exit 1 ;;
  esac
done

# Preflight checks
if ! command -v docker >/dev/null; then
  echo "Error: docker not found. Install Docker Desktop."
  exit 1
fi
if ! docker info >/dev/null 2>&1; then
  echo "Error: docker daemon not running."
  exit 1
fi
if [ ! -f dosbox-0.74-3.tar.gz ] || [ ! -f dosbox-0.74-3.tar.gz.sha256 ]; then
  echo "Error: vendored source missing. Run Task A1 first."
  exit 1
fi

# Verify tarball before Docker even starts
shasum -a 256 -c dosbox-0.74-3.tar.gz.sha256

IMAGE_TAG="dosbox-wasm-builder:latest"

echo "==> docker build (this can take 30-60 min cold, 1-2 min cached)"
docker build $NO_CACHE -t "$IMAGE_TAG" -f Dockerfile .

echo "==> extracting artifacts"
CID=$(docker create "$IMAGE_TAG")
trap 'docker rm -f "$CID" >/dev/null 2>&1 || true' EXIT

mkdir -p "$REPO_ROOT/public/wasm"
docker cp "$CID:/build/dosbox-0.74-3/src/wdosbox.wasm" "$REPO_ROOT/public/wasm/wdosbox.wasm"
docker cp "$CID:/build/dosbox-0.74-3/src/wdosbox.js"   "$REPO_ROOT/public/wasm/wdosbox.js"

# Sanity check artifact sizes
WASM_SIZE=$(stat -f%z "$REPO_ROOT/public/wasm/wdosbox.wasm" 2>/dev/null || stat -c%s "$REPO_ROOT/public/wasm/wdosbox.wasm")
if [ "$WASM_SIZE" -lt 800000 ]; then
  echo "Error: wdosbox.wasm is suspiciously small ($WASM_SIZE bytes)"
  exit 1
fi
echo "==> wdosbox.wasm: $WASM_SIZE bytes"

if [ "$VERIFY" -eq 1 ]; then
  echo "==> verifying against expected-hashes.txt"
  bash "$REPO_ROOT/scripts/wasm/verify-wasm.sh"
fi

echo "==> Done. Artifacts at public/wasm/"
```

- [ ] **Step 2: chmod + commit**

```bash
chmod +x scripts/wasm/build.sh
git add scripts/wasm/build.sh
git commit -m "build(wasm): add build.sh orchestrator"
```

---

### Task A4: Write `verify-wasm.sh`

**Files:**
- Create: `scripts/wasm/verify-wasm.sh`
- Create: `scripts/wasm/expected-hashes.txt` (initially empty, populated in Task C2)

- [ ] **Step 1: Write `verify-wasm.sh`**

```bash
#!/usr/bin/env bash
# Verify that public/wasm/*.{wasm,js} match the expected hashes pinned in
# scripts/wasm/expected-hashes.txt.
#
# Format of expected-hashes.txt (one line per file):
#   <sha256>  public/wasm/wdosbox.wasm
#   <sha256>  public/wasm/wdosbox.js

set -euo pipefail
cd "$(dirname "$0")/../.."  # repo root

if [ ! -s scripts/wasm/expected-hashes.txt ]; then
  echo "Error: scripts/wasm/expected-hashes.txt is empty. Populate it via build.sh first."
  exit 1
fi

shasum -a 256 -c scripts/wasm/expected-hashes.txt
```

- [ ] **Step 2: Create empty hashes file (will be populated in Task C2)**

```bash
touch scripts/wasm/expected-hashes.txt
```

- [ ] **Step 3: Commit**

```bash
chmod +x scripts/wasm/verify-wasm.sh
git add scripts/wasm/verify-wasm.sh scripts/wasm/expected-hashes.txt
git commit -m "build(wasm): add verify-wasm.sh and empty expected-hashes.txt"
```

---

### Task A5: Write `scripts/wasm/README.md`

**Files:**
- Create: `scripts/wasm/README.md`

- [ ] **Step 1: Write the README**

```markdown
# DOSBox 0.74-3 WASM build

Self-built WebAssembly DOSBox replacing the `js-dos` npm package.

## License

DOSBox is licensed under GPL-2.0. The resulting `wdosbox.wasm` and
`wdosbox.js` inherit GPL-2.0. Our patches in `patches/` are also
licensed GPL-2.0. The TypeScript wrapper at `app/lib/wasm-dosbox/`
is original work; see the repository root for its license.

## Toolchain

- Emscripten SDK **3.1.74** (pinned in `Dockerfile`)
- DOSBox **0.74-3** (vanilla mainline, vendored as `dosbox-0.74-3.tar.gz`)
- SDL1 + Asyncify (in-band main loop)

## Build

```
./scripts/wasm/build.sh                # Use docker layer cache (~1-2 min if cached)
./scripts/wasm/build.sh --no-cache     # Full rebuild (~30-60 min)
./scripts/wasm/build.sh --verify       # Build + verify SHA256 against expected-hashes.txt
```

Artifacts:
- `public/wasm/wdosbox.wasm` (~1.4 MB)
- `public/wasm/wdosbox.js` (emscripten loader, registers `window.createDosbox`)

Both files are git-committed. Production deploy does **not** need Docker;
only the developer who updates the WASM needs Docker on their machine.

## Patches

Applied in numeric order during the Docker build:

| Patch | Purpose |
|---|---|
| `01-emscripten-build.diff` | Makefile/configure changes to compile under emcc |
| `02-sdl1-asyncify.diff` | SDL1 main loop integration with Asyncify (`emscripten_sleep`) |
| `03-fs-glue.diff` | MEMFS glue: JS callbacks for frame, audio, input |

To modify the build, edit a patch (or add `04-*.diff`), then re-run
`./scripts/wasm/build.sh`. If patches fail to apply, the Docker build
aborts and stderr shows which `.diff` is broken.

## Reproducibility

`build.sh` verifies the source tarball SHA256 (`dosbox-0.74-3.tar.gz.sha256`)
before each build. Tampering with the vendored source aborts the build.

Pin `expected-hashes.txt` after a known-good build so CI / collaborators
can verify their artifacts match yours.

## Known limitations vs DOSBox-X

- No KSC5601 Hangul output → Korean DOS *tools* (HWP, 한메한글, etc.) will
  display garbled menus. Korean DOS *games* (which use their own font
  renderers) work normally.
- No Windows 9x IMGMOUNT → can't boot Windows-era game disk images.

These trade-offs were explicitly accepted in the design spec.
See `docs/superpowers/specs/2026-05-19-self-built-dosbox-wasm-design.md`.
```

- [ ] **Step 2: Commit**

```bash
git add scripts/wasm/README.md
git commit -m "build(wasm): add build documentation"
```

---

### Task A6: Add `npm run verify-wasm` script

**Files:**
- Modify: `package.json`

- [ ] **Step 1: Read current `package.json`** and locate the `scripts` block.

- [ ] **Step 2: Add `verify-wasm` to `scripts`**

Use `Edit` tool to insert this line into the `scripts` object, after the existing `test:watch` line (or any reasonable position):

```json
    "verify-wasm": "bash scripts/wasm/verify-wasm.sh",
```

- [ ] **Step 3: Confirm it works (will fail because expected-hashes.txt is empty — expected for now)**

```bash
npm run verify-wasm
# Expected: "Error: scripts/wasm/expected-hashes.txt is empty. Populate it via build.sh first."
# Exit code 1 — this is correct for now.
```

- [ ] **Step 4: Commit**

```bash
git add package.json
git commit -m "build(wasm): add npm run verify-wasm script"
```

---

## Phase B — DOSBox patches (iterative authorship)

This phase is **not** classic TDD — the patches are studied, drafted, applied during Docker build, observed for compile errors, and iteratively refined until the build succeeds. The acceptance criterion is **Phase C's Task C1 producing a runnable WASM**, not unit tests.

### Task B1: Research patches from reference repos

**Files:**
- Create: `scripts/wasm/patches/` directory
- Create: `scripts/wasm/patches/README.md` (notes for future maintainers)

- [ ] **Step 1: Read caiiiycuk/emulators source (cmake targets)**

```bash
# Look at the targets in caiiiycuk's build:
curl -s 'https://api.github.com/repos/caiiiycuk/emulators/contents/targets' | grep '"name"'
# Note: targets/dosbox-asyncify.txt + targets/dosbox.cmake are the relevant files.
curl -s 'https://raw.githubusercontent.com/caiiiycuk/emulators/main/targets/dosbox.cmake' > /tmp/ref-dosbox.cmake
curl -s 'https://raw.githubusercontent.com/caiiiycuk/emulators/main/targets/dosbox-asyncify.txt' > /tmp/ref-dosbox-asyncify.txt
cat /tmp/ref-dosbox.cmake /tmp/ref-dosbox-asyncify.txt | head -100
```

These reveal the emscripten flags (`-sASYNCIFY=1`, `-sASYNCIFY_STACK_SIZE`, `-sALLOW_MEMORY_GROWTH=1`, `-sEXPORT_NAME=createDosbox`, etc.) and the symbols that must be exported.

- [ ] **Step 2: Clone js-dos/dosbox at a tag to see already-patched 0.74-2 source**

```bash
mkdir -p /tmp/ref-jsdos-dosbox
git clone --depth 1 https://github.com/js-dos/dosbox.git /tmp/ref-jsdos-dosbox
# Compare against vendored 0.74-3:
mkdir -p /tmp/vanilla-0.74-3
tar -xzf scripts/wasm/dosbox-0.74-3.tar.gz -C /tmp/vanilla-0.74-3
# diff -urN /tmp/vanilla-0.74-3/dosbox-0.74-3 /tmp/ref-jsdos-dosbox > /tmp/jsdos-patches-vs-vanilla.diff
# (This diff will be very large — use it to identify hot files: src/dosbox.cpp, src/sdlmain.cpp, src/dos/drives.cpp, Makefile.am, configure.ac.)
```

- [ ] **Step 3: Document patch strategy in `scripts/wasm/patches/README.md`**

```markdown
# DOSBox 0.74-3 patches

Applied in numeric order during Docker build (see ../Dockerfile).

| File | Purpose | Touches |
|---|---|---|
| 01-emscripten-build.diff | Makefile.am + configure.ac changes so the build emits `wdosbox.js`/`wdosbox.wasm` from emcc with Asyncify flags | Makefile.am, src/Makefile.am, configure.ac |
| 02-sdl1-asyncify.diff | Replace SDL1's modal event loop with an Asyncify-friendly version that yields to JS each frame via `emscripten_sleep(0)` | src/sdlmain.cpp |
| 03-fs-glue.diff | Add EM_JS callbacks: `js_on_frame(ptr, w, h)`, `js_on_audio(samples_ptr, n_samples, sample_rate)`, `js_on_extract_progress(fraction)`; register them with DOSBox's render/mixer subsystems | src/sdlmain.cpp, src/gui/render.cpp, src/hardware/mixer.cpp (or equivalents — see comments) |

## Reference materials (do NOT vendor)

- caiiiycuk/emulators: build pattern, emcc flags, exported symbols
- js-dos/dosbox: already-patched 0.74-2 source (we re-derive patches against 0.74-3)
- Emscripten Asyncify guide: https://emscripten.org/docs/porting/asyncify.html

Patches are GPL-2.0 (inherited from DOSBox).
```

- [ ] **Step 4: Commit**

```bash
mkdir -p scripts/wasm/patches
git add scripts/wasm/patches/README.md
git commit -m "build(wasm): document patch strategy"
```

---

### Task B2: Write `patches/01-emscripten-build.diff`

**Files:**
- Create: `scripts/wasm/patches/01-emscripten-build.diff`

**Acceptance criterion (defers to Task C1):** With patch 01 applied, `emconfigure ./configure` succeeds inside the Dockerfile build. The final `emmake make` does not yet need to succeed — that's gated by patches 02 and 03.

- [ ] **Step 1: Apply vanilla source locally to study**

```bash
rm -rf /tmp/dosbox-work && mkdir /tmp/dosbox-work
tar -xzf scripts/wasm/dosbox-0.74-3.tar.gz -C /tmp/dosbox-work
cd /tmp/dosbox-work/dosbox-0.74-3
ls Makefile.am configure.ac src/Makefile.am
```

- [ ] **Step 2: Draft Makefile changes**

The vanilla DOSBox emits a native binary called `dosbox`. We need to rename it to `wdosbox` when building with emcc, and pass Asyncify flags. Reference caiiiycuk's cmake files for the exact flags. Save your changes into a working tree, e.g. `/tmp/dosbox-patched`, by editing files directly. Then generate the diff:

```bash
cp -a /tmp/dosbox-work/dosbox-0.74-3 /tmp/dosbox-patched
# Edit /tmp/dosbox-patched/Makefile.am, src/Makefile.am, configure.ac as needed
# Reference flags expected:
#   AM_CFLAGS += -sUSE_SDL=1
#   AM_LDFLAGS += -sASYNCIFY=1 -sASYNCIFY_STACK_SIZE=16384 -sALLOW_MEMORY_GROWTH=1
#                -sMODULARIZE=1 -sEXPORT_NAME=createDosbox -sENVIRONMENT=web
#                -sEXPORTED_FUNCTIONS='["_main","_send_key","_send_mouse","_exit_dosbox"]'
#                -sEXPORTED_RUNTIME_METHODS='["ccall","FS","HEAPU8","HEAPF32"]'
#                --bind  # if needed for any C++ → JS glue
# Output filename: bin/wdosbox  (Makefile rule renames .js/.wasm)
```

- [ ] **Step 3: Generate diff**

```bash
cd /tmp
diff -urN dosbox-work/dosbox-0.74-3 dosbox-patched | \
  grep -v '^Only in' > scripts/wasm/patches/01-emscripten-build.diff
# (Run from your worktree, with `scripts/wasm/` already existing.)
```

- [ ] **Step 4: Confirm apply-cleanness**

```bash
rm -rf /tmp/apply-test && mkdir /tmp/apply-test
tar -xzf scripts/wasm/dosbox-0.74-3.tar.gz -C /tmp/apply-test
cd /tmp/apply-test/dosbox-0.74-3
patch -p1 --dry-run < $(git rev-parse --show-toplevel)/scripts/wasm/patches/01-emscripten-build.diff
# Expected: "checking file Makefile.am ... patching file ... " (no failures)
```

- [ ] **Step 5: Run partial Docker build to verify emconfigure passes**

```bash
cd $(git rev-parse --show-toplevel)
./scripts/wasm/build.sh 2>&1 | tee /tmp/build-attempt-01.log | tail -50
# We expect emmake make to fail (patches 02/03 not yet applied),
# but emconfigure ./configure should succeed.
# Look for "config.status: creating Makefile" lines = configure success.
grep -E '(config.status: creating|configure: error)' /tmp/build-attempt-01.log
```

- [ ] **Step 6: Commit when patch 01 applies cleanly and configure passes**

```bash
git add scripts/wasm/patches/01-emscripten-build.diff
git commit -m "build(wasm): patch 01 — Makefile/configure for emscripten"
```

---

### Task B3: Write `patches/02-sdl1-asyncify.diff`

**Files:**
- Create: `scripts/wasm/patches/02-sdl1-asyncify.diff`

**Acceptance criterion:** With patches 01+02 applied, `emmake make` produces `src/wdosbox.js` and `src/wdosbox.wasm` (size > 800 KB). They may not yet do anything useful at runtime — that's patch 03's job — but linking succeeds.

- [ ] **Step 1: Identify DOSBox's main loop**

Inspect `src/sdlmain.cpp` for the modal `while(true)` event loop. The loop blocks on `SDL_WaitEvent` or busy-polls; under Asyncify we must yield to the JS event loop each iteration.

- [ ] **Step 2: Draft Asyncify integration**

Edit a copy of `src/sdlmain.cpp` to insert `emscripten_sleep(0)` (or `emscripten_sleep(1)` for explicit 1ms yield) inside the main loop. Wrap SDL_WaitEvent calls so they don't block indefinitely under emscripten.

Reference snippet (typical caiiiycuk pattern):

```cpp
#ifdef __EMSCRIPTEN__
#include <emscripten.h>
#endif

// In DOSBOX_RunMachine / SDL_main loop:
while (running) {
    // ... existing per-frame work ...
#ifdef __EMSCRIPTEN__
    emscripten_sleep(0);
#endif
}
```

- [ ] **Step 3: Generate diff** (same pattern as Task B2 step 3)

- [ ] **Step 4: Apply-test + Docker partial build**

```bash
./scripts/wasm/build.sh 2>&1 | tail -50
# Acceptance: emmake make produces wdosbox.js and wdosbox.wasm without error.
# File sizes:
docker run --rm dosbox-wasm-builder:latest ls -la /build/dosbox-0.74-3/src/wdosbox.{js,wasm}
# Expected: wdosbox.wasm > 800 KB
```

- [ ] **Step 5: Commit when linking succeeds**

```bash
git add scripts/wasm/patches/02-sdl1-asyncify.diff
git commit -m "build(wasm): patch 02 — SDL1 + Asyncify main loop"
```

---

### Task B4: Write `patches/03-fs-glue.diff`

**Files:**
- Create: `scripts/wasm/patches/03-fs-glue.diff`

**Acceptance criterion:** With all three patches, the built WASM, when loaded in a browser, produces a working DOSBox: `Module._main([])` (or `Module.callMain([])`) boots, and JS-side `Module.FS.writeFile` operations are visible to DOSBox as files on C:.

- [ ] **Step 1: Identify integration points**

Three integration points DOSBox needs from JS:

1. **Frame callback**: when DOSBox renders a frame, call `EM_JS(void, js_on_frame, (uint8_t* ptr, int w, int h, int stride), { ... });` — JS side stages it for the WebGL renderer.
2. **Audio callback**: when the mixer produces a chunk, call `EM_JS(void, js_on_audio, (float* samples, int count, int rate), { ... });`.
3. **Filesystem**: DOSBox's `C:` mount should map to `/dosbox/c/` in emscripten MEMFS. Patch the local drive implementation (`src/dos/drives.cpp` or `src/dos/drive_local.cpp`) to use the emscripten FS root.

- [ ] **Step 2: Draft patch**

Reference shape (sketch only — exact line numbers depend on 0.74-3 source):

```cpp
// src/sdlmain.cpp or src/gui/sdlmain.cpp:
#ifdef __EMSCRIPTEN__
#include <emscripten.h>

EM_JS(void, js_on_frame, (const uint8_t* ptr, int w, int h, int stride), {
  if (Module.onFrame) Module.onFrame(ptr, w, h, stride);
});

EM_JS(void, js_on_audio, (const float* samples, int n, int rate), {
  if (Module.onAudio) Module.onAudio(samples, n, rate);
});
#endif

// In GFX_BlitSurface or wherever DOSBox finalizes a frame:
#ifdef __EMSCRIPTEN__
js_on_frame((const uint8_t*)surface->pixels, surface->w, surface->h, surface->pitch);
#endif

// In Mixer_CallBack:
#ifdef __EMSCRIPTEN__
js_on_audio(buf, n_samples, mixer_freq);
#endif
```

- [ ] **Step 3: Generate diff + apply-test + run cold build**

```bash
./scripts/wasm/build.sh --no-cache 2>&1 | tee /tmp/build-attempt-03.log | tail -100
# This will take 30-60 min cold. Acceptance: build completes, wdosbox.wasm exists.
ls -lh public/wasm/wdosbox.wasm public/wasm/wdosbox.js
```

- [ ] **Step 4: Commit**

```bash
git add scripts/wasm/patches/03-fs-glue.diff
git commit -m "build(wasm): patch 03 — FS + frame + audio JS callbacks"
```

---

## Phase C — First successful build + hash pinning

### Task C1: Run cold build, validate artifacts

**Files:**
- Modify: `public/wasm/wdosbox.wasm`, `public/wasm/wdosbox.js` (newly generated)

- [ ] **Step 1: Cold rebuild for clean baseline**

```bash
./scripts/wasm/build.sh --no-cache 2>&1 | tee /tmp/build-cold.log
# Expected end of log: "==> Done. Artifacts at public/wasm/"
# Duration: 30-60 min, watch for OOM in Docker
```

- [ ] **Step 2: Inspect artifact sizes and basic validity**

```bash
ls -lh public/wasm/
# Expected: wdosbox.wasm ~1.4 MB, wdosbox.js ~100-200 KB
file public/wasm/wdosbox.wasm
# Expected: "WebAssembly (wasm) binary module"
head -c 200 public/wasm/wdosbox.js
# Expected: starts with emscripten-generated module header, contains "createDosbox" string
grep -o 'createDosbox' public/wasm/wdosbox.js | head -1
# Expected: prints "createDosbox"
```

- [ ] **Step 3: Smoke-load in a throwaway HTML file**

```bash
cat > /tmp/wasm-smoke.html <<'EOF'
<!DOCTYPE html>
<html><body>
<script src="/wasm/wdosbox.js"></script>
<script>
  window.addEventListener('load', async () => {
    console.log('createDosbox exists:', typeof window.createDosbox);
    if (typeof window.createDosbox === 'function') {
      console.log('SUCCESS: createDosbox is registered');
    } else {
      console.error('FAIL: createDosbox missing');
    }
  });
</script>
</body></html>
EOF
# Copy to public temp location, start dev server, open localhost:5173/wasm-smoke.html
# In browser console, expected: "SUCCESS: createDosbox is registered"
```

- [ ] **Step 4: Commit artifacts**

```bash
git add public/wasm/wdosbox.wasm public/wasm/wdosbox.js
git commit -m "build(wasm): commit first successful DOSBox 0.74-3 WASM build"
```

---

### Task C2: Pin expected SHA256 hashes

**Files:**
- Modify: `scripts/wasm/expected-hashes.txt`

- [ ] **Step 1: Generate hash lines**

```bash
cd $(git rev-parse --show-toplevel)
shasum -a 256 public/wasm/wdosbox.wasm public/wasm/wdosbox.js > scripts/wasm/expected-hashes.txt
cat scripts/wasm/expected-hashes.txt
# Expected: 2 lines like:
#   <64-hex>  public/wasm/wdosbox.wasm
#   <64-hex>  public/wasm/wdosbox.js
```

- [ ] **Step 2: Verify**

```bash
npm run verify-wasm
# Expected: "public/wasm/wdosbox.wasm: OK" / "public/wasm/wdosbox.js: OK"
```

- [ ] **Step 3: Commit**

```bash
git add scripts/wasm/expected-hashes.txt
git commit -m "build(wasm): pin expected artifact hashes"
```

---

## Phase D — Wrapper module (TDD)

### Task D1: `types.ts` (interfaces only, no test)

**Files:**
- Create: `app/lib/wasm-dosbox/types.ts`

- [ ] **Step 1: Read current `dos-emulator.ts` line 30-50 for the shapes already in use**

The wrapper must preserve these shapes so `dos-emulator.ts` keeps working with minimal change.

- [ ] **Step 2: Write the file**

```typescript
// app/lib/wasm-dosbox/types.ts
// Shapes for the self-built DOSBox WASM wrapper. These mirror the pre-existing
// js-dos contract so app/lib/dos-emulator.ts can call us with the same signature.

export interface BackendOptions {
  /** Called repeatedly as bundle entries are extracted. fraction is 0..1. */
  onExtract?: (fraction: number) => void;
  /** Called once per rendered frame. Buffer is a *view* into Module.HEAPU8 — copy if persisting. */
  onFrame?: (rgba: Uint8ClampedArray, width: number, height: number) => void;
  /** Called when an audio chunk is ready. samples and sampleRate are from the DOSBox mixer. */
  onAudio?: (samples: Float32Array, sampleRate: number) => void;
  /** Called when DOSBox prints to its console (debug / diagnostic). */
  onLog?: (line: string) => void;
  /** Called when DOSBox exits normally (rare in browser). */
  onExit?: () => void;
  /** Called when DOSBox emits an unrecoverable error. */
  onError?: (err: Error) => void;
}

export interface CommandInterface {
  sendKeyDown(keycode: number): void;
  sendKeyUp(keycode: number): void;
  sendMouseMotion(x: number, y: number): void;
  sendMouseButton(button: 0 | 1 | 2, pressed: boolean): void;
  /** Request DOSBox to exit. Resolves when the WASM main loop has terminated. */
  exit(): Promise<void>;
  /** The original sound sample rate DOSBox is producing, so the caller can resample if needed. */
  soundFrequency(): number;
}

/** Internal handle to the emscripten Module instance. Not exported via index.ts. */
export interface DosboxModule {
  FS: {
    writeFile(path: string, data: Uint8Array): void;
    mkdirTree(path: string): void;
    readFile(path: string): Uint8Array;
  };
  HEAPU8: Uint8Array;
  HEAPF32: Float32Array;
  ccall(name: string, returnType: string | null, argTypes: string[], args: unknown[]): unknown;
  callMain(argv: string[]): void;
  onAbort?: (what: string) => void;
  /** Set by our wrapper before callMain so EM_JS callbacks can find their handlers. */
  onFrame?: (ptr: number, w: number, h: number, stride: number) => void;
  onAudio?: (ptr: number, count: number, rate: number) => void;
  onExtractProgress?: (fraction: number) => void;
}

/** The global registered by wdosbox.js. */
export type CreateDosbox = (config: { canvas?: HTMLCanvasElement }) => Promise<DosboxModule>;

declare global {
  interface Window {
    createDosbox?: CreateDosbox;
  }
}
```

- [ ] **Step 3: Verify TypeScript compiles**

```bash
mkdir -p app/lib/wasm-dosbox
# (move file into place if you authored it elsewhere)
npm run typecheck
# Expected: no errors related to wasm-dosbox/types.ts
```

- [ ] **Step 4: Commit**

```bash
git add app/lib/wasm-dosbox/types.ts
git commit -m "feat(wasm-dosbox): add type definitions"
```

---

### Task D2: `bundle-fs.ts` (TDD)

**Files:**
- Create: `app/lib/wasm-dosbox/bundle-fs.test.ts`
- Create: `app/lib/wasm-dosbox/bundle-fs.ts`

- [ ] **Step 1: Install `fflate` dep**

```bash
npm install fflate@^0.8.0
# Verify it's in dependencies block of package.json (not devDependencies)
grep fflate package.json
```

- [ ] **Step 2: Write the failing test**

```typescript
// app/lib/wasm-dosbox/bundle-fs.test.ts
import { describe, it, expect, vi } from 'vitest';
import { zipSync, strToU8 } from 'fflate';
import { extractBundleToFS } from './bundle-fs';
import type { DosboxModule } from './types';

function makeMockModule(): DosboxModule {
  const files = new Map<string, Uint8Array>();
  const dirs = new Set<string>(['/']);
  return {
    FS: {
      writeFile: vi.fn((path: string, data: Uint8Array) => { files.set(path, data); }),
      mkdirTree: vi.fn((path: string) => { dirs.add(path); }),
      readFile: vi.fn((path: string) => files.get(path) ?? new Uint8Array()),
    },
    HEAPU8: new Uint8Array(0),
    HEAPF32: new Float32Array(0),
    ccall: vi.fn(),
    callMain: vi.fn(),
  } as DosboxModule;
}

describe('extractBundleToFS', () => {
  it('writes every file from the zip into Module.FS', async () => {
    const zipBytes = zipSync({
      'AUTOEXEC.BAT': strToU8('@ECHO OFF\nM\n'),
      'GAMES/DOOM2/DOOM2.EXE': new Uint8Array([1, 2, 3, 4]),
    });
    const mod = makeMockModule();
    await extractBundleToFS(zipBytes, mod);
    expect(mod.FS.writeFile).toHaveBeenCalledWith(
      '/dosbox/c/AUTOEXEC.BAT',
      expect.any(Uint8Array)
    );
    expect(mod.FS.writeFile).toHaveBeenCalledWith(
      '/dosbox/c/GAMES/DOOM2/DOOM2.EXE',
      new Uint8Array([1, 2, 3, 4])
    );
  });

  it('mkdirTree before writeFile for nested paths', async () => {
    const zipBytes = zipSync({ 'A/B/C.TXT': strToU8('hi') });
    const mod = makeMockModule();
    await extractBundleToFS(zipBytes, mod);
    expect(mod.FS.mkdirTree).toHaveBeenCalledWith('/dosbox/c/A/B');
  });

  it('emits onProgress with monotonically increasing fractions', async () => {
    const zipBytes = zipSync({
      'A.TXT': strToU8('a'),
      'B.TXT': strToU8('b'),
      'C.TXT': strToU8('c'),
      'D.TXT': strToU8('d'),
    });
    const fractions: number[] = [];
    const mod = makeMockModule();
    await extractBundleToFS(zipBytes, mod, (f) => fractions.push(f));
    expect(fractions).toEqual([0.25, 0.5, 0.75, 1]);
  });

  it('skips zip directory entries (path ending in /)', async () => {
    const zipBytes = zipSync({
      'EMPTY_DIR/': new Uint8Array(0),
      'FILE.TXT': strToU8('hi'),
    });
    const mod = makeMockModule();
    await extractBundleToFS(zipBytes, mod);
    expect(mod.FS.writeFile).toHaveBeenCalledTimes(1);
    expect(mod.FS.writeFile).toHaveBeenCalledWith('/dosbox/c/FILE.TXT', expect.any(Uint8Array));
  });
});
```

- [ ] **Step 3: Run tests to verify failure**

```bash
npx vitest run app/lib/wasm-dosbox/bundle-fs.test.ts
# Expected: 4 tests fail — "Cannot find module './bundle-fs'"
```

- [ ] **Step 4: Implement**

```typescript
// app/lib/wasm-dosbox/bundle-fs.ts
import { unzipSync } from 'fflate';
import type { DosboxModule } from './types';

const FS_ROOT = '/dosbox/c';

/**
 * Extract a bundle (.jsdos zip) into Module.FS under FS_ROOT.
 * onProgress is called once per entry, fraction in (0, 1].
 */
export async function extractBundleToFS(
  zipBytes: Uint8Array,
  mod: DosboxModule,
  onProgress?: (fraction: number) => void
): Promise<void> {
  const entries = unzipSync(zipBytes);
  const names = Object.keys(entries).filter((n) => !n.endsWith('/'));
  const total = names.length;
  let i = 0;
  for (const name of names) {
    const data = entries[name];
    const fullPath = `${FS_ROOT}/${name}`;
    const slash = fullPath.lastIndexOf('/');
    if (slash > FS_ROOT.length) {
      mod.FS.mkdirTree(fullPath.substring(0, slash));
    }
    mod.FS.writeFile(fullPath, data);
    i++;
    if (onProgress) onProgress(i / total);
  }
}
```

- [ ] **Step 5: Run tests to verify pass**

```bash
npx vitest run app/lib/wasm-dosbox/bundle-fs.test.ts
# Expected: all 4 tests pass
```

- [ ] **Step 6: Commit**

```bash
git add package.json package-lock.json app/lib/wasm-dosbox/bundle-fs.ts app/lib/wasm-dosbox/bundle-fs.test.ts
git commit -m "feat(wasm-dosbox): bundle-fs extracts zip into Module.FS"
```

---

### Task D3: `frame-bus.ts` (TDD)

**Files:**
- Create: `app/lib/wasm-dosbox/frame-bus.test.ts`
- Create: `app/lib/wasm-dosbox/frame-bus.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// app/lib/wasm-dosbox/frame-bus.test.ts
import { describe, it, expect, vi } from 'vitest';
import { createFrameBus } from './frame-bus';
import type { DosboxModule } from './types';

function mockModuleWithFrame(rgba: Uint8Array): DosboxModule {
  return {
    HEAPU8: rgba,
    HEAPF32: new Float32Array(0),
    FS: { writeFile: vi.fn(), mkdirTree: vi.fn(), readFile: vi.fn(() => new Uint8Array()) },
    ccall: vi.fn(),
    callMain: vi.fn(),
  } as DosboxModule;
}

describe('createFrameBus', () => {
  it('reads RGBA bytes from HEAPU8 starting at the supplied pointer', () => {
    const heap = new Uint8Array(1024);
    // Plant 4 RGBA pixels (16 bytes) at offset 100
    for (let i = 0; i < 16; i++) heap[100 + i] = i + 1;
    const mod = mockModuleWithFrame(heap);

    let captured: { rgba: Uint8ClampedArray; w: number; h: number } | null = null;
    const onFrame = (rgba: Uint8ClampedArray, w: number, h: number) => {
      captured = { rgba, w, h };
    };

    const bus = createFrameBus(mod, onFrame);
    bus.handleFrame(100, 2, 2, 8); // 2x2, stride=8 bytes (=2 pixels)

    expect(captured).not.toBeNull();
    expect(captured!.w).toBe(2);
    expect(captured!.h).toBe(2);
    expect(captured!.rgba.length).toBe(16);
    expect(Array.from(captured!.rgba)).toEqual([1,2,3,4, 5,6,7,8, 9,10,11,12, 13,14,15,16]);
  });

  it('handles stride > width*4 by row-copying (padded scanlines)', () => {
    const heap = new Uint8Array(2048);
    // Row 0: 4 bytes (1 pixel) at offset 0, padded to stride 8
    heap[0] = 10; heap[1] = 20; heap[2] = 30; heap[3] = 40;
    heap[4] = 0xff; heap[5] = 0xff; heap[6] = 0xff; heap[7] = 0xff;  // padding (should NOT be copied)
    // Row 1: 4 bytes (1 pixel) at offset 8
    heap[8] = 50; heap[9] = 60; heap[10] = 70; heap[11] = 80;
    const mod = mockModuleWithFrame(heap);
    let captured: Uint8ClampedArray | null = null;
    const bus = createFrameBus(mod, (rgba) => { captured = rgba; });
    bus.handleFrame(0, 1, 2, 8); // 1x2 image, stride 8
    expect(Array.from(captured!)).toEqual([10,20,30,40, 50,60,70,80]);
  });
});
```

- [ ] **Step 2: Run, expect failure**

```bash
npx vitest run app/lib/wasm-dosbox/frame-bus.test.ts
# Expected: tests fail, "Cannot find module './frame-bus'"
```

- [ ] **Step 3: Implement**

```typescript
// app/lib/wasm-dosbox/frame-bus.ts
import type { DosboxModule } from './types';

export interface FrameBus {
  handleFrame(ptr: number, width: number, height: number, stride: number): void;
}

/**
 * Wires DOSBox's C-side frame callback (js_on_frame) to a JS handler.
 * The handler receives a freshly-allocated Uint8ClampedArray each frame
 * (no copy-on-write into the heap — the caller may keep a reference).
 */
export function createFrameBus(
  mod: DosboxModule,
  onFrame: (rgba: Uint8ClampedArray, width: number, height: number) => void
): FrameBus {
  return {
    handleFrame(ptr: number, width: number, height: number, stride: number) {
      const rgba = new Uint8ClampedArray(width * height * 4);
      const rowBytes = width * 4;
      for (let y = 0; y < height; y++) {
        const src = ptr + y * stride;
        // Subarray reads directly from HEAPU8 without copy; .set copies into our buffer.
        rgba.set(mod.HEAPU8.subarray(src, src + rowBytes), y * rowBytes);
      }
      onFrame(rgba, width, height);
    },
  };
}
```

- [ ] **Step 4: Run, expect pass**

```bash
npx vitest run app/lib/wasm-dosbox/frame-bus.test.ts
# Expected: 2 tests pass
```

- [ ] **Step 5: Commit**

```bash
git add app/lib/wasm-dosbox/frame-bus.ts app/lib/wasm-dosbox/frame-bus.test.ts
git commit -m "feat(wasm-dosbox): frame-bus reads RGBA frames from HEAPU8"
```

---

### Task D4: `audio-bus.ts` (TDD)

**Files:**
- Create: `app/lib/wasm-dosbox/audio-bus.test.ts`
- Create: `app/lib/wasm-dosbox/audio-bus.ts`

- [ ] **Step 1: Failing test**

```typescript
// app/lib/wasm-dosbox/audio-bus.test.ts
import { describe, it, expect, vi } from 'vitest';
import { createAudioBus } from './audio-bus';
import type { DosboxModule } from './types';

function mockModuleWithHeapF32(values: number[]): DosboxModule {
  const heap = new Float32Array(values);
  return {
    HEAPU8: new Uint8Array(0),
    HEAPF32: heap,
    FS: { writeFile: vi.fn(), mkdirTree: vi.fn(), readFile: vi.fn(() => new Uint8Array()) },
    ccall: vi.fn(),
    callMain: vi.fn(),
  } as DosboxModule;
}

describe('createAudioBus', () => {
  it('copies samples out of HEAPF32 (ownership transferred to handler)', () => {
    // 6 samples (e.g. 3 stereo frames). Float index is byte-offset / 4.
    const mod = mockModuleWithHeapF32([0.0, 0.1, 0.2, 0.3, 0.4, 0.5]);
    let captured: { samples: Float32Array; rate: number } | null = null;
    const bus = createAudioBus(mod, (samples, rate) => {
      captured = { samples, rate };
    });
    // ptr is BYTE offset; for HEAPF32 index 0, byte offset is 0
    bus.handleAudio(0, 6, 44100);
    expect(captured!.rate).toBe(44100);
    expect(Array.from(captured!.samples)).toEqual([0.0, 0.1, 0.2, 0.3, 0.4, 0.5]);
  });

  it('does not share the HEAPF32 backing buffer (must be independent copy)', () => {
    const mod = mockModuleWithHeapF32([1, 2, 3, 4]);
    let captured: Float32Array | null = null;
    const bus = createAudioBus(mod, (samples) => { captured = samples; });
    bus.handleAudio(0, 4, 22050);
    // Mutate the heap; captured must remain unchanged.
    mod.HEAPF32[0] = 999;
    expect(captured![0]).toBe(1);
  });
});
```

- [ ] **Step 2: Run, expect fail**

```bash
npx vitest run app/lib/wasm-dosbox/audio-bus.test.ts
```

- [ ] **Step 3: Implement**

```typescript
// app/lib/wasm-dosbox/audio-bus.ts
import type { DosboxModule } from './types';

export interface AudioBus {
  handleAudio(ptrBytes: number, sampleCount: number, sampleRate: number): void;
}

export function createAudioBus(
  mod: DosboxModule,
  onAudio: (samples: Float32Array, sampleRate: number) => void
): AudioBus {
  return {
    handleAudio(ptrBytes: number, sampleCount: number, sampleRate: number) {
      const startIdx = ptrBytes / 4;
      // Slice copies, unlike subarray which views. We must copy because DOSBox reuses its mixer buffer.
      const copy = new Float32Array(mod.HEAPF32.subarray(startIdx, startIdx + sampleCount));
      onAudio(copy, sampleRate);
    },
  };
}
```

- [ ] **Step 4: Run, expect pass**

```bash
npx vitest run app/lib/wasm-dosbox/audio-bus.test.ts
```

- [ ] **Step 5: Commit**

```bash
git add app/lib/wasm-dosbox/audio-bus.ts app/lib/wasm-dosbox/audio-bus.test.ts
git commit -m "feat(wasm-dosbox): audio-bus copies samples out of HEAPF32"
```

---

### Task D5: `input.ts` (TDD)

**Files:**
- Create: `app/lib/wasm-dosbox/input.test.ts`
- Create: `app/lib/wasm-dosbox/input.ts`

- [ ] **Step 1: Failing test**

```typescript
// app/lib/wasm-dosbox/input.test.ts
import { describe, it, expect, vi } from 'vitest';
import { createInput } from './input';
import type { DosboxModule } from './types';

function mockMod() {
  const ccall = vi.fn();
  return {
    mod: { ccall, HEAPU8: new Uint8Array(0), HEAPF32: new Float32Array(0),
           FS: { writeFile: vi.fn(), mkdirTree: vi.fn(), readFile: vi.fn(() => new Uint8Array()) },
           callMain: vi.fn() } as unknown as DosboxModule,
    ccall,
  };
}

describe('createInput', () => {
  it('sendKeyDown calls send_key with keycode and 1', () => {
    const { mod, ccall } = mockMod();
    const input = createInput(mod);
    input.sendKeyDown(65); // 'A'
    expect(ccall).toHaveBeenCalledWith('send_key', null, ['number', 'number'], [65, 1]);
  });

  it('sendKeyUp calls send_key with keycode and 0', () => {
    const { mod, ccall } = mockMod();
    const input = createInput(mod);
    input.sendKeyUp(257); // Enter (GLFW)
    expect(ccall).toHaveBeenCalledWith('send_key', null, ['number', 'number'], [257, 0]);
  });

  it('sendMouseMotion calls send_mouse_motion with x, y', () => {
    const { mod, ccall } = mockMod();
    const input = createInput(mod);
    input.sendMouseMotion(100, 200);
    expect(ccall).toHaveBeenCalledWith('send_mouse_motion', null, ['number', 'number'], [100, 200]);
  });

  it('sendMouseButton encodes pressed bool as 0/1', () => {
    const { mod, ccall } = mockMod();
    const input = createInput(mod);
    input.sendMouseButton(0, true);
    expect(ccall).toHaveBeenCalledWith('send_mouse_button', null, ['number', 'number'], [0, 1]);
    input.sendMouseButton(2, false);
    expect(ccall).toHaveBeenCalledWith('send_mouse_button', null, ['number', 'number'], [2, 0]);
  });
});
```

- [ ] **Step 2: Run, expect fail**

```bash
npx vitest run app/lib/wasm-dosbox/input.test.ts
```

- [ ] **Step 3: Implement**

```typescript
// app/lib/wasm-dosbox/input.ts
import type { DosboxModule } from './types';

export interface Input {
  sendKeyDown(keycode: number): void;
  sendKeyUp(keycode: number): void;
  sendMouseMotion(x: number, y: number): void;
  sendMouseButton(button: 0 | 1 | 2, pressed: boolean): void;
  exit(): Promise<void>;
}

export function createInput(mod: DosboxModule): Input {
  return {
    sendKeyDown(keycode: number) {
      mod.ccall('send_key', null, ['number', 'number'], [keycode, 1]);
    },
    sendKeyUp(keycode: number) {
      mod.ccall('send_key', null, ['number', 'number'], [keycode, 0]);
    },
    sendMouseMotion(x: number, y: number) {
      mod.ccall('send_mouse_motion', null, ['number', 'number'], [x, y]);
    },
    sendMouseButton(button: 0 | 1 | 2, pressed: boolean) {
      mod.ccall('send_mouse_button', null, ['number', 'number'], [button, pressed ? 1 : 0]);
    },
    async exit() {
      mod.ccall('exit_dosbox', null, [], []);
      // No clean way to await DOSBox shutdown; resolve immediately.
      return Promise.resolve();
    },
  };
}
```

- [ ] **Step 4: Run, expect pass**

```bash
npx vitest run app/lib/wasm-dosbox/input.test.ts
```

- [ ] **Step 5: Commit**

```bash
git add app/lib/wasm-dosbox/input.ts app/lib/wasm-dosbox/input.test.ts
git commit -m "feat(wasm-dosbox): input forwards key/mouse via ccall"
```

---

### Task D6: `module-loader.ts` (integration only — no unit test)

**Files:**
- Create: `app/lib/wasm-dosbox/module-loader.ts`

- [ ] **Step 1: Write the module**

```typescript
// app/lib/wasm-dosbox/module-loader.ts
import type { DosboxModule, CreateDosbox } from './types';

const POLL_INTERVAL_MS = 50;
const POLL_TIMEOUT_MS = 30_000;

/**
 * Wait up to 30s for window.createDosbox to be registered by /wasm/wdosbox.js.
 */
export async function waitForCreateDosbox(): Promise<CreateDosbox> {
  const start = performance.now();
  while (!window.createDosbox) {
    if (performance.now() - start > POLL_TIMEOUT_MS) {
      throw new Error('createDosbox failed to load within 30s');
    }
    await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
  }
  return window.createDosbox;
}

/**
 * Instantiate the emscripten Module and return a ready handle.
 * Pass a canvas if you want SDL to draw into it directly; otherwise the
 * caller uses Module.HEAPU8 frame data via the frame-bus.
 */
export async function instantiateModule(
  config: { canvas?: HTMLCanvasElement } = {}
): Promise<DosboxModule> {
  const create = await waitForCreateDosbox();
  return create(config);
}
```

- [ ] **Step 2: Type-check**

```bash
npm run typecheck
```

- [ ] **Step 3: Commit**

```bash
git add app/lib/wasm-dosbox/module-loader.ts
git commit -m "feat(wasm-dosbox): module-loader polls window.createDosbox"
```

---

### Task D7: `index.ts` (public API)

**Files:**
- Create: `app/lib/wasm-dosbox/index.ts`

- [ ] **Step 1: Write the composition**

```typescript
// app/lib/wasm-dosbox/index.ts
// Public surface of the self-built DOSBox WASM wrapper.
//
// Replaces the previous `emu.dosboxXDirect(initFs, options)` API from js-dos.
// dos-emulator.ts is the only intended caller.

import { extractBundleToFS } from './bundle-fs';
import { createFrameBus } from './frame-bus';
import { createAudioBus } from './audio-bus';
import { createInput } from './input';
import { instantiateModule } from './module-loader';
import type { BackendOptions, CommandInterface, DosboxModule } from './types';

export type { BackendOptions, CommandInterface };

/**
 * Boot a DOSBox emulator with the given filesystem layers.
 * Multiple entries in `initFs` are layered later-wins-over-earlier (matches
 * the previous dosboxXDirect contract used for the user-state overlay).
 */
export async function createEmulator(
  initFs: Uint8Array[],
  options: BackendOptions = {}
): Promise<CommandInterface> {
  const mod: DosboxModule = await instantiateModule({});

  // Wire C-side callbacks (the EM_JS hooks in patches/03 call these on Module).
  const frameBus = createFrameBus(mod, (rgba, w, h) => options.onFrame?.(rgba, w, h));
  const audioBus = createAudioBus(mod, (s, r) => options.onAudio?.(s, r));
  mod.onFrame = (ptr, w, h, stride) => frameBus.handleFrame(ptr, w, h, stride);
  mod.onAudio = (ptr, n, rate) => audioBus.handleAudio(ptr, n, rate);
  mod.onAbort = (what) => options.onError?.(new Error(`DOSBox aborted: ${what}`));

  // Extract every layer; later layers overwrite earlier ones on file collisions.
  let cumulative = 0;
  for (let i = 0; i < initFs.length; i++) {
    const isLast = i === initFs.length - 1;
    await extractBundleToFS(initFs[i], mod, (f) => {
      // Map per-layer 0..1 into overall 0..1.
      const overall = (i + f) / initFs.length;
      options.onExtract?.(overall);
      cumulative = overall;
    });
  }
  if (cumulative < 1) options.onExtract?.(1);

  // Start DOSBox. callMain() does not return under Asyncify — it pumps via emscripten_sleep.
  // We fire-and-forget; the frame callback signals readiness on the first frame.
  Promise.resolve().then(() => mod.callMain([]));

  const input = createInput(mod);
  return {
    ...input,
    soundFrequency(): number {
      // Default to the standard SB16 rate; patches/03 can refine via an exported getter if needed.
      return 44100;
    },
  };
}
```

- [ ] **Step 2: Type-check**

```bash
npm run typecheck
```

- [ ] **Step 3: Commit**

```bash
git add app/lib/wasm-dosbox/index.ts
git commit -m "feat(wasm-dosbox): index composes wrapper into createEmulator()"
```

---

## Phase E — Integration with existing code

### Task E1: Update `app/lib/dos-emulator.ts` call site

**Files:**
- Modify: `app/lib/dos-emulator.ts` (lines ~30-50 types, ~205-220 init)

- [ ] **Step 1: Read current state** (sanity check before edit)

```bash
grep -n 'dosboxXDirect\|window.emulators\|/js-dos/' app/lib/dos-emulator.ts
# Note exact line numbers — they may have shifted slightly.
```

- [ ] **Step 2: Replace the js-dos types import block**

Use `Edit` to replace this block (currently around line 30-45 — exact bounds may vary):

```typescript
// OLD (current)
interface EmulatorsGlobal {
  pathPrefix: string;
  dosboxXDirect: (init: Uint8Array[], options?: BackendOptions) => Promise<CommandInterface>;
}

declare global {
  interface Window {
    emulators?: EmulatorsGlobal;
  }
}
```

with:

```typescript
// NEW
import { createEmulator, type BackendOptions, type CommandInterface } from './wasm-dosbox';
```

- [ ] **Step 3: Replace the init call site**

Replace (around line 210-217):

```typescript
// OLD
const emu = window.emulators;
if (!emu) throw new Error("window.emulators not loaded");
emu.pathPrefix = "/js-dos/emulators/";

const ci = await emu.dosboxXDirect(initFs, onExtract ? {
  // ... existing options
} : undefined);
```

with:

```typescript
// NEW
const ci = await createEmulator(initFs, onExtract ? {
  // ... existing options
} : undefined);
```

- [ ] **Step 4: Type-check + lint**

```bash
npm run typecheck
# Expected: passes
```

- [ ] **Step 5: Run existing tests**

```bash
npx vitest run app/lib/
# Expected: existing dos-emulator tests (if any) still pass.
```

- [ ] **Step 6: Commit**

```bash
git add app/lib/dos-emulator.ts
git commit -m "feat: dos-emulator uses self-built createEmulator (drops emulators.dosboxXDirect)"
```

---

### Task E2: Update `app/components/DosFrame.tsx` polling target

**Files:**
- Modify: `app/components/DosFrame.tsx`

- [ ] **Step 1: Locate the wait loop**

```bash
grep -n 'window.emulators\|emulators.js' app/components/DosFrame.tsx
# Expected: 3-4 matches around lines 22-105
```

- [ ] **Step 2: Replace the references**

Use `Edit replace_all` to replace `window.emulators` with `window.createDosbox` (3 occurrences in comments + condition).

Also update the comment at line ~23:

```
// OLD: //   wait     : waiting for emulators.js (<script src>) to load
// NEW: //   wait     : waiting for wdosbox.js (<script src>) to load
```

And the error message at line ~103:

```
// OLD: "emulators failed to load within 30s"
// NEW: "wdosbox failed to load within 30s"
```

- [ ] **Step 3: Type-check**

```bash
npm run typecheck
```

- [ ] **Step 4: Commit**

```bash
git add app/components/DosFrame.tsx
git commit -m "feat: DosFrame polls window.createDosbox instead of window.emulators"
```

---

### Task E3: Update `app/root.tsx` `<script>` tag

**Files:**
- Modify: `app/root.tsx`

- [ ] **Step 1: Locate the script tag**

```bash
grep -n 'js-dos/emulators' app/root.tsx
# Expected: one line, ~35
```

- [ ] **Step 2: Replace**

```tsx
// OLD
<script src="/js-dos/emulators/emulators.js" defer />

// NEW
<script src="/wasm/wdosbox.js" defer />
```

- [ ] **Step 3: Type-check**

```bash
npm run typecheck
```

- [ ] **Step 4: Commit**

```bash
git add app/root.tsx
git commit -m "feat: root.tsx loads /wasm/wdosbox.js (drops emulators.js script)"
```

---

## Phase F — Migration cleanup

### Task F1: Strip js-dos from `package.json`

**Files:**
- Modify: `package.json`

- [ ] **Step 1: Remove `js-dos` from dependencies, `copy-jsdos` from scripts**

Use `Edit` to:
1. Delete the `"js-dos": "^8.3.20"` line.
2. Delete the `"copy-jsdos": "..."` script line.
3. Edit `"build"` from `"npm run copy-jsdos && react-router build"` to just `"react-router build"`.
4. Edit `"dev"` from `"npm run copy-jsdos && react-router dev"` to just `"react-router dev"`.

The `fflate` dep was added by Task D2's npm install, so it should already be present.

- [ ] **Step 2: Re-install to update lockfile**

```bash
npm install
# Expected: removes node_modules/js-dos and its transitive deps. Lockfile changes.
ls node_modules/js-dos 2>&1
# Expected: "ls: cannot access ... No such file or directory"
```

- [ ] **Step 3: Verify build still works**

```bash
npm run typecheck
npm run build
# Expected: react-router build completes; public/wasm/* present in build/client/
ls build/client/wasm/
# Expected: wdosbox.wasm, wdosbox.js
ls build/client/js-dos 2>&1
# Expected: "No such file or directory" (no longer copied)
```

- [ ] **Step 4: Commit**

```bash
git add package.json package-lock.json
git commit -m "build: remove js-dos npm dep and copy-jsdos prerequisite"
```

---

### Task F2: Update `.gitignore`

**Files:**
- Modify: `.gitignore`

- [ ] **Step 1: Inspect current entries**

```bash
grep -n 'js-dos\|wasm' .gitignore
```

- [ ] **Step 2: Remove `public/js-dos/` entry, add Docker scratch**

```bash
# Remove the public/js-dos line, add (if not present):
#   scripts/wasm/.build/   # Docker build scratch space
```

Use `Edit` to delete the `public/js-dos/` line and add `scripts/wasm/.build/`.

- [ ] **Step 3: Commit**

```bash
git add .gitignore
git commit -m "build: gitignore drop public/js-dos/, add scripts/wasm/.build/"
```

---

### Task F3: Delete the legacy `public/js-dos/` directory

**Files:**
- Delete: `public/js-dos/`

- [ ] **Step 1: Remove it** (it was gitignored, but exists in the working tree from past `npm run dev`)

```bash
rm -rf public/js-dos
ls public/
# Expected: no js-dos/ entry, but public/wasm/ present
```

- [ ] **Step 2: Verify clean dev startup with no `js-dos/` artifact**

```bash
npm run dev 2>&1 | head -20
# Expected: React Router starts, no missing file warnings.
# Kill it after confirming startup line ("Local: http://localhost:5173/")
```

(No commit — directory wasn't tracked. Just sanity check.)

---

## Phase G — Smoke verification

### Task G1: 5-game smoke matrix on local dev server

**Files:**
- None modified — manual verification

- [ ] **Step 1: Start dev server**

```bash
npm run dev
# Wait for "Local: http://localhost:5173/"
```

- [ ] **Step 2: For each of the 5 games, exercise the matrix**

Open `http://localhost:5173/` in a browser. After login (admin password from `.env`), navigate the DOS environment and run:

| Game | Path | Verify |
|---|---|---|
| DOOM2 | `CD GAMES\DOOM2` then `DOOM2.EXE` | Boot to menu; play 1 level; AdLib music audible; SB SFX (gunshots) audible; F2 save / F3 load works |
| SAM4 | `CD GAMES\SAM4` then run main exec | Korean-rendered intro displays; in-game menu navigable |
| DARKSIDE | `CD GAMES\DARKSIDE` then `DARKSIDE.EXE` | Boot; opening cinematic plays; music plays |
| DEJAVU | `CD GAMES\DEJAVU` then run launcher | Boot to main menu; music plays |
| KHAN2 | `CD GAMES\KHAN2` then `WONJO.BAT` | Boot; reaches KOEI.COM intro screen |

- [ ] **Step 3: Note any failures**

If a game fails, capture: which phase (boot/render/audio/input), browser console errors, and any DOSBox `onLog` output. File issues for follow-up — they do NOT block the migration unless DOOM2 itself fails (it's the canary).

- [ ] **Step 4: If DOOM2 passes, commit the verification log**

Create `docs/superpowers/plans/smoke-2026-05-19.md` with a short table of game / result / notes. Then:

```bash
git add docs/superpowers/plans/smoke-2026-05-19.md
git commit -m "test: smoke matrix verified on local dev (DOOM2 + 4 others)"
```

---

## Phase H — Deploy + cleanup

### Task H1: Merge worktree back to main

**Files:**
- Worktree → `main` branch

- [ ] **Step 1: Merge prep**

```bash
# In the worktree
git log --oneline main..HEAD | wc -l
# Expected: ~22 commits
git push origin feat/self-built-wasm
```

- [ ] **Step 2: Switch back to main worktree and merge**

```bash
cd ~/dosbox  # main worktree
git checkout main
git pull
git merge feat/self-built-wasm --no-ff -m "feat: replace js-dos with self-built DOSBox 0.74-3 WASM"
# pre-commit hook bumps version
git log --oneline -3
```

- [ ] **Step 3: Verify clean main**

```bash
npm install
npm run typecheck
npm run test
npm run verify-wasm
# All should pass.
```

- [ ] **Step 4: Push**

```bash
git push origin main
```

---

### Task H2: Deploy to pcnhost + production smoke

**Files:**
- Remote: `pcnhost:/home/gcjjyy/dosbox/`

- [ ] **Step 1: Deploy**

```bash
export SSHPASS='wlduddl3!'
sshpass -e ssh pcnhost '
  cd ~/dosbox
  git pull
  npm install
  npm run build
  rm -f ~/.cache/dosbox/bundle.jsdos ~/.cache/dosbox/bundle.etag
  pm2 restart dosbox
  sleep 3
  curl -s -o /dev/null -w "HTTP %{http_code} | %{size_download} bytes\n" http://127.0.0.1:5301/dos.jsdos
  ls -lh ~/dosbox/public/wasm/
  ls ~/dosbox/public/js-dos 2>&1 || echo "[OK] public/js-dos/ no longer exists"
'
```

- [ ] **Step 2: External smoke**

```bash
curl -sI https://dosbox.gcjjyy.dev/wasm/wdosbox.js | head -5
# Expected: HTTP/2 200, content-type application/javascript
curl -sI https://dosbox.gcjjyy.dev/dos.jsdos | head -5
# Expected: HTTP/2 200, no-transform header present
```

- [ ] **Step 3: Browser smoke**

Open `https://dosbox.gcjjyy.dev/` in a private window. Watch:
- Network tab: only `/wasm/wdosbox.js` + `/wasm/wdosbox.wasm` (no `/js-dos/*` requests)
- Boot pipeline reaches "boot" phase
- DOOM2 plays with sound

- [ ] **Step 4: If all green, no commit needed — deployment complete.**

If any step fails, rollback:

```bash
sshpass -e ssh pcnhost 'cd ~/dosbox && git revert HEAD --no-edit && npm run build && pm2 restart dosbox'
```

---

## Self-review checklist (run after writing this plan)

(For the plan author — do this before handing off.)

**1. Spec coverage:**
- ✅ Build infrastructure (Phase A)
- ✅ Patches (Phase B)
- ✅ Reproducibility / hash verification (Tasks A4, A6, C2)
- ✅ Wrapper module (Phase D, all 7 files)
- ✅ Migration (Phase E, F)
- ✅ Smoke matrix (Phase G — 5 games)
- ✅ Deployment (Phase H)
- ✅ Rollback (Task H2 step 4)

**2. Placeholder scan:** No "TBD", "implement later", "add appropriate". Tasks B2/B3/B4 acknowledge they require iteration but specify exact acceptance criteria.

**3. Type consistency:**
- `BackendOptions`, `CommandInterface`, `DosboxModule` defined in Task D1, used consistently in D2-D7.
- `createEmulator(initFs, options)` signature consistent in Tasks D7 and E1.
- `Module.FS.writeFile / mkdirTree` typed identically in types.ts and bundle-fs.test.ts.

**4. Known limits acknowledged:**
- Phase B can't be fully prescriptive — patches discovered during iteration. Acceptance criteria gate progress.
- Korean tools known to break (Phase G excludes them).

---

## Execution handoff

Plan complete and saved to `docs/superpowers/plans/2026-05-19-self-built-dosbox-wasm.md`.

Two execution options:

**1. Subagent-Driven (recommended)** — I dispatch a fresh subagent per task, review between tasks, fast iteration. Best for tasks D2–D7 (TDD) and migration tasks E/F. Phase B (patches) likely needs human iteration regardless of mode.

**2. Inline Execution** — Execute tasks in this session using executing-plans, batch with checkpoints. Slower for long plans like this one (~22 tasks); context window pressure rises.

Which approach?
