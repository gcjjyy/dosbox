# 2026-05-19 — Virtual keyboard redesign: ANSI stagger, Shift-aware labels, mobile Sym page

## Context

The current virtual keyboard (`app/components/VirtualKeyboard.tsx`, 382 lines) ships two layouts:

- **Desktop** (>640 px): full 6-row QWERTY. Letter cells are flex 1, modifier widths chosen ad hoc (`Tab` 2.25, `Caps` 2.0, `Shift` 2.25). The **stagger is broken** — `Caps` is *narrower* than `Tab`, so `A` sits to the *left* of `Q` instead of between `Q` and `W`.
- **Mobile** (≤640 px portrait): 3-tab pager (`ABC` / `123` / `FN`) plus a fixed util row. Tabs waste vertical space, F-keys and digits sit on separate pages, and there is no stagger at all.

Neither layout reflects the held **Shift state**. When the user latches `Shift`, the labels stay unshifted — there is no visual feedback for `1 → !`, `[ → {`, etc.

## Goals

1. **Drop the mobile tab bar.** Merge F-keys and digits onto the main page. Keep a single toggleable Sym page for special characters.
2. **Apply proper ANSI QWERTY stagger** to both viewports. `A` between `Q` and `W`; `Z` between `A` and `S`.
3. **Shift-aware labels.** When Shift latches, non-letter labels swap to their shifted glyphs and the Shift key shows a visually distinct latched state.
4. **Preserve all existing semantics**: sticky-once modifiers, CapsLock as momentary, dual English+두벌식 labels on letter keys, pointer dedupe, scancode mapping.

## Non-goals

- Landscape mobile (viewport > 640 px already uses desktop layout — unchanged).
- Replacing the cookie-session admin save path or any non-UI mechanism.
- Reworking the engine, keymap, or DOS-side input.
- Adding a physical-keyboard-on-mobile mode or external Bluetooth handling.

## Mobile main page (portrait, ≤640 px)

6 rows. Each row's flex values sum to **12**. Cells use `display: flex; flex: <n> 1 0` so fractional widths produce the stagger.

| Row | Composition (flex values in parens) | Sum |
|---|---|---|
| 1 — F | `F1` `F2` `F3` `F4` `F5` `F6` `F7` `F8` `F9` `F10` `F11` `F12` (1 each) | 12 |
| 2 — digits | `` ` ``(1) `1`..`0`(10×1) `BS`(1, mod) | 12 |
| 3 — QWERTY | `Tab`(1.5, mod) `Q`..`P`(10×1) `\`(0.5) | 12 |
| 4 — ASDF | `Caps`(2, mod) `A`..`L`(9×1) `;`(0.5) `'`(0.5) | 12 |
| 5 — ZXCV | `↑Sh`(2.5, mod) `Z`..`M`(7×1) `,`(0.5) `.`(0.5) `↑`(0.5, up) `RET`(1, mod) | 12 |
| 6 — util | `Esc` `Ctl` `Alt`(1 each, mod) `Sym`(1, accent) `Space`(5.75) `←` `↓` `→`(0.75 each, up) | 12 |

**Stagger progression** (left edge of letter block):
- Q starts at `1.5` — 0.5 right of digits.
- A starts at `2.0` — 0.5 right of Q.
- Z starts at `2.5` — 0.5 right of A.

