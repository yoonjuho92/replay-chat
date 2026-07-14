import { redirect } from "next/navigation";
import Link from "next/link";
import { guardAdmin } from "@/lib/admin";

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const guard = await guardAdmin();

  // 로그인조차 안 했으면 로그인으로, 로그인은 했지만 관리자가 아니면 그냥 채팅으로 돌려보낸다.
  if (!guard.ok) redirect(guard.reason === "anonymous" ? "/login" : "/");

  return (
    <div className="flex min-h-dvh flex-col">
      <header
        className="flex h-14 shrink-0 items-center gap-1 border-b px-2"
        style={{ borderColor: "var(--border)" }}
      >
        <Link
          href="/"
          className="flex h-11 w-11 items-center justify-center rounded-lg transition hover:bg-black/5"
          aria-label="채팅으로 돌아가기"
        >
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M15 18l-6-6 6-6" />
          </svg>
        </Link>

        <nav className="flex flex-1 items-center gap-1">
          <Link
            href="/admin"
            className="rounded-lg px-3 py-2 text-[16px] transition hover:bg-black/5"
          >
            이야기 모아보기
          </Link>
          <Link
            href="/admin/password"
            className="rounded-lg px-3 py-2 text-[16px] transition hover:bg-black/5"
          >
            비밀번호
          </Link>
        </nav>

        <span className="px-3 text-[14px]" style={{ color: "var(--muted)" }}>
          {guard.username}
        </span>
      </header>

      {children}
    </div>
  );
}
