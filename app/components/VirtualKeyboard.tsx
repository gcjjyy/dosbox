// app/components/VirtualKeyboard.tsx
//
// Two layouts behind one component:
//
//  - Mobile (viewport ≤640px portrait): 7 rows on a 10-column grid (was 12).
//    Dropping to 10 columns makes every letter key a fat ~36px target. The
//    grid is repeat(60) — 60 = lcm(10 letters, 12 F-keys) — so a 10-key row
//    (flex 1.5 → span 6) and the 12-key F-row (flex 1.25 → span 5) both land
//    on integer column boundaries. A "normal" mobile key is flex 1.5, not 1.
//    Row anatomy (top → bottom):
//      R0  Esc Tab Caps Shift ⏎ F11 F12 — invariant (MOBILE_CONTROL_ROW)
//      R1  F1..F10                    — invariant (MOBILE_TOP_ROW)
//      R2..R5  letter/symbol core     — swaps abc⟷sym (MOBILE_PAGES)
//      R6  Ctrl Alt Sym Space [↑↓←→]  — invariant (MOBILE_UTIL_ROW)
//    Every row sums to flex 15 (span 60) so all keys share one column grid.
//    The main (ABC) tab carries no punctuation — all symbols live on the Sym
//    page, reached via the (now fat) Sym toggle on R6. Shift and ⏎ sit on R0
//    with Esc/Tab/Caps + F11/F12 (so the F-row is a clean 10); Backspace (⌫)
//    keeps its traditional spot right of M on R5, so R2-R5 stay near-pure QWERTY.
//    R3/R4/R5 keep the ANSI half-key stagger — Q@col0, A@col3 (between Q and
//    W), Z@col6 (between A and S) — via span-3/span-6 leading spacers.
//    R6 arrows are an "arrowsMobile" cluster: ←/→ full-height on the flanks,
//    ↑/↓ stacked half-height in the center (desktop-style center column).
//    Inverted-T arrows: ↑ at columns 48..54 on R6 stacks directly above ↓ at
//    the same 48..54 on R7 (adjacent, both invariant), with ←/→ flanking ↓.
//
//  - Desktop (viewport >640px): a 6-row full keyboard. Stagger Tab 1.5 /
//    Caps 2.0 / Shift 2.25 keeps Z between A and S, and the paired modifiers
//    match left↔right: Tab == \ (1.5), Caps == RET (2.0). R1 is Esc (1.5) +
//    F1-F12 + a "hide keyboard" key (▾, calls onHide). Right Shift is the
//    widest modifier (2.75). All four arrows live in R6 as a Mac Magic
//    Keyboard cluster: ↑/↓ stacked half-height in the center, ← → on the
//    bottom half (role "arrows"). Rows sum to flex 15.0 → 60 columns.
//
// Keys show up to three labels at once, statically — the layout never swaps
// when Shift is held (that was disorienting). Corners:
//   · primary (top-left)    — ASCII identity (letter / digit / symbol)
//   · shift   (top-right)   — Shift variant: 두벌식 쌍자음/ㅒ/ㅖ for letters
//                             (HANGUL_SHIFT_LABELS) or shifted symbol 1→! /
//                             [→{ (SHIFT_LABELS); dimmed + smaller
//   · hangul  (bottom-right)— 두벌식 base jamo (HANGUL_LABELS), letters only
// So ㅂ/ㅃ stack on the right of the Q key with English Q on the left; a
// number key shows e.g. 1 with a faint ! above-right. Scancodes are
// unchanged — DOS still receives A/B/C etc., so any DOS-side IME (e.g. 한글
// 도깨비) controls the actual input mode.
//
// Sticky-once modifier semantics (Shift/Ctrl/Alt latch, release after the
// next non-modifier key) preserved from the old keyboard. The Shift key
// cells gain an amber latched style while held. CapsLock is a *normal
// momentary key*, not a sticky modifier — DOS tracks its toggled state.
//
// Mobile Sym-page keys carry `symShift: true` on their KeyDef. The press
// handler wraps the emitted scancode in a synthetic SHIFT down/up so DOS
// sees the shifted scancode (e.g. tapping `!` emits SHIFT + D1 + SHIFT_up).

