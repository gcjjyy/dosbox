// app/components/VirtualKeyboard.tsx
//
// QWERTY virtual keyboard for tablet (landscape). Maps button taps to
// GLFW-style keycodes and calls onKeyDown/onKeyUp. Sticky-once modifiers:
// Shift/Ctrl/Alt latch on tap, release after the next non-modifier
// key's pointerup. Tap a latched modifier again to clear it manually.
//
// Arrow cluster (rows 5+6) lives in a fixed-width column so ↑ and ↓
// share the same x position regardless of how the main row distributes.

import { useCallback, useReducer, useRef } from "react";
import { SC } from "../lib/dos-keymap";

export interface VirtualKeyboardProps {
  onKeyDown: (scancode: number) => void;
  onKeyUp: (scancode: number) => void;
}

type KeyDef =
  | { spacer: true; flex?: number }
  | { code: number; label: string; flex?: number; modifier?: boolean; spacer?: false };

// All main rows total flex = 15.25 so letter-cell widths match across rows.
// Rows 5-6 main parts are flex 12.25 and the arrow cluster (.vkb-arrows-col)
// adds the remaining width — see ARROW_CLUSTERS + CSS.
const ROWS: KeyDef[][] = [
  // Row 1: Esc + F1..F12  (flex: 3.25 + 12 = 15.25)
  [
    { code: SC.ESC, label: "Esc", flex: 3.25 },
    { code: SC.F1, label: "F1" }, { code: SC.F2, label: "F2" }, { code: SC.F3, label: "F3" },
    { code: SC.F4, label: "F4" }, { code: SC.F5, label: "F5" }, { code: SC.F6, label: "F6" },
    { code: SC.F7, label: "F7" }, { code: SC.F8, label: "F8" }, { code: SC.F9, label: "F9" },
    { code: SC.F10, label: "F10" }, { code: SC.F11, label: "F11" }, { code: SC.F12, label: "F12" },
  ],
  // Row 2: digits + Backspace  (flex: 12 + 3.25 = 15.25)
  [
    { code: SC.D1, label: "1" }, { code: SC.D2, label: "2" }, { code: SC.D3, label: "3" },
    { code: SC.D4, label: "4" }, { code: SC.D5, label: "5" }, { code: SC.D6, label: "6" },
    { code: SC.D7, label: "7" }, { code: SC.D8, label: "8" }, { code: SC.D9, label: "9" },
    { code: SC.D0, label: "0" }, { code: SC.MINUS, label: "-" }, { code: SC.EQUAL, label: "=" },
    { code: SC.BS, label: "⌫", flex: 3.25 },
  ],
  // Row 3: Tab + Q..P + brackets + backslash  (flex: 2.25 + 13 = 15.25)
  [
    { code: SC.TAB, label: "Tab", flex: 2.25 },
    { code: SC.Q, label: "Q" }, { code: SC.W, label: "W" }, { code: SC.E, label: "E" },
    { code: SC.R, label: "R" }, { code: SC.T, label: "T" }, { code: SC.Y, label: "Y" },
    { code: SC.U, label: "U" }, { code: SC.I, label: "I" }, { code: SC.O, label: "O" },
    { code: SC.P, label: "P" },
    { code: SC.LBRACKET, label: "[" }, { code: SC.RBRACKET, label: "]" },
    { code: SC.BACKSLASH, label: "\\" },
  ],
  // Row 4: [CapsLock-area spacer] + A..L + ; ' + Enter  (flex: 2 + 11 + 2.25 = 15.25)
  [
    { spacer: true, flex: 2 },
    { code: SC.A, label: "A" }, { code: SC.S, label: "S" }, { code: SC.D, label: "D" },
    { code: SC.F, label: "F" }, { code: SC.G, label: "G" }, { code: SC.H, label: "H" },
    { code: SC.J, label: "J" }, { code: SC.K, label: "K" }, { code: SC.L, label: "L" },
    { code: SC.SEMICOLON, label: ";" }, { code: SC.QUOTE, label: "'" },
    { code: SC.ENTER, label: "⏎", flex: 2.25 },
  ],
  // Row 5 main: Shift + Z..M + , . /  (flex: 2.25 + 10 = 12.25, arrows column follows)
  [
    { code: SC.SHIFT, label: "Shift", flex: 2.25, modifier: true },
    { code: SC.Z, label: "Z" }, { code: SC.X, label: "X" }, { code: SC.C, label: "C" },
    { code: SC.V, label: "V" }, { code: SC.B, label: "B" }, { code: SC.N, label: "N" },
    { code: SC.M, label: "M" },
    { code: SC.COMMA, label: "," }, { code: SC.PERIOD, label: "." }, { code: SC.SLASH, label: "/" },
  ],
  // Row 6 main: Ctrl Alt Space Alt  (flex: 1.5 + 1.25 + 8.25 + 1.25 = 12.25, arrows follow)
  [
    { code: SC.CTRL, label: "Ctrl", flex: 1.5, modifier: true },
    { code: SC.ALT, label: "Alt", flex: 1.25, modifier: true },
    { code: SC.SPACE, label: "Space", flex: 8.25 },
    { code: SC.ALT, label: "Alt", flex: 1.25, modifier: true },
  ],
];

