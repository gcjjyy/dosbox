# Custom DOS Emulator (js-dos UI 제거) — Design

## Goal

js-dos v8의 React UI 레이어(사이드바, fullscreen workaround, 소프트 키보드, splash 등)를 통째로 제거하고, 그 아래 `emulators` (WASM 브릿지) 위에 직접 얇은 글루를 올려 자체 DOS 웹 에뮬레이터를 구성한다. 데스크탑과 태블릿(가로) 모두를 지원하며, 태블릿용 가상 QWERTY 키보드를 직접 만든다.

## Why

- **컴팩트:** 현재 `js-dos.js` + `js-dos.css`는 우리가 쓰지 않는 UI를 포함한다(사이드바, splash, 클라우드/네트워크 UI, 자체 소프트 키보드 등). 초기 페이로드 큰 폭 감소.
- **UI 충돌 해소:** js-dos의 사이드바·CSS 리셋이 우리 툴바/해상도 picker와 자꾸 충돌. 우리가 직접 그리면 사라짐.
- **풀 컨트롤:** 캔버스 크기/위치, 입력 라우팅, 오디오 라이프사이클을 우리가 100% 통제. 사용자가 만든 해상도 picker가 단순한 CSS 조정만으로 정확히 동작.

## Scope

### In scope
- emulators(`window.emulators`) 위에 자체 글루: 캔버스 렌더링, 오디오, 키보드, 마우스/터치 forwarding.
- 가상 QWERTY 키보드 컴포넌트 (태블릿용).
- 기존 툴바/해상도 picker/저장 흐름과의 통합.
- public 자산 정리 (js-dos.js / js-dos.css 제거, emulators 만 유지).

### Out of scope
- 자체 가상 D-pad/게임패드 오버레이.
- 네트워킹/클라우드 통합.
- DOSBox 설정 변경 (현재 `cycles=fixed 22500`, DOSBox-X 백엔드 유지).
- .jsdos 번들 포맷 변경 (서버 측 zip 빌드 로직 그대로).
- 저장/관리자 인증 흐름 (`/api/save`, `/api/login`) 변경.

## Architecture

**상위 구조: 클래스 기반 엔진 + 얇은 React 컴포넌트**

엔진 글루(canvas, audio, input)는 자연스럽게 내부 상태(AudioContext, 최신 frame buffer, 마우스 좌표 스케일링)를 가지므로 클래스(`DosEmulator`)로 캡슐화. React는 마운트/언마운트 owner 역할만 한다. 가상 키보드는 별도 React 컴포넌트로 분리.

### File layout

```
app/
  components/
    DosFrame.tsx          — 얇은 React 셸 (useEffect로 DosEmulator 생성/destroy, 캔버스 ref)
    VirtualKeyboard.tsx   — QWERTY 키보드. onKeyDown/onKeyUp 콜백 노출
    Toolbar.tsx           — 기존 + ⌨ 토글 버튼 추가
    ResolutionPicker.tsx  — 기존
    BootScreen.tsx        — 기존 (재사용)
  lib/
    dos-emulator.ts       — DosEmulator 클래스 (핵심 엔진 글루)
    dos-keymap.ts         — KeyboardEvent.code → DOSBox(SDL2) 스캔코드 매핑
    use-resolution.ts     — 기존
    use-virtual-keyboard.ts — 터치 기기 자동 감지 + localStorage 토글 영속
    save.ts               — 기존
  routes/
    _index.tsx            — 컴포넌트 와이어링, DOS 특정 로직 없음
    dos.jsdos.tsx         — 기존
    api.*.tsx             — 기존
```

### `DosEmulator` 클래스 인터페이스

```ts
class DosEmulator {
  constructor(opts: {
    canvas: HTMLCanvasElement;
    bundle: Uint8Array;
    onReady?: (ci: CommandInterface) => void;
    onFirstFrame?: () => void;
    onError?: (e: unknown) => void;
  });

  destroy(): Promise<void>;            // ci.exit() + 리스너 제거 + AudioContext close

  sendKeyDown(keyCode: number): void;  // 가상 키보드용 — ci.sendKeyEvent(code, true)
  sendKeyUp(keyCode: number): void;
  sendKeyTap(keyCode: number): void;   // ci.simulateKeyPress (단발성)

  get commandInterface(): CommandInterface | null;
}
```

