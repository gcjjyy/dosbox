import {
  Keyboard,
  Settings,
  Trash2,
  Save,
  CloudUpload,
  KeyRound,
  Power,
  LoaderCircle,
} from "lucide-react";

export interface ToolbarProps {
  isAdmin: boolean;
  saving: boolean;
  vkbVisible: boolean;
  onVkbToggle: () => void;
  onOptionsClick: () => void;
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

// lucide icons tuned to the toolbar's thin-stroke family: 15px glyph, 1.75
// stroke inside the 26px chrome. (The old hand-rolled set was 14px @ 1.2 on a
// 16 viewBox; 1.75/24 ≈ the same perceived weight.)
const ICON = { size: 15, strokeWidth: 1.75, "aria-hidden": true } as const;

export function Toolbar({
  isAdmin,
  saving,
  vkbVisible,
  onVkbToggle,
  onOptionsClick,
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
          <Keyboard {...ICON} />
        </button>
        <button
          type="button"
          onClick={onOptionsClick}
          className="toolbar__icon"
          title="설정"
          aria-label="설정 열기"
        >
          <Settings {...ICON} />
        </button>
        <span className="toolbar__sep" aria-hidden="true" />
        {hasUserState && (
          <button
            type="button"
            onClick={onUserDelete}
            className="toolbar__icon"
            title="이 브라우저의 저장 삭제"
            aria-label="저장 상태 삭제"
          >
            <Trash2 {...ICON} />
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
          {savingUserState ? <LoaderCircle {...ICON} className="toolbar__spinner" /> : <Save {...ICON} />}
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
              {saving ? <LoaderCircle {...ICON} className="toolbar__spinner" /> : <CloudUpload {...ICON} />}
            </button>
            <button
              type="button"
              onClick={onLogout}
              className="toolbar__icon"
              title="로그아웃"
              aria-label="로그아웃"
            >
              <Power {...ICON} />
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
            <KeyRound {...ICON} />
          </button>
        )}
      </div>
    </header>
  );
}
