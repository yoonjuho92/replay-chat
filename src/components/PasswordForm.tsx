"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export default function PasswordForm({ username }: { username: string }) {
  const router = useRouter();
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const [busy, setBusy] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    if (newPassword !== confirmPassword) {
      setError("새 비밀번호가 서로 다릅니다. 다시 확인해주세요.");
      return;
    }

    setBusy(true);
    const res = await fetch("/api/password", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ currentPassword, newPassword }),
    });
    const data = await res.json().catch(() => ({}));
    setBusy(false);

    if (!res.ok) {
      setError(data.error ?? "비밀번호를 바꾸지 못했습니다.");
      return;
    }

    setDone(true);
    setCurrentPassword("");
    setNewPassword("");
    setConfirmPassword("");
  }

  const field =
    "w-full rounded-xl border px-4 py-3.5 text-[18px] outline-none transition focus:border-[var(--accent)] placeholder:text-[var(--muted)]";
  const fieldStyle = { background: "var(--elevated)", borderColor: "var(--border)" };

  return (
      <main className="flex flex-1 justify-center px-5 py-10">
        <form onSubmit={onSubmit} className="w-full max-w-sm">
          <p className="text-[17px]" style={{ color: "var(--muted)" }}>
            <span style={{ color: "var(--text)" }}>{username}</span> 님의 비밀번호를 바꿉니다.
          </p>

          <div className="mt-7 space-y-3">
            <input
              type="password"
              value={currentPassword}
              onChange={(e) => setCurrentPassword(e.target.value)}
              placeholder="지금 쓰는 비밀번호"
              autoComplete="current-password"
              className={field}
              style={fieldStyle}
            />
            <input
              type="password"
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
              placeholder="새 비밀번호"
              autoComplete="new-password"
              className={field}
              style={fieldStyle}
            />
            <input
              type="password"
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              placeholder="새 비밀번호 다시 한 번"
              autoComplete="new-password"
              className={field}
              style={fieldStyle}
            />
          </div>

          {error && (
            <p className="mt-4 text-[16px]" style={{ color: "var(--accent)" }}>
              {error}
            </p>
          )}

          {done && (
            <p className="mt-4 text-[16px]" style={{ color: "#7fb069" }}>
              비밀번호를 바꿨습니다. 다음 로그인부터 새 비밀번호를 쓰세요.
            </p>
          )}

          <button
            type="submit"
            disabled={busy || !currentPassword || !newPassword || !confirmPassword}
            className="mt-6 w-full rounded-xl px-4 py-3.5 text-[17px] font-semibold transition hover:opacity-90 disabled:opacity-40"
            style={{ background: "var(--accent)", color: "#fff" }}
          >
            {busy ? "바꾸는 중…" : "비밀번호 바꾸기"}
          </button>

          <button
            type="button"
            onClick={() => router.push("/")}
            className="mt-3 w-full rounded-xl border px-4 py-3.5 text-[17px] transition hover:bg-white/5"
            style={{ borderColor: "var(--border)", color: "var(--muted)" }}
          >
            돌아가기
          </button>
        </form>
      </main>
  );
}
