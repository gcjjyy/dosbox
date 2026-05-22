# Options Dialog & Input Fixes — Design

**Date:** 2026-05-22
**Status:** Approved (pending implementation)

## Problem statement

Five issues, all in the client input/UI layer:

1. **No right-click on tablets.** Two-finger touch does not produce a right
   mouse button event — there is currently no way to right-click on a
   touch-only device.
2. **Default cycles too high; no settings home.** Default CPU cycles should be
   8000, and cycle adjustment should move out of the toolbar into a dedicated
   options dialog. All options must persist in `localStorage`.
3. **No canvas vertical-position control.** Users want to align the DOS canvas
   to the top / middle / bottom of the stage. Default middle.
4. **No keyboard transparency control.** A 0.0–1.0 opacity slider; 1.0 = current
   look, 0.0 = key/panel *backgrounds* fully transparent while outlines and
   legends (각인) stay fully visible. Default 1.0.
5. **Bluetooth keyboard QWERTY letters don't register (Android tablet).**
   Numbers, arrows, function keys, and symbols work; only A–Z letters fail.

## Decisions (from brainstorming)

- Cycle UI: keep the **+/- stepper**, moved into the dialog.
- Right-click gesture: **two-finger tap = one right-click**.
- Dialog scope: **resolution also moves into the dialog**. Toolbar keeps the
  virtual-keyboard toggle, a new gear (options) button, and the save buttons.
- Issue 5 environment: **Android tablet + Bluetooth keyboard**.
- Transparency: pressed/feedback backgrounds fade together with resting
  backgrounds (acceptable — legends + outlines remain, so keystrokes are still
  visible).

## Architecture

### Unified options store — `app/lib/use-options.ts` (new)

Single source of truth for all persisted UI options, stored as one JSON blob
under `localStorage["dosbox-options"]`.

```ts
interface Options {
  cycles: number;                              // default DEFAULT_CYCLES (8000)
  resolutionId: ResolutionId;                  // default DEFAULT_RESOLUTION
  canvasVAlign: "top" | "middle" | "bottom";   // default "middle"
  keyboardOpacity: number;                     // 0.0–1.0, default 1.0
}
```

- The hook returns `[options, setOption]` where `setOption(key, value)` updates
  one field, writes the whole blob back to `localStorage`, and re-renders.
- **SSR-safe**: initial state = defaults; a `useEffect` reads `localStorage`
  after mount (same pattern as the existing `use-resolution.ts`).
- **Migration**: on first read, if `dosbox-options` is absent but the legacy
  `dosbox-resolution` key exists and is valid, seed `resolutionId` from it.
- **Validation**: each field is clamped/validated on read (`clampCycles`,
  `isValidResolutionId`, `canvasVAlign ∈ {top,middle,bottom}`,
  `keyboardOpacity` clamped to `[0,1]`). Unknown/corrupt blob → defaults.

`use-resolution.ts` is retired; its callers switch to `useOptions`.

### Issue 1 — two-finger right-click (`app/lib/dos-emulator.ts`)

Track active touch pointers in a `Map<pointerId, {x,y}>` populated in
`handlePointer`.

- `pointerType === "mouse"`: unchanged — `button === 2 → right (1)`, etc.
- `pointerType === "touch"`:
  - On `down`: add to the map. If this is the **second** simultaneous touch,
    set a `twoFingerArmed` flag and **suppress** the left-button-down that the
    first finger would otherwise hold (cancel/never send it, or send a
    left-up to undo it).
  - On `up`/`cancel`: remove from the map. If `twoFingerArmed` was set and the
    touch count drops back below 2, emit a **single right-click** (button 1
    down+up + sync) at the first finger's last position, then clear the flag.
  - Single-finger taps/moves keep the existing left-button behavior.

Mouse-motion sync semantics (`sendMouseMotion` + `sendMouseSync`) are reused;
only the button selection + gesture bookkeeping is new.

### Issue 2 — default cycles 8000 + persistence

- `app/lib/cpu-cycles.ts`: `DEFAULT_CYCLES = 8000`. (`CYCLES_STEP = 2000`,
  `MIN = 100`, `MAX = 100000` unchanged.) The bundle's `dosbox.conf` picks this
  up automatically (`cycles=fixed 8000`), as does the client display default.
