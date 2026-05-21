# CPU Cycles 런타임 조절 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** DOS CPU 속도를 486DX2-66 상당(`fixed 23880`)으로 고정하고, Toolbar의 −/+ 버튼으로 실행 중 cycles를 조절할 수 있게 한다.

**Architecture:** 공유 상수 모듈(`cpu-cycles.ts`)이 서버 conf와 클라이언트 표시값을 동기화. 조절은 `ci.sendBackendEvent({type:"wc-trigger-event", event:...})`로 dosbox-x mapper 핸들러를 직접 트리거. 현재값은 클라이언트가 시작값에서 클릭 스텝을 누적 추적(설정 getter 부재).

**Tech Stack:** React Router v7, TypeScript strict, Vitest(node env), js-dos v8 WASM 브릿지(emulators).

---

## File Structure

| 파일 | 역할 |
|---|---|
| `app/lib/cpu-cycles.ts` (신규) | 공유 상수(`DEFAULT_CYCLES`/`CYCLES_STEP`/`CYCLES_MIN`/`CYCLES_MAX`) + `clampCycles()` |
| `app/lib/cpu-cycles.test.ts` (신규) | clamp 경계 단위 테스트 |
| `app/lib/bundle.ts` (수정) | conf의 `cycles`/`cycleup`/`cycledown`을 상수 기반으로 |
| `app/lib/bundle.test.ts` (수정) | 생성된 conf 단언 |
| `app/lib/dos-emulator.ts` (수정) | `CommandInterface`에 `sendBackendEvent` 추가, `cyclesUp()`/`cyclesDown()` 메서드 |
| `app/routes/_index.tsx` (수정) | `cycles` state + 조절 콜백 + Toolbar 배선 |
| `app/components/Toolbar.tsx` (수정) | 현재값 표시 + −/+ 버튼 UI |

---

## Task 1: 공유 상수 모듈 + clampCycles

**Files:**
- Create: `app/lib/cpu-cycles.ts`
- Test: `app/lib/cpu-cycles.test.ts`

- [ ] **Step 1: Write the failing test**

`app/lib/cpu-cycles.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import {
  DEFAULT_CYCLES,
  CYCLES_STEP,
  CYCLES_MIN,
  CYCLES_MAX,
  clampCycles,
} from "./cpu-cycles";

describe("cpu-cycles", () => {
  it("exposes 486DX2-66 default and absolute step", () => {
    expect(DEFAULT_CYCLES).toBe(23880);
    expect(CYCLES_STEP).toBe(2000);
    expect(CYCLES_MIN).toBe(100);
    expect(CYCLES_MAX).toBe(100000);
  });

  it("clamps within [MIN, MAX]", () => {
    expect(clampCycles(50)).toBe(CYCLES_MIN);
    expect(clampCycles(999999)).toBe(CYCLES_MAX);
    expect(clampCycles(23880)).toBe(23880);
  });

  it("rounds and falls back to default on NaN", () => {
    expect(clampCycles(23880.7)).toBe(23881);
    expect(clampCycles(Number.NaN)).toBe(DEFAULT_CYCLES);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run app/lib/cpu-cycles.test.ts`
Expected: FAIL — `Cannot find module './cpu-cycles'`

- [ ] **Step 3: Write minimal implementation**

`app/lib/cpu-cycles.ts`:
```ts
// Shared CPU cycles constants. Imported by both the server bundle builder
// (bundle.ts) and the client toolbar so the dosbox.conf default and the
// displayed start value never drift apart.
//
// 23880 = "486DX4 100" is too hot; 486DX2-66 maps to ~23880 cycles in the
// DOSBox-X CPU settings guide. Step is an ABSOLUTE value (>=100) so dosbox
// and the client compute "1 click = +/-2000" identically.
export const DEFAULT_CYCLES = 23880;
export const CYCLES_STEP = 2000;
export const CYCLES_MIN = 100;
export const CYCLES_MAX = 100000;

export function clampCycles(n: number): number {
  if (Number.isNaN(n)) return DEFAULT_CYCLES;
  return Math.max(CYCLES_MIN, Math.min(CYCLES_MAX, Math.round(n)));
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run app/lib/cpu-cycles.test.ts`
Expected: PASS (3 tests)

