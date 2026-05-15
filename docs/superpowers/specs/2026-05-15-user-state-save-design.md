# 사용자별 상태저장 (localStorage) — Design

## Goal

DOS 게임/프로그램의 진행 상태를 사용자 본인 브라우저에만 저장/복원하는 기능. 기존 관리자 저장(서버에 영구 반영, 전체 사용자 적용)과는 독립된 채널.

## Why

- 사용자가 게임을 하다가 자기 브라우저에 진행도를 남기고 다음 방문 시 이어하고 싶음.
- 관리자가 아니어도 자기 진행 상태를 저장할 수 있어야 함.
- 관리자도 자기 브라우저에서 임시 테스트하다 저장하고 싶을 때가 있음 (서버 반영 없이).

## Mechanism Analysis

emulators 패키지(`CommandInterface`)는 별도의 CPU/RAM snapshot API를 노출하지 않는다. 노출되는 state 관련 API는:
- `persist(onlyChanges?: boolean): Promise<Uint8Array | null>` — DOS 파일시스템 변경분을 ZIP으로 반환

DOS 게임 상태는 보통 파일로 저장된다(예: DOOM의 `.dsg`, 시리어스 어드벤처의 슬롯 파일, 게임 INI 등). 따라서 `persist(true)`로 캡처 가능. 관리자 저장이 이미 이 API를 쓰고 있다.

로딩은 `emulators.dosboxXDirect(initFs)`의 multi-entry 동작을 활용:
- `InitFsEntry`: `Uint8Array`(번들 zip) / `{path, contents}` / `DosConfig` / 경로 문자열
- 복수 entry 시 뒤 entry가 앞 entry를 overlay (같은 경로 파일이면 뒤 entry 우선)

따라서 `dosboxXDirect([serverBundle, userSaveBundle])` 형태로 사용자 저장 zip을 서버 번들 위에 덮어씌워 부팅.

## Scope

### In scope
- 단일 slot, localStorage 기반 사용자 저장
- 페이지 부팅 시 자동 로드
- 명시적 저장 버튼 (`⤴ 내 저장`)
- 명시적 삭제 버튼 (저장 존재 시만 노출, native confirm 후 reload)
- 저장 결과 토스트 (기존 admin save와 동일 패턴)
- 5MB localStorage 제약을 인지한 quota 처리

### Out of scope
- 다중 slot (slot picker UI 등)
- 자동 주기 스냅샷 (auto-save)
- 서버 번들 ETag 변경 시 사용자 저장 무효화 (YAGNI — 사용자가 직접 🗑로 관리)
- Cloud sync / 디바이스 간 공유
- 압축 (zip 자체가 이미 압축되어 있음)
- 커스텀 confirm modal (native `confirm()` 사용)

## Architecture

### File structure

```
app/
  lib/
    user-state.ts          ─ CREATE: pure functions (localStorage 읽기/쓰기/삭제, base64)
    use-user-state.ts      ─ CREATE: React hook for reactive hasSave state
    dos-emulator.ts        ─ MODIFY: DosEmulatorOpts에 overlay?: Uint8Array | null 추가
  components/
    DosFrame.tsx           ─ MODIFY: boot 시 readUserState() 호출, DosEmulator에 overlay 전달
    Toolbar.tsx            ─ MODIFY: 내 저장 / 삭제 버튼 추가 + 기존 "저장" → "관리자 저장" 리네이밍
  routes/
    _index.tsx             ─ MODIFY: useUserState 와이어링, onUserSave/onUserDelete 콜백
```

### Data flow

**저장:**
```
[⤴ 내 저장] 클릭
  → ci.persist(true)               // Uint8Array (변경 파일 zip), 또는 null
  → 빈/누락 시 토스트 "변경 없음"
  → bytes.length > 3.5MB 시 토스트 "용량 초과"
  → bytesToBase64(bytes)
  → localStorage.setItem("dosbox-user-state", b64)
  → refreshHasUserState() (toolbar의 🗑 표시 갱신)
  → 토스트 "저장됨 (NN KB)"
```

**로드:**
```
페이지 로드 → DosFrame useEffect
  → fetch /dos.jsdos → Uint8Array (serverBundle)
  → readUserState() → Uint8Array | null (overlay)
  → new DosEmulator({ canvas, bundle: serverBundle, overlay, ... })
  → emulators.dosboxXDirect(overlay ? [serverBundle, overlay] : [serverBundle])
```

