# Keyboard ANSI stagger + Shift-aware labels + Sym page implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rebuild the virtual keyboard so both viewports use proper ANSI QWERTY stagger, the held Shift state swaps non-letter labels, and mobile portrait gains a `Sym` toggle (replacing the `ABC` / `123` / `FN` tab bar) per `docs/superpowers/specs/2026-05-19-keyboard-stagger-shift-redesign-design.md`.

**Architecture:** All changes are confined to three files: `app/lib/dos-keymap.ts` (new `SC.GRAVE` + `SHIFT_LABELS` table), `app/components/VirtualKeyboard.tsx` (rewrites `DESKTOP_ROWS`, `MOBILE_PAGES`, `MOBILE_UTIL_ROW`; drops `DESKTOP_ARROW_CLUSTERS` and the tab-bar JSX; adds shift-aware label rendering + Sym page state), and `app/app.css` (new amber tokens + classes, cleanup of removed `.vkb-tabbar`/`.vkb-arrows-col` rules).

**Tech Stack:** React 18 + React Router v7 SSR, TypeScript strict, Tailwind v4 (used elsewhere; vkb uses hand-written CSS), Vitest (no existing vkb tests). Manual verification only — see spec §Verification.

---

## File Structure

| File | Responsibility |
|---|---|
| `app/lib/dos-keymap.ts` | Adds `SC.GRAVE` constant (96) and `SHIFT_LABELS: Record<number, string>` table mapping scancode → shifted glyph. No changes to existing exports. |
| `app/components/VirtualKeyboard.tsx` | Rewritten layout constants (`DESKTOP_ROWS`, `MOBILE_PAGES`, `MOBILE_UTIL_ROW`), new `Page = "abc" \| "sym"`, new render helpers `labelFor()` and Shift-derived `shifted` state. Removes `DESKTOP_ARROW_CLUSTERS`, tab-bar JSX, and old `Page = "abc" \| "123" \| "fn"`. |
| `app/app.css` | Adds `--color-keyboard-shift-amber` and latched bg/fg tokens, plus rules `.vkb-key--latched`, `.vkb-key--sym`, `.vkb-key--shifted-glyph`. Removes `.vkb-tabbar`, `.vkb-tab`, `.vkb-tab--active`, `.vkb-arrows-col`. |

No new files, no test files (per spec §Verification — manual only; no existing vkb tests).

---

## Task 1 — Add `SC.GRAVE` and `SHIFT_LABELS` to `dos-keymap.ts`

**Files:**
- Modify: `app/lib/dos-keymap.ts` — extend `SC`, add `SHIFT_LABELS` export

- [ ] **Step 1.1: Add `GRAVE: 96` to the `SC` const**

In `app/lib/dos-keymap.ts`, locate the `SC` const (currently lines 82–95). Add `GRAVE: 96` on the punctuation line so the row reads:

```ts
MINUS: 45, EQUAL: 61, GRAVE: 96,
```

- [ ] **Step 1.2: Add `SHIFT_LABELS` export after `SC`**

Append after the closing `} as const;` of `SC` (around line 95):

```ts
// Shifted glyph for each scancode that swaps under a held Shift key.
// Letters intentionally omitted — VirtualKeyboard renders letter cells
// as uppercase unconditionally (DOS displays uppercase by default).
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

- [ ] **Step 1.3: Typecheck**

Run: `npm run typecheck`
Expected: no errors. (This file is imported by `VirtualKeyboard.tsx` and `dos-emulator.ts`; both still compile because we only added exports.)

- [ ] **Step 1.4: Commit**

```bash
git add app/lib/dos-keymap.ts
git commit -m "feat(keymap): add SC.GRAVE + SHIFT_LABELS for vkb shift swap"
```

---

## Task 2 — Add CSS tokens and shift/latched/sym classes; do **not** delete tab-bar rules yet

Keeping the old `.vkb-tabbar` rules in place during this task means the existing keyboard still renders correctly while we add the new styling — fewer broken intermediate commits.

**Files:**
- Modify: `app/app.css` — add tokens to `:root`, add three classes near the existing `.vkb-key` block

- [ ] **Step 2.1: Add amber tokens to `:root`**

In `app/app.css`, locate the `:root` block (currently lines 5–18). Append three tokens after the navy colors:

```css
  --color-keyboard-shift-amber: #f0b32a;
  --color-keyboard-latched-bg: #f0b32a;
  --color-keyboard-latched-fg: #050912;