물리 키보드(window keydown/keyup 자동 forwarding)와 가상 키보드(`sendKeyDown/Up` 명시 호출)는 둘 다 `ci.sendKeyEvent`로 합류하여 충돌하지 않는다.

## Layout

`_index.tsx` 그리드:

```
toolbar     ─ auto (40px)
canvas area ─ 1fr (남는 공간)
keyboard    ─ auto (가상 키보드 켜졌을 때만, ~240px on tablet)
```

- 키보드 켜짐: `grid-rows: auto 1fr auto`
- 키보드 꺼짐: `grid-rows: auto 1fr` — 캔버스 영역이 자동으로 커진다

캔버스 영역 내부에서 해상도 picker 동작:
- **고정 해상도** (640×480 등): CSS 크기 고정, `place-items: center`로 가운데 정렬. 가용 공간 부족 시 `dos-stage`의 `overflow: auto`로 스크롤.
- **"전체화면"**: 가용 영역 안에서 4:3 비율 유지하며 최대 크기 (`object-fit: contain` 또는 calc로 aspect-ratio).
- 모든 모드에서 `image-rendering: pixelated`로 픽셀 보존.

## Virtual Keyboard

`VirtualKeyboard.tsx` — 태블릿 가로 기준 QWERTY 레이아웃:

```
[1][2][3][4][5][6][7][8][9][0][-][=][←BS]    [Esc][↑]
[Q ][W ][E ][R ][T ][Y ][U ][I ][O ][P ]    [←][↓][→]
[A ][S ][D ][F ][G ][H ][J ][K ][L ][↵Ent]  [Tab]
[Shift][Z ][X ][C ][V ][B ][N ][M ][,][.][/]
[Ctrl][Alt][          SPACE          ][Alt][Ctrl]
[F1][F2][F3][F4][F5][F6][F7][F8][F9][F10]
```

### Key 동작
- **일반 키:** `pointerdown` → `sendKeyDown` + 키 ID state로 기록, `pointerup`/`pointerleave` → `sendKeyUp`. 게임의 hold 인식 지원.
- **방향키:** 동일하게 pointerdown/up — 게임 이동에 필수.
- **모디파이어(Shift/Ctrl/Alt):** tap → 토글 latch (시각적 highlight 유지). 다음 일반 키 down/up 사이클 이후 자동 해제. (sticky-once 동작; 단순)
- **시각 피드백:** 눌린 키는 `--color-navy-accent` 배경.

### 표시 조건 (`use-virtual-keyboard.ts`)
- 자동 감지: `matchMedia('(pointer: coarse)').matches || 'ontouchstart' in window` → 기본 ON
- 데스크탑(non-touch) → 기본 OFF
- 사용자가 툴바 `⌨` 버튼으로 토글 시 → 결과를 localStorage(`dosbox-virtual-keyboard`)에 저장. 저장된 값이 있으면 자동 감지보다 우선.

### 스타일
기존 navy minimal 톤 — 키 캡 `var(--color-navy-bg-lift)` 배경, `var(--color-navy-line)` 보더, `font-family: var(--font-mono)`. 눌림 시 `var(--color-navy-accent)`.

## Input forwarding

### 키 매핑 (`dos-keymap.ts`)
emulators는 SDL2 스타일 USB HID 스캔코드를 받는다. `KeyboardEvent.code` → 스캔코드 정적 lookup 테이블 하나. 예:

| `e.code`     | scancode |
|--------------|----------|
| `KeyA`       | 4        |
| `Digit1`     | 30       |
| `Enter`      | 40       |
| `Escape`     | 41       |
| `Space`      | 44       |
| `ArrowUp`    | 82       |
| (전체 표는 구현 시 emulators-ui 소스 참고하여 포팅) | |

### 물리 키보드 forwarding
- `window.addEventListener('keydown'/'keyup')`
- 매핑된 코드가 있으면 `ci.sendKeyEvent(code, pressed)` + `e.preventDefault()`
- **예외 (forward 안 함):**
  - Ctrl/Cmd + (R, T, W, N, L, F, S, P, +, -, 0~9): 브라우저 표준 단축키
  - Ctrl/Cmd/Alt + Tab: 탭 전환 / OS 앱 전환
  - F11: 브라우저 fullscreen
  - F12: DevTools
  - 위 조건에 해당하면 forward 하지 않고 `preventDefault`도 하지 않음 → 브라우저/OS가 처리
