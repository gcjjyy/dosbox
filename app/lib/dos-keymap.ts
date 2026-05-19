// app/lib/dos-keymap.ts
//
// KeyboardEvent.code → js-dos / emulators keycode lookup.
//
// IMPORTANT: emulators' CommandInterface.sendKeyEvent / simulateKeyPress
// expect GLFW-style keycodes — NOT SDL2 scancodes / USB HID usage IDs.
// (E.g. 'A' is 65 here, not 4; Enter is 257, not 40; Space is 32, not 44;
// ArrowUp is 265, not 82.) The constants below are taken directly from the
// KBD_* table in node_modules/js-dos/dist/js-dos.js. Right-side modifiers
// match GLFW's 344/345/346 range; left-side modifiers match GLFW's 340-342.

export const keymap: Readonly<Record<string, number>> = {
  // Letters (uppercase ASCII)
  KeyA: 65, KeyB: 66, KeyC: 67, KeyD: 68, KeyE: 69, KeyF: 70, KeyG: 71,
  KeyH: 72, KeyI: 73, KeyJ: 74, KeyK: 75, KeyL: 76, KeyM: 77, KeyN: 78,
  KeyO: 79, KeyP: 80, KeyQ: 81, KeyR: 82, KeyS: 83, KeyT: 84, KeyU: 85,
  KeyV: 86, KeyW: 87, KeyX: 88, KeyY: 89, KeyZ: 90,

  // Top-row digits (ASCII)
  Digit0: 48, Digit1: 49, Digit2: 50, Digit3: 51, Digit4: 52,
  Digit5: 53, Digit6: 54, Digit7: 55, Digit8: 56, Digit9: 57,

  // Punctuation
  Space: 32,
  Quote: 39,           // '
  Comma: 44,           // ,
  Minus: 45,           // -
  Period: 46,          // .
  Slash: 47,           // /
  Semicolon: 59,       // ;
  Equal: 61,           // =
  BracketLeft: 91,     // [
  Backslash: 92,       // \
  BracketRight: 93,    // ]
  Backquote: 96,       // `

  // Control / editing
  Escape: 256,
  Enter: 257,
  Tab: 258,
  Backspace: 259,
  Insert: 260,
  Delete: 261,

  // Navigation
  ArrowRight: 262,
  ArrowLeft: 263,
  ArrowDown: 264,
  ArrowUp: 265,
  PageUp: 266,
  PageDown: 267,
  Home: 268,
  End: 269,

  // Locks / system
  CapsLock: 280,
  ScrollLock: 281,
  NumLock: 282,
  PrintScreen: 283,
  Pause: 284,

  // Function keys
  F1: 290, F2: 291, F3: 292, F4: 293, F5: 294, F6: 295, F7: 296,
  F8: 297, F9: 298, F10: 299, F11: 300, F12: 301,

  // Numpad
  Numpad0: 320, Numpad1: 321, Numpad2: 322, Numpad3: 323, Numpad4: 324,
  Numpad5: 325, Numpad6: 326, Numpad7: 327, Numpad8: 328, Numpad9: 329,
  NumpadDecimal: 330,
  NumpadDivide: 331,
  NumpadMultiply: 332,
  NumpadSubtract: 333,
  NumpadAdd: 334,
  NumpadEnter: 335,

  // Modifiers (GLFW left = 340-342, right = 344-346)
  ShiftLeft: 340, ControlLeft: 341, AltLeft: 342,
  ShiftRight: 344, ControlRight: 345, AltRight: 346,
};

// Scancode constants used by the virtual keyboard.
export const SC = {
  ESC: 256, BS: 259, TAB: 258, ENTER: 257, SPACE: 32, CAPSLOCK: 280,
  SHIFT: 340, CTRL: 341, ALT: 342,
  UP: 265, DOWN: 264, LEFT: 263, RIGHT: 262,
  A: 65, B: 66, C: 67, D: 68, E: 69, F: 70, G: 71, H: 72, I: 73, J: 74,
  K: 75, L: 76, M: 77, N: 78, O: 79, P: 80, Q: 81, R: 82, S: 83,
  T: 84, U: 85, V: 86, W: 87, X: 88, Y: 89, Z: 90,
  D0: 48, D1: 49, D2: 50, D3: 51, D4: 52, D5: 53, D6: 54, D7: 55, D8: 56, D9: 57,
  MINUS: 45, EQUAL: 61, GRAVE: 96,
  LBRACKET: 91, RBRACKET: 93, BACKSLASH: 92,
  SEMICOLON: 59, QUOTE: 39, COMMA: 44, PERIOD: 46, SLASH: 47,
  F1: 290, F2: 291, F3: 292, F4: 293, F5: 294, F6: 295, F7: 296, F8: 297, F9: 298, F10: 299,
  F11: 300, F12: 301,
} as const;

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

// 두벌식 (Dubeolsik / "two-set") Korean jamo positions on a standard
// US QWERTY keyboard. Used by VirtualKeyboard to render the dual-label
// (English upper-left, jamo lower-right) on letter keys. Scancodes are
// unchanged — DOS still receives A/B/C etc. and any DOS-side IME
// (e.g. 한글 도깨비) controls the actual input mode.
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
