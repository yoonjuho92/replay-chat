"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";

type Attachment = { id: string; url: string };
type Message = { id: string; role: string; content: string; images: Attachment[] };
type Conversation = { id: string; title: string; updated_at: string };

export default function Chat({ username }: { username: string }) {
  const router = useRouter();

  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [drawerOpen, setDrawerOpen] = useState(false);

  const [input, setInput] = useState("");
  const [pending, setPending] = useState<Attachment[]>([]);
  const [streaming, setStreaming] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [recording, setRecording] = useState(false);
  const [transcribing, setTranscribing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fileInput = useRef<HTMLInputElement>(null);
  const textarea = useRef<HTMLTextAreaElement>(null);
  const bottom = useRef<HTMLDivElement>(null);
  const recorder = useRef<MediaRecorder | null>(null);
  const chunks = useRef<Blob[]>([]);

  const loadConversations = useCallback(async () => {
    const res = await fetch("/api/conversations");
    if (res.ok) setConversations((await res.json()).conversations ?? []);
  }, []);

  useEffect(() => {
    loadConversations();
  }, [loadConversations]);

  useEffect(() => {
    bottom.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, streaming]);

  // 서랍이 열려 있을 때 뒤 화면이 같이 스크롤되지 않게 막는다.
  useEffect(() => {
    document.body.style.overflow = drawerOpen ? "hidden" : "";
    return () => {
      document.body.style.overflow = "";
    };
  }, [drawerOpen]);

  useEffect(() => {
    const el = textarea.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 180)}px`;
  }, [input]);

  async function openConversation(id: string) {
    setDrawerOpen(false);
    setConversationId(id);
    setError(null);
    setStreaming(null);
    const res = await fetch(`/api/conversations/${id}`);
    if (res.ok) setMessages((await res.json()).messages ?? []);
  }

  function newConversation() {
    setDrawerOpen(false);
    setConversationId(null);
    setMessages([]);
    setInput("");
    setPending([]);
    setError(null);
    setStreaming(null);
  }

  async function deleteConversation(id: string, e: React.MouseEvent) {
    e.stopPropagation();
    if (!confirm("이 이야기를 지울까요? 되돌릴 수 없습니다.")) return;
    await fetch(`/api/conversations/${id}`, { method: "DELETE" });
    if (id === conversationId) newConversation();
    loadConversations();
  }

  async function logout() {
    await fetch("/api/logout", { method: "POST" });
    router.push("/login");
    router.refresh();
  }

  async function uploadFiles(files: FileList) {
    setUploading(true);
    setError(null);

    for (const file of Array.from(files)) {
      const form = new FormData();
      form.append("file", file);
      const res = await fetch("/api/upload", { method: "POST", body: form });
      const data = await res.json();
      if (res.ok) setPending((prev) => [...prev, { id: data.id, url: data.url }]);
      else setError(data.error ?? "이미지 업로드에 실패했습니다.");
    }

    setUploading(false);
  }

  async function startRecording() {
    setError(null);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mr = new MediaRecorder(stream);
      chunks.current = [];

      mr.ondataavailable = (e) => {
        if (e.data.size > 0) chunks.current.push(e.data);
      };

      mr.onstop = async () => {
        stream.getTracks().forEach((t) => t.stop());
        const blob = new Blob(chunks.current, { type: mr.mimeType || "audio/webm" });
        if (blob.size === 0) return;

        setTranscribing(true);
        const form = new FormData();
        form.append("audio", new File([blob], "recording.webm", { type: blob.type }));

        const res = await fetch("/api/transcribe", { method: "POST", body: form });
        const data = await res.json();
        setTranscribing(false);

        if (!res.ok) {
          setError(data.error ?? "음성 인식에 실패했습니다.");
          return;
        }
        // 바로 보내지 않는다. 입력창에 넣어두고 사용자가 확인한 뒤 엔터를 눌러야 전송된다.
        setInput((prev) => (prev ? `${prev} ${data.text}` : data.text));
        textarea.current?.focus();
      };

      mr.start();
      recorder.current = mr;
      setRecording(true);
    } catch {
      setError("마이크를 사용할 수 없습니다. 브라우저 권한을 확인해주세요.");
    }
  }

  function stopRecording() {
    recorder.current?.stop();
    recorder.current = null;
    setRecording(false);
  }

  async function send() {
    const text = input.trim();
    if ((!text && pending.length === 0) || sending) return;

    const attachmentIds = pending.map((p) => p.id);
    const optimistic: Message = {
      id: `local-${Date.now()}`,
      role: "user",
      content: text,
      images: pending,
    };

    setMessages((prev) => [...prev, optimistic]);
    setInput("");
    setPending([]);
    setSending(true);
    setStreaming("");
    setError(null);

    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ conversationId, text, attachmentIds }),
      });

      if (!res.ok || !res.body) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error ?? "전송에 실패했습니다.");
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      let answer = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const frames = buffer.split("\n\n");
        buffer = frames.pop() ?? "";

        for (const frame of frames) {
          const event = frame.match(/^event: (.+)$/m)?.[1];
          const raw = frame.match(/^data: (.+)$/m)?.[1];
          if (!event || !raw) continue;
          const data = JSON.parse(raw);

          if (event === "start") {
            setConversationId((prev) => prev ?? data.conversationId);
          } else if (event === "delta") {
            answer += data.text;
            setStreaming(answer);
          } else if (event === "error") {
            throw new Error(data.message);
          } else if (event === "done") {
            setMessages((prev) => [
              ...prev,
              {
                id: data.messageId ?? `local-a-${Date.now()}`,
                role: "assistant",
                content: answer,
                images: [],
              },
            ]);
            setStreaming(null);
          }
        }
      }

      loadConversations();
    } catch (err) {
      setError(err instanceof Error ? err.message : "전송에 실패했습니다.");
      setStreaming(null);
    } finally {
      setSending(false);
    }
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    // 한글 조합 중의 엔터는 글자를 확정하는 키다. 여기서 보내면 마지막 글자가 깨진다.
    if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault();
      send();
    }
  }

  const empty = messages.length === 0 && streaming === null;
  const current = conversations.find((c) => c.id === conversationId);

  return (
    <div className="flex h-dvh flex-col" style={{ background: "var(--bg)" }}>
      {/* 상단바 */}
      <header
        className="flex h-14 shrink-0 items-center gap-2 border-b px-2"
        style={{ borderColor: "var(--border)" }}
      >
        <button
          onClick={() => setDrawerOpen(true)}
          className="flex h-11 w-11 items-center justify-center rounded-lg transition hover:bg-white/5"
          style={{ color: "var(--text)" }}
          aria-label="이전 이야기 열기"
        >
          <MenuIcon />
        </button>

        <h1 className="min-w-0 flex-1 truncate text-center text-[17px] font-medium">
          {current?.title ?? "새 이야기"}
        </h1>

        <button
          onClick={newConversation}
          className="flex h-11 w-11 items-center justify-center rounded-lg transition hover:bg-white/5"
          style={{ color: "var(--text)" }}
          aria-label="새 이야기 시작"
        >
          <ComposeIcon />
        </button>
      </header>

      {/* 서랍 */}
      <Drawer
        open={drawerOpen}
        onClose={() => setDrawerOpen(false)}
        conversations={conversations}
        conversationId={conversationId}
        onSelect={openConversation}
        onDelete={deleteConversation}
        onNew={newConversation}
        username={username}
        onLogout={logout}
      />

      {/* 대화 */}
      <div className="flex-1 overflow-y-auto">
        <div className="mx-auto w-full max-w-3xl px-4 py-6">
          {empty ? (
            <div className="mt-[20vh] text-center">
              <div
                className="mx-auto flex h-12 w-12 items-center justify-center rounded-xl text-xl"
                style={{ background: "var(--accent)" }}
              >
                ✍️
              </div>
              <h2 className="mt-6 text-2xl font-semibold tracking-tight">
                어떤 순간을 남겨볼까요?
              </h2>
              <p className="mt-4 text-[17px] leading-[1.8]" style={{ color: "var(--muted)" }}>
                겪었던 일을 편하게, 하시던 말 그대로 들려주세요.
                <br />
                마이크로 말해도 되고, 사진을 함께 올려도 좋아요.
              </p>
            </div>
          ) : (
            <div className="space-y-7">
              {messages.map((m) => (
                <Bubble key={m.id} message={m} />
              ))}

              {streaming !== null && (
                <div className="text-[19px] leading-[2.05] whitespace-pre-wrap">
                  {streaming || (
                    <span style={{ color: "var(--muted)" }}>이야기를 쓰는 중…</span>
                  )}
                  {streaming && <span className="caret">▍</span>}
                </div>
              )}
            </div>
          )}

          <div ref={bottom} />
        </div>
      </div>

      {/* 입력창 */}
      <div className="shrink-0 px-3 pb-4 pt-1">
        <div className="mx-auto w-full max-w-3xl">
          {error && (
            <p className="mb-2 px-1 text-[16px]" style={{ color: "var(--accent)" }}>
              {error}
            </p>
          )}

          <div
            className="rounded-2xl border p-2.5"
            style={{ background: "var(--elevated)", borderColor: "var(--border)" }}
          >
            {pending.length > 0 && (
              <div className="mb-2 flex flex-wrap gap-2 px-1">
                {pending.map((p) => (
                  <div key={p.id} className="relative">
                    {/* Supabase 서명 URL 이라 next/image 최적화를 태우지 않는다 */}
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={p.url} alt="" className="h-20 w-20 rounded-lg object-cover" />
                    <button
                      onClick={() => setPending((prev) => prev.filter((x) => x.id !== p.id))}
                      className="absolute -right-1.5 -top-1.5 flex h-5 w-5 items-center justify-center rounded-full bg-black/80 text-[10px]"
                      aria-label="이미지 제거"
                    >
                      ✕
                    </button>
                  </div>
                ))}
              </div>
            )}

            <textarea
              ref={textarea}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={onKeyDown}
              rows={1}
              placeholder={transcribing ? "말씀하신 내용을 옮기는 중…" : "이야기를 들려주세요…"}
              className="w-full resize-none bg-transparent px-1 py-2 text-[18px] leading-relaxed outline-none placeholder:text-[var(--muted)]"
            />

            <div className="mt-1 flex items-center justify-between">
              {/* 좌하단: 사진 올리기 */}
              <button
                onClick={() => fileInput.current?.click()}
                disabled={uploading}
                className="flex h-12 w-12 items-center justify-center rounded-full border transition hover:bg-white/5 disabled:opacity-40"
                style={{ borderColor: "var(--border)", color: "var(--muted)" }}
                aria-label="사진 올리기"
                title="사진 올리기"
              >
                {uploading ? <Spinner /> : <PlusIcon />}
              </button>

              <input
                ref={fileInput}
                type="file"
                accept="image/png,image/jpeg,image/webp,image/gif"
                multiple
                hidden
                onChange={(e) => {
                  if (e.target.files?.length) uploadFiles(e.target.files);
                  e.target.value = "";
                }}
              />

              {/* 우하단: 마이크 + 보내기 */}
              <div className="flex items-center gap-2">
                <button
                  onClick={recording ? stopRecording : startRecording}
                  disabled={transcribing}
                  className={`flex h-12 w-12 items-center justify-center rounded-full border transition hover:bg-white/5 disabled:opacity-40 ${
                    recording ? "recording" : ""
                  }`}
                  style={{
                    borderColor: recording ? "var(--accent)" : "var(--border)",
                    background: recording ? "var(--accent)" : undefined,
                    color: recording ? "#fff" : "var(--muted)",
                  }}
                  aria-label={recording ? "녹음 끝내기" : "음성으로 말하기"}
                  title={recording ? "녹음 끝내기" : "음성으로 말하기"}
                >
                  {transcribing ? <Spinner /> : recording ? <StopIcon /> : <MicIcon />}
                </button>

                <button
                  onClick={send}
                  disabled={sending || (!input.trim() && pending.length === 0)}
                  className="flex h-12 w-12 items-center justify-center rounded-full transition disabled:opacity-30"
                  style={{ background: "var(--accent)", color: "#fff" }}
                  aria-label="보내기"
                >
                  <ArrowUpIcon />
                </button>
              </div>
            </div>
          </div>

          <p className="mt-2.5 text-center text-[13px]" style={{ color: "var(--muted)" }}>
            Enter 로 보내기 · Shift+Enter 로 줄바꿈
          </p>
        </div>
      </div>
    </div>
  );
}

function Drawer({
  open,
  onClose,
  conversations,
  conversationId,
  onSelect,
  onDelete,
  onNew,
  username,
  onLogout,
}: {
  open: boolean;
  onClose: () => void;
  conversations: Conversation[];
  conversationId: string | null;
  onSelect: (id: string) => void;
  onDelete: (id: string, e: React.MouseEvent) => void;
  onNew: () => void;
  username: string;
  onLogout: () => void;
}) {
  return (
    <>
      <div
        onClick={onClose}
        className={`fixed inset-0 z-40 bg-black/50 transition-opacity duration-300 ${
          open ? "opacity-100" : "pointer-events-none opacity-0"
        }`}
        aria-hidden
      />

      <aside
        className={`fixed inset-y-0 left-0 z-50 flex w-[300px] max-w-[85vw] flex-col border-r transition-transform duration-300 ease-out ${
          open ? "translate-x-0" : "-translate-x-full"
        }`}
        style={{ background: "var(--surface)", borderColor: "var(--border)" }}
        aria-hidden={!open}
      >
        <div
          className="flex h-14 shrink-0 items-center justify-between border-b px-3"
          style={{ borderColor: "var(--border)" }}
        >
          <span className="text-[18px] font-semibold">이야기</span>
          <button
            onClick={onClose}
            className="flex h-11 w-11 items-center justify-center rounded-lg text-lg transition hover:bg-white/5"
            style={{ color: "var(--muted)" }}
            aria-label="닫기"
          >
            ✕
          </button>
        </div>

        <div className="p-3">
          <button
            onClick={onNew}
            className="flex w-full items-center justify-center gap-2 rounded-xl px-3 py-3.5 text-[17px] font-semibold transition hover:opacity-90"
            style={{ background: "var(--accent)", color: "#fff" }}
          >
            <PlusIcon />새 채팅
          </button>
        </div>

        <nav className="flex-1 space-y-0.5 overflow-y-auto px-2 pb-2">
          {conversations.length === 0 && (
            <p className="px-3 py-6 text-center text-[15px]" style={{ color: "var(--muted)" }}>
              아직 남긴 이야기가 없어요.
            </p>
          )}

          {conversations.map((c) => (
            <div
              key={c.id}
              onClick={() => onSelect(c.id)}
              className="group flex cursor-pointer items-center gap-2 rounded-lg px-3 py-3.5 text-[17px] transition hover:bg-white/5"
              style={{ background: c.id === conversationId ? "var(--elevated)" : undefined }}
            >
              <span className="flex-1 truncate">{c.title}</span>
              <button
                onClick={(e) => onDelete(c.id, e)}
                className="shrink-0 text-sm opacity-0 transition group-hover:opacity-100"
                style={{ color: "var(--muted)" }}
                aria-label="이야기 삭제"
              >
                ✕
              </button>
            </div>
          ))}
        </nav>

        <div className="border-t p-2" style={{ borderColor: "var(--border)" }}>
          <Link
            href="/settings"
            className="flex items-center gap-3 rounded-lg px-3 py-3 text-[17px] transition hover:bg-white/5"
            style={{ color: "var(--text)" }}
          >
            <KeyIcon />
            비밀번호 바꾸기
          </Link>

          <div
            className="mt-1 flex items-center justify-between px-3 py-2 text-[15px]"
            style={{ color: "var(--muted)" }}
          >
            <span className="truncate">{username}</span>
            <button onClick={onLogout} className="shrink-0 hover:underline">
              로그아웃
            </button>
          </div>
        </div>
      </aside>
    </>
  );
}

function Bubble({ message }: { message: Message }) {
  if (message.role === "user") {
    return (
      <div className="flex justify-end">
        <div className="max-w-[85%]">
          {message.images.length > 0 && (
            <div className="mb-2 flex flex-wrap justify-end gap-2">
              {message.images.map((img) => (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  key={img.id}
                  src={img.url}
                  alt=""
                  className="max-h-64 rounded-xl object-cover"
                />
              ))}
            </div>
          )}
          {message.content && (
            <div
              className="rounded-2xl px-5 py-3.5 text-[19px] leading-[1.85] whitespace-pre-wrap"
              style={{ background: "var(--elevated)" }}
            >
              {message.content}
            </div>
          )}
        </div>
      </div>
    );
  }

  return <div className="text-[19px] leading-[2.05] whitespace-pre-wrap">{message.content}</div>;
}

function KeyIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="7.5" cy="15.5" r="4.5" />
      <path d="M10.5 12.5 21 2M17 6l3 3M14 9l3 3" />
    </svg>
  );
}

function MenuIcon() {
  return (
    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
      <path d="M3 6h18M3 12h18M3 18h18" />
    </svg>
  );
}

function ComposeIcon() {
  return (
    <svg width="21" height="21" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 20h9" />
      <path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z" />
    </svg>
  );
}

function PlusIcon() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
      <path d="M12 5v14M5 12h14" />
    </svg>
  );
}

function MicIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
      <rect x="9" y="2" width="6" height="12" rx="3" />
      <path d="M5 11a7 7 0 0 0 14 0" />
      <path d="M12 18v4" />
    </svg>
  );
}

function StopIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
      <rect x="5" y="5" width="14" height="14" rx="2" />
    </svg>
  );
}

function ArrowUpIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 19V5M5 12l7-7 7 7" />
    </svg>
  );
}

function Spinner() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" className="animate-spin" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
      <path d="M12 3a9 9 0 1 0 9 9" />
    </svg>
  );
}
