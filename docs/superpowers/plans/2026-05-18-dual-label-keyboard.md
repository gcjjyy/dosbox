# Dual-label Virtual Keyboard Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remove the 한/영 toggle from `VirtualKeyboard` and always display the 두벌식 jamo in the lower-right corner of each letter key (English label stays in the upper-left).

**Architecture:** Single-component edit — `VirtualKeyboard.tsx` drops `language` state / `renderLangButton` and lets `renderCell` emit two absolutely-positioned spans whenever `HANGUL_LABELS[k.code]` exists. CSS gets two new selectors (`.vkb-key__en`, `.vkb-key__ko`) and three obsolete selectors removed (`.vkb-lang-btn`, `.vkb-lang-btn--active`, `.vkb-tab--spacer`). No DOS-side change; scancodes are still GLFW English codes.

**Tech Stack:** React 19, TypeScript, plain CSS (`app/app.css`), vitest (node env, no RTL).

**Spec:** `docs/superpowers/specs/2026-05-18-dual-label-keyboard-design.md`

---

## File Map

- Modify: `app/components/VirtualKeyboard.tsx` (component + comment block)
- Modify: `app/app.css` (add two selectors, remove three obsolete ones)
- No new files; no test file change (`app/lib/dos-keymap.test.ts` only validates HANGUL_LABELS structure)

---

## Task 1: Strip `한/영` toggle from `VirtualKeyboard.tsx` and add dual-label rendering

**Files:**
- Modify: `app/components/VirtualKeyboard.tsx`

- [ ] **Step 1: Replace the top-of-file comment block**

Find the existing block at the top of `app/components/VirtualKeyboard.tsx` (lines 1-22, ends just before the `import` statement). Replace the entire block with:

```ts
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
```

- [ ] **Step 2: Remove the `Language` type alias**

Delete this line (currently around line 42):

```ts
type Language = "en" | "ko";
```

- [ ] **Step 3: Remove `language` state and `resolveLabel` helper**

Inside the `VirtualKeyboard` function, delete:

```ts
const [language, setLanguage] = useState<Language>("en");
```

…and the entire `resolveLabel` helper (currently lines 268-277):

```ts
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
```

- [ ] **Step 4: Rewrite the button body in `renderCell` to emit dual spans for letter keys**

Inside `renderCell`, find the `<button …>{resolveLabel(k)}</button>` block. Replace the button's children (and the surrounding button) so it looks like:

```tsx
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
```

Note: the only behavioural change is the button body (`hangul ? … : k.label`). All event handlers, classes, and `style` are unchanged from the current implementation. `HANGUL_LABELS` is already imported at the top — keep it.

- [ ] **Step 5: Delete `renderLangButton` entirely**

Remove the function (currently lines 333-350):

```ts
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
```

- [ ] **Step 6: Trim the mobile tab bar (drop spacer + lang button)**

Inside the `if (isMobile) { return (…) }` branch, the current JSX is:

```tsx
<div className="vkb-tabbar">
  {(["abc", "123", "fn"] as const).map((p) => (
    <button …>{p === "abc" ? "ABC" : p === "123" ? "123" : "FN"}</button>
  ))}
  <div className="vkb-tab vkb-tab--spacer" aria-hidden="true" />
  {renderLangButton("vkb-tab")}
</div>
```

Replace it with (only the spacer and `renderLangButton` lines go):

```tsx
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
```

`.vkb-tab` already has `flex: 1 1 0`, so three tabs automatically split the bar in thirds.

- [ ] **Step 7: Remove the absolute-positioned 한/영 button from the desktop branch**

Right before `{DESKTOP_ROWS.map(…)}`, delete this line:

```tsx
{renderLangButton("vkb-lang-btn")}
```

Also remove the now-stale comment immediately above the desktop `return`:

```ts
// Desktop: original 6 rows with CapsLock substitution + BS/ENT labels
// + absolute-positioned 한/영 button.
```

Replace with:

```ts
// Desktop: original 6 rows with CapsLock substitution + BS/ENT labels.
```

- [ ] **Step 8: Run typecheck to verify nothing else references the removed symbols**

Run: `npm run typecheck`
Expected: PASS with no errors. (If you see `Cannot find name 'language'`, `Cannot find name 'setLanguage'`, or `Cannot find name 'renderLangButton'`, you missed one of the removals above — search the file and delete it.)

- [ ] **Step 9: Run vitest to confirm no test regression**

Run: `npm run test`
Expected: PASS. (`dos-keymap.test.ts` only validates `HANGUL_LABELS` and `SC.CAPSLOCK`; neither changed.)

---

## Task 2: Update `app/app.css` — add dual-label selectors, drop obsolete ones

**Files:**
- Modify: `app/app.css`

- [ ] **Step 1: Add `position: relative` to `.vkb-key`**

Find the `.vkb-key { … }` block (currently starts at line 504). The first declaration is `flex: 1 1 0;`. Add `position: relative;` as a new first line so the block becomes:

```css
.vkb-key {
  position: relative;
  flex: 1 1 0;
  min-width: 0;
  min-height: 48px;     /* matches natural cell width at vkb max-width 820 — keeps letter keys ≈1:1 */
  padding: 6px 0;
  /* …rest unchanged… */
}
```

