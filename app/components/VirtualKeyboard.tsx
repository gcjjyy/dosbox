// app/components/VirtualKeyboard.tsx
//
// Two layouts behind one component:
//
//  - Mobile (viewport ≤640px): tab bar (ABC / 123 / FN, evenly
//    distributed) on top, active-page rows in the middle, always-
//    visible util row at the bottom. Cells uniformly 10% of width;
//    arrows live on the 123 page as an inverted-T occupying R2 col 9
//    and R3 cols 8-10.
//
//  - Desktop (viewport >640px): the original 6-row full keyboard,
//    with CapsLock filling the Row 4 left spacer.
//
// Letter keys always show two labels: English in the upper-left
// corner, 두벌식 jamo (from HANGUL_LABELS) in the lower-right corner.
// Scancodes are unchanged — DOS still receives A/B/C etc., so any
// DOS-side IME (e.g. 한글 도깨비) controls the actual input mode.
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

// ── Desktop full layout (original 6 rows + CapsLock + BS/RET) ────
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
  // Row 4: CapsLock + A..L + ; ' + RET (2 + 11 + 2.25 = 15.25)
  // CapsLock replaces the old Row 4 left spacer.
  [
    { code: SC.CAPSLOCK, label: "Caps", flex: 2 },
    { code: SC.A, label: "A" }, { code: SC.S, label: "S" }, { code: SC.D, label: "D" },
    { code: SC.F, label: "F" }, { code: SC.G, label: "G" }, { code: SC.H, label: "H" },
    { code: SC.J, label: "J" }, { code: SC.K, label: "K" }, { code: SC.L, label: "L" },
    { code: SC.SEMICOLON, label: ";" }, { code: SC.QUOTE, label: "'" },
    { code: SC.ENTER, label: "RET", flex: 2.25 },
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
    // Empty spacer row so fn page totals 3 rows (abc/123 parity) and the
    // util row stays at the same y across all pages.
    [
      { spacer: true, flex: 10 },
    ],
  ],
};

// Always-visible bottom row on every mobile page.
// Esc Ctrl Alt Shift + Space (4-wide) + BS RET (4 mod + 4 space + 2 narrow = 10)
const MOBILE_UTIL_ROW: KeyDef[] = [
  { code: SC.ESC, label: "Esc", modifier: false },
  { code: SC.CTRL, label: "Ctrl", modifier: true },
  { code: SC.ALT, label: "Alt", modifier: true },
  { code: SC.SHIFT, label: "Shift", modifier: true },
  { code: SC.SPACE, label: "Space", flex: 4 },
  { code: SC.BS, label: "BS" },
  { code: SC.ENTER, label: "RET" },
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
    const hangul = HANGUL_LABELS[k.code];
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
        {hangul ? (
          <>
            <span className="vkb-key__en">{k.label}</span>
            <span className="vkb-key__ko">{hangul}</span>
          </>
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
}
