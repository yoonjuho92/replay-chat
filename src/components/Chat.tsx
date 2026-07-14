"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { useRealtimeTranscription } from "@/hooks/useRealtimeTranscription";
import { parseStory } from "@/lib/story";
import { normalizeImage } from "@/lib/normalize-image";

/** /admin 에 들어갈 수 있는 사람. 서버에서 한 번 더 막으므로 여기선 링크 노출용일 뿐이다. */
const ADMINS = ["윤주호"];

/**
 * 답을 기다리는 중이라는 표시. 다른 탭에 갔다 오는 사이 브라우저가 이 탭을 통째로
 * 버리고 새로 띄우는 일이 있어서(특히 아이폰), 무엇을 기다리던 중이었는지 남겨 둔다.
 */
const PENDING_KEY = "replay-chat:pending";
type Pending = { id: string; answer: string; scenes: string[] | null };

/** 답이 끝나기 전에 스트림이 끊겼다. 서버는 계속 그리고 있으니 기다렸다 받아오면 된다. */
class StreamDropped extends Error {}

function savePending(pending: Pending) {
  try {
    localStorage.setItem(PENDING_KEY, JSON.stringify(pending));
  } catch {
    // 사파리 사생활 보호 모드 같은 데선 저장이 막힌다. 없어도 그만이다.
  }
}

function readPending(): Pending | null {
  try {
    const raw = localStorage.getItem(PENDING_KEY);
    return raw ? (JSON.parse(raw) as Pending) : null;
  } catch {
    return null;
  }
}

function clearPending() {
  try {
    localStorage.removeItem(PENDING_KEY);
  } catch {
    // 지울 게 없으면 그만이다.
  }
}

/**
 * 스트림이 끊겨도 서버는 답을 끝까지 써서 DB 에 남긴다. 답이 들어올 때까지 5초마다
 * 대화를 다시 불러 본다. 그림 세 장이면 2분까지도 걸리므로 넉넉히 기다린다.
 */
async function pollForAnswer(id: string) {
  for (let i = 0; i < 40; i++) {
    const res = await fetch(`/api/conversations/${id}`).catch(() => null);

    if (res?.ok) {
      const messages: Message[] = (await res.json()).messages ?? [];
      if (messages.at(-1)?.role === "assistant") return messages;
    }

    await new Promise((resolve) => setTimeout(resolve, 5000));
  }

  return null;
}

