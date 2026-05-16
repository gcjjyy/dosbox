# Mobile Virtual Keyboard Redesign

**Date**: 2026-05-17
**Status**: Approved (brainstorming complete, implementation pending)
**Touches**: `app/components/VirtualKeyboard.tsx`, `app/lib/dos-keymap.ts`, `app/app.css`

## Problem

Current `VirtualKeyboard.tsx` shows all ~65 keys at once in a 6-row layout. On mobile (≤640px) every key is shrunk to 40 px tall to fit, which makes touch targets cramped and the keyboard feel busy. Two functional gaps:

1. **CapsLock is missing.** The current Row 4 has `{ spacer: true, flex: 2 }` where CapsLock conventionally sits — it was dropped at some point and needs to come back. DOS uses CapsLock (e.g. terminal apps, DOS shell).
2. **No way to display Korean labels.** The Korean DOS environment lives at `~/dos`; users typing into a Korean DOS app benefit from seeing 두벌식 jamo positions (ㅁ ㅠ ㅊ …) on the QWERTY keys.

## Goals

- Mobile: switch from a single-page 6-row layout to a **3-tab paged layout** (ABC / 123 / FN) modeled on standard phone keyboards, with **uniform 10%-wide cells**.
- Add **CapsLock** to both mobile and desktop layouts.
- Add a **한/영 visual-only toggle** that swaps the labels on QWERTY-position keys between English (A B C…) and 두벌식 자모 (ㅁ ㅠ ㅊ…). **Scancodes do not change.**
- **Preserve every key currently in the keyboard** — Esc, F1–F12, 0–9, A–Z, `- = [ ] \ ; ' , . /`, Shift, Ctrl, Alt, Space, Enter, Tab, Backspace, four arrows.
- Desktop (>640px): keep the current full keyboard, plus add CapsLock in its conventional Row 4 slot.

## Non-goals

- No new DOS-side IME integration. The 한/영 button is purely a label swap — it does **not** send a scancode (Right Alt, Shift+Space, dedicated Hangul key, etc.). Users who want to toggle a Korean IME in DOS press Right Alt (already on the keyboard) themselves.
- No new keys beyond CapsLock. Backquote, Insert/Delete/Home/End/PgUp/PgDn, NumPad — none of these are in the current keyboard and none are being added.
- No change to the sticky-once modifier semantics (Shift/Ctrl/Alt latch on tap, release after the next non-modifier key, can be cancelled by re-tapping).
- No change to the auto-show heuristic in `app/lib/use-virtual-keyboard.ts` — touch detection + localStorage override stays as-is.

## Design

### Breakpoint

Mobile redesign applies at `max-width: 640px` (same breakpoint as the current `.vkb` phone-layout block in `app.css`). Above 640 px the desktop full keyboard renders, with one change: a CapsLock key replaces the Row 4 left-side spacer.

### Mobile layout (3 tabs, all keys 10% wide)

A single keyboard component renders three top-level regions stacked vertically:

```
┌─────────────────────────────────────────────────┐
│ Tab bar     [ABC] [123] [FN]            [한/영] │ ← fixed-height row
├─────────────────────────────────────────────────┤
│ Content area (varies by active tab)              │
│   ABC: 3 rows                                    │
│   123: 3 rows (includes arrow inverted-T)        │
│   FN:  2 rows                                    │
├─────────────────────────────────────────────────┤
│ Util row  Esc · Ctrl · Alt · Shift · Space · BS · ENT │
└─────────────────────────────────────────────────┘
```

Total keyboard heights: ABC = 5 rows, 123 = 5 rows, FN = 4 rows. **FN is one row shorter than the other two pages**, so the keyboard's bottom edge shifts up ~10% when switching to FN and back down when leaving. Acceptable trade per the user's "왠만하면 동일" preference — uniform per-cell sizing beats a constant total height that would require stretching FN cells.

Every content-area cell — letters, digits, punctuation, arrows, F-keys, modifiers including CapsLock and Tab — is exactly **10% of the keyboard width** (one flex unit out of ten). Where content has fewer than 10 keys in a row, the row is padded with `spacer` cells, not by stretching keys.

#### Tab bar (top, fixed height)

| Cell 1 | Cell 2 | Cell 3 | Cells 4–9 | Cell 10 |
|--------|--------|--------|-----------|---------|
| `[ABC]` | `[123]` | `[FN]` | spacer (6 cells) | `[한/영]` |