- [ ] **Step 5: Commit**

```bash
git add app/lib/cpu-cycles.ts app/lib/cpu-cycles.test.ts
git commit -m "feat(cycles): shared CPU cycles constants + clamp"
```

---

## Task 2: bundle.ts conf를 상수 기반으로

**Files:**
- Modify: `app/lib/bundle.ts` (DOSBOX_CONF 배열, 상단 import)
- Test: `app/lib/bundle.test.ts`

> 참고: 현재 `bundle.ts`의 `[cpu]` 블록은 작업 중 임시로 `cputype=486_prefetch` / `cycles=fixed 33445`로 바뀌어 있을 수 있다. 이 태스크가 최종 상태로 덮어쓴다.

- [ ] **Step 1: Write the failing test**

`app/lib/bundle.test.ts`의 기존 `describe` 블록 안에 추가:
```ts
  it("pins cycles to 486DX2-66 with an absolute step", async () => {
    const { DOSBOX_CONF } = await import("./bundle");
    expect(DOSBOX_CONF).toContain("cycles=fixed 23880");
    expect(DOSBOX_CONF).toContain("cycleup=2000");
    expect(DOSBOX_CONF).toContain("cycledown=2000");
  });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run app/lib/bundle.test.ts -t "486DX2-66"`
Expected: FAIL — `DOSBOX_CONF` not exported (or string mismatch).

- [ ] **Step 3: Implement**

`app/lib/bundle.ts` 상단 import 구역에 추가:
```ts
import { DEFAULT_CYCLES, CYCLES_STEP } from "./cpu-cycles";
```

`DOSBOX_CONF` 정의를 `export const`로 바꾸고 `[cpu]` 블록을 아래로 교체:
```ts
export const DOSBOX_CONF = [
  "[dosbox]",
  "machine=svga_s3",
  "memsize=16",
  "",
  "[cpu]",
  "core=auto",
  "cputype=486_prefetch",
  // 486DX2-66 class. cycleup/cycledown are absolute (>=100) so a single
  // toolbar click is exactly +/-CYCLES_STEP, matching the client's tracker.
  `cycles=fixed ${DEFAULT_CYCLES}`,
  `cycleup=${CYCLES_STEP}`,
  `cycledown=${CYCLES_STEP}`,
  "",
  "[dos]",
  "xms=true",
  "ems=true",
  "umb=true",
  "keyboardlayout=auto",
  "",
  "[autoexec]",
  "@ECHO OFF",
  "mount c .",
  "c:",
  "IF EXIST AUTOEXEC.BAT CALL AUTOEXEC.BAT",
  "",
].join("\n");
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run app/lib/bundle.test.ts`
Expected: PASS (기존 테스트 + 새 테스트). conf 변경으로 ETag가 바뀌어 캐시 번들이 자동 재생성되는지는 런타임에서 확인.

- [ ] **Step 5: Commit**

```bash
git add app/lib/bundle.ts app/lib/bundle.test.ts
git commit -m "feat(cycles): conf cycles=fixed 23880 + absolute step 2000"
```

---

## Task 3: DosEmulator에 cyclesUp/cyclesDown 추가

**Files:**
- Modify: `app/lib/dos-emulator.ts:11-22` (CommandInterface 인터페이스), `:503-505` 근처(public 메서드)

- [ ] **Step 1: CommandInterface에 sendBackendEvent 추가**

`app/lib/dos-emulator.ts`의 `CommandInterface` 인터페이스(라인 11-22)에서 `events` 줄 위에 추가:
```ts
  sendBackendEvent: (event: unknown) => void;
```

- [ ] **Step 2: cyclesUp/cyclesDown 메서드 추가**

