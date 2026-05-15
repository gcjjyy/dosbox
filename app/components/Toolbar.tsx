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
}: ToolbarProps) {
  return (
    <header className="toolbar">
      <h1 className="toolbar__brand">dosbox.gcjjyy.dev</h1>
      <div className="toolbar__right">
        <button
          type="button"
          onClick={onVkbToggle}
          className={`toolbar__icon ${vkbVisible ? "toolbar__icon--active" : ""}`}
          title="가상 키보드"
          aria-pressed={vkbVisible}
          aria-label="가상 키보드 토글"
        >
          ⌨
        </button>
        <ResolutionPicker value={resolutionId} onChange={onResolutionChange} />
        <span className="toolbar__sep" aria-hidden="true" />
        {hasUserState && (
          <button
            type="button"
            onClick={onUserDelete}
            className="toolbar__icon"
            title="저장 삭제"
            aria-label="저장 상태 삭제"
          >
            🗑
          </button>
        )}
        <button
          type="button"
          onClick={onUserSave}
          disabled={savingUserState}
          className="toolbar__ghost"
        >
          {savingUserState ? "저장 중…" : "내 저장"}
        </button>
        <span className="toolbar__sep" aria-hidden="true" />
        {isAdmin ? (
          <>
            <button
              type="button"
              onClick={onSave}
              disabled={saving}
              className="toolbar__save"
            >
              {saving ? "저장 중…" : "관리자 저장"}
            </button>
            <button type="button" onClick={onLogout} className="toolbar__ghost">
              로그아웃
            </button>
          </>
        ) : (
          <button type="button" onClick={onLoginClick} className="toolbar__ghost">
            관리자
          </button>
        )}
      </div>
    </header>
  );
}