The active page tab is highlighted with the same `--color-navy-accent` treatment used for pressed modifier keys. `[한/영]` shows the current label mode; tap toggles between EN and KO.

#### ABC page (3 content rows)

```
R1:   Q   W   E   R   T   Y   U   I   O   P            (10 cells)
R2:  ½   A   S   D   F   G   H   J   K   L  ½          (½ spacer + 9 keys + ½ spacer)
R3:  ⇪Caps  Z   X   C   V   B   N   M  ½  Tab  ½       (Caps + 7 letters + ½ spacer + Tab + ½ spacer)
```

In Korean mode the labels on R1/R2/R3 letter cells become:

| EN | KO (두벌식) | EN | KO | EN | KO |
|----|------------|----|----|----|-----|
| Q | ㅂ | A | ㅁ | Z | ㅋ |
| W | ㅈ | S | ㄴ | X | ㅌ |
| E | ㄷ | D | ㅇ | C | ㅊ |
| R | ㄱ | F | ㄹ | V | ㅍ |
| T | ㅅ | G | ㅎ | B | ㅠ |
| Y | ㅛ | H | ㅗ | N | ㅜ |
| U | ㅕ | J | ㅓ | M | ㅡ |
| I | ㅑ | K | ㅏ | | |
| O | ㅐ | L | ㅣ | | |
| P | ㅔ | | | | |

**Shift behavior in Korean mode**: labels do **not** change when Shift is latched. Only 7 of the 26 letters have distinct shifted 두벌식 forms (ㅃ ㅉ ㄸ ㄲ ㅆ for Q/W/E/R/T; ㅒ / ㅖ for O / P), and swapping only a few would be inconsistent. Users who know 두벌식 know the shifted set; users who don't get a stable, predictable label.

#### 123 page (3 content rows, with inverted-T arrows in the right 2×3 area)

```
R1:   1   2   3   4   5   6   7   8   9   0           (10 cells)
R2:   -   =   [   ]   \   ;   '   ·   ↑   ·           (7 punct + spacer + ↑ + spacer)
R3:   ,   .   /   ·   ·   ·   ·   ←   ↓   →           (3 punct + 4 spacers + ← + ↓ + →)
```

Arrow cells:

- `↑` at column 9 of R2.
- `← ↓ →` at columns 8, 9, 10 of R3.
- `↑` and `↓` share column 9, forming an inverted-T.

Shift latched on the 123 page produces the standard shifted glyphs (`!@#$%^&*()` etc.) — implemented entirely on the DOS side; no client-side label swap.

#### FN page (2 content rows)

```
R1:   ·   ·  F1  F2  F3  F4  F5  F6   ·   ·          (2 spacer + 6 F-keys + 2 spacer)
R2:   ·   ·  F7  F8  F9  F10 F11 F12  ·   ·
```

Keys are 10% wide each, centered with 20%-wide spacers on each side. The keyboard is one row shorter than ABC/123 on this page.

#### Util row (bottom, always shown)

```
[Esc] [Ctrl] [Alt] [Shift] [─── Space ───] [BS] [ENT]
```

Cells are 1 unit each except `Space` which is 4 units. Total flex = 4 mod-narrow + 4 space + 2 narrow = 10 units.

Labels `BS` and `ENT` are textual (not the icons `⌫ ⏎` that the current keyboard uses) per the user's preference.

`Esc`, `Ctrl`, `Alt`, `Shift` keep the sticky-once modifier behavior. `BS` and `ENT` are momentary keys. `Space` is a normal key.

### Desktop layout (>640px)

The existing 6-row desktop layout in `VirtualKeyboard.tsx` stays. **One change**: replace `{ spacer: true, flex: 2 }` in `ROWS[3]` (the Row 4 spacer left of `A`) with `{ code: SC.CAPSLOCK, label: "Caps", flex: 2 }`. The label change to `BS`/`ENT` for backspace and enter applies here too.

**한/영 toggle on desktop**: rendered as a small button positioned absolutely at the top-right of the `.vkb` container, just inside the padding (above the F12 cell). Same toggle effect — swaps QWERTY-position labels between English and 두벌식.

### Korean label mapping

Add a 두벌식 jamo table to `app/lib/dos-keymap.ts` as `HANGUL_LABELS: Record<number, string>` keyed by scancode (e.g. `{ 65: "ㅁ", 81: "ㅂ", ... }`). The keyboard component reads `language` state and renders `language === "ko" ? (HANGUL_LABELS[code] ?? englishLabel) : englishLabel`. Only the 26 letter scancodes have entries; everything else (digits, punctuation, F-keys, arrows, modifiers) shows its English label in both modes.