`sendKeyTap` 메서드(라인 505 근처) 바로 아래에 추가:
```ts
  // Trigger dosbox-x's cycle mapper handlers by name via the backend-event
  // bridge (wdosbox-x.js: "wc-trigger-event" -> _TriggerEventByName).
  // No key-event injection needed. Step size = conf cycleup/cycledown.
  cyclesUp(): void {
    this.ci?.sendBackendEvent({ type: "wc-trigger-event", event: "hand_cycleup" });
  }
  cyclesDown(): void {
    this.ci?.sendBackendEvent({ type: "wc-trigger-event", event: "hand_cycledown" });
  }
```

- [ ] **Step 3: 타입체크**

Run: `npm run typecheck`
Expected: 에러 없음.

- [ ] **Step 4: Commit**

```bash
git add app/lib/dos-emulator.ts
git commit -m "feat(cycles): DosEmulator.cyclesUp/cyclesDown via sendBackendEvent"
```

---

## Task 4: 검증 게이트 — event 이름 확정 (런타임, 차단)

**목적:** `hand_cycleup`/`hand_cycledown`이 실제로 동작하는지 실증. 실패 시 다음 태스크 진행 금지.

**Files:** 없음(런타임 확인). 결과에 따라 Task 3의 event 문자열만 수정될 수 있음.

- [ ] **Step 1: dev 서버 기동**

Run: `npm run dev`
브라우저에서 `http://localhost:5173` 열고 DOS가 부팅(BootScreen 100%)될 때까지 대기.

- [ ] **Step 2: 브라우저 콘솔에서 baseline 처리율 측정**

`commandInterface` getter가 public이므로(`dos-emulator.ts:507`), 콘솔에서 emulator 인스턴스에 접근할 수 없으면 임시로 `app/components/DosFrame` 또는 `_index.tsx`의 `onEmulator` 콜백에서 `(window as any).__emu = emu;`를 한 줄 추가해 노출한다(검증 후 제거). 콘솔:
```js
const ci = window.__emu.commandInterface;
const t0 = performance.now();
const c0 = (await ci.asyncifyStats()).cycles;
await new Promise(r => setTimeout(r, 1000));
const c1 = (await ci.asyncifyStats()).cycles;
console.log("cyclesPerMs ≈", Math.round((c1 - c0) / (performance.now() - t0)));
```
Expected: 약 23000~24000 근처(= fixed 23880, 부하 100%일 때).

- [ ] **Step 3: hand_cycleup 트리거 후 재측정**

콘솔에서 여러 번:
```js
for (let i = 0; i < 5; i++) ci.sendBackendEvent({ type:"wc-trigger-event", event:"hand_cycleup" });
// 다시 Step 2의 측정 블록 실행
```
Expected: cyclesPerMs가 상승(예: ~33000). 상승하면 `hand_cycleup`/`hand_cycledown` 확정 → Task 3 그대로 유지.

- [ ] **Step 4: 무반응이면 mapper_ 이름으로 재시도**

Step 3에서 변화가 없으면:
```js
for (let i = 0; i < 5; i++) ci.sendBackendEvent({ type:"wc-trigger-event", event:"mapper_cycleup" });
// 재측정
```
변화가 있으면 Task 3의 `hand_cycleup`/`hand_cycledown`을 `mapper_cycleup`/`mapper_cycledown`으로 교체하고 재커밋:
```bash
git add app/lib/dos-emulator.ts
git commit -m "fix(cycles): use mapper_* event names (verified at runtime)"
```

- [ ] **Step 5: 절대 스텝 동작 확인**

`hand_cycledown` 1회 트리거 후 cyclesPerMs가 약 2000 감소하는지 확인. 퍼센트로 동작(예: 비대칭/배율 변화)하면 `cpu-cycles.ts`의 `CYCLES_STEP` 의미를 재검토(이 경우 Task 1/2로 돌아가 conf 값을 조정).

- [ ] **Step 6: 두 이름 모두 실패 시 — 폴백 결정**