import type React from "react";
import { useCallback, useEffect, useReducer, useRef, useState } from "react";
import {
  ArrowBigUp,
  ArrowBigUpDash,
  ArrowRightToLine,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  ChevronUp,
  CornerDownLeft,
  Delete,
  type LucideIcon,
} from "lucide-react";
import { HANGUL_LABELS, HANGUL_SHIFT_LABELS, SC, SHIFT_LABELS } from "../lib/dos-keymap";

// Glyph keys that read clearer as icons than text. Backspace/Shift/Caps/Tab/
// Return get their conventional keycap symbols (lucide); arrows render as
// carets. Esc/F-keys/Space/Ctrl/Alt stay as text — no clean lucide glyph and
// the words read fine. Scancodes here are unique to one key each, so a map by
// code is unambiguous.
const KEY_ICON: Readonly<Record<number, LucideIcon>> = {
  [SC.BS]: Delete,
  [SC.SHIFT]: ArrowBigUp,
  [SC.CAPSLOCK]: ArrowBigUpDash,
  [SC.TAB]: ArrowRightToLine,
  [SC.ENTER]: CornerDownLeft,
};
const ARROW_ICON: Readonly<Record<string, LucideIcon>> = {
  up: ChevronUp,
  down: ChevronDown,
  left: ChevronLeft,
  right: ChevronRight,
};
// Keycap icons sit a touch larger than the 13px legends; thin stroke matches
// the toolbar family. currentColor inherits the key's (and pressed/latched) fg.
const KEY_ICON_PROPS = { size: 16, strokeWidth: 1.75, "aria-hidden": true } as const;

export interface VirtualKeyboardProps {
  onKeyDown: (scancode: number) => void;
  onKeyUp: (scancode: number) => void;
  /** Desktop only: invoked by the "hide keyboard" key in the Esc/F-row.
   *  When omitted, that key is not rendered. */
  onHide?: () => void;
  /** 0..1 — scales the keyboard panel/key background alpha via the
   *  --vkb-bg-opacity CSS var. Borders and legends stay fully opaque.
   *  Default 1 (no change). */
  bgOpacity?: number;
}

type KeyDef =
  | { spacer: true; flex?: number }
  | {
      code: number;
      label: string;
      flex?: number;
      modifier?: boolean;
      /** Visual only: render with the modifier-key style (muted, uppercase,
       *  small) WITHOUT the sticky-modifier behavior. Used by the R0 control
       *  keys (Esc/Tab/Caps/Return) so they match Shift's look but stay
       *  momentary. */
      modLook?: boolean;
      /** When true, the press handler wraps the emitted scancode in a
       *  synthetic SHIFT down/up so DOS sees the shifted scancode. Used
       *  by mobile Sym-page glyphs like `!` `{` etc. */
      symShift?: boolean;
      /** Special render role:
       *  - "symToggle" — the Sym/ABC mobile toggle.
       *  - "hide" — desktop "hide keyboard" key (Esc/F-row). Calls onHide.
       *  - "arrowUp" — desktop ↑ on the Shift line (R5), centered over ↓.
       *  - "arrows" — desktop ←↓→ row (R6), full row height.
       *  - "arrowsMobile" — mobile cluster: ← and → full-height on the flanks,
       *    ↑/↓ stacked half-height in the center column.
       *  Arrow roles render their own grid of arrow keys; `code` is unused.
       *  Renderer swaps label + handler. */
      role?: "symToggle" | "hide" | "arrowUp" | "arrows" | "arrowsMobile";
      spacer?: false;
    };

type Page = "abc" | "sym";