### Component structure

`VirtualKeyboard.tsx` gets the responsibility of holding two new pieces of state:

1. `page: "abc" | "123" | "fn"` (default `"abc"`)
2. `language: "en" | "ko"` (default `"en"`)

Both reset to default on remount but otherwise stay throughout the session. They do **not** persist to localStorage — page tabs are momentary navigation, and language is a session-scoped preference. (If user feedback later suggests we should persist `language`, that's a one-line `localStorage.setItem` change in a follow-up.)

The component still receives only `onKeyDown(scancode)` and `onKeyUp(scancode)` from its parent — no parent API change.

### State and rendering

Below the existing `pressedRef` and `stickyModsRef` (which stay untouched), add:

- `const [page, setPage] = useState<"abc" | "123" | "fn">("abc");`
- `const [language, setLanguage] = useState<"en" | "ko">("en");`

A media query effect (`window.matchMedia("(max-width: 640px)")`) decides whether to render the mobile paged layout or the desktop full layout. The component renders different `ROWS` arrays based on `page` when in mobile mode; in desktop mode it renders the existing single `ROWS` array with the CapsLock substitution.

The tab bar buttons set `page` and stop propagation. The 한/영 button toggles `language`. None of these calls send scancodes.

### CSS

`app/app.css` gets:

- A `.vkb-tabbar` container styled like a thin top row with the same glass treatment as the keyboard body.
- A `.vkb-tab` class for the three page tabs and the 한/영 button. Active state uses `--color-navy-accent`.
- The existing `@media (max-width: 640px)` block is restructured: the `.vkb-row` rules stay but `.vkb-content` becomes the wrapper for the variable page rows.
- No change to the desktop styles other than ensuring the new CapsLock cell picks up `.vkb-key--mod` and shows visual lock state on press the same way other modifiers do.

### Scancode additions

`SC` in `app/lib/dos-keymap.ts` gains `CAPSLOCK: 280` (already in the `keymap` table — just needs to be re-exported through `SC`).

No other keymap or scancode changes. The 한/영 toggle and tab buttons send nothing.

### Testing

Add a Vitest spec at `app/components/VirtualKeyboard.test.tsx`:

- Renders mobile layout when viewport ≤640 px (jsdom mocked `matchMedia`).
- Tab buttons switch the rendered page (find by `aria-pressed` or by visible content like `Q W E R T Y`).
- 한/영 toggle changes the visible label of the `Q` key from `Q` to `ㅂ` without calling `onKeyDown`.
- CapsLock cell, when tapped, calls `onKeyDown(280)` then `onKeyUp(280)` on pointer release.
- Arrow cells on the 123 page call the right scancodes (`SC.UP`, `SC.LEFT`, etc.) — covers the moved arrow placement.
- Desktop layout still renders all 6 original rows and now includes CapsLock at the Row 4 left position.

## Error handling

Nothing to add. All state is in-component; no failure paths exist that don't already in the current keyboard. SSR safety: `useState` initializers default to mobile-agnostic values (`"abc"`, `"en"`), and the media-query effect runs only on the client.

## Migration / rollout

Single commit. The current keyboard becomes the new keyboard; there's no flag, no fallback. The version-bump pre-commit hook (`.githooks/pre-commit`, currently shadowed per `feedback_dosbox_pre_commit_hook_shadowed.md`) needs a manual `package.json` patch bump in the deploy commit.

## Risks

- **640 px boundary jank**: when a tablet user rotates between portrait and landscape near the breakpoint, the layout changes drastically (paged ↔ full). Acceptable — that's standard responsive behavior — but worth a visual smoke test.
- **CapsLock vs. sticky modifiers**: CapsLock is a *toggle* on the DOS side, not a sticky-once modifier on the client. Treat it as a normal momentary key in `VirtualKeyboard.tsx` (no entry in `stickyModsRef`), and let DOS track lock state. The client has no reliable way to read DOSBox's CapsLock state back, so no visual lock indicator on the cell. Users see the effect via typing.
- **한/영 button discoverability**: positioning the desktop toggle as an absolute-positioned button inside `.vkb` is a departure from the rest of the keyboard's layout. If it ends up visually awkward (overlapping F12 or the close affordance), fall back to placing it as a single extra cell at the right end of Row 1 alongside Esc + F1–F12.