`hand_`·`mapper_` 모두 무반응이면 키 이벤트 폴백으로 전환. Task 3의 메서드를 아래로 교체(키코드는 `dos-keymap`: ControlLeft=341, F11=300, F12=301):
```ts
  cyclesUp(): void { this.cycleKey(301); }   // Ctrl+F12
  cyclesDown(): void { this.cycleKey(300); } // Ctrl+F11
  private cycleKey(fkey: number): void {
    if (!this.ci) return;
    this.ci.sendKeyEvent(341, true);
    this.ci.simulateKeyPress(fkey);
    this.ci.sendKeyEvent(341, false);
  }
```
이 경로로 cyclesPerMs가 변하는지 다시 확인. 동작하면 커밋 후 진행, 여전히 무반응이면 중단하고 사용자에게 보고.

- [ ] **Step 7: 임시 노출 코드 제거**

Step 2에서 추가한 `(window as any).__emu = emu;`를 제거.

---

## Task 5: DosFrame에 cycles state + 콜백 배선

**Files:**
- Modify: `app/routes/_index.tsx` (import, state, 콜백, `<Toolbar>` props)

- [ ] **Step 1: import 추가**

`app/routes/_index.tsx` 상단 import 구역에 추가:
```ts
import { DEFAULT_CYCLES, CYCLES_STEP, CYCLES_MIN, CYCLES_MAX, clampCycles } from "../lib/cpu-cycles";
```

- [ ] **Step 2: state 추가**

`const [status, setStatus] = useState<string | null>(null);`(라인 30 근처) 아래에 추가:
```ts
  const [cycles, setCycles] = useState(DEFAULT_CYCLES);
```

- [ ] **Step 3: 조절 콜백 추가**

`onVkbKeyUp` 콜백(라인 50-52) 아래에 추가:
```ts
  const onCyclesUp = useCallback(() => {
    if (cycles >= CYCLES_MAX) return;
    emulatorRef.current?.cyclesUp();
    setCycles((c) => clampCycles(c + CYCLES_STEP));
  }, [cycles]);

  const onCyclesDown = useCallback(() => {
    if (cycles <= CYCLES_MIN) return;
    emulatorRef.current?.cyclesDown();
    setCycles((c) => clampCycles(c - CYCLES_STEP));
  }, [cycles]);
```

- [ ] **Step 4: Toolbar에 props 전달**

`<Toolbar>`(라인 124-138)의 `onSave={checkAndSave}` 줄 아래에 추가:
```tsx
        cycles={cycles}
        onCyclesUp={onCyclesUp}
        onCyclesDown={onCyclesDown}
```

- [ ] **Step 5: 타입체크 (Toolbar props 추가 전이라 일시 에러 예상)**

Run: `npm run typecheck`
Expected: Toolbar가 `cycles`/`onCyclesUp`/`onCyclesDown`를 아직 모른다는 에러. Task 6에서 해소. (이 태스크 단독 커밋은 Task 6과 함께.)

---

## Task 6: Toolbar UI — 현재값 표시 + −/+ 버튼

**Files:**
- Modify: `app/components/Toolbar.tsx` (ToolbarProps, 구조 분해, JSX, 아이콘)
- Modify: toolbar 스타일 시트(아래 Step 4에서 위치 확정)

- [ ] **Step 1: ToolbarProps에 필드 추가**

`app/components/Toolbar.tsx`의 `ToolbarProps`(라인 3-19)에서 `onSave: () => void;` 아래에 추가:
```ts
  // CPU cycles control
  cycles: number;
  onCyclesUp: () => void;
  onCyclesDown: () => void;
```
그리고 함수 구조 분해(라인 21-35)의 `onSave,` 아래에 `cycles,`, `onCyclesUp,`, `onCyclesDown,` 추가.

- [ ] **Step 2: cycles UI 삽입**

