// app/components/VirtualKeyboard.tsx
//
// QWERTY virtual keyboard for tablet (landscape). Maps button taps to
// SDL2 scancodes and calls onKeyDown/onKeyUp. Sticky-once modifiers:
// Shift/Ctrl/Alt latch on tap, release after the next non-modifier
// key's pointerup. Tap a latched modifier again to clear it manually.

import { useCallback, useReducer, useRef } from "react";
import { SC } from "../lib/dos-keymap";

export interface VirtualKeyboardProps {
  onKeyDown: (scancode: number) => void;
  onKeyUp: (scancode: number) => void;
}

interface KeyDef {
  code: number;
  label: string;
  flex?: number;     // flex-grow units (default 1)
  modifier?: boolean;
}

const ROWS: KeyDef[][] = [
  // Row 1: digits + Backspace
  [
    { code: SC.D1, label: "1" }, { code: SC.D2, label: "2" }, { code: SC.D3, label: "3" },
    { code: SC.D4, label: "4" }, { code: SC.D5, label: "5" }, { code: SC.D6, label: "6" },
    { code: SC.D7, label: "7" }, { code: SC.D8, label: "8" }, { code: SC.D9, label: "9" },
    { code: SC.D0, label: "0" }, { code: SC.MINUS, label: "-" }, { code: SC.EQUAL, label: "=" },
    { code: SC.BS, label: "⌫", flex: 2 },
  ],
  // Row 2: Tab + Q..P + brackets + backslash
  [
    { code: SC.TAB, label: "Tab", flex: 1.5 },
    { code: SC.Q, label: "Q" }, { code: SC.W, label: "W" }, { code: SC.E, label: "E" },
    { code: SC.R, label: "R" }, { code: SC.T, label: "T" }, { code: SC.Y, label: "Y" },
    { code: SC.U, label: "U" }, { code: SC.I, label: "I" }, { code: SC.O, label: "O" },
    { code: SC.P, label: "P" },
    { code: SC.LBRACKET, label: "[" }, { code: SC.RBRACKET, label: "]" },
    { code: SC.BACKSLASH, label: "\\" },
  ],
  // Row 3: Esc + A..L + ; ' Enter
  [
    { code: SC.ESC, label: "Esc", flex: 1.75 },
    { code: SC.A, label: "A" }, { code: SC.S, label: "S" }, { code: SC.D, label: "D" },
    { code: SC.F, label: "F" }, { code: SC.G, label: "G" }, { code: SC.H, label: "H" },
    { code: SC.J, label: "J" }, { code: SC.K, label: "K" }, { code: SC.L, label: "L" },
    { code: SC.SEMICOLON, label: ";" }, { code: SC.QUOTE, label: "'" },
    { code: SC.ENTER, label: "⏎", flex: 2.25 },
  ],
  // Row 4: Shift + Z..M + , . / + UP
  [
    { code: SC.SHIFT, label: "Shift", flex: 2.25, modifier: true },
    { code: SC.Z, label: "Z" }, { code: SC.X, label: "X" }, { code: SC.C, label: "C" },
    { code: SC.V, label: "V" }, { code: SC.B, label: "B" }, { code: SC.N, label: "N" },
    { code: SC.M, label: "M" },
    { code: SC.COMMA, label: "," }, { code: SC.PERIOD, label: "." }, { code: SC.SLASH, label: "/" },
    { code: SC.UP, label: "↑", flex: 1.5 },
  ],
  // Row 5: Ctrl Alt Space Alt + arrows
  [
    { code: SC.CTRL, label: "Ctrl", flex: 1.5, modifier: true },
    { code: SC.ALT, label: "Alt", flex: 1.25, modifier: true },
    { code: SC.SPACE, label: "Space", flex: 6 },
    { code: SC.ALT, label: "Alt", flex: 1.25, modifier: true },
    { code: SC.LEFT, label: "←" }, { code: SC.DOWN, label: "↓" }, { code: SC.RIGHT, label: "→" },
  ],
  // Row 6: F1..F10
  [
    { code: SC.F1, label: "F1" }, { code: SC.F2, label: "F2" }, { code: SC.F3, label: "F3" },
    { code: SC.F4, label: "F4" }, { code: SC.F5, label: "F5" }, { code: SC.F6, label: "F6" },
    { code: SC.F7, label: "F7" }, { code: SC.F8, label: "F8" }, { code: SC.F9, label: "F9" },
    { code: SC.F10, label: "F10" },
  ],
];

export function VirtualKeyboard({ onKeyDown, onKeyUp }: VirtualKeyboardProps) {
  // Refs hold the authoritative state for emit dedup (synchronous mutation).
  // setRender bumps a counter to trigger re-render after each mutation.
  // We can't use useState here: setState is async, so two pointer events
  // firing before React re-renders would both pass the "has(id)" guard and
  // each call onKeyDown — sending duplicate scancodes to DOSBox.
  const pressedRef = useRef<Set<string>>(new Set());
  const stickyModsRef = useRef<Set<number>>(new Set());
  const [, setRender] = useReducer((x: number) => x + 1, 0);

  const handleDown = useCallback((id: string, k: KeyDef) => {
    if (k.modifier) {
      const mods = stickyModsRef.current;
      if (mods.has(k.code)) {
        mods.delete(k.code);
        onKeyUp(k.code);
      } else {
        mods.add(k.code);
        onKeyDown(k.code);
      }
      setRender();
      return;
    }
    const pressed = pressedRef.current;
    if (pressed.has(id)) return;
    pressed.add(id);
    onKeyDown(k.code);
    setRender();
  }, [onKeyDown, onKeyUp]);

  const handleUp = useCallback((id: string, k: KeyDef) => {
    if (k.modifier) return;
    const pressed = pressedRef.current;
    if (!pressed.has(id)) return; // already released by pointerLeave/cancel
    pressed.delete(id);
    onKeyUp(k.code);
    // After a non-modifier release, clear any sticky modifiers.
    const mods = stickyModsRef.current;
    if (mods.size > 0) {
      for (const m of mods) onKeyUp(m);
      mods.clear();
    }
    setRender();
  }, [onKeyUp]);

  return (
    <div className="vkb" role="group" aria-label="DOS 가상 키보드">
      {ROWS.map((row, ri) => (
        <div className="vkb-row" key={ri}>
          {row.map((k, ki) => {
            const id = `${ri}-${ki}`;
            // For modifier keys, the same scancode may appear in multiple cells
            // (e.g. left- and right-Alt both map to SC.ALT). The shared latch
            // state means both cells light up together — intentional.
            const isPressed = k.modifier
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
                  (k.modifier ? " vkb-key--mod" : "")
                }
                style={{ flexGrow: k.flex ?? 1 }}
                onPointerDown={(e) => { e.preventDefault(); handleDown(id, k); }}
                onPointerUp={(e) => { e.preventDefault(); handleUp(id, k); }}
                onPointerCancel={() => handleUp(id, k)}
                onPointerLeave={(e) => { if (e.buttons !== 0) handleUp(id, k); }}
                onContextMenu={(e) => e.preventDefault()}
              >
                {k.label}
              </button>
            );
          })}
        </div>
      ))}
    </div>
  );
}