// Desktop full layout. Stagger: Tab 1.5 / Caps 2.0 / Shift 2.25 keeps Z
// between A and S while the paired modifiers match left↔right: Tab == \ (1.5)
// and Caps == RET (2.0). All rows sum to flex 15.0 → 60 columns (the grid in
// app.css uses repeat(60); mobile overrides to 48). 0.25-step flex values
// keep every `flex × 4` span an integer so the columns line up exactly.
const DESKTOP_ROWS: KeyDef[][] = [
  // Row 1: Esc + F1..F12 + Hide (1.5 + 12 + 1.5 = 15.0)
  // Esc shrunk from 3.25 → 1.5 (was dominating the row); the reclaimed
  // width plus a right-edge "hide keyboard" key (▾) sit past F12.
  [
    { code: SC.ESC, label: "Esc", flex: 1.5 },
    { code: SC.F1, label: "F1" }, { code: SC.F2, label: "F2" }, { code: SC.F3, label: "F3" },
    { code: SC.F4, label: "F4" }, { code: SC.F5, label: "F5" }, { code: SC.F6, label: "F6" },
    { code: SC.F7, label: "F7" }, { code: SC.F8, label: "F8" }, { code: SC.F9, label: "F9" },
    { code: SC.F10, label: "F10" }, { code: SC.F11, label: "F11" }, { code: SC.F12, label: "F12" },
    { code: -1, label: "▾", role: "hide", flex: 1.5 },
  ],
  // Row 2: ` 1..0 - = BS  (1 + 10 + 1 + 1 + 2 = 15.0)
  [
    { code: SC.GRAVE, label: "`" },
    { code: SC.D1, label: "1" }, { code: SC.D2, label: "2" }, { code: SC.D3, label: "3" },
    { code: SC.D4, label: "4" }, { code: SC.D5, label: "5" }, { code: SC.D6, label: "6" },
    { code: SC.D7, label: "7" }, { code: SC.D8, label: "8" }, { code: SC.D9, label: "9" },
    { code: SC.D0, label: "0" },
    { code: SC.MINUS, label: "-" }, { code: SC.EQUAL, label: "=" },
    { code: SC.BS, label: "⌫", flex: 2 },
  ],
  // Row 3: Tab Q..P [ ] \  (1.5 + 10 + 1 + 1 + 1.5 = 15.0). Tab == \.
  [
    { code: SC.TAB, label: "Tab", flex: 1.5 },
    { code: SC.Q, label: "Q" }, { code: SC.W, label: "W" }, { code: SC.E, label: "E" },
    { code: SC.R, label: "R" }, { code: SC.T, label: "T" }, { code: SC.Y, label: "Y" },
    { code: SC.U, label: "U" }, { code: SC.I, label: "I" }, { code: SC.O, label: "O" },
    { code: SC.P, label: "P" },
    { code: SC.LBRACKET, label: "[" }, { code: SC.RBRACKET, label: "]" },
    { code: SC.BACKSLASH, label: "\\", flex: 1.5 },
  ],
  // Row 4: Caps A..L ; ' RET  (2 + 9 + 1 + 1 + 2 = 15.0). Caps == RET.
  [
    { code: SC.CAPSLOCK, label: "Caps", flex: 2 },
    { code: SC.A, label: "A" }, { code: SC.S, label: "S" }, { code: SC.D, label: "D" },
    { code: SC.F, label: "F" }, { code: SC.G, label: "G" }, { code: SC.H, label: "H" },
    { code: SC.J, label: "J" }, { code: SC.K, label: "K" }, { code: SC.L, label: "L" },
    { code: SC.SEMICOLON, label: ";" }, { code: SC.QUOTE, label: "'" },
    { code: SC.ENTER, label: "RETURN", flex: 2 },
  ],
  // Row 5: Sh Z..M , . / ↑  (2.25 + 7 + 1 + 1 + 1 + 2.75 = 15.0)
  // Left Shift 2.25 keeps Z between A and S. The old right Shift was dropped
  // (redundant on a virtual keyboard) and its 2.75 slot now holds the ↑ key —
  // the top of an inverted-T whose ←↓→ sit directly below on R6.
  [
    { code: SC.SHIFT, label: "Shift", flex: 2.25, modifier: true },
    { code: SC.Z, label: "Z" }, { code: SC.X, label: "X" }, { code: SC.C, label: "C" },
    { code: SC.V, label: "V" }, { code: SC.B, label: "B" }, { code: SC.N, label: "N" },
    { code: SC.M, label: "M" },
    { code: SC.COMMA, label: "," }, { code: SC.PERIOD, label: "." }, { code: SC.SLASH, label: "/" },
    { code: -1, label: "", role: "arrowUp", flex: 2.75 },
  ],
  // Row 6: Ctl Alt Space Alt [←↓→]  (1.5 + 1.5 + 7.5 + 1.5 + 3.0 = 15.0)
  // ←↓→ fill the cell at full row height (role "arrows"); ↑ lives on R5 above ↓
  // so the four keys form a full-size inverted-T. Position/width unchanged.
  [
    { code: SC.CTRL, label: "Ctrl", flex: 1.5, modifier: true },
    { code: SC.ALT, label: "Alt", flex: 1.5, modifier: true },
    { code: SC.SPACE, label: "Space", flex: 7.5 },
    { code: SC.ALT, label: "Alt", flex: 1.5, modifier: true },
    { code: -1, label: "", role: "arrows", flex: 3.0 },
  ],
];

