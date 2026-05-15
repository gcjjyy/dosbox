// app/lib/dos-keymap.ts
//
// KeyboardEvent.code → USB HID usage code (SDL2 scancode) lookup.
// emulators(.dosboxXDirect → CommandInterface).sendKeyEvent and
// simulateKeyPress take these numeric codes. Source: USB HID Usage
// Tables 1.12, "Keyboard / Keypad Page" — values match SDL2 SDL_Scancode.

export const keymap: Readonly<Record<string, number>> = {
  // Letters
  KeyA: 4, KeyB: 5, KeyC: 6, KeyD: 7, KeyE: 8, KeyF: 9, KeyG: 10,
  KeyH: 11, KeyI: 12, KeyJ: 13, KeyK: 14, KeyL: 15, KeyM: 16, KeyN: 17,
  KeyO: 18, KeyP: 19, KeyQ: 20, KeyR: 21, KeyS: 22, KeyT: 23, KeyU: 24,
  KeyV: 25, KeyW: 26, KeyX: 27, KeyY: 28, KeyZ: 29,

  // Top-row digits
  Digit1: 30, Digit2: 31, Digit3: 32, Digit4: 33, Digit5: 34,
  Digit6: 35, Digit7: 36, Digit8: 37, Digit9: 38, Digit0: 39,

  // Control keys
  Enter: 40, Escape: 41, Backspace: 42, Tab: 43, Space: 44,

  // Punctuation
  Minus: 45, Equal: 46,
  BracketLeft: 47, BracketRight: 48, Backslash: 49,
  Semicolon: 51, Quote: 52, Backquote: 53,
  Comma: 54, Period: 55, Slash: 56, CapsLock: 57,

  // Function keys
  F1: 58, F2: 59, F3: 60, F4: 61, F5: 62, F6: 63, F7: 64,
  F8: 65, F9: 66, F10: 67, F11: 68, F12: 69,

  // Navigation
  PrintScreen: 70, ScrollLock: 71, Pause: 72,
  Insert: 73, Home: 74, PageUp: 75, Delete: 76, End: 77, PageDown: 78,
  ArrowRight: 79, ArrowLeft: 80, ArrowDown: 81, ArrowUp: 82,

  // Numpad
  NumLock: 83, NumpadDivide: 84, NumpadMultiply: 85,
  NumpadSubtract: 86, NumpadAdd: 87, NumpadEnter: 88,
  Numpad1: 89, Numpad2: 90, Numpad3: 91, Numpad4: 92, Numpad5: 93,
  Numpad6: 94, Numpad7: 95, Numpad8: 96, Numpad9: 97, Numpad0: 98,
  NumpadDecimal: 99,

  // Modifiers
  ControlLeft: 224, ShiftLeft: 225, AltLeft: 226, MetaLeft: 227,
  ControlRight: 228, ShiftRight: 229, AltRight: 230, MetaRight: 231,
};

// Scancode constants used by the virtual keyboard.
export const SC = {
  ESC: 41, BS: 42, TAB: 43, ENTER: 40, SPACE: 44,
  SHIFT: 225, CTRL: 224, ALT: 226,
  UP: 82, DOWN: 81, LEFT: 80, RIGHT: 79,
  A: 4, B: 5, C: 6, D: 7, E: 8, F: 9, G: 10, H: 11, I: 12, J: 13,
  K: 14, L: 15, M: 16, N: 17, O: 18, P: 19, Q: 20, R: 21, S: 22,
  T: 23, U: 24, V: 25, W: 26, X: 27, Y: 28, Z: 29,
  D0: 39, D1: 30, D2: 31, D3: 32, D4: 33, D5: 34, D6: 35, D7: 36, D8: 37, D9: 38,
  MINUS: 45, EQUAL: 46,
  LBRACKET: 47, RBRACKET: 48, BACKSLASH: 49,
  SEMICOLON: 51, QUOTE: 52, COMMA: 54, PERIOD: 55, SLASH: 56,
  F1: 58, F2: 59, F3: 60, F4: 61, F5: 62, F6: 63, F7: 64, F8: 65, F9: 66, F10: 67,
} as const;
