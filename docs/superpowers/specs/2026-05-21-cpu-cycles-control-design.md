# CPU Cycles 런타임 조절 — Design

## Goal

DOS 환경의 CPU 속도(cycles)를 기본값 **486DX2-66 상당(`fixed 23880`)**으로 고정하고, dosbox 네이티브처럼 사용자가 실행 중에 cycles를 올리고 내릴 수 있게 한다. 조절 UX는 Toolbar UI(현재값 표시 + −/+ 버튼)로 제공한다.

## Why

- 기존 `cycles=auto`는 현대 호스트에서 너무 빨라 시대 게임/프로그램이 비정상적으로 빠르게 동작.
- dosbox 네이티브는 Ctrl+F11/F12로 실시간 cycle 조절을 지원 — 게임마다 적정 속도가 달라 사용자 조절이 필요.
- 웹 클라이언트에는 네이티브 mapper 단축키 UI가 없으므로 Toolbar에 동등 기능을 제공.

## Mechanism Analysis

### 조절 (확정)

`wdosbox-x.js` 브릿지가 백엔드 이벤트를 다음과 같이 처리한다:

```js
case "wc-trigger-event": {
  Module.withString(message.event, name => Module._TriggerEventByName(name))
}
```

즉 `ci.sendBackendEvent({ type: "wc-trigger-event", event: NAME })` → wasm export `_TriggerEventByName(NAME)` → dosbox-x mapper 핸들러를 **이름으로 직접 트리거**한다. 키 이벤트(Ctrl+F11) 시퀀스 주입이 필요 없다.

- js-dos 공식 코드가 savestate를 이 방식(`event: "hand_savestate"`)으로 트리거한다.
- dosbox mapper 명명 규칙은 `MAPPER_AddHandler(handler, key, mods, eventname, …)`에서 CEvent 이름이 `"hand_" + eventname`.
- wasm 문자열 테이블에 cycle 핸들러가 `mapper_cycledown` / `mapper_cycleup` / `mapper_editcycles` / `mapper_cycauto`로 존재.
- 따라서 cycle 조절 event 이름 후보: **`hand_cycledown` / `hand_cycleup`** (savestate 규칙 유추), 폴백 후보 `mapper_cycledown` / `mapper_cycleup`. 둘 중 실제 동작하는 쪽을 검증 게이트에서 확정.

### 현재값 읽기 (제약)

설정된 cycles를 직접 읽는 API는 **없다**.

| 방법 | 가능 여부 | 내용 |
|---|---|---|
| 설정 cycles 직접 getter | ❌ 없음 | — |
| `config()` | ⚠️ 제한적 | `DosConfig.dosboxConf`는 **초기 conf 텍스트 스냅샷** — 런타임 변경 미반영 |
| `asyncifyStats().cycles` | ⚠️ 통계 | 누적 실행 cycle 수(설정값 아님) |
| `cyclesPerMs` 실측 | ✅ 가능 | `asyncifyStats().cycles`를 경과 시간으로 나눈 처리율. js-dos 공식 UI가 "Cycles/ms"로 표시하는 값. `fixed` 모드에선 설정값에 근사 |

→ 신뢰원천은 **JS 자체 추적값**(시작값에서 클릭 스텝 누적). `cyclesPerMs` 실측은 보조(검증·디버그).

### 스텝 단위

dosbox/dosbox-x의 `cycleup`/`cycledown`은 값이 100 미만이면 퍼센트, 100 이상이면 절대값으로 해석. 현재 conf는 `cycleup=10`/`cycledown=20`(퍼센트, 비대칭) → JS 추적이 어긋남. **절대 스텝(`2000`)으로 변경**해 "1클릭 = ±2000 cycles"를 dosbox·JS가 동일하게 계산.

## Design

### 공유 상수 — `app/lib/cpu-cycles.ts` (신규)

```
DEFAULT_CYCLES = 23880   // 486DX2-66 (DOSBox-X CPU 가이드 매핑값)
CYCLES_STEP    = 2000    // 1클릭 변화량 (= conf cycleup/cycledown)
CYCLES_MIN     = 100
CYCLES_MAX     = 100000
```

`bundle.ts`(서버)와 Toolbar(클라이언트)가 모두 import해 conf 값과 표시 초기값이 항상 동기.

### 데이터 흐름

```
[Toolbar]  "23880"  [−] [+]
   │ onCyclesDown / onCyclesUp
   ▼
DosFrame  state: cycles (낙관적 ±CYCLES_STEP, clamp MIN/MAX)
   │ emulator.cyclesDown() / cyclesUp()
   ▼
DosEmulator
   ci.sendBackendEvent({ type:"wc-trigger-event", event:"hand_cycledown"|"hand_cycleup" })
   ▼
wdosbox-x: _TriggerEventByName → mapper 핸들러 (네이티브 경로)
```

- **상태 위치**: `cycles` state는 `DosFrame`이 보유, Toolbar에 props로 전달. 조절 콜백은 DosFrame이 DosEmulator에 위임 — 기존 Toolbar 액션 패턴(저장 등)과 동일.
- **표시**: JS 추적값을 1차로 표시. (보조) `asyncifyStats()` 폴링으로 `cyclesPerMs`를 계산해 검증/디버그에 활용.
- **clamp**: MIN/MAX 도달 시 더 이상 트리거하지 않음(표시값과 dosbox 내부값 동기 유지).

### conf 변경 — `app/lib/bundle.ts`

```
[cpu]
core=auto
cputype=486_prefetch
cycles=fixed 23880     // DEFAULT_CYCLES
cycleup=2000           // CYCLES_STEP (절대)
cycledown=2000         // CYCLES_STEP (절대)
```

`DOSBOX_CONF`는 ETag 해시에 포함되므로 변경 시 캐시 번들이 자동 재생성된다.

## 검증 게이트 (구현 1단계 — 실패 시 진행 차단)

1. **event 이름 확정**: `hand_cycledown`/`hand_cycleup` 먼저 시도. `cyclesPerMs` 실측 폴링으로 실제 변화를 관찰. 무반응이면 `mapper_cycledown`/`mapper_cycleup` 시도.
2. **절대 스텝 동작 확인**: `cycleup=2000`이 ±2000 절대값으로 적용되는지(퍼센트로 해석되면 conf·STEP 재조정).
3. **폴백**: 1·2 모두 실패 시 키 이벤트 시퀀스(Ctrl+F11/F12, 키코드 341+300/301) 주입으로 전환.

## Scope

### In scope
- conf 기본값 `fixed 23880` + 절대 스텝
- Toolbar 현재값 표시 + −/+ 버튼
- `sendBackendEvent` 기반 런타임 조절
- 검증 게이트

### Out of scope (YAGNI — 요청 시 후속)
- CPU 프리셋 드롭다운(386/486/Pentium)
- 키보드 단축키(Ctrl+F11/F12) 노출
- cycles 값 localStorage 영속화
- `editcycles`(임의 절대값 입력) 다이얼로그

## Testing

- `app/lib/bundle.test.ts`: 생성된 `dosbox.conf`에 `cycles=fixed 23880`, `cycleup=2000`, `cycledown=2000` 포함 단언.
- `app/lib/cpu-cycles.ts`: clamp 로직 단위 테스트(MIN/MAX 경계).
- 검증 게이트는 실제 브라우저 런타임 확인(자동화 불가 영역).
