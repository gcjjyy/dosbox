export interface ToolbarProps {
  isAdmin: boolean;
  saving: boolean;
  onLoginClick: () => void;
  onLogout: () => void;
  onSave: () => void;
}

export function Toolbar({ isAdmin, saving, onLoginClick, onLogout, onSave }: ToolbarProps) {
  return (
    <header className="flex h-10 items-center justify-between border-b border-gray-800 bg-gray-950 px-3 text-sm text-gray-100">
      <h1 className="font-mono text-xs tracking-widest text-gray-400">dosbox.gcjjyy.dev</h1>
      <div className="flex items-center gap-2">
        {isAdmin ? (
          <>
            <button
              onClick={onSave}
              disabled={saving}
              className="rounded bg-emerald-600 px-3 py-1 text-xs font-medium disabled:opacity-40"
            >
              {saving ? "저장 중..." : "저장"}
            </button>
            <button onClick={onLogout} className="rounded px-2 py-1 text-xs text-gray-400 hover:text-gray-100">
              로그아웃
            </button>
          </>
        ) : (
          <button onClick={onLoginClick} className="rounded px-2 py-1 text-xs text-gray-400 hover:text-gray-100">
            관리자
          </button>
        )}
      </div>
    </header>
  );
}
