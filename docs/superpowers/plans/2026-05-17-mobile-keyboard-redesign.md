# Mobile Virtual Keyboard Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace `VirtualKeyboard.tsx`'s single-page 6-row mobile layout with a 3-tab paged design (ABC / 123 / FN, 10%-uniform cells, inverted-T arrows on the 123 page), add CapsLock to both mobile and desktop, swap backspace/enter icons to `BS`/`ENT` text labels, and add a visual-only `한/영` toggle that swaps QWERTY-position labels between English and 두벌식 jamo.

**Architecture:** Single React component branches on a `matchMedia("(max-width: 640px)")` query. Mobile path renders a tab bar + active page rows + always-visible util row. Desktop path renders the existing 6 rows with a CapsLock substitution and an absolute-positioned `한/영` overlay. All key labels resolve through one shared lookup (English label or `HANGUL_LABELS[scancode]` when `language === "ko"`). Scancodes never change — the toggle is presentation only.

**Tech Stack:** React 19, TypeScript strict, plain CSS (no Tailwind in `app.css`'s vkb section), Vitest (node env, no jsdom / RTL — UI verification is manual browser smoke test).

**Spec:** `docs/superpowers/specs/2026-05-17-mobile-keyboard-redesign-design.md`

---

## Background context (read before starting)

- Current keyboard: `app/components/VirtualKeyboard.tsx` (200 lines). Reads scancode constants from `SC` in `app/lib/dos-keymap.ts`. Modifiers (Shift/Ctrl/Alt) use a "sticky-once" model: tap latches, next non-modifier key fires it and releases.
- Keymap values are **GLFW-style** keycodes (e.g. `A = 65`, `CapsLock = 280`, `ArrowUp = 265`), NOT SDL2 / USB HID. The `keymap` object already includes `CapsLock: 280`; only the re-export in `SC` is missing.
- CSS for the keyboard lives in `app/app.css` under the `/* ── Virtual keyboard (glass overlay) ─────── */` section starting around line 379. The `@media (max-width: 640px)` block at line 481 holds today's phone overrides.
- Tests are in `app/lib/*.test.ts`. Vitest config (`vitest.config.ts`) uses `environment: "node"`. There are no React component tests yet and no jsdom / @testing-library dependencies. **Do not add them** for this task — UI changes are verified by running `npm run dev` and manually exercising the keyboard in a browser at both desktop and mobile viewports.
- Per-commit auto version bump is shadowed (see `memory/feedback_dosbox_pre_commit_hook_shadowed.md`). Manually bump `package.json`'s patch version in the final commit.

## File map

- **Modify** `app/lib/dos-keymap.ts` — add `CAPSLOCK: 280` to `SC`; add `HANGUL_LABELS` table mapping the 26 letter scancodes to 두벌식 jamo strings.
- **Create** `app/lib/dos-keymap.test.ts` — verify `SC.CAPSLOCK === 280` and that `HANGUL_LABELS` has exactly the 26 letter entries with correct jamo.
- **Modify** `app/app.css` — add `.vkb-tabbar`, `.vkb-tab`, `.vkb-tab--active`, `.vkb-content`, `.vkb-lang-btn`, `.vkb-page-key--spacer` classes. Remove the now-unused `.vkb-arrows-col` mobile override.
- **Modify** `app/components/VirtualKeyboard.tsx` — full rewrite (~350 lines). Adds page/language state, useMediaQuery, mobile branch with ABC/123/FN layouts + tab bar + util row, desktop branch with CapsLock + BS/ENT labels + absolute lang button.
- **Modify** `package.json` — patch version bump.

---

## Task 1: Keymap additions + unit test

**Files:**
- Modify: `app/lib/dos-keymap.ts`
- Create: `app/lib/dos-keymap.test.ts`

- [ ] **Step 1: Write the failing test**

Create `app/lib/dos-keymap.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { HANGUL_LABELS, SC } from "./dos-keymap";

describe("SC", () => {
  it("exports CAPSLOCK as 280 (GLFW)", () => {
    expect(SC.CAPSLOCK).toBe(280);
  });
});

describe("HANGUL_LABELS", () => {
  it("has exactly 26 entries — one per letter scancode", () => {
    expect(Object.keys(HANGUL_LABELS)).toHaveLength(26);
  });

  it("maps each ASCII letter scancode to its 두벌식 jamo", () => {
    const expected: Record<number, string> = {
      // Top row Q W E R T Y U I O P
      [SC.Q]: "ㅂ", [SC.W]: "ㅈ", [SC.E]: "ㄷ", [SC.R]: "ㄱ", [SC.T]: "ㅅ",
      [SC.Y]: "ㅛ", [SC.U]: "ㅕ", [SC.I]: "ㅑ", [SC.O]: "ㅐ", [SC.P]: "ㅔ",
      // Home row A S D F G H J K L
      [SC.A]: "ㅁ", [SC.S]: "ㄴ", [SC.D]: "ㅇ", [SC.F]: "ㄹ", [SC.G]: "ㅎ",
      [SC.H]: "ㅗ", [SC.J]: "ㅓ", [SC.K]: "ㅏ", [SC.L]: "ㅣ",
      // Bottom row Z X C V B N M
      [SC.Z]: "ㅋ", [SC.X]: "ㅌ", [SC.C]: "ㅊ", [SC.V]: "ㅍ", [SC.B]: "ㅠ",
      [SC.N]: "ㅜ", [SC.M]: "ㅡ",
    };
    for (const [code, jamo] of Object.entries(expected)) {
      expect(HANGUL_LABELS[Number(code)]).toBe(jamo);
    }
  });

  it("does not contain entries for non-letter keys", () => {
    expect(HANGUL_LABELS[SC.SPACE]).toBeUndefined();
    expect(HANGUL_LABELS[SC.ENTER]).toBeUndefined();
    expect(HANGUL_LABELS[SC.D1]).toBeUndefined();
    expect(HANGUL_LABELS[SC.F1]).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npx vitest run app/lib/dos-keymap.test.ts
```

Expected: FAIL — `SC.CAPSLOCK` is undefined and `HANGUL_LABELS` does not exist.

- [ ] **Step 3: Add the implementation**

Modify `app/lib/dos-keymap.ts`. In the `SC` const block (around line 82-95), add `CAPSLOCK: 280,` on a new line — group it with `BS` / `TAB` / `ENTER` / `SPACE` for clarity:

```ts
export const SC = {
  ESC: 256, BS: 259, TAB: 258, ENTER: 257, SPACE: 32, CAPSLOCK: 280,
  SHIFT: 340, CTRL: 341, ALT: 342,
  // ... rest unchanged
} as const;
```

Below the `SC` const (at the end of the file), append the Hangul label table:

```ts
// 두벌식 (Dubeolsik / "two-set") Korean jamo positions on a standard
// US QWERTY keyboard. Used by VirtualKeyboard for visual-only label
// swapping when 한/영 is set to Korean — scancodes are unchanged, so
// DOS still receives A/B/C etc. and any DOS-side IME (e.g. 한글 도깨비)
// controls the actual input mode.
export const HANGUL_LABELS: Readonly<Record<number, string>> = {
  // Top row
  [SC.Q]: "ㅂ", [SC.W]: "ㅈ", [SC.E]: "ㄷ", [SC.R]: "ㄱ", [SC.T]: "ㅅ",
  [SC.Y]: "ㅛ", [SC.U]: "ㅕ", [SC.I]: "ㅑ", [SC.O]: "ㅐ", [SC.P]: "ㅔ",
  // Home row
  [SC.A]: "ㅁ", [SC.S]: "ㄴ", [SC.D]: "ㅇ", [SC.F]: "ㄹ", [SC.G]: "ㅎ",
  [SC.H]: "ㅗ", [SC.J]: "ㅓ", [SC.K]: "ㅏ", [SC.L]: "ㅣ",
  // Bottom row
  [SC.Z]: "ㅋ", [SC.X]: "ㅌ", [SC.C]: "ㅊ", [SC.V]: "ㅍ", [SC.B]: "ㅠ",
  [SC.N]: "ㅜ", [SC.M]: "ㅡ",
};
```

- [ ] **Step 4: Run test to verify it passes**

```bash
npx vitest run app/lib/dos-keymap.test.ts
```

Expected: PASS, 3 tests.

- [ ] **Step 5: Typecheck**

```bash
npm run typecheck
```

Expected: clean.

- [ ] **Step 6: Commit**

```bash
git add app/lib/dos-keymap.ts app/lib/dos-keymap.test.ts
git commit -m "feat(dos): add CAPSLOCK scancode + 두벌식 label table"
```

---

## Task 2: CSS scaffolding for tab bar + content area

**Files:**
- Modify: `app/app.css`

No tests for CSS — verified visually in Task 4.

- [ ] **Step 1: Add tab bar + content area styles**

In `app/app.css`, locate the `/* ── Virtual keyboard (glass overlay) ─────────────── */` section (around line 379). After the `@keyframes vkb-in {...}` block (around line 413), insert these new rules **before** the existing `.vkb-row { display: flex; gap: 5px; }`:

```css
/* Mobile-only tab bar (ABC / 123 / FN on left, 한/영 on right) */
.vkb-tabbar {
  display: flex;
  gap: 5px;
  margin-bottom: 5px;
}
.vkb-tab {
  flex: 1 1 0;
  min-width: 0;
  min-height: 32px;
  padding: 4px 0;
  border: 1px solid rgba(255, 255, 255, 0.07);
  border-radius: 5px;
  background: rgba(255, 255, 255, 0.03);
  color: var(--color-navy-muted);
  font-family: var(--font-mono);
  font-size: 11px;
  font-weight: 500;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  cursor: pointer;
}
.vkb-tab--active {
  background: var(--color-navy-accent);
  border-color: var(--color-navy-accent);
  color: #050912;
  font-weight: 700;
}
.vkb-tab--spacer {
  flex-grow: 6;
  visibility: hidden;
}

/* Mobile page content (between tab bar and util row) */
.vkb-content {
  display: flex;
  flex-direction: column;
  gap: 5px;
}

/* Desktop-only absolute-positioned 한/영 button (above F12) */
.vkb-lang-btn {
  position: absolute;
  top: 10px;
  right: 10px;
  min-height: 26px;
  padding: 3px 10px;
  border: 1px solid rgba(91, 141, 239, 0.3);
  border-radius: 5px;
  background: rgba(10, 15, 31, 0.6);
  color: var(--color-navy-text);
  font-family: var(--font-mono);
  font-size: 10px;
  font-weight: 600;
  letter-spacing: 0.08em;
  cursor: pointer;
  z-index: 1;
}
.vkb-lang-btn--active {
  background: var(--color-navy-accent);
  border-color: var(--color-navy-accent);
  color: #050912;
}
```

- [ ] **Step 2: Remove the now-unused mobile arrow-cluster override**

Inside the `@media (max-width: 640px) { ... }` block (around line 481), delete the `.vkb-arrows-col { flex: 3 1 0; min-width: 0; gap: 4px; }` rule. Arrows are no longer rendered as a side cluster on mobile (they live inside the 123 page).

The desktop `.vkb-arrows-col { flex: 0 0 156px; display: flex; gap: 5px; }` rule (around line 419) stays — desktop still uses it.

- [ ] **Step 3: Make `.vkb` a positioning context (for absolute lang button)**

In the `.vkb { ... }` block at line 381, the existing `position: fixed` already establishes a positioning context — no change needed. **Verify** by reading the block; no edit required if `position: fixed` is present.

- [ ] **Step 4: Commit**

```bash
git add app/app.css
git commit -m "style(dos): tab bar + content area + lang-button CSS for new keyboard"
```

---

## Task 3: Rewrite VirtualKeyboard with mobile/desktop branching

**Files:**
- Modify: `app/components/VirtualKeyboard.tsx` (full rewrite)

This is the largest task. The whole file is replaced. No tests at the component level (see Background context); manual smoke test happens in Task 4.

- [ ] **Step 1: Replace `app/components/VirtualKeyboard.tsx` with the new implementation**

Overwrite the entire file with:

```tsx
// app/components/VirtualKeyboard.tsx
//
// Two layouts behind one component:
//
//  - Mobile (viewport ≤640px): tab bar (ABC/123/FN + 한/영) on top,
//    active-page rows in the middle, always-visible util row at the
//    bottom. Cells uniformly 10% of width; arrows live on the 123
//    page as an inverted-T occupying R2 col 9 and R3 cols 8-10.
//
//  - Desktop (viewport >640px): the original 6-row full keyboard,
//    with CapsLock filling the Row 4 left spacer and an absolutely
//    positioned 한/영 button at the top-right.
//
// 한/영 toggle is presentation-only: it swaps Q-M letter labels
// between English and 두벌식 jamo (from HANGUL_LABELS). Scancodes
// are unchanged — DOS still receives A/B/C etc.
//
// Sticky-once modifier semantics (Shift/Ctrl/Alt latch, release
// after the next non-modifier key) preserved from the old keyboard.
// CapsLock is a *normal momentary key*, not a sticky modifier —
// DOS tracks its toggled state internally.

import { useCallback, useEffect, useReducer, useRef, useState } from "react";
import { HANGUL_LABELS, SC } from "../lib/dos-keymap";

export interface VirtualKeyboardProps {
  onKeyDown: (scancode: number) => void;
  onKeyUp: (scancode: number) => void;
}

type KeyDef =
  | { spacer: true; flex?: number }
  | {
      code: number;
      label: string;
      flex?: number;
      modifier?: boolean;
      spacer?: false;
    };

type Page = "abc" | "123" | "fn";
type Language = "en" | "ko";

// ── Desktop full layout (original 6 rows + CapsLock + BS/ENT) ────
// All main rows total flex = 15.25 so letter-cell widths match.
const DESKTOP_ROWS: KeyDef[][] = [
  // Row 1: Esc + F1..F12 (3.25 + 12 = 15.25)
  [
    { code: SC.ESC, label: "Esc", flex: 3.25 },
    { code: SC.F1, label: "F1" }, { code: SC.F2, label: "F2" }, { code: SC.F3, label: "F3" },
    { code: SC.F4, label: "F4" }, { code: SC.F5, label: "F5" }, { code: SC.F6, label: "F6" },
    { code: SC.F7, label: "F7" }, { code: SC.F8, label: "F8" }, { code: SC.F9, label: "F9" },
    { code: SC.F10, label: "F10" }, { code: SC.F11, label: "F11" }, { code: SC.F12, label: "F12" },
  ],
  // Row 2: digits + BS (12 + 3.25 = 15.25)
  [
    { code: SC.D1, label: "1" }, { code: SC.D2, label: "2" }, { code: SC.D3, label: "3" },
    { code: SC.D4, label: "4" }, { code: SC.D5, label: "5" }, { code: SC.D6, label: "6" },
    { code: SC.D7, label: "7" }, { code: SC.D8, label: "8" }, { code: SC.D9, label: "9" },
    { code: SC.D0, label: "0" }, { code: SC.MINUS, label: "-" }, { code: SC.EQUAL, label: "=" },
    { code: SC.BS, label: "BS", flex: 3.25 },
  ],
  // Row 3: Tab + Q..P + brackets + backslash (2.25 + 13 = 15.25)
  [
    { code: SC.TAB, label: "Tab", flex: 2.25 },
    { code: SC.Q, label: "Q" }, { code: SC.W, label: "W" }, { code: SC.E, label: "E" },
    { code: SC.R, label: "R" }, { code: SC.T, label: "T" }, { code: SC.Y, label: "Y" },
    { code: SC.U, label: "U" }, { code: SC.I, label: "I" }, { code: SC.O, label: "O" },
    { code: SC.P, label: "P" },
    { code: SC.LBRACKET, label: "[" }, { code: SC.RBRACKET, label: "]" },
    { code: SC.BACKSLASH, label: "\\" },
  ],
  // Row 4: CapsLock + A..L + ; ' + ENT (2 + 11 + 2.25 = 15.25)
  // CapsLock replaces the old Row 4 left spacer.
  [
    { code: SC.CAPSLOCK, label: "Caps", flex: 2 },
    { code: SC.A, label: "A" }, { code: SC.S, label: "S" }, { code: SC.D, label: "D" },
    { code: SC.F, label: "F" }, { code: SC.G, label: "G" }, { code: SC.H, label: "H" },
    { code: SC.J, label: "J" }, { code: SC.K, label: "K" }, { code: SC.L, label: "L" },
    { code: SC.SEMICOLON, label: ";" }, { code: SC.QUOTE, label: "'" },
    { code: SC.ENTER, label: "ENT", flex: 2.25 },
  ],
  // Row 5 main: Shift + Z..M + , . / (2.25 + 10 = 12.25, arrow col follows)
  [
    { code: SC.SHIFT, label: "Shift", flex: 2.25, modifier: true },
    { code: SC.Z, label: "Z" }, { code: SC.X, label: "X" }, { code: SC.C, label: "C" },
    { code: SC.V, label: "V" }, { code: SC.B, label: "B" }, { code: SC.N, label: "N" },
    { code: SC.M, label: "M" },
    { code: SC.COMMA, label: "," }, { code: SC.PERIOD, label: "." }, { code: SC.SLASH, label: "/" },
  ],
  // Row 6 main: Ctrl Alt Space Alt (1.5 + 1.25 + 8.25 + 1.25 = 12.25, arrow col follows)
  [
    { code: SC.CTRL, label: "Ctrl", flex: 1.5, modifier: true },
    { code: SC.ALT, label: "Alt", flex: 1.25, modifier: true },
    { code: SC.SPACE, label: "Space", flex: 8.25 },
    { code: SC.ALT, label: "Alt", flex: 1.25, modifier: true },
  ],
];

// Fixed-width arrow cluster appended to desktop rows 5 and 6.
const DESKTOP_ARROW_CLUSTERS: Record<number, KeyDef[]> = {
  4: [
    { spacer: true },
    { code: SC.UP, label: "↑" },
    { spacer: true },
  ],
  5: [
    { code: SC.LEFT, label: "←" },
    { code: SC.DOWN, label: "↓" },
    { code: SC.RIGHT, label: "→" },
  ],
};

// ── Mobile layouts ────────────────────────────────────────────────
// All rows are 10 flex units. Spacers fill unused cells.
const MOBILE_PAGES: Record<Page, KeyDef[][]> = {
  abc: [
    // Q W E R T Y U I O P (10)
    [
      { code: SC.Q, label: "Q" }, { code: SC.W, label: "W" }, { code: SC.E, label: "E" },
      { code: SC.R, label: "R" }, { code: SC.T, label: "T" }, { code: SC.Y, label: "Y" },
      { code: SC.U, label: "U" }, { code: SC.I, label: "I" }, { code: SC.O, label: "O" },
      { code: SC.P, label: "P" },
    ],
    // ½ spacer + A..L + ½ spacer (0.5 + 9 + 0.5 = 10)
    [
      { spacer: true, flex: 0.5 },
      { code: SC.A, label: "A" }, { code: SC.S, label: "S" }, { code: SC.D, label: "D" },
      { code: SC.F, label: "F" }, { code: SC.G, label: "G" }, { code: SC.H, label: "H" },
      { code: SC.J, label: "J" }, { code: SC.K, label: "K" }, { code: SC.L, label: "L" },
      { spacer: true, flex: 0.5 },
    ],
    // Caps + Z..M + ½ spacer + Tab + ½ spacer (1 + 7 + 0.5 + 1 + 0.5 = 10)
    [
      { code: SC.CAPSLOCK, label: "Caps", modifier: false },
      { code: SC.Z, label: "Z" }, { code: SC.X, label: "X" }, { code: SC.C, label: "C" },
      { code: SC.V, label: "V" }, { code: SC.B, label: "B" }, { code: SC.N, label: "N" },
      { code: SC.M, label: "M" },
      { spacer: true, flex: 0.5 },
      { code: SC.TAB, label: "Tab" },
      { spacer: true, flex: 0.5 },
    ],
  ],
  "123": [
    // 1..0 (10)
    [
      { code: SC.D1, label: "1" }, { code: SC.D2, label: "2" }, { code: SC.D3, label: "3" },
      { code: SC.D4, label: "4" }, { code: SC.D5, label: "5" }, { code: SC.D6, label: "6" },
      { code: SC.D7, label: "7" }, { code: SC.D8, label: "8" }, { code: SC.D9, label: "9" },
      { code: SC.D0, label: "0" },
    ],
    // - = [ ] \ ; ' + spacer + ↑ + spacer (7 + 1 + 1 + 1 = 10)
    [
      { code: SC.MINUS, label: "-" }, { code: SC.EQUAL, label: "=" },
      { code: SC.LBRACKET, label: "[" }, { code: SC.RBRACKET, label: "]" },
      { code: SC.BACKSLASH, label: "\\" },
      { code: SC.SEMICOLON, label: ";" }, { code: SC.QUOTE, label: "'" },
      { spacer: true },
      { code: SC.UP, label: "↑" },
      { spacer: true },
    ],
    // , . / + 4 spacers + ← ↓ → (3 + 4 + 3 = 10)
    [
      { code: SC.COMMA, label: "," }, { code: SC.PERIOD, label: "." }, { code: SC.SLASH, label: "/" },
      { spacer: true }, { spacer: true }, { spacer: true }, { spacer: true },
      { code: SC.LEFT, label: "←" },
      { code: SC.DOWN, label: "↓" },
      { code: SC.RIGHT, label: "→" },
    ],
  ],
  fn: [
    // 2-wide spacer + F1..F6 + 2-wide spacer (2 + 6 + 2 = 10)
    [
      { spacer: true, flex: 2 },
      { code: SC.F1, label: "F1" }, { code: SC.F2, label: "F2" }, { code: SC.F3, label: "F3" },
      { code: SC.F4, label: "F4" }, { code: SC.F5, label: "F5" }, { code: SC.F6, label: "F6" },
      { spacer: true, flex: 2 },
    ],
    // 2-wide spacer + F7..F12 + 2-wide spacer
    [
      { spacer: true, flex: 2 },
      { code: SC.F7, label: "F7" }, { code: SC.F8, label: "F8" }, { code: SC.F9, label: "F9" },
      { code: SC.F10, label: "F10" }, { code: SC.F11, label: "F11" }, { code: SC.F12, label: "F12" },
      { spacer: true, flex: 2 },
    ],
  ],
};

// Always-visible bottom row on every mobile page.
// Esc Ctrl Alt Shift + Space (4-wide) + BS ENT (4 mod + 4 space + 2 narrow = 10)
const MOBILE_UTIL_ROW: KeyDef[] = [
  { code: SC.ESC, label: "Esc", modifier: false },
  { code: SC.CTRL, label: "Ctrl", modifier: true },
  { code: SC.ALT, label: "Alt", modifier: true },
  { code: SC.SHIFT, label: "Shift", modifier: true },
  { code: SC.SPACE, label: "Space", flex: 4 },
  { code: SC.BS, label: "BS" },
  { code: SC.ENTER, label: "ENT" },
];

// Hook: subscribes to (max-width: 640px) media query. Returns false
// on SSR and during the first render; updates after mount.
function useIsMobile(): boolean {
  const [isMobile, setIsMobile] = useState(false);
  useEffect(() => {
    const mql = window.matchMedia("(max-width: 640px)");
    const update = () => setIsMobile(mql.matches);
    update();
    mql.addEventListener("change", update);
    return () => mql.removeEventListener("change", update);
  }, []);
  return isMobile;
}

export function VirtualKeyboard({ onKeyDown, onKeyUp }: VirtualKeyboardProps) {
  // Refs hold authoritative dedupe state — mutated synchronously
  // inside event handlers so two pointer events arriving before React
  // re-renders can't both emit the same scancode. setRender bumps a
  // counter to trigger re-render after each mutation.
  const pressedRef = useRef<Set<string>>(new Set());
  const stickyModsRef = useRef<Set<number>>(new Set());
  const [, setRender] = useReducer((x: number) => x + 1, 0);

  const [page, setPage] = useState<Page>("abc");
  const [language, setLanguage] = useState<Language>("en");
  const isMobile = useIsMobile();

  const handleDown = useCallback(
    (id: string, code: number, isModifier: boolean) => {
      if (isModifier) {
        const mods = stickyModsRef.current;
        if (mods.has(code)) {
          mods.delete(code);
          onKeyUp(code);
        } else {
          mods.add(code);
          onKeyDown(code);
        }
        setRender();
        return;
      }
      const pressed = pressedRef.current;
      if (pressed.has(id)) return;
      pressed.add(id);
      onKeyDown(code);
      setRender();
    },
    [onKeyDown, onKeyUp]
  );

  const handleUp = useCallback(
    (id: string, code: number, isModifier: boolean) => {
      if (isModifier) return;
      const pressed = pressedRef.current;
      if (!pressed.has(id)) return;
      pressed.delete(id);
      onKeyUp(code);
      const mods = stickyModsRef.current;
      if (mods.size > 0) {
        for (const m of mods) onKeyUp(m);
        mods.clear();
      }
      setRender();
    },
    [onKeyUp]
  );

  // Resolve label: Korean mode overrides letters via HANGUL_LABELS;
  // everything else (digits, punct, F-keys, modifiers, arrows) keeps
  // its English label even when language === "ko".
  function resolveLabel(k: Exclude<KeyDef, { spacer: true }>): string {
    if (language === "ko") {
      const jamo = HANGUL_LABELS[k.code];
      if (jamo) return jamo;
    }
    return k.label;
  }

  function renderCell(k: KeyDef, id: string) {
    if (k.spacer) {
      return (
        <div
          key={id}
          className="vkb-spacer"
          style={{ flexGrow: k.flex ?? 1 }}
          aria-hidden="true"
        />
      );
    }
    const isMod = !!k.modifier;
    const isPressed = isMod
      ? stickyModsRef.current.has(k.code)
      : pressedRef.current.has(id);
    return (
      <button
        key={id}
        type="button"
        tabIndex={-1}
        aria-pressed={isPressed}
        className={
          "vkb-key" +
          (isPressed ? " vkb-key--pressed" : "") +
          (isMod ? " vkb-key--mod" : "")
        }
        style={{ flexGrow: k.flex ?? 1 }}
        onPointerDown={(e) => {
          e.preventDefault();
          handleDown(id, k.code, isMod);
        }}
        onPointerUp={(e) => {
          e.preventDefault();
          handleUp(id, k.code, isMod);
        }}
        onPointerCancel={() => handleUp(id, k.code, isMod)}
        onPointerLeave={(e) => {
          if (e.buttons !== 0) handleUp(id, k.code, isMod);
        }}
        onContextMenu={(e) => e.preventDefault()}
      >
        {resolveLabel(k)}
      </button>
    );
  }

  function renderRow(row: KeyDef[], prefix: string) {
    return (
      <div className="vkb-row" key={prefix}>
        {row.map((k, ki) => renderCell(k, `${prefix}-${ki}`))}
      </div>
    );
  }

  function renderLangButton(className: string) {
    return (
      <button
        type="button"
        tabIndex={-1}
        className={
          className + (language === "ko" ? " " + className + "--active" : "")
        }
        onPointerDown={(e) => {
          e.preventDefault();
          setLanguage((l) => (l === "en" ? "ko" : "en"));
        }}
        onContextMenu={(e) => e.preventDefault()}
      >
        {language === "ko" ? "한" : "EN"}
      </button>
    );
  }

  if (isMobile) {
    return (
      <div className="vkb" role="group" aria-label="DOS 가상 키보드">
        <div className="vkb-tabbar">
          {(["abc", "123", "fn"] as const).map((p) => (
            <button
              key={p}
              type="button"
              tabIndex={-1}
              className={"vkb-tab" + (page === p ? " vkb-tab--active" : "")}
              onPointerDown={(e) => {
                e.preventDefault();
                setPage(p);
              }}
              onContextMenu={(e) => e.preventDefault()}
            >
              {p === "abc" ? "ABC" : p === "123" ? "123" : "FN"}
            </button>
          ))}
          <div className="vkb-tab vkb-tab--spacer" aria-hidden="true" />
          {renderLangButton("vkb-tab")}
        </div>

        <div className="vkb-content">
          {MOBILE_PAGES[page].map((row, ri) => renderRow(row, `${page}-${ri}`))}
        </div>

        {renderRow(MOBILE_UTIL_ROW, "util")}
      </div>
    );
  }

  // Desktop: original 6 rows with CapsLock substitution + BS/ENT labels
  // + absolute-positioned 한/영 button.
  return (
    <div className="vkb" role="group" aria-label="DOS 가상 키보드">
      {renderLangButton("vkb-lang-btn")}
      {DESKTOP_ROWS.map((row, ri) => {
        const arrows = DESKTOP_ARROW_CLUSTERS[ri];
        return (
          <div className="vkb-row" key={ri}>
            {row.map((k, ki) => renderCell(k, `${ri}-${ki}`))}
            {arrows && (
              <div className="vkb-arrows-col">
                {arrows.map((k, ki) => renderCell(k, `${ri}-a${ki}`))}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
```

- [ ] **Step 2: Typecheck**

```bash
npm run typecheck
```

Expected: clean. If anything errors, the most likely cause is a forgotten `as const` or a `Page`/`Language` literal mismatch — fix and re-run.

- [ ] **Step 3: Run unit tests**

```bash
npm test
```

Expected: all existing tests + the new dos-keymap tests pass.

- [ ] **Step 4: Commit**

```bash
git add app/components/VirtualKeyboard.tsx
git commit -m "feat(dos): 3-tab mobile keyboard + CapsLock + 한/영 visual toggle"
```

---

## Task 4: Manual smoke test + version bump + final commit

**Files:**
- Modify: `package.json` (patch version bump)

- [ ] **Step 1: Start dev server**

```bash
npm run dev
```

Wait until the server reports it is listening (usually `http://localhost:5173`).

- [ ] **Step 2: Desktop visual checks (browser at default width)**

In your browser, open the app and either log in or wait for the DOS bundle to boot. Open the virtual keyboard via the toolbar's keyboard toggle if it isn't visible (touch detection only auto-shows it on coarse pointers).

Verify each item; if any fails, fix in `VirtualKeyboard.tsx` or `app.css` before continuing:

  - [ ] Row 4's left key shows `Caps` (where the old spacer was).
  - [ ] Tap `Caps` — DOS receives a CapsLock press/release (verify by typing in a DOS app and observing case change; or open a DOS shell and watch the indicator).
  - [ ] Row 2's right key shows `BS` (text, not `⌫` icon). Tap → DOS receives Backspace.
  - [ ] Row 4's right key shows `ENT` (text, not `⏎` icon). Tap → DOS receives Enter.
  - [ ] Top-right corner of the keyboard shows a small `EN` button. Tap it → label changes to `한` (highlighted), and Q W E R T Y U I O P / A S D F G H J K L / Z X C V B N M now read ㅂ ㅈ ㄷ ㄱ ㅅ ㅛ ㅕ ㅑ ㅐ ㅔ / ㅁ ㄴ ㅇ ㄹ ㅎ ㅗ ㅓ ㅏ ㅣ / ㅋ ㅌ ㅊ ㅍ ㅠ ㅜ ㅡ. Tap a now-Korean key (e.g. `ㅂ` cell) → DOS still receives an English `Q` (visual-only swap).
  - [ ] Tap the `한` button again → reverts to English labels.
  - [ ] Sticky modifiers still work: tap Shift, then Q → DOS receives Shift+Q; Shift visually unlatches after.
  - [ ] Arrow cluster on the right (↑ alone on R5, ←↓→ on R6) is unchanged.

- [ ] **Step 3: Mobile visual checks (browser dev tools, resize to ≤640px)**

Open the browser's device toolbar (Cmd/Ctrl+Shift+M in Chrome) and pick a phone profile like "iPhone SE" (375 × 667). The keyboard should switch layouts.

Verify each item:

  - [ ] Tab bar at top shows `[ABC] [123] [FN]` on the left, blank spacer, `EN` on the right. `ABC` is highlighted by default.
  - [ ] **ABC page (default)** — 3 content rows:
    - R1: `Q W E R T Y U I O P` (10 evenly-sized keys)
    - R2: `A S D F G H J K L` centered (with ½ spacer on each side, 9 keys visually offset)
    - R3: `Caps Z X C V B N M Tab` with ½ spacer between M and Tab. All cells the same width.
  - [ ] Util row below shows `Esc Ctrl Alt Shift [Space] BS ENT`. Space is roughly 4× wider than the others.
  - [ ] Tap `123` tab → it highlights, content area becomes:
    - R1: `1 2 3 4 5 6 7 8 9 0`
    - R2: `- = [ ] \ ; '` then empty cell then `↑` then empty cell
    - R3: `, . /` then four empty cells then `← ↓ →`
    - Visual check: drop an imaginary vertical line down the `↑` — it should hit `↓` directly. The 4 empty cells in R3 between `/` and `←` align with the 7 punct cells in R2.
  - [ ] Tap `FN` tab → content area becomes 2 rows: `F1 F2 F3 F4 F5 F6` centered (20% empty on each side), `F7 F8 F9 F10 F11 F12` centered the same way. Keyboard is one row shorter than ABC/123.
  - [ ] Tap each arrow on the 123 page — DOS cursor moves in the corresponding direction (or in a DOS app, observe the response).
  - [ ] Tap `EN` on the right of the tab bar → switches to `한`. Switch back to ABC tab — letters are now Korean jamo, but scancodes still send English (tap any to confirm via DOS echo).
  - [ ] Tap `Caps` on the ABC page → DOS CapsLock toggles.

- [ ] **Step 4: Landscape mobile spot check**

Rotate the device profile to landscape (e.g. 667 × 375). Layout should still be paged (still ≤640 px on the shorter axis? — check `mql.matches` interpretation: the rule is `max-width: 640px`, so landscape phones >640 px wide switch to **desktop**. That's expected; verify the desktop full keyboard renders cleanly at that width). If desktop overlaps the canvas badly, that's a separate issue out of scope.

- [ ] **Step 5: Patch-bump `package.json`**

Open `package.json`, increment the patch portion of `"version"` by 1 (e.g. `0.x.y` → `0.x.(y+1)`). The pre-commit auto-bump hook is shadowed in this repo per `memory/feedback_dosbox_pre_commit_hook_shadowed.md`, so this bump must be manual.

- [ ] **Step 6: Final commit**

```bash
git add package.json
git commit -m "chore: bump patch for mobile keyboard redesign"
```

- [ ] **Step 7: Stop the dev server**

In the dev server terminal, press Ctrl-C.

---

## Self-Review Pass

Before declaring the plan complete, re-read it against the spec at `docs/superpowers/specs/2026-05-17-mobile-keyboard-redesign-design.md`:

- ✅ Tab bar (ABC / 123 / FN + 한/영) — Task 3 mobile branch.
- ✅ Mobile uniform 10% cells — Task 3 layout arrays with spacer padding.
- ✅ ABC page (3 rows, Caps + letters + Tab on R3) — Task 3 MOBILE_PAGES.abc.
- ✅ 123 page (3 rows, arrows on R2 col 9 and R3 col 8-10) — Task 3 MOBILE_PAGES["123"].
- ✅ FN page (2 rows, F-keys centered) — Task 3 MOBILE_PAGES.fn.
- ✅ Util row (Esc/Ctrl/Alt/Shift/Space/BS/ENT, always visible) — Task 3 MOBILE_UTIL_ROW.
- ✅ Korean labels for letter keys only — Task 1 HANGUL_LABELS, Task 3 resolveLabel.
- ✅ Korean toggle sends no scancodes — Task 3 renderLangButton (only calls setLanguage).
- ✅ Shift behavior in Korean mode: labels unchanged — Task 3 resolveLabel (no shift-aware override).
- ✅ Desktop CapsLock at Row 4 left position — Task 3 DESKTOP_ROWS[3].
- ✅ Desktop BS / ENT text labels — Task 3 DESKTOP_ROWS labels.
- ✅ Desktop 한/영 absolute-positioned button — Task 3 desktop branch + Task 2 `.vkb-lang-btn`.
- ✅ Sticky-once modifiers preserved — Task 3 handleDown / handleUp unchanged from original.
- ✅ CapsLock as momentary key, not sticky — Task 3 DESKTOP_ROWS[3] and MOBILE_PAGES.abc[2] both have `modifier: false` (or omitted) for SC.CAPSLOCK.
- ✅ 640 px breakpoint — Task 3 useIsMobile hook.
- ✅ No new keys beyond CapsLock — Task 3 layouts contain exactly the original set plus CapsLock.
- ✅ Tests for keymap additions — Task 1.

No placeholders, no "implement appropriately" handwaves, no references to undefined symbols. Type names (`Page`, `Language`, `KeyDef`) and function names (`useIsMobile`, `renderRow`, `renderLangButton`, `resolveLabel`) are consistent throughout the plan and the code.