// Mobile portrait layout. 10-column grid: rows sum to flex 15 → span 60 (the
// repeat(60) CSS grid). A standard key is flex 1.5 (span 6, ~36px); F-keys are
// flex 1.25 (span 5) so 12 of them still tile the row exactly. No sub-unit
// keys — that was the "too narrow to hit" complaint, now even roomier at 10
// columns. The 60-column base is lcm(10, 12), the only width on which both a
// 10-key row and the 12-key F-row align to integer boundaries.
//
// Row stack (top → bottom): R0 control · R1 F-keys · R2-R5 letter/symbol core
// (swaps abc⟷sym) · R6 modifier/space/arrows. Only R2-R5 swap; everything
// else is invariant so muscle memory survives a page toggle.

// R0: the keys that don't belong on a clean QWERTY block — Esc/Tab/Caps plus
// Shift and RETURN lifted off the letter rows, then F11/F12 bumped up so the
// F-row can be a clean 10. Layout (L→R): Esc/Tab/Caps · F11/F12 (rarely used,
// tucked in the middle) · Shift/RETURN pushed to the right edge, where the
// thumb expects the modifier + Enter. Esc/Tab/Caps/Shift at flex 2.25 (span 9),
// RETURN flex 3 (span 12), F11/F12 at flex 1.5 (span 6) = 15. Punctuation is
// gone from the main tabs (Sym page only). Backspace (⌫) stays on the letter
// row (R5, right of M). Shift is a sticky modifier; Caps is momentary.
const MOBILE_CONTROL_ROW: KeyDef[] = [
  { code: SC.ESC, label: "Esc", flex: 2.25, modLook: true },
  { code: SC.TAB, label: "Tab", flex: 2.25, modLook: true },
  { code: SC.CAPSLOCK, label: "Caps", flex: 2.25, modLook: true },
  { code: SC.F11, label: "F11", flex: 1.5 },
  { code: SC.F12, label: "F12", flex: 1.5 },
  { code: SC.SHIFT, label: "Shift", flex: 2.25, modifier: true },
  { code: SC.ENTER, label: "RETURN", flex: 3, modLook: true },
];

// R1: F1..F10 — mode-invariant. 10 keys at flex 1.5 (span 6) = 60, so each
// F-key is a normal letter-key width. F11/F12 moved up to R0.
const MOBILE_TOP_ROW: KeyDef[] = [
  { code: SC.F1, label: "F1", flex: 1.5 }, { code: SC.F2, label: "F2", flex: 1.5 },
  { code: SC.F3, label: "F3", flex: 1.5 }, { code: SC.F4, label: "F4", flex: 1.5 },
  { code: SC.F5, label: "F5", flex: 1.5 }, { code: SC.F6, label: "F6", flex: 1.5 },
  { code: SC.F7, label: "F7", flex: 1.5 }, { code: SC.F8, label: "F8", flex: 1.5 },
  { code: SC.F9, label: "F9", flex: 1.5 }, { code: SC.F10, label: "F10", flex: 1.5 },
];

