# BootScreen Wordmark Implementation Plan

> Single-task plan — change is small enough to ship in one commit.

**Goal**: Replace `dosbox.gcjjyy.dev` wordmark with `DOSBOX_` (blinking cursor matching toolbar) and strip footer to `v{version}`.

**Spec**: `docs/superpowers/specs/2026-05-17-bootscreen-wordmark-design.md`

---

## Task: BootScreen wordmark + footer changes

**Files:**
- Modify: `app/components/BootScreen.tsx`
- Modify: `app/app.css`

- [ ] **Step 1: Modify `BootScreen.tsx`**

In `app/components/BootScreen.tsx`, replace line 46:

```tsx
<p className="boot-wordmark">dosbox.gcjjyy.dev</p>
```

with

```tsx
<p className="boot-wordmark">
  <span className="boot-wordmark__name">DOSBOX</span>
  <span className="boot-wordmark__cursor" aria-hidden="true">_</span>
</p>
```

And replace the footer span (line 53):

```tsx
<span>v{version} · korean ms-dos preservation</span>
```

with

```tsx
<span>v{version}</span>
```

- [ ] **Step 2: Modify `app/app.css`**

Locate the `.boot-wordmark` rule (line ~136). Replace the entire rule with the three rules below — `.boot-wordmark` becomes a container, its old text styling moves onto `.boot-wordmark__name`, and `.boot-wordmark__cursor` reuses the toolbar's `brand-blink` keyframe (defined later in the same file, lines ~215-218):

```css
.boot-wordmark {
  display: inline-flex;
  align-items: baseline;
  gap: 1px;
  user-select: none;
}
.boot-wordmark__name {
  font-family: var(--font-mono);
  font-size: 13px;
  font-weight: 500;
  letter-spacing: 0.18em;
  color: var(--color-navy-text);
}
.boot-wordmark__cursor {
  font-family: var(--font-mono);
  font-size: 13px;
  font-weight: 500;
  color: var(--color-navy-accent);
  animation: brand-blink 1.08s steps(1, end) infinite;
}
```

The dropped `text-transform: lowercase` is intentional — the new wordmark is uppercase.

- [ ] **Step 3: Typecheck**

```bash
npm run typecheck
```

Expected: clean.

- [ ] **Step 4: Patch-bump `package.json`**

Increment patch: `1.0.26` → `1.0.27`. (Pre-commit hook is shadowed per repo memory.)

- [ ] **Step 5: Commit**

```bash
git add app/components/BootScreen.tsx app/app.css package.json
git commit -m "feat(ui): BootScreen wordmark = DOSBOX_ (toolbar parity); drop footer tagline"
```

- [ ] **Step 6: Push and deploy**

```bash
git push origin main

sshpass -p '<password>' ssh pcnhost \
  'cd ~/lab/dosbox && git pull --ff-only origin main && npm run build && pm2 restart dosbox && pm2 status dosbox'
```

Expected: pm2 shows `dosbox` version `1.0.27`, status online.

- [ ] **Step 7: Visual smoke test**

Reload the production URL in browser, hard-refresh. On the loading overlay verify:
- Wordmark reads `DOSBOX` (uppercase) with a blinking underscore (accent color) to its right.
- Footer reads only the blue dot + `v1.0.27` (no tagline).
- Phase status line (`에뮬레이터 준비 중` etc.) unchanged.
