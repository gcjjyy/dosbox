import { useState } from "react";

export function LoginModal({ onClose, onSuccess }: { onClose: () => void; onSuccess: () => void }) {
  const [password, setPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      const res = await fetch("/api/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password }),
        credentials: "same-origin",
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.message ?? `HTTP ${res.status}`);
      }
      onSuccess();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/60" onClick={onClose}>
      <form
        onSubmit={submit}
        onClick={(e) => e.stopPropagation()}
        className="w-80 rounded-lg bg-gray-900 p-6 text-gray-100 shadow-xl"
      >
        <h2 className="mb-4 text-lg font-semibold">관리자 로그인</h2>
        <input
          type="password"
          autoFocus
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          placeholder="비밀번호"
          className="w-full rounded border border-gray-700 bg-gray-800 px-3 py-2 outline-none focus:border-gray-400"
        />
        {error && <p className="mt-2 text-sm text-red-400">{error}</p>}
        <div className="mt-4 flex justify-end gap-2">
          <button type="button" onClick={onClose} className="rounded px-3 py-1 text-sm hover:bg-gray-800">취소</button>
          <button
            type="submit"
            disabled={submitting || password.length === 0}
            className="rounded bg-emerald-600 px-3 py-1 text-sm font-medium disabled:opacity-50"
          >
            {submitting ? "..." : "로그인"}
          </button>
        </div>
      </form>
    </div>
  );
}
