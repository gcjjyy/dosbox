// app/components/VirtualKeyboard.tsx
//
// Two layouts behind one component:
//
//  - Mobile (viewport ≤640px portrait): 6 rows; every real key is ≥ 1.0
//    flex (~28px wide on a 390px viewport). R1 F-keys, R2-R5 a stripped-
//    down QWERTY block (only `.` on R5; `,` `;` `'` `\` ` and the digit-
//    shifted symbols live on the sym page), R6 util row with Sym/ABC
//    toggle immediately left of Space. The legacy 3-page tab bar
//    (ABC/123/FN) is gone; pressing `Sym` swaps R2-R5 to a dedicated
//    special-character layout (R1 F-keys and R6 util are mode-invariant).
//    Inverted-T arrow cluster: ↑ at flex 10..11 on R5 stacks directly
//    above ↓ at flex 10..11 on R6 in both ABC and sym modes.
//
//  - Desktop (viewport >640px): a 6-row full keyboard with canonical ANSI
//    stagger (Tab 1.5 / Caps 1.75 / Shift 2.25) and arrows integrated into
//    rows 5/6 — no fixed-156px cluster column.
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
// Mobile Sym-page keys carry `symShift: true` on their KeyDef. The press
// handler wraps the emitted scancode in a synthetic SHIFT down/up so DOS
// sees the shifted scancode (e.g. tapping `!` emits SHIFT + D1 + SHIFT_up).

import { useCallback, useEffect, useReducer, useRef, useState } from "react";
import { HANGUL_LABELS, SC, SHIFT_LABELS } from "../lib/dos-keymap";

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
      /** When true, the press handler wraps the emitted scancode in a
       *  synthetic SHIFT down/up so DOS sees the shifted scancode. Used
       *  by mobile Sym-page glyphs like `!` `{` etc. */
      symShift?: boolean;
      /** Special render role: "symToggle" — the Sym/ABC mobile toggle.
       *  Renderer swaps label + handler; `code` is unused. */
      role?: "symToggle";
      spacer?: false;
    };

type Page = "abc" | "sym";