- **Restore saved value at boot via delta replay.** The shared server bundle
  cannot be re-baked per user, so on the first `onReady` the index route
  compares the saved `cycles` to `DEFAULT_CYCLES` and replays
  `|saved − DEFAULT| / CYCLES_STEP` calls to `cyclesUp()` / `cyclesDown()`.
  Because the stepper only ever moves in `CYCLES_STEP` increments from the
  default, the saved value is always `DEFAULT + k·STEP`, so the replay lands
  exactly. `clampCycles` guards bounds.
- The displayed `cycles` state initializes from `useOptions` (not the hardcoded
  default).

### Issue 3 — canvas vertical alignment (`app/app.css`, `DosFrame`/index)

`.dos-stage` currently uses `display: grid; place-items: center`. Replace the
fixed centering with an `align-items` driven by the option:

- `top → start`, `middle → center`, `bottom → end` (horizontal stays centered).

Implemented via a modifier class on `.dos-stage`
(`dos-stage--valign-top|middle|bottom`) or a CSS custom property; the option
value flows from `useOptions` down to `DosFrame`. Default `middle` keeps
current behavior.

### Issue 4 — keyboard transparency (`app/app.css`, `VirtualKeyboard`)

Inject a `--vkb-bg-opacity` CSS custom property (default `1`) on the `.vkb`
container from `keyboardOpacity`.

- Every **background** rgba in the keyboard subtree (panel `.vkb` bg, resting
  `.vkb-key` fill, `:hover`, `--mod`, `--pressed`/`:active`, `--latched`)
  changes its alpha to `calc(<original-alpha> * var(--vkb-bg-opacity))`.
- **Borders and text are NOT multiplied** — outlines and legends stay fully
  opaque at any setting.
- At `1.0` the calc resolves to the original alphas (no visual change); at
  `0.0` all backgrounds vanish, leaving outlined keys with legends floating
  over the DOS screen.

### Issue 5 — options dialog (`app/components/OptionsDialog.tsx` new, `Toolbar`)

- New gear `IconSettings` button in the toolbar opens `OptionsDialog`, a modal
  matching `LoginModal`'s structure/styling.
- Dialog contents (each wired to `useOptions`, instant apply + persist):
  - **해상도** — the existing `ResolutionPicker` (moved out of the toolbar).
  - **CPU 사이클** — the +/- stepper + value readout (moved out of the toolbar),
    `disabled` at MIN/MAX as today.
  - **캔버스 세로 위치** — 3-way segmented control (위/중간/아래).
  - **키보드 투명도** — range slider `0.0–1.0` (step ~0.05) with a value label.
- Toolbar after the change: brand · VKB toggle · gear · separator · user-save /
  delete · admin save/logout (or login). Resolution dropdown and inline cycle
  controls are removed from the toolbar.

## Issue 5 diagnosis strategy (Android)

The "only A–Z fail" pattern on Android Chrome + Bluetooth keyboard is the
classic signature of the IME intercepting letter keys as composition: `keydown`
arrives with `e.code === ""` and/or `e.keyCode === 229`, while digits, arrows,
function keys, and symbols bypass the IME and dispatch normal events with a
valid `e.code`. We confirm before fixing:

1. **Instrument.** Add a temporary on-screen, stacked, scrolling debug log
   (per the cross-device debug-loop convention: stacked status lines, not a
   single line, plus a visible version bump each iteration) that prints
   `code` / `key` / `keyCode` / `isComposing` for every `keydown`. Deploy and
   test on the real Android tablet to capture exactly what arrives.
2. **Targeted fix.** Based on observed values, apply the minimal fix — most
   likely: when `e.code` is empty/`Unidentified` or `keyCode === 229`, fall
   back to mapping `e.key` (single A–Z/a–z char) to its scancode; if that is
   also unusable, route through a hidden focused input. The exact mechanism is
   chosen from real data, not assumed.

The debug instrumentation is removed once the fix is verified.

## Out of scope

- Re-baking the server bundle per user for cycles (rejected: shared cache).
- Changing audio/WebGL pipelines, save channels, or auth.
- Touch gestures beyond two-finger right-click (no pinch-zoom, no long-press).

## Testing

- **Unit (vitest, node):** `useOptions` read/write/migration/validation;
  cycles delta-replay step count math.
- **Manual (real devices):** Android tablet — two-finger right-click; Bluetooth
  keyboard letters after the fix. Desktop/mobile — dialog options apply and
  persist across reload; canvas alignment; keyboard opacity at 0 / 0.5 / 1.
- `npm run typecheck` + `npm run test` green before completion.
```
