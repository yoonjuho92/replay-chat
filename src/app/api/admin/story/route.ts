import { NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";
import { guardAdmin } from "@/lib/admin";
import { replaceStory, storyBlocks } from "@/lib/story";

/**
 * 관리자가 어떤 사용자의 이야기 한 블록을 고쳐 쓴다. 답변 메시지의 content 안에서
 * 해당 <story> 블록의 본문만 갈아끼운다. 새 대화 첫 화면은 이 블록을 그대로 읽으므로
 * 고친 내용이 바로 반영된다.
 */
export async function PATCH(req: Request) {
  const guard = await guardAdmin();
  if (!guard.ok) {
    return NextResponse.json(
      { error: guard.reason === "anonymous" ? "인증이 필요합니다." : "권한이 없습니다." },
      { status: guard.reason === "anonymous" ? 401 : 403 },
    );
  }

  const { messageId, index, text } = await req.json();

  if (typeof messageId !== "string" || typeof index !== "number" || typeof text !== "string") {
    return NextResponse.json({ error: "고칠 이야기를 찾지 못했습니다." }, { status: 400 });
  }
  if (!text.trim()) {
    return NextResponse.json({ error: "이야기 내용이 비어 있습니다." }, { status: 400 });
  }

  const { data: message } = await supabase
    .from("messages")
    .select("id, content")
    .eq("id", messageId)
    .maybeSingle();

  if (!message) return NextResponse.json({ error: "그런 이야기가 없습니다." }, { status: 404 });

  if (index < 0 || index >= storyBlocks(message.content).length) {
    return NextResponse.json({ error: "이야기를 찾지 못했습니다." }, { status: 400 });
  }

  const { error } = await supabase
    .from("messages")
    .update({ content: replaceStory(message.content, index, text.trim()) })
    .eq("id", messageId);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ ok: true, text: text.trim() });
}