```

- [ ] **Step 2.2: Add new key state classes**

Append immediately after the existing `.vkb-key--mod.vkb-key--pressed,\n.vkb-key--mod:active { color: #050912; }` block (around line 546):

```css
/* Shift-latched indicator (amber). Overrides the blue pressed state when
   both apply — Shift is "live" until the next non-modifier press releases. */
.vkb-key--latched {
  background: var(--color-keyboard-latched-bg);
  color: var(--color-keyboard-latched-fg);
  border-color: var(--color-keyboard-latched-bg);
  box-shadow:
    inset 0 1px 0 rgba(255, 255, 255, 0.22),
    0 0 14px rgba(240, 179, 42, 0.32);
}
/* Sym/ABC toggle cell — accent blue, distinguishes from regular keys. */
.vkb-key--sym {
  background: var(--color-navy-accent);
  color: #050912;
  border-color: var(--color-navy-accent);
  font-weight: 700;
}
/* Non-letter glyph rendered as its shifted variant. Amber for visibility. */
.vkb-key--shifted-glyph {
  color: var(--color-keyboard-shift-amber);
}
```

- [ ] **Step 2.3: Typecheck (CSS is not typechecked, but ensures build still parses)**

Run: `npm run typecheck`
Expected: no errors.

- [ ] **Step 2.4: Smoke-test in dev**

Run: `npm run dev` (leaves a dev server at http://localhost:5173). Open in a browser, confirm existing keyboard still renders. The new classes are not used yet, so nothing visible should change.

Stop the dev server (Ctrl+C) when satisfied.

- [ ] **Step 2.5: Commit**

```bash
git add app/app.css
git commit -m "style(vkb): add amber tokens + latched/sym/shifted-glyph classes"
```

---

## Task 3 — Restructure `DESKTOP_ROWS` (stagger + integrated arrows; drop arrow cluster)

**Files:**
- Modify: `app/components/VirtualKeyboard.tsx` — replace `DESKTOP_ROWS`, delete `DESKTOP_ARROW_CLUSTERS`, simplify desktop render branch

- [ ] **Step 3.1: Replace `DESKTOP_ROWS`**

In `app/components/VirtualKeyboard.tsx`, locate the `DESKTOP_ROWS` const (currently around lines 46–98). Replace the entire constant with:

```ts
// Desktop full layout. Stagger: Tab 1.5 / Caps 1.75 / Shift 2.25 produces
// canonical ANSI offsets (A between Q-W; Z between A-S). Arrows are
// integrated into R5/R6 so the inverted-T ↑/↓ alignment survives any
// viewport width. All rows sum to flex 15.25.
const DESKTOP_ROWS: KeyDef[][] = [
  // Row 1: Esc + F1..F12 (3.25 + 12 = 15.25)
  [
    { code: SC.ESC, label: "Esc", flex: 3.25, modifier: false },
    { code: SC.F1, label: "F1" }, { code: SC.F2, label: "F2" }, { code: SC.F3, label: "F3" },
    { code: SC.F4, label: "F4" }, { code: SC.F5, label: "F5" }, { code: SC.F6, label: "F6" },
    { code: SC.F7, label: "F7" }, { code: SC.F8, label: "F8" }, { code: SC.F9, label: "F9" },
    { code: SC.F10, label: "F10" }, { code: SC.F11, label: "F11" }, { code: SC.F12, label: "F12" },
  ],
  // Row 2: ` 1..0 - = BS  (1 + 10 + 1 + 1 + 2.25 = 15.25)
  [
    { code: SC.GRAVE, label: "`" },
    { code: SC.D1, label: "1" }, { code: SC.D2, label: "2" }, { code: SC.D3, label: "3" },
    { code: SC.D4, label: "4" }, { code: SC.D5, label: "5" }, { code: SC.D6, label: "6" },
    { code: SC.D7, label: "7" }, { code: SC.D8, label: "8" }, { code: SC.D9, label: "9" },
    { code: SC.D0, label: "0" },
    { code: SC.MINUS, label: "-" }, { code: SC.EQUAL, label: "=" },
    { code: SC.BS, label: "BS", flex: 2.25 },
  ],
  // Row 3: Tab Q..P [ ] \  (1.5 + 10 + 1 + 1 + 1.75 = 15.25)
  [
    { code: SC.TAB, label: "Tab", flex: 1.5 },
    { code: SC.Q, label: "Q" }, { code: SC.W, label: "W" }, { code: SC.E, label: "E" },
    { code: SC.R, label: "R" }, { code: SC.T, label: "T" }, { code: SC.Y, label: "Y" },
    { code: SC.U, label: "U" }, { code: SC.I, label: "I" }, { code: SC.O, label: "O" },
    { code: SC.P, label: "P" },
    { code: SC.LBRACKET, label: "[" }, { code: SC.RBRACKET, label: "]" },
    { code: SC.BACKSLASH, label: "\\", flex: 1.75 },
  ],
  // Row 4: Caps A..L ; ' RET  (1.75 + 9 + 1 + 1 + 2.5 = 15.25)
  [
    { code: SC.CAPSLOCK, label: "Caps", flex: 1.75 },
    { code: SC.A, label: "A" }, { code: SC.S, label: "S" }, { code: SC.D, label: "D" },
    { code: SC.F, label: "F" }, { code: SC.G, label: "G" }, { code: SC.H, label: "H" },
    { code: SC.J, label: "J" }, { code: SC.K, label: "K" }, { code: SC.L, label: "L" },
    { code: SC.SEMICOLON, label: ";" }, { code: SC.QUOTE, label: "'" },
    { code: SC.ENTER, label: "RET", flex: 2.5 },
  ],
  // Row 5: Sh Z..M , . / ↑ Sh  (2.25 + 7 + 1 + 1 + 1 + 1 + 2 = 15.25)
  [
    { code: SC.SHIFT, label: "Shift", flex: 2.25, modifier: true },
    { code: SC.Z, label: "Z" }, { code: SC.X, label: "X" }, { code: SC.C, label: "C" },
    { code: SC.V, label: "V" }, { code: SC.B, label: "B" }, { code: SC.N, label: "N" },
    { code: SC.M, label: "M" },
    { code: SC.COMMA, label: "," }, { code: SC.PERIOD, label: "." }, { code: SC.SLASH, label: "/" },
    { code: SC.UP, label: "↑" },
    { code: SC.SHIFT, label: "Shift", flex: 2, modifier: true },
  ],
  // Row 6: Ctl Alt Space Alt ← ↓ → Ctl  (1.5 + 1.5 + 7 + 1.5 + 0.75 + 0.75 + 0.75 + 1.5 = 15.25)
  // ↓ start = 1.5+1.5+7+1.5+0.75 = 12.25 == R5 ↑ start → inverted-T aligned.
  [
    { code: SC.CTRL, label: "Ctrl", flex: 1.5, modifier: true },
    { code: SC.ALT, label: "Alt", flex: 1.5, modifier: true },
    { code: SC.SPACE, label: "Space", flex: 7 },
    { code: SC.ALT, label: "Alt", flex: 1.5, modifier: true },
    { code: SC.LEFT, label: "←", flex: 0.75 },
    { code: SC.DOWN, label: "↓", flex: 0.75 },
    { code: SC.RIGHT, label: "→", flex: 0.75 },
    { code: SC.CTRL, label: "Ctrl", flex: 1.5, modifier: true },
  ],
];
```

- [ ] **Step 3.2: Delete `DESKTOP_ARROW_CLUSTERS`**

In the same file, locate `DESKTOP_ARROW_CLUSTERS` (currently lines 100–112). Delete the entire block including its preceding comment:

```ts
// Fixed-width arrow cluster appended to desktop rows 5 and 6.
const DESKTOP_ARROW_CLUSTERS: Record<number, KeyDef[]> = {
  ...
};
```

- [ ] **Step 3.3: Simplify desktop render branch**

Find the desktop render branch at the bottom of the component (currently around lines 365–382). Replace the entire `return` block:

```tsx
  // Desktop: original 6 rows with CapsLock substitution + BS/RET labels.
  return (
    <div className="vkb" role="group" aria-label="DOS 가상 키보드">
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
```

With:

```tsx
  // Desktop: 6 rows of ANSI-staggered keys. Arrows are inline in rows 5/6.
  return (
    <div className="vkb" role="group" aria-label="DOS 가상 키보드">
      {DESKTOP_ROWS.map((row, ri) => renderRow(row, String(ri)))}
    </div>
  );
```

- [ ] **Step 3.4: Typecheck**

Run: `npm run typecheck`
Expected: no errors. (Mobile branch is unchanged in this task.)

- [ ] **Step 3.5: Manual verify in dev**

Run: `npm run dev`. Open http://localhost:5173 in a desktop browser (≥641 px wide). Expected:
- `A` sits between `Q` and `W` (left edge of A halfway between Q and W) — confirms Tab 1.5 / Caps 1.75 stagger.
- `Z` sits between `A` and `S`.
- `↑` on R5 sits directly above `↓` on R6 (both at the same horizontal position).
- `` ` `` at R2 far left, `\` at R3 far right, `Ctl` at R6 far right.

Stop the dev server.

- [ ] **Step 3.6: Commit**

```bash
git add app/components/VirtualKeyboard.tsx
git commit -m "feat(vkb): desktop ANSI stagger + integrated inverted-T arrows"
```

---

## Task 4 — Replace `MOBILE_PAGES` with `abc` + `sym`; update `MOBILE_UTIL_ROW`

Mobile-only change. Tab bar JSX stays in this task (the `Page` type still includes `"sym"`, so the existing tab bar would render an `SYM` tab if untouched — that's fine for one commit; we strip the tab bar entirely in Task 5).

**Files:**
- Modify: `app/components/VirtualKeyboard.tsx` — replace `Page` type, `MOBILE_PAGES`, `MOBILE_UTIL_ROW`

- [ ] **Step 4.1: Change `Page` type**

Locate (around line 42):

```ts
type Page = "abc" | "123" | "fn";
```

Replace with:

```ts
type Page = "abc" | "sym";
```

- [ ] **Step 4.2: Replace `MOBILE_PAGES`**

Locate `MOBILE_PAGES` (currently lines 116–192). Replace the entire constant with:

```ts
// Mobile portrait layouts. All rows sum to flex 12. Stagger via differential
// left-modifier widths: Tab 1.5 / Caps 2 / ↑Sh 2.5 → Q at 1.5, A at 2.0,
// Z at 2.5 (each row 0.5 right of the previous). Inverted-T arrow:
// ↑ on R5 ends at flex offset 11; ↓ on util row R6 sits at same offset.
const MOBILE_PAGES: Record<Page, KeyDef[][]> = {
  abc: [
    // R1: F1..F12 (12)
    [
      { code: SC.F1, label: "F1" }, { code: SC.F2, label: "F2" }, { code: SC.F3, label: "F3" },
      { code: SC.F4, label: "F4" }, { code: SC.F5, label: "F5" }, { code: SC.F6, label: "F6" },
      { code: SC.F7, label: "F7" }, { code: SC.F8, label: "F8" }, { code: SC.F9, label: "F9" },
      { code: SC.F10, label: "F10" }, { code: SC.F11, label: "F11" }, { code: SC.F12, label: "F12" },
    ],
    // R2: ` 1..0 BS  (1 + 10 + 1 = 12)
    [
      { code: SC.GRAVE, label: "`" },
      { code: SC.D1, label: "1" }, { code: SC.D2, label: "2" }, { code: SC.D3, label: "3" },
      { code: SC.D4, label: "4" }, { code: SC.D5, label: "5" }, { code: SC.D6, label: "6" },
      { code: SC.D7, label: "7" }, { code: SC.D8, label: "8" }, { code: SC.D9, label: "9" },
      { code: SC.D0, label: "0" },
      { code: SC.BS, label: "BS" },
    ],
    // R3: Tab Q..P \  (1.5 + 10 + 0.5 = 12)
    [
      { code: SC.TAB, label: "Tab", flex: 1.5 },
      { code: SC.Q, label: "Q" }, { code: SC.W, label: "W" }, { code: SC.E, label: "E" },
      { code: SC.R, label: "R" }, { code: SC.T, label: "T" }, { code: SC.Y, label: "Y" },
      { code: SC.U, label: "U" }, { code: SC.I, label: "I" }, { code: SC.O, label: "O" },
      { code: SC.P, label: "P" },
      { code: SC.BACKSLASH, label: "\\", flex: 0.5 },
    ],
    // R4: Caps A..L ; '  (2 + 9 + 0.5 + 0.5 = 12)
    [
      { code: SC.CAPSLOCK, label: "Caps", flex: 2 },
      { code: SC.A, label: "A" }, { code: SC.S, label: "S" }, { code: SC.D, label: "D" },
      { code: SC.F, label: "F" }, { code: SC.G, label: "G" }, { code: SC.H, label: "H" },
      { code: SC.J, label: "J" }, { code: SC.K, label: "K" }, { code: SC.L, label: "L" },
      { code: SC.SEMICOLON, label: ";", flex: 0.5 },
      { code: SC.QUOTE, label: "'", flex: 0.5 },
    ],
    // R5: ↑Sh Z..M , . ↑ RET  (2.5 + 7 + 0.5 + 0.5 + 0.5 + 1 = 12)
    // ↑ ends at flex 11; util R6 ↓ aligns to that.
    [
      { code: SC.SHIFT, label: "↑Sh", flex: 2.5, modifier: true },
      { code: SC.Z, label: "Z" }, { code: SC.X, label: "X" }, { code: SC.C, label: "C" },
      { code: SC.V, label: "V" }, { code: SC.B, label: "B" }, { code: SC.N, label: "N" },
      { code: SC.M, label: "M" },
      { code: SC.COMMA, label: ",", flex: 0.5 },
      { code: SC.PERIOD, label: ".", flex: 0.5 },
      { code: SC.UP, label: "↑", flex: 0.5 },
      { code: SC.ENTER, label: "RET" },
    ],
  ],
  sym: [
    // R1 (mode-invariant copy of abc R1)
    [
      { code: SC.F1, label: "F1" }, { code: SC.F2, label: "F2" }, { code: SC.F3, label: "F3" },
      { code: SC.F4, label: "F4" }, { code: SC.F5, label: "F5" }, { code: SC.F6, label: "F6" },
      { code: SC.F7, label: "F7" }, { code: SC.F8, label: "F8" }, { code: SC.F9, label: "F9" },
      { code: SC.F10, label: "F10" }, { code: SC.F11, label: "F11" }, { code: SC.F12, label: "F12" },
    ],
    // R2: ~ ! @ # $ % ^ & * ( ) BS (12).
    // Each sym character is emitted as SHIFT-down + base-scancode + SHIFT-up
    // by the handleDown handler — we keep the natural scancode in `code`
    // and let `symShift: true` on the KeyDef tell the handler to wrap it.
    [
      { code: SC.GRAVE, label: "~", symShift: true },
      { code: SC.D1, label: "!", symShift: true },
      { code: SC.D2, label: "@", symShift: true },
      { code: SC.D3, label: "#", symShift: true },
      { code: SC.D4, label: "$", symShift: true },
      { code: SC.D5, label: "%", symShift: true },
      { code: SC.D6, label: "^", symShift: true },
      { code: SC.D7, label: "&", symShift: true },
      { code: SC.D8, label: "*", symShift: true },
      { code: SC.D9, label: "(", symShift: true },
      { code: SC.D0, label: ")", symShift: true },
      { code: SC.BS, label: "BS" },
    ],
    // R3: Tab { } [ ] - = + _ < > spacer  (1.5 + 10 + 0.5 = 12)
    [
      { code: SC.TAB, label: "Tab", flex: 1.5 },
      { code: SC.LBRACKET, label: "{", symShift: true },
      { code: SC.RBRACKET, label: "}", symShift: true },
      { code: SC.LBRACKET, label: "[" },
      { code: SC.RBRACKET, label: "]" },
      { code: SC.MINUS, label: "-" },
      { code: SC.EQUAL, label: "=" },
      { code: SC.EQUAL, label: "+", symShift: true },
      { code: SC.MINUS, label: "_", symShift: true },
      { code: SC.COMMA, label: "<", symShift: true },
      { code: SC.PERIOD, label: ">", symShift: true },
      { spacer: true, flex: 0.5 },
    ],
    // R4: spacer(2) : " ? / \ , . ; ' |  (2 + 10 = 12)
    [
      { spacer: true, flex: 2 },
      { code: SC.SEMICOLON, label: ":", symShift: true },
      { code: SC.QUOTE, label: "\"", symShift: true },
      { code: SC.SLASH, label: "?", symShift: true },
      { code: SC.SLASH, label: "/" },
      { code: SC.BACKSLASH, label: "\\" },
      { code: SC.COMMA, label: "," },
      { code: SC.PERIOD, label: "." },
      { code: SC.SEMICOLON, label: ";" },
      { code: SC.QUOTE, label: "'" },
      { code: SC.BACKSLASH, label: "|", symShift: true },
    ],
    // R5: ↑Sh spacer(8) ↑ RET  (2.5 + 8 + 0.5 + 1 = 12)
    // ↑ at flex 11 (same as abc R5) — inverted-T continuity across modes.
    [
      { code: SC.SHIFT, label: "↑Sh", flex: 2.5, modifier: true },
      { spacer: true, flex: 8 },
      { code: SC.UP, label: "↑", flex: 0.5 },
      { code: SC.ENTER, label: "RET" },
    ],
  ],
};
```

**Note:** `symShift: true` is a new optional `KeyDef` field — add it in Step 4.4.

- [ ] **Step 4.3: Replace `MOBILE_UTIL_ROW`**

Locate `MOBILE_UTIL_ROW` (currently around lines 195–204). Replace with:

```ts
// Always-visible bottom row on every mobile page.
// Esc Ctl Alt Sym Space ← ↓ →  (1+1+1+1+5.75+0.75+0.75+0.75 = 12)
// ↓ ends at flex 11 → aligns with ↑ on R5.
// The 4th cell's label/code/role switches between "Sym" (on abc page)
// and "ABC" (on sym page) at render time — see Task 5.
const MOBILE_UTIL_ROW: KeyDef[] = [
  { code: SC.ESC, label: "Esc" },
  { code: SC.CTRL, label: "Ctrl", modifier: true },
  { code: SC.ALT, label: "Alt", modifier: true },
  { code: -1, label: "Sym", role: "symToggle" },   // placeholder; render swaps label
  { code: SC.SPACE, label: "Space", flex: 5.75 },
  { code: SC.LEFT, label: "←", flex: 0.75 },
  { code: SC.DOWN, label: "↓", flex: 0.75 },
  { code: SC.RIGHT, label: "→", flex: 0.75 },
];
```

- [ ] **Step 4.4: Extend `KeyDef` type**

Locate the `KeyDef` type (currently lines 32–40). Replace it with:

```ts
type KeyDef =
  | { spacer: true; flex?: number }
  | {
      code: number;
      label: string;
      flex?: number;
      modifier?: boolean;
      /** When true, this key wraps the keypress in SHIFT down/up to emit
       *  the shifted scancode (used by mobile Sym page glyphs like `!`). */
      symShift?: boolean;
      /** Special role used by the renderer to swap label/handler:
       *  - "symToggle" — the Sym/ABC mobile page toggle button. */
      role?: "symToggle";
      spacer?: false;
    };
```

- [ ] **Step 4.5: Typecheck**

Run: `npm run typecheck`
Expected: TypeScript will complain about the existing tab-bar JSX referencing `"123"` / `"fn"` page values — Task 5 removes the tab bar. For now, also expect type errors about the `code: -1` placeholder in `MOBILE_UTIL_ROW` because the existing `renderCell` will try to register it. **This is expected — do not try to fix here; the next task wires the toggle properly.** Proceed.

If you want a clean build at this checkpoint, you may temporarily comment out the tab-bar render block before commit. Otherwise skip the test build and go straight to commit; the next task makes everything green.

- [ ] **Step 4.6: Commit**

```bash
git add app/components/VirtualKeyboard.tsx
git commit -m "feat(vkb): mobile abc+sym pages with ANSI stagger, drop 123/fn"
```

---

## Task 5 — Remove tab-bar JSX + wire Sym/ABC toggle + remove old tab bar CSS

Closes the build break introduced by Task 4. End state: mobile shows abc/sym pages toggled by the util-row `Sym` (or `ABC`) cell; no tab bar.

**Files:**
- Modify: `app/components/VirtualKeyboard.tsx` — remove tab-bar JSX, update render path, wire `Sym` handler
- Modify: `app/app.css` — remove `.vkb-tabbar`, `.vkb-tab`, `.vkb-tab--active`, `.vkb-arrows-col` rules

- [ ] **Step 5.1: Remove tab-bar JSX from mobile branch**

Find the mobile render branch (around lines 334–361 of the current file). Currently:

```tsx
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
        </div>

        <div className="vkb-content">
          {MOBILE_PAGES[page].map((row, ri) => renderRow(row, `${page}-${ri}`))}
        </div>

        {renderRow(MOBILE_UTIL_ROW, "util")}
      </div>
    );
  }