// Desktop full layout. Stagger: Tab 1.5 / Caps 1.75 / Shift 2.25 produces
// canonical ANSI offsets (A between Q-W; Z between A-S). Arrows are
// integrated into R5/R6 so the inverted-T ↑/↓ alignment survives any
// viewport width. All rows sum to flex 15.25.
const DESKTOP_ROWS: KeyDef[][] = [
  // Row 1: Esc + F1..F12 (3.25 + 12 = 15.25)
  [
    { code: SC.ESC, label: "Esc", flex: 3.25 },
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
  // Row 5: Sh Z..M , . / ↑ Sh  (2.25 + 7 + 1 + 1 + 1 + 1.5 + 1.5 = 15.25)
  // ↑ width 1.5 == R6 ↓ width → true inverted-T (centers aligned).
  [
    { code: SC.SHIFT, label: "Shift", flex: 2.25, modifier: true },
    { code: SC.Z, label: "Z" }, { code: SC.X, label: "X" }, { code: SC.C, label: "C" },
    { code: SC.V, label: "V" }, { code: SC.B, label: "B" }, { code: SC.N, label: "N" },
    { code: SC.M, label: "M" },
    { code: SC.COMMA, label: "," }, { code: SC.PERIOD, label: "." }, { code: SC.SLASH, label: "/" },
    { code: SC.UP, label: "↑", flex: 1.5 },
    { code: SC.SHIFT, label: "Shift", flex: 1.5, modifier: true },
  ],
  // Row 6: Ctl Alt Space Alt ← ↓ →  (1.5+1.5+6.25+1.5+1.5+1.5+1.5 = 15.25)
  // ↓ start = 1.5+1.5+6.25+1.5+1.5 = 12.25 == R5 ↑ start. Right Ctrl
  // dropped — sacrificed for clean inverted-T alignment.
  [
    { code: SC.CTRL, label: "Ctrl", flex: 1.5, modifier: true },
    { code: SC.ALT, label: "Alt", flex: 1.5, modifier: true },
    { code: SC.SPACE, label: "Space", flex: 6.25 },
    { code: SC.ALT, label: "Alt", flex: 1.5, modifier: true },
    { code: SC.LEFT, label: "←", flex: 1.5 },
    { code: SC.DOWN, label: "↓", flex: 1.5 },
    { code: SC.RIGHT, label: "→", flex: 1.5 },
  ],
];

// Mobile portrait layouts. All rows sum to flex 12. Every real key is ≥ 1.0
// flex (~28px wide on a 390px viewport) — no sub-unit keys, which were the
// "too narrow to hit" 0.5/0.75 keys the user complained about. Modifier
// widths are 2.0 (Tab/Shift/BS) or 1.5 (Caps/RET) — wide enough for labels
// but no longer dominating the row.
//
// True inverted-T arrow alignment is preserved:
//   ABC R5 ↑ sits at flex offset 10..11 (between . and / on the right edge);
//   util R6 ↓ sits at flex offset 10..11 (between ← and →).
// To make room for that exact placement, comma moves to the sym page —
// it lives there alongside ? and the other punctuation we shifted off the
// main letter rows (`, \, ;, ', and the leading grave on R2).
const MOBILE_PAGES: Record<Page, KeyDef[][]> = {
  abc: [
    // R1: F1..F12 (12 × 1.0 = 12)
    [
      { code: SC.F1, label: "F1" }, { code: SC.F2, label: "F2" }, { code: SC.F3, label: "F3" },
      { code: SC.F4, label: "F4" }, { code: SC.F5, label: "F5" }, { code: SC.F6, label: "F6" },
      { code: SC.F7, label: "F7" }, { code: SC.F8, label: "F8" }, { code: SC.F9, label: "F9" },
      { code: SC.F10, label: "F10" }, { code: SC.F11, label: "F11" }, { code: SC.F12, label: "F12" },
    ],
    // R2: 1..0 BS  (10 × 1.0 + 2.0 = 12). Grave moves to sym page.
    [
      { code: SC.D1, label: "1" }, { code: SC.D2, label: "2" }, { code: SC.D3, label: "3" },
      { code: SC.D4, label: "4" }, { code: SC.D5, label: "5" }, { code: SC.D6, label: "6" },
      { code: SC.D7, label: "7" }, { code: SC.D8, label: "8" }, { code: SC.D9, label: "9" },
      { code: SC.D0, label: "0" },
      { code: SC.BS, label: "BS", flex: 2 },
    ],
    // R3: Tab Q..P  (2.0 + 10 × 1.0 = 12). Backslash moves to sym page.
    [
      { code: SC.TAB, label: "Tab", flex: 2 },
      { code: SC.Q, label: "Q" }, { code: SC.W, label: "W" }, { code: SC.E, label: "E" },
      { code: SC.R, label: "R" }, { code: SC.T, label: "T" }, { code: SC.Y, label: "Y" },
      { code: SC.U, label: "U" }, { code: SC.I, label: "I" }, { code: SC.O, label: "O" },
      { code: SC.P, label: "P" },
    ],
    // R4: Caps A..L RET  (1.5 + 9 × 1.0 + 1.5 = 12). ;/' move to sym page.
    [
      { code: SC.CAPSLOCK, label: "Caps", flex: 1.5 },
      { code: SC.A, label: "A" }, { code: SC.S, label: "S" }, { code: SC.D, label: "D" },
      { code: SC.F, label: "F" }, { code: SC.G, label: "G" }, { code: SC.H, label: "H" },
      { code: SC.J, label: "J" }, { code: SC.K, label: "K" }, { code: SC.L, label: "L" },
      { code: SC.ENTER, label: "RET", flex: 1.5 },
    ],
    // R5: ↑Sh Z..M . ↑ /  (2.0 + 7 × 1.0 + 1.0 + 1.0 + 1.0 = 12)
    // ↑ at flex 10..11 — TRUE inverted-T with ↓ at flex 10..11 on R6.
    // / fills the right edge (under R6's →) — useful for DOS switches.
    // Comma moves to sym R5 so this row keeps T-alignment and uniform widths.
    [
      { code: SC.SHIFT, label: "↑Sh", flex: 2, modifier: true },
      { code: SC.Z, label: "Z" }, { code: SC.X, label: "X" }, { code: SC.C, label: "C" },
      { code: SC.V, label: "V" }, { code: SC.B, label: "B" }, { code: SC.N, label: "N" },
      { code: SC.M, label: "M" },
      { code: SC.PERIOD, label: "." },
      { code: SC.UP, label: "↑" },
      { code: SC.SLASH, label: "/" },
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
    // R2: ! @ # $ % ^ & * ( ) BS  (10 × 1.0 + 2.0 = 12).
    // symShift wraps the keypress in SHIFT down/up so DOS sees the shifted scancode.
    [
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
      { code: SC.BS, label: "BS", flex: 2 },
    ],
    // R3: Tab { } [ ] - _ = + < >  (2.0 + 10 × 1.0 = 12)
    [
      { code: SC.TAB, label: "Tab", flex: 2 },
      { code: SC.LBRACKET, label: "{", symShift: true },
      { code: SC.RBRACKET, label: "}", symShift: true },
      { code: SC.LBRACKET, label: "[" },
      { code: SC.RBRACKET, label: "]" },
      { code: SC.MINUS, label: "-" },
      { code: SC.MINUS, label: "_", symShift: true },
      { code: SC.EQUAL, label: "=" },
      { code: SC.EQUAL, label: "+", symShift: true },
      { code: SC.COMMA, label: "<", symShift: true },
      { code: SC.PERIOD, label: ">", symShift: true },
    ],
    // R4: Caps ` ~ ; ' : " \ | / RET  (1.5 + 9 × 1.0 + 1.5 = 12)
    [
      { code: SC.CAPSLOCK, label: "Caps", flex: 1.5 },
      { code: SC.GRAVE, label: "`" },
      { code: SC.GRAVE, label: "~", symShift: true },
      { code: SC.SEMICOLON, label: ";" },
      { code: SC.QUOTE, label: "'" },
      { code: SC.SEMICOLON, label: ":", symShift: true },
      { code: SC.QUOTE, label: "\"", symShift: true },
      { code: SC.BACKSLASH, label: "\\" },
      { code: SC.BACKSLASH, label: "|", symShift: true },
      { code: SC.SLASH, label: "/" },
      { code: SC.ENTER, label: "RET", flex: 1.5 },
    ],
    // R5: ↑Sh , . spacer(6) ↑ ?  (2.0 + 1 + 1 + 6 + 1 + 1 = 12)
    // ↑ at flex 10..11 matches ABC R5 and util R6 ↓ — same inverted-T anchor
    // across both modes so switching pages doesn't move the arrow. Comma and
    // period sit on the left so muscle memory from ABC carries over. The
    // right-edge `?` mirrors ABC R5's `/` slot — both are SLASH variants.
    [
      { code: SC.SHIFT, label: "↑Sh", flex: 2, modifier: true },
      { code: SC.COMMA, label: "," },
      { code: SC.PERIOD, label: "." },
      { spacer: true, flex: 6 },
      { code: SC.UP, label: "↑" },
      { code: SC.SLASH, label: "?", symShift: true },
    ],
  ],
};

// Always-visible bottom row on every mobile page.
// Esc Ctl Alt Sym Space ← ↓ →  (1+1+1+1+5+1+1+1 = 12).
// ↓ at flex 10..11 → exact center-on-center alignment with ↑ on R5 of both
// pages. The 4th cell (Sym) swaps its label to "ABC" when on the sym page;
// renderer handles via role="symToggle".
const MOBILE_UTIL_ROW: KeyDef[] = [
  { code: SC.ESC, label: "Esc" },
  { code: SC.CTRL, label: "Ctrl", modifier: true },
  { code: SC.ALT, label: "Alt", modifier: true },
  { code: -1, label: "Sym", role: "symToggle" },
  { code: SC.SPACE, label: "Space", flex: 5 },
  { code: SC.LEFT, label: "←" },
  { code: SC.DOWN, label: "↓" },
  { code: SC.RIGHT, label: "→" },
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

    // Sym/ABC toggle — swaps mobile page state; does not emit a DOS key.
    if (k.role === "symToggle") {
      const isSym = page === "sym";
      const label = isSym ? "ABC" : "Sym";
      return (
        <button
          key={id}
          type="button"
          tabIndex={-1}
          className="vkb-key vkb-key--sym"
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

  function renderRow(row: KeyDef[], prefix: string) {
    return (
      <div className="vkb-row" key={prefix}>
        {row.map((k, ki) => renderCell(k, `${prefix}-${ki}`))}
      </div>
    );
  }

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

  // Desktop: 6 rows of ANSI-staggered keys. Arrows are inline in rows 5/6.
  return (
    <div className="vkb" role="group" aria-label="DOS 가상 키보드">
      {DESKTOP_ROWS.map((row, ri) => renderRow(row, String(ri)))}
    </div>
  );
}
