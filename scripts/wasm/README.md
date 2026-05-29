# DOSBox 0.74-3 WASM build

Self-built WebAssembly DOSBox replacing the `js-dos` npm package.

## License

DOSBox is licensed under GPL-2.0. The resulting `dosbox0743.wasm` and
`dosbox0743.js` inherit GPL-2.0. Our patches in `patches/` are also
licensed GPL-2.0. The TypeScript wrapper at `app/lib/wasm-dosbox/`
is original work; see the repository root for its license.

## Toolchain

- Emscripten SDK **3.1.74** (pinned in `Dockerfile`)
- DOSBox **0.74-3** (vanilla mainline, vendored as `dosbox-0.74-3.tar.gz`)
- SDL1 + Asyncify (in-band main loop)
- Release flags aligned with jsdos where applicable: `-Oz`, thin LTO,
  `emmalloc`, 64 MB initial memory, and memory growth.
- `patch-loader.mjs` is applied after Docker extraction so SDL's built-in
  WebAudio scheduler does not play on top of the app's AudioWorklet path.

## Build

```
./scripts/wasm/build.sh                # Use docker layer cache (~1-2 min if cached)
./scripts/wasm/build.sh --no-cache     # Full rebuild (~30-60 min)
./scripts/wasm/build.sh --verify       # Build + verify SHA256 against expected-hashes.txt
```

Artifacts:
- `public/wasm/dosbox0743.wasm`
- `public/wasm/dosbox0743.js` (Emscripten loader, registers `window.createDosbox`)

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