**삭제:**
```
[🗑] 클릭
  → window.confirm("...")
  → clearUserState() (localStorage.removeItem)
  → window.location.reload() — 서버 번들만으로 깨끗하게 재시작
```

### DosEmulator 변경

```ts
export interface DosEmulatorOpts {
  canvas: HTMLCanvasElement;
  bundle: Uint8Array;
  overlay?: Uint8Array | null;   // ← 신규: 사용자 저장 overlay
  onReady?: (ci: CommandInterface) => void;
  onFirstFrame?: () => void;
  onError?: (err: unknown) => void;
}
```

`boot()` 내부:
```ts
const initFs = this.opts.overlay
  ? [this.opts.bundle, this.opts.overlay]
  : [this.opts.bundle];
const ci = await emu.dosboxXDirect(initFs);
```

### `user-state.ts` 인터페이스

```ts
const STORAGE_KEY = "dosbox-user-state";

export function readUserState(): Uint8Array | null;
export function writeUserState(bytes: Uint8Array): void;  // localStorage.setItem이 QuotaExceededError 던질 수 있음
export function clearUserState(): void;
export function hasUserState(): boolean;
```

base64 헬퍼는 모듈 내부 private:
```ts
function bytesToBase64(bytes: Uint8Array): string {
  let bin = "";
  const CHUNK = 0x8000;  // 32K — apply의 max args 회피
  for (let i = 0; i < bytes.length; i += CHUNK)
    bin += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  return btoa(bin);
}
function base64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}
```

### `use-user-state.ts` hook

```ts
export function useUserState(): [boolean, () => void] {
  // SSR-safe: 초기 false, useEffect로 localStorage 읽음
  const [hasSave, setHasSave] = useState(false);
  useEffect(() => { setHasSave(hasUserState()); }, []);
  const refresh = useCallback(() => { setHasSave(hasUserState()); }, []);
  return [hasSave, refresh];
}
```

### Toolbar UI

**좌 → 우 배치:**
```
[⌨] [해상도 ▾] | [🗑] [⤴ 내 저장] | (관리자 영역)
```

- `🗑`: hasUserState일 때만 렌더. `toolbar__icon` 변형 (얇은 ghost 보더).
- `⤴ 내 저장`: 항상 렌더. `toolbar__ghost` (얇은 ghost). 저장 중엔 disabled + 라벨 "저장 중…".
- 관리자 영역:
  - 비로그인: `[관리자]` (로그인 진입)
  - 관리자: `[관리자 저장]` (accent — 기존 `toolbar__save` 스타일) + `[로그아웃]`

기존 `Toolbar` props는 다음 5개가 신규 추가:
```ts
savingUserState: boolean;
hasUserState: boolean;
onUserSave: () => void;
onUserDelete: () => void;
// (기존 onSave는 관리자용으로 유지, 버튼 라벨만 "저장"→"관리자 저장")
```

### `_index.tsx` 콜백

```ts
const [savingUserState, setSavingUserState] = useState(false);
const [hasUserState, refreshHasUserState] = useUserState();

const onUserSave = useCallback(async () => {
  const ci = ciRef.current;
  if (!ci) return;
  setSavingUserState(true);
  setStatus(null);
  try {
    const persisted = await ci.persist(true);
    const bytes = persisted instanceof Uint8Array ? persisted : null;
    if (!bytes || bytes.length === 0) { setStatus("변경 없음"); return; }
    if (bytes.length > 3_500_000) {
      setStatus(`저장 실패: 용량 초과 (${(bytes.length/1024/1024).toFixed(1)}MB)`);
      return;
    }
    try { writeUserState(bytes); }
    catch (err) {
      setStatus(err instanceof Error ? `저장 실패: ${err.message}` : "저장 실패");
      return;
    }
    refreshHasUserState();
    setStatus(`저장됨 (${(bytes.length/1024).toFixed(0)}KB)`);
  } catch (err) {
    setStatus(err instanceof Error ? err.message : String(err));
  } finally {
    setSavingUserState(false);
  }
}, [refreshHasUserState]);

const onUserDelete = useCallback(() => {
  if (!window.confirm("저장된 상태를 삭제하고 처음부터 시작합니다. 진행할까요?")) return;
  clearUserState();
  window.location.reload();
}, []);
```

