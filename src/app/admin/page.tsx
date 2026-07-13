import { supabase, signImage } from "@/lib/supabase";
import { extractStories } from "@/lib/story";

type Row = {
  id: string;
  title: string;
  updated_at: string;
  users: { username: string } | null;
  messages: {
    role: string;
    content: string;
    created_at: string;
    attachments: { id: string; storage_path: string }[];
  }[];
};

export default async function AdminPage() {
  const { data } = await supabase
    .from("conversations")
    .select(
      "id, title, updated_at, users(username), messages(role, content, created_at, attachments(id, storage_path))",
    )
    .order("updated_at", { ascending: false })
    .overrideTypes<Row[]>();

  const sessions = await Promise.all(
    (data ?? []).map(async (conversation) => {
      const messages = [...conversation.messages].sort((a, b) =>
        a.created_at.localeCompare(b.created_at),
      );

      const stories = messages
        .filter((m) => m.role === "assistant")
        .flatMap((m) => extractStories(m.content));

      // AI 가 그린 그림은 어시스턴트 답변에 매달려 있고, 사용자가 올린 사진은 사용자 메시지에 매달려 있다.
      const drawn = messages
        .filter((m) => m.role === "assistant")
        .flatMap((m) => m.attachments ?? []);
      const uploaded = messages
        .filter((m) => m.role === "user")
        .flatMap((m) => m.attachments ?? []);

      const sign = async (list: { id: string; storage_path: string }[]) =>
        (
          await Promise.all(
            list.map(async (a) => ({ id: a.id, url: await signImage(a.storage_path) })),
          )
        ).filter((a): a is { id: string; url: string } => Boolean(a.url));

      return {
        id: conversation.id,
        title: conversation.title,
        username: conversation.users?.username ?? "알 수 없음",
        updatedAt: new Date(conversation.updated_at).toLocaleString("ko-KR"),
        stories,
        drawn: await sign(drawn),
        uploaded: await sign(uploaded),
      };
    }),
  );

  const withContent = sessions.filter((s) => s.stories.length > 0 || s.drawn.length > 0);

  return (
    <main className="mx-auto w-full max-w-3xl flex-1 px-4 py-8">
      <h1 className="text-2xl font-semibold tracking-tight">이야기 모아보기</h1>
      <p className="mt-2 text-[16px]" style={{ color: "var(--muted)" }}>
        대화 {sessions.length}개 중 이야기나 그림이 나온 건 {withContent.length}개입니다.
      </p>

      {withContent.length === 0 && (
        <p className="mt-16 text-center text-[17px]" style={{ color: "var(--muted)" }}>
          아직 완성된 이야기가 없습니다.
        </p>
      )}

      <div className="mt-8 space-y-6">
        {withContent.map((session) => (
          <section
            key={session.id}
            className="overflow-hidden rounded-2xl border"
            style={{ borderColor: "var(--border)", background: "var(--surface)" }}
          >
            <header
              className="border-b px-5 py-4"
              style={{ borderColor: "var(--border)" }}
            >
              <h2 className="text-[18px] font-semibold">{session.title}</h2>
              <p className="mt-1 text-[14px]" style={{ color: "var(--muted)" }}>
                {session.username} · {session.updatedAt} · 이야기 {session.stories.length}편 ·
                그림 {session.drawn.length}장
              </p>
            </header>

            {session.stories.map((story, i) => (
              <article
                key={i}
                className="border-b px-5 py-5"
                style={{ borderColor: "var(--border)" }}
              >
                <div
                  className="mb-3 flex items-center gap-2 text-[14px] font-semibold"
                  style={{ color: "var(--accent)" }}
                >
                  이야기 {i + 1} · {[...story].length.toLocaleString()}자
                </div>
                <p className="text-[17px] leading-[1.95] whitespace-pre-wrap">{story}</p>
              </article>
            ))}

            {session.drawn.length > 0 && (
              <div className="border-b px-5 py-5" style={{ borderColor: "var(--border)" }}>
                <div
                  className="mb-3 text-[14px] font-semibold"
                  style={{ color: "var(--accent)" }}
                >
                  이 대화에서 그린 그림
                </div>
                <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
                  {session.drawn.map((img) => (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      key={img.id}
                      src={img.url}
                      alt="AI 가 그린 그림"
                      className="aspect-square w-full rounded-xl border object-cover"
                      style={{ borderColor: "var(--border)" }}
                    />
                  ))}
                </div>
              </div>
            )}

            {session.uploaded.length > 0 && (
              <div className="px-5 py-4">
                <div className="mb-3 text-[14px]" style={{ color: "var(--muted)" }}>
                  올린 사진
                </div>
                <div className="flex flex-wrap gap-2">
                  {session.uploaded.map((img) => (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      key={img.id}
                      src={img.url}
                      alt="사용자가 올린 사진"
                      className="h-20 w-20 rounded-lg border object-cover"
                      style={{ borderColor: "var(--border)" }}
                    />
                  ))}
                </div>
              </div>
            )}
          </section>
        ))}
      </div>
    </main>
  );
}
