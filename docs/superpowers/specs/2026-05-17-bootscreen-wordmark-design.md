# BootScreen Wordmark & Footer Rebrand

**Date**: 2026-05-17
**Status**: Approved
**Touches**: `app/components/BootScreen.tsx`, `app/app.css`

## Problem

After the recent toolbar rebrand (commit `3228f14`), the toolbar shows `DOSBOX_` with a blinking cursor, but the boot loading screen still reads `dosbox.gcjjyy.dev` as its wordmark. The footer line `v{version} · korean ms-dos preservation` also reads as filler — the tagline doesn't earn its space.

## Goal

Match the toolbar's branding on the boot screen and strip the footer back to just the version.

## Design

### Wordmark (`BootScreen.tsx`)

Replace
```tsx
<p className="boot-wordmark">dosbox.gcjjyy.dev</p>
```
with the same `name + cursor` split the toolbar uses:
```tsx
<p className="boot-wordmark">
  <span className="boot-wordmark__name">DOSBOX</span>
  <span className="boot-wordmark__cursor" aria-hidden="true">_</span>
</p>
```

### Wordmark CSS (`app.css`)

`.boot-wordmark` becomes an inline-flex container; its current font/letter-spacing/color rules move down onto `.boot-wordmark__name`. The underscore cursor reuses the toolbar's existing `brand-blink` keyframe.

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

`text-transform: lowercase` from the old rule is dropped — the new wordmark is uppercase `DOSBOX`.

### Footer (`BootScreen.tsx`)

```tsx
// before
<span>v{version} · korean ms-dos preservation</span>
// after
<span>v{version}</span>
```

The blue accent dot (`.boot-footer__dot`) and the surrounding `.boot-footer` styles stay — only the trailing copy is removed.

## Non-goals

- No CSS structure change beyond what's listed above.
- No removal of the boot footer dot or its absolute positioning.
- No new animation — just reuse the existing `brand-blink`.
- No font-size adjustment on the wordmark; 13px stays.

## Risks

None meaningful. Worst case is the blink rhythm looks off against the bigger wordmark sizing — easy to tune the keyframe duration if so.