- 매핑 없는 키 → 무시 (브라우저 기본동작 유지).
- **Note:** 단독 Ctrl/Alt(예: Ctrl 단독 누름, 액션게임 fire 버튼) 및 Ctrl+화살표/숫자 같은 게임 흔한 조합은 위 예외에 없으므로 forward됨.

### 마우스/터치 (canvas pointer events)
- `pointerdown` → `ci.sendMouseButton(button, true)` + `ci.sendMouseSync()`
- `pointermove` → 캔버스 상대좌표 정규화 → `ci.sendMouseMotion(rx, ry)` + `ci.sendMouseSync()` (rx, ry ∈ [0, 1])
- `pointerup` → `ci.sendMouseButton(button, false)` + `ci.sendMouseSync()`
- 좌표 계산:
  ```ts
  const rect = canvas.getBoundingClientRect();
  const rx = (e.clientX - rect.left) / rect.width;
  const ry = (e.clientY - rect.top) / rect.height;
  ```
- 터치는 단일 포인터만 (멀티터치는 가상 키보드 쪽이 처리).

## Rendering

- `events().onFrameSize((w, h) => { canvas.width = w; canvas.height = h })` — DOS 출력 해상도가 바뀔 때마다(예: 320×200 → 640×480) 캔버스 intrinsic 크기 갱신.
- `events().onFrame((rgb, rgba) => ...)`:
  - `rgba`가 truthy면 그것으로 `ImageData` 만들어 `ctx.putImageData(imgData, 0, 0)`.
  - `rgba`가 null이고 `rgb`만 있으면 알파(0xFF) 채워 RGBA로 변환 후 putImageData.
- CSS 크기는 별개로 해상도 picker가 제어. `image-rendering: pixelated`로 픽셀 보존.
- 첫 frame 수신 시 `onFirstFrame` 콜백 → boot overlay fade-out 트리거. 기존 `MIN_MS = 1500ms` floor 유지.

## Audio

- `new AudioContext({ sampleRate: ci.soundFrequency() })` — DOSBox가 알려주는 주파수로 컨텍스트 생성.
- 첫 사용자 제스처(window의 첫 `pointerdown` 또는 `keydown`)에서 `ctx.resume()`. 그 전엔 무음.
- 큐 전략: `onSoundPush(samples)`마다 `AudioBuffer` 만들어 `AudioBufferSourceNode`로 스케줄.
  ```ts
  let nextStartTime = 0;
  // on push:
  const t = Math.max(audioCtx.currentTime, nextStartTime);
  source.start(t);
  nextStartTime = t + buffer.duration;
  ```
- AudioWorklet/ScriptProcessor 안 씀 (단순한 게 우선).

## Init/Cleanup lifecycle

```
Mount
 ├─ fetch('/dos.jsdos') → ArrayBuffer
 ├─ wait for window.emulators (poll 100ms / 30s 한도, 기존 패턴)
 ├─ window.emulators.pathPrefix = '/js-dos/emulators/'
 ├─ new DosEmulator({ canvas, bundle, onReady, onFirstFrame, onError })
 │   ├─ emulators.dosboxXDirect([bundleBytes]) → CommandInterface (await)
 │   ├─ events().onFrameSize/onFrame/onSoundPush 부착
 │   ├─ window keydown/keyup 부착
 │   ├─ canvas pointerdown/move/up 부착
 │   └─ AudioContext(suspended) 생성
 ├─ onReady → ciRef.current = ci (저장 버튼이 사용)
 └─ onFirstFrame → boot overlay fade-out (MIN_MS=1500 floor 유지)

Unmount
 └─ DosEmulator.destroy()
     ├─ ci.exit()
     ├─ remove all window/canvas listeners
     ├─ audioCtx.close()
     └─ cancel pending AudioBufferSourceNodes
```

### IDB-wipe 로직 제거
기존 `wipeJsDosIdbIfBundleChanged()`는 js-dos가 번들을 IndexedDB에 캐싱하던 동작에 대응한 코드였다. 자체 엔진은 IDB 안 쓰고 매번 fetch로 ArrayBuffer 로드 → 브라우저 HTTP 캐시(ETag, `Cache-Control: no-cache, must-revalidate`)가 충분. 통째로 삭제.