`-` `=` `[` `]` `/` are moved to the Sym page (rarely used in DOS commands; `\` stays because it is the path separator).

## Mobile Sym page

Same 6-row footprint. Row 1 (F-keys) and Row 6 (util) are **mode-invariant** — they render identically whether on ABC or Sym. The `Sym` button in row 6 col 4 reads `ABC` when on the Sym page; pressing it toggles back. **No auto-flip on Space** — DOS commands like `dir *.* | more` need consecutive symbol entry.

| Row | Composition | Flex sum |
|---|---|---|
| 1 — F (fixed) | `F1`..`F12` (1 each) | 12 |
| 2 | `~` `!` `@` `#` `$` `%` `^` `&` `*` `(` `)`(1 each) `BS`(1, mod) | 12 |
| 3 | `Tab`(1.5, mod) `{` `}` `[` `]` `-` `=` `+` `_` `<` `>`(1 each) spacer(0.5) | 12 |
| 4 | spacer(2) `:` `"` `?` `/` `\` `,` `.` `;` `'` `\|`(1 each) | 12 |
| 5 | `↑Sh`(2.5, mod shift) spacer(8) `↑`(0.5, up) `RET`(1, mod) | 12 |
| 6 — util (fixed, ABC label) | `Esc` `Ctl` `Alt`(1 each, mod) `ABC`(1, accent) `Space`(5.75) `←` `↓` `→`(0.75 each, up) | 12 |

Key design decisions:
- **Modifier slots mirror main page x-positions** (`Tab` R3 left, `↑Sh` R5 left, `BS` R2 right, `RET` R5 right) so muscle memory carries between modes.
- **R5 is sparse on purpose** — places `↑` at the same x as main R5's `↑` (10.5/12 across) preserving inverted-T continuity, and keeps `RET` at the same x as main.
- **Shifted digit labels live on R2** (`~ ! @ # $ % ^ & * ( )`) — natural mapping from main R2's `` ` 1..0``. `_` and `+` (Shift of `-` and `=`) move down to R3 since `-` and `=` are themselves on R3 of Sym.
- **R4 includes deliberate duplicates** of main's punctuation (`, . ; ' \`) so typing a punctuation-heavy phrase doesn't require bouncing back to ABC.
- **Caps slot is dropped** on Sym (replaced by spacer at R4 left) — CapsLock has no meaning when no letters are visible.

## Desktop layout (>640 px)

6 rows, each summing to flex **15.25**. Arrows are integrated into rows 5/6 (the existing `DESKTOP_ARROW_CLUSTERS` 156-px fixed-width column is removed) so alignment with R1–R4 holds at any viewport width.

| Row | Composition | Sum |
|---|---|---|
| 1 — F | `Esc`(3.25, mod) `F1`..`F12`(1 each) | 15.25 |
| 2 — digits | `` ` ``(1) `1`..`0`(10×1) `-`(1) `=`(1) `BS`(2.25, mod) | 15.25 |
| 3 — QWERTY | `Tab`(1.5, mod) `Q`..`P`(10×1) `[`(1) `]`(1) `\`(1.75) | 15.25 |
| 4 — ASDF | `Caps`(1.75, mod) `A`..`L`(9×1) `;`(1) `'`(1) `RET`(2.5, mod) | 15.25 |
| 5 — ZXCV | `Sh`(2.25, mod shift) `Z`..`M`(7×1) `,`(1) `.`(1) `/`(1) `↑`(1, up) `Sh`(2, mod shift) | 15.25 |
| 6 — Space | `Ctl`(1.5, mod) `Alt`(1.5, mod) `Space`(7) `Alt`(1.5, mod) `←`(0.75, up) `↓`(0.75, up) `→`(0.75, up) `Ctl`(1.5, mod) | 15.25 |

**Stagger** (left edge of letter block): Q at 1.5, A at 1.75 (+0.25 right of Q), Z at 2.25 (+0.5 right of A) — canonical ANSI.

**Inverted-T arrows**: `↑` on R5 between `/` and right `Sh`; `←` `↓` `→` on R6 right end. `↑` aligns vertically with `↓` (both at the same flex offset).

No desktop Sym page. Desktop already shows everything; Shift latch toggles the labels in place.

## Shift-aware label model

### Behavior

- When `stickyModsRef` contains `SC.SHIFT`, every cell with a `shifted` label renders that label instead of `plain`.
- Letter cells (`A`..`Z`, `a`..`z`) **always render uppercase**. DOS displays uppercase by default; lowercase rendering would be confusing for a DOS UI. No `shifted` field needed for letter cells.
- The Shift key cells themselves take a `latched` visual variant (amber background, dark text) when Shift is active.
- Swapped non-letter labels render in `var(--color-keyboard-shift-amber)` for high-contrast readability and to make the swap visible at a glance.
- Sym page: shifted labels are not separately defined for Sym-only glyphs. Pressing Shift on Sym just visually highlights the Shift key; labels stay put.

### Shift table

Single canonical map keyed by scancode, used by both layouts:

```ts
// app/lib/dos-keymap.ts (new export)
export const SHIFT_LABELS: Record<number, string> = {
  [SC.GRAVE]: "~",
  [SC.D1]: "!", [SC.D2]: "@", [SC.D3]: "#", [SC.D4]: "$", [SC.D5]: "%",
  [SC.D6]: "^", [SC.D7]: "&", [SC.D8]: "*", [SC.D9]: "(", [SC.D0]: ")",
  [SC.MINUS]: "_", [SC.EQUAL]: "+",
  [SC.LBRACKET]: "{", [SC.RBRACKET]: "}", [SC.BACKSLASH]: "|",
  [SC.SEMICOLON]: ":", [SC.QUOTE]: "\"",
  [SC.COMMA]: "<", [SC.PERIOD]: ">", [SC.SLASH]: "?",
};
```

The render path looks up `SHIFT_LABELS[k.code]` when `shifted` is true; falls back to `k.label`.

## Sym toggle UX

- `Sym` button lives in row 6 col 4 (immediately left of Space) — matches iOS keyboard convention.
- Toggle is **explicit** in both directions. No auto-revert on Space or punctuation.
- Visual treatment: `Sym` and `ABC` share the same key cell with a swapped label and an accent (blue) background so the user can find it without hunting.

## Visual design

Reuses the existing navy/glass palette. Two new tokens:

```css
:root {
  --color-keyboard-shift-amber: #f0b32a;       /* swapped-label glyph color */
  --color-keyboard-latched-bg:  #f0b32a;       /* Shift latch background */
  --color-keyboard-latched-fg:  #050912;       /* dark text on amber */
}
```

Key polish (refinements to existing CSS):
- Letter rows use mono digits and slight letterspacing (already present) — no change.
- Modifier rows keep the muted, uppercase letterspacing treatment.
- Latched Shift gets `box-shadow: 0 0 14px rgba(240,179,42,0.32)` for an explicit "live" cue, distinct from the blue pressed state used for letter taps.
- Shifted glyphs (`!` `@` `#` ...) render in `var(--color-keyboard-shift-amber)` so they pop against the gray cell.
- No font changes. Existing `JetBrains Mono` stack stays.

## Data model

### KeyDef extension

```ts
type KeyDef =
  | { spacer: true; flex?: number }
  | {
      code: number;
      label: string;        // plain (unshifted) label
      flex?: number;
      modifier?: boolean;   // sticky-once modifier (Shift/Ctrl/Alt)
      role?: "shift" | "sym" | "arrow";  // for differential styling
      spacer?: false;
    };
```

Shifted labels are NOT inlined per KeyDef — they live in the central `SHIFT_LABELS` table so both desktop and mobile layouts share one definition.

### Component state additions

```ts
// derived from stickyModsRef
const shifted = stickyModsRef.current.has(SC.SHIFT);

// mobile page state (replaces existing Page = "abc" | "123" | "fn")
const [page, setPage] = useState<"abc" | "sym">("abc");
```

### Layout constants (replacements)

- `DESKTOP_ROWS` — restagger with flex `Tab 1.5`, `Caps 1.75`, `Sh 2.25/2`; add `` ` `` to row 2.
- `MOBILE_PAGES` shrinks from 3 keys to 2: `abc` and `sym`. Tab bar is removed.
- `MOBILE_UTIL_ROW` adds the `Sym` toggle cell (1 unit) between `Alt` and `Space`; removes `BS` and `RET` (now on rows 2 and 5 of `abc` respectively, sym row 6 keeps `ABC` label but no `BS`/`RET`).
- `DESKTOP_ARROW_CLUSTERS` unchanged.

## Render path

```ts
function labelFor(k: KeyDef, shifted: boolean): string {
  if (k.spacer) return "";
  if (shifted) {
    const s = SHIFT_LABELS[k.code];
    if (s) return s;
  }
  return k.label;
}

function classFor(k: KeyDef, shifted: boolean, isPressed: boolean): string {
  let cls = "vkb-key";
  if (k.modifier) cls += " vkb-key--mod";
  if (k.role === "shift" && shifted) cls += " vkb-key--latched";
  if (k.role === "sym") cls += " vkb-key--sym";
  if (k.role === "arrow") cls += " vkb-key--arrow";
  if (isPressed) cls += " vkb-key--pressed";
  return cls;
}
```

`renderCell` consults both functions; otherwise the dedupe / sticky / pointer logic stays as-is.

## Verification

Manual checks (covering golden path + regressions):

1. **Desktop stagger** — `A` sits between `Q` and `W` (left edge of A halfway between Q and W). `Z` sits between `A` and `S`.
2. **Mobile stagger** — same visual relationship on iPhone portrait (393 px).
3. **Shift swap** — tap `Sh`, verify `1` cell reads `!`, `[` reads `{`, etc. Tap `1` — DOS receives `!`, Shift releases, labels revert. Verify on both layouts.
4. **Sym toggle** — mobile: tap `Sym`, verify `2` row → `! @ # …`. Tap `*` — DOS receives `*`. Verify keyboard stays on Sym (no auto-flip). Tap `ABC` — returns to main.
5. **Inverted-T arrows** — verify `↑` in R5 sits directly above `↓` in R6 on mobile main, mobile Sym, and desktop. Both layouts integrate arrows into the main grid (no separate fixed-pixel cluster), so alignment holds at any viewport width.
6. **Dual labels** — letter cells still show English upper-left + 두벌식 lower-right (no regression).
7. **No tab bar on mobile** — the 3 tabs (`ABC` / `123` / `FN`) are gone.
8. **Sticky-once modifier** — pressing `Sh` then `a` types `A` (or whatever shifted scancode emits) and releases Shift; visual amber clears.
9. **Pointer dedupe** — rapid finger taps still produce one key event per press.

Existing vitest unit tests (`app/**/*.test.tsx`): none cover VirtualKeyboard. Manual verification only.

## Migration & cleanup

- Delete `MOBILE_PAGES["123"]` and `MOBILE_PAGES["fn"]`; redefine `Page = "abc" | "sym"`.
- Delete `.vkb-tabbar` and `.vkb-tab*` CSS rules; delete `<div class="vkb-tabbar">` from `VirtualKeyboard.tsx`.
- Delete `DESKTOP_ARROW_CLUSTERS` and the `vkb-arrows-col` wrapper render branch — arrows are now part of `DESKTOP_ROWS[4]` (R5) and `DESKTOP_ROWS[5]` (R6). Drop the `.vkb-arrows-col` CSS rule.
- Restagger `DESKTOP_ROWS`: `Tab` 2.25→1.5, `Caps` 2→1.75, left `Shift` 2.25 (unchanged), right `Shift` (new) 2; add `` ` `` to R2; add `↑` to R5; add `←` `↓` `→` and trailing `Ctl` to R6.
- Rewrite `MOBILE_PAGES["abc"]` with the staggered widths in the mobile main table; add `MOBILE_PAGES["sym"]` per the Sym table.
- Update `MOBILE_UTIL_ROW`: insert `Sym` cell between `Alt` and `Space`; remove `BS` and `RET` (now on R2 and R5 of `abc`); width unchanged (12 flex).
- Add `SHIFT_LABELS: Record<number, string>` export to `app/lib/dos-keymap.ts`. No changes to the keycode table itself — scancodes remain GLFW-style.
- Add CSS tokens `--color-keyboard-shift-amber`, `--color-keyboard-latched-bg`, `--color-keyboard-latched-fg`.
- Add CSS rules: `.vkb-key--latched`, `.vkb-key--sym`, `.vkb-key--shifted-glyph` (or apply the amber color inline via a class added in render).
- Update header comment block in `VirtualKeyboard.tsx` to reflect the new model (drop "ABC / 123 / FN tabbar" prose; describe ABC / Sym toggle + Shift swap).

## Open questions deliberately closed

- **Letter case toggling**: letters stay uppercase regardless of Shift. Closes "should `a` show as `A` on Shift" — no, always `A`.
- **Auto-flip on Space**: no. DOS users type symbol-heavy commands (`dir *.* | more`), the iOS auto-flip would be hostile.
- **F11/F12 placement**: stays on row 1 (always visible). They are useful in some games and editors.
- **Landscape mobile**: out of scope; existing desktop layout applies at widths > 640 px.