// R2-R5: the swapping core. R3/R4/R5 carry the ANSI half-key stagger —
// Q@col0, A@col3 (between Q and W), Z@col6 (between A and S) — built with
// span-3 (flex 0.75) spacers. Standard keys are flex 1.5. Enter/Backspace
// live on R5's right edge (the staggered R4 has no room for them), in the
// same slots on both pages so they never jump on a toggle.
const MOBILE_PAGES: Record<Page, KeyDef[][]> = {
  abc: [
    // R2: 1..0 — ten fat digit keys fill the row exactly.
    [
      { code: SC.D1, label: "1", flex: 1.5 }, { code: SC.D2, label: "2", flex: 1.5 },
      { code: SC.D3, label: "3", flex: 1.5 }, { code: SC.D4, label: "4", flex: 1.5 },
      { code: SC.D5, label: "5", flex: 1.5 }, { code: SC.D6, label: "6", flex: 1.5 },
      { code: SC.D7, label: "7", flex: 1.5 }, { code: SC.D8, label: "8", flex: 1.5 },
      { code: SC.D9, label: "9", flex: 1.5 }, { code: SC.D0, label: "0", flex: 1.5 },
    ],
    // R3: Q..P — QWERTY top row, flush left (col 0). Stagger anchor.
    [
      { code: SC.Q, label: "Q", flex: 1.5 }, { code: SC.W, label: "W", flex: 1.5 },
      { code: SC.E, label: "E", flex: 1.5 }, { code: SC.R, label: "R", flex: 1.5 },
      { code: SC.T, label: "T", flex: 1.5 }, { code: SC.Y, label: "Y", flex: 1.5 },
      { code: SC.U, label: "U", flex: 1.5 }, { code: SC.I, label: "I", flex: 1.5 },
      { code: SC.O, label: "O", flex: 1.5 }, { code: SC.P, label: "P", flex: 1.5 },
    ],
    // R4: A..L — nine home-row letters centered between half-key spacers, so A
    // lands at col 3 (between Q and W). 0.75 + 9×1.5 + 0.75 = 15.
    [
      { spacer: true, flex: 0.75 },
      { code: SC.A, label: "A", flex: 1.5 }, { code: SC.S, label: "S", flex: 1.5 },
      { code: SC.D, label: "D", flex: 1.5 }, { code: SC.F, label: "F", flex: 1.5 },
      { code: SC.G, label: "G", flex: 1.5 }, { code: SC.H, label: "H", flex: 1.5 },
      { code: SC.J, label: "J", flex: 1.5 }, { code: SC.K, label: "K", flex: 1.5 },
      { code: SC.L, label: "L", flex: 1.5 },
      { spacer: true, flex: 0.75 },
    ],
    // R5: Z..M ⌫ — letters + Backspace right of M (its traditional home; only
    // Shift/Enter moved to R0). A span-6 leading spacer keeps Z at col 6
    // (between A and S), preserving the Q→A→Z diagonal. ⌫ sits at col 48..54.
    [
      { spacer: true, flex: 1.5 },
      { code: SC.Z, label: "Z", flex: 1.5 }, { code: SC.X, label: "X", flex: 1.5 },
      { code: SC.C, label: "C", flex: 1.5 }, { code: SC.V, label: "V", flex: 1.5 },
      { code: SC.B, label: "B", flex: 1.5 }, { code: SC.N, label: "N", flex: 1.5 },
      { code: SC.M, label: "M", flex: 1.5 },
      { code: SC.BS, label: "⌫", flex: 1.5 },
      { spacer: true, flex: 1.5 },
    ],
  ],
  sym: [
    // R2: ! @ # $ % ^ & * ( ) — the shifted digit row. symShift wraps each
    // press in a synthetic SHIFT down/up so DOS sees the shifted scancode.
    [
      { code: SC.D1, label: "!", flex: 1.5, symShift: true },
      { code: SC.D2, label: "@", flex: 1.5, symShift: true },
      { code: SC.D3, label: "#", flex: 1.5, symShift: true },
      { code: SC.D4, label: "$", flex: 1.5, symShift: true },
      { code: SC.D5, label: "%", flex: 1.5, symShift: true },
      { code: SC.D6, label: "^", flex: 1.5, symShift: true },
      { code: SC.D7, label: "&", flex: 1.5, symShift: true },
      { code: SC.D8, label: "*", flex: 1.5, symShift: true },
      { code: SC.D9, label: "(", flex: 1.5, symShift: true },
      { code: SC.D0, label: ")", flex: 1.5, symShift: true },
    ],
    // R3: ` ~ [ ] { } < > = +
    [
      { code: SC.GRAVE, label: "`", flex: 1.5 },
      { code: SC.GRAVE, label: "~", flex: 1.5, symShift: true },
      { code: SC.LBRACKET, label: "[", flex: 1.5 },
      { code: SC.RBRACKET, label: "]", flex: 1.5 },
      { code: SC.LBRACKET, label: "{", flex: 1.5, symShift: true },
      { code: SC.RBRACKET, label: "}", flex: 1.5, symShift: true },
      { code: SC.COMMA, label: "<", flex: 1.5, symShift: true },
      { code: SC.PERIOD, label: ">", flex: 1.5, symShift: true },
      { code: SC.EQUAL, label: "=", flex: 1.5 },
      { code: SC.EQUAL, label: "+", flex: 1.5, symShift: true },
    ],
    // R4: - _ ; : ' " | \ / — nine symbols, same half-key stagger as abc R4.
    [
      { spacer: true, flex: 0.75 },
      { code: SC.MINUS, label: "-", flex: 1.5 },
      { code: SC.MINUS, label: "_", flex: 1.5, symShift: true },
      { code: SC.SEMICOLON, label: ";", flex: 1.5 },
      { code: SC.SEMICOLON, label: ":", flex: 1.5, symShift: true },
      { code: SC.QUOTE, label: "'", flex: 1.5 },
      { code: SC.QUOTE, label: "\"", flex: 1.5, symShift: true },
      { code: SC.BACKSLASH, label: "|", flex: 1.5, symShift: true },
      { code: SC.BACKSLASH, label: "\\", flex: 1.5 },
      { code: SC.SLASH, label: "/", flex: 1.5 },
      { spacer: true, flex: 0.75 },
    ],
    // R5: , . ? ⌫ — leftover punctuation + Backspace at col 48..54 (same slot
    // as abc R5 so ⌫ doesn't jump on toggle). Shift/Enter live on R0. The
    // span-6 leading spacer matches abc R5.
    [
      { spacer: true, flex: 1.5 },
      { code: SC.COMMA, label: ",", flex: 1.5 },
      { code: SC.PERIOD, label: ".", flex: 1.5 },
      { code: SC.SLASH, label: "?", flex: 1.5, symShift: true },
      { spacer: true, flex: 6 },
      { code: SC.BS, label: "⌫", flex: 1.5 },
      { spacer: true, flex: 1.5 },
    ],
  ],
};

