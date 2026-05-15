import { ResolutionPicker, type ResolutionId } from "./ResolutionPicker";

export interface ToolbarProps {
  isAdmin: boolean;
  saving: boolean;
  resolutionId: ResolutionId;
  onResolutionChange: (id: ResolutionId) => void;
  onLoginClick: () => void;
  onLogout: () => void;
  onSave: () => void;
}

export function Toolbar({
  isAdmin,
  saving,
  resolutionId,
  onResolutionChange,
  onLoginClick,
  onLogout,
  onSave,
}: ToolbarProps) {
  return (
    <header className="toolbar">
      <h1 className="toolbar__brand">dosbox.gcjjyy.dev</h1>
      <div className="toolbar__right">
        <ResolutionPicker value={resolutionId} onChange={onResolutionChange} />
        <span className="toolbar__sep" aria-hidden="true" />
        {isAdmin ? (
          <>
            <button
              onClick={onSave}
              disabled={saving}
              className="toolbar__save"
            >
              {saving ? "저장 중…" : "저장"}
            </button>
            <button onClick={onLogout} className="toolbar__ghost">
              로그아웃
            </button>
          </>
        ) : (
          <button onClick={onLoginClick} className="toolbar__ghost">
            관리자
          </button>
        )}
      </div>
    </header>
  );
}
