"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export default function LoginPage() {
  const router = useRouter();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);

    const res = await fetch("/api/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username, password }),
    });

    if (res.ok) {
      router.push("/");
      router.refresh();
    } else {
      const data = await res.json().catch(() => ({}));
      setError(data.error ?? "로그인에 실패했습니다.");
      setBusy(false);
    }
  }

  return (
    <main className="flex min-h-dvh items-center justify-center px-6">
      <form onSubmit={onSubmit} className="w-full max-w-sm">
        <div
          className="mx-auto flex h-12 w-12 items-center justify-center rounded-xl text-xl"
          style={{ background: "var(--accent)" }}
        >
          ✍️
        </div>

        <h1 className="mt-6 text-center text-2xl font-semibold tracking-tight">리플레이</h1>
        <p className="mt-2 text-center text-sm" style={{ color: "var(--muted)" }}>
          당신의 이야기를, 당신의 말로.
        </p>

        <div className="mt-8 space-y-2.5">
          <input
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            placeholder="아이디"
            autoComplete="username"
            className="w-full rounded-xl border px-4 py-3 text-sm outline-none transition focus:border-[var(--accent)] placeholder:text-[var(--muted)]"
            style={{ background: "var(--elevated)", borderColor: "var(--border)" }}
          />
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="비밀번호"
            autoComplete="current-password"
            className="w-full rounded-xl border px-4 py-3 text-sm outline-none transition focus:border-[var(--accent)] placeholder:text-[var(--muted)]"
            style={{ background: "var(--elevated)", borderColor: "var(--border)" }}
          />
        </div>

        {error && (
          <p className="mt-3 text-sm" style={{ color: "var(--accent)" }}>
            {error}
          </p>
        )}

        <button
          type="submit"
          disabled={busy || !username || !password}
          className="mt-5 w-full rounded-xl px-4 py-3 text-sm font-medium transition hover:opacity-90 disabled:opacity-40"
          style={{ background: "var(--accent)", color: "#fff" }}
        >
          {busy ? "확인 중…" : "들어가기"}
        </button>
      </form>
    </main>
  );
}
