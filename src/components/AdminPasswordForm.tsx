"use client";

import { useState } from "react";

type User = { id: string; username: string };

export default function AdminPasswordForm({ users }: { users: User[] }) {
  const [userId, setUserId] = useState(users[0]?.id ?? "");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setDone(null);

    if (newPassword !== confirmPassword) {
      setError("새 비밀번호가 서로 다릅니다. 다시 확인해주세요.");
      return;
    }

    setBusy(true);
    const res = await fetch("/api/admin/password", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ userId, newPassword }),
    });
    const data = await res.json().catch(() => ({}));
    setBusy(false);

    if (!res.ok) {
      setError(data.error ?? "비밀번호를 바꾸지 못했습니다.");
      return;
    }

    setDone(`${data.username} 님의 비밀번호를 바꿨습니다.`);
    setNewPassword("");
    setConfirmPassword("");
  }

  const field =
    "w-full rounded-xl border px-4 py-3.5 text-[18px] outline-none transition focus:border-[var(--accent)] placeholder:text-[var(--muted)]";
  const fieldStyle = { background: "var(--elevated)", borderColor: "var(--border)" };

  return (
    <main className="mx-auto w-full max-w-sm flex-1 px-5 py-10">
      <h1 className="text-2xl font-semibold tracking-tight">비밀번호 바꾸기</h1>
      <p className="mt-2 text-[16px]" style={{ color: "var(--muted)" }}>
        사용자를 고르고 새 비밀번호만 넣으면 됩니다. 지금 쓰는 비밀번호는 몰라도 됩니다.
      </p>

      <form onSubmit={onSubmit} className="mt-8">
        <label className="mb-2 block text-[15px]" style={{ color: "var(--muted)" }}>
          사용자
        </label>
        <select
          value={userId}
          onChange={(e) => setUserId(e.target.value)}
          className={field}
          style={fieldStyle}
        >
          {users.map((user) => (
            <option key={user.id} value={user.id}>
              {user.username}
            </option>
          ))}
        </select>

        <div className="mt-4 space-y-3">
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
            {done}
          </p>
        )}

        <button
          type="submit"
          disabled={busy || !userId || !newPassword || !confirmPassword}
          className="mt-6 w-full rounded-xl px-4 py-3.5 text-[17px] font-semibold transition hover:opacity-90 disabled:opacity-40"
          style={{ background: "var(--accent)", color: "#fff" }}
        >
          {busy ? "바꾸는 중…" : "비밀번호 바꾸기"}
        </button>
      </form>
    </main>
  );
}
