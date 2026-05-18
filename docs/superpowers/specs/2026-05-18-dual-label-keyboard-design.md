# Dual-label Virtual Keyboard (한/영 토글 제거)

**Date:** 2026-05-18
**Scope:** `app/components/VirtualKeyboard.tsx`, `app/app.css`
**Related:** `2026-05-17-mobile-keyboard-redesign-design.md` (이 디자인이 도입한 한/영 토글을 본 디자인이 폐기한다)

## Background

2026-05-17 모바일 키보드 개편에서 모바일 탭바 끝과 데스크탑 우상단에 `한/영` 토글 버튼을 추가했다. 토글은 시각 전용 — Q-M letter 키의 라벨을 영문과 두벌식 자모 사이에서 교체했고 scancode는 그대로였다. 실사용 결과 토글은 불필요했다. 실제 한글 키보드처럼 두 글자를 항상 같은 키에 인쇄하는 편이 직관적이고, 토글 조작 한 단계가 사라진다.

## Goal

`한/영` 토글을 제거하고, letter 키에 영문자와 두벌식 자모를 동시에 표시한다. 데스크탑·모바일 모두 동일.

## Non-goals

- DOS로 보내는 scancode 변경 — 여전히 GLFW 영문 코드만 전송. DOS 측 IME(한글 도깨비 등)가 실제 입력 모드를 제어.
- Shift 상태에 따른 라벨 변경(예: 1 → !) — 비letter 키는 손대지 않는다.
- HANGUL_LABELS 테이블 변경 — 그대로 재사용.

## Visual layout

대각선 배치. 영문자는 좌상단, 한글 자모는 우하단. 두 라벨 모두 동일한 폰트 크기·색상 가중치(어느 한쪽이 primary가 아님).

```
┌─────────┐
│ Q       │
│       ㅂ │
└─────────┘
```

- 영문/한글 인셋: `top/left 4px / 6px`, `bottom/right 4px / 6px`
- 폰트 크기: `0.85em` (키 본문 폰트 기준)
- 작은 모바일 키(≈10vw)에서도 두 코너가 충돌하지 않음. 시각적 hit-area는 그대로(라벨이 `position: absolute`이므로 버튼 클릭 영역에 영향 없음).

## Component changes — `app/components/VirtualKeyboard.tsx`

### 제거

- `type Language = "en" | "ko";`
- `language` state (`useState<Language>("en")`)
- `setLanguage` 핸들러
- `renderLangButton()` 함수 전체
- 모바일 탭바의 `<div className="vkb-tab vkb-tab--spacer" />` 와 `{renderLangButton("vkb-tab")}` 호출
- 데스크탑 wrapper 첫줄의 `{renderLangButton("vkb-lang-btn")}`
- `resolveLabel()` 헬퍼(호출처가 renderCell 하나뿐이라 인라인화)

### 변경

`renderCell`은 letter 키(HANGUL_LABELS에 코드가 등록된 키)는 dual span으로, 그 외는 단일 텍스트로 렌더한다:

```tsx
const hangul = HANGUL_LABELS[k.code];
// ...
<button ...>
  {hangul ? (
    <>
      <span className="vkb-key__en">{k.label}</span>
      <span className="vkb-key__ko">{hangul}</span>
    </>
  ) : (
    k.label
  )}
</button>
```

import에서 `HANGUL_LABELS`는 유지(직접 사용). `SC`도 그대로.

### 상단 주석 블록

기존:
> 한/영 toggle is presentation-only: it swaps Q-M letter labels between English and 두벌식 jamo (from HANGUL_LABELS). Scancodes are unchanged — DOS still receives A/B/C etc.

신규:
> Letter 키에는 영문자(좌상)와 두벌식 자모(우하)가 항상 함께 표시된다. Scancode는 영문 그대로 — DOS 측 IME가 실제 입력 모드를 제어한다.

모바일 탭바 설명도 `한/영` 언급 제거 → "ABC/123/FN 3개 탭 균등 분배".

## CSS changes — `app/app.css`

### 추가

```css
.vkb-key {
  position: relative;        /* 기존에 없으면 추가 */
}
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

`pointer-events: none`은 dual span이 버튼 클릭/포인터 이벤트를 가로채지 않게 한다.

### 제거

- `.vkb-lang-btn`
- `.vkb-lang-btn--active`
- `.vkb-tab--spacer` (탭바에서 spacer 셀이 사라지므로 더 이상 참조 없음)

### 영향 확인 항목

- `.vkb-key`가 이미 `position: relative`이면 추가 선언은 no-op.
- `.vkb-tab`은 모바일 탭바에서 3개 탭만 남음. `flex: 1` 균등 분배가 자연스럽게 작동(기존 설정 유지).
- 데스크탑 wrapper의 absolute 위치 button 제거 후 잔여 여백 없음.

## Behavior — non-letter 키

`HANGUL_LABELS`에 등록되지 않은 키(digits 0-9, F1-F12, 모디파이어, 화살표, BS/ENT/Tab/Space/Esc, 구두점) 는 기존 단일 텍스트 렌더링 유지. 대각선 마크업은 letter 키 26개에만 적용된다.

## Test impact

- `app/lib/dos-keymap.test.ts` — `HANGUL_LABELS` 구조 검증만 하므로 변경 없음.
- 컴포넌트 테스트 없음(node env vitest, RTL 미설치) — 수동 검증으로 진행.

## Manual verification

배포 후:

1. 데스크탑(>640px): 6행 키보드에서 letter 키 26개가 영문 좌상 + 한글 우하로 표시되는지. 우상단에 잔여 토글 버튼 없는지.
2. 모바일(≤640px): 탭바가 `ABC | 123 | FN` 3개만 균등 분배되는지. ABC 페이지 letter 키에 dual label 표시되는지.
3. DOS 입력 시 영문 그대로 들어가는지(scancode 변경 없음 확인).
4. 작은 모바일 키에서 두 라벨이 가독성 있는지(인셋 4px/6px·폰트 0.85em이 충분한지). 부족하면 인셋·폰트만 미세 조정.

## Rollout

- 단일 커밋: VirtualKeyboard.tsx + app.css + 상단 주석.
- pre-commit hook이 patch 버전 자동 bump.
- 푸시 후 `pcnhost` 재배포(deploy 메모리 절차 참조).
