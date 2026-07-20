import Link from "next/link";
import { supabase, signImage } from "@/lib/supabase";
import { storyBlocks } from "@/lib/story";
import AdminStoryEditor from "@/components/AdminStoryEditor";

type Row = {
  id: string;
  title: string;
  updated_at: string;
  users: { username: string } | null;
  messages: {
    id: string;
    role: string;
    content: string;
    created_at: string;
    attachments: { id: string; storage_path: string; caption: string | null }[];
  }[];
};

type Image = { id: string; url: string; caption: string | null };
type Story = { messageId: string; index: number; text: string; at: string; sortKey: string };

async function sign(
  list: { id: string; storage_path: string; caption: string | null }[],
): Promise<Image[]> {
  const signed = await Promise.all(
    list.map(async (a) => ({
      id: a.id,
      url: await signImage(a.storage_path),
      caption: a.caption,
    })),
  );
  return signed.filter((a): a is Image => Boolean(a.url));
}

const when = (iso: string) =>
  new Date(iso).toLocaleString("ko-KR", {
    year: "numeric",
    month: "long",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });

export default async function AdminPage({
  searchParams,
}: {
  searchParams: Promise<{ user?: string }>;
}) {
  const { data } = await supabase
    .from("conversations")
    .select(
      "id, title, updated_at, users(username), messages(id, role, content, created_at, attachments(id, storage_path, caption))",
    )
    .overrideTypes<Row[]>();

  const sessions = await Promise.all(
    (data ?? []).map(async (conversation) => {
      const messages = conversation.messages ?? [];
      const answers = messages.filter((m) => m.role === "assistant");

      // 한 세션에서 이야기를 여러 번 고쳐 쓸 수 있다. 늦게 쓴 것이 위로 온다.
      const stories: Story[] = answers
        .flatMap((m) =>
          storyBlocks(m.content)
            .filter((b) => b.text.trim())
            .map((b) => ({
              messageId: m.id,
              index: b.index,
              text: b.text.trim(),
              at: when(m.created_at),
              sortKey: m.created_at,
            })),
        )
        .sort((a, b) => b.sortKey.localeCompare(a.sortKey));

      return {
        id: conversation.id,
        title: conversation.title,
        username: conversation.users?.username ?? "알 수 없음",
        updatedAt: conversation.updated_at,
        stories,
        // AI 가 그린 그림은 답변에, 사용자가 올린 사진은 사용자 메시지에 매달려 있다.
        drawn: await sign(answers.flatMap((m) => m.attachments ?? [])),
        uploaded: await sign(
          messages.filter((m) => m.role === "user").flatMap((m) => m.attachments ?? []),
        ),
      };
    }),
  );

  const withContent = sessions.filter((s) => s.stories.length > 0 || s.drawn.length > 0);

  // 사용자별로 묶고, 사용자도 세션도 최근 것이 먼저 오게 한다.
  const users = [...new Set(withContent.map((s) => s.username))]
    .map((username) => {
      const own = withContent
        .filter((s) => s.username === username)
        .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));

      // 이 사람의 가장 최근 이야기 한 블록. 새 대화가 띄우는 것과 같은 기준
      // (가장 늦은 답변의 마지막 블록)으로 골라, 여기서 고치면 채팅에도 반영된다.
      const latestStory = own
        .flatMap((s) => s.stories)
        .reduce<Story | null>((best, s) => {
          if (!best) return s;
          if (s.sortKey > best.sortKey) return s;
          if (s.sortKey === best.sortKey && s.index > best.index) return s;
          return best;
        }, null);

      return {
        username,
        sessions: own,
        latest: own[0]?.updatedAt ?? "",
        latestStoryKey: latestStory ? `${latestStory.messageId}:${latestStory.index}` : null,
        storyCount: own.reduce((n, s) => n + s.stories.length, 0),
        drawnCount: own.reduce((n, s) => n + s.drawn.length, 0),
      };
    })
    .sort((a, b) => b.latest.localeCompare(a.latest));

  // ?user=이름 이 붙어 있으면 그 사람 것만 본다. 없으면 전체.
  const { user: picked } = await searchParams;
  const selected = typeof picked === "string" && users.some((u) => u.username === picked)
    ? picked
    : null;
  const shown = selected ? users.filter((u) => u.username === selected) : users;

  return (
    <main className="mx-auto w-full max-w-3xl flex-1 px-4 py-8">
      <h1 className="text-2xl font-semibold tracking-tight">이야기 모아보기</h1>
      <p className="mt-2 text-[16px]" style={{ color: "var(--muted)" }}>
        최근에 만든 것이 가장 위에 옵니다.
      </p>

      {users.length > 0 && (
        <div className="mt-6 flex flex-wrap gap-2">
          <UserChip href="/admin" label="전체" count={users.length} active={!selected} />
          {users.map((user) => (
            <UserChip
              key={user.username}
              href={`/admin?user=${encodeURIComponent(user.username)}`}
              label={user.username}
              count={user.storyCount}
              active={selected === user.username}
            />
          ))}
        </div>
      )}

      {users.length === 0 && (
        <p className="mt-20 text-center text-[17px]" style={{ color: "var(--muted)" }}>
          아직 만들어진 이야기가 없습니다.
        </p>
      )}

      <div className="mt-8 space-y-12">
        {shown.map((user) => (
          <section key={user.username}>
            <header
              className="sticky top-0 z-10 flex items-baseline gap-3 border-b py-3"
              style={{ borderColor: "var(--border)", background: "var(--bg)" }}
            >
              <h2 className="text-[20px] font-semibold">{user.username}</h2>
              <span className="text-[14px]" style={{ color: "var(--muted)" }}>
                이야기 {user.storyCount}편 · 그림 {user.drawnCount}장 · 세션{" "}
                {user.sessions.length}개
              </span>
            </header>

            <div className="mt-5 space-y-5">
              {user.sessions.map((session) => (
                <section
                  key={session.id}
                  className="overflow-hidden rounded-2xl border"
                  style={{ borderColor: "var(--border)", background: "var(--surface)" }}
                >
                  <header className="border-b px-5 py-4" style={{ borderColor: "var(--border)" }}>
                    <h3 className="text-[18px] font-semibold">{session.title}</h3>
                    <p className="mt-1 text-[14px]" style={{ color: "var(--muted)" }}>
                      {when(session.updatedAt)} · 이야기 {session.stories.length}편 · 그림{" "}
                      {session.drawn.length}장
                    </p>
                  </header>

                  {session.stories.map((story, i) => {
                    const editable =
                      user.latestStoryKey === `${story.messageId}:${story.index}`;

                    return (
                      <article
                        key={story.sortKey + i}
                        className="border-b px-5 py-5"
                        style={{ borderColor: "var(--border)" }}
                      >
                        <div className="mb-3 flex flex-wrap items-baseline gap-x-2 gap-y-1">
                          <span
                            className="text-[14px] font-semibold"
                            style={{ color: "var(--accent)" }}
                          >
                            {editable
                              ? "가장 최근 이야기"
                              : `이야기 ${session.stories.length - i}`}
                          </span>
                          <span className="text-[13px]" style={{ color: "var(--muted)" }}>
                            {story.at} · {[...story.text].length.toLocaleString()}자
                          </span>
                        </div>

                        {editable ? (
                          <AdminStoryEditor
                            messageId={story.messageId}
                            index={story.index}
                            initialText={story.text}
                          />
                        ) : (
                          <p className="text-[17px] leading-[1.95] whitespace-pre-wrap">
                            {story.text}
                          </p>
                        )}
                      </article>
                    );
                  })}

                  {session.drawn.length > 0 && (
                    <div className="border-b px-5 py-5" style={{ borderColor: "var(--border)" }}>
                      <div
                        className="mb-3 text-[14px] font-semibold"
                        style={{ color: "var(--accent)" }}
                      >
                        이 세션에서 그린 그림
                      </div>
                      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
                        {session.drawn.map((img) => (
                          <figure key={img.id}>
                            {/* eslint-disable-next-line @next/next/no-img-element */}
                            <img
                              src={img.url}
                              alt={img.caption ?? "AI 가 그린 그림"}
                              className="aspect-square w-full rounded-xl border object-cover"
                              style={{ borderColor: "var(--border)" }}
                            />
                            {img.caption && (
                              <figcaption
                                className="mt-1.5 text-[13px] leading-snug"
                                style={{ color: "var(--muted)" }}
                              >
                                {img.caption}
                              </figcaption>
                            )}
                          </figure>
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
          </section>
        ))}
      </div>
    </main>
  );
}

function UserChip({
  href,
  label,
  count,
  active,
}: {
  href: string;
  label: string;
  count: number;
  active: boolean;
}) {
  return (
    <Link
      href={href}
      className="rounded-full border px-4 py-2 text-[16px] transition hover:bg-black/5"
      style={{
        borderColor: active ? "var(--accent)" : "var(--border)",
        background: active ? "var(--accent)" : "var(--surface)",
        color: active ? "#fff" : "var(--text)",
      }}
    >
      {label}
      <span className="ml-2 text-[14px] opacity-70">{count}</span>
    </Link>
  );
}