## Asset changes

### `public/js-dos/` 디렉토리
```
삭제:
  js-dos.css         (UI 스타일 — 미사용)
  js-dos.js          (React UI 레이어 — 미사용, 큰 용량)
  js-dos.js.map

유지:
  emulators/
    emulators.js        (저수준 WASM 브릿지)
    wdosbox.js + .wasm  (DOSBox classic, 미사용이지만 dist에 포함)
    wdosbox-x.js + .wasm (DOSBox-X — 현재 백엔드)
    wlibzip.js + .wasm   (번들 zip 추출)
```

### `package.json`
`copy-jsdos` 스크립트를 `node_modules/js-dos/dist/emulators/*`만 복사하도록 변경:
```
rm -rf public/js-dos && mkdir -p public/js-dos/emulators && cp -r node_modules/js-dos/dist/emulators/* public/js-dos/emulators/
```

### `app/root.tsx`
- `{ rel: "stylesheet", href: "/js-dos/js-dos.css" }` 줄 삭제.
- `<script src="/js-dos/js-dos.js" defer />` → `<script src="/js-dos/emulators/emulators.js" defer />`.

## Save flow

변경 없음. Toolbar 저장 버튼 → `_index.tsx`의 `checkAndSave` → `ciRef.current.persist(true)` → `saveToServer(bytes)` → POST `/api/save`. 새 엔진에서도 동일 `CommandInterface.persist`이므로 그대로 동작.

## State & persistence

| 키 | 설명 | 변경? |
|---|---|---|
| `dosbox-resolution` (localStorage) | 해상도 picker 선택값 | 그대로 |
| `dosbox-virtual-keyboard` (localStorage) | 가상 키보드 사용자 토글 결과 | **신규** |
| `dosbox-last-bundle-etag` (localStorage) | 기존 IDB wipe 게이트 | **삭제** (더 이상 IDB wipe 안 함) |

## Testing

프로젝트에 자동 테스트 프레임워크가 없다 → 수동 검증으로 충분.

### 검증 시나리오
- **데스크탑 (Linux/macOS Chrome):**
  1. 페이지 로드 → boot overlay → 첫 frame → overlay fade-out
  2. 캔버스 클릭 후 키 입력 (예: Arrow keys, letters) → DOS 화면 반응
  3. 마우스 이동 + 클릭 → DOS 커서 추적
  4. 사운드 재생 (예: 비프음, 음악) → 들림
  5. 저장 버튼 → 변경분 있으면 토스트로 N개 저장됨 / 없으면 "변경 없음"
- **태블릿 에뮬레이션 (Chrome DevTools, iPad 가로):**
  1. 가상 키보드 자동 표시
  2. 키 탭 → DOS 반응 (hold 게임 이동 포함)
  3. Shift+letter 조합 (sticky-once)
  4. 툴바 `⌨` 토글로 키보드 숨김/표시
  5. 캔버스 탭 → 마우스 클릭으로 인식
- **실제 안드로이드 태블릿** (가능하면): 위와 동일.

## Migration

단일 PR/커밋:
1. 위 파일 구조 그대로 신규/수정.
2. `npm run build` → 통과 확인.
3. 데스크탑 수동 검증.
4. 태블릿 에뮬레이션 수동 검증.
5. commit + pm2 restart.

데이터 마이그레이션 없음 (.jsdos 포맷, /api/save 동일). 기존 사용자의 `dosbox-resolution` localStorage 유지.

## Risks

- **DOSBox 스캔코드 매핑 누락:** dos-keymap에서 빠진 키가 있으면 해당 키 입력 안 됨. 초기 매핑은 자주 쓰는 키 우선, 점진 보강.
- **Audio queue underrun/overrun:** 단순 큐 전략이라 큰 부하 시 끊김 가능. 발생 시 AudioWorklet 도입 검토.
- **`putImageData` 성능:** 320×200 60fps는 여유 있음. 1024×768 같은 큰 해상도에서 CPU 낮은 태블릿에선 부하 가능 — 발생 시 WebGL 전환 검토.
- **모디파이어 sticky-once UX:** 두 키 동시 누르는 게임(예: Ctrl+화살표)에서 직관적이지 않을 수 있음. 사용 후 sticky-toggle(latched until tapped again) 모드 추가 고려.