`DosFrame`은 overlay를 **prop으로 받지 않는다.** 그 대신 boot useEffect 안에서 `readUserState()`를 직접 호출 — _index의 hook 상태에 의존하지 않으므로 useEffect 의존성/리렌더 사이클이 단순해진다. _index는 `useUserState`로 toolbar UI만 관리.

```ts
// DosFrame.tsx boot 내부
const bundle = new Uint8Array(await (await fetch(bundleUrl)).arrayBuffer());
const overlay = readUserState();
emulator = new DosEmulator({ canvas: ref.current, bundle, overlay, onReady, onFirstFrame, onError });
```

## State & persistence

| key | 설명 | 형식 |
|---|---|---|
| `dosbox-user-state` | 사용자 저장 (zip 압축 후 base64) | base64 string |
| `dosbox-resolution` | (기존) | unchanged |
| `dosbox-virtual-keyboard` | (기존) | unchanged |

## Save flow vs Admin flow

| | 내 저장 (신규) | 관리자 저장 (기존) |
|---|---|---|
| Trigger | `⤴ 내 저장` 버튼 | `관리자 저장` 버튼 (로그인 후) |
| Source | `ci.persist(true)` | `ci.persist(true)` (동일) |
| Destination | `localStorage["dosbox-user-state"]` | `POST /api/save` → 서버 `~/dos` |
| Scope | 이 사용자, 이 브라우저 | 전체 사용자 (다음 빌드부터) |
| Load | 부팅 시 자동 overlay | 서버 번들 재생성에 반영 |
| 충돌 | 두 채널은 독립. localStorage overlay가 항상 서버 번들 위에 적용됨. 관리자 저장 후 사용자 저장이 stale해질 수 있으나(예: 관리자가 게임 자체를 교체), 보통 게임 save 파일들은 격리되어 있어 영향 없음. 충돌 시 사용자가 🗑로 삭제. |

## Edge cases

- **빈 변경 (`persist(true)` returns null/empty)** → 토스트 "변경 없음". localStorage 미변경.
- **3.5MB 초과** → 토스트 "저장 실패: 용량 초과". 저장 시도 안 함 (base64 인코딩 후 ~4.7MB로 5MB localStorage 한도 위협).
- **QuotaExceededError** (다른 키들 합쳐서 quota 부족 시) → 토스트 "저장 실패: {error message}".
- **저장 중 사용자가 다시 누름** → 버튼 `disabled={savingUserState}`로 차단.
- **저장 도중 unmount** → `ci.exit()`이 cleanup에서 호출되지만 `ci.persist`는 이미 await 중. 실패해도 try/catch가 잡음 → 토스트로 메시지. 데이터 손실 가능성 인지.
- **서버 번들 변경 후 stale overlay** → 무시. 사용자가 게임 깨지면 🗑로 삭제.

## Testing

자동 테스트 프레임워크 없음. 수동 검증:
1. 게임 진행 → `⤴ 내 저장` → 토스트 확인
2. 페이지 reload → 이전 상태에서 시작되는지 확인
3. 툴바에 🗑 노출되는지 확인
4. `🗑` → confirm → reload → 처음 상태로 돌아왔는지 확인
5. 관리자 저장과 충돌 없는지 (양쪽 다 정상 동작)

## Migration

기존 사용자의 localStorage엔 `dosbox-user-state` 키가 없음 → 신규 사용자처럼 첫 부팅엔 overlay 없이 시작. 별도 마이그레이션 불필요.

## Risks

- **localStorage quota** — 사용자가 큰 파일을 잔뜩 만들면 저장 실패. 3.5MB 가드로 사전 차단. 잘못 알려진 quota는 setItem이 던지는 에러로 표면화.
- **base64 인코딩 비용** — 1MB → ~33ms (`String.fromCharCode` chunked 패턴 기준). 사용자 입장에선 저장 버튼 누른 후 잠시 멈춤. 토스트 "저장 중…" 라벨로 피드백.
- **stale overlay × 새 번들** — 사용자 게임 깨질 수 있음. UX는 "직접 삭제"로 해결.
- **persist API의 비결정성** — `persist(true)`가 "변경분"의 정의가 라이브러리 내부 구현에 의존. 동일한 상태에서 두 번 persist 호출 시 결과가 항상 동일하다는 보장은 없으나 실용상 문제없음.
