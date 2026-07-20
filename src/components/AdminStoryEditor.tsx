"use client";

import { useState } from "react";

/**
 * 관리자가 어떤 사용자의 가장 최근 이야기를 그 자리에서 고친다. 저장하면 답변 메시지의
 * <story> 블록이 바뀌고, 그 사용자가 새 대화를 열 때 바로 반영된다.
 */
export default function AdminStoryEditor({
  messageId,
  index,
  initialText,
}: {
  messageId: string;
  index: number;
  initialText: string;
}) {
  const [saved, setSaved] = useState(initialText);
  const [text, setText] = useState(initialText);
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  async function save() {
    setBusy(true);
    setError(null);

    const res = await fetch("/api/admin/story", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ messageId, index, text }),
    });
    const data = await res.json().catch(() => ({}));
    setBusy(false);

    if (!res.ok) {
      setError(data.error ?? "고치지 못했습니다.");
      return;
    }

    const next = data.text ?? text.trim();
    setSaved(next);
    setText(next);
    setEditing(false);
    setDone(true);
    setTimeout(() => setDone(false), 2000);
  }

  function cancel() {
    setText(saved);
    setEditing(false);
    setError(null);
  }

  if (!editing) {
    return (
      <div>
        <div className="flex items-start justify-between gap-3">
          <p className="flex-1 text-[17px] leading-[1.95] whitespace-pre-wrap">{saved}</p>
          <button
            onClick={() => {
              setDone(false);
              setEditing(true);
            }}
            className="shrink-0 rounded-lg border px-3 py-1.5 text-[14px] transition hover:bg-black/5"
            style={{ borderColor: "var(--border)", color: "var(--muted)" }}
          >
            고치기
          </button>
        </div>
        {done && (
          <p className="mt-2 text-[14px]" style={{ color: "#7fb069" }}>
            고쳤습니다. 새 대화에 반영됩니다.
          </p>
        )}
      </div>
    );
  }

  return (
    <div>
      <textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        rows={Math.min(Math.max(text.split("\n").length + 1, 6), 24)}
        className="w-full resize-y rounded-xl border px-4 py-3 text-[17px] leading-[1.95] outline-none transition focus:border-[var(--accent)]"
        style={{ background: "var(--elevated)", borderColor: "var(--border)" }}
      />

      {error && (
        <p className="mt-2 text-[15px]" style={{ color: "var(--accent)" }}>
          {error}
        </p>
      )}

      <div className="mt-3 flex items-center gap-2">
        <button
          onClick={save}
          disabled={busy || !text.trim() || text.trim() === saved.trim()}
          className="rounded-lg px-4 py-2 text-[15px] font-semibold transition hover:opacity-90 disabled:opacity-40"
          style={{ background: "var(--accent)", color: "#fff" }}
        >
          {busy ? "저장 중…" : "저장"}
        </button>
        <button
          onClick={cancel}
          disabled={busy}
          className="rounded-lg border px-4 py-2 text-[15px] transition hover:bg-black/5 disabled:opacity-40"
          style={{ borderColor: "var(--border)", color: "var(--muted)" }}
        >
          취소
        </button>
      </div>
    </div>
  );
}