```

Replace with:

```tsx
  if (isMobile) {
    return (
      <div className="vkb" role="group" aria-label="DOS 가상 키보드">
        <div className="vkb-content">
          {MOBILE_PAGES[page].map((row, ri) => renderRow(row, `${page}-${ri}`))}
        </div>
        {renderRow(MOBILE_UTIL_ROW, "util")}
      </div>
    );
  }
```

- [ ] **Step 5.2: Teach `renderCell` to handle the Sym toggle role**

Find `renderCell` (around lines 272–324). Locate the `const isMod = !!k.modifier;` line — insert toggle handling above it. The full new body of `renderCell`:

```tsx
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

    // Sym/ABC toggle — swaps mobile page state, does not emit a DOS key.
    if (k.role === "symToggle") {
      const isSym = page === "sym";
      const label = isSym ? "ABC" : "Sym";
      return (
        <button
          key={id}
          type="button"
          tabIndex={-1}
          className="vkb-key vkb-key--sym"
          style={{ flexGrow: k.flex ?? 1 }}
          onPointerDown={(e) => {
            e.preventDefault();
            setPage(isSym ? "abc" : "sym");
          }}
          onContextMenu={(e) => e.preventDefault()}
        >
          {label}
        </button>
      );
    }

    const isMod = !!k.modifier;
    const isPressed = isMod
      ? stickyModsRef.current.has(k.code)
      : pressedRef.current.has(id);
    const hangul = HANGUL_LABELS[k.code];
    const shiftLatched = stickyModsRef.current.has(SC.SHIFT);
    const shiftedLabel = shiftLatched ? SHIFT_LABELS[k.code] : undefined;
    const displayLabel = shiftedLabel ?? k.label;
    const isShiftKey = k.code === SC.SHIFT;
    const showShiftedGlyph = !!shiftedLabel && !isMod;

    return (
      <button
        key={id}
        type="button"
        tabIndex={-1}
        aria-pressed={isPressed || (isShiftKey && shiftLatched)}
        className={
          "vkb-key" +
          (isPressed ? " vkb-key--pressed" : "") +
          (isMod ? " vkb-key--mod" : "") +
          (isShiftKey && shiftLatched ? " vkb-key--latched" : "") +
          (showShiftedGlyph ? " vkb-key--shifted-glyph" : "")
        }
        style={{ flexGrow: k.flex ?? 1 }}
        onPointerDown={(e) => {
          e.preventDefault();
          handleDown(id, k.code, isMod, !!k.symShift);
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
        {hangul ? (
          <>
            <span className="vkb-key__en">{displayLabel}</span>
            <span className="vkb-key__ko">{hangul}</span>
          </>
        ) : (
          displayLabel
        )}
      </button>
    );
  }
```

**Add the `SHIFT_LABELS` import** at the top of the file. Find:

```ts
import { HANGUL_LABELS, SC } from "../lib/dos-keymap";
```

Replace with:

```ts
import { HANGUL_LABELS, SC, SHIFT_LABELS } from "../lib/dos-keymap";
```

- [ ] **Step 5.3: Teach `handleDown` to emit shift-wrapped events for `symShift` keys**

Find `handleDown` (around lines 232–253). Replace with:

```tsx
  const handleDown = useCallback(
    (id: string, code: number, isModifier: boolean, symShift: boolean) => {
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
      // Sym page glyphs (`!` `{` etc.) need SHIFT held around the keypress
      // so DOS sees the shifted scancode.
      if (symShift) {
        onKeyDown(SC.SHIFT);
      }
      onKeyDown(code);
      setRender();
    },
    [onKeyDown, onKeyUp]
  );
```

And update `handleUp` to release the synthesized Shift. Find `handleUp`:

```tsx
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
```

Replace with (adds `symShift` parameter; release any synthetic shift first):

```tsx
  const handleUp = useCallback(
    (id: string, code: number, isModifier: boolean, symShift: boolean = false) => {
      if (isModifier) return;
      const pressed = pressedRef.current;
      if (!pressed.has(id)) return;
      pressed.delete(id);
      onKeyUp(code);
      if (symShift) {
        // Match the synthetic SHIFT we emitted in handleDown.
        onKeyUp(SC.SHIFT);
      }
      const mods = stickyModsRef.current;
      if (mods.size > 0) {
        for (const m of mods) onKeyUp(m);
        mods.clear();
      }
      setRender();
    },
    [onKeyUp]
  );
```

Then update the `handleUp` call sites in `renderCell` to pass `!!k.symShift`:

Find these lines inside `renderCell`'s button:

```tsx
        onPointerUp={(e) => {
          e.preventDefault();
          handleUp(id, k.code, isMod);
        }}
        onPointerCancel={() => handleUp(id, k.code, isMod)}
        onPointerLeave={(e) => {
          if (e.buttons !== 0) handleUp(id, k.code, isMod);
        }}
```

Replace with:

```tsx
        onPointerUp={(e) => {
          e.preventDefault();
          handleUp(id, k.code, isMod, !!k.symShift);
        }}
        onPointerCancel={() => handleUp(id, k.code, isMod, !!k.symShift)}
        onPointerLeave={(e) => {
          if (e.buttons !== 0) handleUp(id, k.code, isMod, !!k.symShift);
        }}
```

- [ ] **Step 5.4: Remove dead CSS rules**

In `app/app.css`, delete these rule blocks (currently around lines 425–458 and 472–478):

```css
/* Mobile-only tab bar (ABC / 123 / FN, evenly distributed). ... */
.vkb-tabbar { ... }
.vkb-tab { ... }
.vkb-tab--active { ... }

/* Fixed-width arrow cluster ... */
.vkb-arrows-col { ... }
```

Leave the surrounding `.vkb-content`, `.vkb-row`, `.vkb-spacer`, `.vkb-key` rules in place.

- [ ] **Step 5.5: Typecheck**

Run: `npm run typecheck`
Expected: no errors. (The `"123"` / `"fn"` page references are gone; the `code: -1` placeholder is handled by `renderCell`'s `role === "symToggle"` branch before it touches `code`.)

- [ ] **Step 5.6: Manual verify in dev — mobile**

Run: `npm run dev`. Open http://localhost:5173 in a browser with viewport ≤ 640 px (DevTools mobile emulation or actual phone). Expected:

- No `ABC` / `123` / `FN` tab bar at the top.
- 6 rows visible: F-row, digits row (with `` ` `` left, `BS` right), QWERTY (Tab left, `\` right), ASDF (Caps left, `;` `'` right), ZXCV (↑Sh left, `,` `.` `↑` `RET` right), util (Esc/Ctl/Alt/Sym/Space/arrows).
- Tap `Sym` — switches to symbol layout: row 2 shows `~ ! @ # …`, row 3 shows `Tab { } [ ] - = + …`, the toggle cell now reads `ABC`.
- Tap `!` — DOS canvas receives `!` (you may need to open a DOS prompt; verify with `echo !`). Keyboard stays on Sym.
- Tap `ABC` — returns to letter layout.

- [ ] **Step 5.7: Manual verify in dev — desktop**

In the same browser, resize to ≥ 641 px. Expected:
- All Task 3 desktop checks still hold (stagger, inverted-T, full QWERTY).
- No tab bar (desktop didn't have one anyway).

Stop the dev server.

- [ ] **Step 5.8: Commit**

```bash
git add app/components/VirtualKeyboard.tsx app/app.css
git commit -m "feat(vkb): mobile Sym toggle replaces ABC/123/FN tab bar"
```

---

## Task 6 — Verify Shift-aware label swap end-to-end + update header comment

Shift-aware rendering is already wired in Task 5 via `renderCell`. This task is the final verification pass and a doc update.

**Files:**
- Modify: `app/components/VirtualKeyboard.tsx` — update the file-header comment block

- [ ] **Step 6.1: Replace the header comment**

Replace the entire comment block at the top of `app/components/VirtualKeyboard.tsx` (currently lines 1–22) with:

```ts
// app/components/VirtualKeyboard.tsx
//
// Two layouts behind one component:
//
//  - Mobile (viewport ≤640px portrait): 6 rows of ANSI-staggered keys.
//    Row 1 F-keys, R2-R5 standard QWERTY block (with `\` `;` `'` `,` `.`
//    in their PC positions and `↑` on R5 right end), R6 util row with the
//    Sym/ABC toggle immediately left of Space. The 3-page tab bar
//    (ABC/123/FN) is gone; pressing `Sym` swaps R2-R5 to a dedicated
//    special-character layout (R1 F-keys and R6 util are mode-invariant).
//
//  - Desktop (viewport >640px): the original 6-row full keyboard but with
//    canonical ANSI stagger (Tab 1.5 / Caps 1.75 / Shift 2.25) and arrows
//    integrated into rows 5/6 — no more fixed-156px cluster column.
//
// Letter keys always show two labels: English in the upper-left corner,
// 두벌식 jamo (from HANGUL_LABELS) in the lower-right corner. Scancodes
// are unchanged — DOS still receives A/B/C etc., so any DOS-side IME
// (e.g. 한글 도깨비) controls the actual input mode.
//
// Sticky-once modifier semantics (Shift/Ctrl/Alt latch, release after the
// next non-modifier key) preserved from the old keyboard. When Shift is
// latched, non-letter labels swap to their shifted glyph (1→!, [→{ etc.)
// via SHIFT_LABELS, and the Shift key cells gain an amber latched style.
// CapsLock is a *normal momentary key*, not a sticky modifier — DOS
// tracks its toggled state internally.
//
// Mobile Sym-page keys use `symShift: true` on their KeyDef. The press
// handler wraps the emitted scancode in a synthetic SHIFT down/up so DOS
// sees the shifted scancode (e.g. tapping `!` emits SHIFT + D1 + SHIFT_up).
```

- [ ] **Step 6.2: Typecheck + dev verify**

Run: `npm run typecheck` — expect no errors.

Run: `npm run dev`. Verify every item in the spec §Verification list:

1. **Desktop stagger** — A between Q-W, Z between A-S.
2. **Mobile stagger** — same on portrait viewport.
3. **Shift swap (desktop)** — tap `Shift`, confirm `1`→`!`, `` ` ``→`~`, `[`→`{`, `;`→`:`, `,`→`<`, etc. swapped glyphs are amber. Tap `1` — DOS receives `!`; Shift releases; labels revert.
4. **Shift swap (mobile abc)** — same as 3.
5. **Sym toggle (mobile)** — `Sym` → symbol layout → tap `*` → DOS receives `*`, keyboard stays on Sym → tap `ABC` → back to letters.
6. **Inverted-T arrows** — `↑` on R5 directly above `↓` on R6 on both layouts AND on mobile Sym page.
7. **Dual labels intact** — letter keys show EN upper-left + 두벌식 lower-right.
8. **No tab bar on mobile** — confirmed.
9. **Sticky-once modifier** — Shift + `a` → DOS receives `A`-equivalent shifted, Shift visually clears.
10. **Pointer dedupe** — rapid taps still one event per press.

Stop the dev server.

- [ ] **Step 6.3: Production build smoke test**

Run: `npm run build`
Expected: build succeeds with no type errors and no warnings about removed imports/exports.

- [ ] **Step 6.4: Commit**

```bash
git add app/components/VirtualKeyboard.tsx
git commit -m "docs(vkb): refresh header comment for stagger + shift + sym redesign"
```

---

## Task 7 — Deploy

Standard dosbox deploy path (see `~/.claude/projects/-Users-gcjjyy-dosbox/memory/reference_dosbox_deploy.md`).

- [ ] **Step 7.1: Push**

```bash
git push origin main
```

- [ ] **Step 7.2: Deploy on pcnhost**

User runs (password not persisted):

```bash
sshpass -p '<password>' ssh pcnhost 'cd ~/dosbox && git fetch origin && git reset --hard origin/main && npm run build && pm2 restart dosbox && pm2 status dosbox'
```

Expected: `pm2 status dosbox` shows `online` with a fresh uptime and a bumped `version` column (each commit triggered the pre-commit hook patch bump).

- [ ] **Step 7.3: Smoke-test production**

Open https://dosbox.gcjjyy.dev/ on:
- Desktop browser — verify stagger + shift swap + inverted-T arrows.
- iPhone Safari portrait — verify mobile stagger, Sym toggle, no tab bar.

If anything regresses, rollback with `git revert HEAD~N..HEAD` locally and redeploy.