// Fixed-width arrow cluster appended to rows 5 and 6.
// Both rows get a 156px column with 3 flex-1 cells inside → ↑ aligns over ↓.
const ARROW_CLUSTERS: Record<number, KeyDef[]> = {
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

export function VirtualKeyboard({ onKeyDown, onKeyUp }: VirtualKeyboardProps) {
  // Refs hold the authoritative state for emit dedup (synchronous mutation).
  // setRender bumps a counter to trigger re-render after each mutation.
  // We can't use useState here: setState is async, so two pointer events
  // firing before React re-renders would both pass the "has(id)" guard and
  // each call onKeyDown — sending duplicate scancodes to DOSBox.
  const pressedRef = useRef<Set<string>>(new Set());
  const stickyModsRef = useRef<Set<number>>(new Set());
  const [, setRender] = useReducer((x: number) => x + 1, 0);

  const handleDown = useCallback((id: string, code: number, isModifier: boolean) => {
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
  }, [onKeyDown, onKeyUp]);

  const handleUp = useCallback((id: string, code: number, isModifier: boolean) => {
    if (isModifier) return;
    const pressed = pressedRef.current;
    if (!pressed.has(id)) return; // already released by pointerLeave/cancel
    pressed.delete(id);
    onKeyUp(code);
    // After a non-modifier release, clear any sticky modifiers.
    const mods = stickyModsRef.current;
    if (mods.size > 0) {
      for (const m of mods) onKeyUp(m);
      mods.clear();
    }
    setRender();
  }, [onKeyUp]);

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
    // For modifier keys, the same scancode may appear in multiple cells
    // (e.g. left- and right-Alt both map to SC.ALT). The shared latch
    // state means both cells light up together — intentional.
    const isMod = !!k.modifier;
    const isPressed = isMod
      ? stickyModsRef.current.has(k.code)
      : pressedRef.current.has(id);
    return (
      <button
        key={id}
        type="button"
        // tabIndex=-1: keep keyboard focus on the canvas so physical
        // typing reaches the emulator, not these buttons.
        tabIndex={-1}
        aria-pressed={isPressed}
        className={
          "vkb-key" +
          (isPressed ? " vkb-key--pressed" : "") +
          (isMod ? " vkb-key--mod" : "")
        }
        style={{ flexGrow: k.flex ?? 1 }}
        onPointerDown={(e) => { e.preventDefault(); handleDown(id, k.code, isMod); }}
        onPointerUp={(e) => { e.preventDefault(); handleUp(id, k.code, isMod); }}
        onPointerCancel={() => handleUp(id, k.code, isMod)}
        onPointerLeave={(e) => { if (e.buttons !== 0) handleUp(id, k.code, isMod); }}
        onContextMenu={(e) => e.preventDefault()}
      >
        {k.label}
      </button>
    );
  }

  return (
    <div className="vkb" role="group" aria-label="DOS 가상 키보드">
      {ROWS.map((row, ri) => {
        const arrows = ARROW_CLUSTERS[ri];
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
