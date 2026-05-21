import { ResolutionPicker, type ResolutionId } from "./ResolutionPicker";

export interface ToolbarProps {
  isAdmin: boolean;
  saving: boolean;
  resolutionId: ResolutionId;
  onResolutionChange: (id: ResolutionId) => void;
  vkbVisible: boolean;
  onVkbToggle: () => void;
  // Per-user state save
  savingUserState: boolean;
  hasUserState: boolean;
  onUserSave: () => void;
  onUserDelete: () => void;
  // Admin actions
  onLoginClick: () => void;
  onLogout: () => void;
  onSave: () => void;
  // CPU cycles control
  cycles: number;
  onCyclesUp: () => void;
  onCyclesDown: () => void;
}

export function Toolbar({
  isAdmin,
  saving,
  resolutionId,
  onResolutionChange,
  vkbVisible,
  onVkbToggle,
  savingUserState,
  hasUserState,
  onUserSave,
  onUserDelete,
  onLoginClick,
  onLogout,
  onSave,
  cycles,
  onCyclesUp,
  onCyclesDown,
}: ToolbarProps) {
  return (
    <header className="toolbar">
      <h1 className="toolbar__brand">
        <span className="toolbar__brand-name">DOSBOX</span>
        <span className="toolbar__brand-cursor" aria-hidden="true">_</span>
      </h1>
      <div className="toolbar__right">
        <button
          type="button"
          onClick={onVkbToggle}
          className={`toolbar__icon ${vkbVisible ? "toolbar__icon--active" : ""}`}
          title="가상 키보드"
          aria-pressed={vkbVisible}
          aria-label="가상 키보드 토글"
        >
          <IconKeyboard />
        </button>
        <ResolutionPicker value={resolutionId} onChange={onResolutionChange} />
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
        <span className="toolbar__sep" aria-hidden="true" />
        {hasUserState && (
          <button
            type="button"
            onClick={onUserDelete}
            className="toolbar__icon"
            title="이 브라우저의 저장 삭제"
            aria-label="저장 상태 삭제"
          >
            <IconTrash />
          </button>
        )}
        <button
          type="button"
          onClick={onUserSave}
          disabled={savingUserState}
          className="toolbar__icon"
          title="이 브라우저에 저장"
          aria-label="이 브라우저에 저장"
          data-loading={savingUserState || undefined}
        >
          {savingUserState ? <IconSpinner /> : <IconFloppy />}
        </button>
        <span className="toolbar__sep" aria-hidden="true" />
        {isAdmin ? (
          <>
            <button
              type="button"
              onClick={onSave}
              disabled={saving}
              className="toolbar__icon toolbar__icon--primary"
              title="서버에 저장 (모두에게 적용)"
              aria-label="서버에 저장"
              data-loading={saving || undefined}
            >
              {saving ? <IconSpinner /> : <IconCloudUp />}
            </button>
            <button
              type="button"
              onClick={onLogout}
              className="toolbar__icon"
              title="로그아웃"
              aria-label="로그아웃"
            >
              <IconPower />
            </button>
          </>
        ) : (
          <button
            type="button"
            onClick={onLoginClick}
            className="toolbar__icon"
            title="관리자 로그인"
            aria-label="관리자 로그인"
          >
            <IconKey />
          </button>
        )}
      </div>
    </header>
  );
}

/* ── Icons ─────────────────────────────────────────────────────────
   Stroke-based 16×16 glyphs, 1.2 line-weight, round caps — matches
   the chevron in ResolutionPicker so the whole toolbar reads as one
   icon family. Sized down to 14×14 inside 26px chrome.
   ────────────────────────────────────────────────────────────────── */

const svgProps = {
  width: 14,
  height: 14,
  viewBox: "0 0 16 16",
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 1.2,
  strokeLinecap: "round" as const,
  strokeLinejoin: "round" as const,
  "aria-hidden": true,
};

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

function IconKeyboard() {
  return (
    <svg {...svgProps}>
      <rect x="1.5" y="3.75" width="13" height="8.5" rx="1.3" />
      <path d="M3.7 6.6h.01M5.7 6.6h.01M7.7 6.6h.01M9.7 6.6h.01M11.7 6.6h.01M13 6.6h.01" />
      <path d="M3.7 9.1h.01M5.7 9.1h.01M9.7 9.1h.01M11.7 9.1h.01" />
      <path d="M5.4 10.9h5.2" />
    </svg>
  );
}

function IconTrash() {
  return (
    <svg {...svgProps}>
      <path d="M2.6 4.4h10.8" />
      <path d="M6 4.4V2.7c0-.3.2-.5.5-.5h3c.3 0 .5.2.5.5v1.7" />
      <path d="M4.4 4.4l.6 8.7c0 .4.4.7.8.7h4.4c.4 0 .8-.3.8-.7l.6-8.7" />
      <path d="M6.6 7v4.4M9.4 7v4.4" />
    </svg>
  );
}

function IconFloppy() {
  // 3.5" disk — the retro DOS-era save metaphor for per-browser state.
  return (
    <svg {...svgProps}>
      <path d="M2.5 2.5h8.7l2.3 2.3v8.7c0 .3-.2.5-.5.5H3a.5.5 0 0 1-.5-.5V3c0-.3.2-.5.5-.5z" />
      <path d="M5 2.5v3.4c0 .3.2.5.5.5h4.6c.3 0 .5-.2.5-.5V2.5" />
      <path d="M9.4 3.4v2" />
      <path d="M4.5 9h7v5h-7z" />
    </svg>
  );
}

function IconCloudUp() {
  // Cloud + up-arrow — server-wide admin save.
  return (
    <svg {...svgProps}>
      <path d="M4.7 11.5a2.7 2.7 0 0 1 .3-5.3 3.6 3.6 0 0 1 6.8-.6 2.4 2.4 0 0 1 .5 4.7" />
      <path d="M8 13.8V8" />
      <path d="M5.8 10.1L8 7.9l2.2 2.2" />
    </svg>
  );
}

function IconKey() {
  return (
    <svg {...svgProps}>
      <circle cx="5.2" cy="10.8" r="2.4" />
      <path d="M7 9l6-6" />
      <path d="M11 5l1.6 1.6" />
      <path d="M9.4 6.6L11 8.2" />
    </svg>
  );
}

function IconPower() {
  return (
    <svg {...svgProps}>
      <path d="M8 2.4v5.4" />
      <path d="M11.6 4.6a4.6 4.6 0 1 1-7.2 0" />
    </svg>
  );
}

function IconSpinner() {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 16 16"
      fill="none"
      aria-hidden="true"
      className="toolbar__spinner"
    >
      <circle
        cx="8"
        cy="8"
        r="5.5"
        stroke="currentColor"
        strokeWidth="1.4"
        strokeLinecap="round"
        strokeDasharray="10 26"
      />
    </svg>
  );
}
