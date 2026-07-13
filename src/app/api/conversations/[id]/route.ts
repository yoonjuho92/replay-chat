import { NextResponse } from "next/server";
import { supabase, signImage } from "@/lib/supabase";
import { getSession } from "@/lib/session";

type Params = { params: Promise<{ id: string }> };

export async function GET(_req: Request, { params }: Params) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "인증이 필요합니다." }, { status: 401 });

  const { id } = await params;

  // 남의 대화를 id 만 알아내서 열어보지 못하도록 소유자를 먼저 확인한다.
  const { data: conversation } = await supabase
    .from("conversations")
    .select("id, title")
    .eq("id", id)
    .eq("user_id", session.userId)
    .maybeSingle();

  if (!conversation) {
    return NextResponse.json({ error: "대화를 찾을 수 없습니다." }, { status: 404 });
  }

  const { data: messages } = await supabase
    .from("messages")
    .select("id, role, content, created_at, attachments(id, storage_path, mime_type)")
    .eq("conversation_id", id)
    .order("created_at", { ascending: true });

  const withImages = await Promise.all(
    (messages ?? []).map(async (m) => ({
      id: m.id,
      role: m.role,
      content: m.content,
      images: (
        await Promise.all(
          (m.attachments ?? []).map(async (a) => ({
            id: a.id,
            url: await signImage(a.storage_path),
          })),
        )
      ).filter((a): a is { id: string; url: string } => Boolean(a.url)),
    })),
  );

  return NextResponse.json({ conversation, messages: withImages });
}

export async function DELETE(_req: Request, { params }: Params) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "인증이 필요합니다." }, { status: 401 });

  const { id } = await params;
  const { error } = await supabase
    .from("conversations")
    .delete()
    .eq("id", id)
    .eq("user_id", session.userId);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