type Attachment = { id: string; url: string; caption?: string | null };
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
  const [streamImages, setStreamImages] = useState<Attachment[]>([]);
  const [drawing, setDrawing] = useState<string[] | null>(null);
  const [sending, setSending] = useState(false);
  // 연결이 끊겨 서버가 다 쓴 답을 기다리는 중.
  const [recovering, setRecovering] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // 기다리던 답이 늦게 도착했을 때, 그 사이 사용자가 다른 이야기를 열었으면 앉히면 안 된다.
  const viewing = useRef<string | null>(null);

  const fileInput = useRef<HTMLInputElement>(null);
  const textarea = useRef<HTMLTextAreaElement>(null);
  const bottom = useRef<HTMLDivElement>(null);

  const mic = useRealtimeTranscription();
  // 녹음을 시작한 순간 이미 입력창에 있던 글. 받아쓰는 말은 이 뒤에 붙는다.
  const beforeMic = useRef("");

  const loadConversations = useCallback(async () => {
    const res = await fetch("/api/conversations");
    if (res.ok) setConversations((await res.json()).conversations ?? []);
  }, []);

  useEffect(() => {
    // 화면에 처음 들어왔을 때 지난 이야기 목록을 받아온다.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    loadConversations();
  }, [loadConversations]);

  useEffect(() => {
    // 그림을 그리는 사이 다른 탭에 다녀오면 브라우저가 이 탭을 버렸다 새로 띄우기도 한다.
    // 서버는 아랑곳없이 계속 그리고 있으니, 그리던 화면을 되살리고 답이 들어오길 기다린다.
    const pending = readPending();
    if (!pending) return;

    viewing.current = pending.id;

    /* eslint-disable react-hooks/set-state-in-effect */
    setConversationId(pending.id);
    setStreaming(pending.answer);
    setDrawing(pending.scenes);
    setRecovering(true);
    /* eslint-enable react-hooks/set-state-in-effect */

    fetch(`/api/conversations/${pending.id}`)
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => setMessages(data?.messages ?? []))
      .catch(() => {});

    pollForAnswer(pending.id).then((list) => {
      clearPending();
      if (viewing.current !== pending.id) return;

      setRecovering(false);
      setStreaming(null);
      setStreamImages([]);
      setDrawing(null);

      if (!list) {
        setError("답을 받아오지 못했습니다. 잠시 뒤 다시 보내주세요.");
        return;
      }
      setMessages(list);
      loadConversations();
    });
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

  // 말하는 동안 받아쓴 글이 입력창에 실시간으로 차오른다.
  // 전송은 여전히 사용자가 엔터를 눌러야만 일어난다.
  useEffect(() => {
    if (!mic.recording && !mic.connecting) return;

    const before = beforeMic.current;
    const spoken = mic.transcript;
    setInput(before && spoken ? `${before} ${spoken}` : before || spoken);
  }, [mic.transcript, mic.recording, mic.connecting]);

  async function openConversation(id: string) {
    viewing.current = id;
    setDrawerOpen(false);
    setConversationId(id);
    setError(null);
    setStreaming(null);
    const res = await fetch(`/api/conversations/${id}`);
    if (res.ok) setMessages((await res.json()).messages ?? []);
  }

  function newConversation() {
    viewing.current = null;
    setDrawerOpen(false);
    setConversationId(null);
    setMessages([]);
    setInput("");
    setPending([]);
    setError(null);
    setStreaming(null);
    setDrawing(null);
    setStreamImages([]);
    setRecovering(false);
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
      // 휴대폰이 heic 로 저장한 사진은 그림 모델이 못 읽는다. 올리기 전에 jpg 로 맞춘다.
      form.append("file", await normalizeImage(file));
      const res = await fetch("/api/upload", { method: "POST", body: form });
      const data = await res.json();
      if (res.ok) setPending((prev) => [...prev, { id: data.id, url: data.url }]);
      else setError(data.error ?? "이미지 업로드에 실패했습니다.");
    }

    setUploading(false);
  }

  // AI 가 답하는 동안(그림을 그리는 동안도) 마이크는 잠긴다. 받아쓴 말이 다음 차례에
  // 섞여 들어가고, 아직 안 끝난 답변에 대고 말하게 되기 때문이다.
  const micLocked = sending || recovering;
  const micLabel = drawing
    ? "그림을 그리는 동안은 말할 수 없습니다"
    : micLocked
      ? "답을 쓰는 동안은 말할 수 없습니다"
      : mic.recording
        ? "말 그만하기"
        : "음성으로 말하기";

  function toggleMic() {
    if (mic.recording || mic.connecting) {
      mic.stop();
      textarea.current?.focus();
      return;
    }

    if (micLocked) return;

    setError(null);
    beforeMic.current = input.trim();
    mic.start();
  }

  async function send() {
    // 보내는 순간 마이크는 꺼진다. 안 그러면 보낸 뒤에도 계속 받아써서 입력창에 다시 쌓인다.
    if (mic.recording || mic.connecting) mic.stop();

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
    setStreamImages([]);
    setDrawing(null);
    setError(null);

    // 새 대화면 지금 막 서버가 만들어 준 id 다. state 는 아직 이 클로저에 안 보인다.
    let activeId = conversationId;

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
      // done 이벤트를 받아야 답이 끝난 것이다. 그전에 스트림이 닫히면 끊긴 거다.
      let finished = false;
      const drawn: Attachment[] = [];

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
            activeId = data.conversationId;
            viewing.current = data.conversationId;
            setConversationId((prev) => prev ?? data.conversationId);
            savePending({ id: data.conversationId, answer: "", scenes: null });
          } else if (event === "delta") {
            answer += data.text;
            setStreaming(answer);
          } else if (event === "drawing") {
            setDrawing(data.scenes ?? []);
            // 그림은 몇 분씩 걸린다. 그 사이 이 탭이 버려져도 무엇을 그리던 중이었는지 알게 남긴다.
            if (activeId) savePending({ id: activeId, answer, scenes: data.scenes ?? [] });
          } else if (event === "image") {
            // 세 장을 한꺼번에 그린다. 다 끝나야(done) 그리기가 끝난 것이다.
            drawn.push({ id: `drawn-${drawn.length}`, url: data.url, caption: data.caption });
            setStreamImages([...drawn]);
          } else if (event === "error") {
            throw new Error(data.message);
          } else if (event === "done") {
            finished = true;
            setMessages((prev) => [
              ...prev,
              {
                id: data.messageId ?? `local-a-${Date.now()}`,
                role: "assistant",
                content: answer,
                images: drawn,
              },
            ]);
            clearPending();
            setStreaming(null);
            setStreamImages([]);
            setDrawing(null);
          }
        }
      }

      // 다른 탭에 다녀오면 브라우저가 이 연결을 정리해 버린다. 그때 read() 가 터지기도 하고
      // (사파리는 "Load failed"), 아무 일 없었다는 듯 스트림만 조용히 닫히기도 한다. 둘 다 끊긴 거다.
      if (!finished) throw new StreamDropped();

      loadConversations();
    } catch (err) {
      // 끊긴 것뿐이면 서버는 아랑곳없이 그림을 다 그리고 답을 DB 에 남긴다. 그러니 "그리는 중"
      // 표시를 지우지 말고 그대로 둔 채, 답이 들어올 때까지 기다렸다 보여준다.
      const dropped = err instanceof StreamDropped || err instanceof TypeError;

      if (dropped && activeId) {
        const id = activeId;
        setRecovering(true);
        pollForAnswer(id).then((list) => {
          clearPending();
          if (viewing.current !== id) return;

          setRecovering(false);
          setStreaming(null);
          setStreamImages([]);
          setDrawing(null);

          if (!list) {
            setError("답을 받아오지 못했습니다. 잠시 뒤 다시 보내주세요.");
            return;
          }
          setConversationId(id);
          setMessages(list);
          loadConversations();
        });
      } else {
        clearPending();
        setStreaming(null);
        setStreamImages([]);
        setDrawing(null);
        setError(err instanceof Error ? err.message : "전송에 실패했습니다.");
      }
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
          className="flex h-11 w-11 items-center justify-center rounded-lg transition hover:bg-black/5"
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
          className="flex h-11 w-11 items-center justify-center rounded-lg transition hover:bg-black/5"
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
        admin={ADMINS.includes(username)}
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
                <div className="space-y-4">
                  {streaming ? (
                    <AssistantBody content={streaming} streaming />
                  ) : (
                    <p className="text-[19px]" style={{ color: "var(--muted)" }}>
                      이야기를 쓰는 중…
                    </p>
                  )}

                  <Images images={streamImages} />

                  {drawing && (
                    <div
                      className="rounded-2xl border px-5 py-4"
                      style={{ borderColor: "var(--border)", background: "var(--surface)" }}
                    >
                      <p className="flex items-center gap-2 text-[17px] font-medium">
                        <Spinner />
                        장면 {drawing.length}개를 한꺼번에 그리는 중…
                      </p>
                      <ul className="mt-3 space-y-1.5">
                        {drawing.map((scene, i) => (
                          <li key={i} className="text-[16px]" style={{ color: "var(--muted)" }}>
                            {i + 1}. {scene}
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}
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
          {(error ?? mic.error) && (
            <p className="mb-2 px-1 text-[16px]" style={{ color: "var(--accent)" }}>
              {error ?? mic.error}
            </p>
          )}

          {mic.recording && (
            <p
              className="mb-2 flex items-center gap-2 px-1 text-[15px]"
              style={{ color: "var(--accent)" }}
            >
              <span className="recording flex h-2.5 w-2.5 rounded-full bg-[var(--accent)]" />
              듣고 있습니다. 말이 끝나면 마이크를 다시 눌러주세요.
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
              placeholder={
                mic.connecting
                  ? "마이크를 켜는 중…"
                  : mic.recording
                    ? "말씀하세요. 듣고 있습니다…"
                    : "이야기를 들려주세요…"
              }
              className="w-full resize-none bg-transparent px-1 py-2 text-[18px] leading-relaxed outline-none placeholder:text-[var(--muted)]"
            />

            <div className="mt-1 flex items-center justify-between">
              {/* 좌하단: 사진 올리기 */}
              <button
                onClick={() => fileInput.current?.click()}
                disabled={uploading}
                className="flex h-12 w-12 items-center justify-center rounded-full border transition hover:bg-black/5 disabled:opacity-40"
                style={{ borderColor: "var(--border)", color: "var(--muted)" }}
                aria-label="사진 올리기"
                title="사진 올리기"
              >
                {uploading ? <Spinner /> : <PlusIcon />}
              </button>

              <input
                ref={fileInput}
                type="file"
                accept="image/*"
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
                  onClick={toggleMic}
                  disabled={micLocked}
                  className={`flex h-12 w-12 items-center justify-center rounded-full border transition hover:bg-black/5 disabled:cursor-not-allowed disabled:opacity-40 ${
                    mic.recording ? "recording" : ""
                  }`}
                  style={{
                    borderColor: mic.recording ? "var(--accent)" : "var(--border)",
                    background: mic.recording ? "var(--accent)" : undefined,
                    color: mic.recording ? "#fff" : "var(--muted)",
                  }}
                  aria-label={micLabel}
                  title={micLabel}
                >
                  {mic.connecting ? <Spinner /> : mic.recording ? <StopIcon /> : <MicIcon />}
                </button>

                <button
                  onClick={send}
                  disabled={sending || recovering || (!input.trim() && pending.length === 0)}
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
  admin,
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
  admin: boolean;
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
            className="flex h-11 w-11 items-center justify-center rounded-lg text-lg transition hover:bg-black/5"
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
              className="group flex cursor-pointer items-center gap-2 rounded-lg px-3 py-3.5 text-[17px] transition hover:bg-black/5"
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
          {admin && (
            <Link
              href="/admin"
              className="flex items-center gap-3 rounded-lg px-3 py-3 text-[17px] transition hover:bg-black/5"
              style={{ color: "var(--text)" }}
            >
              <KeyIcon />
              관리자
            </Link>
          )}

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

  return (
    <div className="space-y-4">
      <AssistantBody content={message.content} />
      <Images images={message.images} />
    </div>
  );
}

function fileName(img: Attachment) {
  const name = (img.caption ?? "그림").replace(/[\\/:*?"<>|]/g, " ").trim() || "그림";
  return `${name}.png`;
}

/**
 * 서명 URL 은 우리 도메인이 아니라서 <a download> 만으로는 저장이 안 되고 새 탭으로 열린다.
 * Supabase 는 download 쿼리를 붙이면 첨부 파일로 내려보내 준다.
 */
function downloadUrl(img: Attachment) {
  const sep = img.url.includes("?") ? "&" : "?";
  return `${img.url}${sep}download=${encodeURIComponent(fileName(img))}`;
}

/**
 * 웹페이지가 사진첩에 직접 넣을 수는 없다. 대신 휴대폰에선 공유 시트를 띄운다.
 * 거기서 "이미지 저장" 을 누르면 사진첩(갤러리)에 들어간다. 공유를 못 쓰는
 * 데스크톱 브라우저에선 그냥 파일로 내려받는다.
 */
async function saveImage(img: Attachment) {
  const name = fileName(img);

  try {
    const res = await fetch(img.url);
    const blob = await res.blob();
    const file = new File([blob], name, { type: blob.type || "image/png" });

    if (navigator.canShare?.({ files: [file] })) {
      await navigator.share({ files: [file], title: img.caption ?? "그림" });
      return;
    }

    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = name;
    link.click();
    URL.revokeObjectURL(url);
  } catch (err) {
    // 사용자가 공유 시트를 그냥 닫은 것뿐이면 아무 일도 하지 않는다.
    if (err instanceof DOMException && err.name === "AbortError") return;
    window.open(downloadUrl(img), "_blank");
  }
}

function Images({ images }: { images: Attachment[] }) {
  if (images.length === 0) return null;

  return (
    <div className="grid gap-4 sm:grid-cols-2">
      {images.map((img) => (
        <figure key={img.id}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={img.url}
            alt={img.caption ?? "AI 가 그린 그림"}
            className="w-full rounded-2xl border object-cover"
            style={{ borderColor: "var(--border)" }}
          />
          <figcaption className="mt-2 flex items-start justify-between gap-3 px-1">
            <span className="text-[15px] leading-snug" style={{ color: "var(--muted)" }}>
              {img.caption}
            </span>
            <button
              onClick={() => saveImage(img)}
              className="flex shrink-0 items-center gap-1.5 rounded-full border px-3 py-1.5 text-[14px] font-medium transition hover:bg-black/5"
              style={{ borderColor: "var(--border)" }}
              aria-label="그림 저장하기"
            >
              <svg
                width="15"
                height="15"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
                aria-hidden
              >
                <path d="M12 3v12" />
                <path d="m7 10 5 5 5-5" />
                <path d="M5 21h14" />
              </svg>
              저장
            </button>
          </figcaption>
        </figure>
      ))}
    </div>
  );
}

/** 글자가 한 자씩 들어오는 동안 "<sto" 같은 반쪽 태그가 화면에 보이지 않게 잘라낸다. */
function trimPartialTag(text: string) {
  const cut = text.lastIndexOf("<");
  if (cut === -1) return text;

  const tail = text.slice(cut);
  const isPartial = "<story>".startsWith(tail) || "</story>".startsWith(tail);
  return isPartial ? text.slice(0, cut) : text;
}

function AssistantBody({ content, streaming }: { content: string; streaming?: boolean }) {
  const segments = parseStory(content);

  return (
    <div className="space-y-4">
      {segments.map((segment, i) => {
        const last = i === segments.length - 1;
        const text = streaming && last ? trimPartialTag(segment.text) : segment.text;
        const caret = streaming && last ? <span className="caret">▍</span> : null;

        if (segment.kind === "story") {
          return (
            <StoryBox key={i} text={text.trim()} writing={Boolean(streaming && last && segment.open)}>
              {caret}
            </StoryBox>
          );
        }

        return (
          <div key={i} className="text-[19px] leading-[2.05] whitespace-pre-wrap">
            {text.trim()}
            {caret}
          </div>
        );
      })}
    </div>
  );
}

function StoryBox({
  text,
  writing,
  children,
}: {
  text: string;
  writing: boolean;
  children?: React.ReactNode;
}) {
  const [copied, setCopied] = useState(false);

  async function copy() {
    await navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  return (
    <article
      className="overflow-hidden rounded-2xl border"
      style={{ borderColor: "var(--border)", background: "var(--surface)" }}
    >
      <header
        className="flex items-center justify-between border-b px-5 py-3"
        style={{ borderColor: "var(--border)" }}
      >
        <span
          className="flex items-center gap-2 text-[15px] font-semibold"
          style={{ color: "var(--accent)" }}
        >
          <BookIcon />
          {writing ? "이야기를 쓰는 중…" : "당신의 이야기"}
        </span>

        {!writing && text.length > 0 && (
          <button
            onClick={copy}
            className="rounded-lg px-2.5 py-1.5 text-[14px] transition hover:bg-black/5"
            style={{ color: "var(--muted)" }}
          >
            {copied ? "복사했어요" : "복사"}
          </button>
        )}
      </header>

      <div className="px-5 py-5 text-[19px] leading-[2.1] whitespace-pre-wrap">
        {text}
        {children}
      </div>

      {!writing && text.length > 0 && (
        <footer
          className="border-t px-5 py-2.5 text-[14px]"
          style={{ borderColor: "var(--border)", color: "var(--muted)" }}
        >
          {[...text].length.toLocaleString()}자
        </footer>
      )}
    </article>
  );
}

function BookIcon() {
  return (
    <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M4 19.5V5a2 2 0 0 1 2-2h13v18H6.5A2.5 2.5 0 0 1 4 18.5Z" />
      <path d="M8 7h7M8 11h7" />
    </svg>
  );
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