- [ ] **Step 2: Add `.vkb-key__en` and `.vkb-key__ko` selectors**

Immediately after the `.vkb-key { … }` block closes (before the `@media (hover: hover)` block), add:

```css
.vkb-key__en {
  position: absolute;
  top: 4px;
  left: 6px;
  font-size: 0.85em;
  line-height: 1;
  pointer-events: none;
}
.vkb-key__ko {
  position: absolute;
  bottom: 4px;
  right: 6px;
  font-size: 0.85em;
  line-height: 1;
  pointer-events: none;
}
```

- [ ] **Step 3: Delete `.vkb-tab--spacer`**

Find and remove the entire block (currently lines 454-461):

```css
.vkb-tab--spacer {
  flex-grow: 6;
  visibility: hidden;
  cursor: default;
  border: none;
  background: none;
  padding: 0;
}
```

- [ ] **Step 4: Delete `.vkb-lang-btn` and `.vkb-lang-btn--active`**

Find and remove the entire two-block region (currently lines 470-492, including the `/* Desktop-only absolute-positioned 한/영 button (above F12) */` comment):

```css
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

- [ ] **Step 5: Sanity-grep to confirm obsolete selectors are gone**

Run: `grep -n "vkb-lang\|vkb-tab--spacer" app/app.css app/components/VirtualKeyboard.tsx`
Expected: no output. (Any remaining match means a previous step missed something — fix it before moving on.)

- [ ] **Step 6: Run the build to catch any CSS / TSX integration issue**

Run: `npm run build`
Expected: PASS — `react-router build` completes without errors.

---

## Task 3: Commit and deploy

**Files:** none (commit + deploy only)

- [ ] **Step 1: Stage and commit**

Run:

```bash
git add app/components/VirtualKeyboard.tsx app/app.css \
        docs/superpowers/plans/2026-05-18-dual-label-keyboard.md
git commit -m "$(cat <<'EOF'
feat(ui): dual-label keys (영문 좌상 + 두벌식 우하), drop 한/영 toggle

VirtualKeyboard now always shows the 두벌식 jamo alongside the English
letter on Q-M keys. Removes the language state, renderLangButton, the
mobile tab-bar spacer, and the desktop absolute-positioned button.
Scancodes unchanged — DOS-side IME still controls input mode.
EOF
)"
```

Expected: pre-commit hook prints `[pre-commit] version → 1.0.31` (or whatever the next patch is) and the commit succeeds.

- [ ] **Step 2: Push**

Run: `git push origin main`
Expected: push succeeds.

- [ ] **Step 3: Deploy to pcnhost**

Follow the procedure in `~/.claude/projects/-Users-gcjjyy-dosbox/memory/reference_dosbox_deploy.md`:

```bash
sshpass -p '<password>' ssh pcnhost \
  'cd ~/dosbox && git pull --ff-only origin main && npm run build && pm2 restart dosbox && pm2 status dosbox'
```

Expected: `pm2 status dosbox` shows `online` with the new version.

- [ ] **Step 4: Manual visual verification**

Hard-refresh the browser at `https://dosbox.gcjjyy.dev` and confirm:
1. **Desktop (>640px):** 6-row keyboard renders; each letter key Q-M shows the English letter in the upper-left and the matching jamo (`ㅂ ㅈ ㄷ …`) in the lower-right. No 한/영 toggle button anywhere. Digits, F-keys, punctuation, modifiers, arrows look unchanged.
2. **Mobile (≤640px):** Tab bar shows exactly three tabs (`ABC | 123 | FN`) evenly distributed across the full width. On the ABC page, letter keys carry dual labels. On 123 and FN pages, layout matches the existing design.
3. **DOS input:** Type a letter (e.g. `Q`) on the virtual keyboard and confirm DOS receives `Q` (still English — no IME involved on the JS side).

If dual labels look cramped on small phones, the only knobs are `font-size` (currently `0.85em`) and the corner insets (`4px / 6px`) in `app/app.css`. Tune one, redeploy, retest.

---

## Self-Review

Spec coverage check:
- "토글 제거 (state, helper, JSX, CSS)" → Task 1 Steps 2-7, Task 2 Steps 3-4. ✓
- "letter 키 대각선 dual label" → Task 1 Step 4 (JSX), Task 2 Step 2 (CSS). ✓
- "비-letter 키 변화 없음" → Task 1 Step 4's `hangul ? … : k.label` fallback covers this. ✓
- "탭바 3개 균등 분배" → Task 1 Step 6 + existing `.vkb-tab { flex: 1 1 0 }` (Task 2 doesn't need to touch it). ✓
- "상단 주석 블록 교체" → Task 1 Step 1. ✓
- "수동 검증 항목 1-4" → Task 3 Step 4. ✓
- "rollout: 단일 커밋, pre-commit bump, pcnhost 배포" → Task 3 Steps 1-3. ✓

No placeholders, no `TBD`, every code step has full code blocks, every command has expected output. Symbol names (`HANGUL_LABELS`, `.vkb-key__en`, `.vkb-key__ko`, `vkb-tab--spacer`, `vkb-lang-btn`) are consistent between Task 1 and Task 2.