`<ResolutionPicker ... />`(라인 53) 아래, 첫 `<span className="toolbar__sep" />`(라인 54) 위에 삽입:
```tsx
        <div className="toolbar__cycles" title="CPU 속도 (cycles) — 클수록 빠름">
          <button
            type="button"
            onClick={onCyclesDown}
            className="toolbar__icon"
            aria-label="CPU 속도 낮추기"
          >
            <IconMinus />
          </button>
          <span className="toolbar__cycles-value" aria-live="polite">
            {cycles.toLocaleString()}
          </span>
          <button
            type="button"
            onClick={onCyclesUp}
            className="toolbar__icon"
            aria-label="CPU 속도 높이기"
          >
            <IconPlus />
          </button>
        </div>
```

- [ ] **Step 3: 아이콘 추가**

`Icons` 주석 구역의 `IconKeyboard` 함수 위(또는 아래)에 추가:
```tsx
function IconMinus() {
  return (
    <svg {...svgProps}>
      <path d="M3.5 8h9" />
    </svg>
  );
}

function IconPlus() {
  return (
    <svg {...svgProps}>
      <path d="M8 3.5v9M3.5 8h9" />
    </svg>
  );
}
```

- [ ] **Step 4: CSS 추가**

toolbar 스타일 정의 위치를 먼저 찾는다:
Run: `grep -rln "toolbar__sep\|toolbar__icon" app/`
찾은 CSS 파일(예: `app/app.css`)에 추가:
```css
.toolbar__cycles {
  display: inline-flex;
  align-items: center;
  gap: 2px;
}
.toolbar__cycles-value {
  min-width: 3.5em;
  text-align: center;
  font-variant-numeric: tabular-nums;
  font-size: 12px;
  color: inherit;
  opacity: 0.85;
}
```

- [ ] **Step 5: 타입체크**

Run: `npm run typecheck`
Expected: 에러 없음(Task 5의 Toolbar props 에러 해소).

- [ ] **Step 6: Commit (Task 5 + 6 함께)**

```bash
git add app/routes/_index.tsx app/components/Toolbar.tsx app/app.css
git commit -m "feat(cycles): toolbar cycles display + +/- controls"
```

---

## Task 7: 통합 검증 + 빌드

**Files:** 없음(검증).

- [ ] **Step 1: 전체 테스트**

Run: `npm run test`
Expected: 전부 PASS.

- [ ] **Step 2: 타입체크**

Run: `npm run typecheck`
Expected: 에러 없음.

- [ ] **Step 3: 프로덕션 빌드**

Run: `npm run build`
Expected: 성공.

- [ ] **Step 4: 런타임 통합 확인**

`npm run dev` → 부팅 후:
- Toolbar에 "23,880" 표시 확인.
- + 버튼 여러 번 → 숫자 증가 + 게임/프롬프트 체감 속도 상승.
- − 버튼 → 감소.
- MIN/MAX 경계에서 더 이상 변하지 않는지.
- 캐시된 번들이 새 conf로 재생성됐는지(`~/.cache/dosbox` ETag 변경) — 의심되면 `rm -rf ~/.cache/dosbox` 후 재기동.

- [ ] **Step 5: 최종 커밋(필요 시)**

검증 중 수정이 있었다면 커밋. 없으면 생략.

---

## Self-Review

- **Spec coverage**: 기본값 `fixed 23880`(Task 2) ✓ / `sendBackendEvent` 조절(Task 3) ✓ / 검증 게이트·폴백(Task 4) ✓ / Toolbar 표시+버튼(Task 5,6) ✓ / 절대 스텝(Task 2,1) ✓ / conf 테스트(Task 2) ✓ / clamp 테스트(Task 1) ✓ / `cyclesPerMs` 실측은 검증 게이트 전용(Task 4) ✓.
- **YAGNI 제외 항목**(프리셋·단축키·localStorage·editcycles)은 어떤 태스크에도 없음 ✓.
- **타입 일관성**: `cyclesUp`/`cyclesDown`(Task 3) ↔ `emulatorRef.current?.cyclesUp()`(Task 5) ↔ `onCyclesUp`/`onCyclesDown` props(Task 5,6) 일치. `clampCycles`/상수명 Task 1 정의와 Task 2/5 사용 일치.
- **Placeholder**: 없음. 모든 코드 스텝에 실제 코드 포함.
