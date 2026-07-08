type KeyboardEventLike = Pick<KeyboardEvent, "key" | "code" | "keyCode" | "which">;

const SDL_LEFT_CTRL = 1248;
const SDL_LEFT_SHIFT = 1249;
const SDL_LEFT_ALT = 1250;
const SDL_RIGHT_CTRL = 1252;
const SDL_RIGHT_SHIFT = 1253;
const SDL_RIGHT_ALT = 1254;

const SDL_SPECIAL: Readonly<Record<number, number>> = {
  256: 27,
  257: 13,
  258: 9,
  259: 8,
  260: 1097,
  261: 127,
  262: 1103,
  263: 1104,
  264: 1105,
  265: 1106,
  266: 1099,
  267: 1102,
  268: 1098,
  269: 1101,
  280: 1081,
  282: 1107,
  340: SDL_LEFT_SHIFT,
  341: SDL_LEFT_CTRL,
  342: SDL_LEFT_ALT,
  344: SDL_RIGHT_SHIFT,
  345: SDL_RIGHT_CTRL,
  346: SDL_RIGHT_ALT,
};

const SDL_NUMPAD_DIGITS = [
  1122,
  1113,
  1114,
  1115,
  1116,
  1117,
  1118,
  1119,
  1120,
  1121,
] as const;

const SDL_NUMPAD: Readonly<Record<number, number>> = {
  330: 1123,
  331: 1108,
  332: 1109,
  333: 1110,
  334: 1111,
  335: 13,
};

export function toSDLKeyCode(code: number): number | null {
  if (code >= 65 && code <= 90) return code + 32;
  if (code >= 32 && code <= 126) return code;
  if (code >= 290 && code <= 301) return 1082 + (code - 290);
  if (code >= 320 && code <= 329) return SDL_NUMPAD_DIGITS[code - 320];
  return SDL_SPECIAL[code] ?? SDL_NUMPAD[code] ?? null;
}

export function recoverSDLKeyCodeFromBrokenAsciiEvent(event: KeyboardEventLike): number | null {
  const keyCode = event.keyCode || event.which || 0;
  const code = event.code ?? "";
  const hasBrokenIdentity = keyCode === 229 || event.which === 229 || code === "" || code === "Unidentified";
  if (!hasBrokenIdentity || event.key.length !== 1) return null;

  let charCode = event.key.charCodeAt(0);
  if (charCode >= 65 && charCode <= 90) charCode += 32;
  if (charCode < 32 || charCode > 126) return null;
  return charCode;
}