// R6: Ctrl Alt Sym Space [arrows] — always-visible modifier/nav row at the
// bottom edge. Row sums to flex 15 (= span 60) like every other row, so its
// keys line up on the same column grid. Ctrl/Alt/Sym are fat (flex 2 → span 8,
// ~48px); Space takes flex 4.5. The arrow cluster (role "arrowsMobile", flex
// 4.5 → span 18 = three letter-key widths) splits into three equal columns,
// so ← ↑↓ → each end up the same ~36px width as a normal QWERTY key. ↑/↓ are
// stacked half-height in the center column. Sym swaps to "ABC" on the sym page.
const MOBILE_UTIL_ROW: KeyDef[] = [
  { code: SC.CTRL, label: "Ctrl", flex: 2, modifier: true },
  { code: SC.ALT, label: "Alt", flex: 2, modifier: true },
  { code: -1, label: "Sym", role: "symToggle", flex: 2 },
  { code: SC.SPACE, label: "Space", flex: 4.5 },
  { code: -1, label: "", role: "arrowsMobile", flex: 4.5 },
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

export function VirtualKeyboard({ onKeyDown, onKeyUp, onHide, bgOpacity = 1 }: VirtualKeyboardProps) {
  // Refs hold authoritative dedupe state — mutated synchronously
  // inside event handlers so two pointer events arriving before React
  // re-renders can't both emit the same scancode. setRender bumps a
  // counter to trigger re-render after each mutation.
  const pressedRef = useRef<Set<string>>(new Set());
  const stickyModsRef = useRef<Set<number>>(new Set());
  const [, setRender] = useReducer((x: number) => x + 1, 0);

  const [page, setPage] = useState<Page>("abc");
  const isMobile = useIsMobile();

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
      if (symShift) onKeyDown(SC.SHIFT);
      onKeyDown(code);
      setRender();
    },
    [onKeyDown, onKeyUp]
  );

  const handleUp = useCallback(
    (id: string, code: number, isModifier: boolean, symShift: boolean = false) => {
      if (isModifier) return;
      const pressed = pressedRef.current;
      if (!pressed.has(id)) return;
      pressed.delete(id);
      onKeyUp(code);
      // Release the synthetic SHIFT emitted by handleDown for symShift keys.
      if (symShift) onKeyUp(SC.SHIFT);
      const mods = stickyModsRef.current;
      if (mods.size > 0) {
        for (const m of mods) onKeyUp(m);
        mods.clear();
      }
      setRender();
    },
    [onKeyUp]
  );

  function renderCell(k: KeyDef, id: string) {
    if (k.spacer) {
      return (
        <div
          key={id}
          className="vkb-spacer"
          style={{ gridColumn: `span ${Math.round((k.flex ?? 1) * 4)}` }}
          aria-hidden="true"
        />
      );
    }

    // Arrow cluster — both desktop ("arrows": ↑ top-center, ←↓→ bottom) and
    // mobile ("arrowsMobile": ← → full-height flanks, ↑/↓ stacked center) are
    // a self-contained grid of four real arrow keys, wired to the same press
    // handlers as every letter key. Only the container class (and thus the CSS
    // grid-template-areas) differs; the buttons are identical.
    if (k.role === "arrows" || k.role === "arrowsMobile" || k.role === "arrowUp") {
      const arrow = (sc: number, label: string, sub: string) => {
        const aid = `${id}-${sub}`;
        const pressed = pressedRef.current.has(aid);
        const ArrowIcon = ARROW_ICON[sub];
        return (
          <button
            key={aid}
            type="button"
            tabIndex={-1}
            aria-label={label}
            aria-pressed={pressed}
            className={
              "vkb-key vkb-arrow vkb-arrow--" + sub +
              (pressed ? " vkb-key--pressed" : "")
            }
            onPointerDown={(e) => { e.preventDefault(); handleDown(aid, sc, false, false); }}
            onPointerUp={(e) => { e.preventDefault(); handleUp(aid, sc, false, false); }}
            onPointerCancel={() => handleUp(aid, sc, false, false)}
            onPointerLeave={(e) => { if (e.buttons !== 0) handleUp(aid, sc, false, false); }}
            onContextMenu={(e) => e.preventDefault()}
          >
            <ArrowIcon {...KEY_ICON_PROPS} />
          </button>
        );
      };
      const span = { gridColumn: `span ${Math.round((k.flex ?? 1) * 4)}` };
      // Desktop ↑ alone on the Shift line (centered over ↓ below).
      if (k.role === "arrowUp") {
        return <div key={id} className="vkb-arrows-up" style={span}>{arrow(SC.UP, "↑", "up")}</div>;
      }
      // Mobile: all four in one cluster (← → flanks, ↑/↓ stacked center).
      if (k.role === "arrowsMobile") {
        return (
          <div key={id} className="vkb-arrows-lr" style={span}>
            {arrow(SC.UP, "↑", "up")}
            {arrow(SC.LEFT, "←", "left")}
            {arrow(SC.DOWN, "↓", "down")}
            {arrow(SC.RIGHT, "→", "right")}
          </div>
        );
      }
      // Desktop bottom row: ← ↓ → at full row height (↑ is the R5 cell above).
      return (
        <div key={id} className="vkb-arrows" style={span}>
          {arrow(SC.LEFT, "←", "left")}
          {arrow(SC.DOWN, "↓", "down")}
          {arrow(SC.RIGHT, "→", "right")}
        </div>
      );
    }

    // Hide-keyboard key (desktop Esc/F-row) — collapses the VKB; no DOS key.
    if (k.role === "hide") {
      return (
        <button
          key={id}
          type="button"
          tabIndex={-1}
          aria-label="키보드 숨기기"
          className="vkb-key vkb-key--hide"
          style={{ gridColumn: `span ${Math.round((k.flex ?? 1) * 4)}` }}
          onPointerDown={(e) => {
            e.preventDefault();
            onHide?.();
          }}
          onContextMenu={(e) => e.preventDefault()}
        >
          {k.label}
        </button>
      );
    }

    // Sym/ABC toggle — swaps mobile page state; does not emit a DOS key.
    if (k.role === "symToggle") {
      const isSym = page === "sym";
      const label = isSym ? "ABC" : "Sym";
      return (
        <button
          key={id}
          type="button"
          tabIndex={-1}
          aria-pressed={isSym}
          className={"vkb-key vkb-key--sym" + (isSym ? " vkb-key--sym-active" : "")}
          style={{ gridColumn: `span ${Math.round((k.flex ?? 1) * 4)}` }}
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
    // Visual modifier styling (muted/uppercase/small) applies to real sticky
    // modifiers AND to modLook keys (Esc/Tab/Caps/Return) that only want the look.
    const modStyle = isMod || !!k.modLook;
    const isPressed = isMod
      ? stickyModsRef.current.has(k.code)
      : pressedRef.current.has(id);
    const shiftLatched = stickyModsRef.current.has(SC.SHIFT);
    const isShiftKey = k.code === SC.SHIFT;

    // Static multi-label rendering — every key shows what it produces both
    // normally and with Shift, the way the English+Hangul dual-label already
    // works. The layout no longer swaps when Shift is held (that was
    // disorienting); instead each key carries up to three glyphs at once:
    //   · primary (top-left)   — the ASCII identity (letter / digit / symbol)
    //   · hangul  (bottom-right)— the 두벌식 base jamo, letters only
    //   · shift   (top-right)  — Shift variant: 쌍자음/ㅒ/ㅖ for letters, or
    //                            the shifted symbol (1→!, [→{) otherwise
    // The shift glyph is suppressed when it equals the key's own label (e.g.
    // the mobile sym page already shows "!" as its primary).
    const hangul = HANGUL_LABELS[k.code];
    const shiftGlyph = HANGUL_SHIFT_LABELS[k.code] ?? SHIFT_LABELS[k.code];
    const showShift = !isMod && shiftGlyph != null && shiftGlyph !== k.label;
    // Three render modes:
    //  · corner — letter keys (have a 두벌식 jamo): the classic diagonal
    //    layout (English TL, jamo BR), plus a shift glyph TR on the seven
    //    쌍자음/ㅒ/ㅖ keys. All glyphs equal size/color.
    //  · dual   — number-row keys (no jamo, but a shift variant): the shifted
    //    symbol stacked on top (dimmed) with the digit below — e.g. !/1.
    //  · single — neither: the label, centered (Esc, Tab, Space, F-keys…).
    const corner = hangul != null;
    const dual = !corner && showShift;
    // Single-glyph control/modifier keys (Backspace/Shift/Caps/Tab/Return)
    // render their lucide keycap icon in place of the text label.
    const KeyIcon = !corner && !dual ? KEY_ICON[k.code] : undefined;

    return (
      <button
        key={id}
        type="button"
        tabIndex={-1}
        // Icon-only keys (Backspace/Shift/Caps/Tab/Return) have no text node, so
        // the lucide glyph (aria-hidden) leaves the button without an accessible
        // name — restore it from the original label.
        aria-label={KeyIcon ? k.label : undefined}
        aria-pressed={isPressed || (isShiftKey && shiftLatched)}
        className={
          "vkb-key" +
          (isPressed ? " vkb-key--pressed" : "") +
          (modStyle ? " vkb-key--mod" : "") +
          (isShiftKey && shiftLatched ? " vkb-key--latched" : "")
        }
        style={{ gridColumn: `span ${Math.round((k.flex ?? 1) * 4)}` }}
        onPointerDown={(e) => {
          e.preventDefault();
          handleDown(id, k.code, isMod, !!k.symShift);
        }}
        onPointerUp={(e) => {
          e.preventDefault();
          handleUp(id, k.code, isMod, !!k.symShift);
        }}
        onPointerCancel={() => handleUp(id, k.code, isMod, !!k.symShift)}
        onPointerLeave={(e) => {
          if (e.buttons !== 0) handleUp(id, k.code, isMod, !!k.symShift);
        }}
        onContextMenu={(e) => e.preventDefault()}
      >
        {corner ? (
          <>
            <span className="vkb-key__en">{k.label}</span>
            {showShift && <span className="vkb-key__shift">{shiftGlyph}</span>}
            <span className="vkb-key__ko">{hangul}</span>
          </>
        ) : dual ? (
          <span className="vkb-key__dual">
            <span className="vkb-key__dual-sym">{shiftGlyph}</span>
            <span className="vkb-key__dual-num">{k.label}</span>
          </span>
        ) : KeyIcon ? (
          <KeyIcon {...KEY_ICON_PROPS} />
        ) : (
          k.label
        )}
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

  if (isMobile) {
    return (
      <div className="vkb" role="group" aria-label="DOS 가상 키보드" style={{ "--vkb-bg-opacity": bgOpacity } as React.CSSProperties}>
        <div className="vkb-content">
          {renderRow(MOBILE_CONTROL_ROW, "ctrl")}
          {renderRow(MOBILE_TOP_ROW, "fkeys")}
          {MOBILE_PAGES[page].map((row, ri) => renderRow(row, `${page}-${ri}`))}
        </div>
        {renderRow(MOBILE_UTIL_ROW, "util")}
      </div>
    );
  }

  // Desktop: 6 rows of ANSI-staggered keys. Arrows are inline in rows 5/6.
  return (
    <div className="vkb" role="group" aria-label="DOS 가상 키보드" style={{ "--vkb-bg-opacity": bgOpacity } as React.CSSProperties}>
      {DESKTOP_ROWS.map((row, ri) => renderRow(row, String(ri)))}
    </div>
  );
}
